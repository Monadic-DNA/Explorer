package com.monadicdna.explorer

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity: FragmentActivity() {
    private lateinit var deviceAuthentication:DeviceAuthentication
    private lateinit var driveAuthorization:DriveAuthorization
    private val model by lazy { ViewModelProvider(this)[ExplorerModel::class.java] }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if(!BuildConfig.DEBUG)window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        deviceAuthentication=DeviceAuthentication(this)
        driveAuthorization=DriveAuthorization(this)
        val weak=java.lang.ref.WeakReference(deviceAuthentication)
        model.authenticate={requireNotNull(weak.get()){ "Open the app to unlock saved data." }.authenticate()}
        val drive=java.lang.ref.WeakReference(driveAuthorization)
        // Google's consent sheet is another activity; like the file picker, it must not lock the data.
        model.driveToken={model.pickingFile=true;try{requireNotNull(drive.get()){ "Open the app to sync." }.token()}finally{model.pickingFile=false}}
        androidx.core.view.WindowCompat.getInsetsController(window,window.decorView).isAppearanceLightStatusBars=true
        setContent { VaultTheme { ExplorerApp(model) } }
    }
    override fun onStop() { super.onStop(); if(!isChangingConfigurations) model.backgroundLock() }
    override fun onResume() { super.onResume(); model.billing.restore() }
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
    // "Save as PDF": render silently, then the system save-to-files picker places the file.
    var pendingPdf by remember{mutableStateOf<java.io.File?>(null)}
    val exportPdf=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")){uri->model.pickingFile=false;val pending=pendingPdf;pendingPdf=null;if(uri!=null&&pending!=null)model.run("Saving PDF"){kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){context.contentResolver.openOutputStream(uri)!!.use{out->pending.inputStream().use{it.copyTo(out)}}};model.notice="PDF saved."}}
    fun savePdf(title: String, html: String){model.pickingFile=true;renderPdf(context,title,html){file->if(file!=null){pendingPdf=file;exportPdf.launch(title.replace(Regex("[^A-Za-z0-9]+"),"-").trim('-')+".pdf")}else{model.pickingFile=false;model.error="Unable to create the PDF."}}}
    fun selectTab(name: String){tab=name;model.error=null;model.notice=null;model.dismissAccessNeeded()}
    val tabs=listOf("Home","Chat","Reports","You","More")
    // Screens opened from More return there; other tabs return Home before Back leaves the app.
    BackHandler(enabled=tab!="Home"){selectTab(if(tab in tabs)"Home" else "More")}
    Scaffold(
        // The brand star rides in the top chrome so it stays visible past onboarding.
        // Chat is a reading surface: the title bar yields its height to the conversation there.
        topBar={if(tab!="Chat")TopAppBar(
            // Nested More screens get a visible route back to their parent.
            navigationIcon={if(tab in listOf("Results","Browse","Vault","Settings","Account"))IconButton(onClick={selectTab("More")}){Icon(Icons.AutoMirrored.Filled.ArrowBack,contentDescription="Back to More")}},
            title={Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.vault_star),contentDescription=null,modifier=Modifier.size(20.dp));Text(mapOf("Results" to "Your matches","Browse" to "Browse research","Vault" to "Vault and backups","Settings" to "AI settings","Account" to "Account and premium")[tab]?:tab,style=MaterialTheme.typography.titleLarge)}})},
        bottomBar={NavigationBar(containerColor=MaterialTheme.colorScheme.background) { tabs.forEachIndexed{index,name->NavigationBarItem(selected=tab==name||(name=="More"&&tab !in tabs),onClick={selectTab(name)},label={Text(name)},icon={Icon(when(index){0->Icons.Default.Home;1->Icons.AutoMirrored.Filled.Chat;2->Icons.Default.Description;3->Icons.Default.Person;else->Icons.Default.MoreHoriz},contentDescription=name)})} }}
    ){padding->
        Column(Modifier.padding(padding).fillMaxSize()){
            // All scrolling content gets clearance past the bottom nav and the top bars.
            // A first-time user has no vault yet, so there is nothing to lock or unlock.
            // Lock/unlock lives on Home and You; other tabs keep their whole top area for content.
            if((model.dataUnlocked||model.dataVault.exists)&&tab=="Home")Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
                Text(model.storageMessage,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                if(model.dataUnlocked) TextButton(onClick=model::lockData,enabled=!model.busy){Icon(Icons.Default.Lock,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(6.dp));Text("Lock data")}
                else TextButton(onClick=model::unlockSavedData,enabled=!model.busy){Icon(Icons.Default.Lock,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(6.dp));Text("Unlock data")}
            }
            if(model.busy&&tab!="Home"&&tab!="Chat"){
                // Determinate work shows a bar; open-ended work (reports, chat) gets the Vault star loader. Home renders its own processing panel, so it skips this bar.
                model.progress?.let{LinearProgressIndicator(progress={it},modifier=Modifier.fillMaxWidth())}?:Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){VaultStarLoader(Modifier.padding(top=8.dp))}
                Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){Text(model.status,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium);if(model.cancellable)TextButton(onClick=model::cancel){Text("Cancel")}}
            }
            Messages(model,showChatRetry=tab=="Chat")
            if(model.locking){Text("Your data is protected",Modifier.padding(24.dp))} else when(tab){
                "Home"->HomeScreen(model,::selectTab){model.pickingFile=true;importDNA.launch(arrayOf("text/*","application/gzip","application/octet-stream"))}
                "You"->YouScreen(model,{selectTab("Home");if(model.personalized)model.notice="Saved. Chat and reports will use what you told us about yourself."}){selectTab("Vault")}
                "Browse"->BrowseScreen(model)
                "Results"->ResultsScreen(model,{selectTab("Vault")},{name,content->exportText(name,content)},{model.pickingFile=true;importResults.launch(arrayOf("text/*","application/json","application/octet-stream"))})
                "Chat"->ChatScreen(model,{selectTab("Settings")},{selectTab("You")},{selectTab("Account")}){title,html->savePdf(title,html)}
                "Reports"->ReportScreen(model,{selectTab("Chat")},{selectTab("Account")}){exportText("monadic-report.md",model.report)}
                "Vault"->VaultScreen(model){model.pickingFile=true;importDNA.launch(arrayOf("text/*","application/gzip","application/octet-stream"))}
                "Settings"->SettingsScreen(model)
                "Account"->AccountScreen(model)
                "More"->ScreenColumn{
                    // Standard settings rows, not a wall of outlined buttons; the top bar already names the screen.
                    listOf(Triple("Results","Your matches",Icons.Default.List),Triple("Browse","Browse research",Icons.Default.Search),Triple("Vault","Vault and backups",Icons.Default.Lock),Triple("Settings","AI settings",Icons.Default.Settings),Triple("Account","Account and premium",Icons.Default.Star)).forEach{(name,label,icon)->
                        Row(Modifier.fillMaxWidth().toggleable(value=false,role=Role.Button,onValueChange={selectTab(name)}).padding(vertical=14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)){
                            Icon(icon,contentDescription=null,tint=VaultColors.purple900)
                            Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
                            Icon(Icons.Default.ChevronRight,contentDescription=null,tint=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
    if(model.selectedStudy!=null) ModalBottomSheet(onDismissRequest={model.selectedStudy=null;model.commentary=""}){Column(Modifier.navigationBarsPadding()){Messages(model);StudyScreen(model,model.selectedStudy!!)}}
    if(model.reportSheetOpen&&model.report.isNotEmpty())ReportSheet(model,{selectTab("Chat")}){title,html->savePdf(title,html)}
}

@Composable private fun Messages(model: ExplorerModel,showChatRetry: Boolean=false){
    // An access requirement is shown by AccessNeeded, with a button, instead of here.
    model.error?.takeIf{model.accessNeeded==null&&!(showChatRetry&&model.chatRetryAction!=null)}?.let{message->Card(Modifier.padding(horizontal=12.dp,vertical=6.dp).fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(message,color=MaterialTheme.colorScheme.error);TextButton(onClick={model.error=null}){Text("Dismiss")}}}}
    model.notice?.let{message->Card(Modifier.padding(horizontal=12.dp,vertical=6.dp).fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primaryContainer,contentColor=MaterialTheme.colorScheme.onPrimaryContainer)){Column(Modifier.padding(12.dp)){Text(message);TextButton(onClick={model.notice=null}){Text("Dismiss")}}}}
}

// M3 chip borders ignore the theme outline and render dark; Vault borders are always the soft token.
@Composable private fun vaultChipBorder()=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline)
/** Suggestions and follow-ups are outlined plum chips: filled lavender is reserved for the user's own messages. */
@Composable private fun PastelChip(onClick: ()->Unit, label: @Composable ()->Unit){
    SuggestionChip(onClick=onClick,label=label,colors=SuggestionChipDefaults.suggestionChipColors(containerColor=MaterialTheme.colorScheme.background,labelColor=VaultColors.purple900),border=androidx.compose.foundation.BorderStroke(1.dp,VaultColors.purple900.copy(alpha=0.5f)))
}

/** One-time explicit agreement with tappable full policy documents; agreeing covers the educational-use note. */
@Composable private fun TermsAgreement(onAgree: ()->Unit){
    Text("This app shares educational research findings, not medical advice.",style=MaterialTheme.typography.bodySmall)
    val link=SpanStyle(color=MaterialTheme.colorScheme.primary)
    Text(buildAnnotatedString{
        append("By continuing you agree to the ")
        withLink(LinkAnnotation.Url("https://github.com/Monadic-DNA/Explorer/blob/main/terms_and_conditions.md")){withStyle(link){append("Terms of Service")}}
        append(" and ")
        withLink(LinkAnnotation.Url("https://github.com/Monadic-DNA/Explorer/blob/main/privacy_policy.md")){withStyle(link){append("Privacy Policy")}}
        append(".")
    },style=MaterialTheme.typography.bodySmall)
    Button(onClick=onAgree){Text("Agree and continue")}
}

// The whole row toggles the checkbox, so the label is a tap target too.
@Composable private fun CheckRow(checked: Boolean, onChange: (Boolean)->Unit, label: String, small: Boolean=true){
    Row(Modifier.fillMaxWidth().toggleable(value=checked,role=Role.Checkbox,onValueChange=onChange).padding(vertical=4.dp),verticalAlignment=Alignment.CenterVertically){
        Checkbox(checked=checked,onCheckedChange=null,modifier=Modifier.padding(end=12.dp));Text(label,style=if(small)MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge)
    }
}

private fun effectNumber(value: Double): String = if(value.isNaN()) "" else java.math.BigDecimal(value).round(java.math.MathContext(3)).stripTrailingZeros().toPlainString()

@Composable private fun ScreenColumn(content: @Composable ColumnScope.()->Unit){Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start=20.dp,end=20.dp,top=20.dp,bottom=32.dp),verticalArrangement=Arrangement.spacedBy(14.dp),content=content)}

