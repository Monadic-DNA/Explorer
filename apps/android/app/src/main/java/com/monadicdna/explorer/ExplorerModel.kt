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

class ExplorerModel @JvmOverloads constructor(app: Application, val dataVault:SecureDataVault=SecureDataVault(app)) : AndroidViewModel(app) {
    val store = DeviceStore(app)
    var session = (Core.call("session_create") as Number).toLong()
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
        val fields=JSONObject()
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
    var notice by mutableStateOf<String?>(null)
    var progress by mutableStateOf<Float?>(null)
        private set
    // Set while an in-app document picker is open so its activity does not lock the vault.
    var pickingFile=false
    var report by mutableStateOf("")
    var reportTitle by mutableStateOf("")
    var reportQuestions by mutableStateOf(emptyList<String>())
    var shareResultsWithLLM by mutableStateOf(false)
    var acceptedDisclaimer by mutableStateOf(false)
    val messages = mutableStateListOf<Pair<String, String>>()
    private val http = OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(180,TimeUnit.SECONDS).build()
    private var task: Job? = null
    var authenticate:(suspend()->Unit)?=null
    var dataUnlocked by mutableStateOf(false)
        private set
    var storageMessage by mutableStateOf("Your saved data is locked.")
        private set
    var syncing by mutableStateOf(false)
        private set
    private var dataDirty=false
    private var dataVersion=0L
    private var autosave:Job?=null
    private var lockJob:Job?=null
    private var syncJob:Job?=null
    private var syncAgain=false
    var locking by mutableStateOf(false)
        private set
    private var lastCustomization=""
    private fun customization()=json("fields" to JSONObject(profileFields.toMap()),"context" to profile)
    init {
        viewModelScope.launch {
            snapshotFlow { profile to profileFields.toMap() }.collect {
                if(dataUnlocked && customization().toString()!=lastCustomization) markDataChanged()
            }
        }
    }
    private fun restoreCustomization(value:JSONObject) {
        profile=value.optString("context")
        val fields=value.optJSONObject("fields") ?: JSONObject()
        profileFields.clear();profileSchema.forEach{field->profileFields[field.getString("key")]=fields.optString(field.getString("key"))}
        lastCustomization=customization().toString()
    }
    suspend fun unlockData() {
        lockJob?.join()
        if(dataUnlocked)return
        val hadData=dataVault.exists
        val restored=dataVault.unlock(session){requireNotNull(authenticate){"Open the app to unlock your saved data."}.invoke()}
        restoreCustomization(restored)
        metadata=Core.obj("session_metadata",json("session" to session));refreshResults()
        dataUnlocked=true;storageMessage="Saved securely on this device"
        if(!hadData) {
            val legacy=store.get("profile-fields").ifBlank{"{}"}
            restoreCustomization(json("fields" to JSONObject(legacy),"context" to store.get("profile")))
            dataDirty=true;flushData()
            store.remove("profile");store.remove("profile-fields")
        }
        queueSync()
    }
    fun unlockSavedData()=run("Unlocking saved data"){unlockData()}
    private fun markDataChanged() {
        dataDirty=true;dataVersion++;storageMessage="Saving securely…"
        autosave?.cancel()
        autosave=viewModelScope.launch{delay(500);while(busy)delay(100);try{flushData()}catch(e:Exception){if(dataUnlocked)storageMessage="Changes not saved. ${e.message ?: "Please retry."}"}}
    }
    suspend fun flushData() {
        if(!dataUnlocked || !dataDirty)return
        val version=dataVersion;val custom=customization()
        dataVault.save(session,custom)
        lastCustomization=custom.toString()
        if(version==dataVersion)dataDirty=false
        storageMessage=if(dataDirty)"Saving securely…" else "Saved securely on this device"
        queueSync()
    }
    private fun wipeMemory() {
        Core.call("session_close",json("session" to session));session=(Core.call("session_create") as Number).toLong()
        metadata=JSONObject();results=emptyList();messages.clear();report="";reportQuestions=emptyList();selectedStudy=null
        profile="";profileFields.clear();dataUnlocked=false;dataDirty=false;lastCustomization=""
    }
    fun lockData() {
        if(lockJob?.isActive==true)return
        val running=task
        locking=true
        lockJob=viewModelScope.launch {
            running?.cancelAndJoin();autosave?.cancelAndJoin();syncJob?.cancelAndJoin()
            try{flushData()}catch(e:Exception){error="Latest changes could not be saved. The previous encrypted copy is intact."}
            dataVault.lock();wipeMemory();storageMessage="Your saved data is locked.";locking=false
        }
    }
    fun backgroundLock(){if(dataUnlocked&&!pickingFile)lockData()}
    private fun queueSync() {
        if(!dataUnlocked || locking)return
        if(syncJob?.isActive==true){syncAgain=true;return}
        syncJob=viewModelScope.launch {
            if(dataVault.syncConfiguration()?.optBoolean("enabled")!=true)return@launch
            while(busy)delay(100)
            delay(1000)
            syncing=true
            try{do{syncAgain=false;syncOnce()}while(syncAgain)}catch(e:Exception){storageMessage="Saved on device. Sync needs attention: ${e.message ?: "please retry"}"}
            finally{syncing=false}
        }
    }
    private suspend fun syncOnce() {
        val config=dataVault.syncConfiguration() ?: return
        if(!config.optBoolean("enabled"))return
        require(wallet.isNotBlank() && wallet.equals(config.optString("wallet"),true)){"Sign in to the account used to enable sync."}
        val syncWallet=wallet
        val observedVersion=dataVersion
        val remote=api("/api/vault-sync",json("walletAddress" to syncWallet,"action" to "read","knownRevision" to config.optLong("revision"),"knownGenotype" to dataVault.genotypeDigest()))
        val revision=remote.getLong("revision");val base=config.optLong("revision")
        val latest=dataVault.syncConfiguration() ?: return
        if(!wallet.equals(syncWallet,true) || !latest.optBoolean("enabled") || latest.optString("wallet")!=config.optString("wallet"))return
        if(revision==base) {
            if(config.optBoolean("dirty")) {
                val archive=dataVault.archive()
                val uploaded=archive.getJSONObject("envelope").getLong("revision")
                if(archive.getJSONObject("envelope").optString("genotypeDigest")==remote.optString("genotypeDigest")) archive.getJSONObject("envelope").remove("genotype")
                val response=api("/api/vault-sync",json("walletAddress" to syncWallet,"action" to "write","baseRevision" to base,"archive" to archive))
                dataVault.synced(response.getLong("revision"),uploaded)
            }
        } else {
            val cloud=remote.optJSONObject("archive")
            if(cloud!=null && cloud.optString("mac")==dataVault.archive().optString("mac")) {
                dataVault.synced(revision,dataVault.archive().getJSONObject("envelope").getLong("revision"));return
            }
            require(!dataDirty && observedVersion==dataVersion && !busy && !latest.optBoolean("dirty")){"Another device has changes. Choose Restore cloud copy to replace this device's data, or export a backup before resolving the conflict."}
            require(!remote.isNull("archive")){"The cloud copy was removed. Disable sync or set it up again explicitly."}
            val restored=dataVault.acceptCloud(session,remote.getJSONObject("archive"),revision)
            restoreCustomization(restored);metadata=Core.obj("session_metadata",json("session" to session));refreshResults()
        }
        storageMessage="Saved on device and encrypted sync is up to date."
    }
    fun syncNow()=run("Syncing encrypted data"){unlockData();flushData();queueSync()}
    fun enableSync(password:String)=run("Setting up encrypted sync"){
        require(wallet.isNotBlank()){ "Sign in before enabling sync." };unlockData();flushData();dataVault.enableSync(wallet,password);queueSync()
    }
    fun disableSync()=run("Disabling sync on this device"){dataVault.disableSync();storageMessage="Saved on device. Sync is disabled on this device."}
    private suspend fun prepareRecovery() {
        if(!dataUnlocked)return
        autosave?.cancelAndJoin();syncJob?.cancelAndJoin();flushData()
        dataVault.lock();wipeMemory()
        currentCoroutineContext().ensureActive()
    }
    fun restoreCloud(password:String)=run("Restoring encrypted cloud data"){
        require(wallet.isNotBlank()){ "Sign in to restore cloud data." }
        val remote=api("/api/vault-sync",json("walletAddress" to wallet,"action" to "read"))
        require(!remote.isNull("archive")){"No encrypted cloud copy exists for this account."}
        prepareRecovery()
        val custom=dataVault.restore(session,remote.getJSONObject("archive"),password,{requireNotNull(authenticate).invoke()},true)
        restoreCustomization(custom);dataUnlocked=true;dataDirty=false;metadata=Core.obj("session_metadata",json("session" to session));refreshResults()
        dataVault.enableExistingSync(wallet,remote.getLong("revision"));storageMessage="Restored encrypted cloud data and enabled sync."
    }
    fun deleteCloud()=run("Deleting cloud copy"){
        require(wallet.isNotBlank()){ "Sign in first." }
        requireNotNull(dataVault.syncConfiguration()) {"Unlock your saved data first."}
        val response=api("/api/vault-sync",json("walletAddress" to wallet,"action" to "read"))
        api("/api/vault-sync",json("walletAddress" to wallet,"action" to "delete","baseRevision" to response.getLong("revision")))
        dataVault.disableSync();storageMessage="Cloud copy deleted. The encrypted device copy is retained."
    }


