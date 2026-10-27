package com.monadicdna.explorer

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Simulator-only injected protector. Production always uses authenticated Android Keystore.
class TestVaultProtector:VaultKeyProtector {
    private val key=SecretKeySpec(randomBytes(32),"AES")
    override val description="Explicit test protector"
    override fun wrap(key:ByteArray,id:String):JSONObject {
        val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,this.key);c.updateAAD(id.toByteArray())
        return json("nonce" to encode(c.iv),"ciphertext" to encode(c.doFinal(key)))
    }
    override fun unwrap(value:JSONObject,id:String):ByteArray {
        val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,decode(value.getString("nonce"))));c.updateAAD(id.toByteArray());return c.doFinal(decode(value.getString("ciphertext")))
    }
    override fun delete(){}
}
/** An in-memory stand-in for Block Store, shared by two simulated devices. */
class TestSyncKeys: SyncKeyStore {
    var key: String? = null
    override suspend fun get() = key
    override suspend fun put(key: String) { this.key = key }
    override suspend fun delete() { key = null }
}
class SecureDataVaultTest {
    @Test fun storePersistsIsEncryptedRejectsOtherKeysAndDeletes()=runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val dir=File(context.cacheDir,"vault-test-${System.nanoTime()}")
        val protector=TestVaultProtector()
        val vault=SecureDataVault(context,protector,dir)
        assertFalse(vault.exists)
        var handle=vault.unlock{}.getLong("handle")
        assertTrue(vault.exists)
        Core.storeImportGenotype(handle,"# 23andMe\nrs1 1 100 AG\n".toByteArray(),"private.txt")
        Core.call("store_set_customization",json("store" to handle,"customization" to json("fields" to json("age" to "42"),"context" to "private context")))
        vault.lock(handle)
        // Nothing private is readable on disk.
        val raw=File(dir,"explorer.db").readBytes().toString(Charsets.ISO_8859_1)
        for(secret in listOf("private context","private.txt","SQLite format"))assertFalse(secret,raw.contains(secret))
        // A restarted app opens the same data with the same device key.
        handle=SecureDataVault(context,protector,dir).unlock{}.getLong("handle")
        assertEquals(1,Core.obj("store_metadata",json("store" to handle)).getInt("count"))
        assertEquals("42",Core.obj("store_customization",json("store" to handle)).getJSONObject("fields").getString("age"))
        vault.lock(handle)
        // Another device's key cannot open it.
        var failed=false
        try{SecureDataVault(context,TestVaultProtector(),dir).unlock{}}catch(_:Exception){failed=true}
        assertTrue(failed)
        vault.delete()
        assertFalse(vault.exists)
        assertFalse(File(dir,"explorer.db").exists())
        dir.deleteRecursively();Unit
    }
}
