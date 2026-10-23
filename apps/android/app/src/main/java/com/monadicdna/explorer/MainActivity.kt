package com.monadicdna.explorer

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
    fun selectTab(name: String){tab=name;model.error=null}
    Scaffold(
        topBar={TopAppBar(title={Text("Explorer",style=MaterialTheme.typography.titleLarge)},actions={if(model.metadata.optInt("count")==0)TextButton(onClick={selectTab("Vault")}){Text("Import DNA")}})},
        bottomBar={NavigationBar(containerColor=MaterialTheme.colorScheme.background) { listOf("Home","Browse","Results","Chat","More").forEachIndexed{index,name->NavigationBarItem(selected=tab==name,onClick={selectTab(name)},label={Text(name)},icon={Icon(when(index){0->Icons.Default.Home;1->Icons.Default.Search;2->Icons.AutoMirrored.Filled.List;3->Icons.AutoMirrored.Filled.Chat;else->Icons.Default.MoreHoriz},contentDescription=name)})} }}
    ){padding->
        Column(Modifier.padding(padding).fillMaxSize()){
            Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
                val variants=model.metadata.optInt("count")
                Text(if(variants>0&&model.dataUnlocked)"${variants.grouped()} variants • ${model.storageMessage}" else model.storageMessage,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                if(model.dataUnlocked) TextButton(onClick=model::lockData,enabled=!model.busy){Text("Lock data")}
                else TextButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock data")}
            }
            if(model.busy){model.progress?.let{LinearProgressIndicator(progress={it},modifier=Modifier.fillMaxWidth())}?:LinearProgressIndicator(Modifier.fillMaxWidth());Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){Text(model.status,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium);if(model.cancellable)TextButton(onClick=model::cancel){Text("Cancel")}}}
            Messages(model)
            if(model.locking){Text("Your data is protected",Modifier.padding(24.dp))} else when(tab){
                "Home"->ScreenColumn{
                    VaultHero()
                    val variants=model.metadata.optInt("count")
                    if(variants==0)Button(onClick={selectTab("Vault")}){Text("Import your DNA")}
                    else if(model.results.isEmpty())Button(onClick={selectTab("Results");model.runAll()},enabled=!model.busy){Text("Run all studies")}
                    else Button(onClick={selectTab("Results")}){Text("View ${model.results.size.grouped()} matches")}
                    OutlinedButton(onClick={selectTab("Browse");model.browse("","",true)}){Text("Browse studies")}
                    Text(if(variants>0)"${variants.grouped()} variants • ${model.results.size.grouped()} saved study matches" else if(model.dataUnlocked)"No DNA imported yet." else "Unlock your saved data or import a raw DNA file to begin.")
                    if(model.results.isNotEmpty()){
                        val insight=remember(model.results){Core.obj("preview_insight",org.json.JSONArray(model.results))}
                        Text(insight.getString("headline"),style=MaterialTheme.typography.titleMedium)
                        Text("${insight.getInt("protectiveCount")} protective associations • ${insight.getInt("elevatedCount")} elevated associations")
                    }
                    Text("Genetic associations are educational research findings, not a diagnosis. Odds ratios are relative, not absolute risk; beta values describe trait changes.",style=MaterialTheme.typography.bodySmall)
                }
                "Browse"->BrowseScreen(model)
                "Results"->ResultsScreen(model,{selectTab("Vault")},{name,content->exportText(name,content)},{model.pickingFile=true;importResults.launch(arrayOf("text/*","application/json","application/octet-stream"))})
                "Chat"->ChatScreen(model){selectTab("Settings")}
                "Reports"->ReportScreen(model){exportText("monadic-report.md",model.report)}
                "Vault"->VaultScreen(model,{model.pickingFile=true;importDNA.launch(arrayOf("text/*","application/gzip","application/octet-stream"))}){name,content->exportText(name,content)}
                "Settings"->SettingsScreen(model)
                "Account"->AccountScreen(model)
                "More"->ScreenColumn{VaultArt(R.drawable.vault_discover);Text("More",style=MaterialTheme.typography.headlineMedium);listOf("Reports","Vault","Settings","Account").forEach{name->OutlinedButton(onClick={selectTab(name)},modifier=Modifier.fillMaxWidth()){Text(name)}};Text("Genotype formats: 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, and Monadic DNA. Compressed .gz files are supported. Genetic data is processed on device.")}
            }
        }
    }
    if(model.selectedStudy!=null) ModalBottomSheet(onDismissRequest={model.selectedStudy=null}){Column(Modifier.navigationBarsPadding()){Messages(model);StudyScreen(model,model.selectedStudy!!)}}
}

