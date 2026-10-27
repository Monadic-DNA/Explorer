package com.monadicdna.explorer

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity: FragmentActivity() {
    private lateinit var deviceAuthentication:DeviceAuthentication
    private val model by lazy { ViewModelProvider(this)[ExplorerModel::class.java] }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if(!BuildConfig.DEBUG)window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        deviceAuthentication=DeviceAuthentication(this)
        val weak=java.lang.ref.WeakReference(deviceAuthentication)
        model.authenticate={requireNotNull(weak.get()){ "Open the app to unlock saved data." }.authenticate()}
        intent?.data?.takeIf{it.scheme=="monadicexplorer"&&it.host=="auth"}?.let(model::receiveAuth)
        androidx.core.view.WindowCompat.getInsetsController(window,window.decorView).isAppearanceLightStatusBars=true
        setContent { VaultTheme { ExplorerApp(model) } }
    }
    override fun onStop() { super.onStop(); if(!isChangingConfigurations) model.backgroundLock() }
    override fun onResume() { super.onResume(); if(model.wallet.isNotBlank()) model.billing.restore() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent);setIntent(intent);intent.data?.takeIf{it.scheme=="monadicexplorer"&&it.host=="auth"}?.let(model::receiveAuth) }
}

private fun openBrowser(context: android.content.Context, url: String) { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url))) }
private fun readDocument(context: android.content.Context, uri: Uri, max: Int=150*1024*1024): ByteArray {
    return context.contentResolver.openInputStream(uri)!!.use { stream ->
        val output=ByteArrayOutputStream();val buffer=ByteArray(65536)
        while(true){val n=stream.read(buffer);if(n<0)break;require(output.size()+n<=max){"File exceeds supported size"};output.write(buffer,0,n)}
        output.toByteArray()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ExplorerApp(model: ExplorerModel) {
    var tab by remember { mutableStateOf("Home") }
    val context=LocalContext.current
    var exportContent by remember { mutableStateOf("") }
    val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")){uri->model.pickingFile=false;if(uri!=null)model.run("Writing export"){kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){context.contentResolver.openOutputStream(uri)!!.use{it.write(exportContent.toByteArray())}};exportContent=""}}
    val importDNA=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->model.pickingFile=false;if(uri!=null){model.run("Reading DNA file"){
        val bytes=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readDocument(context,uri)}
        // Schedule import after this short IO operation has completed.
        model.importGenotypeData(bytes,uri.lastPathSegment?:"genotype.txt")
    }}}
    val importResults=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->model.pickingFile=false;if(uri!=null)model.run("Reading results"){
        val content=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readDocument(context,uri).toString(Charsets.UTF_8)}
        val name=if(uri.toString().endsWith("json"))"results.json" else "results.tsv"
        model.importResultsData(content,name)
    }}
    fun exportText(name: String, content: String){exportContent=content;model.pickingFile=true;export.launch(name)}
    fun selectTab(name: String){tab=name;model.error=null;model.notice=null;model.dismissAccessNeeded()}
    val tabs=listOf("Home","Chat","Reports","You","More")
    // Screens opened from More return there; other tabs return Home before Back leaves the app.
    BackHandler(enabled=tab!="Home"){selectTab(if(tab in tabs)"Home" else "More")}
    Scaffold(
        topBar={TopAppBar(title={Text("Explorer",style=MaterialTheme.typography.titleLarge)})},
        bottomBar={NavigationBar(containerColor=MaterialTheme.colorScheme.background) { tabs.forEachIndexed{index,name->NavigationBarItem(selected=tab==name||(name=="More"&&tab !in tabs),onClick={selectTab(name)},label={Text(name)},icon={Icon(when(index){0->Icons.Default.Home;1->Icons.AutoMirrored.Filled.Chat;2->Icons.Default.Description;3->Icons.Default.Person;else->Icons.Default.MoreHoriz},contentDescription=name)})} }}
    ){padding->
        Column(Modifier.padding(padding).fillMaxSize()){
            // A first-time user has no vault yet, so there is nothing to lock or unlock.
            if(model.dataUnlocked||model.dataVault.exists)Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
                val variants=model.metadata.optInt("count")
                Text(if(variants>0&&model.dataUnlocked)"${variants.grouped()} variants • ${model.storageMessage}" else model.storageMessage,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                if(model.dataUnlocked) TextButton(onClick=model::lockData,enabled=!model.busy){Text("Lock data")}
                else TextButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock data")}
            }
            if(model.busy){model.progress?.let{LinearProgressIndicator(progress={it},modifier=Modifier.fillMaxWidth())}?:LinearProgressIndicator(Modifier.fillMaxWidth());Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){Text(model.status,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium);if(model.cancellable)TextButton(onClick=model::cancel){Text("Cancel")}}}
            Messages(model)
            if(model.locking){Text("Your data is protected",Modifier.padding(24.dp))} else when(tab){
                "Home"->HomeScreen(model,::selectTab){model.pickingFile=true;importDNA.launch(arrayOf("text/*","application/gzip","application/octet-stream"))}
                "You"->YouScreen(model,{selectTab("Home")}){selectTab("Vault")}
                "Browse"->BrowseScreen(model)
                "Results"->ResultsScreen(model,{selectTab("Vault")},{name,content->exportText(name,content)},{model.pickingFile=true;importResults.launch(arrayOf("text/*","application/json","application/octet-stream"))})
                "Chat"->ChatScreen(model,{selectTab("Settings")},{selectTab("You")}){selectTab("Account")}
                "Reports"->ReportScreen(model,{selectTab("Chat")},{selectTab("Account")}){exportText("monadic-report.md",model.report)}
                "Vault"->VaultScreen(model){model.pickingFile=true;importDNA.launch(arrayOf("text/*","application/gzip","application/octet-stream"))}
                "Settings"->SettingsScreen(model)
                "Account"->AccountScreen(model)
                "More"->ScreenColumn{Text("More",style=MaterialTheme.typography.headlineMedium);listOf("Results" to "Your matches","Browse" to "Browse research","Vault" to "Vault and backups","Settings" to "Connection and AI provider","Account" to "Account and premium").forEach{(name,label)->OutlinedButton(onClick={selectTab(name)},modifier=Modifier.fillMaxWidth()){Text(label)}};Text("Genotype formats: 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, and Monadic DNA. Compressed .gz files are supported. Genetic data is processed on device.")}
            }
        }
    }
    if(model.selectedStudy!=null) ModalBottomSheet(onDismissRequest={model.selectedStudy=null}){Column(Modifier.navigationBarsPadding()){Messages(model);StudyScreen(model,model.selectedStudy!!)}}
}

