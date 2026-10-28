package com.monadicdna.explorer

import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.FragmentActivity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Grants access to the user's own Google Drive app-data folder, which only this app can see.
 * Google asks the user once; later calls return a fresh token without a prompt.
 */
class DriveAuthorization(private val activity: FragmentActivity) {
    private val client=Identity.getAuthorizationClient(activity)
    private var pending: CancellableContinuation<AuthorizationResult>?=null
    private val consent=activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()){ result ->
        val continuation=pending;pending=null
        if(continuation?.isActive!=true) return@registerForActivityResult
        try{continuation.resume(client.getAuthorizationResultFromIntent(result.data))}
        catch(_:Exception){continuation.resumeWithException(IllegalStateException("Google Drive access is needed to sync your data."))}
    }
    suspend fun token(): String = withContext(Dispatchers.Main.immediate) {
        val request=AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(SCOPE))).build()
        var result=suspendCancellableCoroutine<AuthorizationResult>{continuation->
            client.authorize(request).addOnSuccessListener{continuation.resume(it)}.addOnFailureListener{continuation.resumeWithException(IllegalStateException("Google Drive access is unavailable: ${it.message}"))}
        }
        if(result.hasResolution()) result=suspendCancellableCoroutine{continuation->
            pending=continuation
            continuation.invokeOnCancellation{pending=null}
            consent.launch(IntentSenderRequest.Builder(result.pendingIntent!!.intentSender).build())
        }
        requireNotNull(result.accessToken){"Google Drive access was not granted."}
    }
    private companion object { const val SCOPE="https://www.googleapis.com/auth/drive.appdata" }
}
