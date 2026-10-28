package com.monadicdna.explorer

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A stored sync record: its name, revision and (when read) base64 ciphertext. */
data class CloudRecord(val record: String, val revision: Long, val ciphertext: String = "")

/**
 * Where a user's encrypted sync records live. Always the user's own cloud account (Google Drive app data
 * on Android); never the Monadic DNA backend. The core encrypts every record before it gets here.
 */
interface SyncCloud {
    suspend fun list(): List<CloudRecord>
    suspend fun read(records: List<String>): List<CloudRecord>
    /** Writes [record] if the cloud is still at [baseRevision]; returns the new revision or throws [SyncConflict]. */
    suspend fun write(record: String, baseRevision: Long, ciphertext: String): Long
    suspend fun deleteAll()
}
class SyncConflict: Exception("Another device changed this record; sync again")

/**
 * Google Drive's hidden app-data folder in the user's own Drive. Only this app can see it, and it counts
 * against the user's Drive storage. [token] returns an OAuth access token for the drive.appdata scope.
 */
class DriveSyncCloud(private val token: suspend () -> String): SyncCloud {
    private val http=OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(180,TimeUnit.SECONDS).build()
    private data class DriveFile(val id: String, val record: String, val revision: Long)
    private suspend fun call(request: Request.Builder): String = withContext(Dispatchers.IO) {
        http.newCall(request.header("Authorization","Bearer ${token()}").build()).execute().use {
            val body=it.body?.string().orEmpty()
            if(!it.isSuccessful) throw IOException(if(it.code==401||it.code==403)"Google Drive access was not granted" else "Google Drive request failed (HTTP ${it.code})")
            body
        }
    }
    private suspend fun files(): List<DriveFile> {
        val body=call(Request.Builder().url("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=100&fields=files(id,name,appProperties)"))
        val list=JSONObject(body).optJSONArray("files") ?: return emptyList()
        return (0 until list.length()).map{list.getJSONObject(it)}.mapNotNull{f->
            val name=f.optString("name").removeSuffix(".sync").takeIf{f.optString("name").endsWith(".sync")} ?: return@mapNotNull null
            DriveFile(f.getString("id"),name,f.optJSONObject("appProperties")?.optString("revision")?.toLongOrNull() ?: 0)
        }
    }
    override suspend fun list()=files().map{CloudRecord(it.record,it.revision)}
    override suspend fun read(records: List<String>)=files().filter{it.record in records}.map{
        CloudRecord(it.record,it.revision,call(Request.Builder().url("https://www.googleapis.com/drive/v3/files/${it.id}?alt=media")))
    }
    override suspend fun write(record: String, baseRevision: Long, ciphertext: String): Long {
        // Drive has no compare-and-set, so check the revision just before writing. A write racing another
        // device's is caught on the next sync, which merges both.
        val current=files().firstOrNull{it.record==record}
        if((current?.revision ?: 0)!=baseRevision) throw SyncConflict()
        val revision=baseRevision+1
        val metadata=JSONObject().put("appProperties",JSONObject().put("revision",revision.toString()))
        if(current==null) metadata.put("name","$record.sync").put("parents",org.json.JSONArray().put("appDataFolder"))
        val body=MultipartBody.Builder().setType("multipart/related".toMediaType())
            .addPart(metadata.toString().toRequestBody("application/json; charset=UTF-8".toMediaType()))
            .addPart(ciphertext.toRequestBody("text/plain".toMediaType())).build()
        val url=if(current==null)"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" else "https://www.googleapis.com/upload/drive/v3/files/${current.id}?uploadType=multipart"
        call(Request.Builder().url(url).method(if(current==null)"POST" else "PATCH",body))
        return revision
    }
    override suspend fun deleteAll() { for(f in files()) call(Request.Builder().url("https://www.googleapis.com/drive/v3/files/${f.id}").delete()) }
}