@Composable private fun BrowseScreen(model: ExplorerModel){
    var query by remember{mutableStateOf("")};var trait by remember{mutableStateOf("")};var semantic by remember{mutableStateOf(true)};var offset by remember{mutableIntStateOf(0)}
    val keyboard=androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxSize().padding(16.dp)){
        OutlinedTextField(value=query,onValueChange={query=it},label={Text("Search traits, studies, genes or SNPs")},modifier=Modifier.fillMaxWidth())
        // The trait filter is optional and stays out of the way until asked for.
        var showTrait by remember{mutableStateOf(false)}
        if(showTrait)OutlinedTextField(value=trait,onValueChange={trait=it},label={Text("Trait filter (optional)")},modifier=Modifier.fillMaxWidth())
        else TextButton(onClick={showTrait=true},contentPadding=PaddingValues(0.dp)){Text("Add a trait filter",style=MaterialTheme.typography.labelLarge)}
        Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.weight(1f)){CheckRow(semantic,{semantic=it},"Search by meaning, not just keywords",small=false)};Button(onClick={keyboard?.hide();offset=0;model.browse(query,trait,semantic)},enabled=!model.busy){Text("Search")}}
        if(model.studies.isEmpty()){
            Text("Search the catalog to discover studies. Try an example:",style=MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("Type 2 diabetes","APOE").forEach{example->PastelChip(onClick={query=example;keyboard?.hide();offset=0;model.browse(example,trait,semantic)},label={Text(example)})}}
        }
        // One card per study: UKB-style traits have many variant rows with the same title and abstract, which read as duplicates.
        val grouped=remember(model.studies){model.studies.groupBy{it.optString("study_accession")}.map{(_,rows)->rows.first() to rows.size}}
        LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)){items(grouped,key={it.first.optInt("id")}){(study,variants)->Card(onClick={model.showStudy(study)},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){Text(study.optString("disease_trait","Unknown trait"),fontWeight=FontWeight.Bold);Text(study.optString("study"),maxLines=3);Text(listOf(if(variants>1)"$variants variants analyzed" else study.optString("strongest_snp_risk_allele"),study.optString("study_accession"),study.optString("confidenceBand","Research finding")).filter{it.isNotBlank()&&it!="null"}.joinToString(" • "),style=MaterialTheme.typography.labelSmall)}}}}
        // Pagination is useful only once there are results to page through.
        if(model.studies.isNotEmpty())Row(horizontalArrangement=Arrangement.SpaceBetween,modifier=Modifier.fillMaxWidth()){
            // Page 1 has no Previous; hiding it beats a faint disabled button.
            if(offset>0)TextButton(onClick={offset=(offset-50).coerceAtLeast(0);model.browse(query,trait,semantic,offset)},enabled=!model.busy){Text("Previous")}
            Spacer(Modifier.weight(1f))
            TextButton(onClick={offset+=50;model.browse(query,trait,semantic,offset)},enabled=!model.busy){Text("Next")}
        }
    }
}

