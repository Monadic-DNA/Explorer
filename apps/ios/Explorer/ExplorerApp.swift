import SwiftUI
import UniformTypeIdentifiers

@main struct ExplorerApp: App {
    @StateObject private var store=ExplorerStore()
    var body: some Scene { WindowGroup { ExplorerView().environmentObject(store).onOpenURL{store.receiveAuth($0)} } }
}

struct TextExport: FileDocument {
    static var readableContentTypes:[UTType] { [.data] }
    var data:Data
    init(_ text:String=""){data=Data(text.utf8)}
    init(configuration:ReadConfiguration)throws{data=configuration.file.regularFileContents ?? Data()}
    func fileWrapper(configuration:WriteConfiguration)throws->FileWrapper{FileWrapper(regularFileWithContents:data)}
}

struct ExplorerView: View {
    @EnvironmentObject var store:ExplorerStore
    @State private var selectedTab=0
    @State private var importing=false
    @State private var importKind="dna"
    @State private var exporting=false
    @State private var exportDocument=TextExport()
    @State private var exportName="monadic-results.tsv"
    @State private var vaultPassword=""
    func startImport(_ kind:String){importKind=kind;importing=true}
    func export(_ name:String,_ text:String){exportName=name;exportDocument=TextExport(text);exporting=true}
    var body: some View {
        VStack(spacing:0){
            if store.busy{HStack{ProgressView();Text(store.status).font(.caption);Spacer();Button("Cancel",action:store.cancel)}.padding()}
            TabView(selection:$selectedTab){
                NavigationStack{HomeView(importDNA:{startImport("dna")},browse:{selectedTab=1})}.tabItem{Label("Home",systemImage:"house")}.tag(0)
                NavigationStack{BrowseView()}.tabItem{Label("Browse",systemImage:"magnifyingglass")}.tag(1)
                NavigationStack{ResultsView(export:export,importResults:{startImport("results")})}.tabItem{Label("Results",systemImage:"list.bullet")}.tag(2)
                NavigationStack{ChatView()}.tabItem{Label("Chat",systemImage:"bubble.left.and.bubble.right")}.tag(3)
                NavigationStack{List{
                    NavigationLink("Reports"){ReportsView(export:export)}
                    NavigationLink("On-device vault"){VaultView(password:$vaultPassword,importDNA:{startImport("dna")},importVault:{startImport("vault")},export:export)}
                    NavigationLink("Connection and provider settings"){SettingsView()}
                    NavigationLink("Account and premium"){AccountView()}
                    Section("Supported DNA exports"){Text("23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, Monadic DNA and compatible raw files. Gzip archives are supported.")}
                }.navigationTitle("More")}.tabItem{Label("More",systemImage:"ellipsis")}.tag(4)
            }
        }
        .sheet(item:$store.selectedStudy){record in NavigationStack{StudyView(record:record).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){store.selectedStudy=nil}}}}}
        .alert("Explorer",isPresented:Binding(get:{store.error != nil},set:{if !$0{store.error=nil}})){Button("OK"){store.error=nil}}message:{Text(store.error ?? "")}
        .fileImporter(isPresented:$importing,allowedContentTypes:[.data]){result in
            switch result{
            case .success(let url):
                switch importKind{case "results":store.importResults(url);case "vault":let password=vaultPassword;vaultPassword="";store.unlockVault(password,file:url);default:store.importDNA(url)}
            case .failure(let error):store.error=error.localizedDescription
            }
        }
        .fileExporter(isPresented:$exporting,document:exportDocument,contentType:.data,defaultFilename:exportName){result in if case .failure(let error)=result{store.error=error.localizedDescription}}
    }
}

