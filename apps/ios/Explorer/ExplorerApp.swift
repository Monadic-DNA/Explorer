import SwiftUI
import UIKit
import UniformTypeIdentifiers
import PhotosUI

/// Downscales a picked image for vision upload: 1024px on the long edge, JPEG 0.85.
func scaledImageData(_ image:UIImage)->Data?{
    let side=max(image.size.width,image.size.height)
    let scale=side>1024 ? 1024/side : 1
    let size=CGSize(width:image.size.width*scale,height:image.size.height*scale)
    let rendered=UIGraphicsImageRenderer(size:size).image{_ in image.draw(in:CGRect(origin:.zero,size:size))}
    return rendered.jpegData(compressionQuality:0.85)
}

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
            .alert(store.accessNeeded != nil ? "Premium needed" : "Explorer",isPresented:Binding(get:{store.error != nil && store.chatRetryAction == nil},set:{if !$0{store.error=nil}})){
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
            // Lock/unlock lives on Home and You; other tabs keep their whole top area for content.
            if (store.dataUnlocked || store.vaultExists) && selectedTab==0{storageStatus}
            // Determinate work shows a bar; open-ended work (reports, chat) gets the Vault star loader. Home and Chat render their own indicators, so they skip this bar.
            if store.busy && selectedTab != 0 && selectedTab != 1{
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
                    NavigationLink("Backend and AI provider"){SettingsView()}
                    NavigationLink("Account and premium",isActive:$showAccount){AccountView(billing:store.billing)}
                    Section("Supported DNA exports"){Text("23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome, Monadic DNA and compatible raw files. Gzip archives are supported.")}
                }.vaultScreen().vaultTitle("More")}.tabItem{Label("More",systemImage:"ellipsis")}.tag(4)
            }
        }
        .sheet(item:$store.selectedStudy){record in NavigationStack{StudyView(record:record).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){store.selectedStudy=nil}}}}.modifier(ExplorerMessages()).environmentObject(store)}
        // Fresh reports open full-screen; the inline copy on the Reports tab remains for revisiting.
        .fullScreenCover(isPresented:$store.reportSheetOpen){ReportSheet(go:{selectedTab=$0}).environmentObject(store)}
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
        if store.busy {
            // While a run is on, Home is the processing screen: animation, status, progress. The global busy bar is suppressed on Home so this is the single indicator.
            VStack(spacing:12){
                VaultStarLoader()
                Text(store.status).font(.headline)
                if let progress=store.progress{ProgressView(value:progress).frame(maxWidth:220)}
                Text("Everything runs on this device; nothing is uploaded.").font(.footnote).foregroundStyle(.secondary)
                if store.cancellable{Button("Cancel",action:store.cancel)}
            }.frame(maxWidth:.infinity).padding(.vertical,48)
        } else {
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
            // The ready Home opens on a dark brand panel with the user's own counts, so the first screen feels like their product, not a form.
            VStack(alignment:.leading,spacing:8){
                Image("vault_brand_mark").resizable().scaledToFit().frame(height:36)
                Text("Your DNA. Your discoveries.").font(VaultStyle.heading(28)).foregroundStyle(.white)
                Text("\(store.variantCount.formatted()) variants (SNP calls) • \(store.resultCount.formatted()) studies matching your DNA, analyzed on this device").font(.footnote).foregroundStyle(.white.opacity(0.75))
            }.frame(maxWidth:.infinity,alignment:.leading).padding(22).background(VaultStyle.ink,in:RoundedRectangle(cornerRadius:28))
            // The step guide stays as an orientation rail: steps done so far are checked, step 3 is now live.
            Step(number:1,title:"Add your DNA file",done:true,enabled:false){Color.clear.frame(height:0)}
            Step(number:2,title:"Tell us about you",done:store.personalized,enabled:!store.personalized){
                Text("Two minutes here turns general findings into answers about you: Chat and Reports use your age, ancestry and health history. Everything is optional and stays encrypted on this device.").font(.footnote)
                Button("Personalize"){go(3)}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
            }
            Step(number:3,title:"Ask and read",done:false,enabled:true){
                Text("Read your free Health report in about 15 seconds, or chat about your matches.").font(.footnote)
                Button("Get my free Health report"){go(2)}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(store.busy)
            }
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
            // A first-run Home with no data gets the brand hero instead of bare text.
            if store.variantCount==0 && !store.syncing{VaultHero()}
            Text("Understand what your DNA says about you").font(VaultStyle.heading(28))
            if store.variantCount==0{Text("Explorer compares your raw DNA file with published genetic research on this device. Then you can ask questions about your results and read reports.")}
            Step(number:1,title:"Add your DNA file",done:store.variantCount>0,enabled:true){
                if store.variantCount>0 {
                    Text("\(store.variantCount.formatted()) variants • \(store.resultCount.formatted()) research matches").font(.footnote)
                    // Matching normally follows the import; this covers a cancelled or failed run.
                    if store.resultCount==0 && !store.busy{Button("Find research matches",action:store.runAll).buttonStyle(.borderedProminent).buttonBorderShape(.capsule)}
                } else {
                    Text("Raw data from 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, Mapmygenome or Monadic DNA. It never leaves this device.").font(.footnote)
                    if !store.acceptedDisclaimer{TermsAgreement(onAgree:store.acceptTerms)}
                    else{Button("Choose DNA file",action:importDNA).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(store.busy)}
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
        }
        Text("Associations are not diagnoses or individual health predictions. Odds ratios are relative, not absolute risk; beta values describe trait changes.").font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote)).foregroundStyle(.secondary)
    }.padding()}.vaultScreen().vaultTitle("Explorer")}
}