@Composable private fun StudyScreen(model: ExplorerModel,study: JSONObject){
    val context=LocalContext.current
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(study.optString("disease_trait"),style=MaterialTheme.typography.headlineMedium);Text(study.optString("study"))
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick={model.selectedStudy=null;model.commentary=""}){Text("Close")}}
        Text("OR: odds per allele copy. Beta: trait units per allele. GWAS: genome-wide association study. Your match card shows your genotype-adjusted value; the study values below are the published per-allele estimates.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        val effectLabel=remember(study.toString()){if(Core.obj("effect",json("value" to study.optString("or_or_beta"),"ci" to study.optString("ci_text"))).optString("effectType")=="beta")"Reported Beta (per allele)" else "Reported OR (per allele)"}
        for((key,label) in listOf("study_accession" to "Accession","mapped_gene" to "Genes","snps" to "Variants","strongest_snp_risk_allele" to "Reported risk allele","or_or_beta" to effectLabel,"ci_text" to "Effect interval","p_value" to "P-value","initial_sample_size" to "Discovery sample","replication_sample_size" to "Replication sample","first_author" to "Author","journal" to "Journal","date" to "Publication date")){val value=study.optString(key);if(value.isNotBlank()&&value!="null")Text("$label: $value")}
        val hasDNA=model.dataUnlocked&&model.metadata.optInt("count")>0
        Button(onClick={model.analyze(study)},enabled=!model.busy&&hasDNA){Text("Match my DNA on device")}
        if(!hasDNA)Text(if(model.dataUnlocked)"Import your DNA in More → Vault to match this study." else "Unlock your saved data to match this study.",style=MaterialTheme.typography.bodySmall)
        remember(model.resultsVersion,study.optInt("id")){model.resultFor(study.optInt("id"))}?.let{result->
            ResultCard(result)
            // AI commentary needs a stored result and consent to send matches to the provider.
            if(!model.shareResultsWithLLM)Consent(model)
            Button(onClick={model.commentary(study)},enabled=!model.busy&&model.shareResultsWithLLM){Text("Explain with AI")}
            // The global busy bar sits behind this sheet, so progress is repeated here.
            if(model.busy)Text(model.status,style=MaterialTheme.typography.bodySmall)
            if(model.commentaryStudyId==study.optInt("id")&&model.commentary.isNotEmpty()){
                Text("AI commentary",style=MaterialTheme.typography.titleMedium)
                MarkdownText(model.commentary)
            }
        }
        val pmid=study.optString("pubmedid");if(pmid.matches(Regex("^[0-9]+$")))TextButton(onClick={openBrowser(context,"https://pubmed.ncbi.nlm.nih.gov/$pmid/")}){Text("Read original publication")}
        Text("An association does not establish causation or predict an individual's health outcome.",style=MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun ResultCard(result: JSONObject, onClick: (()->Unit)?=null){
    val evidence=remember(result.toString()){Core.obj("evidence",result)}
    val palette=remember(result.toString()){vaultCardPalette(Core.obj("preview_category",result).getString("id"))}
    // Radius scale: 28dp heroes/sheets, 24dp content cards, 18dp bubbles, capsule chips.
    val shape=androidx.compose.foundation.shape.RoundedCornerShape(24.dp);val colors=CardDefaults.cardColors(containerColor=palette.first,contentColor=palette.second)
    val body: @Composable ColumnScope.()->Unit={Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.vault_star),contentDescription=null,modifier=Modifier.size(28.dp),colorFilter=androidx.compose.ui.graphics.ColorFilter.tint(palette.second));Text(result.optString("traitName"),fontFamily=Garamond,fontWeight=FontWeight.Medium,fontSize=24.sp);Text("${result.optString("matchedSnp")}: ${result.optString("userGenotype")} • ${if(result.optString("effectType")=="beta")"Your Beta" else "Your OR"} ${effectNumber(result.optDouble("riskScore"))}",style=MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings="tnum"));Text(when(result.optString("riskLevel")){"increased"->"▲ Increased";"decreased"->"▼ Decreased";else->"● ${result.optString("riskLevel").replaceFirstChar{it.uppercase()}}"},fontWeight=FontWeight.Bold);Text(evidence.getString("label"),style=MaterialTheme.typography.bodySmall);Text("Association, not a diagnosis.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
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
        Text("${model.resultCount.grouped()} saved study matches",fontFamily=Garamond,fontSize=26.sp,color=VaultColors.darkMain)
        Row(verticalAlignment=Alignment.CenterVertically){Button(onClick={model.runAll()},enabled=!model.busy&&hasDNA){Text("Run all studies")};Spacer(Modifier.width(8.dp));TextButton(onClick={export("monadic-results.tsv",model.exportResults())},enabled=model.resultCount>0){Text("Export")};TextButton(onClick=importResults){Text("Import")}}
        // The version carries a build hash after the date; users need the date only.
        model.catalogInfo?.let{Text("Research catalog ${it.optString("version").take(10)} • ${it.optInt("rows").grouped()} studies • bundled with this app",style=MaterialTheme.typography.bodySmall)}
        if(model.resultCount==0){
            Text(when{!model.dataUnlocked->"Unlock your saved data to see saved matches.";!hasDNA->"Import a raw DNA file first. Then Run all studies compares it with the research catalog on this device.";else->"Choose Run all studies to compare your DNA with the research catalog bundled with this app. Matching runs on this device and takes under a minute."})
            if(!hasDNA)OutlinedButton(onClick=openVault){Text("Go to Vault")}
        } else {
            OutlinedTextField(value=filter,onValueChange={filter=it},label={Text("Filter saved traits")},modifier=Modifier.fillMaxWidth())
            // A trailing fade tells the user the chip row scrolls.
            Box{
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    listOf("All","Increased","Decreased").forEach{FilterChip(selected=direction==it,onClick={direction=it},label={Text(it)},border=vaultChipBorder())}
                    // Sort chips say what they do, distinct from the direction filters.
                    listOf("Catalog order","Effect size","P-value").forEach{FilterChip(selected=sort==it,onClick={sort=it},label={Text("Sort: ${it.lowercase()}")},border=vaultChipBorder())}
                }
                Box(Modifier.align(Alignment.CenterEnd).width(28.dp).height(40.dp).background(androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(androidx.compose.ui.graphics.Color.Transparent,MaterialTheme.colorScheme.background))))
            }
            if(total!=model.resultCount)Text("Showing ${total.grouped()} of ${model.resultCount.grouped()}",style=MaterialTheme.typography.bodySmall)
            LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(bottom=16.dp)){
                // One card per trait within the page: repeated variant rows for the same trait read as duplicates otherwise.
                val grouped=rows.groupBy{it.optString("traitName")}.map{(_,matches)->matches.first() to matches.size}
                itemsIndexed(grouped,key={_,pair->pair.first.optInt("studyId")}){index,entry->
                    val (result,variants)=entry
                    ResultCard(result){model.loadStudy(result.optInt("studyId"))}
                    if(variants>1)Text("+ ${variants-1} more ${if(variants==2)"variant" else "variants"} for this trait",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
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

@Composable private fun Consent(model: ExplorerModel){
    val provider=mapOf("nilai" to "nilAI","huggingface" to "HuggingFace","ollama" to "Ollama")[model.provider]?:model.provider
    if(!model.shareResultsWithLLM){
        // Consent is the gate to the feature, so it is a real button, not a checkbox under legal copy.
        Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
            Button(onClick={model.shareResultsWithLLM=true}){Text("Share my matches with $provider")}
            Text("Only matched results and optional profile and health summaries are sent. Raw DNA stays on this device.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else Row(Modifier.fillMaxWidth().border(1.dp,MaterialTheme.colorScheme.outline,androidx.compose.foundation.shape.RoundedCornerShape(16.dp)).padding(horizontal=12.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically){
        Text("Sharing matched results with $provider",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
        TextButton(onClick={model.shareResultsWithLLM=false}){Text("Revoke")}
    }
}
/** The angles a Research answer looked at, collapsed by default as on the web. */
@Composable private fun ResearchAngles(angles: List<Pair<String,Int>>){
    var open by remember{mutableStateOf(false)}
    TextButton(onClick={open=!open},contentPadding=PaddingValues(0.dp)){Icon(if(open)Icons.Default.ExpandLess else Icons.Default.ExpandMore,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(4.dp));Text("Researched ${angles.size} angles",style=MaterialTheme.typography.labelLarge)}
    if(open)angles.forEach{(keyword,count)->Text("• $keyword (${count.grouped()} ${if(count==1)"study" else "studies"})",style=MaterialTheme.typography.bodySmall)}
}
/** The web's "studies used" list plus the personalization/health context behind the first answer, each collapsed independently. */
@Composable private fun ChatSources(sources: List<JSONObject>, contextUsed: String){
    var studiesOpen by remember{mutableStateOf(false)}
    var contextOpen by remember{mutableStateOf(false)}
    TextButton(onClick={studiesOpen=!studiesOpen},contentPadding=PaddingValues(0.dp)){Icon(if(studiesOpen)Icons.Default.ExpandLess else Icons.Default.ExpandMore,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(4.dp));Text("${sources.size} studies used",style=MaterialTheme.typography.labelLarge)}
    if(studiesOpen)Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
        sources.forEach{source->
            Text("• ${source.optString("traitName")} (${source.optString("gwasId")})",style=MaterialTheme.typography.bodySmall)
            Text("${source.optString("matchedSnp")}: ${source.optString("userGenotype")} • ${source.optString("riskLevel").replaceFirstChar{it.uppercase()}} risk • ${if(source.optString("effectType")=="beta")"Beta" else "OR"} ${"%.2f".format(source.optDouble("riskScore"))}",style=MaterialTheme.typography.bodySmall.copy(fontFamily=FontFamily.Monospace,fontFeatureSettings="tnum"),color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    TextButton(onClick={contextOpen=!contextOpen},contentPadding=PaddingValues(0.dp)){Icon(if(contextOpen)Icons.Default.ExpandLess else Icons.Default.ExpandMore,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(4.dp));Text("Personalization and health data used",style=MaterialTheme.typography.labelLarge)}
    if(contextOpen)Text(if(contextUsed.isBlank())"None. You have not filled in About you and health data sharing is off, so this answer used only your research matches." else contextUsed,style=MaterialTheme.typography.bodySmall)
}
/** Explains what Chat or a premium report needs and links to Account, instead of a bare error. */
@Composable private fun AccessNeeded(model: ExplorerModel, openAccount: ()->Unit){
    model.accessNeeded ?: return
    OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text("Premium needed",style=MaterialTheme.typography.titleMedium)
        Text(model.error ?: "",style=MaterialTheme.typography.bodyMedium)
        Button(onClick=openAccount){Text("See Premium options")}
    }}
}
@Composable private fun ChatScreen(model: ExplorerModel,openSettings: ()->Unit,personalize: ()->Unit,openAccount: ()->Unit,savePdf: (String,String)->Unit){
    var message by remember{mutableStateOf(model.chatDraft)}
    var moreQuestions by remember{mutableStateOf(false)}
    LaunchedEffect(Unit){model.chatDraft=""}
    Column(Modifier.fillMaxSize().imePadding().padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        val providerName=mapOf("nilai" to "nilAI","huggingface" to "HuggingFace","ollama" to "Ollama")[model.provider]?:model.provider
        // One compact row: provider on the left, transcript actions on the right once a conversation exists.
        val ongoing=model.messages.isNotEmpty()&&model.shareResultsWithLLM
        var confirmNew by remember{mutableStateOf(false)}
        val context=LocalContext.current
        if(ongoing){
            // Once a conversation exists, a single actions row owns the header; provider and sharing controls move into the overflow menu.
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                TextButton(onClick={confirmNew=true},enabled=!model.busy,contentPadding=PaddingValues(horizontal=6.dp,vertical=0.dp)){Icon(Icons.Default.Add,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(2.dp));Text("New chat",style=MaterialTheme.typography.bodySmall)}
                TextButton(onClick={sharePdf(context,"Chat with Monadic DNA Explorer",reportHtml("Chat with Monadic DNA Explorer",chatTranscript(model),pdfLogo(context)))},contentPadding=PaddingValues(horizontal=6.dp,vertical=0.dp)){Icon(Icons.Default.Share,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(2.dp));Text("Share",style=MaterialTheme.typography.bodySmall)}
                TextButton(onClick={savePdf("Chat with Monadic DNA Explorer",reportHtml("Chat with Monadic DNA Explorer",chatTranscript(model),pdfLogo(context)))},contentPadding=PaddingValues(horizontal=6.dp,vertical=0.dp)){Icon(Icons.Default.Download,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(2.dp));Text("Save",style=MaterialTheme.typography.bodySmall)}
                Spacer(Modifier.weight(1f))
                var menu by remember{mutableStateOf(false)}
                Box{
                    IconButton(onClick={menu=true}){Icon(Icons.Default.MoreVert,contentDescription="Chat options")}
                    DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
                        DropdownMenuItem(text={Text(if(model.premiumActive)"Research this in depth" else "Research this in depth • Premium")},enabled=!model.busy&&message.isNotBlank()&&model.resultCount>0,onClick={menu=false;model.research(message){message=""}})
                        DropdownMenuItem(text={Text("Provider: $providerName")},onClick={menu=false;openSettings()})
                        DropdownMenuItem(text={Text("Revoke sharing")},onClick={menu=false;model.shareResultsWithLLM=false})
                    }
                }
            }
        } else {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text("Provider: $providerName",style=MaterialTheme.typography.bodySmall)
                TextButton(onClick=openSettings,contentPadding=PaddingValues(horizontal=6.dp,vertical=0.dp)){Text("Change",style=MaterialTheme.typography.bodySmall)}
                Spacer(Modifier.weight(1f))
            }
            // Consent collapses to a single line once granted; the full checkbox plus privacy explainer remains the gate while it is off.
            if(model.shareResultsWithLLM)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text("Sharing matched results with $providerName",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                TextButton(onClick={model.shareResultsWithLLM=false},contentPadding=PaddingValues(horizontal=6.dp,vertical=0.dp)){Text("Revoke",style=MaterialTheme.typography.bodySmall)}
            } else {
                Consent(model)
            }
        }
        if(confirmNew)AlertDialog(
            onDismissRequest={confirmNew=false},
            title={Text("Start a new chat?")},
            text={Text("The current conversation is cleared. Save it as a PDF first if you want to keep it.")},
            confirmButton={TextButton(onClick={model.newChat();confirmNew=false}){Text("Clear and start new")}},
            dismissButton={TextButton(onClick={confirmNew=false}){Text("Cancel")}}
        )
        val retryAction=model.chatRetryAction
        if(retryAction!=null&&model.error!=null&&model.accessNeeded==null)Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(model.error!!,color=MaterialTheme.colorScheme.error)
            Text("Your message is still in the composer. Check your connection or provider settings, then retry.",style=MaterialTheme.typography.bodySmall)
            TextButton(onClick={if(retryAction=="research")model.research(message){message=""} else model.sendChat(message){message=""}},enabled=!model.busy&&model.shareResultsWithLLM&&(if(retryAction=="research")message.isNotBlank() else message.isNotBlank()||model.chatAttachments.isNotEmpty())){Text("Retry")}
        }}
        // The intro and suggestions live inside the list so everything scrolls on small screens and the composer plus Send stay pinned below.
        val listState=rememberLazyListState()
        // Keep the newest text in view while an answer streams in: target the last item, then pin to the very bottom.
        LaunchedEffect(model.messages.size,model.messages.lastOrNull()?.second?.length){
            val count=listState.layoutInfo.totalItemsCount
            if(count>0){
                listState.scrollToItem(count-1)
                listState.dispatchRawDelta(1_000_000f)
            }
        }
        LazyColumn(Modifier.weight(1f),state=listState,verticalArrangement=Arrangement.spacedBy(12.dp)){
            // While an access requirement is shown, it takes the place of the intro so its button stays visible.
            if(model.messages.isEmpty()&&model.accessNeeded==null){
                // A quiet brand moment on the empty conversation: the star and a greeting instead of a bare instruction.
                item{Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){androidx.compose.foundation.Image(painterResource(R.drawable.vault_star),contentDescription=null,modifier=Modifier.size(36.dp));Text("Ask about your results",fontFamily=Garamond,fontSize=26.sp,color=VaultColors.darkMain)}}
                item{Text(when{(model.resultCount==0)->"Chat answers questions about your research matches. Add your DNA file on Home first.";!model.shareResultsWithLLM->"Tap Share my matches above to begin. Your matches go only to the provider shown.";else->"Ask anything about your results, or start with a suggestion. Research looks at a question from 10 angles for a detailed answer."},style=MaterialTheme.typography.bodyMedium)}
                if((model.resultCount>0)){
                    // Two short suggestions plus an expander, instead of a wall of chips.
                    items(CHAT_SUGGESTIONS.take(if(moreQuestions)CHAT_SUGGESTIONS.size else 2)){suggestion->PastelChip(onClick={message=suggestion},label={Text(suggestion)})}
                    item{TextButton(onClick={moreQuestions=!moreQuestions},contentPadding=PaddingValues(0.dp)){Text(if(moreQuestions)"Fewer questions" else "More questions",style=MaterialTheme.typography.labelLarge)}}
                }
                if((model.resultCount>0)&&!model.personalized)item{TextButton(onClick=personalize){Icon(Icons.Default.Person,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(6.dp));Text("Personalize answers",style=MaterialTheme.typography.labelLarge)}}
            }
            // Flat conversation, as in modern chat apps: user questions are compact right-aligned bubbles, answers are full-width text with no card or speaker label.
            itemsIndexed(model.messages.toList()){index,(role,text)->
                if(role=="user")Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){
                    Surface(color=VaultColors.purple200,contentColor=VaultColors.purple900,shape=androidx.compose.foundation.shape.RoundedCornerShape(18.dp),modifier=Modifier.widthIn(max=320.dp)){
                        Text(text,Modifier.padding(horizontal=14.dp,vertical=10.dp),style=MaterialTheme.typography.bodyLarge.copy(fontFamily=FontFamily.Default,fontWeight=FontWeight.Normal))
                    }
                } else Column(Modifier.fillMaxWidth()){
                    MarkdownText(text)
                    model.researchAngles[index]?.let{angles->ResearchAngles(angles)}
                    model.chatSources[index]?.takeIf{it.isNotEmpty()}?.let{sources->ChatSources(sources,model.chatContextUsed)}
                }
            }
            if(!model.busy&&model.chatFollowups.isNotEmpty())items(model.chatFollowups){q->PastelChip(onClick={message=q},label={Text(q)})}
            // Waiting and streaming share one minimal inline indicator; no card, no loader, so the conversation keeps the space.
            if(model.busy)item{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text(if(model.messages.lastOrNull()?.second?.isNotEmpty()==true)"" else model.status,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick=model::cancel,contentPadding=PaddingValues(horizontal=6.dp,vertical=0.dp)){Text("Stop",style=MaterialTheme.typography.bodySmall)}
            }}
        }
        AccessNeeded(model,openAccount)
        // Attachments: images go to the provider as vision content; text documents are inlined into the question.
        val pickImages=rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(6)){uris->model.pickingFile=false;if(BuildConfig.DEBUG)android.util.Log.d("Attach","picked ${uris.size} images");uris.forEach{uri->runCatching{val scaled=readScaledImage(context,uri);if(BuildConfig.DEBUG)android.util.Log.d("Attach","scaled ${uri.lastPathSegment}: ${scaled?.size}");scaled?.let{model.attachChat(displayName(context,uri),"image/jpeg",it)}}.onFailure{model.error=it.message}}}
        val pickDocs=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->model.pickingFile=false;uri?.let{runCatching{context.contentResolver.openInputStream(it)?.use{stream->model.attachChat(displayName(context,it),context.contentResolver.getType(it)?:"text/plain",stream.readBytes())}}?.onFailure{e->model.error=e.message}}}
        if(model.chatAttachments.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
            model.chatAttachments.forEach{attachment->InputChip(selected=false,onClick={model.chatAttachments.remove(attachment)},label={Text(attachment.name.take(28),style=MaterialTheme.typography.bodySmall)},leadingIcon={Icon(if(attachment.isImage)Icons.Default.Image else Icons.Default.Description,contentDescription=null,modifier=Modifier.size(16.dp))},trailingIcon={Icon(Icons.Default.Close,contentDescription="Remove",modifier=Modifier.size(14.dp))},border=vaultChipBorder())}
        }
        // Standard chat composer: growing field with an inline send button, disabled until sharing is allowed and while the provider runs.
        Row(verticalAlignment=Alignment.CenterVertically){
            IconButton(onClick={model.pickingFile=true;pickImages.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))},enabled=model.shareResultsWithLLM&&!model.busy){Icon(Icons.Default.Image,contentDescription="Attach image")}
            IconButton(onClick={model.pickingFile=true;pickDocs.launch(arrayOf("text/*","application/json","text/csv","text/markdown"))},enabled=model.shareResultsWithLLM&&!model.busy){Icon(Icons.Default.AttachFile,contentDescription="Attach document")}
            OutlinedTextField(value=message,onValueChange={message=it},enabled=model.shareResultsWithLLM&&!model.busy,label={Text("Ask about your findings")},minLines=1,maxLines=5,modifier=Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            FilledIconButton(onClick={model.sendChat(message){message=""}},enabled=!model.busy&&(message.isNotBlank()||model.chatAttachments.isNotEmpty())&&model.shareResultsWithLLM){Icon(Icons.AutoMirrored.Filled.Send,contentDescription="Send")}
        }
        // The one persistent disclaimer, so answers themselves do not repeat boilerplate.
        Text("Educational research, not medical advice.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.align(Alignment.CenterHorizontally))
        // Before a conversation starts, Research keeps its quiet link; during one, it lives in the overflow menu so the answer area keeps the space.
        if(model.messages.isEmpty())TextButton(onClick={model.research(message){message=""}},enabled=!model.busy&&message.isNotBlank()&&model.resultCount>0&&model.shareResultsWithLLM,modifier=Modifier.align(Alignment.End)){Icon(Icons.Default.Science,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(6.dp));Text(if(model.premiumActive)"Research this in depth" else "Research this in depth • Premium",style=MaterialTheme.typography.labelLarge)}
    }
}
// Fresh reports open in a full sheet; the inline copy on the Reports tab remains for revisiting.
@Composable private fun ReportSheet(model: ExplorerModel, openChat: ()->Unit, savePdf: (String,String)->Unit){
    val context=LocalContext.current
    Dialog(onDismissRequest={model.reportSheetOpen=false},properties=DialogProperties(usePlatformDefaultWidth=false)){
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).verticalScroll(rememberScrollState()).padding(24.dp).navigationBarsPadding(),verticalArrangement=Arrangement.spacedBy(14.dp)){
            Column(Modifier.fillMaxWidth().background(VaultColors.darkMain,androidx.compose.foundation.shape.RoundedCornerShape(24.dp)).padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(10.dp)){
                Image(painterResource(R.drawable.vault_brand_mark),contentDescription=null,modifier=Modifier.size(40.dp))
                Text(model.reportTitle,color=androidx.compose.ui.graphics.Color.White,fontFamily=Garamond,fontSize=30.sp,textAlign=TextAlign.Center)
                Text("Monadic DNA Explorer",color=androidx.compose.ui.graphics.Color.White.copy(alpha=0.7f),style=MaterialTheme.typography.labelMedium)
            }
            MarkdownText(model.report)
            if(model.reportQuestions.isNotEmpty()){
                Text("Ask a follow-up",style=MaterialTheme.typography.titleMedium)
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){model.reportQuestions.forEach{question->PastelChip(onClick={model.chatDraft=question;model.reportSheetOpen=false;openChat()},label={Text(question)})}}
            }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                Button(onClick={sharePdf(context,model.reportTitle,reportHtml(model.reportTitle,model.report,pdfLogo(context)))}){Text("Share PDF")}
                OutlinedButton(onClick={savePdf(model.reportTitle,reportHtml(model.reportTitle,model.report,pdfLogo(context)))}){Text("Save as PDF")}
                TextButton(onClick={model.reportSheetOpen=false}){Text("Close")}
            }
        }
    }
}