@Composable private fun Messages(model: ExplorerModel){
    // An access requirement is shown by AccessNeeded, with a button, instead of here.
    model.error?.takeIf{model.accessNeeded==null}?.let{message->Card(Modifier.padding(horizontal=12.dp,vertical=6.dp).fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(message,color=MaterialTheme.colorScheme.error);TextButton(onClick={model.error=null}){Text("Dismiss")}}}}
    model.notice?.let{message->Card(Modifier.padding(horizontal=12.dp,vertical=6.dp).fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primaryContainer,contentColor=MaterialTheme.colorScheme.onPrimaryContainer)){Column(Modifier.padding(12.dp)){Text(message);TextButton(onClick={model.notice=null}){Text("Dismiss")}}}}
}

// The whole row toggles the checkbox, so the label is a tap target too.
@Composable private fun CheckRow(checked: Boolean, onChange: (Boolean)->Unit, label: String, small: Boolean=true){
    Row(Modifier.fillMaxWidth().toggleable(value=checked,role=Role.Checkbox,onValueChange=onChange).padding(vertical=4.dp),verticalAlignment=Alignment.CenterVertically){
        Checkbox(checked=checked,onCheckedChange=null,modifier=Modifier.padding(end=12.dp));Text(label,style=if(small)MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge)
    }
}

private fun effectNumber(value: Double): String = if(value.isNaN()) "" else java.math.BigDecimal(value).round(java.math.MathContext(3)).stripTrailingZeros().toPlainString()

@Composable private fun ScreenColumn(content: @Composable ColumnScope.()->Unit){Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp),content=content)}