/// A finished report presented as a document, with native share and the system print/PDF flow.
struct ReportSheet:View{
    @EnvironmentObject var store:ExplorerStore
    var go:(Int)->Void={_ in}
    @State private var exportURL:URL?=nil
    var body:some View{
        NavigationStack{ScrollView{VStack(alignment:.leading,spacing:16){
            VStack(spacing:10){
                Image("vault_brand_mark").resizable().scaledToFit().frame(height:40).accessibilityHidden(true)
                Text(store.reportTitle).font(VaultStyle.heading(30)).multilineTextAlignment(.center)
                Text("Monadic DNA Explorer").font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption)).opacity(0.7)
            }.frame(maxWidth:.infinity).padding(24).foregroundStyle(.white).background(VaultStyle.ink,in:RoundedRectangle(cornerRadius:24))
            Text(.init(store.report)).font(.body)
            if !store.reportQuestions.isEmpty{
                Text("Ask a follow-up").font(.headline)
                ForEach(store.reportQuestions,id:\.self){question in Button(question){store.chatDraft=question;store.reportSheetOpen=false;go(1)}.buttonStyle(.bordered).tint(VaultStyle.accent)}
            }
            HStack(spacing:12){
                Button{sharePdf(store.reportTitle,reportHtml(store.reportTitle,store.report,logo:pdfLogo()))}label:{Label("Share PDF",systemImage:"square.and.arrow.up")}.buttonStyle(.borderedProminent)
                Button{exportURL=writePdf(store.reportTitle,reportHtml(store.reportTitle,store.report,logo:pdfLogo()))}label:{Label("Save as PDF",systemImage:"square.and.arrow.down")}.buttonStyle(.bordered)
            }
        }.padding()}.vaultScreen().navigationTitle("Report").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("Close"){store.reportSheetOpen=false}}}
        .sheet(isPresented:Binding(get:{exportURL != nil},set:{if !$0{exportURL=nil}})){if let url=exportURL{DocumentExporter(url:url)}}}
    }
}

/// The conversation as markdown, labeled by speaker, for share and PDF export.
// The speaker label gets its own line so a reply starting with a heading still parses as one.
@MainActor func chatTranscript(_ store:ExplorerStore)->String{store.messages.map{($0.0=="user" ? "**You:**\n" : "**Explorer:**\n")+$0.1}.joined(separator:"\n\n")}

/// Renders the print HTML into a real PDF file in the temp directory, no print dialog.
func writePdf(_ title:String,_ html:String)->URL?{
    let formatter=UIMarkupTextPrintFormatter(markupText:html)
    let renderer=UIPrintPageRenderer();renderer.addPrintFormatter(formatter,startingAtPageAt:0)
    let paper=CGRect(x:0,y:0,width:595,height:842) // A4 at 72dpi
    renderer.setValue(paper,forKey:"paperRect")
    renderer.setValue(paper.insetBy(dx:36,dy:36),forKey:"printableRect")
    let data=NSMutableData()
    UIGraphicsBeginPDFContextToData(data,paper,nil)
    for page in 0..<renderer.numberOfPages{UIGraphicsBeginPDFPage();renderer.drawPage(at:page,in:paper)}
    UIGraphicsEndPDFContext()
    let name=title.replacingOccurrences(of:"[^A-Za-z0-9]+",with:"-",options:.regularExpression).trimmingCharacters(in:CharacterSet(charactersIn:"-"))
    let url=FileManager.default.temporaryDirectory.appendingPathComponent((name.isEmpty ? "monadic-report" : name)+".pdf")
    do{try data.write(to:url);return url}catch{return nil}
}

