import SwiftUI
import UniformTypeIdentifiers

@main struct ExplorerApp: App {
    @StateObject private var store=ExplorerStore()
    @Environment(\.scenePhase) private var scenePhase
    init() { VaultStyle.configure() }
    var body: some Scene { WindowGroup { ExplorerView().font(VaultStyle.body()).tint(VaultStyle.ink).preferredColorScheme(.light).environmentObject(store).onOpenURL{store.receiveAuth($0)}
        .overlay { if scenePhase != .active || store.locking { ZStack { Color("vault_offTone").ignoresSafeArea(); Label("Your data is protected",systemImage:"lock.shield").font(.headline) } } }
        .onChange(of:scenePhase) { _, phase in if phase == .background { store.backgroundLock() } } } }
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
            HStack { Text(store.storageMessage).font(.caption); Spacer();
                if store.dataUnlocked { Button("Lock data",action:store.lockData).disabled(store.busy) }
                else { Button("Unlock data",action:store.unlockSavedData).disabled(store.busy) }
            }.padding(.horizontal).padding(.vertical,8)
            if store.busy{HStack{ProgressView();Text(store.status).font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption));Spacer();Button("Cancel",action:store.cancel)}.padding()}
            TabView(selection:$selectedTab){
                NavigationStack{HomeView(importDNA:{startImport("dna")},browse:{selectedTab=1})}.tabItem{Label("Home",systemImage:"house")}.tag(0)
                NavigationStack{BrowseView()}.tabItem{Label("Browse",systemImage:"magnifyingglass")}.tag(1)
                NavigationStack{ResultsView(export:export,importResults:{startImport("results")})}.tabItem{Label("Results",systemImage:"list.bullet")}.tag(2)
                NavigationStack{ChatView()}.tabItem{Label("Chat",systemImage:"bubble.left.and.bubble.right")}.tag(3)
                NavigationStack{List{
                    VaultArt(name:"vault").listRowBackground(Color.clear)
                    NavigationLink("Reports"){ReportsView(export:export)}
                    NavigationLink("On-device vault"){VaultView(password:$vaultPassword,importDNA:{startImport("dna")},importVault:{startImport("vault")},export:export)}
                    NavigationLink("Connection and provider settings"){SettingsView()}
                    NavigationLink("Account and premium"){AccountView(billing:store.billing)}
                    Section("Supported DNA exports"){Text("23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, Monadic DNA and compatible raw files. Gzip archives are supported.")}
                }.vaultScreen().navigationTitle("More")}.tabItem{Label("More",systemImage:"ellipsis")}.tag(4)
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
        VaultHero()
        Toggle("I understand this is educational research, not medical advice.",isOn:$store.acceptedDisclaimer)
        Button("Import your DNA",action:importDNA).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(!store.acceptedDisclaimer)
        Button("Browse studies",action:browse).buttonStyle(.bordered).buttonBorderShape(.capsule)
        Text("\(store.variantCount) variants • \(store.results.count) saved study matches")
        if !store.results.isEmpty,let insight=try? Core.object("preview_insight",store.results.map(\.raw)){
            Text(insight["headline"] as? String ?? "").font(.custom("SpaceGrotesk-Bold",size:17,relativeTo:.headline))
            Text("\(insight["protectiveCount"] as? Int ?? 0) protective associations • \(insight["elevatedCount"] as? Int ?? 0) elevated associations")
        }
        Text("Associations are not diagnoses or individual health predictions. Odds ratios are relative, not absolute risk; beta values describe trait changes.").font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote)).foregroundStyle(.secondary)
    }.padding()}.vaultScreen().navigationTitle("Explorer").navigationBarTitleDisplayMode(.inline)}
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
        List(store.studies){study in Button{store.selectedStudy=study}label:{VStack(alignment:.leading,spacing:6){Text(study.text("disease_trait")).font(.custom("SpaceGrotesk-Bold",size:17,relativeTo:.headline));Text(study.text("study")).font(.custom("SpaceGrotesk-Regular",size:15,relativeTo:.subheadline)).foregroundStyle(.secondary);Text("\(study.text("study_accession")) • \(study.text("confidenceBand","Research finding"))").font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption))}}.tint(.primary)}
        HStack{Button("Previous"){offset=max(0,offset-50);store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(offset==0||store.busy);Spacer();Button("Next"){offset+=50;store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(store.studies.isEmpty||store.busy)}.padding()
    }.vaultScreen().navigationTitle("Browse research")}
}