/** The conversation as markdown, labeled by speaker, for share and PDF export. */
private fun chatTranscript(model: ExplorerModel)=buildString{
    // The speaker label gets its own line so a reply starting with a heading still parses as one.
    model.messages.forEach{(role,text)->append(if(role=="user")"**You:**\n" else "**Explorer:**\n");append(text);append("\n\n")}
}.trim()

/** The picked file's display name; lastPathSegment on SAF URIs is a raw path, not a name. */
private fun displayName(context: android.content.Context, uri: Uri): String=
    runCatching{context.contentResolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),null,null,null)?.use{c->if(c.moveToFirst())c.getString(0) else null}}.getOrNull()?:uri.lastPathSegment?:"file"

/** Downscales a picked image for vision upload: 1024px on the long edge, JPEG 85. */
private fun readScaledImage(context: android.content.Context, uri: Uri): ByteArray?{
    val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
    val stream=context.contentResolver.openInputStream(uri)
    if(BuildConfig.DEBUG)android.util.Log.d("Attach","stream for $uri: $stream")
    if(stream==null)return null
    stream.use{android.graphics.BitmapFactory.decodeStream(it,null,bounds)}
    if(BuildConfig.DEBUG)android.util.Log.d("Attach","bounds: ${bounds.outWidth}x${bounds.outHeight}")
    var sample=1;while(bounds.outWidth/sample>1024||bounds.outHeight/sample>1024)sample*=2
    val opts=android.graphics.BitmapFactory.Options().apply{inSampleSize=sample}
    val bitmap=context.contentResolver.openInputStream(uri)?.use{android.graphics.BitmapFactory.decodeStream(it,null,opts)}?:return null
    val out=ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,85,out)
    return out.toByteArray()
}