@Composable private fun BrowseScreen(model: ExplorerModel){
    var query by remember{mutableStateOf("")};var trait by remember{mutableStateOf("")};var semantic by remember{mutableStateOf(true)};var offset by remember{mutableIntStateOf(0)}
    Column(Modifier.fillMaxSize().padding(16.dp)){
        OutlinedTextField(value=query,onValueChange={query=it},label={Text("Search traits, studies, genes or SNPs")},modifier=Modifier.fillMaxWidth())
        OutlinedTextField(value=trait,onValueChange={trait=it},label={Text("Trait filter (optional)")},modifier=Modifier.fillMaxWidth())
        Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.weight(1f)){CheckRow(semantic,{semantic=it},"Semantic search",small=false)};Button(onClick={offset=0;model.browse(query,trait,semantic)},enabled=!model.busy){Text("Search")}}
        if(model.studies.isEmpty())Text("Search the catalog to discover studies.")
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)){items(model.studies,key={it.optInt("id")}){study->Card(onClick={model.showStudy(study)},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){Text(study.optString("disease_trait","Unknown trait"),fontWeight=FontWeight.Bold);Text(study.optString("study"),maxLines=3);Text(listOf(study.optString("strongest_snp_risk_allele"),study.optString("study_accession"),study.optString("confidenceBand","Research finding")).filter{it.isNotBlank()&&it!="null"}.joinToString(" • "),style=MaterialTheme.typography.labelSmall)}}}}
        Row(horizontalArrangement=Arrangement.SpaceBetween,modifier=Modifier.fillMaxWidth()){TextButton(onClick={offset=(offset-50).coerceAtLeast(0);model.browse(query,trait,semantic,offset)},enabled=offset>0&&!model.busy){Text("Previous")};TextButton(onClick={offset+=50;model.browse(query,trait,semantic,offset)},enabled=model.studies.isNotEmpty()&&!model.busy){Text("Next")}}
    }
}

@Composable private fun StudyScreen(model: ExplorerModel,study: JSONObject){
    val context=LocalContext.current
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(study.optString("disease_trait"),style=MaterialTheme.typography.headlineMedium);Text(study.optString("study"))
        val effectLabel=remember(study.toString()){if(Core.obj("effect",json("value" to study.optString("or_or_beta"),"ci" to study.optString("ci_text"))).optString("effectType")=="beta")"Beta (trait change)" else "Odds ratio"}
        for((key,label) in listOf("study_accession" to "Accession","mapped_gene" to "Genes","snps" to "Variants","strongest_snp_risk_allele" to "Reported risk allele","or_or_beta" to effectLabel,"ci_text" to "Effect interval","p_value" to "P-value","initial_sample_size" to "Discovery sample","replication_sample_size" to "Replication sample","first_author" to "Author","journal" to "Journal","date" to "Publication date")){val value=study.optString(key);if(value.isNotBlank()&&value!="null")Text("$label: $value")}
        val hasDNA=model.dataUnlocked&&model.metadata.optInt("count")>0
        Button(onClick={model.analyze(study)},enabled=!model.busy&&hasDNA){Text("Match my DNA on device")}
        if(!hasDNA)Text(if(model.dataUnlocked)"Import your DNA in More → Vault to match this study." else "Unlock your saved data to match this study.",style=MaterialTheme.typography.bodySmall)
        remember(model.resultsVersion,study.optInt("id")){model.resultFor(study.optInt("id"))}?.let{result->ResultCard(result)}
        val pmid=study.optString("pubmedid");if(pmid.matches(Regex("^[0-9]+$")))TextButton(onClick={openBrowser(context,"https://pubmed.ncbi.nlm.nih.gov/$pmid/")}){Text("Read original publication")}
        Text("An association does not establish causation or predict an individual's health outcome.",style=MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun ResultCard(result: JSONObject, onClick: (()->Unit)?=null){
    val evidence=remember(result.toString()){Core.obj("evidence",result)}
    val palette=remember(result.toString()){vaultCardPalette(Core.obj("preview_category",result).getString("id"))}
    val shape=androidx.compose.foundation.shape.RoundedCornerShape(40.dp);val colors=CardDefaults.cardColors(containerColor=palette.first,contentColor=palette.second)
    val body: @Composable ColumnScope.()->Unit={Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.vault_star),contentDescription=null,modifier=Modifier.size(28.dp));Text(result.optString("traitName"),fontFamily=Garamond,fontWeight=FontWeight.Medium,fontSize=24.sp);Text("${result.optString("matchedSnp")}: ${result.optString("userGenotype")} • ${if(result.optString("effectType")=="beta")"Beta" else "OR"} ${effectNumber(result.optDouble("riskScore"))}");Text(when(result.optString("riskLevel")){"increased"->"▲ Increased";"decreased"->"▼ Decreased";else->"● ${result.optString("riskLevel").replaceFirstChar{it.uppercase()}}"},fontWeight=FontWeight.Bold);Text(evidence.getString("label"),style=MaterialTheme.typography.labelSmall)}}
    if(onClick!=null)Card(onClick=onClick,modifier=Modifier.fillMaxWidth(),shape=shape,colors=colors,content=body) else Card(Modifier.fillMaxWidth(),shape=shape,colors=colors,content=body)
}

