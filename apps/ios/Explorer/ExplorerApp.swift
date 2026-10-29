import SwiftUI
import UniformTypeIdentifiers

@main struct ExplorerApp: App {
    @StateObject private var store=ExplorerStore()
    @Environment(\.scenePhase) private var scenePhase
    init() { VaultStyle.configure() }
    var body: some Scene { WindowGroup { ExplorerView().font(VaultStyle.body()).tint(VaultStyle.ink).preferredColorScheme(.light).environmentObject(store)
        .overlay { if scenePhase != .active || store.locking { ZStack { Color("vault_offTone").ignoresSafeArea(); Label("Your data is protected",systemImage:"lock.shield").font(.headline) } } }
        .onChange(of:scenePhase) { _, phase in if phase == .background { store.backgroundLock() } } } }
}

// Sheets cover the root view, so each presentation shows its own error and notice alerts.
struct ExplorerMessages: ViewModifier {
    @EnvironmentObject var store:ExplorerStore
    var openAccount:()->Void={}
    func body(content:Content)->some View {
        content
            // Access requirements get a button to Account instead of a bare error.
            .alert(store.accessNeeded != nil ? "Premium needed" : "Explorer",isPresented:Binding(get:{store.error != nil},set:{if !$0{store.error=nil}})){
                if store.accessNeeded != nil{Button("See Premium options"){store.error=nil;store.accessNeeded=nil;openAccount()};Button("Not now",role:.cancel){store.error=nil;store.accessNeeded=nil}}
                else{Button("OK"){store.error=nil}}
            }message:{Text(store.error ?? "")}
            .alert("Done",isPresented:Binding(get:{store.notice != nil && store.error == nil},set:{if !$0{store.notice=nil}})){Button("OK"){store.notice=nil}}message:{Text(store.notice ?? "")}
    }
}

private func effectNumber(_ value:Double)->String{value.formatted(.number.precision(.significantDigits(1...3)))}

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
    @State private var showAccount=false
    @State private var importing=false
    @State private var importKind="dna"
    @State private var exporting=false
    @State private var exportDocument=TextExport()
    @State private var exportName="monadic-results.tsv"
    func startImport(_ kind:String){importKind=kind;importing=true}
    func export(_ name:String,_ text:String){exportName=name;exportDocument=TextExport(text);exporting=true}
    private var storageStatus:some View { HStack { Text(store.variantCount>0 && store.dataUnlocked ? "\(store.variantCount.formatted()) variants • \(store.storageMessage)" : store.storageMessage).font(.caption); Spacer();
                if store.dataUnlocked { Button{store.lockData()}label:{Label("Lock data",systemImage:"lock")}.disabled(store.busy) }
                else { Button{store.unlockSavedData()}label:{Label("Unlock data",systemImage:"lock.open")}.disabled(store.busy) }
            }.padding(.horizontal).padding(.vertical,8) }
    private var vault:some View{VaultView(importDNA:{startImport("dna")})}
    var body: some View {
        VStack(spacing:0){
            // A first-time user has no vault yet, so there is nothing to lock or unlock.
            if store.dataUnlocked || store.vaultExists{storageStatus}
            // Determinate work shows a bar; open-ended work (reports, chat) gets the Vault star loader.
            if store.busy{
                if store.progress == nil{HStack{Spacer();VaultStarLoader();Spacer()}}
                HStack{if let progress=store.progress{ProgressView(value:progress).frame(width:60)};Text(store.status).font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption));Spacer();if store.cancellable{Button("Cancel",action:store.cancel)}}.padding()
            }
            TabView(selection:$selectedTab){
                NavigationStack{HomeView(importDNA:{startImport("dna")},go:{selectedTab=$0},results:{ResultsView(export:export,importResults:{startImport("results")})})}.tabItem{Label("Home",systemImage:"house")}.tag(0)
                NavigationStack{ChatView(personalize:{selectedTab=3})}.tabItem{Label("Chat",systemImage:"bubble.left.and.bubble.right")}.tag(1)
                NavigationStack{ReportsView(openChat:{selectedTab=1},export:export)}.tabItem{Label("Reports",systemImage:"doc.text")}.tag(2)
                NavigationStack{YouView(done:{selectedTab=0;if store.personalized{store.notice="Saved. Chat and reports will use what you told us about yourself."}},vault:{vault})}.tabItem{Label("You",systemImage:"person")}.tag(3)
                NavigationStack{List{
                    NavigationLink("Your matches"){ResultsView(export:export,importResults:{startImport("results")})}
                    NavigationLink("Browse research"){BrowseView()}
                    NavigationLink("Vault and backups"){vault}
                    NavigationLink("Connection and AI provider"){SettingsView()}
                    NavigationLink("Account and premium",isActive:$showAccount){AccountView(billing:store.billing)}
                    Section("Supported DNA exports"){Text("23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, Monadic DNA and compatible raw files. Gzip archives are supported.")}
                }.vaultScreen().navigationTitle("More")}.tabItem{Label("More",systemImage:"ellipsis")}.tag(4)
            }
        }
        .sheet(item:$store.selectedStudy){record in NavigationStack{StudyView(record:record).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){store.selectedStudy=nil}}}}.modifier(ExplorerMessages()).environmentObject(store)}
        .modifier(ExplorerMessages(openAccount:{store.selectedStudy=nil;selectedTab=4;showAccount=true}))
        .fileImporter(isPresented:$importing,allowedContentTypes:[.data]){result in
            switch result{
            case .success(let url):
                if importKind=="results"{store.importResults(url)}else{store.importDNA(url)}
            case .failure(let error):store.error=error.localizedDescription
            }
        }
        .fileExporter(isPresented:$exporting,document:exportDocument,contentType:.data,defaultFilename:exportName){result in if case .failure(let error)=result{store.error=error.localizedDescription}}
    }
}