@Composable private fun Messages(model: ExplorerModel){
    model.error?.let{message->Card(Modifier.padding(horizontal=12.dp,vertical=6.dp).fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(message,color=MaterialTheme.colorScheme.error);TextButton(onClick={model.error=null}){Text("Dismiss")}}}}
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
        model.results.firstOrNull{it.optInt("studyId")==study.optInt("id")}?.let{result->ResultCard(result)}
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
    val shown=remember(model.results,filter,direction,sort){
        val rows=model.results.filter{it.optString("traitName").contains(filter,true)&&(direction=="All"||it.optString("riskLevel").equals(direction,true))}
        when(sort){
            "Effect size"->rows.sortedByDescending{val v=it.optDouble("riskScore");if(it.optString("effectType")=="beta")kotlin.math.abs(v) else kotlin.math.abs(kotlin.math.ln(v.coerceAtLeast(1e-9)))}
            "P-value"->rows.sortedByDescending{it.optDouble("pValueMlog",0.0)}
            else->rows
        }
    }
    val hasDNA=model.metadata.optInt("count")>0
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("${model.results.size.grouped()} saved study matches",style=MaterialTheme.typography.titleLarge)
        Row(verticalAlignment=Alignment.CenterVertically){Button(onClick={model.runAll()},enabled=!model.busy&&hasDNA){Text("Run all studies")};Spacer(Modifier.width(8.dp));TextButton(onClick={export("monadic-results.tsv",model.exportResults())},enabled=model.results.isNotEmpty()){Text("Export")};TextButton(onClick=importResults){Text("Import")}}
        model.catalogInfo?.let{Text("Research catalog ${it.optString("version")} • ${it.optInt("rows").grouped()} studies • bundled with this app",style=MaterialTheme.typography.bodySmall)}
        if(model.results.isEmpty()){
            Text(when{!model.dataUnlocked->"Unlock your saved data to see saved matches.";!hasDNA->"Import a raw DNA file first. Then Run all studies compares it with the research catalog on this device.";else->"Choose Run all studies to compare your DNA with the research catalog bundled with this app. Matching runs on this device and takes under a minute."})
            if(!hasDNA)OutlinedButton(onClick=openVault){Text("Go to Vault")}
        } else {
            OutlinedTextField(value=filter,onValueChange={filter=it},label={Text("Filter saved traits")},modifier=Modifier.fillMaxWidth())
            Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                listOf("All","Increased","Decreased").forEach{FilterChip(selected=direction==it,onClick={direction=it},label={Text(it)})}
                listOf("Catalog order","Effect size","P-value").forEach{FilterChip(selected=sort==it,onClick={sort=it},label={Text(it)})}
            }
            if(shown.size!=model.results.size)Text("Showing ${shown.size.grouped()} of ${model.results.size.grouped()}",style=MaterialTheme.typography.bodySmall)
            LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){items(shown,key={it.optInt("studyId")}){result->ResultCard(result){model.loadStudy(result.optInt("studyId"))}}}
        }
    }
}