/// Shares the actual PDF file through the native sheet, presented from whatever screen is up.
func sharePdf(_ title:String,_ html:String){
    guard let url=writePdf(title,html) else{return}
    let sheet=UIActivityViewController(activityItems:[url],applicationActivities:nil)
    var top=UIApplication.shared.connectedScenes.compactMap{($0 as? UIWindowScene)?.keyWindow}.first?.rootViewController
    while let next=top?.presentedViewController{top=next}
    top?.present(sheet,animated:true)
}

/// The system save-to-files picker for an already-generated file.
struct DocumentExporter:UIViewControllerRepresentable{
    let url:URL
    func makeUIViewController(context:Context)->UIDocumentPickerViewController{UIDocumentPickerViewController(forExporting:[url],asCopy:true)}
    func updateUIViewController(_ controller:UIDocumentPickerViewController,context:Context){}
}

/// Small markdown-to-HTML pass for the print view: headings, bold, bullets, paragraphs. The logo is a base64 data URI, empty to omit.
func reportHtml(_ title:String,_ markdown:String,logo:String="")->String{
    func esc(_ s:String)->String{s.replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"<",with:"&lt;").replacingOccurrences(of:">",with:"&gt;")}
    func inline(_ s:String)->String{esc(s).replacingOccurrences(of:"\\*\\*([^*]+)\\*\\*",with:"<strong>$1</strong>",options:.regularExpression)}
    var body="";var inList=false
    for line in markdown.components(separatedBy:"\n"){
        let trimmed=line.trimmingCharacters(in:.whitespaces)
        if trimmed.hasPrefix("- ")||trimmed.hasPrefix("• "){if !inList{body+="<ul>";inList=true};body+="<li>\(inline(String(trimmed.dropFirst(2))))</li>"}
        else{if inList{body+="</ul>";inList=false}
            if trimmed.hasPrefix("#### "){body+="<h4>\(inline(String(trimmed.dropFirst(5))))</h4>"}
            else if trimmed.hasPrefix("### "){body+="<h3>\(inline(String(trimmed.dropFirst(4))))</h3>"}
            else if trimmed.hasPrefix("## "){body+="<h2>\(inline(String(trimmed.dropFirst(3))))</h2>"}
            else if trimmed.hasPrefix("# "){body+="<h2>\(inline(String(trimmed.dropFirst(2))))</h2>"}
            else if !trimmed.isEmpty{body+="<p>\(inline(trimmed))</p>"}}
    }
    if inList{body+="</ul>"}
    let mark=logo.isEmpty ? "" : "<div style=\"text-align:center;margin-bottom:4px\"><img src=\"data:image/png;base64,\(logo)\" width=\"64\"></div>"
    return "<html><head><meta charset=\"utf-8\"><style>body{font-family:-apple-system,sans-serif;margin:32px;color:#222;line-height:1.55}h1{font-family:Georgia,serif;font-weight:500}h2{margin-top:24px}h3{margin-top:18px}.brand{text-align:center;color:#666;font-size:12px;margin-top:40px}</style></head><body>\(mark)<h1>\(esc(title))</h1>\(body)<p class=\"brand\">Monadic DNA Explorer &middot; educational research findings, not a diagnosis</p></body></html>"
}

/// The dark star as a data URI for the print HTML; the brand mark asset is white-on-dark and disappears on the light page.
func pdfLogo()->String{UIImage(named:"vault_star")?.pngData()?.base64EncodedString() ?? ""}

