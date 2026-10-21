package com.monadicdna.explorer

import android.app.Activity
import android.app.Application
import androidx.compose.runtime.*
import com.android.billingclient.api.*
import kotlinx.coroutines.*
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Play owns the payment UI; the backend verifies and records each token before acknowledgement. */
class PlayBilling(
    app: Application,
    private val scope: CoroutineScope,
    private val wallet: () -> String,
    private val api: suspend (String, JSONObject) -> JSONObject,
    private val refresh: () -> Unit
) : PurchasesUpdatedListener {
    var products by mutableStateOf(emptyList<ProductDetails>())
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf("")
        private set
    private val inFlight = mutableSetOf<String>()
    private val catalog get() = Core.arr("billing_catalog").objects()
    private val client = BillingClient.newBuilder(app).setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection().build()
    private suspend fun connect() {
        if (client.isReady) return
        suspendCancellableCoroutine<Unit> { continuation ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (!continuation.isActive) return
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) continuation.resume(Unit)
                    else continuation.resumeWithException(IllegalStateException("Google Play billing is unavailable. Please try again."))
                }
                override fun onBillingServiceDisconnected() { /* The SDK reconnects on the next request. */ }
            })
        }
    }
    private fun run(block: suspend () -> Unit) {
        if (busy) return
        busy=true; message=""
        scope.launch { try { connect(); block() } catch (e:Exception) { message=e.message ?: "Purchase could not be completed. Please retry." } finally { busy=false } }
    }
    fun load() = run {
        val found = mutableListOf<ProductDetails>()
        for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
            val items = catalog.filter { (it.getString("kind")=="subscription") == (type==BillingClient.ProductType.SUBS) }
                .map { QueryProductDetailsParams.Product.newBuilder().setProductId(it.getString("id")).setProductType(type).build() }
            val params = QueryProductDetailsParams.newBuilder().setProductList(items).build()
            val details = suspendCancellableCoroutine<List<ProductDetails>> { continuation ->
                client.queryProductDetailsAsync(params) { result, response ->
                    if (!continuation.isActive) return@queryProductDetailsAsync
                    if (result.responseCode==BillingClient.BillingResponseCode.OK) continuation.resume(response.productDetailsList)
                    else continuation.resumeWithException(IllegalStateException("Unable to load Google Play products."))
                }
            }
            found.addAll(details)
        }
        products=found.sortedBy { it.productId }
        if (products.isEmpty()) message="Purchases are not available yet. Please try again later."
    }
    fun price(product: ProductDetails): String? = if (product.productType==BillingClient.ProductType.SUBS)
        offer(product)?.pricingPhases?.pricingPhaseList?.lastOrNull()?.formattedPrice
        else product.oneTimePurchaseOfferDetails?.formattedPrice
    private fun offer(product: ProductDetails) = product.subscriptionOfferDetails?.firstOrNull { it.offerId==null && it.pricingPhases.pricingPhaseList.lastOrNull()?.billingPeriod=="P1M" }
    fun purchase(activity: Activity, product: ProductDetails) = run {
        require(wallet().isNotBlank()) { "Sign in before purchasing." }
        val response=api("/api/mobile-billing/account",json("walletAddress" to wallet(),"store" to "google"))
        val details=BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
        if(product.productType==BillingClient.ProductType.SUBS) details.setOfferToken(requireNotNull(offer(product)?.offerToken) { "Monthly subscription is not available." })
        val params=BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(details.build()))
            .setObfuscatedAccountId(response.getString("accountId")).build()
        val result=client.launchBillingFlow(activity,params)
        require(result.responseCode==BillingClient.BillingResponseCode.OK) { "Unable to open Google Play checkout." }
    }
    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when(result.responseCode) {
            BillingClient.BillingResponseCode.OK -> scope.launch { purchases.orEmpty().forEach { deliverSafely(it) } }
            BillingClient.BillingResponseCode.USER_CANCELED -> message="Purchase cancelled."
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> restore()
            else -> message="Google Play could not complete the purchase. Please try again."
        }
    }
    private suspend fun deliverSafely(purchase: Purchase) {
        try { deliver(purchase) } catch(e:Exception) { message=e.message ?: "Verification is pending. Restore purchases to retry." }
    }
    private suspend fun deliver(purchase: Purchase) {
        if(purchase.purchaseState != Purchase.PurchaseState.PURCHASED) {
            message="Purchase pending approval. Access will appear after approval and verification."; return
        }
        if (!inFlight.add(purchase.purchaseToken)) return
        try {
            require(wallet().isNotBlank()) { "Sign in to the original Explorer account, then restore purchases." }
            require(purchase.products.size==1) { "Unexpected purchase contents." }
            val id=purchase.products.single()
            require(catalog.any { it.getString("id")==id }) { "Unknown product." }
            val response=api("/api/mobile-billing/verify",json("walletAddress" to wallet(),"store" to "google","productId" to id,"proof" to purchase.purchaseToken))
            require(response.optBoolean("accepted")) { "Purchase verification is pending. Please retry." }
            // The backend acknowledges subscriptions / consumes products only after committing this account credit.
            message="Purchase verified. Your account access has been updated."
            refresh()
        } finally { inFlight.remove(purchase.purchaseToken) }
    }
    fun restore() = run {
        require(wallet().isNotBlank()) { "Sign in to restore purchases." }
        for(type in listOf(BillingClient.ProductType.SUBS,BillingClient.ProductType.INAPP)) {
            val purchases=suspendCancellableCoroutine<List<Purchase>> { continuation ->
                client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { result, list ->
                    if (!continuation.isActive) return@queryPurchasesAsync
                    if(result.responseCode==BillingClient.BillingResponseCode.OK) continuation.resume(list)
                    else continuation.resumeWithException(IllegalStateException("Unable to restore Google Play purchases."))
                }
            }
            for(purchase in purchases) deliver(purchase)
        }
        refresh()
        message="Purchases restored. Remaining report passes are attached to your Explorer account."
    }
    fun close() { client.endConnection() }
}
