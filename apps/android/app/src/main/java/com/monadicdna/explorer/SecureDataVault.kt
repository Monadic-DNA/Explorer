package com.monadicdna.explorer

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

interface VaultKeyProtector {
    val description: String
    fun wrap(key: ByteArray, id: String): JSONObject
    fun unwrap(value: JSONObject, id: String): ByteArray
    fun delete()
}
class HardwareVaultKey(private val context:Context):VaultKeyProtector {
    private val alias="monadic-explorer-vault-v2"
    private fun existing()=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.getKey(alias,null) as? SecretKey
    private fun key():SecretKey {
        existing()?.let{return it}
        fun create(strongBox:Boolean):SecretKey {
            val builder=KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
            if(Build.VERSION.SDK_INT>=30) builder.setUserAuthenticationParameters(30,KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
            else builder.setUserAuthenticationValidityDurationSeconds(30)
            if(Build.VERSION.SDK_INT>=28) builder.setIsStrongBoxBacked(strongBox)
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(builder.build())}.generateKey()
        }
        if(Build.VERSION.SDK_INT>=28 && context.packageManager.hasSystemFeature("android.hardware.strongbox_keystore")) {
            try {return create(true)} catch(_:StrongBoxUnavailableException) { /* Use the device TEE when StrongBox is unavailable. */ }
        }
        return create(false)
    }
    override val description:String get() {
        val key=existing() ?: return "Android Keystore; StrongBox preferred"
        val info=SecretKeyFactory.getInstance(key.algorithm,"AndroidKeyStore").getKeySpec(key,KeyInfo::class.java) as KeyInfo
        return if(Build.VERSION.SDK_INT>=31) when(info.securityLevel){KeyProperties.SECURITY_LEVEL_STRONGBOX->"StrongBox hardware";KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT->"Trusted hardware";else->"Android Keystore (software-backed)"}
        else if(info.isInsideSecureHardware) "Trusted hardware" else "Android Keystore (software-backed)"
    }
    override fun wrap(key:ByteArray,id:String):JSONObject {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,this@HardwareVaultKey.key());updateAAD("Explorer vault key v2|$id".toByteArray())}
        return json("nonce" to encode(cipher.iv),"ciphertext" to encode(cipher.doFinal(key)))
    }
    override fun unwrap(value:JSONObject,id:String):ByteArray {
        // Missing/inaccessible keys are errors. Never silently generate a replacement key for saved data.
        val key=existing() ?: error("The device key is unavailable. Restore an encrypted backup or cloud copy using your recovery passphrase.")
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,decode(value.getString("nonce"))));updateAAD("Explorer vault key v2|$id".toByteArray())}
        return cipher.doFinal(decode(value.getString("ciphertext")))
    }
    override fun delete(){KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.deleteEntry(alias)}
}
internal fun encode(bytes:ByteArray)=Base64.encodeToString(bytes,Base64.NO_WRAP)
internal fun decode(value:String)=Base64.decode(value,Base64.NO_WRAP)
internal fun randomBytes(count:Int)=ByteArray(count).also{SecureRandom().nextBytes(it)}

/**
 * The device's encrypted store (docs/native-data-store.md). A random 32-byte local key, wrapped by the
 * authenticated Keystore key, opens the SQLCipher database. The local key never leaves this device.
 */
class SecureDataVault(
    context:Context,
    private val protector:VaultKeyProtector=HardwareVaultKey(context),
    private val directory:File=File(context.noBackupFilesDir,"protected-data")
) {
    private val keyFile=AtomicFile(File(directory,"device-key.json"))
    private val database=File(directory,"explorer.db")
    private val mutex=Mutex()
    val exists get()=keyFile.baseFile.exists() && database.exists()
    val protection get()=protector.description
    /** Authenticates the user, then opens (creating on first use) the store. Returns the store handle. */
    suspend fun unlock(authenticate:suspend()->Unit):JSONObject {
        authenticate()
        return withContext(Dispatchers.IO){mutex.withLock {
            directory.mkdirs()
            // Earlier development builds kept a single encrypted blob here; it is never read.
            File(directory,"vault-v2.json").delete()
            val key=if(keyFile.baseFile.exists()) protector.unwrap(JSONObject(keyFile.readFully().toString(Charsets.UTF_8)),KEY_ID)
            else randomBytes(32).also{key->
                // A key without its database would be useless; start both fresh.
                listOf("","-wal","-shm").forEach{File(database.path+it).delete()}
                val stream=keyFile.startWrite()
                try{stream.write(protector.wrap(key,KEY_ID).toString().toByteArray());keyFile.finishWrite(stream)}catch(error:Exception){keyFile.failWrite(stream);throw error}
            }
            try{Core.storeOpen(database.path,key)}finally{key.fill(0)}
        }}
    }
    suspend fun lock(handle:Long)=withContext(Dispatchers.IO){mutex.withLock{Core.storeClose(handle)}}
    /** Deletes this device's data and its wrapping key. The cloud copy is handled by sync. */
    suspend fun delete()=withContext(Dispatchers.IO){mutex.withLock{
        listOf("","-wal","-shm").forEach{File(database.path+it).delete()}
        keyFile.delete();protector.delete()
        check(!exists){"Unable to delete saved data."}
    }}
    private companion object { const val KEY_ID="Explorer store key v1" }
}