@Composable private fun Consent(model: ExplorerModel){CheckRow(model.shareResultsWithLLM,{model.shareResultsWithLLM=it},"Allow matched results and profile context to be sent to my selected LLM provider.")}
@Composable private fun ChatScreen(model: ExplorerModel,openSettings: ()->Unit){
    var message by remember{mutableStateOf("")}
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        val providerName=mapOf("nilai" to "nilAI","huggingface" to "HuggingFace","ollama" to "Ollama")[model.provider]?:model.provider
        Row(verticalAlignment=Alignment.CenterVertically){Text("Provider: $providerName • ${model.model}",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);TextButton(onClick=openSettings){Text("Change")}}
        Consent(model)
        if(model.messages.isEmpty())Text(when{model.results.isEmpty()->"Chat answers questions about your saved matches. Run all studies in Results first.";!model.shareResultsWithLLM->"To start, allow sharing above. Your matched results go only to the provider shown.";else->"Ask a question about your matched findings, for example which traits have the strongest evidence."},style=MaterialTheme.typography.bodyMedium)
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){items(model.messages.toList()){(role,text)->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(role,fontWeight=FontWeight.Bold);Text(text)}}}}
        OutlinedTextField(value=message,onValueChange={message=it},label={Text("Ask about your matched findings")},modifier=Modifier.fillMaxWidth())
        Button(onClick={model.sendChat(message);message=""},enabled=!model.busy&&message.isNotBlank()){Text("Send")}
    }
}
@Composable private fun ReportScreen(model: ExplorerModel,export: ()->Unit){ScreenColumn{VaultArt(R.drawable.vault_discover);Text("Genetic research reports",style=MaterialTheme.typography.headlineMedium);Consent(model);listOf("Overview","Health","Healthspan","Top traits").forEach{kind->OutlinedButton(onClick={model.generateReport(kind)},enabled=!model.busy&&model.results.isNotEmpty()){Text("Generate $kind")}};if(model.report.isNotEmpty()){Text(model.reportTitle,style=MaterialTheme.typography.titleLarge);Text(model.report);Button(onClick=export){Text("Export report")};model.reportQuestions.forEach{question->OutlinedButton(onClick={model.sendChat(question)},enabled=!model.busy){Text(question)}}}}}

