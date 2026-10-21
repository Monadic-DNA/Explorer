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

/** Atomic ciphertext-only storage. Device wrapping keys are never included in portable/cloud archives. */
class SecureDataVault(
    context:Context,
    private val protector:VaultKeyProtector=HardwareVaultKey(context),
    directory:File=File(context.noBackupFilesDir,"protected-data")
) {
    private val file=AtomicFile(File(directory,"vault-v2.json"))
    private val mutex=Mutex()
    private var key:ByteArray?=null
    private var record:JSONObject?=null
    val exists get()=file.baseFile.exists() || File(file.baseFile.path+".bak").exists()
    val protection get()=protector.description
    private fun authenticatedRecord():JSONObject {
        val value=JSONObject(file.openRead().bufferedReader().use{it.readText()})
        val id=value.getJSONObject("envelope").getString("vaultId")
        val opened=protector.unwrap(value.getJSONObject("deviceKey"),id)
        try {Core.call("vault_record_verify",json("key" to encode(opened),"record" to value));key?.fill(0);key=opened;record=value;return value}
        catch(error:Exception){opened.fill(0);throw error}
    }
    private fun write(value:JSONObject) {
        value.remove("mac")
        value.put("mac",Core.call("vault_record_mac",json("key" to encode(requireNotNull(key)),"record" to value)))
        file.baseFile.parentFile!!.mkdirs()
        val stream=file.startWrite()
        try{stream.write(value.toString().toByteArray());file.finishWrite(stream)}catch(error:Exception){file.failWrite(stream);throw error}
        record=value
    }
    suspend fun unlock(session:Long,authenticate:suspend()->Unit):JSONObject {
        authenticate()
        return withContext(Dispatchers.IO){mutex.withLock {
            if(exists) {
                val value=authenticatedRecord()
                try{Core.restorePersisted(session,requireNotNull(key),value.getJSONObject("envelope").toString());Core.obj("session_customization",json("session" to session))}
                catch(error:Exception){key?.fill(0);key=null;record=null;throw error}
            } else {
                key=randomBytes(32)
                val id=UUID.randomUUID().toString()
                val initial=Core.persistSession(session,requireNotNull(key),id,1,randomBytes(12),json("fields" to JSONObject(),"context" to "").toString())
                write(json("version" to 2,"deviceKey" to protector.wrap(requireNotNull(key),id),"envelope" to initial,"sync" to json("enabled" to false,"revision" to 0,"dirty" to false)))
                json("fields" to JSONObject(),"context" to "")
            }
        }}
    }
    suspend fun save(session:Long,customization:JSONObject)=withContext(Dispatchers.IO){mutex.withLock {
        val current=JSONObject(requireNotNull(record){"Unlock your saved data first."}.toString())
        val envelope=current.getJSONObject("envelope")
        current.put("envelope",Core.persistSession(session,requireNotNull(key),envelope.getString("vaultId"),envelope.getLong("revision")+1,randomBytes(12),customization.toString()))
        current.getJSONObject("sync").put("dirty",true)
        write(current)
    }}
    suspend fun lock()=withContext(Dispatchers.IO){mutex.withLock{key?.fill(0);key=null;record=null}}
    suspend fun delete()=withContext(Dispatchers.IO){mutex.withLock{file.delete();check(!exists){"Unable to delete saved data."};protector.delete();key?.fill(0);key=null;record=null}}
    suspend fun backup(password:String):String=withContext(Dispatchers.Default){mutex.withLock {
        val current=requireNotNull(record){"Unlock your saved data first."}
        val wrapped=Core.obj("vault_wrap_key",json("key" to encode(requireNotNull(key)),"vaultId" to current.getJSONObject("envelope").getString("vaultId"),"password" to password,"salt" to encode(randomBytes(16)),"nonce" to encode(randomBytes(12))))
        authenticatedArchive(json("version" to 2,"envelope" to current.getJSONObject("envelope"),"wrappedKey" to wrapped)).toString()
    }}
    suspend fun restore(session:Long,archive:JSONObject,password:String,authenticate:suspend()->Unit,allowOlder:Boolean=false):JSONObject {
        authenticate()
        return withContext(Dispatchers.Default){mutex.withLock {
            val envelope=archive.getJSONObject("envelope");val wrapped=archive.getJSONObject("wrappedKey")
            check(envelope.getString("vaultId")==wrapped.getString("vaultId")){"Recovery key belongs to a different vault."}
            val recovered=decode(Core.call("vault_unwrap_key",json("wrappedKey" to wrapped,"password" to password)) as String)
            val temporary=(Core.call("session_create") as Number).toLong()
            try {
                Core.call("vault_record_verify",json("key" to encode(recovered),"record" to archive))
                Core.restorePersisted(temporary,recovered,envelope.toString()) // Validate all data before replacing disk or the active session.
                if(!allowOlder && record?.getJSONObject("envelope")?.getString("vaultId")==envelope.getString("vaultId")) check(envelope.getLong("revision")>=record!!.getJSONObject("envelope").getLong("revision")){"This backup is older than this device's saved data."}
                val replacement=json("version" to 2,"deviceKey" to protector.wrap(recovered,envelope.getString("vaultId")),"envelope" to envelope,"wrappedKey" to wrapped,"sync" to json("enabled" to false,"revision" to 0,"dirty" to false))
                val previous=key;key=recovered
                try{write(replacement)}catch(error:Exception){key=previous;throw error}
                previous?.fill(0)
                Core.restorePersisted(session,recovered,envelope.toString())
                Core.obj("session_customization",json("session" to session))
            } finally {if(key!==recovered)recovered.fill(0);Core.call("session_close",json("session" to temporary))}
        }}
    }
    suspend fun syncConfiguration():JSONObject?=mutex.withLock{record?.optJSONObject("sync")?.let{JSONObject(it.toString())}}
    suspend fun enableSync(wallet:String,password:String)=withContext(Dispatchers.Default){mutex.withLock {
        val current=JSONObject(requireNotNull(record){"Unlock your saved data first."}.toString())
        current.put("wrappedKey",Core.obj("vault_wrap_key",json("key" to encode(requireNotNull(key)),"vaultId" to current.getJSONObject("envelope").getString("vaultId"),"password" to password,"salt" to encode(randomBytes(16)),"nonce" to encode(randomBytes(12)))))
        current.put("sync",json("enabled" to true,"wallet" to wallet.lowercase(),"revision" to 0,"dirty" to true))
        write(current)
    }}
    private fun authenticatedArchive(value:JSONObject):JSONObject {value.put("mac",Core.call("vault_record_mac",json("key" to encode(requireNotNull(key)),"record" to value)));return value}
    suspend fun archive():JSONObject=mutex.withLock{val current=requireNotNull(record);JSONObject(authenticatedArchive(json("version" to 2,"envelope" to current.getJSONObject("envelope"),"wrappedKey" to current.getJSONObject("wrappedKey"))).toString())}
    suspend fun synced(revision:Long,uploadedRevision:Long)=withContext(Dispatchers.IO){mutex.withLock{val current=JSONObject(requireNotNull(record).toString());current.getJSONObject("sync").put("revision",revision).put("dirty",current.getJSONObject("envelope").getLong("revision")!=uploadedRevision);write(current)}}
    suspend fun enableExistingSync(wallet:String,revision:Long)=withContext(Dispatchers.IO){mutex.withLock{val current=JSONObject(requireNotNull(record).toString());current.put("sync",json("enabled" to true,"wallet" to wallet.lowercase(),"revision" to revision,"dirty" to false));write(current)}}
    suspend fun disableSync()=withContext(Dispatchers.IO){mutex.withLock{val current=JSONObject(requireNotNull(record).toString());current.getJSONObject("sync").put("enabled",false);write(current)}}
    suspend fun genotypeDigest():String?=mutex.withLock{record?.getJSONObject("envelope")?.optString("genotypeDigest")}
    suspend fun acceptCloud(session:Long,archive:JSONObject,revision:Long)=withContext(Dispatchers.Default){mutex.withLock{
        val current=JSONObject(requireNotNull(record).toString());val envelope=archive.getJSONObject("envelope")
        if(!envelope.has("genotype") && envelope.optString("genotypeDigest")==current.getJSONObject("envelope").optString("genotypeDigest"))envelope.put("genotype",current.getJSONObject("envelope").getJSONObject("genotype"))
        check(envelope.getString("vaultId")==current.getJSONObject("envelope").getString("vaultId")){"This cloud vault needs its recovery passphrase on this device."}
        check(envelope.getLong("revision")>=current.getJSONObject("envelope").getLong("revision")){"The cloud copy is older than this device. Restore it explicitly only if you intend to replace newer data."}
        val temporary=(Core.call("session_create") as Number).toLong()
        try {
            Core.call("vault_record_verify",json("key" to encode(requireNotNull(key)),"record" to archive))
            Core.restorePersisted(temporary,requireNotNull(key),envelope.toString())
            current.put("envelope",envelope).put("wrappedKey",archive.getJSONObject("wrappedKey"))
            current.getJSONObject("sync").put("revision",revision).put("dirty",false)
            write(current);Core.restorePersisted(session,requireNotNull(key),envelope.toString())
            Core.obj("session_customization",json("session" to session))
        } finally {Core.call("session_close",json("session" to temporary))}
    }}
}
