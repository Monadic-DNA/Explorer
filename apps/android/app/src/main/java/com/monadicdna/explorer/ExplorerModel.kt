package com.monadicdna.explorer

import android.app.Application
import android.net.Uri
import android.util.Base64
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ExplorerModel(app: Application) : AndroidViewModel(app) {
    val store = DeviceStore(app)
    var session = (Core.call("session_create") as Number).toLong()
        private set
    var backend by mutableStateOf(store.get("backend").ifBlank { "https://explorer.monadicdna.com" })
    var provider by mutableStateOf(store.get("provider").ifBlank { "nilai" })
    var model by mutableStateOf(store.get("model").ifBlank { "gemma-4-26B-A4B-it" })
    var apiKey by mutableStateOf(store.get("api-key-$provider"))
    var ollamaAddress by mutableStateOf(store.get("ollama-address").ifBlank { "localhost" })
    var ollamaPort by mutableStateOf(store.get("ollama-port").ifBlank { "11434" })
    var profile by mutableStateOf(store.get("profile"))
    val profileSchema = Core.arr("profile_schema").objects()
    val profileFields = mutableStateMapOf<String,String>().apply {
        val saved=store.get("profile-fields").ifBlank { "{}" };val fields=JSONObject(saved)
        profileSchema.forEach { put(it.getString("key"),fields.optString(it.getString("key"))) }
    }
    private fun profileData() = Core.obj("parse_profile",JSONObject(profileFields.toMap()))
    var wallet by mutableStateOf(store.get("wallet"))
    var metadata by mutableStateOf(JSONObject())
    var studies by mutableStateOf(emptyList<JSONObject>())
    var traits by mutableStateOf(emptyList<String>())
    var results by mutableStateOf(emptyList<JSONObject>())
    var selectedStudy by mutableStateOf<JSONObject?>(null)
    var subscription by mutableStateOf<JSONObject?>(null)
    var busy by mutableStateOf(false)
    var status by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var report by mutableStateOf("")
    var reportTitle by mutableStateOf("")
    var reportQuestions by mutableStateOf(emptyList<String>())
    var shareResultsWithLLM by mutableStateOf(false)
    var acceptedDisclaimer by mutableStateOf(false)
    val messages = mutableStateListOf<Pair<String, String>>()
    private val http = OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(180,TimeUnit.SECONDS).build()
    private var task: Job? = null

    fun run(label: String, block: suspend () -> Unit) {
        if (busy) return
        task = viewModelScope.launch {
            busy=true; status=label; error=null
            try { block(); status="Complete" }
            catch (cancelled: CancellationException) { status="Cancelled"; throw cancelled }
            catch (e: Exception) { error=e.message ?: "Operation failed" }
            finally { busy=false }
        }
    }
    fun cancel() { task?.cancel() }
    private fun checkedBackend(): String {
        val uri=Uri.parse(backend)
        require(uri.scheme=="https" || (BuildConfig.DEBUG && uri.scheme=="http" && uri.host in listOf("localhost","127.0.0.1","10.0.2.2"))) { "Use an HTTPS backend (debug builds also allow the local emulator host)." }
        require(uri.userInfo==null && uri.query==null && uri.fragment==null) { "Backend must be an origin without credentials, query or fragment." }
        return backend.trimEnd('/')
    }
    suspend fun api(path: String, body: JSONObject? = null): JSONObject {
        val origin=checkedBackend()
        return request(origin+path,body,store.get("auth-token"))
    }
    private suspend fun request(url: String, body: JSONObject?, bearer: String = "", origin: String? = null): JSONObject = suspendCancellableCoroutine { continuation ->
        val builder=Request.Builder().url(url).header("Accept","application/json")
        if (bearer.isNotEmpty()) builder.header("Authorization","Bearer $bearer")
        if (origin!=null) builder.header("Origin",origin)
        if (body!=null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        val call=http.newCall(builder.build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object: Callback {
            override fun onFailure(call: Call, exception: IOException) { if(continuation.isActive) continuation.resumeWithException(exception) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val data=response.use {
                        if(!it.isSuccessful) throw IllegalStateException("Request failed (HTTP ${it.code}). Check connection, sign-in and provider settings.")
                        JSONObject(it.body?.string().orEmpty())
                    }
                    if(continuation.isActive) continuation.resume(data)
                } catch(exception: Exception) { if(continuation.isActive) continuation.resumeWithException(exception) }
            }
        })
    }
    fun settingsSaved() {
        checkedBackend()
        profileData()
        store.put("profile-fields",JSONObject(profileFields.toMap()).toString())
        listOf("backend" to backend,"provider" to provider,"model" to model,"api-key-$provider" to apiKey,"ollama-address" to ollamaAddress,"ollama-port" to ollamaPort,"profile" to profile).forEach{store.put(it.first,it.second)}
    }
    fun selectProvider(next: String) { try { store.put("api-key-$provider",apiKey);provider=next;apiKey=store.get("api-key-$next") } catch(e:Exception){error="Unable to switch secure provider settings"} }
    fun browse(query: String, trait: String, semantic: Boolean, offset: Int = 0) = run("Loading studies") {
        val params=Uri.Builder().appendQueryParameter("search",query).appendQueryParameter("searchMode",if(semantic)"similarity" else "exact").appendQueryParameter("trait",trait).appendQueryParameter("offset",offset.toString()).appendQueryParameter("limit","50").build().encodedQuery
        val response=api("/api/studies?$params")
        studies=response.getJSONArray("data").objects()
        if(traits.isEmpty()) { val list=api("/api/traits").getJSONArray("traits");traits=(0 until list.length()).map(list::getString) }
    }
    fun showStudy(study: JSONObject) { selectedStudy=study }
    fun loadStudy(id: Int) = run("Loading study") { selectedStudy=api("/api/studies?id=$id").getJSONArray("data").objects().firstOrNull() }
    fun importGenotype(bytes: ByteArray, name: String) = run("Reading DNA locally") { importGenotypeData(bytes, name) }
    suspend fun importGenotypeData(bytes: ByteArray, name: String) {
        require(acceptedDisclaimer) { "Accept the educational-use disclaimer before importing DNA." }
        val importSession=session
        metadata=withContext(Dispatchers.Default) { Core.importGenotype(importSession,bytes,name) }
        results=emptyList()
    }
    suspend fun refreshResults() { results=withContext(Dispatchers.Default) { Core.arr("session_results",json("session" to session)).objects() } }
    fun analyze(study: JSONObject) = run("Analyzing on device") {
        require(metadata.optInt("count")>0) { "Import your DNA first." }
        withContext(Dispatchers.Default) { Core.arr("session_analyze",json("session" to session,"studies" to JSONArray().put(study),"now" to Instant.now().toString())) }
        refreshResults()
        if(results.none { it.optInt("studyId")==study.optInt("id") }) status="No matching called risk variant in this study"
    }
    fun runAll() = run("Analyzing catalog on device") {
        require(metadata.optInt("count")>0) { "Import your DNA first." }
        var offset=0
        while(true) {
            ensureActiveTask()
            val page=api("/api/studies?fetchAll=true&searchMode=exact&excludeLowQuality=false&excludeMissingGenotype=false&limit=1000&offset=$offset")
            val batch=page.getJSONArray("data")
            if(batch.length()==0)break
            withContext(Dispatchers.Default){ Core.call("session_analyze",json("session" to session,"studies" to batch,"strict" to true,"now" to Instant.now().toString())) }
            offset+=1000;status="Analyzed up to $offset catalog records"
            if(batch.length()<1000)break
        }
        refreshResults()
    }
    private suspend fun ensureActiveTask() { currentCoroutineContext().ensureActive() }
    fun clear() { task?.cancel();Core.call("session_close",json("session" to session));session=(Core.call("session_create") as Number).toLong();metadata=JSONObject();results=emptyList();messages.clear();report="";reportQuestions=emptyList() }
    fun exportResults(): String = Core.call("session_export",json("session" to session)) as String
    fun importResults(content: String, name: String) = run("Importing results") { importResultsData(content, name) }
    suspend fun importResultsData(content: String, name: String) { withContext(Dispatchers.Default){Core.call("session_import_results",json("session" to session,"content" to content,"fileName" to name,"now" to Instant.now().toString()))};refreshResults() }
    suspend fun sealedVault(password: String): String = withContext(Dispatchers.Default) {
        require(password.length>=8) { "Use a passphrase with at least eight characters." }
        val snapshot=Core.call("session_snapshot",json("session" to session)) as String
        Core.obj("seal",json("plaintext" to snapshot,"password" to password,"salt" to DeviceStore.entropy(16),"iv" to DeviceStore.entropy(12),"iterations" to 600000)).toString()
    }
    fun saveVault(password: String) = run("Encrypting vault") { val encrypted=sealedVault(password);withContext(Dispatchers.IO){getApplication<Application>().openFileOutput("vault.json",0).use{it.write(encrypted.toByteArray())}} }
    fun openVault(password: String, imported: String? = null) = run("Unlocking vault") { openVaultData(password, imported) }
    suspend fun openVaultData(password: String, imported: String? = null) {
        val encrypted=imported ?: withContext(Dispatchers.IO){getApplication<Application>().openFileInput("vault.json").bufferedReader().use{it.readText()}}
        metadata=withContext(Dispatchers.Default){
            val input=JSONObject(encrypted).put("password",password)
            val snapshot=Core.call("open",input) as String
            Core.obj("session_restore",json("session" to session,"snapshot" to snapshot))
        };refreshResults()
    }
    fun deleteVault(){getApplication<Application>().deleteFile("vault.json");clear()}
    fun beginAuth(): String {
        val pair=Core.obj("auth_keypair",json("entropy" to DeviceStore.entropy(32)))
        val state=DeviceStore.entropy(32).replace("+","-").replace("/","_").trimEnd('=')
        store.put("pending-auth",json("privateKey" to pair.getString("privateKey"),"state" to state,"expires" to (System.currentTimeMillis()+300000)).toString())
        return Uri.parse(checkedBackend()+"/mobile-auth").buildUpon().appendQueryParameter("state",state).appendQueryParameter("publicKey",pair.getString("publicKey")).build().toString()
    }
    fun receiveAuth(uri: Uri) = run("Completing sign-in") {
        require(uri.scheme=="monadicexplorer"&&uri.host=="auth") { "Invalid sign-in callback" }
        val pending=JSONObject(store.get("pending-auth"))
        require(pending.getLong("expires")>=System.currentTimeMillis()&&uri.getQueryParameter("state")==pending.getString("state")) { "Sign-in expired or state did not match" }
        val encoded=Uri.parse("https://callback/?"+uri.fragment.orEmpty()).getQueryParameter("payload") ?: kotlin.error("Missing encrypted sign-in response")
        val sealed=JSONObject(Base64.decode(encoded,Base64.URL_SAFE or Base64.NO_WRAP).toString(Charsets.UTF_8))
        sealed.put("privateKey",pending.getString("privateKey")).put("state",pending.getString("state"))
        val auth=JSONObject(Core.call("auth_open",sealed) as String)
        require(auth.getLong("expiresAt")>=System.currentTimeMillis()&&Regex("^0x[a-fA-F0-9]{40}$").matches(auth.getString("walletAddress"))) { "Invalid or expired sign-in response" }
        store.put("auth-token",auth.getString("token"));wallet=auth.getString("walletAddress");store.put("wallet",wallet);store.remove("pending-auth")
        subscription=api("/api/check-subscription",json("walletAddress" to wallet))
    }
    val billing = PlayBilling(app, viewModelScope, { wallet }, { path, body -> api(path,body) }, ::refreshSubscription)
    override fun onCleared() { billing.close(); Core.call("session_close",json("session" to session)); super.onCleared() }
    fun signOut(){store.remove("auth-token");store.remove("wallet");store.remove("pending-auth");wallet="";subscription=null}
    fun refreshSubscription() = run("Checking subscription") { require(wallet.isNotBlank()){ "Sign in first" };subscription=api("/api/check-subscription",json("walletAddress" to wallet)) }
    private suspend fun requireAccess(kind: String) {
        var access=Core.obj("feature_access",json("kind" to kind))
        if(access.getBoolean("allowed"))return
        require(wallet.isNotBlank()){ "Sign in to your Explorer account first." }
        subscription=api("/api/check-subscription",json("walletAddress" to wallet))
        access=Core.obj("feature_access",json("kind" to kind,"activeSubscription" to subscription?.optJSONObject("subscription")?.optBoolean("isActive")))
        if(access.getBoolean("allowed"))return
        require(!access.isNull("reportType")){ "An active subscription is required for chat." }
        val type=access.getString("reportType")
        val passes=api("/api/report-access",json("walletAddress" to wallet))
        require(passes.getJSONObject("availableReports").optInt(type)>0){ "Purchase a subscription or report pass in Account, then try again." }
        api("/api/report-access",json("walletAddress" to wallet,"reportType" to type,"action" to "consume"))
    }
    private fun llmConfig()=json("provider" to provider,"model" to model,"huggingfaceApiKey" to apiKey,"ollamaAddress" to ollamaAddress,"ollamaPort" to (ollamaPort.toIntOrNull()?:11434))
    private suspend fun nilaiAuthorization(endpoint: String): String {
        val serverKey=withContext(Dispatchers.IO){
            http.newCall(Request.Builder().url("$endpoint/public_key").build()).execute().use{response->
                check(response.isSuccessful){"Unable to retrieve nilAI public key"};response.body!!.string().trim()
            }
        }
        val pair=if(apiKey.isNotBlank())json("privateKey" to apiKey)else Core.obj("nilai_keypair",json("entropy" to DeviceStore.entropy(32)))
        val input=json("privateKey" to pair.getString("privateKey"),"serverKey" to serverKey,"nonce" to DeviceStore.entropy(16),"rootNonce" to DeviceStore.entropy(16),"now" to (System.currentTimeMillis()/1000))
        if(apiKey.isBlank()){
            // As on the web, the backend delegates one use to a fresh device key.
            // Only the public key visits the backend; genetic prompts go directly to nilAI.
            val response=api("/api/nilai-delegation",json("delegationRequest" to json("public_key" to pair.getString("publicKey"))))
            input.put("delegation",response.getJSONObject("delegationToken").getString("delegation_token"))
        }
        return Core.call("nilai_invocation",input) as String
    }
    private suspend fun complete(messages: JSONArray): String {
        val config=Core.obj("llm_config",llmConfig());val endpoint=config.getString("endpoint").trimEnd('/')
        if(provider=="huggingface")require(apiKey.isNotBlank()){"Enter your provider API key in Settings. Keys stay on this device."}
        if(provider=="ollama"){
            val data=request("$endpoint/api/chat",json("model" to config.getString("identifier"),"messages" to messages,"stream" to false))
            return data.getJSONObject("message").getString("content")
        }
        val bearer=if(provider=="nilai")nilaiAuthorization(endpoint)else apiKey
        val response=request("$endpoint/chat/completions",json("model" to config.getString("identifier"),"messages" to messages,"stream" to false),bearer)
        return response.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
    }
    fun sendChat(message: String) = run("Asking selected provider") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(message.isNotBlank()){"Enter a message"}
        requireAccess("Chat")
        val prompt=Core.obj("report_prompt",json("kind" to "DNA chat","results" to JSONArray(results),"customization" to profileData(),"context" to profile)).getJSONArray("messages")
        messages.forEach{prompt.put(json("role" to it.first,"content" to it.second))};prompt.put(json("role" to "user","content" to message))
        val reply=complete(prompt);messages.add("user" to message);messages.add("assistant" to reply)
    }
    fun generateReport(kind: String) = run("Generating $kind report") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(results.isNotEmpty()){ "Analyze studies or import results first" }
        requireAccess(kind)
        if(kind!="Overview") {
            val prompt=Core.obj("report_prompt",json("kind" to kind,"results" to JSONArray(results),"customization" to profileData(),"context" to profile)).getJSONArray("messages")
            val parsed=Core.obj("extract_report",complete(prompt))
            reportTitle=kind;report=parsed.getString("report")
            reportQuestions=(0 until parsed.getJSONArray("questions").length()).map{parsed.getJSONArray("questions").getString(it)}
            return@run
        }
        val groups=Core.arr("partition_results",json("results" to JSONArray(results),"groups" to ((results.size+249)/250)))
        val summaries=mutableListOf<String>()
        val userContext=(Core.call("user_context",profileData()) as String)+"\n"+profile
        for(i in 0 until groups.length()){
            ensureActiveTask();status="Analyzing report group ${i+1}/${groups.length()}"
            val batch=groups.getJSONArray(i)
            val prompt=Core.call("render_prompt",json("name" to "generateMapPrompt","values" to json("groupNumber" to (i+1),"totalGroups" to groups.length(),"resultsInGroup" to batch.length(),"totalResults" to results.size,"compactResults" to Core.call("format_results",batch),"userContext" to userContext))) as String
            summaries.add(complete(JSONArray().put(json("role" to "user","content" to prompt))))
        }
        reportTitle=kind
        val reduce=Core.call("render_prompt",json("name" to "generateReducePrompt","values" to json("groupSummaries" to JSONArray(summaries),"userContext" to userContext))) as String
        report=complete(JSONArray().put(json("role" to "user","content" to reduce)))
    }

}