struct StudyView:View{
    @EnvironmentObject var store:ExplorerStore
    let record:Record
    var body:some View{List{
        Section{Text(record.text("disease_trait")).font(VaultStyle.heading(24));Text(record.text("study"));Button("Match my DNA on device"){store.analyze(record)}.disabled(store.busy)}
        if let result=store.results.first(where:{$0.id==record.id}){Section("Your match"){ResultView(record:result)}}
        Section("Research details"){
            ForEach([("study_accession","Accession"),("mapped_gene","Genes"),("snps","Variants"),("strongest_snp_risk_allele","Risk allele"),("or_or_beta","OR / beta"),("ci_text","Effect interval"),("p_value","P-value"),("initial_sample_size","Discovery sample"),("replication_sample_size","Replication sample"),("first_author","Author"),("journal","Journal"),("date","Publication date")],id:\.0){key,label in
                if !record.text(key).isEmpty{LabeledContent(label,value:record.text(key))}
            }
        }
        if let pmid=Int(record.text("pubmedid")),let url=URL(string:"https://pubmed.ncbi.nlm.nih.gov/\(pmid)/"){Link("Read original publication",destination:url)}
        Text("Educational interpretation, not diagnosis. Study ancestry, cohort size, replication and environment affect interpretation.").font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote))
    }.vaultScreen().navigationTitle("Study")}
}

struct ResultView:View{
    let record:Record
    var palette: (background: Color, foreground: Color) { VaultStyle.cardPalette((try? Core.object("preview_category",record.raw)["id"] as? String) ?? "other") }
    var evidence:String{(try? Core.object("evidence",record.raw)["label"] as? String) ?? "Research finding"}
    var body:some View {
        VStack(alignment: .leading, spacing: 10) {
            Image("vault_star").resizable().scaledToFit().frame(width:28,height:28).accessibilityHidden(true)
            Text(record.text("traitName")).font(VaultStyle.cardTitle).fixedSize(horizontal:false, vertical:true)
            Text("\(record.text("matchedSnp")): \(record.text("userGenotype")) • \(record.text("effectType","OR")) \(record.number("riskScore"),specifier:"%.3f")")
            Text(record.text("riskLevel"))
            Text(evidence).font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption))
        }
        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(palette.foreground)
        .background(palette.background, in: RoundedRectangle(cornerRadius:40))
        .listRowBackground(Color.clear).listRowSeparator(.hidden)
    }
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
    }.vaultScreen().navigationTitle("Your results")}
}

