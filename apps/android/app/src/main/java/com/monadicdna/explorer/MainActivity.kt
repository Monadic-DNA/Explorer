package com.monadicdna.explorer

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity: ComponentActivity() {
    private val model by lazy { ViewModelProvider(this)[ExplorerModel::class.java] }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.takeIf{it.scheme=="monadicexplorer"&&it.host=="auth"}?.let(model::receiveAuth)
        setContent { VaultTheme { ExplorerApp(model) } }
    }
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
    val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")){uri->if(uri!=null)model.run("Writing export"){kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){context.contentResolver.openOutputStream(uri)!!.use{it.write(exportContent.toByteArray())}};exportContent=""}}
    val importDNA=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null){model.run("Reading DNA file"){
        val bytes=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readDocument(context,uri)}
        // Schedule import after this short IO operation has completed.
        model.importGenotypeData(bytes,uri.lastPathSegment?:"genotype.txt")
    }}}
    val importResults=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)model.run("Reading results"){
        val content=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readDocument(context,uri).toString(Charsets.UTF_8)}
        val name=if(uri.toString().endsWith("json"))"results.json" else "results.tsv"
        model.importResultsData(content,name)
    }}
    fun exportText(name: String, content: String){exportContent=content;export.launch(name)}
    Scaffold(
        topBar={TopAppBar(title={Text("Explorer",style=MaterialTheme.typography.titleLarge)},actions={TextButton(onClick={tab="Vault"}){Text(if(model.metadata.optInt("count")>0)"DNA loaded" else "Import DNA")}})},
        bottomBar={NavigationBar(containerColor=MaterialTheme.colorScheme.background) { listOf("Home","Browse","Results","Chat","More").forEachIndexed{index,name->NavigationBarItem(selected=tab==name,onClick={tab=name},label={Text(name)},icon={Icon(when(index){0->Icons.Default.Home;1->Icons.Default.Search;2->Icons.AutoMirrored.Filled.List;3->Icons.AutoMirrored.Filled.Chat;else->Icons.Default.MoreHoriz},contentDescription=name)})} }}
    ){padding->
        Column(Modifier.padding(padding).fillMaxSize()){
            if(model.busy){LinearProgressIndicator(Modifier.fillMaxWidth());Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween){Text(model.status,Modifier.weight(1f));TextButton(onClick=model::cancel){Text("Cancel")}}}
            model.error?.let{message->Card(Modifier.padding(12.dp)){Column(Modifier.padding(12.dp)){Text(message,color=MaterialTheme.colorScheme.error);TextButton(onClick={model.error=null}){Text("Dismiss")}}}}
            when(tab){
                "Home"->ScreenColumn{
                    VaultHero()
                    Button(onClick={tab="Vault"}){Text("Import your DNA")}
                    OutlinedButton(onClick={tab="Browse";model.browse("","",true)}){Text("Browse studies")}
                    Text("${model.metadata.optInt("count")} variants • ${model.results.size} saved study matches")
                    if(model.results.isNotEmpty()){
                        val insight=remember(model.results){Core.obj("preview_insight",org.json.JSONArray(model.results))}
                        Text(insight.getString("headline"),style=MaterialTheme.typography.titleMedium)
                        Text("${insight.getInt("protectiveCount")} protective associations • ${insight.getInt("elevatedCount")} elevated associations")
                    }
                    Text("Genetic associations are educational research findings, not a diagnosis. Odds ratios are relative, not absolute risk; beta values describe trait changes.",style=MaterialTheme.typography.bodySmall)
                }
                "Browse"->BrowseScreen(model)
                "Results"->ResultsScreen(model,{name,content->exportText(name,content)},{importResults.launch(arrayOf("text/*","application/json","application/octet-stream"))})
                "Chat"->ChatScreen(model)
                "Reports"->ReportScreen(model){exportText("monadic-report.md",model.report)}
                "Vault"->VaultScreen(model,{importDNA.launch(arrayOf("text/*","application/gzip","application/octet-stream"))}){name,content->exportText(name,content)}
                "Settings"->SettingsScreen(model)
                "Account"->AccountScreen(model)
                "More"->ScreenColumn{VaultArt(R.drawable.vault_vault);Text("Entirely in your hands.",style=MaterialTheme.typography.headlineMedium);listOf("Reports","Vault","Settings","Account").forEach{name->OutlinedButton(onClick={tab=name},modifier=Modifier.fillMaxWidth()){Text(name)}};Text("Genotype formats: 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, and Monadic DNA. Compressed .gz files are supported. Genetic data is processed on device.")}
            }
        }
    }
    if(model.selectedStudy!=null) ModalBottomSheet(onDismissRequest={model.selectedStudy=null}){StudyScreen(model,model.selectedStudy!!)}
}