@Composable private fun ResultsScreen(model: ExplorerModel,openVault: ()->Unit,export: (String,String)->Unit,importResults: ()->Unit){
    var filter by remember{mutableStateOf("")};var direction by remember{mutableStateOf("All")};var sort by remember{mutableStateOf("Catalog order")}
    // Pages come from the Rust session, which filters and sorts; only visible pages are held here.
    var rows by remember{mutableStateOf(emptyList<JSONObject>())};var total by remember{mutableIntStateOf(0)};var loading by remember{mutableStateOf(false)}
    val sortKey=mapOf("Catalog order" to "catalog","Effect size" to "effect","P-value" to "pvalue")[sort]!!
    LaunchedEffect(filter,direction,sort,model.resultsVersion){
        val page=model.resultsPage(filter,direction.lowercase(),sortKey,0)
        rows=page.getJSONArray("rows").objects();total=page.getInt("total")
    }
    val hasDNA=model.metadata.optInt("count")>0
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("${model.resultCount.grouped()} saved study matches",style=MaterialTheme.typography.titleLarge)
        Row(verticalAlignment=Alignment.CenterVertically){Button(onClick={model.runAll()},enabled=!model.busy&&hasDNA){Text("Run all studies")};Spacer(Modifier.width(8.dp));TextButton(onClick={export("monadic-results.tsv",model.exportResults())},enabled=model.resultCount>0){Text("Export")};TextButton(onClick=importResults){Text("Import")}}
        model.catalogInfo?.let{Text("Research catalog ${it.optString("version")} • ${it.optInt("rows").grouped()} studies • bundled with this app",style=MaterialTheme.typography.bodySmall)}
        if(model.resultCount==0){
            Text(when{!model.dataUnlocked->"Unlock your saved data to see saved matches.";!hasDNA->"Import a raw DNA file first. Then Run all studies compares it with the research catalog on this device.";else->"Choose Run all studies to compare your DNA with the research catalog bundled with this app. Matching runs on this device and takes under a minute."})
            if(!hasDNA)OutlinedButton(onClick=openVault){Text("Go to Vault")}
        } else {
            OutlinedTextField(value=filter,onValueChange={filter=it},label={Text("Filter saved traits")},modifier=Modifier.fillMaxWidth())
            Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                listOf("All","Increased","Decreased").forEach{FilterChip(selected=direction==it,onClick={direction=it},label={Text(it)})}
                listOf("Catalog order","Effect size","P-value").forEach{FilterChip(selected=sort==it,onClick={sort=it},label={Text(it)})}
            }
            if(total!=model.resultCount)Text("Showing ${total.grouped()} of ${model.resultCount.grouped()}",style=MaterialTheme.typography.bodySmall)
            LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){
                itemsIndexed(rows,key={_,row->row.optInt("studyId")}){index,result->
                    ResultCard(result){model.loadStudy(result.optInt("studyId"))}
                    // Load the next page as the list nears its end.
                    if(index>=rows.size-10&&rows.size<total&&!loading)LaunchedEffect(rows.size){
                        loading=true
                        val page=model.resultsPage(filter,direction.lowercase(),sortKey,rows.size)
                        rows=rows+page.getJSONArray("rows").objects();loading=false
                    }
                }
            }
        }
    }
}