// The brand mark as a data URI for the print HTML, read once.
private var pdfLogoCache: String?=null
private fun pdfLogo(context: android.content.Context): String{
    pdfLogoCache?.let{return it}
    // The brand mark asset is white-on-dark and disappears on the light page; the star is the dark variant.
    val bytes=context.resources.openRawResource(R.drawable.vault_star).use{it.readBytes()}
    return android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP).also{pdfLogoCache=it}
}

/** Renders the print HTML into a real PDF silently. Chromium rasterizes only the part of a WebView that intersects the window, so the full-height view is slid up through the window page by page; at each stop the newly exposed region rasterizes and is drawn. A single translated draw (or an offscreen view) leaves later pages blank. */
private fun renderPdf(context: android.content.Context, title: String, html: String, done: (java.io.File?)->Unit){
    val activity=context as? android.app.Activity ?: run{done(null);return}
    val root=activity.findViewById<android.view.ViewGroup>(android.R.id.content)
    val name=title.replace(Regex("[^A-Za-z0-9]+"),"-").trim('-').ifBlank{"monadic-report"}
    val out=java.io.File(java.io.File(context.cacheDir,"reports").apply{mkdirs()},"$name.pdf")
    val view=WebView(context)
    // WebView inherits the system font scale; print must honor the CSS sizes instead.
    view.settings.textZoom=100
    val pageW=794;val pageH=1123 // A4 at 96dpi
    root.addView(view,0,android.view.ViewGroup.LayoutParams(pageW,pageH))
    val handler=android.os.Handler(android.os.Looper.getMainLooper())
    fun cleanup(result: java.io.File?){root.removeView(view);done(result)}
    view.webViewClient=object: WebViewClient(){
        override fun onPageFinished(web: WebView, url: String){
            // Drawing right after load yields a blank page; the renderer needs a beat after onPageFinished.
            handler.postDelayed({
            try {
                web.measure(android.view.View.MeasureSpec.makeMeasureSpec(pageW,android.view.View.MeasureSpec.EXACTLY),android.view.View.MeasureSpec.makeMeasureSpec(0,android.view.View.MeasureSpec.UNSPECIFIED))
                val contentH=web.measuredHeight
                if(BuildConfig.DEBUG)android.util.Log.d("PDF","render $name: contentHeight=$contentH")
                if(contentH<pageH/2){cleanup(null);return@postDelayed}
                val pages=maxOf(1,Math.ceil(contentH.toDouble()/pageH).toInt())
                val doc=android.graphics.pdf.PdfDocument()
                fun drawPage(p: Int){
                    if(p>=pages){
                        java.io.FileOutputStream(out).use{doc.writeTo(it)};doc.close()
                        cleanup(out);return
                    }
                    // Slide the full-height view so this page's region fills the visible window, then let it rasterize.
                    web.layout(0,-p*pageH,pageW,contentH-p*pageH)
                    handler.postDelayed({
                        try {
                            val page=doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(pageW,pageH,p+1).create())
                            // The slide controls what rasterized; the translate selects this page's slice of the view's local content.
                            page.canvas.save();page.canvas.translate(0f,-(p*pageH).toFloat());web.draw(page.canvas);page.canvas.restore()
                            doc.finishPage(page)
                            drawPage(p+1)
                        } catch(e: Exception){cleanup(null)}
                    },200)
                }
                drawPage(0)
            } catch(e: Exception){cleanup(null)}
            },600)
        }
    }
    view.loadDataWithBaseURL(null,html,"text/html","UTF-8",null)
}

/** Shares the actual PDF through the native sheet. */
private fun sharePdf(context: android.content.Context, title: String, html: String){
    renderPdf(context,title,html){file->
        if(file==null)return@renderPdf
        val uri=androidx.core.content.FileProvider.getUriForFile(context,"com.monadicdna.explorer.fileprovider",file)
        val send=Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_SUBJECT,title).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send,"Share PDF"))
    }
}