struct ProviderConsent:View{
    @EnvironmentObject var store:ExplorerStore
    var body:some View{Toggle("Allow matched results and profile context to be sent to my selected LLM provider.",isOn:$store.shareResultsWithLLM).font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote))}
}
struct ChatView:View{
    @EnvironmentObject var store:ExplorerStore
    @State private var message=""
    var body:some View{VStack{
        ProviderConsent().padding()
        List(Array(store.messages.enumerated()),id:\.offset){item in VStack(alignment:.leading,spacing:8){Text(item.element.0).font(.caption.bold());Text(.init(item.element.1)).textSelection(.enabled)}}
        HStack{TextField("Ask about your findings",text:$message,axis:.vertical).textFieldStyle(.roundedBorder);Button("Send"){store.sendChat(message);message=""}.disabled(store.busy||message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}.padding()
    }.vaultScreen().navigationTitle("DNA chat")}
}
struct ReportsView:View{
    @EnvironmentObject var store:ExplorerStore
    var export:(String,String)->Void
    var body: some View {
        List {
            VaultArt(name: "discover").listRowBackground(Color.clear)
            ProviderConsent()
            ForEach(["Overview", "Health", "Healthspan", "Top traits"], id: \.self) { kind in
                Button("Generate \(kind) report") { store.generateReport(kind) }
                    .disabled(store.busy || store.results.isEmpty)
            }
            if !store.report.isEmpty {
                Section(store.reportTitle) {
                    Text(.init(store.report)).textSelection(.enabled)
                    Button("Export Markdown report") { export("monadic-report.md", store.report) }
                }
            }
            if !store.reportQuestions.isEmpty {
                Section("Ask a follow-up") {
                    ForEach(store.reportQuestions, id: \.self) { question in
                        Button(question) { store.sendChat(question) }.disabled(store.busy)
                    }
                }
            }
        }.vaultScreen().navigationTitle("Reports")
    }
}

struct VaultView:View{
    @EnvironmentObject var store:ExplorerStore
    @Binding var password:String
    var importDNA:()->Void
    var importVault:()->Void
    var export:(String,String)->Void
    @State private var confirmDelete=false
    @State private var confirmRestore=false
    @State private var confirmCloudDelete=false
    var body:some View{Form{
        VaultArt(name:"vault").listRowBackground(Color.clear)
        Section("On-device genetic data"){
            Text("DNA, results and customization are saved automatically in an encrypted vault after device authentication. Locking clears your decrypted session.")
            Text(store.storageMessage)
            Toggle("I understand this is educational research, not medical advice.",isOn:$store.acceptedDisclaimer)
            Button("Import DNA (.txt, .tsv, .csv, .gz)",action:importDNA).disabled(!store.acceptedDisclaimer||store.busy)
            Button(store.dataUnlocked ? "Lock saved data" : "Unlock saved data"){if store.dataUnlocked{store.lockData()}else{store.unlockSavedData()}}.disabled(store.busy)
        }
        Section("Encrypted recovery and transfer"){
            Text("Use a unique recovery passphrase of at least 12 characters. Keep it somewhere safe: we cannot recover it. Device keys stay on their original devices.")
            SecureField("Recovery passphrase",text:$password).textContentType(.password)
            Button("Export encrypted portable vault"){
                let p=password;password="";store.work("Encrypting portable vault"){export("monadic-vault.json",try await store.encryptedVault(p))}
            }.disabled(password.count<12||store.busy)
            Button("Import portable vault (replaces device data)",action:importVault).disabled(password.isEmpty||store.busy)
            Button("Migrate previous saved vault"){let p=password;password="";store.unlockVault(p)}.disabled(password.isEmpty||store.busy)
        }
        Section("Optional encrypted multi-device sync"){
            Text("Sign in to the same Explorer account on each device. Only encrypted data and a passphrase-protected data key are uploaded. Concurrent edits require a choice before replacing data.")
            Button("Enable encrypted sync"){let p=password;password="";store.enableSync(p)}.disabled(password.count<12||store.busy||store.wallet.isEmpty)
            Button("Sync now",action:store.syncNow).disabled(store.busy||store.syncing)
            Button("Restore cloud copy (replaces device data)"){confirmRestore=true}.disabled(password.isEmpty||store.busy||store.wallet.isEmpty)
            Button("Disable sync on this device",action:store.disableSync).disabled(!store.dataUnlocked||store.busy)
            Button("Delete encrypted cloud copy",role:.destructive){confirmCloudDelete=true}.disabled(!store.dataUnlocked||store.busy||store.wallet.isEmpty)
        }
        Button("Delete local vault",role:.destructive){confirmDelete=true}.disabled(store.busy)
    }.vaultScreen().navigationTitle("Private vault")
    .confirmationDialog("Delete this device's vault and clear memory? Cloud data is retained.",isPresented:$confirmDelete){Button("Delete",role:.destructive,action:store.deleteVault)}
    .confirmationDialog("Replace device data with the cloud copy? Export a backup first to retain local changes.",isPresented:$confirmRestore){Button("Replace device data",role:.destructive){let p=password;password="";store.restoreCloud(p)}}
    .confirmationDialog("Delete the cloud copy? Other devices will need to set up sync again.",isPresented:$confirmCloudDelete){Button("Delete cloud copy",role:.destructive,action:store.deleteCloud)}
    }
}

struct SettingsView:View{
    @EnvironmentObject var store:ExplorerStore
    var body:some View{Form{
        Section("Research and account backend"){
            TextField("HTTPS origin",text:$store.backend).keyboardType(.URL).autocorrectionDisabled().textInputAutocapitalization(.never)
            Text("DNA is processed on device. Optional sync uploads only encrypted vault data. The backend also provides research and account services.").font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote))
        }
        Section("LLM provider"){
            Picker("Provider",selection:Binding(get:{store.provider},set:{store.selectProvider($0)})){Text("HuggingFace").tag("huggingface");Text("Ollama").tag("ollama");Text("nilAI").tag("nilai")}
            TextField("Model",text:$store.model).autocorrectionDisabled().textInputAutocapitalization(.never)
            SecureField("Your provider API key",text:$store.apiKey)
            if store.provider=="ollama"{TextField("Ollama hostname",text:$store.ollamaAddress).autocorrectionDisabled().textInputAutocapitalization(.never);TextField("Ollama port",text:$store.ollamaPort).keyboardType(.numberPad)}
            if store.provider=="nilai"{Text("Leave the key blank for one-use backend delegation. Prompts go directly to nilAI; only your public key visits the backend.").font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote))}
        }
        Section("Optional personalization"){
            if !store.dataUnlocked { Button("Unlock customization",action:store.unlockSavedData) }
            ForEach(store.profileSchema){field in
                let value=Binding<String>(get:{store.profileFields[field.key] ?? ""},set:{store.profileFields[field.key]=$0})
                if let options=field.options{Picker(field.label,selection:value){ForEach(options){Text($0.label).tag($0.value)}}.disabled(!store.dataUnlocked || store.syncing || store.locking)}
                else{TextField(field.label,text:value,axis:.vertical).disabled(!store.dataUnlocked || store.syncing || store.locking)}
            }
            TextField("Additional context for reports",text:$store.profile,axis:.vertical).disabled(!store.dataUnlocked || store.syncing || store.locking)
            Text("Customization is saved automatically in the encrypted data vault.").font(.footnote)
        }
        Button("Save securely in Keychain"){do{try store.saveSettings()}catch{store.error=error.localizedDescription}}
    }.vaultScreen().navigationTitle("Settings")}
}

