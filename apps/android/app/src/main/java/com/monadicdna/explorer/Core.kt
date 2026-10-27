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
    private fun envelope(response: String, failure: String): JSONObject {
        val value=JSONObject(response)
        check(value.getBoolean("ok")) { value.optString("error",failure) }
        return value.getJSONObject("value")
    }
    fun catalogOpen(path: String)=envelope(com.monadicdna.explorer.core.catalogOpen(path),"Unable to open the research catalog")
    fun catalogAnalyzeNext(handle: Long, session: Long, maxRows: Int, now: String)=envelope(com.monadicdna.explorer.core.catalogAnalyzeNext(handle.toULong(),session.toULong(),maxRows.toUInt(),now),"Unable to analyze the research catalog")
    fun catalogClose(handle: Long)=com.monadicdna.explorer.core.catalogClose(handle.toULong())
    fun storeOpen(path: String, key: ByteArray)=envelope(com.monadicdna.explorer.core.storeOpen(path,key),"Unable to open saved data")
    fun storeClose(handle: Long)=com.monadicdna.explorer.core.storeClose(handle.toULong())
    fun storeImportGenotype(handle: Long, bytes: ByteArray, name: String)=envelope(com.monadicdna.explorer.core.storeImportGenotype(handle.toULong(),bytes,name),"File import failed")
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
