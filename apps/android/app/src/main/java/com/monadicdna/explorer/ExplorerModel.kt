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

class ExplorerModel @JvmOverloads constructor(app: Application, val dataVault:SecureDataVault=SecureDataVault(app), private val syncKeys:SyncKeyStore=BlockStoreSyncKeys(app)) : AndroidViewModel(app) {
    val store = DeviceStore(app)
    /** Handle of the open encrypted store (docs/native-data-store.md); null while locked. */
    var storeHandle: Long? = null
        private set
    var backend by mutableStateOf(store.get("backend").ifBlank { "https://explorer.monadicdna.com" })
    var provider by mutableStateOf(store.get("provider").ifBlank { "nilai" })
    var model by mutableStateOf(store.get("model").ifBlank { "gemma-4-26B-A4B-it" })
    var apiKey by mutableStateOf(store.get("api-key-$provider"))
    var ollamaAddress by mutableStateOf(store.get("ollama-address").ifBlank { "localhost" })
    var ollamaPort by mutableStateOf(store.get("ollama-port").ifBlank { "11434" })
    var profile by mutableStateOf("")
    val profileSchema = Core.arr("profile_schema").objects()
    val profileFields = mutableStateMapOf<String,String>().apply {
        profileSchema.forEach { put(it.getString("key"),"") }
    }
    private fun profileData() = Core.obj("parse_profile",JSONObject(profileFields.toMap()))
    var wallet by mutableStateOf(store.get("wallet"))
    var metadata by mutableStateOf(JSONObject())
    var studies by mutableStateOf(emptyList<JSONObject>())
    var traits by mutableStateOf(emptyList<String>())
    // Results stay in the encrypted store; screens page through them with resultsPage.
    var resultCount by mutableIntStateOf(0)
        private set
    /** Changes whenever the stored results change, so screens reload their pages. */
    var resultsVersion by mutableIntStateOf(0)
        private set
    var selectedStudy by mutableStateOf<JSONObject?>(null)
    var subscription by mutableStateOf<JSONObject?>(null)
    var busy by mutableStateOf(false)
    var status by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var progress by mutableStateOf<Float?>(null)
        private set
    // Set while an in-app document picker is open so its activity does not lock the vault.
    var pickingFile=false
    var report by mutableStateOf("")
    var reportTitle by mutableStateOf("")
    var reportQuestions by mutableStateOf(emptyList<String>())
    var shareResultsWithLLM by mutableStateOf(false)
    /** A question started on Home that the Chat tab picks up. */
    var chatDraft by mutableStateOf("")
    var personalizeSkipped by mutableStateOf(store.get("personalize-skipped")=="true")
        private set
    fun skipPersonalization(){store.put("personalize-skipped","true");personalizeSkipped=true}
    val personalized get()=profile.isNotBlank()||profileFields.values.any{it.isNotBlank()}
    var acceptedDisclaimer by mutableStateOf(false)
    val messages = mutableStateListOf<Pair<String, String>>()
    private val http = OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(180,TimeUnit.SECONDS).build()
    private var task: Job? = null
    var authenticate:(suspend()->Unit)?=null
    var dataUnlocked by mutableStateOf(false)
        private set
    var storageMessage by mutableStateOf("Your saved data is locked.")
        private set
    var syncEnabled by mutableStateOf(false)
        private set
    var syncing by mutableStateOf(false)
        private set
    var syncMessage by mutableStateOf("")
        private set
    /** Why a new device couldn't restore this user's data yet, for example no Google account. Separate from sync errors. */
    var restoreWarning by mutableStateOf("")
        private set
    /** This device has no saved data, but Block Store holds this user's sync key: their data can be restored. */
    var restorable by mutableStateOf(false)
        private set
    private var lockJob:Job?=null
    private var syncJob:Job?=null
    private var syncAgain=false
    private var customizationJob:Job?=null
    private var loadingCustomization=false
    var locking by mutableStateOf(false)
        private set
    init {
        viewModelScope.launch {
            snapshotFlow { profile to profileFields.toMap() }.collect { if(dataUnlocked && !loadingCustomization) saveCustomizationSoon() }
        }
        viewModelScope.launch { if(!dataVault.exists) restorable=runCatching{syncKeys.get()!=null}.getOrDefault(false) }
    }
    private fun handle()=requireNotNull(storeHandle){"Unlock your saved data first."}
    private fun storeInput(vararg values: Pair<String,Any?>)=json("store" to handle(),*values)
    private fun restoreCustomization(value:JSONObject) {
        loadingCustomization=true
        profile=value.optString("context")
        val fields=value.optJSONObject("fields") ?: JSONObject()
        profileFields.clear();profileSchema.forEach{field->profileFields[field.getString("key")]=fields.optString(field.getString("key"))}
        loadingCustomization=false
    }
    // Personalization edits are written shortly after typing stops; only changed fields are stamped for sync.
    private fun saveCustomizationSoon() {
        customizationJob?.cancel()
        customizationJob=viewModelScope.launch { delay(500); saveCustomization() }
    }
    private suspend fun saveCustomization() {
        if(!dataUnlocked)return
        val changed=withContext(Dispatchers.Default){Core.call("store_set_customization",storeInput("customization" to json("fields" to JSONObject(profileFields.toMap()),"context" to profile)))}==true
        if(changed)queueSync()
    }
    suspend fun unlockData() {
        lockJob?.join()
        if(dataUnlocked)return
        val opened=dataVault.unlock{requireNotNull(authenticate){"Open the app to unlock your saved data."}.invoke()}
        storeHandle=opened.getLong("handle");metadata=opened.getJSONObject("metadata")
        restoreCustomization(Core.obj("store_customization",storeInput()))
        refreshResults()
        dataUnlocked=true;restorable=false;storageMessage="Saved securely on this device"
        setUpSync()
    }
    fun unlockSavedData()=run("Unlocking saved data"){unlockData()}
    private fun wipeMemory() {
        storeHandle=null
        metadata=JSONObject();resultCount=0;resultsVersion++;messages.clear();report="";reportQuestions=emptyList();selectedStudy=null
        restoreCustomization(JSONObject());dataUnlocked=false;syncEnabled=false
    }
    fun lockData() {
        if(lockJob?.isActive==true)return
        val running=task
        locking=true
        lockJob=viewModelScope.launch {
            running?.cancelAndJoin();syncJob?.cancelAndJoin()
            customizationJob?.cancelAndJoin();runCatching{saveCustomization()}
            storeHandle?.let{dataVault.lock(it)};wipeMemory();storageMessage="Your saved data is locked.";locking=false
        }
    }
    fun backgroundLock(){if(dataUnlocked&&!pickingFile)lockData()}