private let reportKinds=[("Health","Health findings with the strongest research evidence."),("Healthspan","What your matches suggest about healthy aging."),("Top traits","Your most notable trait associations."),("Overview","A summary across all of your matches.")]
private let chatSuggestions=["Which of my results have the strongest evidence?","What do my results say about heart health?","Is there anything I could discuss with my doctor?"]

// Steps on Home: import DNA (Run all follows automatically), personalize, then Chat and Reports.
struct HomeView<Results:View>:View{
    @EnvironmentObject var store:ExplorerStore
    var importDNA:()->Void
    var go:(Int)->Void
    @ViewBuilder var results:()->Results
    @State private var question=""
    private var ready:Bool{store.resultCount>0 && (store.personalized||store.personalizeSkipped)}
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:18){
        if store.syncOffered {
            VStack(alignment:.leading,spacing:8){
                Text("Keep your data on a new iPhone").font(.headline)
                Text("Explorer can keep an end-to-end encrypted copy in your own iCloud, so a new iPhone or iPad fills in automatically. Monadic DNA never stores your data.").font(.footnote)
                HStack{Button("Turn on"){store.setSync(true)}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(store.busy);Button("Not now",action:store.declineSync)}
            }.frame(maxWidth:.infinity,alignment:.leading).padding().overlay(RoundedRectangle(cornerRadius:20).stroke(.secondary.opacity(0.5)))
        }
        if !store.dataUnlocked && !store.vaultExists && store.restorable {
            VaultHero()
            Text("Your data is ready to restore").font(VaultStyle.heading(28))
            Text("An encrypted copy of your DNA, results and personalization from your other device is available. Confirm it's you to restore it on this device.")
            Button("Restore my data",action:store.unlockSavedData).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(store.busy)
        } else if !store.dataUnlocked && store.vaultExists {
            VaultHero()
            Text("Welcome back. Unlock your saved data to continue.").font(VaultStyle.heading(20))
        } else if ready {
            // Results at a glance, as on the web's /explore dashboard.
            ResultsAtAGlance(results:{results()})
            Text("Ask about your DNA").font(VaultStyle.heading(28))
            Text("Chat answers questions using your \(store.resultCount.formatted()) research matches\(store.personalized ? " and what you told us about yourself" : "").")
            TextField("What would you like to know?",text:$question,axis:.vertical).textFieldStyle(.roundedBorder)
            Button("Ask"){store.chatDraft=question;go(1)}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(question.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
            ForEach(chatSuggestions,id:\.self){suggestion in Button(suggestion){store.chatDraft=suggestion;go(1)}.buttonStyle(.bordered).buttonBorderShape(.capsule)}
            if !store.personalized{Button{go(3)}label:{VStack(alignment:.leading,spacing:4){Text("Make answers about you").font(.headline);Text("Add your age, ancestry and health history. It stays encrypted on this device.").font(.footnote)}.frame(maxWidth:.infinity,alignment:.leading).padding().overlay(RoundedRectangle(cornerRadius:16).stroke(.secondary))}.tint(.primary)}
            Text("Reports").font(VaultStyle.heading(22)).padding(.top,8)
            ReportCards{_ in go(2)}
            HStack{Text("\(store.variantCount.formatted()) variants • \(store.resultCount.formatted()) matches").font(.footnote);Spacer();NavigationLink("Matches"){results()};NavigationLink("Browse"){BrowseView()}}
        } else {
            if store.syncing && store.variantCount==0{Text("Restoring your data from your other device…").font(.headline)}
            Text("Understand what your DNA says about you").font(VaultStyle.heading(28))
            if store.variantCount==0{Text("Explorer compares your raw DNA file with published genetic research on this device. Then you can ask questions about your results and read reports.")}
            Step(number:1,title:"Add your DNA file",done:store.variantCount>0,enabled:true){
                if store.variantCount>0 {
                    Text("\(store.variantCount.formatted()) variants • \(store.resultCount.formatted()) research matches").font(.footnote)
                    // Matching normally follows the import; this covers a cancelled or failed run.
                    if store.resultCount==0 && !store.busy{Button("Find research matches",action:store.runAll).buttonStyle(.borderedProminent).buttonBorderShape(.capsule)}
                } else {
                    Text("Raw data from 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome or Monadic DNA. It never leaves this device.").font(.footnote)
                    Toggle("I understand this is educational research, not medical advice.",isOn:$store.acceptedDisclaimer).font(.footnote)
                    Button("Choose DNA file",action:importDNA).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(!store.acceptedDisclaimer||store.busy)
                }
            }
            // Right after the match count lands, offer the fastest payoff before asking for profile details.
            if store.variantCount>0 && !ready && store.reportTitle != "Health" {
                VStack(alignment:.leading,spacing:8){
                    Text("See your results in 15 seconds").font(.headline)
                    Text("Your free Health report reads your \(store.resultCount.formatted()) research matches and summarizes the findings with the strongest evidence.").font(.footnote)
                    Button("Get my free Health report"){go(2)}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(store.busy)
                }.frame(maxWidth:.infinity,alignment:.leading).padding().overlay(RoundedRectangle(cornerRadius:20).stroke(.secondary.opacity(0.5)))
            }
            Step(number:2,title:"Tell us about you",done:store.personalized,enabled:store.variantCount>0){
                Text("Two minutes here turns general findings into answers about you: Chat and Reports use your age, ancestry and health history. Everything is optional and stays encrypted on this device.").font(.footnote)
                if store.variantCount>0 && !store.personalized{HStack{Button("Personalize"){go(3)}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule);Button("Skip for now",action:store.skipPersonalization)}}
            }
            // Home switches to Chat and Reports once steps 1 and 2 are done, so step 3 is a preview here.
            Step(number:3,title:"Ask and read",done:false,enabled:false){Text("Read your free Health report in about 15 seconds, or chat about your matches.").font(.footnote)}
            NavigationLink("Browse research without your DNA"){BrowseView()}
        }
        Text("Associations are not diagnoses or individual health predictions. Odds ratios are relative, not absolute risk; beta values describe trait changes.").font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote)).foregroundStyle(.secondary)
    }.padding()}.vaultScreen().navigationTitle("Explorer").navigationBarTitleDisplayMode(.inline)}
}

