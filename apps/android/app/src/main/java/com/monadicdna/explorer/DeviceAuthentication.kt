package com.monadicdna.explorer

import android.app.Activity
import android.app.KeyguardManager
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricPrompt
import androidx.biometric.BiometricManager.Authenticators
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class DeviceAuthentication(private val activity:FragmentActivity) {
    private var pending:kotlinx.coroutines.CancellableContinuation<Unit>?=null
    val active get()=pending?.isActive==true
    private val credential=activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        val continuation=pending;pending=null
        if(continuation?.isActive==true) {
            if(result.resultCode==Activity.RESULT_OK) continuation.resume(Unit)
            else continuation.resumeWithException(IllegalStateException("Device authentication was cancelled."))
        }
    }
    suspend fun authenticate()=withContext(Dispatchers.Main.immediate) {
        val keyguard=activity.getSystemService(KeyguardManager::class.java)
        check(keyguard.isDeviceSecure){"Set a device passcode before saving DNA on this device."}
        suspendCancellableCoroutine<Unit>{continuation->
            check(!active){"Authentication is already in progress."};pending=continuation
            if(Build.VERSION.SDK_INT>=30) {
                val prompt=BiometricPrompt(activity,ContextCompat.getMainExecutor(activity),object:BiometricPrompt.AuthenticationCallback(){
                    override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){pending=null;if(continuation.isActive)continuation.resume(Unit)}
                    override fun onAuthenticationError(code:Int,message:CharSequence){pending=null;if(continuation.isActive)continuation.resumeWithException(IllegalStateException("Device authentication was not completed."))}
                })
                continuation.invokeOnCancellation{pending=null;prompt.cancelAuthentication()}
                prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Confirm it's you").setSubtitle("Explorer needs this to open or save your encrypted DNA, results and customization")
                    .setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL).build())
            } else {
                continuation.invokeOnCancellation{pending=null}
                credential.launch(keyguard.createConfirmDeviceCredentialIntent("Confirm it's you","Explorer needs this to open or save your encrypted DNA, results and customization"))
            }
        }
    }
}