@Composable private fun Consent(model: ExplorerModel){CheckRow(model.shareResultsWithLLM,{model.shareResultsWithLLM=it},"Allow matched results and profile context to be sent to my selected LLM provider.")}
/** Explains what Chat or a premium report needs and links to Account, instead of a bare error. */
@Composable private fun AccessNeeded(model: ExplorerModel, openAccount: ()->Unit){
    val needed=model.accessNeeded ?: return
    OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(if(needed=="sign-in")"Sign in to use Premium features" else "Premium needed",style=MaterialTheme.typography.titleMedium)
        Text(model.error ?: "",style=MaterialTheme.typography.bodyMedium)
        Text(if(needed=="sign-in")"Chat and the Healthspan, Top traits and Overview reports are part of Premium. The Health report is free." else "Subscribe, or buy a pass for a single report, in Account.",style=MaterialTheme.typography.bodySmall)
        Button(onClick=openAccount){Text(if(needed=="sign-in")"Sign in" else "See Premium options")}
    }}
}
@Composable private fun ChatScreen(model: ExplorerModel,openSettings: ()->Unit,personalize: ()->Unit,openAccount: ()->Unit){
    var message by remember{mutableStateOf(model.chatDraft)}
    LaunchedEffect(Unit){model.chatDraft=""}
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        val providerName=mapOf("nilai" to "nilAI","huggingface" to "HuggingFace","ollama" to "Ollama")[model.provider]?:model.provider
        Row(verticalAlignment=Alignment.CenterVertically){Text("Provider: $providerName • ${model.model}",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);TextButton(onClick=openSettings){Text("Change")}}
        Consent(model)
        // While an access requirement is shown, it takes the place of the intro so its button stays visible.
        if(model.messages.isEmpty()&&model.accessNeeded==null){
            Text(when{(model.resultCount==0)->"Chat answers questions about your research matches. Add your DNA file on Home first.";!model.shareResultsWithLLM->"To start, allow sharing above. Your matches go only to the provider shown.";else->"Ask anything about your results, or start with a suggestion."},style=MaterialTheme.typography.bodyMedium)
            if((model.resultCount>0))CHAT_SUGGESTIONS.forEach{SuggestionChip(onClick={message=it},label={Text(it)})}
            if((model.resultCount>0)&&!model.personalized)TextButton(onClick=personalize){Text("Personalize answers")}
        }
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){items(model.messages.toList()){(role,text)->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(if(role=="user")"You" else "Explorer",fontWeight=FontWeight.Bold);if(role=="user")Text(text) else MarkdownText(text)}}}}
        OutlinedTextField(value=message,onValueChange={message=it},label={Text("Ask about your matched findings")},modifier=Modifier.fillMaxWidth())
        AccessNeeded(model,openAccount)
        Button(onClick={model.sendChat(message){message=""}},enabled=!model.busy&&message.isNotBlank()){Text("Send")}
    }
}
@Composable private fun ReportScreen(model: ExplorerModel,openChat: ()->Unit,openAccount: ()->Unit,export: ()->Unit){ScreenColumn{
    Text("Reports",style=MaterialTheme.typography.headlineMedium)
    Text(if((model.resultCount==0))"Reports summarize your research matches. Add your DNA file on Home first." else "Each report reads your ${model.resultCount.grouped()} research matches${if(model.personalized)" and what you told us about yourself" else ""}.",style=MaterialTheme.typography.bodyMedium)
    Consent(model)
    ReportCards(model){kind->if(!model.busy&&(model.resultCount>0))model.generateReport(kind)}
    AccessNeeded(model,openAccount)
    if(model.report.isNotEmpty()){
        Text(model.reportTitle,style=MaterialTheme.typography.titleLarge);MarkdownText(model.report)
        Button(onClick=export){Text("Export report")}
        if(model.reportQuestions.isNotEmpty())Text("Ask a follow-up",style=MaterialTheme.typography.titleMedium)
        model.reportQuestions.forEach{question->SuggestionChip(onClick={model.chatDraft=question;openChat()},label={Text(question)})}
    }
}}

@Composable private fun VaultScreen(model:ExplorerModel,importDNA:()->Unit){
    var confirm by remember{mutableStateOf(false)}
    ScreenColumn{
        VaultArt(R.drawable.vault_vault)
        Text("Private on-device data",style=MaterialTheme.typography.headlineMedium)
        Text("Your DNA, results and personalization are kept in an encrypted database on this device. Unlocking needs your device authentication, and locking closes it.")
        Text(if(model.dataUnlocked)"Key protection: ${model.dataVault.protection}" else "Locked. Your data stays encrypted until you unlock it.",style=MaterialTheme.typography.bodySmall)
        CheckRow(model.acceptedDisclaimer,{model.acceptedDisclaimer=it},"I understand this is educational research, not medical advice.")
        Button(onClick={model.run("Preparing secure import"){model.unlockData();importDNA()}},enabled=model.acceptedDisclaimer&&!model.busy){Text("Import raw DNA (.txt, .tsv, .csv, .gz)")}
        if(!model.acceptedDisclaimer)Text("Tick the box above to enable import.",style=MaterialTheme.typography.bodySmall)
        if(!model.dataUnlocked) OutlinedButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock saved data")}
        else OutlinedButton(onClick=model::lockData,enabled=!model.busy){Text("Lock")}
        Text("Sync across your devices",style=MaterialTheme.typography.titleLarge)
        Text("An end-to-end encrypted copy is kept so a new Android device signed in to your Google account fills in automatically. The server can't read it, and no sign-in is needed.")
        Row(Modifier.fillMaxWidth().toggleable(value=model.syncEnabled,enabled=model.dataUnlocked&&!model.busy,role=Role.Switch,onValueChange={model.setSync(it)}),verticalAlignment=Alignment.CenterVertically){
            Text(if(model.syncEnabled)"On" else "Off",Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge);Switch(checked=model.syncEnabled,onCheckedChange=null,enabled=model.dataUnlocked&&!model.busy)
        }
        Text(when{!model.dataUnlocked->"Unlock to change sync.";model.syncing->"Syncing…";model.syncMessage.isNotBlank()->model.syncMessage;model.syncEnabled->"Up to date.";else->"Turning sync off deleted the cloud copy. Data on this device is unchanged."},style=MaterialTheme.typography.bodySmall)
        if(model.syncEnabled&&model.restoreWarning.isNotBlank())Text(model.restoreWarning,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
        TextButton(onClick={confirm=true},enabled=!model.busy&&(model.dataUnlocked||model.dataVault.exists)){Text("Delete data from this device")}
    }
    if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("Delete data from this device?")},
        text={Text(if(model.syncEnabled)"This removes your DNA, results and personalization from this device. The encrypted cloud copy stays, so you can restore it later." else "This removes your DNA, results and personalization from this device. Sync is off, so there is no other copy.")},
        confirmButton={TextButton(onClick={confirm=false;model.deleteVault()}){Text("Delete")}},dismissButton={TextButton(onClick={confirm=false}){Text("Cancel")}})
}