/// One-time explicit agreement with tappable full policy documents; agreeing covers the educational-use note.
struct TermsAgreement:View{
    var onAgree:()->Void
    var body:some View{
        VStack(alignment:.leading,spacing:10){
            Text("This app shares educational research findings, not medical advice.").font(.footnote)
            Text(.init("By continuing you agree to the [Terms of Service](https://github.com/Monadic-DNA/Explorer/blob/main/terms_and_conditions.md) and [Privacy Policy](https://github.com/Monadic-DNA/Explorer/blob/main/privacy_policy.md).")).font(.footnote).tint(VaultStyle.accent)
            Button("Agree and continue",action:onAgree).buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        }
    }
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
    private func offset(for index:Int)->CGSize{let angle=CGFloat(index) * .pi / 2;return CGSize(width:50*cos(angle),height:50*sin(angle))}
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
                // The trailing pad lets the last card clear the screen edge when the carousel is scrolled fully.
                }.padding(.vertical,2).padding(.trailing,16)}}
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
extension View{
    /// The brand star rides next to the screen title so it stays visible past onboarding.
    func vaultTitle(_ title:String)->some View{
        navigationTitle(title).navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.principal){HStack(spacing:6){Image("vault_star").resizable().scaledToFit().frame(width:16,height:16);Text(title).font(.headline)}}}
    }
}

struct Step<Content:View>:View{
    let number:Int;let title:String;let done:Bool;let enabled:Bool
    @ViewBuilder var content:()->Content
    // Done steps are tinted, the current step is outlined, and later steps are dimmed.
    var body:some View{VStack(alignment:.leading,spacing:8){
        HStack(spacing:10){
            // The step marker is a brand disc, not an emoji numeral, so it sits inside the type system.
            ZStack{Circle().fill(Color.accentColor).frame(width:28,height:28);Text(done ? "✓" : "\(number)").font(.callout.bold()).foregroundStyle(.white)}
            Text(title).font(.headline)
        }
        // Completed steps collapse to their checked title, as on Android.
        if enabled || !done{content()}
    }.frame(maxWidth:.infinity,alignment:.leading).padding()
    // Done steps rest in mint, the live step in lavender: the rail reads as progress, not paperwork.
    .background(done ? Color("vault_green100") : enabled ? Color("vault_purple100") : Color.clear,in:RoundedRectangle(cornerRadius:20))
    .overlay(RoundedRectangle(cornerRadius:20).stroke(enabled && !done ? VaultStyle.purpleInk : Color.secondary.opacity(0.4),lineWidth:enabled && !done ? 2 : 1))
    .opacity(enabled ? 1 : 0.45)}
}