/** Small markdown-to-HTML pass for the print view: headings, bold, bullets, paragraphs. The logo is a base64 data URI, empty to omit. */
private fun reportHtml(title: String, markdown: String, logo: String=""): String{
    fun esc(s: String)=s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
    fun inline(s: String)=esc(s).replace(Regex("\\*\\*([^*]+)\\*\\*"),"<strong>$1</strong>")
    val body=StringBuilder()
    var inList=false
    for(line in markdown.lines()){
        val trimmed=line.trim()
        if(trimmed.startsWith("- ")||trimmed.startsWith("• ")){if(!inList){body.append("<ul>");inList=true};body.append("<li>${inline(trimmed.drop(2))}</li>")}
        else{if(inList){body.append("</ul>");inList=false}
            when{
                trimmed.startsWith("#### ")->body.append("<h4>${inline(trimmed.drop(5))}</h4>")
                trimmed.startsWith("### ")->body.append("<h3>${inline(trimmed.drop(4))}</h3>")
                trimmed.startsWith("## ")->body.append("<h2>${inline(trimmed.drop(3))}</h2>")
                trimmed.startsWith("# ")->body.append("<h2>${inline(trimmed.drop(2))}</h2>")
                trimmed.isNotEmpty()->body.append("<p>${inline(trimmed)}</p>")
            }}
    }
    if(inList)body.append("</ul>")
    return """<html><head><meta charset="utf-8"><style>
        body{font-family:sans-serif;margin:32px;color:#222;line-height:1.55}
        h1{font-family:Georgia,serif;font-weight:500} h2{margin-top:24px} h3{margin-top:18px}
        .brand{text-align:center;color:#666;font-size:12px;margin-top:40px}
        </style></head><body>${if(logo.isNotEmpty())"<div style=\"text-align:center;margin-bottom:4px\"><img src=\"data:image/png;base64,$logo\" width=\"64\"></div>" else ""}<h1>${esc(title)}</h1>$body<p class="brand">Monadic DNA Explorer &middot; educational research findings, not a diagnosis</p></body></html>"""
}

@Composable private fun ReportScreen(model: ExplorerModel,openChat: ()->Unit,openAccount: ()->Unit,export: ()->Unit){ScreenColumn{
    // The top bar already names the screen; the content starts with the value statement.
    Text(if((model.resultCount==0))"Reports summarize your research matches. Add your DNA file on Home first." else "Each report reads your ${model.resultCount.grouped()} research matches (studies that match your DNA)${if(model.personalized)" and what you told us about yourself" else ""}.",style=MaterialTheme.typography.bodyMedium)
    Consent(model)
    Text("Reports summarize your matches and may suggest follow-up questions.",style=MaterialTheme.typography.bodySmall)
    // Timing, passes and provider details live behind one help row, not three paragraphs.
    var reportHelp by remember{mutableStateOf(false)}
    TextButton(onClick={reportHelp=!reportHelp},contentPadding=PaddingValues(0.dp)){Icon(if(reportHelp)Icons.Default.ExpandLess else Icons.Default.ExpandMore,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(4.dp));Text("Timing, passes and providers",style=MaterialTheme.typography.labelLarge)}
    if(reportHelp){
        Text("Health is free. Premium unlocks Healthspan, Top traits, and Overview; one report pass generates one report.",style=MaterialTheme.typography.bodySmall)
        Text("Generation can take a few minutes, depending on your provider and the report. Educational research, not medical advice.",style=MaterialTheme.typography.bodySmall)
    }
    ReportCards(model){kind->if(!model.busy&&(model.resultCount>0))model.generateReport(kind)}
    AccessNeeded(model,openAccount)
    if(model.report.isNotEmpty()){
        Text(model.reportTitle,style=MaterialTheme.typography.titleLarge);MarkdownText(model.report)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={model.reportSheetOpen=true}){Text("Open report")};OutlinedButton(onClick=export){Text("Export markdown")}}
        if(model.reportQuestions.isNotEmpty())Text("Ask a follow-up",style=MaterialTheme.typography.titleMedium)
        model.reportQuestions.forEach{question->PastelChip(onClick={model.chatDraft=question;openChat()},label={Text(question)})}
    }
}}

@Composable private fun VaultScreen(model:ExplorerModel,importDNA:()->Unit){
    var confirm by remember{mutableStateOf(false)}
    ScreenColumn{
        VaultArt(R.drawable.vault_vault)
        Text("Private on-device data",fontFamily=Garamond,fontSize=28.sp,color=VaultColors.darkMain)
        Text("Your DNA, results and personalization are kept in an encrypted database on this device. Unlocking needs your device authentication, and locking closes it.")
        Text(if(model.dataUnlocked)"Key protection: ${model.dataVault.protection}" else "Locked. Your data stays encrypted until you unlock it.",style=MaterialTheme.typography.bodySmall)
        if(!model.acceptedDisclaimer)TermsAgreement(onAgree=model::acceptTerms)
        else Button(onClick={model.run("Preparing secure import"){model.unlockData();importDNA()}},enabled=!model.busy){Text("Import raw DNA (.txt, .tsv, .csv, .gz)")}
        Text("23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome and Monadic DNA exports. Raw data is processed on this device.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(!model.dataUnlocked) OutlinedButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock saved data")}
        else OutlinedButton(onClick=model::lockData,enabled=!model.busy){Text("Lock data")}
        Text("Sync across your devices",style=MaterialTheme.typography.titleLarge)
        Text("Keep an end-to-end encrypted copy in your own Google Drive, in a hidden folder only Explorer can see, so a new Android device signed in to your Google account fills in automatically. Google asks for permission the first time. Monadic DNA never stores your data.")
        Row(Modifier.fillMaxWidth().toggleable(value=model.syncEnabled,enabled=model.dataUnlocked&&!model.busy,role=Role.Switch,onValueChange={model.setSync(it)}),verticalAlignment=Alignment.CenterVertically){
            Text(if(model.syncEnabled)"On" else "Off",Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge);Switch(checked=model.syncEnabled,onCheckedChange=null,enabled=model.dataUnlocked&&!model.busy)
        }
        Text(when{!model.dataUnlocked->"Unlock to change sync.";model.syncing->"Syncing…";model.syncMessage.isNotBlank()->model.syncMessage;model.syncEnabled->"Up to date.";else->"Off. Data stays only on this device."},style=MaterialTheme.typography.bodySmall)
        if(model.syncEnabled&&model.restoreWarning.isNotBlank())Text(model.restoreWarning,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
        TextButton(onClick={confirm=true},enabled=!model.busy&&(model.dataUnlocked||model.dataVault.exists)){Text("Delete data from this device")}
    }
    if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("Delete data from this device?")},
        text={Text(if(model.syncEnabled)"This removes your DNA, results and personalization from this device. The encrypted cloud copy stays, so you can restore it later." else "This removes your DNA, results and personalization from this device. Sync is off, so there is no other copy.")},
        confirmButton={TextButton(onClick={confirm=false;model.deleteVault()}){Text("Delete")}},dismissButton={TextButton(onClick={confirm=false}){Text("Cancel")}})
}

@Composable private fun SettingsScreen(model: ExplorerModel){ScreenColumn{
    Text("AI settings",fontFamily=Garamond,fontSize=28.sp,color=VaultColors.darkMain)
    OutlinedTextField(value=model.backend,onValueChange={model.backend=it},label={Text("Explorer backend HTTPS origin")},modifier=Modifier.fillMaxWidth())
    Text("The backend hosts the research catalog and account services. Your raw DNA stays on device.")
    Row{listOf("huggingface","ollama","nilai").forEach{provider->FilterChip(selected=model.provider==provider,onClick={model.selectProvider(provider)},label={Text(provider)},border=vaultChipBorder())}}
    OutlinedTextField(value=model.model,onValueChange={model.model=it},label={Text("Model")},modifier=Modifier.fillMaxWidth())
    OutlinedTextField(value=model.apiKey,onValueChange={model.apiKey=it},label={Text("Your provider API key")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
    if(model.provider=="ollama"){OutlinedTextField(value=model.ollamaAddress,onValueChange={model.ollamaAddress=it},label={Text("Ollama hostname")});OutlinedTextField(value=model.ollamaPort,onValueChange={model.ollamaPort=it},label={Text("Ollama port")})}
    if(model.provider=="nilai")Text("Leave the key blank to use one-use backend delegation. Prompts go directly from this device to nilAI; only your public key visits the backend.",style=MaterialTheme.typography.bodySmall)
    Button(onClick={model.run("Saving settings"){model.settingsSaved()}},enabled=!model.busy){Text("Save securely")}
    // Debug builds only: lets developers test premium features without a Google Play purchase.
    if(BuildConfig.DEBUG){
        Text("Developer",style=MaterialTheme.typography.titleLarge)
        Row(Modifier.fillMaxWidth().toggleable(value=model.debugPremium,role=Role.Switch,onValueChange=model::changeDebugPremium),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f)){Text("Treat this device as Premium");Text("Debug builds only. Unlocks Research and premium reports without a purchase.",style=MaterialTheme.typography.bodySmall)}
            // Neutral off-state colors: the default tinted track read as "on" with the thumb left.
            Switch(checked=model.debugPremium,onCheckedChange=null,colors=SwitchDefaults.colors(uncheckedThumbColor=MaterialTheme.colorScheme.outline,uncheckedTrackColor=MaterialTheme.colorScheme.surfaceContainer,uncheckedBorderColor=MaterialTheme.colorScheme.outline))
        }
    }
}}

