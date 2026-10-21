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
class SecureDataVaultTest {
    @Test fun restartRecoveryTamperAndGenotypeReuse()=runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val dir=File(context.cacheDir,"vault-test-${System.nanoTime()}")
        val second=File(context.cacheDir,"vault-second-${System.nanoTime()}")
        val protector=TestVaultProtector()
        val s=(Core.call("session_create") as Number).toLong()
        val t=(Core.call("session_create") as Number).toLong()
        try {
            val vault=SecureDataVault(context,protector,dir)
            vault.unlock(s){}
            Core.call("session_import",json("session" to s,"content" to "# 23andMe\nrs1 1 100 AG","fileName" to "private.txt"))
            val custom=json("fields" to json("age" to "42"),"context" to "private context")
            vault.save(s,custom)
            vault.enableSync("0x"+"a".repeat(40),"unique recovery passphrase")
            val first=vault.archive();val genotype=first.getJSONObject("envelope").getJSONObject("genotype").toString()
            first.getJSONObject("envelope").remove("genotype") // Returned archive must be independent of saved record.
            assertTrue(vault.archive().getJSONObject("envelope").has("genotype"))
            vault.save(s,json("fields" to json("age" to "43"),"context" to "private context"))
            assertEquals(genotype,vault.archive().getJSONObject("envelope").getJSONObject("genotype").toString())
            val backup=JSONObject(vault.backup("unique recovery passphrase"))
            val raw=File(dir,"vault-v2.json").readText()
            assertFalse(raw.contains("private context"));assertFalse(raw.contains("private.txt"));assertFalse(raw.contains("rs1"))
            vault.lock()
            val restarted=SecureDataVault(context,protector,dir)
            assertEquals("43",restarted.unlock(t){}.getJSONObject("fields").getString("age"))
            assertEquals(1,Core.obj("session_metadata",json("session" to t)).getInt("count"))
            val recovered=SecureDataVault(context,TestVaultProtector(),second)
            var failed=false
            try{recovered.restore(t,backup,"incorrect recovery password",{})}catch(_:Exception){failed=true}
            assertTrue(failed);assertFalse(recovered.exists)
            assertEquals("43",recovered.restore(t,backup,"unique recovery passphrase",{}).getJSONObject("fields").getString("age"))
            recovered.save(t,json("fields" to json("age" to "44"),"context" to "remote update"))
            assertEquals("44",restarted.acceptCloud(s,recovered.archive(),2).getJSONObject("fields").getString("age"))
            recovered.save(t,json("fields" to json("age" to "45"),"context" to "remote update"))
            val delta=recovered.archive();delta.getJSONObject("envelope").remove("genotype")
            assertEquals("45",restarted.acceptCloud(s,delta,3).getJSONObject("fields").getString("age"))
            restarted.lock()
            val changed=JSONObject(raw);changed.getJSONObject("sync").put("revision",999)
            File(dir,"vault-v2.json").writeText(changed.toString())
            failed=false;try{restarted.unlock(t){}}catch(_:Exception){failed=true};assertTrue(failed)
            recovered.lock()
        } finally {Core.call("session_close",json("session" to s));Core.call("session_close",json("session" to t));dir.deleteRecursively();second.deleteRecursively()}
    }
}