@Composable private fun VaultScreen(model:ExplorerModel,importDNA:()->Unit,export:(String,String)->Unit){
    var password by remember{mutableStateOf("")};var confirm by remember{mutableStateOf("")}
    val context=LocalContext.current
    val importBackup=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->model.pickingFile=false;if(uri!=null)model.run("Restoring encrypted backup"){
        val bytes=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readDocument(context,uri)}
        val pass=password;password="";model.openVaultData(pass,bytes.toString(Charsets.UTF_8))
    }}
    ScreenColumn{
        VaultArt(R.drawable.vault_vault)
        Text("Private on-device data",style=MaterialTheme.typography.headlineMedium)
        Text("DNA, results and customization save automatically while unlocked. Unlock with your device authentication. Locking clears decrypted data from this app's memory.")
        Text(if(model.dataUnlocked)"Key protection: ${model.dataVault.protection}" else "Locked. Your data stays encrypted until you unlock it.",style=MaterialTheme.typography.bodySmall)
        CheckRow(model.acceptedDisclaimer,{model.acceptedDisclaimer=it},"I understand this is educational research, not medical advice.")
        Button(onClick={model.run("Preparing secure import"){model.unlockData();importDNA()}},enabled=model.acceptedDisclaimer&&!model.busy){Text("Import raw DNA (.txt, .tsv, .csv, .gz)")}
        if(!model.acceptedDisclaimer)Text("Tick the box above to enable import.",style=MaterialTheme.typography.bodySmall)
        if(!model.dataUnlocked) OutlinedButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock saved data")}
        else OutlinedButton(onClick=model::lockData,enabled=!model.busy){Text("Lock and clear decrypted data")}
        Text("Recovery and encrypted sync",style=MaterialTheme.typography.titleLarge)
        Text("Use a long, unique recovery passphrase (at least 12 characters). It protects exported backups and lets your other devices unlock encrypted cloud data. Keep it safe; we cannot recover it for you.")
        OutlinedTextField(value=password,onValueChange={password=it},label={Text("Recovery passphrase")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
        OutlinedButton(onClick={val pass=password;password="";model.run("Exporting encrypted backup"){export("monadic-vault.json",model.sealedVault(pass))}},enabled=!model.busy&&model.dataUnlocked&&password.length>=12){Text("Export encrypted backup")}
        OutlinedButton(onClick={model.pickingFile=true;importBackup.launch(arrayOf("application/json","text/*","application/octet-stream"))},enabled=!model.busy&&password.isNotEmpty()){Text("Restore encrypted backup (replaces device data)")}
        OutlinedButton(onClick={val pass=password;password="";model.enableSync(pass)},enabled=!model.busy&&model.dataUnlocked&&model.wallet.isNotBlank()&&password.length>=12){Text("Enable encrypted sync")}
        OutlinedButton(onClick=model::syncNow,enabled=!model.busy&&model.dataUnlocked&&model.wallet.isNotBlank()){Text("Sync now")}
        OutlinedButton(onClick={confirm="cloudRestore"},enabled=!model.busy&&model.wallet.isNotBlank()&&password.isNotEmpty()){Text("Restore cloud copy (replaces device data)")}
        TextButton(onClick=model::disableSync,enabled=model.dataUnlocked && !model.syncing && !model.locking&&!model.busy){Text("Disable sync on this device")}
        TextButton(onClick={confirm="cloudDelete"},enabled=model.dataUnlocked && !model.syncing && !model.locking&&!model.busy&&model.wallet.isNotBlank()){Text("Delete cloud copy")}
        Text("Sync is optional and requires sign-in. Only encrypted data is uploaded. Hardware keys stay on each device; the recovery passphrase is never sent to the server.",style=MaterialTheme.typography.bodySmall)
        TextButton(onClick={confirm="localDelete"},enabled=!model.busy){Text("Delete data from this device")}
        if(java.io.File(context.filesDir,"vault.json").exists())OutlinedButton(onClick={val pass=password;password="";model.openVault(pass)},enabled=password.isNotEmpty()&&!model.busy){Text("Migrate previous saved vault")}
    }
    if(confirm.isNotEmpty())AlertDialog(onDismissRequest={confirm=""},title={Text(if(confirm=="cloudRestore")"Replace device data?" else "Delete encrypted data?")},text={Text(when(confirm){"cloudRestore"->"The cloud copy will replace DNA, results and customization on this device. Export a backup first if you want to retain local changes.";"cloudDelete"->"Delete the account's encrypted cloud copy. Other devices retain their local copies.";else->"Delete this device's encrypted data and its device wrapping key. Cloud copies and exported backups remain."})},confirmButton={TextButton(onClick={val action=confirm;confirm="";when(action){"cloudRestore"->{val pass=password;password="";model.restoreCloud(pass)};"cloudDelete"->model.deleteCloud();else->model.deleteVault()}}){Text("Confirm")}},dismissButton={TextButton(onClick={confirm=""}){Text("Cancel")}})
}

@Composable private fun SettingsScreen(model: ExplorerModel){ScreenColumn{
    Text("Connection and providers",style=MaterialTheme.typography.headlineMedium)
    OutlinedTextField(value=model.backend,onValueChange={model.backend=it},label={Text("Explorer backend HTTPS origin")},modifier=Modifier.fillMaxWidth())
    Text("The backend hosts the research catalog and account services. Your raw DNA stays on device.")
    Row{listOf("huggingface","ollama","nilai").forEach{provider->FilterChip(selected=model.provider==provider,onClick={model.selectProvider(provider)},label={Text(provider)})}}
    OutlinedTextField(value=model.model,onValueChange={model.model=it},label={Text("Model")},modifier=Modifier.fillMaxWidth())
    OutlinedTextField(value=model.apiKey,onValueChange={model.apiKey=it},label={Text("Your provider API key")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
    if(model.provider=="ollama"){OutlinedTextField(value=model.ollamaAddress,onValueChange={model.ollamaAddress=it},label={Text("Ollama hostname")});OutlinedTextField(value=model.ollamaPort,onValueChange={model.ollamaPort=it},label={Text("Ollama port")})}
    if(model.provider=="nilai")Text("Leave the key blank to use one-use backend delegation. Prompts go directly from this device to nilAI; only your public key visits the backend.",style=MaterialTheme.typography.bodySmall)
    Text("Optional personalization",style=MaterialTheme.typography.titleLarge)
    if(!model.dataUnlocked) {Text("Unlock saved data to view or edit customization.");OutlinedButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock customization")}}
    model.profileSchema.forEach { field ->
        val key=field.getString("key")
        if(field.getString("type")=="select") {
            Text(field.getString("label"))
            Row(Modifier.horizontalScroll(rememberScrollState())) { field.getJSONArray("options").objects().forEach { option ->
                FilterChip(enabled=model.dataUnlocked && !model.syncing && !model.locking,selected=model.profileFields[key]==option.getString("value"),onClick={model.profileFields[key]=option.getString("value")},label={Text(option.getString("label"))})
            } }
        } else OutlinedTextField(value=model.profileFields[key].orEmpty(),onValueChange={model.profileFields[key]=it},enabled=model.dataUnlocked && !model.syncing && !model.locking,label={Text(field.getString("label"))},modifier=Modifier.fillMaxWidth())
    }
    OutlinedTextField(value=model.profile,onValueChange={model.profile=it},enabled=model.dataUnlocked && !model.syncing && !model.locking,label={Text("Optional personalization context")},modifier=Modifier.fillMaxWidth())
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