@Composable private fun AccountScreen(model: ExplorerModel){
    val context=LocalContext.current
    val billing=model.billing
    LaunchedEffect(Unit) { billing.load() }
    ScreenColumn{
        Text("Premium",fontFamily=Garamond,fontSize=28.sp,color=VaultColors.darkMain)
        Text(if(model.premiumActive)"Premium is active." else "Research in Chat and the Healthspan, Top traits and Overview reports are part of Premium. Chat and the Health report are free.")
        if(billing.passes.isNotEmpty())Text("Unused report passes: ${billing.passes.keys.joinToString{REPORT_NAMES[it]?:it}}",style=MaterialTheme.typography.bodyMedium)
        Text("Purchases are handled by Google Play and tied to your Google account. Monadic DNA does not keep customer or purchase records, and no sign-in is needed.",style=MaterialTheme.typography.bodySmall)
        billing.products.forEach { product ->
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(product.name,style=MaterialTheme.typography.titleMedium)
                Text(product.description)
                val price=billing.price(product)
                val subscription=product.productType==com.android.billingclient.api.BillingClient.ProductType.SUBS
                Button(onClick={billing.purchase(context as android.app.Activity,product)},enabled=!billing.busy&&price!=null&&!(subscription&&billing.premium)) {
                    Text(if(subscription) (if(billing.premium)"Subscribed" else "Subscribe for $price / month") else "Buy for $price")
                }
            } }
        }
        if(!billing.busy&&billing.products.isEmpty())Text("Purchases need Google Play on this device. You can still chat and read the free Health report.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick=billing::restore,enabled=!billing.busy){Text("Restore purchases")}
        if(!billing.busy&&billing.products.isEmpty())TextButton(onClick={billing.load()}){Text("Retry loading purchases")}
        TextButton(onClick={openBrowser(context,"https://play.google.com/store/account/subscriptions?package=com.monadicdna.explorer")}){Icon(Icons.Default.OpenInNew,contentDescription=null,modifier=Modifier.size(16.dp));Spacer(Modifier.width(6.dp));Text("Manage Google Play subscriptions",style=MaterialTheme.typography.labelLarge)}
        if(billing.busy) CircularProgressIndicator()
        if(billing.message.isNotBlank()) Text(billing.message)
        Text("The monthly subscription renews automatically unless cancelled in Google Play. Each report pass generates one report of that type.",style=MaterialTheme.typography.bodySmall)
        Text("Stablecoin payments are available only on Web. They are not available in the Android app.",style=MaterialTheme.typography.bodySmall)
    }
}
private val REPORT_NAMES=mapOf("overview" to "Overview","healthspan" to "Healthspan","top_traits" to "Top traits")
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
        if(model.busy){
            // While a run is on, Home is the processing screen: animation, status, progress. The global busy bar is suppressed on Home so this is the single indicator.
            Column(Modifier.fillMaxWidth().padding(vertical=24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){
                VaultStarLoader()
                Text(model.status,style=MaterialTheme.typography.titleMedium)
                model.progress?.let{LinearProgressIndicator(progress={it},modifier=Modifier.fillMaxWidth(0.6f))}
                Text("Everything runs on this device; nothing is uploaded.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(model.cancellable)TextButton(onClick=model::cancel){Text("Cancel")}
            }
        } else {
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
            // The ready Home opens on a dark brand panel with the user's own counts, so the first screen feels like their product, not a form.
            Column(Modifier.fillMaxWidth().background(VaultColors.darkMain,androidx.compose.foundation.shape.RoundedCornerShape(28.dp)).padding(22.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                androidx.compose.foundation.Image(painterResource(R.drawable.vault_brand_mark),contentDescription=null,modifier=Modifier.size(36.dp))
                Text("Your DNA. Your discoveries.",color=androidx.compose.ui.graphics.Color.White,fontFamily=Garamond,fontSize=28.sp)
                Text("${variants.grouped()} variants (SNP calls) • ${model.resultCount.grouped()} studies matching your DNA, analyzed on this device",color=androidx.compose.ui.graphics.Color.White.copy(alpha=0.75f),style=MaterialTheme.typography.bodySmall)
            }
            // The step rail becomes a compact status line once setup is done; actions lead.
            Text("DNA file added • ${if(model.personalized)"Personalization saved" else "Personalization skipped"}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick={go("Reports")},enabled=!model.busy){Text("Get my free Health report")}
            // Results at a glance, as on the web's /explore dashboard.
            model.dashboard?.let{p->
                val insight=p.optJSONObject("insight")
                Text("Your results at a glance",fontFamily=Garamond,fontSize=26.sp,color=VaultColors.darkMain)
                insight?.let{i->Text("${i.optInt("elevatedCount").grouped()} elevated • ${i.optInt("protectiveCount").grouped()} protective",style=MaterialTheme.typography.bodySmall)}
                p.optJSONArray("categories")?.takeIf{it.length()>0}?.let{categories->
                    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        (0 until minOf(categories.length(),8)).forEach{index->
                            val c=categories.getJSONObject(index);val palette=vaultCardPalette(c.optString("id"))
                            Card(onClick={go("Results")},colors=CardDefaults.cardColors(containerColor=palette.first,contentColor=palette.second)){Column(Modifier.padding(horizontal=16.dp,vertical=12.dp)){Text(c.optString("label"),style=MaterialTheme.typography.titleSmall);Text("${c.optInt("count").grouped()} matches",style=MaterialTheme.typography.bodySmall)}}
                        }
                        // The last card clears the screen edge when the carousel is scrolled fully.
                        Spacer(Modifier.width(16.dp))
                    }
                }
                insight?.optJSONObject("standout")?.let{standout->
                    Text("Strongest signal",style=MaterialTheme.typography.titleMedium)
                    ResultCard(standout){model.loadStudy(standout.optInt("studyId"))}
                }
            }
            Text("Ask about your DNA",fontFamily=Garamond,fontSize=28.sp,color=VaultColors.darkMain)
            Text("Chat answers questions using your ${model.resultCount.grouped()} research matches${if(model.personalized)" and what you told us about yourself" else ""}.",style=MaterialTheme.typography.bodyMedium)
            var question by remember{mutableStateOf("")}
            OutlinedTextField(value=question,onValueChange={question=it},label={Text("What would you like to know?")},modifier=Modifier.fillMaxWidth())
            Button(onClick={model.chatDraft=question;go("Chat")},enabled=question.isNotBlank()){Text("Ask")}
            CHAT_SUGGESTIONS.forEach{suggestion->PastelChip(onClick={model.chatDraft=suggestion;go("Chat")},label={Text(suggestion)})}
            if(!model.personalized)OutlinedCard(onClick={go("You")},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){Text("Make answers about you",style=MaterialTheme.typography.titleMedium);Text("Add your age, ancestry and health history. It stays encrypted on this device.",style=MaterialTheme.typography.bodySmall)}}
            Text("Reports",fontFamily=Garamond,fontSize=28.sp,color=VaultColors.darkMain,modifier=Modifier.padding(top=8.dp))
            ReportCards(model){go("Reports")}
            // The backup offer is secondary: it sits below the product content, not above the hero.
            if(model.syncOffered)OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Text("Keep your data on a new phone",style=MaterialTheme.typography.titleMedium)
                Text("Explorer can keep an end-to-end encrypted copy in a hidden folder in your own Google Drive, so a new Android phone fills in automatically. Monadic DNA never stores your data.",style=MaterialTheme.typography.bodySmall)
                Row{Button(onClick={model.setSync(true)},enabled=!model.busy){Text("Turn on")};Spacer(Modifier.width(8.dp));TextButton(onClick=model::declineSync){Text("Not now")}}
            }}
            Row(verticalAlignment=Alignment.CenterVertically){
                Text("${variants.grouped()} variants • ${model.resultCount.grouped()} matches",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                TextButton(onClick={go("Results")}){Text("Matches")};TextButton(onClick={go("Browse")}){Text("Browse")}
            }
        } else {
            if(model.syncing&&variants==0)Text("Restoring your data from your other device…",style=MaterialTheme.typography.titleMedium)
            // A first-run Home with no data gets the brand hero instead of bare text.
            if(variants==0&&!model.syncing)VaultHero()
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
                    if(!model.acceptedDisclaimer)TermsAgreement(onAgree=model::acceptTerms)
                    else Button(onClick={model.run("Preparing secure import"){model.unlockData();importDNA()}},enabled=!model.busy){Text("Choose DNA file")}
                }
            }
            // Users without a DNA export can get a kit; batching is the anonymity story, in plain language.
            if(variants==0){
                val context=LocalContext.current
                Text("Don't have a DNA file? Sign up for a Monadic DNA testing kit. We sequence kits in batches with other customers' samples instead of one at a time, which makes a sample harder to tie to you. Your results are then analyzed on this device.",style=MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick={openBrowser(context,"https://docs.google.com/forms/d/e/1FAIpQLSdHFDpsyU0t6PlaXEkbHX-pwF_y7icuPJeOHyGHMDpe11XigQ/viewform?usp=dialog")}){Text("Sign up for a testing kit")}
            }
            // Right after the match count lands, offer the fastest payoff before asking for profile details.
            if(variants>0&&!ready&&model.reportTitle!="Health")OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Text("See your results in under a minute",style=MaterialTheme.typography.titleMedium)
                Text("Your free Health report reads your ${model.resultCount.grouped()} research matches and summarizes the findings with the strongest evidence.",style=MaterialTheme.typography.bodySmall)
                Button(onClick={go("Reports")},enabled=!model.busy){Text("Get my free Health report")}
            }}
            Step(2,"Tell us about you",done=model.personalized,enabled=variants>0){
                Text("Two minutes here turns general findings into answers about you: Chat and Reports use your age, ancestry and health history. Everything is optional and stays encrypted on this device.",style=MaterialTheme.typography.bodySmall)
                if(variants>0&&!model.personalized)Row{Button(onClick={go("You")}){Text("Personalize")};TextButton(onClick=model::skipPersonalization){Text("Skip for now")}}
            }
            // Home switches to Chat and Reports once steps 1 and 2 are done, so step 3 is a preview here.
            Step(3,"Ask and read",done=false,enabled=false){
                Text("Read your free Health report, usually in under a minute, or chat about your matches.",style=MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick={go("Browse")}){Text("Browse research without your DNA")}
        }
        }
        Text("Genetic associations are educational research findings, not a diagnosis. Odds ratios are relative, not absolute risk; beta values describe trait changes.",style=MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun Step(number: Int, title: String, done: Boolean, enabled: Boolean, content: @Composable ColumnScope.()->Unit){
    // Done steps are tinted, the current step is outlined, and later steps are dimmed.
    // Done steps rest in mint, the live step in lavender: the rail reads as progress, not paperwork.
    val container=if(done)VaultColors.green100 else if(enabled)VaultColors.purple100 else MaterialTheme.colorScheme.surface
    OutlinedCard(Modifier.fillMaxWidth().alpha(if(enabled||done)1f else 0.45f),shape=androidx.compose.foundation.shape.RoundedCornerShape(24.dp),colors=CardDefaults.outlinedCardColors(containerColor=container),border=androidx.compose.foundation.BorderStroke(if(enabled&&!done)2.dp else 1.dp,if(enabled&&!done)VaultColors.purple900 else MaterialTheme.colorScheme.outline)){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
                // The step marker is a brand disc, not an emoji numeral, so it sits inside the type system.
                Box(Modifier.size(28.dp).background(MaterialTheme.colorScheme.primary,androidx.compose.foundation.shape.CircleShape),contentAlignment=Alignment.Center){Text(if(done)"✓" else "$number",color=MaterialTheme.colorScheme.onPrimary,style=MaterialTheme.typography.titleSmall)}
                Text(title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold)
            }
            if(enabled||!done)content()
        }
    }
}