/// Vault's StarLoaderView: colored stars spin and pulse around the brand mark while the app works.
/// The brand mark is white-on-dark art, so the dark star anchors the loader on the light canvas.
struct VaultStarLoader:View{
    @State private var rotation:Double=0
    @State private var scale:CGFloat=1
    private let stars=["vault_star_orange","vault_star_blue","vault_star_purple","vault_star_yellow"]
    var body:some View{
        ZStack{
            Image("vault_star").resizable().scaledToFit().frame(width:56,height:56)
            ForEach(0..<stars.count,id:\.self){index in
                Image(stars[index]).resizable().scaledToFit().frame(width:20,height:20)
                    .offset(offset(for:index))
                    .rotationEffect(.degrees(rotation))
                    .animation(.linear(duration:4).repeatForever(autoreverses:false),value:rotation)
                    .scaleEffect(scale)
                    .animation(.spring(response:0.6,dampingFraction:0.4,blendDuration:0.5).repeatForever(autoreverses:true).delay(Double(index)*0.2),value:scale)
            }
        }.frame(width:120,height:120)
        .onAppear{rotation=360;scale=0.8}
    }
    private func offset(for index:Int)->CGSize{let angle=CGFloat(index)*.pi/2;return CGSize(width:50*cos(angle),height:50*sin(angle))}
}