    // Sync (docs/native-data-store.md): on by default, end-to-end encrypted, same-platform for now.
    private suspend fun setUpSync() {
        if(Core.obj("store_sync_status",storeInput()).optBoolean("enabled")){syncEnabled=true;queueSync();return}
        if(store.get("sync-off")=="true")return
        // Reuse this user's key from Block Store (a new device restoring) or create one for this account.
        val existing=runCatching{syncKeys.get()}.getOrNull()
        val enabled=Core.obj("store_sync_enable",storeInput("syncKey" to existing))
        restoreWarning=if(existing==null)runCatching{syncKeys.put(enabled.getString("syncKey"))}.exceptionOrNull()?.let{"A new phone can't restore your data yet. ${it.message}"}.orEmpty() else ""
        syncEnabled=true;queueSync()
    }
    fun setSync(on: Boolean)=run(if(on)"Turning on sync" else "Turning off sync and deleting the cloud copy"){
        unlockData()
        if(on){store.remove("sync-off");setUpSync();return@run}
        syncJob?.cancelAndJoin()
        if(syncEnabled)syncRequest(json("action" to "delete"))
        Core.call("store_sync_disable",storeInput());runCatching{syncKeys.delete()}
        store.put("sync-off","true");syncEnabled=false;syncMessage="";notice="Sync is off and the cloud copy is deleted. Your data stays on this device."
    }
    private fun queueSync() {
        if(!syncEnabled || !dataUnlocked || locking)return
        if(syncJob?.isActive==true){syncAgain=true;return}
        syncJob=viewModelScope.launch {
            var delayMs=2000L
            while(isActive) {
                while(busy)delay(200)
                syncing=true
                try{do{syncAgain=false;syncOnce()}while(syncAgain);syncMessage="";break}
                catch(e:CancellationException){throw e}
                catch(e:Exception){syncMessage="Sync will retry: ${e.message ?: "connection problem"}"}
                finally{syncing=false}
                delay(delayMs);delayMs=(delayMs*2).coerceAtMost(300000)
            }
            // Synced results that don't match this device's catalog are recomputed here.
            if(dataUnlocked && !busy && Core.call("store_needs_match",storeInput("catalogVersion" to catalogInfo?.optString("version")))==true)runAll()
        }
    }
    private class SyncConflict: Exception()
    private suspend fun syncOnce() {
        val catalogVersion=catalogInfo?.optString("version")
        repeat(3) {
            // Pull first: a write must be based on the server's current revision.
            val list=syncRequest(json("action" to "list")).getJSONArray("records")
            val wanted=Core.arr("store_sync_wanted",storeInput("records" to list))
            if(wanted.length()>0){
                var changed=false
                for(record in syncRequest(json("action" to "read","records" to wanted)).getJSONArray("records").objects()){
                    val applied=withContext(Dispatchers.Default){Core.obj("store_sync_apply",storeInput("record" to record.getString("record"),"revision" to record.getLong("revision"),"ciphertext" to record.getString("ciphertext"),"catalogVersion" to catalogVersion))}
                    if(applied.optBoolean("changed"))changed=true
                    if(applied.optBoolean("replacedLocal"))notice="Your DNA file was replaced by one imported on another device."
                }
                if(changed){metadata=Core.obj("store_metadata",storeInput());restoreCustomization(Core.obj("store_customization",storeInput()));refreshResults()}
            }
            var conflict=false
            for(out in withContext(Dispatchers.Default){Core.arr("store_sync_outgoing",storeInput())}.objects()){
                try {
                    val revision=syncRequest(json("action" to "write","record" to out.getString("record"),"baseRevision" to out.getLong("baseRevision"),"ciphertext" to out.getString("ciphertext"))).getLong("revision")
                    Core.call("store_sync_pushed",storeInput("record" to out.getString("record"),"revision" to revision,"version" to out.getLong("version"),"hash" to out.getString("hash")))
                } catch(_:SyncConflict){conflict=true}
            }
            if(!conflict)return
        }
        error("Another device keeps changing your data; sync will retry")
    }
    /** Signs the exact request body with the account key; the server checks it before reading the body. */
    private suspend fun syncRequest(body: JSONObject): JSONObject {
        val text=body.toString()
        val signed=Core.obj("store_sync_sign",storeInput("body" to text))
        val request=Request.Builder().url(checkedBackend()+"/api/vault-sync").header("Accept","application/json")
            .header("X-Sync-Account",signed.getString("account")).header("X-Sync-Public-Key",signed.getString("publicKey"))
            .header("X-Sync-Timestamp",signed.getString("timestamp")).header("X-Sync-Nonce",signed.getString("nonce")).header("X-Sync-Signature",signed.getString("signature"))
            .post(text.toRequestBody("application/json".toMediaType())).build()
        return suspendCancellableCoroutine { continuation ->
            val call=http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object: Callback {
                override fun onFailure(call: Call, exception: IOException) { if(continuation.isActive) continuation.resumeWithException(exception) }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val data=response.use { val payload=runCatching{JSONObject(it.body?.string().orEmpty())}.getOrDefault(JSONObject())
                            if(it.code==409) throw SyncConflict()
                            if(!it.isSuccessful) throw IllegalStateException(payload.optString("error","Sync failed (HTTP ${it.code})"))
                            payload }
                        if(continuation.isActive) continuation.resume(data)
                    } catch(exception: Exception) { if(continuation.isActive) continuation.resumeWithException(exception) }
                }
            })
        }
    }

    fun run(label: String, block: suspend () -> Unit) {
        if (busy) return
        task = viewModelScope.launch {
            busy=true; status=label; error=null; notice=null; progress=null
            // Every change is already written to the encrypted store, so nothing remains to save afterwards.
            try { block(); status="Complete" }
            catch (cancelled: CancellationException) { status="Cancelled"; throw cancelled }
            catch (e: Exception) { error=e.message ?: "Operation failed" }
            finally { busy=false; progress=null }
        }
    }
    fun cancel() { task?.cancel() }
    val cancellable get()=task?.isActive==true&&!status.startsWith("Cancelled")
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
        listOf("backend" to backend,"provider" to provider,"model" to model,"api-key-$provider" to apiKey,"ollama-address" to ollamaAddress,"ollama-port" to ollamaPort).forEach{store.put(it.first,it.second)}
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
        unlockData()
        val opened=handle()
        metadata=withContext(Dispatchers.Default) { Core.storeImportGenotype(opened,bytes,name) }
        resultCount=0;resultsVersion++
        val format=formatNames[metadata.optString("detectedFormat")]?.let{" from $it"}.orEmpty()
        // Matching the bundled catalog takes seconds, so it follows the import directly.
        val matches=runAllData()
        // Sync is on by default; say so once.
        val explain=syncEnabled && store.get("sync-explained")!="true"
        if(explain)store.put("sync-explained","true")
        notice="Imported ${metadata.optInt("count").grouped()} variants$format and found ${matches.grouped()} research matches."+
            if(explain)" An end-to-end encrypted copy is kept so a new device fills in automatically. You can turn this off in Vault." else ""
    }
    suspend fun refreshResults() { resultCount=(Core.call("store_result_count",storeInput()) as Number).toInt();resultsVersion++ }
    suspend fun resultsPage(filter: String, direction: String, sort: String, offset: Int, limit: Int=100): JSONObject=withContext(Dispatchers.Default){
        // Screens can ask while locked; there is nothing to show until the store is open.
        if(storeHandle==null) json("total" to 0,"count" to 0,"rows" to JSONArray())
        else Core.obj("store_results_page",storeInput("filter" to filter,"direction" to direction,"sort" to sort,"offset" to offset,"limit" to limit))
    }
    fun resultFor(studyId: Int): JSONObject?=storeHandle?.let{Core.call("store_result",storeInput("studyId" to studyId)) as JSONObject?}
    fun analyze(study: JSONObject) = run("Analyzing on device") {
        require(dataUnlocked && metadata.optInt("count")>0) { "Unlock or import your DNA first." }
        withContext(Dispatchers.Default) { Core.arr("store_analyze",storeInput("studies" to JSONArray().put(study),"now" to Instant.now().toString())) }
        refreshResults();queueSync()
        notice=if(resultFor(study.optInt("id"))==null) "Your DNA has no called genotype for this study's risk variant." else "Match saved to Results."
    }
    /** The catalog snapshot bundled with this release, from assets/catalog.json. */
    val catalogInfo: JSONObject? = runCatching{JSONObject(app.assets.open("catalog.json").bufferedReader().use{it.readText()})}.getOrNull()
    fun runAll() = run("Opening the research catalog") {
        val started=System.currentTimeMillis()
        val matches=runAllData()
        val elapsed=(System.currentTimeMillis()-started)/1000
        notice="Run all finished in ${elapsed/60}:${"%02d".format(elapsed%60)} and saved ${matches.grouped()} matches from research catalog ${catalogInfo?.optString("version").orEmpty()}."
    }
    /** Matches the bundled catalog into the store and returns the number of saved matches. */
    private suspend fun runAllData(): Int {
        require(dataUnlocked && metadata.optInt("count")>0) { "Unlock or import your DNA first." }
        val now=Instant.now().toString()
        val started=System.currentTimeMillis();var refreshed=started
        val timing=RunTiming()
        val opened=handle()
        val catalog=withContext(Dispatchers.Default){Core.catalogOpen(catalogFile().path)}
        val catalogHandle=catalog.getLong("handle");val total=catalog.getInt("rows")
        var processed=0
        try {
            while(true) {
                ensureActiveTask()
                val mark=System.nanoTime()
                val chunk=withContext(Dispatchers.Default){Core.catalogAnalyzeNext(catalogHandle,opened,CATALOG_CHUNK,now)}
                timing.core+=System.nanoTime()-mark
                processed+=chunk.getInt("rows");resultCount=chunk.getInt("saved")
                val elapsed=(System.currentTimeMillis()-started)/1000
                progress=if(total>0)processed.toFloat()/total else null
                status="Analyzed ${processed.grouped()} of ${total.grouped()} studies (${if(total>0)processed*100/total else 0}%) • ${chunk.getInt("saved").grouped()} matches • ${elapsed/60}:${"%02d".format(elapsed%60)} elapsed"
                if(BuildConfig.DEBUG)android.util.Log.d("RunAll",timing.line(processed,System.currentTimeMillis()-started))
                // Matches appear while the run continues; the core drops stale results when a run completes.
                if(System.currentTimeMillis()-refreshed>3000){resultsVersion++;refreshed=System.currentTimeMillis()}
                if(chunk.getBoolean("done"))break
            }
        } finally { Core.catalogClose(catalogHandle) }
        refreshResults();queueSync()
        return resultCount
    }
    private suspend fun ensureActiveTask() { currentCoroutineContext().ensureActive() }
    // Rust streams the snapshot from a real file, so the asset is copied out of the APK once per catalog version.
    private suspend fun catalogFile()=withContext(Dispatchers.IO){
        val app=getApplication<Application>()
        val dir=java.io.File(app.noBackupFilesDir,"catalog").apply{mkdirs()}
        val file=java.io.File(dir,"${catalogInfo?.optString("version")?:"bundled"}.zst")
        if(!file.exists()){
            val part=java.io.File(dir,file.name+".part")
            app.assets.open("catalog.zst").use{input->part.outputStream().use{input.copyTo(it)}}
            check(part.renameTo(file)){"Unable to prepare the research catalog."}
        }
        dir.listFiles()?.filter{it!=file}?.forEach{it.delete()}
        file
    }
    fun clear(){lockData()}
    fun exportResults(): String = Core.call("store_export",storeInput()) as String
    fun importResults(content: String, name: String) = run("Importing results") { importResultsData(content, name) }
    suspend fun importResultsData(content: String, name: String) {
        unlockData()
        withContext(Dispatchers.Default){Core.call("store_import_results",storeInput("content" to content,"fileName" to name,"now" to Instant.now().toString()))}
        refreshResults();queueSync()
    }
    /** Deletes this device's data. The cloud copy stays, so this device or another can restore it. */
    fun deleteVault()=run("Deleting saved data"){
        lockJob?.join();syncJob?.cancelAndJoin();customizationJob?.cancelAndJoin()
        storeHandle?.let{dataVault.lock(it)};dataVault.delete();wipeMemory();storageMessage="Local saved data deleted."
        restorable=syncEnabled||runCatching{syncKeys.get()!=null}.getOrDefault(false)
    }
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
    override fun onCleared() { syncJob?.cancel();billing.close(); storeHandle?.let{Core.storeClose(it)}; super.onCleared() }
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
    private suspend fun reportPrompt(kind: String)=withContext(Dispatchers.Default){
        Core.obj("store_report_prompt",storeInput("kind" to kind,"customization" to profileData(),"context" to profile)).getJSONArray("messages")
    }
    fun sendChat(message: String) = run("Asking selected provider") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(message.isNotBlank()){"Enter a message"}
        requireAccess("Chat")
        val prompt=reportPrompt("DNA chat")
        messages.forEach{prompt.put(json("role" to it.first,"content" to it.second))};prompt.put(json("role" to "user","content" to message))
        val reply=complete(prompt);messages.add("user" to message);messages.add("assistant" to reply)
    }
    fun generateReport(kind: String) = run("Generating $kind report") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(resultCount>0){ "Add your DNA file first so there are matches to report on." }
        requireAccess(kind)
        if(kind!="Overview") {
            val prompt=reportPrompt(kind)
            val parsed=Core.obj("extract_report",complete(prompt))
            reportTitle=kind;report=parsed.getString("report")
            reportQuestions=(0 until parsed.getJSONArray("questions").length()).map{parsed.getJSONArray("questions").getString(it)}
            return@run
        }
        // Groups arrive formatted from the store, so the full result set never reaches Kotlin.
        val groups=withContext(Dispatchers.Default){Core.arr("store_report_groups",storeInput("groups" to ((resultCount+249)/250)))}
        val summaries=mutableListOf<String>()
        val userContext=(Core.call("user_context",profileData()) as String)+"\n"+profile
        for(i in 0 until groups.length()){
            ensureActiveTask();status="Analyzing report group ${i+1}/${groups.length()}"
            val batch=groups.getJSONObject(i)
            val prompt=Core.call("render_prompt",json("name" to "generateMapPrompt","values" to json("groupNumber" to (i+1),"totalGroups" to groups.length(),"resultsInGroup" to batch.getInt("count"),"totalResults" to resultCount,"compactResults" to batch.getString("text"),"userContext" to userContext))) as String
            summaries.add(complete(JSONArray().put(json("role" to "user","content" to prompt))))
        }
        reportTitle=kind
        val reduce=Core.call("render_prompt",json("name" to "generateReducePrompt","values" to json("groupSummaries" to JSONArray(summaries),"userContext" to userContext))) as String
        report=complete(JSONArray().put(json("role" to "user","content" to reduce)))
    }

}

fun Int.grouped():String=String.format(java.util.Locale.getDefault(),"%,d",this)

private val formatNames=mapOf("23andme" to "23andMe","ancestrydna" to "AncestryDNA","myheritage" to "MyHeritage","ftdna" to "FamilyTreeDNA","livingdna" to "LivingDNA","mapmygenome" to "Mapmygenome","monadic" to "Monadic DNA")

// Debug instrumentation for Run All: cumulative nanoseconds spent matching in Rust.
private class RunTiming { var core=0L
    fun line(processed:Int,elapsed:Long)="studies=$processed elapsed=${elapsed}ms rust=${core/1_000_000}ms"
}

// Rows per Run all chunk: large enough to use the Rust thread pool, small enough for prompt progress and Cancel.
private const val CATALOG_CHUNK=50000