@Composable private fun ScreenColumn(content: @Composable ColumnScope.()->Unit){Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp),content=content)}

@Composable private fun BrowseScreen(model: ExplorerModel){
    var query by remember{mutableStateOf("")};var trait by remember{mutableStateOf("")};var semantic by remember{mutableStateOf(true)};var offset by remember{mutableIntStateOf(0)}
    Column(Modifier.fillMaxSize().padding(16.dp)){
        OutlinedTextField(value=query,onValueChange={query=it},label={Text("Search traits, studies, genes or SNPs")},modifier=Modifier.fillMaxWidth())
        OutlinedTextField(value=trait,onValueChange={trait=it},label={Text("Trait filter (optional)")},modifier=Modifier.fillMaxWidth())
        Row{Checkbox(checked=semantic,onCheckedChange={semantic=it});Text("Semantic search",Modifier.padding(top=12.dp));Spacer(Modifier.weight(1f));Button(onClick={offset=0;model.browse(query,trait,semantic)},enabled=!model.busy){Text("Search")}}
        if(model.studies.isEmpty())Text("Search the catalog to discover studies.")
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)){items(model.studies,key={it.optInt("id")}){study->Card(onClick={model.showStudy(study)},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){Text(study.optString("disease_trait","Unknown trait"),fontWeight=FontWeight.Bold);Text(study.optString("study"),maxLines=3);Text("${study.optString("study_accession")} • ${study.optString("confidenceBand","Research finding")}",style=MaterialTheme.typography.labelSmall)}}}}
        Row(horizontalArrangement=Arrangement.SpaceBetween,modifier=Modifier.fillMaxWidth()){TextButton(onClick={offset=(offset-50).coerceAtLeast(0);model.browse(query,trait,semantic,offset)},enabled=offset>0&&!model.busy){Text("Previous")};TextButton(onClick={offset+=50;model.browse(query,trait,semantic,offset)},enabled=model.studies.isNotEmpty()&&!model.busy){Text("Next")}}
    }
}

@Composable private fun StudyScreen(model: ExplorerModel,study: JSONObject){
    val context=LocalContext.current
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(study.optString("disease_trait"),style=MaterialTheme.typography.headlineMedium);Text(study.optString("study"))
        for((key,label) in listOf("study_accession" to "Accession","mapped_gene" to "Genes","snps" to "Variants","strongest_snp_risk_allele" to "Reported risk allele","or_or_beta" to "OR / beta","ci_text" to "Effect interval","p_value" to "P-value","initial_sample_size" to "Discovery sample","replication_sample_size" to "Replication sample","first_author" to "Author","journal" to "Journal","date" to "Publication date")){val value=study.optString(key);if(value.isNotBlank()&&value!="null")Text("$label: $value")}
        Button(onClick={model.analyze(study)},enabled=!model.busy){Text("Match my DNA on device")}
        model.results.firstOrNull{it.optInt("studyId")==study.optInt("id")}?.let{result->ResultCard(result)}
        val pmid=study.optString("pubmedid");if(pmid.matches(Regex("^[0-9]+$")))TextButton(onClick={openBrowser(context,"https://pubmed.ncbi.nlm.nih.gov/$pmid/")}){Text("Read original publication")}
        Text("An association does not establish causation or predict an individual's health outcome.",style=MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun ResultCard(result: JSONObject){
    val evidence=remember(result.toString()){Core.obj("evidence",result)}
    val palette=remember(result.toString()){vaultCardPalette(Core.obj("preview_category",result).getString("id"))}
    Card(Modifier.fillMaxWidth(),shape=androidx.compose.foundation.shape.RoundedCornerShape(40.dp),colors=CardDefaults.cardColors(containerColor=palette.first,contentColor=palette.second)){Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.vault_star),contentDescription=null,modifier=Modifier.size(28.dp));Text(result.optString("traitName"),fontFamily=Garamond,fontWeight=FontWeight.Medium,fontSize=24.sp);Text("${result.optString("matchedSnp")}: ${result.optString("userGenotype")} • ${result.optString("effectType","OR")} ${result.optDouble("riskScore")}");Text(result.optString("riskLevel"));Text(evidence.getString("label"),style=MaterialTheme.typography.labelSmall)}}
}