/// The Home dashboard: category cards plus the strongest-signal highlight, loaded from the store.
struct ResultsAtAGlance<Results:View>:View{
    @EnvironmentObject var store:ExplorerStore
    @ViewBuilder var results:()->Results
    @State private var preview:[String:Any]=[:]
    private var insight:[String:Any]{preview["insight"] as? [String:Any] ?? [:]}
    var body:some View{Group{
        if !preview.isEmpty{
            Text("Your results at a glance").font(VaultStyle.heading(22))
            Text("\((insight["elevatedCount"] as? Int ?? 0).formatted()) elevated • \((insight["protectiveCount"] as? Int ?? 0).formatted()) protective").font(.footnote)
            if let categories=preview["categories"] as? [[String:Any]],!categories.isEmpty{
                ScrollView(.horizontal,showsIndicators:false){HStack(spacing:8){ForEach(Array(categories.prefix(8).enumerated()),id:\.offset){_,category in
                    let palette=VaultStyle.cardPalette(category["id"] as? String ?? "other")
                    NavigationLink{results()}label:{VStack(alignment:.leading,spacing:2){Text(category["label"] as? String ?? "").font(.headline);Text("\((category["count"] as? Int ?? 0).formatted()) matches").font(.footnote)}.padding(.horizontal,16).padding(.vertical,12).background(palette.background,in:RoundedRectangle(cornerRadius:20)).foregroundStyle(palette.foreground)}
                }}.padding(.vertical,2)}
            }
            if let standout=insight["standout"] as? [String:Any]{
                let record=Record(raw:standout)
                Text("Strongest signal").font(.headline)
                Button{store.loadStudy(record.id)}label:{ResultView(record:record)}.buttonStyle(.plain)
            }
        }
    // Reloads whenever the stored results change.
    }.task(id:store.resultsVersion){preview=(try? await store.preview()) ?? [:]}}
}
struct Step<Content:View>:View{
    let number:Int;let title:String;let done:Bool;let enabled:Bool
    @ViewBuilder var content:()->Content
    // Done steps are tinted, the current step is outlined, and later steps are dimmed.
    var body:some View{VStack(alignment:.leading,spacing:8){
        Text(done ? "✓  \(title)" : "\(number)  \(title)").font(.headline)
        content()
    }.frame(maxWidth:.infinity,alignment:.leading).padding()
    .background(done ? Color.accentColor.opacity(0.12) : Color.clear,in:RoundedRectangle(cornerRadius:20))
    .overlay(RoundedRectangle(cornerRadius:20).stroke(enabled && !done ? Color.primary : Color.secondary.opacity(0.4),lineWidth:enabled && !done ? 2 : 1))
    .opacity(enabled ? 1 : 0.45)}
}

struct ReportCards:View{
    @EnvironmentObject var store:ExplorerStore
    var open:(String)->Void
    private var premium:Bool{store.premiumActive}
    var body:some View{ForEach(reportKinds,id:\.0){kind,description in
        Button{open(kind)}label:{HStack{VStack(alignment:.leading,spacing:4){Text("\(kind) report").font(.headline);Text(description).font(.footnote).foregroundStyle(.secondary)};Spacer();
            // Tier as a filled chip: the price tier should be scannable before tapping.
            let tier=kind=="Health" ? "Free" : premium ? "" : "Premium"
            if !tier.isEmpty{Text(tier).font(.caption).padding(.horizontal,10).padding(.vertical,4).background(kind=="Health" ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.15),in:Capsule())}
        }.padding().overlay(RoundedRectangle(cornerRadius:16).stroke(.secondary.opacity(0.5)))}.tint(.primary)
    }}
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
        List(store.studies){study in Button{store.selectedStudy=study}label:{VStack(alignment:.leading,spacing:6){Text(study.text("disease_trait")).font(.custom("SpaceGrotesk-Bold",size:17,relativeTo:.headline));Text(study.text("study")).font(.custom("SpaceGrotesk-Regular",size:15,relativeTo:.subheadline)).foregroundStyle(.secondary);Text([study.text("strongest_snp_risk_allele"),study.text("study_accession"),study.text("confidenceBand","Research finding")].filter{!$0.isEmpty}.joined(separator:" • ")).font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption))}}.tint(.primary)}
        // Pagination is useful only once there are results to page through.
        if !store.studies.isEmpty{HStack{Button("Previous"){offset=max(0,offset-50);store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(offset==0||store.busy);Spacer();Button("Next"){offset+=50;store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(store.busy)}.padding()}
    }.vaultScreen().navigationTitle("Browse research")}
}