    fun run(label: String, block: suspend () -> Unit) {
        if (busy) return
        if(syncing){error="Encrypted sync is in progress. Please retry in a moment.";return}
        task = viewModelScope.launch {
            busy=true; status=label; error=null; notice=null; progress=null
            try { block(); status="Saving securely…" }
            catch (cancelled: CancellationException) { status="Cancelled. Saving what was completed…"; throw cancelled }
            catch (e: Exception) { error=e.message ?: "Operation failed" }
            finally {
                try{if(dataUnlocked && dataDirty)withContext(NonCancellable){flushData()}}catch(e:Exception){storageMessage="Changes not saved. Please retry.";error=e.message}
                busy=false; progress=null
            }
        }
    }
    fun cancel() { task?.cancel() }
    // Once the operation has finished or was cancelled, only the final save remains.
    val cancellable get()=task?.isActive==true&&!status.startsWith("Cancelled")&&status!="Saving securely…"
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
        if(dataUnlocked)markDataChanged()
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
        unlockData();markDataChanged()
        val importSession=session
        metadata=withContext(Dispatchers.Default) { Core.importGenotype(importSession,bytes,name) }
        results=emptyList();markDataChanged()
        val format=formatNames[metadata.optString("detectedFormat")]?.let{" from $it"}.orEmpty()
        notice="Imported ${metadata.optInt("count").grouped()} variants$format. Open Results and choose Run all studies to match them against the research catalog."
    }
    suspend fun refreshResults() { results=withContext(Dispatchers.Default) { Core.arr("session_results",json("session" to session)).objects() } }
    fun analyze(study: JSONObject) = run("Analyzing on device") {
        require(dataUnlocked && metadata.optInt("count")>0) { "Unlock or import your DNA first." }
        markDataChanged()
        withContext(Dispatchers.Default) { Core.arr("session_analyze",json("session" to session,"studies" to JSONArray().put(study),"now" to Instant.now().toString())) }
        markDataChanged();refreshResults()
        notice=if(results.none { it.optInt("studyId")==study.optInt("id") }) "Your DNA has no called genotype for this study's risk variant." else "Match saved to Results."
    }
    /** The catalog snapshot bundled with this release, from assets/catalog.json. */
    val catalogInfo: JSONObject? = runCatching{JSONObject(app.assets.open("catalog.json").bufferedReader().use{it.readText()})}.getOrNull()
    fun runAll() = run("Opening the research catalog") {
        require(dataUnlocked && metadata.optInt("count")>0) { "Unlock or import your DNA first." }
        markDataChanged()
        val now=Instant.now().toString()
        val started=System.currentTimeMillis();var refreshed=started
        val timing=RunTiming()
        val catalog=withContext(Dispatchers.Default){Core.catalogOpen(catalogFile().path)}
        val handle=catalog.getLong("handle");val total=catalog.getInt("rows")
        // Merge each chunk's matches by study ID; re-reading every saved result per chunk exhausts memory.
        val merged=LinkedHashMap<Int,JSONObject>().apply{results.forEach{put(it.optInt("studyId"),it)}}
        val matched=HashSet<Int>()
        var processed=0;var complete=false
        try {
            while(true) {
                ensureActiveTask()
                val mark=System.nanoTime()
                val chunk=withContext(Dispatchers.Default){Core.catalogAnalyzeNext(handle,session,CATALOG_CHUNK,now)}
                timing.core+=System.nanoTime()-mark
                chunk.getJSONArray("matches").objects().forEach{val id=it.optInt("studyId");merged[id]=it;matched+=id}
                markDataChanged();processed+=chunk.getInt("rows")
                val elapsed=(System.currentTimeMillis()-started)/1000
                progress=if(total>0)processed.toFloat()/total else null
                status="Analyzed ${processed.grouped()} of ${total.grouped()} studies (${if(total>0)processed*100/total else 0}%) • ${chunk.getInt("saved").grouped()} matches • ${elapsed/60}:${"%02d".format(elapsed%60)} elapsed"
                if(BuildConfig.DEBUG)android.util.Log.d("RunAll",timing.line(processed,System.currentTimeMillis()-started))
                // Publishing copies references only, so matches appear while the run continues.
                if(System.currentTimeMillis()-refreshed>3000){results=merged.values.toList();refreshed=System.currentTimeMillis()}
                if(chunk.getBoolean("done")){complete=true;break}
            }
        } finally { Core.catalogClose(handle) }
        // Same order and last-write-wins semantics as the session, without a second full copy.
        // A complete run also drops results the bundled catalog no longer produces, as the core did.
        results=merged.values.filter{!complete||it.optInt("studyId") in matched}
        val seconds=(System.currentTimeMillis()-started)/1000
        notice="Run all finished in ${seconds/60}:${"%02d".format(seconds%60)}. Analyzed ${processed.grouped()} studies from research catalog ${catalog.getString("version")} and saved ${results.size.grouped()} matches."
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
    fun exportResults(): String = Core.call("session_export",json("session" to session)) as String
    fun importResults(content: String, name: String) = run("Importing results") { importResultsData(content, name) }
    suspend fun importResultsData(content: String, name: String) { unlockData();markDataChanged();withContext(Dispatchers.Default){Core.call("session_import_results",json("session" to session,"content" to content,"fileName" to name,"now" to Instant.now().toString()))};markDataChanged();refreshResults() }
    suspend fun sealedVault(password:String):String {unlockData();flushData();return dataVault.backup(password)}
    fun saveVault(password:String)=run("Saving data securely"){unlockData();dataDirty=true;flushData()}
    fun openVault(password:String,imported:String?=null)=run("Unlocking saved data"){openVaultData(password,imported)}
    suspend fun openVaultData(password:String,imported:String?=null) {
        val legacy=imported ?: getApplication<Application>().openFileInput("vault.json").bufferedReader().use{it.readText()}
        val archive=JSONObject(legacy)
        if(archive.optInt("version")==2) {
            prepareRecovery()
            val custom=dataVault.restore(session,archive,password,{requireNotNull(authenticate).invoke()})
            restoreCustomization(custom);dataUnlocked=true;dataDirty=false
        } else {
            unlockData()
            val snapshot=withContext(Dispatchers.Default){Core.call("open",archive.put("password",password)) as String}
            Core.call("session_restore",json("session" to session,"snapshot" to snapshot));markDataChanged();flushData()
        }
        metadata=Core.obj("session_metadata",json("session" to session));refreshResults();storageMessage="Saved securely on this device"
    }
    fun deleteVault()=run("Deleting saved data"){
        autosave?.cancelAndJoin();syncJob?.cancelAndJoin();dataVault.delete();getApplication<Application>().deleteFile("vault.json");dataDirty=false;wipeMemory();storageMessage="Local saved data deleted."
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
    override fun onCleared() { autosave?.cancel();syncJob?.cancel();billing.close(); Core.call("session_close",json("session" to session)); super.onCleared() }
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

fun Int.grouped():String=String.format(java.util.Locale.getDefault(),"%,d",this)

private val formatNames=mapOf("23andme" to "23andMe","ancestrydna" to "AncestryDNA","myheritage" to "MyHeritage","ftdna" to "FamilyTreeDNA","livingdna" to "LivingDNA","mapmygenome" to "Mapmygenome","monadic" to "Monadic DNA")

// Debug instrumentation for Run All: cumulative nanoseconds spent matching in Rust.
private class RunTiming { var core=0L
    fun line(processed:Int,elapsed:Long)="studies=$processed elapsed=${elapsed}ms rust=${core/1_000_000}ms"
}

// Rows per Run all chunk: large enough to use the Rust thread pool, small enough for prompt progress and Cancel.
private const val CATALOG_CHUNK=50000