@Composable private fun ResultsScreen(model: ExplorerModel,export: (String,String)->Unit,importResults: ()->Unit){
    var filter by remember{mutableStateOf("")}
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("${model.results.size} saved study matches",style=MaterialTheme.typography.titleLarge)
        Row{TextButton(onClick={model.runAll()},enabled=!model.busy){Text("Run all")};TextButton(onClick={export("monadic-results.tsv",model.exportResults())},enabled=model.results.isNotEmpty()){Text("Export")};TextButton(onClick=importResults){Text("Import")}}
        OutlinedTextField(value=filter,onValueChange={filter=it},label={Text("Filter saved traits")},modifier=Modifier.fillMaxWidth())
        LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){items(model.results.filter{it.optString("traitName").contains(filter,true)},key={it.optInt("studyId")}){result->ResultCard(result)}}
    }
}

@Composable private fun Consent(model: ExplorerModel){Row{Checkbox(checked=model.shareResultsWithLLM,onCheckedChange={model.shareResultsWithLLM=it});Text("Allow matched results and profile context to be sent to my selected LLM provider.",style=MaterialTheme.typography.bodySmall)}}
@Composable private fun ChatScreen(model: ExplorerModel){
    var message by remember{mutableStateOf("")}
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Consent(model)
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){items(model.messages.toList()){(role,text)->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(role,fontWeight=FontWeight.Bold);Text(text)}}}}
        OutlinedTextField(value=message,onValueChange={message=it},label={Text("Ask about your matched findings")},modifier=Modifier.fillMaxWidth())
        Button(onClick={model.sendChat(message);message=""},enabled=!model.busy&&message.isNotBlank()){Text("Send")}
    }
}
@Composable private fun ReportScreen(model: ExplorerModel,export: ()->Unit){ScreenColumn{VaultArt(R.drawable.vault_discover);Text("Genetic research reports",style=MaterialTheme.typography.headlineMedium);Consent(model);listOf("Overview","Health","Healthspan","Top traits").forEach{kind->OutlinedButton(onClick={model.generateReport(kind)},enabled=!model.busy&&model.results.isNotEmpty()){Text("Generate $kind")}};if(model.report.isNotEmpty()){Text(model.reportTitle,style=MaterialTheme.typography.titleLarge);Text(model.report);Button(onClick=export){Text("Export report")};model.reportQuestions.forEach{question->OutlinedButton(onClick={model.sendChat(question)},enabled=!model.busy){Text(question)}}}}}

