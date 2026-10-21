package com.monadicdna.explorer

import org.json.JSONArray
import org.json.JSONObject
import com.monadicdna.explorer.core.coreCall
import com.monadicdna.explorer.core.importGenotype as nativeImportGenotype

object Core {
    fun importGenotype(session: Long, bytes: ByteArray, name: String): JSONObject {
        val response=JSONObject(nativeImportGenotype(session.toULong(),bytes,name))
        check(response.getBoolean("ok")) { response.optString("error","File import failed") }
        return response.getJSONObject("value")
    }
    fun persistSession(session:Long,key:ByteArray,id:String,revision:Long,nonce:ByteArray,customization:String):JSONObject {
        val response=JSONObject(com.monadicdna.explorer.core.persistSession(session.toULong(),key,id,revision.toULong(),nonce,customization))
        check(response.getBoolean("ok")){response.optString("error","Unable to encrypt data")};return response.getJSONObject("value")
    }
    fun restorePersisted(session:Long,key:ByteArray,encrypted:String):JSONObject {
        val response=JSONObject(com.monadicdna.explorer.core.restorePersistedSession(session.toULong(),key,encrypted))
        check(response.getBoolean("ok")){response.optString("error","Unable to restore data")};return response.getJSONObject("value")
    }
    fun call(operation: String, input: Any? = null): Any? {
        val request = JSONObject().put("version", 1).put("operation", operation).put("input", input ?: JSONObject.NULL)
        val response = JSONObject(coreCall(request.toString()))
        check(response.getBoolean("ok")) { response.optString("error", "Shared core failed") }
        return response.opt("value").takeUnless { it == JSONObject.NULL }
    }
    fun obj(operation: String, input: Any? = null) = call(operation, input) as JSONObject
    fun arr(operation: String, input: Any? = null) = call(operation, input) as JSONArray
}

fun json(vararg values: Pair<String, Any?>) = JSONObject().apply { values.forEach { put(it.first, it.second ?: JSONObject.NULL) } }
fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