@Composable private fun SettingsScreen(model: ExplorerModel){ScreenColumn{
    Text("Connection and AI provider",style=MaterialTheme.typography.headlineMedium)
    OutlinedTextField(value=model.backend,onValueChange={model.backend=it},label={Text("Explorer backend HTTPS origin")},modifier=Modifier.fillMaxWidth())
    Text("The backend hosts the research catalog and account services. Your raw DNA stays on device.")
    Row{listOf("huggingface","ollama","nilai").forEach{provider->FilterChip(selected=model.provider==provider,onClick={model.selectProvider(provider)},label={Text(provider)})}}
    OutlinedTextField(value=model.model,onValueChange={model.model=it},label={Text("Model")},modifier=Modifier.fillMaxWidth())
    OutlinedTextField(value=model.apiKey,onValueChange={model.apiKey=it},label={Text("Your provider API key")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
    if(model.provider=="ollama"){OutlinedTextField(value=model.ollamaAddress,onValueChange={model.ollamaAddress=it},label={Text("Ollama hostname")});OutlinedTextField(value=model.ollamaPort,onValueChange={model.ollamaPort=it},label={Text("Ollama port")})}
    if(model.provider=="nilai")Text("Leave the key blank to use one-use backend delegation. Prompts go directly from this device to nilAI; only your public key visits the backend.",style=MaterialTheme.typography.bodySmall)
    Button(onClick={model.run("Saving settings"){model.settingsSaved()}},enabled=!model.busy){Text("Save securely")}
}}

@Composable private fun AccountScreen(model: ExplorerModel){
    val context=LocalContext.current
    val billing=model.billing
    LaunchedEffect(Unit) { billing.load() }
    ScreenColumn{
        Text("Account and premium",style=MaterialTheme.typography.headlineMedium)
        Text(model.wallet.ifBlank{"Not signed in"})
        Button(onClick={model.run("Opening secure sign-in"){openBrowser(context,model.beginAuth())}},enabled=!model.busy){Text("Sign in with Dynamic")}
        OutlinedButton(onClick=model::refreshSubscription,enabled=!model.busy&&model.wallet.isNotBlank()){Text("Refresh access")}
        model.subscription?.optJSONObject("subscription")?.let { Text(if(it.optBoolean("isActive")) "Premium access is active" else "No active subscription") }
        Text("Google Play purchases",style=MaterialTheme.typography.titleLarge)
        Text("Sign in to associate purchases with your Explorer account. Prices and payment confirmation are provided by Google Play.")
        billing.products.forEach { product ->
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(product.name,style=MaterialTheme.typography.titleMedium)
                Text(product.description)
                val price=billing.price(product)
                Button(onClick={billing.purchase(context as android.app.Activity,product)},enabled=!billing.busy&&model.wallet.isNotBlank()&&price!=null) {
                    Text(if(product.productType==com.android.billingclient.api.BillingClient.ProductType.SUBS) "Subscribe — $price / month" else "Buy — $price")
                }
            } }
        }
        OutlinedButton(onClick=billing::load,enabled=!billing.busy){Text("Reload products")}
        OutlinedButton(onClick=billing::restore,enabled=!billing.busy&&model.wallet.isNotBlank()){Text("Restore purchases")}
        TextButton(onClick={openBrowser(context,"https://play.google.com/store/account/subscriptions?package=com.monadicdna.explorer")}){Text("Manage Google Play subscriptions")}
        if(billing.busy) CircularProgressIndicator()
        if(billing.message.isNotBlank()) Text(billing.message)
        Text("The monthly subscription renews automatically unless cancelled in Google Play. One-time report purchases each provide one report run.",style=MaterialTheme.typography.bodySmall)
        Text("Stablecoin payments",style=MaterialTheme.typography.titleLarge)
        Text("Stablecoin payments are available only on Web. They are not available in the Android app.")
        TextButton(onClick=model::signOut){Text("Sign out")}
    }
}
private val REPORTS=listOf(
    "Health" to "Health findings with the strongest research evidence.",
    "Healthspan" to "What your matches suggest about healthy aging.",
    "Top traits" to "Your most notable trait associations.",
    "Overview" to "A summary across all of your matches."
)
private val CHAT_SUGGESTIONS=listOf("Which of my results have the strongest evidence?","What do my results say about heart health?","Is there anything I could discuss with my doctor?")