@Composable private fun ReportCards(model: ExplorerModel, onClick: (String)->Unit){
    val premium=model.premiumActive
    // Each report gets its Vault category pastel and star, so the reports list reads as a family rather than four grey rows.
    val art=mapOf("Health" to Triple(VaultColors.green200,VaultColors.green900,R.drawable.vault_star),"Healthspan" to Triple(VaultColors.yellow200,VaultColors.yellow900,R.drawable.vault_star_yellow),"Top traits" to Triple(VaultColors.purple200,VaultColors.purple900,R.drawable.vault_star_orange),"Overview" to Triple(VaultColors.blue200,VaultColors.blue900,R.drawable.vault_star_blue))
    REPORTS.forEach{(kind,description)->
        val (background,ink,star)=art[kind]!!
        Card(onClick={onClick(kind)},modifier=Modifier.fillMaxWidth(),shape=androidx.compose.foundation.shape.RoundedCornerShape(24.dp),colors=CardDefaults.cardColors(containerColor=background,contentColor=ink)){Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
            androidx.compose.foundation.Image(painterResource(star),contentDescription=null,modifier=Modifier.size(28.dp))
            Column(Modifier.weight(1f)){Text("$kind report",style=MaterialTheme.typography.titleMedium);Text(description,style=MaterialTheme.typography.bodySmall)}
            // One plum Premium pill across cards; Free stays green; a generated report shows Open.
            val generated=model.reportTitle==kind&&model.report.isNotEmpty()
            val tier=if(generated)"Open" else if(kind=="Health")"Free" else if(premium)"" else "Premium"
            val pillColor=if(generated)ink else if(kind=="Health")VaultColors.green900 else VaultColors.purple900
            if(tier.isNotEmpty())Surface(shape=androidx.compose.foundation.shape.RoundedCornerShape(50),color=if(kind=="Health"&&!generated)pillColor.copy(alpha=0.12f) else pillColor,contentColor=if(kind=="Health"&&!generated)pillColor else androidx.compose.ui.graphics.Color.White){Text(tier,Modifier.padding(horizontal=10.dp,vertical=4.dp),style=MaterialTheme.typography.labelMedium)}
        }}
    }
}

@Composable private fun YouScreen(model: ExplorerModel, done: ()->Unit, openVault: ()->Unit){ScreenColumn{
    Text("About you",fontFamily=Garamond,fontSize=28.sp,color=VaultColors.darkMain)
    Text("Optional details make Chat and Reports specific to you. They are encrypted on this device and only shared with your AI provider when you allow it.",style=MaterialTheme.typography.bodySmall)
    if(!model.dataUnlocked){OutlinedButton(onClick=model::unlockSavedData,enabled=!model.busy){Text("Unlock to edit")}}
    else {
        // Personalization is collapsed by default, so Health and Your data are visible without scrolling.
        var aboutOpen by remember{mutableStateOf(false)}
        Row(Modifier.fillMaxWidth().toggleable(value=aboutOpen,role=Role.Button,onValueChange={aboutOpen=it}).padding(vertical=4.dp),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f)){
                Text("Personalization",style=MaterialTheme.typography.titleLarge,color=VaultColors.purple900)
                Text(if(model.personalized)"Saved. Tap to review your details." else "Age, ancestry, health history and more, all optional",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(if(aboutOpen)Icons.Default.ExpandLess else Icons.Default.ExpandMore,contentDescription=if(aboutOpen)"Collapse personalization" else "Expand personalization")
        }
        if(aboutOpen){
        model.profileSchema.forEach { field ->
            val key=field.getString("key")
            if(field.getString("type")=="select") {
                Text(field.getString("label"),style=MaterialTheme.typography.labelLarge)
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { field.getJSONArray("options").objects().forEach { option ->
                    FilterChip(enabled=!model.syncing && !model.locking,selected=model.profileFields[key].orEmpty()==option.getString("value"),onClick={model.profileFields[key]=option.getString("value")},label={Text(option.getString("label"))},border=vaultChipBorder())
                } }
            } else {
                // Schema labels carry the input hint; show it as supporting text so labels stay short.
                val label=field.getString("label")
                val short=label.removeSuffix(" (comma separated)")
                OutlinedTextField(value=model.profileFields[key].orEmpty(),onValueChange={model.profileFields[key]=it},enabled=!model.syncing && !model.locking,label={Text(short)},supportingText=if(short!=label){{Text("Separate entries with commas.")}} else null,modifier=Modifier.fillMaxWidth())
            }
        }
        OutlinedTextField(value=model.profile,onValueChange={model.profile=it},enabled=!model.syncing && !model.locking,label={Text("Anything else for your reports (optional)")},modifier=Modifier.fillMaxWidth())
        Text("Saved automatically.",style=MaterialTheme.typography.bodySmall)
        }
    }
    if(model.health.available()){
        Text("Health data from this device",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=8.dp))
        Text("Optional. Thirty-day averages (resting heart rate, sleep, steps, weight) enrich chat and report answers. Raw records stay on this device.",style=MaterialTheme.typography.bodySmall)
        val healthPerms=rememberLauncherForActivityResult(model.health.permissionContract()){granted->model.pickingFile=false;model.changeHealthEnabled(granted.containsAll(model.health.permissions))}
        Row(Modifier.fillMaxWidth().toggleable(value=model.healthEnabled,role=Role.Switch,onValueChange={if(it){model.pickingFile=true;healthPerms.launch(model.health.permissions)} else model.changeHealthEnabled(false)}),verticalAlignment=Alignment.CenterVertically){
            Text("Include device health averages",Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge);Switch(checked=model.healthEnabled,onCheckedChange=null)
        }
    }
    Text("Your data",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))
    Row{OutlinedButton(onClick=openVault){Text("Vault and backups")};Spacer(Modifier.width(8.dp));if(model.dataUnlocked)TextButton(onClick=model::lockData,enabled=!model.busy){Text("Lock data")}}
    if(model.dataUnlocked)Text("Changes save automatically.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}}