@Composable private fun VaultScreen(model: ExplorerModel,importDNA: ()->Unit,export: (String,String)->Unit){
    var password by remember{mutableStateOf("")};var confirmDelete by remember{mutableStateOf(false)}
    val context=LocalContext.current
    val importVault=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)model.run("Reading encrypted vault"){
        val sealed=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){readDocument(context,uri).toString(Charsets.UTF_8)}
        val pass=password;password="";model.openVaultData(pass,sealed)
    }}
    ScreenColumn{
        VaultArt(R.drawable.vault_vault)
        Text("Private on-device vault",style=MaterialTheme.typography.headlineMedium)
        Text("${model.metadata.optInt("count")} variants • ${model.results.size} results. DNA is held in memory until you explicitly save an encrypted vault.")
        Row{Checkbox(checked=model.acceptedDisclaimer,onCheckedChange={model.acceptedDisclaimer=it});Text("I understand this is educational research, not medical advice.",style=MaterialTheme.typography.bodySmall)}
        Button(onClick=importDNA,enabled=model.acceptedDisclaimer&&!model.busy){Text("Import raw DNA (.txt, .tsv, .csv, .gz)")}
        OutlinedTextField(value=password,onValueChange={password=it},label={Text("Vault passphrase")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
        Row{Button(onClick={val p=password;password="";model.saveVault(p)},enabled=!model.busy&&password.length>=8){Text("Save")};Spacer(Modifier.width(10.dp));OutlinedButton(onClick={val p=password;password="";model.openVault(p)},enabled=!model.busy&&password.isNotEmpty()){Text("Unlock")};TextButton(onClick=model::clear){Text("Lock")}}
        OutlinedButton(onClick={val p=password;password="";model.run("Encrypting portable backup"){val data=model.sealedVault(p);export("monadic-vault.json",data)}},enabled=!model.busy&&password.length>=8){Text("Export encrypted portable vault")}
        OutlinedButton(onClick={importVault.launch(arrayOf("application/json","text/*","application/octet-stream"))},enabled=!model.busy&&password.isNotEmpty()){Text("Import portable vault using this passphrase")}
        TextButton(onClick={confirmDelete=true}){Text("Delete local vault and clear memory")}
    }
    if(confirmDelete)AlertDialog(onDismissRequest={confirmDelete=false},title={Text("Delete this device's vault?")},text={Text("This deletes the encrypted local copy and clears in-memory data. Exported backups are unaffected.")},confirmButton={TextButton(onClick={model.deleteVault();confirmDelete=false}){Text("Delete")}},dismissButton={TextButton(onClick={confirmDelete=false}){Text("Cancel")}})
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
    model.profileSchema.forEach { field ->
        val key=field.getString("key")
        if(field.getString("type")=="select") {
            Text(field.getString("label"))
            Row(Modifier.horizontalScroll(rememberScrollState())) { field.getJSONArray("options").objects().forEach { option ->
                FilterChip(selected=model.profileFields[key]==option.getString("value"),onClick={model.profileFields[key]=option.getString("value")},label={Text(option.getString("label"))})
            } }
        } else OutlinedTextField(value=model.profileFields[key].orEmpty(),onValueChange={model.profileFields[key]=it},label={Text(field.getString("label"))},modifier=Modifier.fillMaxWidth())
    }
    OutlinedTextField(value=model.profile,onValueChange={model.profile=it},label={Text("Optional personalization context")},modifier=Modifier.fillMaxWidth())
    Button(onClick={model.run("Saving settings"){model.settingsSaved()}},enabled=!model.busy){Text("Save securely")}
}}

@Composable private fun AccountScreen(model: ExplorerModel){
    val context=LocalContext.current;var promo by remember{mutableStateOf("")}
    ScreenColumn{Text("Account and premium",style=MaterialTheme.typography.headlineMedium);Text(model.wallet.ifBlank{"Not signed in"})
        Button(onClick={model.run("Opening secure sign-in"){openBrowser(context,model.beginAuth())}},enabled=!model.busy){Text("Sign in with Dynamic")}
        OutlinedButton(onClick=model::refreshSubscription,enabled=!model.busy&&model.wallet.isNotBlank()){Text("Refresh subscription and blockchain payments")}
        model.subscription?.let{Text(it.toString(2))}
        Button(onClick={model.run("Opening card checkout"){openBrowser(context,model.checkout())}},enabled=!model.busy&&model.wallet.isNotBlank()){Text("Subscribe with card")}
        TextButton(onClick={openBrowser(context,model.backend.trimEnd('/')+"/subscribe")}){Text("Manage subscription or pay with a connected wallet")}
        OutlinedTextField(value=promo,onValueChange={promo=it},label={Text("Promo code")})
        OutlinedButton(onClick={model.run("Checking promo"){model.applyPromo(promo)}}){Text("Apply code")}
        TextButton(onClick=model::signOut){Text("Sign out")}
        Text("Payment providers and wallet authorization open in your system browser. No server API keys are embedded in this app.",style=MaterialTheme.typography.bodySmall)
    }
}
