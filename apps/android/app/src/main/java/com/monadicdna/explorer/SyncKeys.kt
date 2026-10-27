package com.monadicdna.explorer

import android.content.Context
import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.DeleteBytesRequest
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Where the user's sync key lives so a new device can restore their data. */
interface SyncKeyStore {
    suspend fun get(): String?
    suspend fun put(key: String)
    suspend fun delete()
}

/**
 * Google Play services Block Store. With a screen lock (which the app requires before storing DNA),
 * Block Store data is end-to-end encrypted and restored when the user sets up a new phone.
 */
class BlockStoreSyncKeys(context: Context): SyncKeyStore {
    private val client=Blockstore.getClient(context)
    override suspend fun get(): String? =
        client.retrieveBytes(RetrieveBytesRequest.Builder().setKeys(listOf(KEY)).build()).await().blockstoreDataMap[KEY]?.bytes?.toString(Charsets.UTF_8)
    override suspend fun put(key: String) {
        // Kept on this device either way, which covers reinstalling. Cloud backup is used only when it is end-to-end encrypted.
        val endToEnd=client.isEndToEndEncryptionAvailable.await()
        client.storeBytes(StoreBytesData.Builder().setKey(KEY).setBytes(key.toByteArray()).setShouldBackupToCloud(endToEnd).build()).await()
        check(endToEnd) { "Sign in to a Google account with a screen lock so a new phone can restore your data." }
    }
    override suspend fun delete() { client.deleteBytes(DeleteBytesRequest.Builder().setKeys(listOf(KEY)).build()).await() }
    private companion object { const val KEY="com.monadicdna.explorer.sync-key.v1" }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(it) }
    addOnCanceledListener { continuation.cancel() }
}