struct StudyView:View{
    @EnvironmentObject var store:ExplorerStore
    let record:Record
    private var hasDNA:Bool{store.dataUnlocked && store.variantCount>0}
    private var effectLabel:String{((try? Core.object("effect",["value":record.text("or_or_beta"),"ci":record.text("ci_text")]))?["effectType"] as? String)=="beta" ? "Beta (trait change)" : "Odds ratio"}
    var body:some View{List{
        Section{
            Text(record.text("disease_trait")).font(VaultStyle.heading(24));Text(record.text("study"))
            Button("Match my DNA on device"){store.analyze(record)}.disabled(store.busy || !hasDNA)
            if !hasDNA{Text(store.dataUnlocked ? "Add your DNA file on Home to match this study." : "Unlock your saved data to match this study.").font(.footnote).foregroundStyle(.secondary)}
        }
        if let result=store.resultFor(record.id){
            Section("Your match"){ResultView(record:result)}
            // AI commentary needs a stored result and consent to send matches to the provider.
            Section("AI commentary"){
                if !store.shareResultsWithLLM{ProviderConsent()}
                Button("Explain with AI"){store.commentary(record)}.disabled(store.busy || !store.shareResultsWithLLM)
                if store.busy{Text(store.status).font(.footnote)}
                if store.commentaryStudyId==record.id && !store.commentary.isEmpty{Text(.init(store.commentary)).textSelection(.enabled)}
            }
        }
        Section("Research details"){
            ForEach([("study_accession","Accession"),("mapped_gene","Genes"),("snps","Variants"),("strongest_snp_risk_allele","Risk allele"),("or_or_beta",effectLabel),("ci_text","Effect interval"),("p_value","P-value"),("initial_sample_size","Discovery sample"),("replication_sample_size","Replication sample"),("first_author","Author"),("journal","Journal"),("date","Publication date")],id:\.0){key,label in
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
            Text("\(record.text("matchedSnp")): \(record.text("userGenotype")) • \(record.text("effectType")=="beta" ? "Beta" : "OR") \(effectNumber(record.number("riskScore")))")
            Label(record.text("riskLevel").capitalized,systemImage:record.text("riskLevel")=="increased" ? "arrow.up" : record.text("riskLevel")=="decreased" ? "arrow.down" : "circle").font(VaultStyle.body().bold())
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
    @State private var direction="All"
    @State private var sort="Catalog order"
    // Pages come from the Rust session, which filters and sorts; only loaded pages are held here.
    @State private var rows:[Record]=[]
    @State private var total=0
    @State private var loading=false
    private var sortKey:String{["Catalog order":"catalog","Effect size":"effect","P-value":"pvalue"][sort] ?? "catalog"}
    private func load(reset:Bool) async {
        guard !loading else{return};loading=true;defer{loading=false}
        guard let page=try? await store.resultsPage(filter:filter,direction:direction.lowercased(),sort:sortKey,offset:reset ? 0 : rows.count) else{return}
        rows=reset ? page.rows : rows+page.rows;total=page.total
    }
    var body:some View{List{
        Section{
            Text("\(store.resultCount.formatted()) saved study matches").font(VaultStyle.heading(20))
            Button("Run all studies",action:store.runAll).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(store.busy||store.variantCount==0)
            Button("Export results as TSV"){do{export("monadic-results.tsv",try store.exportResults())}catch{store.error=error.localizedDescription}}.disabled(store.resultCount==0)
            Button("Import saved results",action:importResults)
            // The version carries a build hash after the date; users need the date only.
            if let info=store.catalogInfo{Text("Research catalog \(String((info["version"] as? String ?? "").prefix(10))) • \((info["rows"] as? Int ?? 0).formatted()) studies • bundled with this app").font(.footnote)}
            if store.resultCount==0 {
                Text(!store.dataUnlocked ? "Unlock your saved data to see saved matches." : store.variantCount==0 ? "Add your DNA file on Home first. Then Run all studies compares it with the research catalog on this device." : "Choose Run all studies to compare your DNA with the research catalog bundled with this app. Matching runs on this device and takes under a minute.").foregroundStyle(.secondary)
            } else {
                TextField("Filter saved traits",text:$filter)
                Picker("Direction",selection:$direction){ForEach(["All","Increased","Decreased"],id:\.self){Text($0)}}.pickerStyle(.segmented)
                Picker("Sort by",selection:$sort){ForEach(["Catalog order","Effect size","P-value"],id:\.self){Text($0)}}
                if total != store.resultCount{Text("Showing \(total.formatted()) of \(store.resultCount.formatted())").font(.footnote)}
            }
        }
        ForEach(rows){record in
            Button{store.loadStudy(record.id)}label:{ResultView(record:record)}.buttonStyle(.plain).listRowBackground(Color.clear).listRowSeparator(.hidden)
                // Load the next page as the list nears its end.
                .onAppear{if record.id==rows.dropLast(10).last?.id ?? rows.last?.id, rows.count<total{Task{await load(reset:false)}}}
        }
    }.vaultScreen().navigationTitle("Your results")
    .task(id:"\(filter)|\(direction)|\(sort)|\(store.resultsVersion)"){await load(reset:true)}}
}

struct ProviderConsent:View{
    @EnvironmentObject var store:ExplorerStore
    var body:some View{Toggle("Allow matched results and profile context to be sent to my selected LLM provider.",isOn:$store.shareResultsWithLLM).font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote))}
}
struct ChatView:View{
    @EnvironmentObject var store:ExplorerStore
    var personalize:()->Void
    @State private var message=""
    private var providerName:String{["nilai":"nilAI","huggingface":"HuggingFace","ollama":"Ollama"][store.provider] ?? store.provider}
    var body:some View{VStack(alignment:.leading){
        // The raw model identifier lives in Settings; consumers need the provider name only.
        HStack{Text("Provider: \(providerName)").font(.footnote);Spacer();NavigationLink("Change"){SettingsView()}}.padding(.horizontal)
        ProviderConsent().padding(.horizontal)
        if store.messages.isEmpty{
            Text(store.resultCount==0 ? "Chat answers questions about your research matches. Add your DNA file on Home first." : !store.shareResultsWithLLM ? "To start, allow sharing above. Your matches go only to the provider shown." : "Ask anything about your results, or start with a suggestion. Research looks at a question from 10 angles for a detailed answer.").foregroundStyle(.secondary).padding(.horizontal)
            if store.resultCount>0{ForEach(chatSuggestions,id:\.self){suggestion in Button(suggestion){message=suggestion}.buttonStyle(.bordered).buttonBorderShape(.capsule)}.padding(.horizontal)}
            if store.resultCount>0 && !store.personalized{Button("Personalize answers",action:personalize).padding(.horizontal)}
        }
        List{
            ForEach(Array(store.messages.enumerated()),id:\.offset){item in VStack(alignment:.leading,spacing:8){
                Text(item.element.0=="user" ? "You" : "Explorer").font(.caption.bold());Text(.init(item.element.1)).textSelection(.enabled)
                // The angles a Research answer looked at, collapsed by default as on the web.
                if let angles=store.researchAngles[item.offset]{DisclosureGroup("Researched \(angles.count) angles"){ForEach(angles,id:\.0){Text("• \($0.0) (\($0.1.formatted()) \($0.1==1 ? "study" : "studies"))").font(.footnote)}}.font(.footnote)}
            }}
            if !store.busy{ForEach(store.chatFollowups,id:\.self){question in Button(question){message=question}.buttonStyle(.bordered).buttonBorderShape(.capsule)}}
        }
        // The composer stays disabled until sharing is allowed, matching the intro's instruction.
        HStack{TextField("Ask about your findings",text:$message,axis:.vertical).textFieldStyle(.roundedBorder).disabled(!store.shareResultsWithLLM);Button("Send"){store.sendChat(message){message=""}}.disabled(store.busy||!store.shareResultsWithLLM||message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
            // Research is the premium Chat feature; regular chat is free.
            Button(store.premiumActive ? "Research" : "Research • Premium"){store.research(message){message=""}}.buttonStyle(.bordered).disabled(store.busy||!store.shareResultsWithLLM||store.resultCount==0||message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}.padding()
    }.vaultScreen().navigationTitle("Chat")
    // A question started on Home arrives as a draft.
    .onAppear{if !store.chatDraft.isEmpty{message=store.chatDraft;store.chatDraft=""}}}
}
struct ReportsView:View{
    @EnvironmentObject var store:ExplorerStore
    var openChat:()->Void
    var export:(String,String)->Void
    var body: some View {
        List {
            Text(store.resultCount==0 ? "Reports summarize your research matches. Add your DNA file on Home first." : "Each report reads your \(store.resultCount.formatted()) research matches\(store.personalized ? " and what you told us about yourself" : "").")
            ProviderConsent()
            ReportCards{kind in if !store.busy && store.resultCount>0{store.generateReport(kind)}}.listRowSeparator(.hidden)
            if !store.report.isEmpty {
                Section(store.reportTitle) {
                    Text(.init(store.report)).textSelection(.enabled)
                    Button("Export Markdown report") { export("monadic-report.md", store.report) }
                }
            }
            if !store.reportQuestions.isEmpty {
                Section("Ask a follow-up") {
                    ForEach(store.reportQuestions, id: \.self) { question in
                        Button(question) { store.chatDraft=question;openChat() }
                    }
                }
            }
        }.vaultScreen().navigationTitle("Reports")
    }
}

struct YouView<Vault:View>:View{
    @EnvironmentObject var store:ExplorerStore
    var done:()->Void
    @ViewBuilder var vault:()->Vault
    var body:some View{Form{
        Section{Text("Optional details make Chat and Reports specific to you. They are encrypted on this device and only shared with your AI provider when you allow it.")}
        if !store.dataUnlocked{Button("Unlock to edit",action:store.unlockSavedData).disabled(store.busy)}
        else {
            Section(content:{
                ForEach(store.profileSchema){field in
                    let value=Binding<String>(get:{store.profileFields[field.key] ?? ""},set:{store.profileFields[field.key]=$0})
                    // Schema labels carry the input hint; the section footer says it once instead.
                    let short=field.label.replacingOccurrences(of:" (comma separated)",with:"")
                    if let options=field.options{Picker(short,selection:value){ForEach(options){Text($0.label).tag($0.value)}}.disabled(store.syncing || store.locking)}
                    else{TextField(short,text:value,axis:.vertical).disabled(store.syncing || store.locking)}
                }
                TextField("Anything else for your reports (optional)",text:$store.profile,axis:.vertical).disabled(store.syncing || store.locking)
                Text("Saved automatically.").font(.footnote)
            },header:{Text("About you")},footer:{Text("Separate multiple entries with commas.")})
            Button("Done",action:done)
        }
        Section("Your data"){
            Text(store.variantCount>0 ? "\(store.variantCount.formatted()) variants • \(store.resultCount.formatted()) research matches" : "No DNA file imported yet.")
            NavigationLink("Vault and backups"){vault()}
            if store.dataUnlocked{Button("Lock data",action:store.lockData).disabled(store.busy)}
        }
    }.vaultScreen().navigationTitle("You")}
}

struct VaultView:View{
    @EnvironmentObject var store:ExplorerStore
    var importDNA:()->Void
    @State private var confirmDelete=false
    private var syncBinding:Binding<Bool>{Binding(get:{store.syncEnabled},set:{store.setSync($0)})}
    var body:some View{Form{
        VaultArt(name:"vault").listRowBackground(Color.clear)
        Section("On-device genetic data"){
            Text("Your DNA, results and personalization are kept in an encrypted database on this device. Unlocking needs your device authentication, and locking closes it.")
            Text(store.dataUnlocked ? "Key protection: \(store.protection)" : "Locked. Your data stays encrypted until you unlock it.").font(.footnote)
            Toggle("I understand this is educational research, not medical advice.",isOn:$store.acceptedDisclaimer)
            Button("Import DNA (.txt, .tsv, .csv, .gz)",action:importDNA).disabled(!store.acceptedDisclaimer||store.busy)
            if !store.acceptedDisclaimer{Text("Turn on the switch above to enable import.").font(.footnote).foregroundStyle(.secondary)}
            Button(store.dataUnlocked ? "Lock data" : "Unlock saved data"){if store.dataUnlocked{store.lockData()}else{store.unlockSavedData()}}.disabled(store.busy)
        }
        Section("Sync across your devices"){
            Text("Keep an end-to-end encrypted copy in your own iCloud, so a new iPhone or iPad signed in to your Apple ID fills in automatically. Monadic DNA never stores your data.")
            Toggle("Sync",isOn:syncBinding).disabled(!store.dataUnlocked||store.busy)
            Text(!store.dataUnlocked ? "Unlock to change sync." : store.syncing ? "Syncing…" : !store.syncMessage.isEmpty ? store.syncMessage : store.syncEnabled ? "Up to date." : "Off. Data stays only on this device.").font(.footnote)
        }
        Button("Delete data from this device",role:.destructive){confirmDelete=true}.disabled(store.busy||(!store.dataUnlocked && !store.vaultExists))
    }.vaultScreen().navigationTitle("Private vault")
    .confirmationDialog(store.syncEnabled ? "Delete your data from this device? The encrypted cloud copy stays, so you can restore it later." : "Delete your data from this device? Sync is off, so there is no other copy.",isPresented:$confirmDelete,titleVisibility:.visible){Button("Delete",role:.destructive,action:store.deleteVault)}
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
        Button("Save securely in Keychain"){do{try store.saveSettings()}catch{store.error=error.localizedDescription}}
        #if DEBUG
        // Debug builds only: lets developers test premium features without an App Store purchase.
        Section("Developer"){
            Toggle("Treat this device as Premium",isOn:Binding(get:{store.debugPremium},set:{store.setDebugPremium($0)}))
            Text("Debug builds only. Unlocks Research and premium reports without a purchase.").font(.footnote)
        }
        #endif
    }.vaultScreen().navigationTitle("Settings")}
}

struct AccountView: View {
    @EnvironmentObject var store: ExplorerStore
    @ObservedObject var billing: StoreBilling
    private let names=["overview":"Overview","healthspan":"Healthspan","top_traits":"Top traits"]
    var body: some View {
        Form {
            Section("Premium") {
                Text(store.premiumActive ? "Premium is active." : "Research in Chat and the Healthspan, Top traits and Overview reports are part of Premium. Chat and the Health report are free.")
                if !billing.passes.isEmpty{Text("Unused report passes: "+billing.passes.map{"\(names[$0.key] ?? $0.key) (\($0.value))"}.sorted().joined(separator:", "))}
                Text("Purchases are handled by the App Store and tied to your Apple ID. Monadic DNA does not keep customer or purchase records, and no sign-in is needed.").font(.footnote)
            }
            Section("App Store purchases") {
                ForEach(billing.products) { product in
                    VStack(alignment:.leading, spacing:8) {
                        Text(product.displayName).font(.headline)
                        Text(product.description).font(.subheadline)
                        let subscription=product.type == .autoRenewable
                        Button(subscription ? (billing.premium ? "Subscribed" : "Subscribe for \(product.displayPrice) / month") : "Buy for \(product.displayPrice)") {
                            Task { await billing.purchase(product) }
                        }.disabled(billing.loading || (subscription && billing.premium))
                    }
                }
                Button("Restore purchases") { Task { await billing.restore() } }.disabled(billing.loading)
                Button("Manage Apple subscriptions") { Task { await billing.manage() } }
                if !billing.message.isEmpty { Text(billing.message).font(.footnote) }
                if billing.loading { ProgressView() }
                Text("The monthly subscription renews automatically unless cancelled in your App Store subscription settings. Each report pass covers one run of that report. Unused passes sync to your other devices with your data.").font(.footnote)
                Link("Privacy policy", destination:URL(string:"https://github.com/Monadic-DNA/Explorer/blob/main/privacy_policy.md")!)
                Link("Terms of use", destination:URL(string:"https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            }
            Section("Stablecoin payments") {
                Text("Stablecoin payments are available only on Web. They are not available in the iOS app.")
            }
        }
        .vaultScreen().navigationTitle("Premium")
        .task { await billing.load() }
    }
}