// Steps on Home: import DNA (Run all follows automatically), personalize, then Chat and Reports.
@Composable private fun HomeScreen(model: ExplorerModel, go: (String)->Unit, importDNA: ()->Unit){
    val variants=model.metadata.optInt("count")
    val ready=(model.resultCount>0)&&(model.personalized||model.personalizeSkipped)
    ScreenColumn{
        if(!model.dataUnlocked&&!model.dataVault.exists&&model.restorable){
            VaultHero()
            Text("Your data is ready to restore",style=MaterialTheme.typography.headlineMedium)
            Text("An encrypted copy of your DNA, results and personalization from your other device is available. Confirm it's you to restore it on this device.",style=MaterialTheme.typography.bodyMedium)
            Button(onClick=model::unlockSavedData,enabled=!model.busy){Text("Restore my data")}
        } else if(!model.dataUnlocked&&model.dataVault.exists){
            VaultHero()
            Text("Welcome back. Unlock your saved data to continue.",style=MaterialTheme.typography.titleMedium)
            Button(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock saved data")}
        } else if(ready){
            Text("Ask about your DNA",style=MaterialTheme.typography.headlineMedium)
            Text("Chat answers questions using your ${model.resultCount.grouped()} research matches${if(model.personalized)" and what you told us about yourself" else ""}.",style=MaterialTheme.typography.bodyMedium)
            var question by remember{mutableStateOf("")}
            OutlinedTextField(value=question,onValueChange={question=it},label={Text("What would you like to know?")},modifier=Modifier.fillMaxWidth())
            Button(onClick={model.chatDraft=question;go("Chat")},enabled=question.isNotBlank()){Text("Ask")}
            CHAT_SUGGESTIONS.forEach{suggestion->SuggestionChip(onClick={model.chatDraft=suggestion;go("Chat")},label={Text(suggestion)})}
            if(!model.personalized)OutlinedCard(onClick={go("You")},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){Text("Make answers about you",style=MaterialTheme.typography.titleMedium);Text("Add your age, ancestry and health history. It stays encrypted on this device.",style=MaterialTheme.typography.bodySmall)}}
            Text("Reports",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))
            ReportCards(model){go("Reports")}
            Row(verticalAlignment=Alignment.CenterVertically){
                Text("${variants.grouped()} variants • ${model.resultCount.grouped()} matches",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                TextButton(onClick={go("Results")}){Text("Matches")};TextButton(onClick={go("Browse")}){Text("Browse")}
            }
        } else {
            if(model.syncing&&variants==0)Text("Restoring your data from your other device…",style=MaterialTheme.typography.titleMedium)
            Text("Understand what your DNA says about you",style=MaterialTheme.typography.headlineMedium)
            if(variants==0)Text("Explorer compares your raw DNA file with published genetic research on this device. Then you can ask questions about your results and read reports.",style=MaterialTheme.typography.bodyMedium)
            Step(1,"Add your DNA file",done=variants>0,enabled=true){
                if(variants>0){
                    Text("${variants.grouped()} variants • ${model.resultCount.grouped()} research matches",style=MaterialTheme.typography.bodySmall)
                    // Matching normally follows the import; this covers a cancelled or failed run.
                    if((model.resultCount==0)&&!model.busy)Button(onClick=model::runAll){Text("Find research matches")}
                }
                else {
                    Text("Raw data from 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome or Monadic DNA. It never leaves this device.",style=MaterialTheme.typography.bodySmall)
                    CheckRow(model.acceptedDisclaimer,{model.acceptedDisclaimer=it},"I understand this is educational research, not medical advice.")
                    Button(onClick={model.run("Preparing secure import"){model.unlockData();importDNA()}},enabled=model.acceptedDisclaimer&&!model.busy){Text("Choose DNA file")}
                }
            }
            Step(2,"Tell us about you",done=model.personalized,enabled=variants>0){
                Text("Age, ancestry and health history make Chat and Reports specific to you. Everything you enter is optional and stays encrypted on this device.",style=MaterialTheme.typography.bodySmall)
                if(variants>0&&!model.personalized)Row{Button(onClick={go("You")}){Text("Personalize")};TextButton(onClick=model::skipPersonalization){Text("Skip for now")}}
            }
            // Home switches to Chat and Reports once steps 1 and 2 are done, so step 3 is a preview here.
            Step(3,"Ask and read",done=false,enabled=false){
                Text("Chat about your results, or read a report such as the free Health report.",style=MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick={go("Browse")}){Text("Browse research without your DNA")}
        }
        Text("Genetic associations are educational research findings, not a diagnosis. Odds ratios are relative, not absolute risk; beta values describe trait changes.",style=MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun Step(number: Int, title: String, done: Boolean, enabled: Boolean, content: @Composable ColumnScope.()->Unit){
    // Done steps are tinted, the current step is outlined, and later steps are dimmed.
    val colors=if(done)CardDefaults.outlinedCardColors(containerColor=MaterialTheme.colorScheme.primaryContainer) else CardDefaults.outlinedCardColors()
    OutlinedCard(Modifier.fillMaxWidth().alpha(if(enabled)1f else 0.45f),colors=colors,border=androidx.compose.foundation.BorderStroke(if(enabled&&!done)2.dp else 1.dp,if(enabled&&!done)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text(if(done)"✓  $title" else "$number  $title",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold)
            if(enabled||!done)content()
        }
    }
}

@Composable private fun ReportCards(model: ExplorerModel, onClick: (String)->Unit){
    val premium=model.subscription?.optJSONObject("subscription")?.optBoolean("isActive")==true
    REPORTS.forEach{(kind,description)->
        OutlinedCard(onClick={onClick(kind)},modifier=Modifier.fillMaxWidth()){Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f)){Text("$kind report",style=MaterialTheme.typography.titleMedium);Text(description,style=MaterialTheme.typography.bodySmall)}
            Text(if(kind=="Health")"Free" else if(premium)"" else "Premium",style=MaterialTheme.typography.labelMedium)
        }}
    }
}

@Composable private fun YouScreen(model: ExplorerModel, done: ()->Unit, openVault: ()->Unit){ScreenColumn{
    Text("About you",style=MaterialTheme.typography.headlineMedium)
    Text("Optional details make Chat and Reports specific to you. They are encrypted on this device and only shared with your AI provider when you allow it.",style=MaterialTheme.typography.bodyMedium)
    if(!model.dataUnlocked){OutlinedButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock to edit")}}
    else {
        model.profileSchema.forEach { field ->
            val key=field.getString("key")
            if(field.getString("type")=="select") {
                Text(field.getString("label"),style=MaterialTheme.typography.labelLarge)
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { field.getJSONArray("options").objects().forEach { option ->
                    FilterChip(enabled=!model.syncing && !model.locking,selected=model.profileFields[key].orEmpty()==option.getString("value"),onClick={model.profileFields[key]=option.getString("value")},label={Text(option.getString("label"))})
                } }
            } else OutlinedTextField(value=model.profileFields[key].orEmpty(),onValueChange={model.profileFields[key]=it},enabled=!model.syncing && !model.locking,label={Text(field.getString("label"))},modifier=Modifier.fillMaxWidth())
        }
        OutlinedTextField(value=model.profile,onValueChange={model.profile=it},enabled=!model.syncing && !model.locking,label={Text("Anything else for your reports (optional)")},modifier=Modifier.fillMaxWidth())
        Text("Saved automatically.",style=MaterialTheme.typography.bodySmall)
        Button(onClick=done){Text("Done")}
    }
    Text("Your data",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))
    val variants=model.metadata.optInt("count")
    Text(if(variants>0)"${variants.grouped()} variants • ${model.resultCount.grouped()} research matches" else "No DNA file imported yet.",style=MaterialTheme.typography.bodyMedium)
    Row{OutlinedButton(onClick=openVault){Text("Vault and backups")};Spacer(Modifier.width(8.dp));if(model.dataUnlocked)TextButton(onClick=model::lockData,enabled=!model.busy){Text("Lock")}}
}}