struct AccountView: View {
    @EnvironmentObject var store: ExplorerStore
    @ObservedObject var billing: StoreBilling
    var body: some View {
        Form {
            Section("Account") {
                Text(store.wallet.isEmpty ? "Not signed in" : store.wallet).font(.caption).textSelection(.enabled)
                Button("Sign in with Dynamic") { do { try store.beginAuth() } catch { store.error = error.localizedDescription } }
                Button("Refresh access", action:store.refreshSubscription).disabled(store.wallet.isEmpty || store.busy)
                if let subscription = store.subscription?["subscription"] as? [String:Any] {
                    Text(subscription["isActive"] as? Bool == true ? "Premium access is active" : "No active subscription")
                }
            }
            Section("App Store purchases") {
                Text("Sign in to associate purchases with your Explorer account. Prices and payment confirmation are provided by the App Store.")
                ForEach(billing.products) { product in
                    VStack(alignment:.leading, spacing:8) {
                        Text(product.displayName).font(.headline)
                        Text(product.description).font(.subheadline)
                        Button(product.type == .autoRenewable ? "Subscribe — \(product.displayPrice) / month" : "Buy — \(product.displayPrice)") {
                            Task { await billing.purchase(product) }
                        }.disabled(billing.loading || store.wallet.isEmpty)
                    }
                }
                Button("Reload products") { Task { await billing.load() } }.disabled(billing.loading)
                Button("Restore purchases") { Task { await billing.restore() } }.disabled(billing.loading || store.wallet.isEmpty)
                Button("Manage Apple subscriptions") { Task { await billing.manage() } }
                if !billing.message.isEmpty { Text(billing.message).font(.footnote) }
                if billing.loading { ProgressView() }
                Text("The monthly subscription renews automatically unless cancelled in your App Store subscription settings. One-time report purchases each provide one report run.").font(.footnote)
                Link("Privacy policy", destination:URL(string:"https://github.com/Monadic-DNA/Explorer/blob/main/privacy_policy.md")!)
                Link("Terms of use", destination:URL(string:"https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            }
            Section("Stablecoin payments") {
                Text("Stablecoin payments are available only on Web. They are not available in the iOS app.")
            }
            Button("Sign out") { do { try store.signOut() } catch { store.error = error.localizedDescription } }
        }
        .vaultScreen().navigationTitle("Account and premium")
        .task { billing.attach(store); await billing.load(); try? await billing.recover() }
        .onChange(of:store.wallet) { _, _ in Task { try? await billing.recover() } }
    }
}