struct ReportCards:View{
    @EnvironmentObject var store:ExplorerStore
    var open:(String)->Void
    private var premium:Bool{store.premiumActive}
    // Each report gets its Vault category pastel and star, so the reports list reads as a family rather than four grey rows.
    private let art:[String:(bg:String,ink:String,star:String)]=["Health":("vault_green200","vault_green900","vault_star"),"Healthspan":("vault_yellow200","vault_yellow900","vault_star_yellow"),"Top traits":("vault_purple200","vault_purple900","vault_star_orange"),"Overview":("vault_blue200","vault_blue900","vault_star_blue")]
    var body:some View{ForEach(reportKinds,id:\.0){kind,description in
        let (bg,ink,star)=art[kind]!
        Button{open(kind)}label:{HStack(spacing:12){
            Image(star).resizable().scaledToFit().frame(width:28,height:28)
            VStack(alignment:.leading,spacing:4){Text("\(kind) report").font(.headline);Text(description).font(.footnote).opacity(0.8)};Spacer();
            // Tier as a filled chip: the price tier should be scannable before tapping.
            let tier=kind=="Health" ? "Free" : premium ? "" : "Premium"
            if !tier.isEmpty{Text(tier).font(.caption).padding(.horizontal,10).padding(.vertical,4).background(Color(ink).opacity(0.12),in:Capsule())}
        }.padding().background(Color(bg),in:RoundedRectangle(cornerRadius:16))}.foregroundStyle(Color(ink))
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
            Button("Search"){UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);offset=0;store.browse(query,trait,semantic:semantic)}.disabled(store.busy)
        }.frame(height:230)
        // One card per study: UKB-style traits have many variant rows with the same title and abstract, which read as duplicates.
        List(Array(Dictionary(grouping:store.studies,by:{$0.text("study_accession")}).map{($0.value.first!,$0.value.count)}.sorted{$0.0.text("study_accession")<$1.0.text("study_accession")}),id:\.0.id){study,variants in Button{store.selectedStudy=study}label:{VStack(alignment:.leading,spacing:6){Text(study.text("disease_trait")).font(.custom("SpaceGrotesk-Bold",size:17,relativeTo:.headline));Text(study.text("study")).font(.custom("SpaceGrotesk-Regular",size:15,relativeTo:.subheadline)).foregroundStyle(.secondary);Text([variants>1 ? "\(variants) variants analyzed" : study.text("strongest_snp_risk_allele"),study.text("study_accession"),study.text("confidenceBand","Research finding")].filter{!$0.isEmpty}.joined(separator:" • ")).font(.custom("SpaceGrotesk-Regular",size:12,relativeTo:.caption))}}.tint(.primary)}
        // Page 1 has no Previous; hiding it beats a faint disabled button.
        if !store.studies.isEmpty{HStack{if offset>0{Button("Previous"){offset=max(0,offset-50);store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(store.busy)};Spacer();Button("Next"){offset+=50;store.browse(query,trait,semantic:semantic,offset:offset)}.disabled(store.busy)}.padding()}
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
            Text("\(record.text("matchedSnp")): \(record.text("userGenotype")) • \(record.text("effectType")=="beta" ? "Beta" : "OR") \(effectNumber(record.number("riskScore")))").monospacedDigit()
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
    private var providerName:String{["nilai":"nilAI","huggingface":"HuggingFace","ollama":"Ollama"][store.provider] ?? store.provider}
    var body:some View{
        if !store.shareResultsWithLLM{
            // Consent is the gate to the feature, so it is a real button, not a checkbox under legal copy.
            VStack(alignment:.leading,spacing:6){
                Button("Share my matches with \(providerName)"){store.shareResultsWithLLM=true}.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
                Text("Only matched results and optional profile and health summaries are sent. Raw DNA stays on this device.").font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            Toggle("Sharing matches and optional profile and health summaries with \(providerName). Uncheck to revoke.",isOn:$store.shareResultsWithLLM).font(.custom("SpaceGrotesk-Regular",size:13,relativeTo:.footnote))
        }
    }
}
struct ChatView:View{
    @EnvironmentObject var store:ExplorerStore
    var personalize:()->Void
    @State private var message=""
    @State private var chatExportURL:URL?=nil
    @State private var pickedPhotos:[PhotosPickerItem]=[]
    @State private var showDocPicker=false
    @State private var confirmNewChat=false
    private var providerName:String{["nilai":"nilAI","huggingface":"HuggingFace","ollama":"Ollama"][store.provider] ?? store.provider}
    var body:some View{VStack(alignment:.leading){
        let ongoing=!store.messages.isEmpty && store.shareResultsWithLLM
        if ongoing{
            // Once a conversation exists, a single actions row owns the header; provider and sharing controls move into the menu.
            HStack{
                Button("New chat"){confirmNewChat=true}.font(.footnote).disabled(store.busy)
                Button("Share"){sharePdf("Chat with Monadic DNA Explorer",reportHtml("Chat with Monadic DNA Explorer",chatTranscript(store),logo:pdfLogo()))}.font(.footnote)
                Button("Save"){chatExportURL=writePdf("Chat with Monadic DNA Explorer",reportHtml("Chat with Monadic DNA Explorer",chatTranscript(store),logo:pdfLogo()))}.font(.footnote)
                Spacer()
                Menu{
                    Button(store.premiumActive ? "Research this in depth" : "Research this in depth • Premium"){store.research(message){message=""}}.disabled(store.busy||store.resultCount==0||message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    NavigationLink("Provider: \(providerName)"){SettingsView()}
                    Button("Revoke sharing"){store.shareResultsWithLLM=false}
                }label:{Image(systemName:"ellipsis.circle")}
            }.padding(.horizontal)
        } else {
            HStack{
                Text("Provider: \(providerName)").font(.footnote)
                NavigationLink("Change"){SettingsView()}.font(.footnote)
                Spacer()
            }.padding(.horizontal)
            if store.shareResultsWithLLM{HStack{Text("Sharing matches and optional profile and health summaries with \(providerName)").font(.footnote);Spacer();Button("Revoke"){store.shareResultsWithLLM=false}.font(.footnote)}.padding(.horizontal)}
            else{ProviderConsent().padding(.horizontal)}
        }
        .confirmationDialog("Start a new chat? The current conversation is cleared. Save it as a PDF first if you want to keep it.",isPresented:$confirmNewChat,titleVisibility:.visible){
            Button("Clear and start new",role:.destructive){store.newChat()}
            Button("Cancel",role:.cancel){}
        }
        .sheet(isPresented:Binding(get:{chatExportURL != nil},set:{if !$0{chatExportURL=nil}})){if let url=chatExportURL{DocumentExporter(url:url)}}
        // The intro and suggestions live inside the list so everything scrolls on small screens and the composer plus Send stay pinned below.
        ScrollViewReader{proxy in List{
            if let action=store.chatRetryAction,let error=store.error,store.accessNeeded==nil{
                VStack(alignment:.leading,spacing:8){
                    Text(error).foregroundStyle(.red)
                    Text("Your message is still in the composer. Check your connection or provider settings, then retry.").font(.footnote).foregroundStyle(.secondary)
                    Button("Retry"){
                        if action=="research"{store.research(message){message=""}}
                        else{store.sendChat(message){message=""}}
                    }.disabled(store.busy || !store.shareResultsWithLLM||(action=="research" && store.resultCount==0)||(action=="research" ? message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty : message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && store.chatAttachments.isEmpty))
                }.padding().background(VaultStyle.canvas,in:RoundedRectangle(cornerRadius:12)).listRowSeparator(.hidden)
            }
            if store.messages.isEmpty{
                // A quiet brand moment on the empty conversation: the star and a greeting instead of a bare instruction.
                HStack(spacing:10){Image("vault_star").resizable().scaledToFit().frame(width:36,height:36);Text("Ask about your results").font(VaultStyle.heading(26))}
                Text(store.resultCount==0 ? "Chat answers questions about your research matches. Add your DNA file on Home first." : !store.shareResultsWithLLM ? "Tap Share my matches above to begin. Your matches go only to the provider shown." : "Ask anything about your results, or start with a suggestion. Research looks at a question from 10 angles for a detailed answer.").foregroundStyle(.secondary)
                if store.resultCount>0{ForEach(chatSuggestions,id:\.self){suggestion in Button(suggestion){message=suggestion}.buttonStyle(.bordered).buttonBorderShape(.capsule).tint(VaultStyle.purpleInk).background(VaultStyle.lavender,in:Capsule())}}
                if store.resultCount>0 && !store.personalized{Button("Personalize answers",action:personalize)}
            }
            // Flat conversation: user questions are compact right-aligned bubbles, answers are full-width text with no card or speaker label.
            ForEach(Array(store.messages.enumerated()),id:\.offset){item in
                if item.element.0=="user"{
                    HStack{Spacer(minLength:40)
                        Text(item.element.1).font(.body).padding(.horizontal,14).padding(.vertical,10)
                            .background(VaultStyle.lavender,in:RoundedRectangle(cornerRadius:18))
                    }.listRowSeparator(.hidden).foregroundStyle(VaultStyle.purpleInk)
                } else {
                    VStack(alignment:.leading,spacing:8){
                        Text(.init(item.element.1)).font(.body).textSelection(.enabled)
                        if let angles=store.researchAngles[item.offset]{DisclosureGroup("Researched \(angles.count) angles"){ForEach(angles,id:\.0){Text("• \($0.0) (\($0.1.formatted()) \($0.1==1 ? "study" : "studies"))").font(.footnote)}}.font(.footnote)}
                        if let sources=store.chatSources[item.offset],!sources.isEmpty{
                            DisclosureGroup("\(sources.count) studies used"){
                                ForEach(Array(sources.enumerated()),id:\.offset){_,source in VStack(alignment:.leading,spacing:2){
                                    Text("• \(source["traitName"] as? String ?? "") (\(source["gwasId"] as? String ?? ""))").font(.footnote)
                                    Text("\(source["matchedSnp"] as? String ?? ""): \(source["userGenotype"] as? String ?? "") • \((source["riskLevel"] as? String ?? "").capitalized) risk • \((source["effectType"] as? String)=="beta" ? "Beta" : "OR") \(String(format:"%.2f",source["riskScore"] as? Double ?? 0))").font(.system(.footnote,design:.monospaced)).monospacedDigit().foregroundStyle(.secondary)
                                }}
                            }.font(.footnote)
                            DisclosureGroup("Personalization and health data used"){
                                Text(store.chatContextUsed.isEmpty ? "None. You have not filled in About you and health data sharing is off, so this answer used only your research matches." : store.chatContextUsed).font(.footnote)
                            }.font(.footnote)
                        }
                    }
                }
            }
            if !store.busy{ForEach(store.chatFollowups,id:\.self){question in Button(question){message=question}.buttonStyle(.bordered).buttonBorderShape(.capsule).tint(VaultStyle.purpleInk).background(VaultStyle.lavender,in:Capsule())}}
            // Waiting and streaming share one minimal inline indicator; no card, no loader, so the conversation keeps the space.
            if store.busy{HStack{
                Text(store.messages.last?.1.isEmpty == false ? "" : store.status).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Stop"){store.cancel()}.font(.caption)
            }}
            Color.clear.frame(height:1).id("chat-bottom").listRowSeparator(.hidden)
        }.scrollDismissesKeyboard(.interactively)
        .onChange(of:store.messages.count){_,_ in withAnimation{proxy.scrollTo("chat-bottom",anchor:.bottom)}}
        .onChange(of:store.messages.last?.1.count){_,_ in withAnimation{proxy.scrollTo("chat-bottom",anchor:.bottom)}}
        }
        // Attachments: images go to the provider as vision content; text documents are inlined into the question.
        if !store.chatAttachments.isEmpty{ScrollView(.horizontal){HStack(spacing:8){ForEach(store.chatAttachments){attachment in Button{store.chatAttachments.removeAll{$0.id==attachment.id}}label:{Label(attachment.name,systemImage:attachment.isImage ? "photo" : "doc.text").font(.footnote)}.buttonStyle(.bordered).buttonBorderShape(.capsule)}}}.padding(.horizontal)}
        HStack(spacing:4){
            PhotosPicker(selection:$pickedPhotos,maxSelectionCount:6,matching:.images){Image(systemName:"photo")}.disabled(!store.shareResultsWithLLM || store.busy)
            Button{showDocPicker=true}label:{Image(systemName:"paperclip")}.disabled(!store.shareResultsWithLLM || store.busy)
            TextField("Ask about your findings",text:$message,axis:.vertical).lineLimit(1...5).textFieldStyle(.roundedBorder).layoutPriority(1).disabled(!store.shareResultsWithLLM || store.busy)
            Button{store.sendChat(message){message=""}}label:{Image(systemName:"paperplane.fill")}.disabled(store.busy || !store.shareResultsWithLLM||(message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && store.chatAttachments.isEmpty))
        }.padding(.horizontal)
        .onChange(of:pickedPhotos){_,items in for item in items{Task{if let data=try? await item.loadTransferable(type:Data.self){
            // Downscale for vision upload: 1024px on the long edge, JPEG 0.85.
            if let image=UIImage(data:data),let scaled=scaledImageData(image){try? store.attachChat(item.itemIdentifier ?? "image","image/jpeg",scaled)}
        }}};pickedPhotos=[]}
        .fileImporter(isPresented:$showDocPicker,allowedContentTypes:[.plainText,.json,.commaSeparatedText,.text],allowsMultipleSelection:true){result in if case .success(let urls)=result{for url in urls{
            let accessing=url.startAccessingSecurityScopedResource();defer{if accessing{url.stopAccessingSecurityScopedResource()}}
            let mime=UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? "text/plain"
            if let data=try? Data(contentsOf:url){try? store.attachChat(url.lastPathComponent,mime,data)}
        }}}
        // The one persistent disclaimer, so answers themselves do not repeat boilerplate.
        Text("Educational research, not medical advice.").font(.caption2).foregroundStyle(.secondary).frame(maxWidth:.infinity)
        // Before a conversation starts, Research keeps its quiet link; during one, it lives in the menu so the answer area keeps the space.
        if store.messages.isEmpty{HStack{Spacer();Button(store.premiumActive ? "Research this in depth" : "Research this in depth • Premium"){store.research(message){message=""}}.font(.footnote).disabled(store.busy || !store.shareResultsWithLLM||store.resultCount==0||message.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}.padding(.horizontal).padding(.bottom,4)}
    }.vaultScreen().toolbar(.hidden,for:.navigationBar)
    // A question started on Home arrives as a draft.
    .onAppear{if !store.chatDraft.isEmpty{message=store.chatDraft;store.chatDraft=""}}}
}
struct ReportsView:View{
    @EnvironmentObject var store:ExplorerStore
    var openChat:()->Void
    var export:(String,String)->Void
    var body: some View {
        List {
            Text(store.resultCount==0 ? "Reports summarize your research matches. Add your DNA file on Home first." : "Each report reads your \(store.resultCount.formatted()) research matches (studies that match your DNA)\(store.personalized ? " and what you told us about yourself" : "").")
            ProviderConsent()
            Text("Reports summarize your matches and may suggest follow-up questions.")
            Text("Health is free. Premium unlocks Healthspan, Top traits, and Overview; one report pass generates one report.").font(.footnote)
            Text("Generation can take a few minutes, depending on your provider and the report. Educational research, not medical advice.").font(.footnote)
            ReportCards{kind in if !store.busy && store.resultCount>0{store.generateReport(kind)}}.listRowSeparator(.hidden)
            if !store.report.isEmpty {
                Section(store.reportTitle) {
                    Text(.init(store.report)).font(.body).textSelection(.enabled)
                    Button("Open report"){store.reportSheetOpen=true}
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
        }.vaultScreen().vaultTitle("Reports")
    }
}

struct YouView<Vault:View>:View{
    @EnvironmentObject var store:ExplorerStore
    var done:()->Void
    @ViewBuilder var vault:()->Vault
    // Personalization is collapsed by default, so Health and Your data are visible without scrolling.
    @State private var aboutOpen=false
    var body:some View{Form{
        Section{Text("Optional details make Chat and Reports specific to you. They are encrypted on this device and only shared with your AI provider when you allow it.")}
        if !store.dataUnlocked{Button("Unlock to edit",action:store.unlockSavedData).disabled(store.busy)}
        else {
            DisclosureGroup(isExpanded:$aboutOpen,content:{
                ForEach(store.profileSchema){field in
                    let value=Binding<String>(get:{store.profileFields[field.key] ?? ""},set:{store.profileFields[field.key]=$0})
                    // Schema labels carry the input hint; the section footer says it once instead.
                    let short=field.label.replacingOccurrences(of:" (comma separated)",with:"")
                    if let options=field.options{Picker(short,selection:value){ForEach(options){Text($0.label).tag($0.value)}}.disabled(store.syncing || store.locking)}
                    else{TextField(short,text:value,axis:.vertical).disabled(store.syncing || store.locking)}
                }
                TextField("Anything else for your reports (optional)",text:$store.profile,axis:.vertical).disabled(store.syncing || store.locking)
                Text("Saved automatically.").font(.footnote)
            },label:{VStack(alignment:.leading,spacing:2){
                Text("Personalization").font(.title3.bold()).foregroundStyle(VaultStyle.purpleInk)
                Text(store.personalized ? "Saved. Tap to review your details." : "Age, ancestry, health history and more, all optional").font(.footnote).foregroundStyle(.secondary)
            }})
            if aboutOpen{Text("Separate multiple entries with commas.").font(.footnote).foregroundStyle(.secondary)}
        }
        if store.health.available{
            Section(content:{
                Toggle("Include Apple Health data",isOn:Binding(get:{store.healthEnabled},set:{on in
                    if on{Task{if await store.health.authorize(){store.setHealthEnabled(true)}}}
                    else{store.setHealthEnabled(false)}
                }))
            },footer:{Text("Optional. Thirty-day averages (resting heart rate, sleep, steps, weight) enrich chat and report answers. Raw records stay on this device.")})
        }
        Section("Your data"){
            NavigationLink("Vault and backups"){vault()}
            if store.dataUnlocked{Button("Lock data",action:store.lockData).disabled(store.busy)}
        }
        if store.dataUnlocked{Button("Done",action:done)}
    }.vaultScreen().vaultTitle("You")}
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
            if !store.acceptedDisclaimer{TermsAgreement(onAgree:store.acceptTerms)}
            else{Button("Import DNA (.txt, .tsv, .csv, .gz)",action:importDNA).disabled(store.busy)}
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
                if !billing.loading && billing.products.isEmpty{Text("Purchases need the App Store on this device. You can still chat and read the free Health report.").font(.footnote).foregroundStyle(.secondary)}
                Button("Restore purchases") { Task { await billing.restore() } }.disabled(billing.loading)
                Button("Manage Apple subscriptions") { Task { await billing.manage() } }
                if !billing.message.isEmpty { Text(billing.message).font(.footnote) }
                if billing.loading { ProgressView() }
                Text("The monthly subscription renews automatically unless cancelled in your App Store subscription settings. Each report pass generates one report of that type. Unused passes sync to your other devices with your data.").font(.footnote)
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
