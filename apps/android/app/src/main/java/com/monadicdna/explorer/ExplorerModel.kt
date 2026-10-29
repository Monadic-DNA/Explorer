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

class ExplorerModel @JvmOverloads constructor(app: Application, val dataVault:SecureDataVault=SecureDataVault(app), private val syncKeys:SyncKeyStore=BlockStoreSyncKeys(app), cloud:SyncCloud?=null) : AndroidViewModel(app) {
    /** Returns a Google Drive app-data access token, asking the user once; set by the activity. */
    var driveToken:(suspend()->String)?=null
    // Encrypted sync records live in the user's own Google Drive, never on the Monadic DNA backend.
    private val cloud:SyncCloud=cloud ?: DriveSyncCloud{requireNotNull(driveToken){"Open the app to sync."}.invoke()}
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
    /** Set to "premium" when Chat or a report needs Premium or a pass. Cleared by the next operation. */
    var accessNeeded by mutableStateOf<String?>(null)
        private set
    fun dismissAccessNeeded(){accessNeeded=null}
    /** A question started on Home that the Chat tab picks up. */
    var chatDraft by mutableStateOf("")
    var personalizeSkipped by mutableStateOf(store.get("personalize-skipped")=="true")
        private set
    fun skipPersonalization(){store.put("personalize-skipped","true");personalizeSkipped=true}
    val personalized get()=profile.isNotBlank()||profileFields.values.any{it.isNotBlank()}
    var acceptedDisclaimer by mutableStateOf(false)
    val messages = mutableStateListOf<Pair<String, String>>()
    /** For Research replies, keyed by message index: each angle researched and how many results it used. */
    val researchAngles = mutableStateMapOf<Int, List<Pair<String,Int>>>()
    /** Follow-up questions suggested by the latest Research reply. */
    var chatFollowups by mutableStateOf(emptyList<String>())
        private set
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
        // Tapping "Restore my data" on a new device is the user's choice to sync.
        if(restorable)store.put("sync-on","true")
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
    /** Home offers sync once after the first import; Google's consent screen appears only if the user accepts. */
    private var syncDecided by mutableStateOf(store.get("sync-decided")=="true")
    val syncOffered get()=dataUnlocked && !syncEnabled && resultCount>0 && !syncDecided
    fun declineSync(){store.put("sync-decided","true");syncDecided=true}
    // Android sync is opt-in: Google Drive access needs the user's consent, so it is never requested unprompted.
    private suspend fun setUpSync() {
        if(Core.obj("store_sync_status",storeInput()).optBoolean("enabled")){syncEnabled=true;queueSync();return}
        if(store.get("sync-on")!="true")return
        // Reuse this user's key from Block Store (a new device restoring) or create one for this account.
        val existing=runCatching{syncKeys.get()}.getOrNull()
        val enabled=Core.obj("store_sync_enable",storeInput("syncKey" to existing))
        restoreWarning=if(existing==null)runCatching{syncKeys.put(enabled.getString("syncKey"))}.exceptionOrNull()?.let{"A new phone can't restore your data yet. ${it.message}"}.orEmpty() else ""
        syncEnabled=true;queueSync()
    }
    fun setSync(on: Boolean)=run(if(on)"Turning on sync" else "Turning off sync and deleting the cloud copy"){
        unlockData()
        store.put("sync-decided","true");syncDecided=true
        if(on){
            try{cloud.authorize()}catch(e:CancellationException){throw e}catch(e:Exception){error("Sync needs a Google account with access to its hidden Explorer folder in Google Drive. Add a Google account in your device settings and try again.")}
            store.put("sync-on","true");setUpSync()
            notice="Sync is on. An end-to-end encrypted copy is kept in your own Google Drive so a new phone fills in automatically."
            return@run
        }
        syncJob?.cancelAndJoin()
        if(syncEnabled)cloud.deleteAll()
        Core.call("store_sync_disable",storeInput());runCatching{syncKeys.delete()}
        store.put("sync-on","false");syncEnabled=false;syncMessage="";notice="Sync is off and the cloud copy is deleted. Your data stays on this device."
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
    private suspend fun syncOnce() {
        val catalogVersion=catalogInfo?.optString("version")
        repeat(3) {
            // Pull first: a write must be based on the cloud's current revision.
            val list=JSONArray(cloud.list().map{json("record" to it.record,"revision" to it.revision)})
            val wanted=Core.arr("store_sync_wanted",storeInput("records" to list))
            if(wanted.length()>0){
                var changed=false
                for(record in cloud.read((0 until wanted.length()).map{wanted.getString(it)})){
                    val applied=withContext(Dispatchers.Default){Core.obj("store_sync_apply",storeInput("record" to record.record,"revision" to record.revision,"ciphertext" to record.ciphertext,"catalogVersion" to catalogVersion))}
                    if(applied.optBoolean("changed"))changed=true
                    if(applied.optBoolean("replacedLocal"))notice="Your DNA file was replaced by one imported on another device."
                }
                if(changed){metadata=Core.obj("store_metadata",storeInput());restoreCustomization(Core.obj("store_customization",storeInput()));refreshResults()}
            }
            var conflict=false
            for(out in withContext(Dispatchers.Default){Core.arr("store_sync_outgoing",storeInput())}.objects()){
                try {
                    val revision=cloud.write(out.getString("record"),out.getLong("baseRevision"),out.getString("ciphertext"))
                    Core.call("store_sync_pushed",storeInput("record" to out.getString("record"),"revision" to revision,"version" to out.getLong("version"),"hash" to out.getString("hash")))
                } catch(_:SyncConflict){conflict=true}
            }
            if(!conflict)return
        }
        error("Another device keeps changing your data; sync will retry")
    }

    fun run(label: String, block: suspend () -> Unit) {
        if (busy) return
        task = viewModelScope.launch {
            busy=true; status=label; error=null; notice=null; progress=null; accessNeeded=null
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
        return request(origin+path,body)
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
                        if(it.code==429) throw RateLimited()
                        if(!it.isSuccessful) throw IllegalStateException("Request failed (HTTP ${it.code}). Check your connection and AI provider settings.")
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
        notice="Imported ${metadata.optInt("count").grouped()} variants$format and found ${matches.grouped()} research matches."
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
    val billing = PlayBilling(app, viewModelScope)
    /** Debug builds only: treat this device as Premium to test premium features without a purchase. */
    var debugPremium by mutableStateOf(BuildConfig.DEBUG && store.get("debug-premium")=="true")
        private set
    fun changeDebugPremium(on: Boolean){ if(!BuildConfig.DEBUG)return; store.put("debug-premium",on.toString());debugPremium=on }
    /** Premium from Google Play, or the debug override. Release builds always use Google Play alone. */
    val premiumActive get()=billing.premium || (BuildConfig.DEBUG && debugPremium)
    override fun onCleared() { syncJob?.cancel();billing.close(); storeHandle?.let{Core.storeClose(it)}; super.onCleared() }
    /** Premium status and report passes come from Google Play; Monadic DNA keeps no purchase records. Returns the pass to use, if any. */
    private suspend fun requireAccess(kind: String): String? {
        if(Core.obj("feature_access",json("kind" to kind)).getBoolean("allowed"))return null
        // If Google Play can't be reached, fall back to the last status read from it.
        runCatching{billing.current()}
        val access=Core.obj("feature_access",json("kind" to kind,"activeSubscription" to premiumActive))
        if(access.getBoolean("allowed"))return null
        if(access.isNull("reportType")){accessNeeded="premium";error("Research is part of Premium. It looks at your question from 10 angles and writes a detailed answer. Regular chat is free.")}
        val type=access.getString("reportType")
        if(billing.passes[type]==null){accessNeeded="premium";error("The $kind report is part of Premium. Subscribe, or buy a pass for this report, in Account.")}
        return type
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
    /** Runs a prompt built by the core, which carries its own token and temperature limits. */
    private suspend fun complete(prompt: JSONObject): String=complete(prompt.getJSONArray("messages"),json("max_tokens" to prompt.optInt("maxTokens"),"temperature" to prompt.optDouble("temperature")).also{o->prompt.optString("reasoningEffort").takeIf{it.isNotEmpty()}?.let{o.put("reasoning_effort",it)}})
    private class RateLimited: Exception("The AI provider is busy. Please try again in a minute.")
    /** AI providers rate-limit bursts (Research makes about 12 calls), so wait and retry before giving up. */
    private suspend fun complete(messages: JSONArray, options: JSONObject=JSONObject()): String {
        for(wait in listOf(5_000L,15_000L,30_000L)) {
            try { return completeOnce(messages,options) } catch(_:RateLimited) { status="The AI provider is busy; retrying…"; delay(wait) }
        }
        return completeOnce(messages,options)
    }
    private suspend fun completeOnce(messages: JSONArray, options: JSONObject): String {
        val config=Core.obj("llm_config",llmConfig());val endpoint=config.getString("endpoint").trimEnd('/')
        if(provider=="huggingface")require(apiKey.isNotBlank()){"Enter your provider API key in Settings. Keys stay on this device."}
        if(provider=="ollama"){
            val data=request("$endpoint/api/chat",json("model" to config.getString("identifier"),"messages" to messages,"stream" to false,"options" to json("temperature" to options.opt("temperature"),"num_predict" to options.opt("max_tokens"))))
            return data.getJSONObject("message").getString("content")
        }
        val bearer=if(provider=="nilai")nilaiAuthorization(endpoint)else apiKey
        val body=json("model" to config.getString("identifier"),"messages" to messages,"stream" to false)
        for(key in options.keys())body.put(key,options.get(key))
        val response=request("$endpoint/chat/completions",body,bearer)
        return response.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
    }
    private suspend fun reportPrompt(kind: String)=withContext(Dispatchers.Default){
        Core.obj("store_report_prompt",storeInput("kind" to kind,"customization" to profileData(),"context" to profile)).getJSONArray("messages")
    }
    /** `onSent` runs once a reply has arrived, so a failed send keeps the user's question. */
    fun sendChat(message: String, onSent: ()->Unit={}) = run("Asking selected provider") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(message.isNotBlank()){"Enter a message"}
        requireAccess("Chat")
        val first=messages.isEmpty()
        // As on the web, the first question includes the user's 500 most relevant results; follow-ups use the conversation.
        val accessions=if(first){status="Finding your most relevant results…";similarStudies(message,5000)}else JSONArray()
        status="Asking ${mapOf("nilai" to "nilAI","huggingface" to "HuggingFace","ollama" to "Ollama")[provider]?:provider}…"
        val history=JSONArray(messages.map{json("role" to it.first,"content" to it.second)})
        val prompt=withContext(Dispatchers.Default){Core.obj("store_chat_prompt",storeInput("query" to message,"llmDescription" to Core.call("llm_description",llmConfig()),"summary" to Core.call("user_context",profileData()),"accessions" to accessions,"history" to history))}
        val reply=Core.obj("research_extract",json("content" to complete(prompt)))
        messages.add("user" to message);messages.add("assistant" to reply.getString("answer"))
        chatFollowups=(0 until reply.getJSONArray("questions").length()).map{reply.getJSONArray("questions").getString(it)}
        onSent()
    }
    /**
     * Research in Chat (premium): the shared core's multi-angle pipeline, identical to the web. For each angle,
     * the stateless /api/similar-studies search ranks studies; matching the user's results happens on device.
     */
    /** Studies most similar to the text, from the stateless semantic search; empty when unavailable. */
    private suspend fun similarStudies(text: String, limit: Int): JSONArray {
        val found=runCatching{api("/api/similar-studies",json("query" to text,"limit" to limit)).getJSONArray("studies")}.getOrDefault(JSONArray())
        return JSONArray((0 until found.length()).map{found.getJSONObject(it).optString("study_accession")})
    }
    fun research(question: String, onSent: ()->Unit={}) = run("Researching") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(question.isNotBlank()){"Enter a question"}
        require(resultCount>0){"Add your DNA file first so there are matches to research."}
        requireAccess("Research")
        val customization=Core.call("user_context",profileData()) as String
        val description=Core.call("llm_description",llmConfig()) as String
        status="Finding research angles…"
        val keywordPrompt=Core.obj("research_keywords_prompt",json("query" to question,"customization" to customization))
        val keywords=Core.arr("research_parse_keywords",json("content" to complete(keywordPrompt),"query" to question))
        val analyses=JSONArray();val angles=mutableListOf<Pair<String,Int>>()
        for(i in 0 until keywords.length()){
            ensureActiveTask()
            val keyword=keywords.getString(i)
            status="Angle ${i+1} of ${keywords.length()}: $keyword"
            progress=i.toFloat()/(keywords.length()+1)
            val accessions=similarStudies(keyword,1000)
            val prompt=withContext(Dispatchers.Default){Core.obj("store_research_angle_prompt",storeInput("query" to question,"keyword" to keyword,"customization" to customization,"llmDescription" to description,"accessions" to accessions))}
            val count=prompt.getInt("resultsCount")
            // Sequential, as on the web, to stay within nilAI's rate limits.
            val analysis=if(count==0)"No relevant findings for this angle." else complete(prompt)
            analyses.put(json("keyword" to keyword,"analysis" to analysis,"resultsCount" to count));angles.add(keyword to count)
        }
        status="Writing your answer…";progress=keywords.length().toFloat()/(keywords.length()+1)
        val reply=Core.obj("research_extract",json("content" to complete(Core.obj("research_synthesis_prompt",json("query" to question,"customization" to customization,"llmDescription" to description,"totalResults" to resultCount,"analyses" to analyses)))))
        messages.add("user" to question);messages.add("assistant" to reply.getString("answer"))
        researchAngles[messages.size-1]=angles
        chatFollowups=(0 until reply.getJSONArray("questions").length()).map{reply.getJSONArray("questions").getString(it)}
        onSent()
    }
    fun generateReport(kind: String) = run("Generating $kind report") {
        require(shareResultsWithLLM){"Confirm sharing matched results with the selected provider first."}
        require(resultCount>0){ "Add your DNA file first so there are matches to report on." }
        val pass=requireAccess(kind)
        if(kind!="Overview") {
            val prompt=reportPrompt(kind)
            val parsed=Core.obj("extract_report",complete(prompt))
            reportTitle=kind;report=parsed.getString("report")
            reportQuestions=(0 until parsed.getJSONArray("questions").length()).map{parsed.getJSONArray("questions").getString(it)}
            pass?.let{billing.consumePass(it)}
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
        // A pass is used only once the report exists, so a failed run keeps it.
        pass?.let{billing.consumePass(it)}
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