struct HomeView:View{
    @EnvironmentObject var store:ExplorerStore
    var importDNA:()->Void
    var browse:()->Void
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:20){
        Text("Your DNA. Your discoveries.").font(.largeTitle.bold())
        Text("Explore genetic research, match your variants on device, and understand associations with private provider-based analysis.")
        Toggle("I understand this is educational research, not medical advice.",isOn:$store.acceptedDisclaimer)
        Button("Import your DNA",action:importDNA).buttonStyle(.borderedProminent).disabled(!store.acceptedDisclaimer)
        Button("Browse studies",action:browse).buttonStyle(.bordered)
        Text("\(store.variantCount) variants • \(store.results.count) saved study matches")
        if !store.results.isEmpty,let insight=try? Core.object("preview_insight",store.results.map(\.raw)){
            Text(insight["headline"] as? String ?? "").font(.headline)
            Text("\(insight["protectiveCount"] as? Int ?? 0) protective associations • \(insight["elevatedCount"] as? Int ?? 0) elevated associations")
        }
        Text("Associations are not diagnoses or individual health predictions. Odds ratios are relative, not absolute risk; beta values describe trait changes.").font(.footnote).foregroundStyle(.secondary)
    }.padding()}.navigationTitle("Monadic DNA")}
}

struct BrowseView:View{
    @EnvironmentObject var store:ExplorerStore
    @State private var query=""
    @State private var trait=""
    @State private var semantic=true
    @State private var offset=0
    var body:some View{VStack{
        Form{
            TextField("Trait, study, gene or SNP",text:$query).autocorrectionDisabled()
            TextField("Trait filter (optional)",text:$trait)
            Toggle("Semantic search",isOn:$semantic)
            Button("Search"){offset=0;store.browse(query,trait,semantic:semantic)}.disabled(store.busy)
        }.frame(height:230)
        List(store.studies){study in Button{store.selectedStudy=study}label:{VStack(alignment:.leading,spacing:6){Text(study.text("disease_trait")).font(.headline);Text(study.text("study")).font(.subheadline).foregroundStyle(.secondary);Text("\(study.text("study_accession")) • \(study.text("confidenceBand","Research finding"))").font(.caption)}}.tint(.primary)}
        HStack{Button("Previous"){offset=max(0,offset-50);store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(offset==0||store.busy);Spacer();Button("Next"){offset+=50;store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(store.studies.isEmpty||store.busy)}.padding()
    }.navigationTitle("Browse research")}
}

struct StudyView:View{
    @EnvironmentObject var store:ExplorerStore
    let record:Record
    var body:some View{List{
        Section{Text(record.text("disease_trait")).font(.title2.bold());Text(record.text("study"));Button("Match my DNA on device"){store.analyze(record)}.disabled(store.busy)}
        if let result=store.results.first(where:{$0.id==record.id}){Section("Your match"){ResultView(record:result)}}
        Section("Research details"){
            ForEach([("study_accession","Accession"),("mapped_gene","Genes"),("snps","Variants"),("strongest_snp_risk_allele","Risk allele"),("or_or_beta","OR / beta"),("ci_text","Effect interval"),("p_value","P-value"),("initial_sample_size","Discovery sample"),("replication_sample_size","Replication sample"),("first_author","Author"),("journal","Journal"),("date","Publication date")],id:\.0){key,label in
                if !record.text(key).isEmpty{LabeledContent(label,value:record.text(key))}
            }
        }
        if let pmid=Int(record.text("pubmedid")),let url=URL(string:"https://pubmed.ncbi.nlm.nih.gov/\(pmid)/"){Link("Read original publication",destination:url)}
        Text("Educational interpretation, not diagnosis. Study ancestry, cohort size, replication and environment affect interpretation.").font(.footnote)
    }.navigationTitle("Study")}
}

struct ResultView:View{
    let record:Record
    var evidence:String{(try? Core.object("evidence",record.raw)["label"] as? String) ?? "Research finding"}
    var body:some View{VStack(alignment:.leading,spacing:5){Text(record.text("traitName")).font(.headline);Text("\(record.text("matchedSnp")): \(record.text("userGenotype")) • \(record.text("effectType","OR")) \(record.number("riskScore"),specifier:"%.3f")");Text(record.text("riskLevel")).font(.subheadline);Text(evidence).font(.caption).foregroundStyle(.secondary)}}
}

struct ResultsView:View{
    @EnvironmentObject var store:ExplorerStore
    var export:(String,String)->Void
    var importResults:()->Void
    @State private var filter=""
    var body:some View{List{
        Section{
            Text("\(store.results.count) saved study matches")
            Button("Run all studies",action:store.runAll).disabled(store.busy)
            Button("Export results as TSV"){do{export("monadic-results.tsv",try store.exportResults())}catch{store.error=error.localizedDescription}}.disabled(store.results.isEmpty)
            Button("Import saved results",action:importResults)
            TextField("Filter saved traits",text:$filter)
        }
        ForEach(store.results.filter{filter.isEmpty||$0.text("traitName").localizedCaseInsensitiveContains(filter)}){record in ResultView(record:record)}
    }.navigationTitle("Your results")}
}

struct ProviderConsent:View{
    @EnvironmentObject var store:ExplorerStore
    var body:some View{Toggle("Allow matched results and profile context to be sent to my selected LLM provider.",isOn:$store.shareResultsWithLLM).font(.footnote)}
}
struct ChatView:View{
    @EnvironmentObject var store:ExplorerStore
    @State private var message=""
    var body:some View{VStack{
        ProviderConsent().padding()
        List(Array(store.messages.enumerated()),id:\.offset){item in VStack(alignment:.leading,spacing:8){Text(item.element.0).font(.caption.bold());Text(.init(item.element.1)).textSelection(.enabled)}}
        HStack{TextField("Ask about your findings",text:$message,axis:.vertical).textFieldStyle(.roundedBorder);Button("Send"){store.sendChat(message);message=""}.disabled(store.busy||message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}.padding()
    }.navigationTitle("DNA chat")}
}
struct ReportsView:View{
    @EnvironmentObject var store:ExplorerStore
    var export:(String,String)->Void
    var body:some View{List{
        ProviderConsent()
        ForEach(["Overview","Health","Healthspan","Top traits"],id:\.self){kind in Button("Generate \(kind) report"){store.generateReport(kind)}.disabled(store.busy||store.results.isEmpty)}
        if !store.report.isEmpty{Section(store.reportTitle){Text(.init(store.report)).textSelection(.enabled);Button("Export Markdown report"){export("monadic-report.md",store.report)}}
        if !store.reportQuestions.isEmpty{Section("Ask a follow-up"){ForEach(store.reportQuestions,id:\.self){question in Button(question){store.sendChat(question)}.disabled(store.busy)}}}
    }.navigationTitle("Reports")}
}

struct VaultView:View{
    @EnvironmentObject var store:ExplorerStore
    @Binding var password:String
    var importDNA:()->Void
    var importVault:()->Void
    var export:(String,String)->Void
    @State private var confirmDelete=false
    var body:some View{Form{
        Section("On-device genetic data"){
            Text("\(store.variantCount) variants • \(store.results.count) results. Genetic data stays in memory until you explicitly save an encrypted vault.")
            Toggle("I understand this is educational research, not medical advice.",isOn:$store.acceptedDisclaimer)
            Button("Import DNA (.txt, .tsv, .csv, .gz)",action:importDNA).disabled(!store.acceptedDisclaimer||store.busy)
        }
        Section("Encrypted vault"){
            SecureField("Vault passphrase",text:$password).textContentType(.password)
            Button("Save encrypted vault"){let p=password;password="";store.saveVault(p)}.disabled(password.count<8||store.busy)
            Button("Unlock saved vault"){let p=password;password="";store.unlockVault(p)}.disabled(password.isEmpty||store.busy)
            Button("Lock and clear memory",action:store.clear)
            Button("Export encrypted portable vault"){
                let p=password;password="";store.work("Encrypting portable vault"){export("monadic-vault.json",try await store.encryptedVault(p))}
            }.disabled(password.count<8||store.busy)
            Button("Import portable vault using this passphrase",action:importVault).disabled(password.isEmpty||store.busy)
            Button("Delete local vault",role:.destructive){confirmDelete=true}
        }
    }.navigationTitle("Private vault").confirmationDialog("Delete this device's vault and clear memory?",isPresented:$confirmDelete){Button("Delete",role:.destructive){do{try store.deleteVault()}catch{store.error=error.localizedDescription}}}}
}

struct SettingsView:View{
    @EnvironmentObject var store:ExplorerStore
    var body:some View{Form{
        Section("Research and account backend"){
            TextField("HTTPS origin",text:$store.backend).keyboardType(.URL).autocorrectionDisabled().textInputAutocapitalization(.never)
            Text("Your raw DNA remains on this device. The backend provides the public research catalog and account services.").font(.footnote)
        }
        Section("LLM provider"){
            Picker("Provider",selection:Binding(get:{store.provider},set:{store.selectProvider($0)})){Text("HuggingFace").tag("huggingface");Text("Ollama").tag("ollama");Text("nilAI").tag("nilai")}
            TextField("Model",text:$store.model).autocorrectionDisabled().textInputAutocapitalization(.never)
            SecureField("Your provider API key",text:$store.apiKey)
            if store.provider=="ollama"{TextField("Ollama hostname",text:$store.ollamaAddress).autocorrectionDisabled().textInputAutocapitalization(.never);TextField("Ollama port",text:$store.ollamaPort).keyboardType(.numberPad)}
            if store.provider=="nilai"{Text("Leave the key blank for one-use backend delegation. Prompts go directly to nilAI; only your public key visits the backend.").font(.footnote)}
        }
        Section("Optional personalization"){
            ForEach(store.profileSchema){field in
                let value=Binding<String>(get:{store.profileFields[field.key] ?? ""},set:{store.profileFields[field.key]=$0})
                if let options=field.options{Picker(field.label,selection:value){ForEach(options){Text($0.label).tag($0.value)}}}
                else{TextField(field.label,text:value,axis:.vertical)}
            }
            TextField("Additional context for reports",text:$store.profile,axis:.vertical)
        }
        Button("Save securely in Keychain"){do{try store.saveSettings()}catch{store.error=error.localizedDescription}}
    }.navigationTitle("Settings")}
}

struct AccountView:View{
    @EnvironmentObject var store:ExplorerStore
    @State private var promo=""
    var body:some View{Form{
        Section("Account"){
            Text(store.wallet.isEmpty ? "Not signed in":store.wallet).font(.caption).textSelection(.enabled)
            Button("Sign in with Dynamic"){do{try store.beginAuth()}catch{store.error=error.localizedDescription}}
            Button("Refresh subscription and blockchain payments",action:store.refreshSubscription).disabled(store.wallet.isEmpty||store.busy)
            if let status=store.subscription,let data=try? JSONSerialization.data(withJSONObject:status,options:[.prettyPrinted,.sortedKeys]){Text(String(decoding:data,as:UTF8.self)).font(.caption.monospaced())}
            Button("Subscribe with card",action:store.checkout).disabled(store.wallet.isEmpty||store.busy)
            if let url=URL(string:store.backend.trimmingCharacters(in:CharacterSet(charactersIn:"/"))+"/subscribe"){Link("Manage subscription or pay with connected wallet",destination:url)}
            Button("Sign out"){do{try store.signOut()}catch{store.error=error.localizedDescription}}
        }
        Section("Promo"){
            TextField("Promo code",text:$promo)
            Button("Apply code"){do{try store.applyPromo(promo)}catch{store.error=error.localizedDescription}}
        }
        Text("Provider checkout and wallet authorization use the system browser. Server API keys are never embedded in this application.").font(.footnote)
    }.navigationTitle("Account and premium")}
}
