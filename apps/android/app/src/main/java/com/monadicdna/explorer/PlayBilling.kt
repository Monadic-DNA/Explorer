package com.monadicdna.explorer

import android.app.Activity
import android.app.Application
import androidx.compose.runtime.*
import com.android.billingclient.api.*
import kotlinx.coroutines.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Google Play is the only record of purchases; Monadic DNA keeps none.
 * - Premium is an active, purchased subscription in Play's purchase list.
 * - A report pass is a one-time product the user owns until it is consumed. It is consumed when the
 *   report is generated, so Play tracks which passes remain and restores them on a new device.
 */
class PlayBilling(app: Application, private val scope: CoroutineScope) : PurchasesUpdatedListener {
    var products by mutableStateOf(emptyList<ProductDetails>())
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf("")
        private set
    var premium by mutableStateOf(false)
        private set
    /** Unused report passes by report type (overview, healthspan, top_traits). */
    var passes by mutableStateOf(emptyMap<String,Purchase>())
        private set
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
        refreshOwned()
    }
    fun price(product: ProductDetails): String? = if (product.productType==BillingClient.ProductType.SUBS)
        offer(product)?.pricingPhases?.pricingPhaseList?.lastOrNull()?.formattedPrice
        else product.oneTimePurchaseOfferDetails?.formattedPrice
    private fun offer(product: ProductDetails) = product.subscriptionOfferDetails?.firstOrNull { it.offerId==null && it.pricingPhases.pricingPhaseList.lastOrNull()?.billingPeriod=="P1M" }
    fun purchase(activity: Activity, product: ProductDetails) = run {
        if(product.productType==BillingClient.ProductType.INAPP) {
            val type=catalog.firstOrNull{it.getString("id")==product.productId}?.optString("reportType")
            require(type==null || passes[type]==null) { "You already have an unused pass for this report." }
        }
        val details=BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product)
        if(product.productType==BillingClient.ProductType.SUBS) details.setOfferToken(requireNotNull(offer(product)?.offerToken) { "Monthly subscription is not available." })
        val result=client.launchBillingFlow(activity,BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(details.build())).build())
        require(result.responseCode==BillingClient.BillingResponseCode.OK) { "Unable to open Google Play checkout." }
    }
    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when(result.responseCode) {
            BillingClient.BillingResponseCode.OK -> scope.launch { runCatching{refreshOwned()};message=if(purchases.orEmpty().any{it.purchaseState==Purchase.PurchaseState.PENDING})"Purchase pending approval. Access appears once Google Play approves it." else "Purchase complete." }
            BillingClient.BillingResponseCode.USER_CANCELED -> message="Purchase cancelled."
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> restore()
            else -> message="Google Play could not complete the purchase. Please try again."
        }
    }
    private suspend fun owned(type: String)=suspendCancellableCoroutine<List<Purchase>> { continuation ->
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { result, list ->
            if (!continuation.isActive) return@queryPurchasesAsync
            if(result.responseCode==BillingClient.BillingResponseCode.OK) continuation.resume(list)
            else continuation.resumeWithException(IllegalStateException("Unable to read your Google Play purchases."))
        }
    }
    /** Reads entitlements from Play. Purchases must be acknowledged within three days or Play refunds them. */
    private suspend fun refreshOwned() {
        connect()
        val ids=catalog.associateBy{it.getString("id")}
        val subscriptions=owned(BillingClient.ProductType.SUBS).filter{it.purchaseState==Purchase.PurchaseState.PURCHASED && it.products.any{id->ids[id]?.getString("kind")=="subscription"}}
        val oneTime=owned(BillingClient.ProductType.INAPP).filter{it.purchaseState==Purchase.PurchaseState.PURCHASED}
        for(purchase in subscriptions+oneTime) if(!purchase.isAcknowledged) acknowledge(purchase)
        premium=subscriptions.isNotEmpty()
        passes=oneTime.mapNotNull{purchase->purchase.products.firstNotNullOfOrNull{ids[it]?.optString("reportType")?.takeIf{t->t.isNotEmpty()}}?.let{it to purchase}}.toMap()
    }
    private suspend fun acknowledge(purchase: Purchase)=suspendCancellableCoroutine<Unit> { continuation ->
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) { result ->
            if(!continuation.isActive) return@acknowledgePurchase
            if(result.responseCode==BillingClient.BillingResponseCode.OK) continuation.resume(Unit)
            else continuation.resumeWithException(IllegalStateException("Google Play could not confirm the purchase. Please retry."))
        }
    }
    /** Refreshes from Play; call before a premium check so a renewal or cancellation is seen. */
    suspend fun current(){ refreshOwned() }
    /** Uses the report pass for [reportType]. Call only after the report was generated successfully. */
    suspend fun consumePass(reportType: String) {
        val purchase=passes[reportType] ?: return
        suspendCancellableCoroutine<Unit> { continuation ->
            client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) { result, _ ->
                if(!continuation.isActive) return@consumeAsync
                if(result.responseCode==BillingClient.BillingResponseCode.OK) continuation.resume(Unit)
                else continuation.resumeWithException(IllegalStateException("The report was generated, but Google Play could not mark the pass as used."))
            }
        }
        passes=passes-reportType
    }
    fun restore() = run { refreshOwned(); message=if(premium||passes.isNotEmpty())"Purchases restored from Google Play." else "No active purchases found for this Google account." }
    fun close() { client.endConnection() }
}
