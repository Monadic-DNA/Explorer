import Foundation
import SwiftUI
import UIKit

@MainActor final class ExplorerStore: NSObject, ObservableObject {
    @Published var backend=DeviceStore.get("backend").isEmpty ? "https://explorer.monadicdna.com" : DeviceStore.get("backend")
    @Published var provider=DeviceStore.get("provider").isEmpty ? "nilai" : DeviceStore.get("provider")
    @Published var model=DeviceStore.get("model").isEmpty ? "gemma-4-26B-A4B-it" : DeviceStore.get("model")
    @Published var apiKey=DeviceStore.get("api-key-"+(DeviceStore.get("provider").isEmpty ? "nilai":DeviceStore.get("provider")))
    @Published var ollamaAddress=DeviceStore.get("ollama-address").isEmpty ? "localhost" : DeviceStore.get("ollama-address")
    @Published var ollamaPort=DeviceStore.get("ollama-port").isEmpty ? "11434" : DeviceStore.get("ollama-port")
    @Published var profile="" {didSet{customizationChanged()}}
    @Published var profileFields:[String:String]=[:] {didSet{customizationChanged()}}
    var profileSchema:[ProfileField] {
        guard let fields=try? Core.call("profile_schema"),let data=try? JSONSerialization.data(withJSONObject:fields) else{return []}
        return (try? JSONDecoder().decode([ProfileField].self,from:data)) ?? []
    }
    private func profileData()throws->[String:Any]{try Core.object("parse_profile",profileFields)}
    @Published var metadata:[String:Any]=[:]
    @Published var studies:[Record]=[]
    // Results stay in the encrypted store; screens page through them with resultsPage.
    @Published private(set) var resultCount=0
    /// Changes whenever the stored results change, so screens reload their pages.
    @Published private(set) var resultsVersion=0
    /// Set to "premium" when Chat or a report needs Premium or a pass. Cleared by the next operation.
    @Published var accessNeeded:String?
    /// A question started on Home that the Chat tab picks up.
    @Published var chatDraft=""
    @Published private(set) var personalizeSkipped=DeviceStore.get("personalize-skipped")=="true"
    var personalized:Bool{!profile.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || profileFields.values.contains{!$0.isEmpty}}
    func skipPersonalization(){try? DeviceStore.put("personalize-skipped","true");personalizeSkipped=true}
    @Published var selectedStudy:Record?
    @Published var busy=false
    @Published var status=""
    @Published var error:String?
    @Published var notice:String?
    @Published private(set) var progress:Double?
    @Published private(set) var protection=""
    @Published var report=""
    @Published var reportTitle=""
    @Published var reportQuestions:[String]=[]
    @Published var messages:[(String,String)]=[]
    @Published var acceptedDisclaimer=false
    @Published var shareResultsWithLLM=false
    private var task:Task<Void,Never>?
    let billing = StoreBilling()
    let dataVault:SecureDataVault
    private let syncKeys:SyncKeyStore
    // Encrypted sync records live in the user's own iCloud, never on the Monadic DNA backend.
    private let cloud:SyncCloud
    /// Handle of the open encrypted store (docs/native-data-store.md); nil while locked.
    private(set) var storeHandle:Int?
    @Published private(set) var dataUnlocked=false
    /// Whether an encrypted store exists on this device; a first-time user has none to unlock.
    @Published private(set) var vaultExists=false
    @Published private(set) var storageMessage="Your saved data is locked."
    @Published private(set) var syncEnabled=false
    @Published private(set) var syncing=false
    @Published private(set) var syncMessage=""
    /// This device has no saved data, but iCloud Keychain holds this user's sync key: their data can be restored.
    @Published private(set) var restorable=false
    private var loadingCustomization=false
    @Published private(set) var locking=false
    private var customizationTask:Task<Void,Never>?
    private var lockTask:Task<Void,Never>?
    private var syncTask:Task<Void,Never>?
    private var syncAgain=false
    init(dataVault:SecureDataVault,syncKeys:SyncKeyStore=KeychainSyncKeys(),cloud:SyncCloud=CloudKitSyncCloud()){
        self.dataVault=dataVault;self.syncKeys=syncKeys;self.cloud=cloud
        super.init();billing.store={[weak self] in self?.storeHandle};Task {await billing.current()}
        Task {vaultExists=await dataVault.exists;if !vaultExists{restorable=(try? syncKeys.get()) != nil}}
    }
    override convenience init(){self.init(dataVault:SecureDataVault())}
    private func handle() throws -> Int {guard let storeHandle else{throw Core.Failure(message:"Unlock your saved data first")};return storeHandle}
    private func storeInput(_ values:[String:Any]=[:]) throws -> [String:Any] {values.merging(["store":try handle()]){$1}}
    // Personalization edits are written shortly after typing stops; only changed fields are stamped for sync.
    private func customizationChanged(){
        guard dataUnlocked && !loadingCustomization else{return}
        customizationTask?.cancel()
        customizationTask=Task{try? await Task.sleep(nanoseconds:500_000_000);if !Task.isCancelled{saveCustomization()}}
    }
    private func saveCustomization(){
        guard dataUnlocked,let input=try? storeInput(["customization":["fields":profileFields,"context":profile]]) else{return}
        if (try? Core.call("store_set_customization",input)) as? Bool==true{queueSync()}
    }
    private func restoreCustomization(_ value:[String:Any]) {
        loadingCustomization=true
        profile=value["context"] as? String ?? "";profileFields=value["fields"] as? [String:String] ?? [:]
        loadingCustomization=false
    }
    func unlockData() async throws {
        if let lockTask {await lockTask.value}
        if dataUnlocked{return}
        // Tapping "Restore my data" on a new device is the user's choice to sync.
        if restorable{try? DeviceStore.put("sync-on","true")}
        let opened=try await dataVault.unlock()
        storeHandle=opened["handle"] as? Int;metadata=opened["metadata"] as? [String:Any] ?? [:]
        restoreCustomization(try Core.object("store_customization",try storeInput()))
        try refreshResults()
        dataUnlocked=true;vaultExists=true;restorable=false;storageMessage="Saved securely on this device";protection=await dataVault.protection
        try setUpSync()
        // Credit any App Store passes that arrived while locked.
        await billing.current()
    }
    func unlockSavedData(){work("Unlocking saved data"){try await self.unlockData()}}
    private func wipeMemory(){
        storeHandle=nil;billing.refreshPasses();dataUnlocked=false;syncEnabled=false;metadata=[:];resultCount=0;resultsVersion+=1;messages=[];report="";reportQuestions=[];selectedStudy=nil
        restoreCustomization(["fields":[:],"context":""])
    }
    func lockData(){
        guard !locking else{return};locking=true
        let running=task;let pendingSync=syncTask;let pendingSave=customizationTask
        lockTask=Task {
            running?.cancel();await running?.value;pendingSync?.cancel();await pendingSync?.value
            pendingSave?.cancel();saveCustomization()
            if let storeHandle{await dataVault.lock(storeHandle)}
            wipeMemory();storageMessage="Your saved data is locked.";locking=false
        }
    }
    func backgroundLock(){if dataUnlocked{lockData()}}

    // Sync (docs/native-data-store.md): on by default, end-to-end encrypted, same-platform for now.
    /// Home offers sync once after the first import.
    @Published private(set) var syncDecided=DeviceStore.get("sync-decided")=="true"
    var syncOffered:Bool{dataUnlocked && !syncEnabled && resultCount>0 && !syncDecided}
    func declineSync(){try? DeviceStore.put("sync-decided","true");syncDecided=true}
    private func setUpSync() throws {
        if try Core.object("store_sync_status",try storeInput())["enabled"] as? Bool==true{syncEnabled=true;queueSync();return}
        // Sync is opt-in, as on Android: Home offers it once and it starts only if the user accepts.
        if DeviceStore.get("sync-on") != "true"{return}
        // Reuse this user's key from iCloud Keychain (a new device restoring) or create one for this account.
        let existing=try? syncKeys.get()
        let enabled=try Core.object("store_sync_enable",try storeInput(existing.map{["syncKey":$0]} ?? [:]))
        if existing==nil,let key=enabled["syncKey"] as? String{
            do{try syncKeys.put(key)}catch{syncMessage="Sync is on, but a new device can't restore it yet: \(error.localizedDescription)"}
        }
        syncEnabled=true;queueSync()
    }
    func setSync(_ on:Bool){work(on ? "Turning on sync" : "Turning off sync and deleting the cloud copy"){
        try await self.unlockData()
        try DeviceStore.put("sync-decided","true");self.syncDecided=true
        if on{
            try await self.cloud.authorize()
            try DeviceStore.put("sync-on","true");try self.setUpSync()
            self.notice="Sync is on. An end-to-end encrypted copy is kept in your own iCloud so a new iPhone fills in automatically."
            return
        }
        self.syncTask?.cancel();await self.syncTask?.value
        if self.syncEnabled{try await self.cloud.deleteAll()}
        _=try Core.call("store_sync_disable",try self.storeInput());try? self.syncKeys.delete()
        try DeviceStore.put("sync-on","false");self.syncEnabled=false;self.syncMessage=""
        self.notice="Sync is off and the cloud copy is deleted. Your data stays on this device."
    }}
    private func queueSync(){
        guard syncEnabled && dataUnlocked && !locking else{return}
        if syncTask != nil{syncAgain=true;return}
        syncTask=Task {
            defer{syncTask=nil}
            var delay:UInt64=2_000_000_000
            while !Task.isCancelled {
                while busy{try? await Task.sleep(nanoseconds:200_000_000)}
                syncing=true
                do{repeat{syncAgain=false;try await syncOnce()}while syncAgain;syncMessage="";syncing=false;break}
                catch is CancellationError{syncing=false;return}
                catch{syncMessage="Sync will retry: \(error.localizedDescription)"}
                syncing=false
                try? await Task.sleep(nanoseconds:delay);delay=min(delay*2,300_000_000_000)
            }
            // Synced results that don't match this device's catalog are recomputed here.
            if dataUnlocked && !busy,let input=try? storeInput(["catalogVersion":catalogInfo?["version"] as? String ?? ""]),(try? Core.call("store_needs_match",input)) as? Bool==true{runAll()}
        }
    }
    private func syncOnce() async throws {
        let catalogVersion=catalogInfo?["version"] as? String ?? ""
        for _ in 0..<3 {
            // Pull first: a write must be based on the cloud's current revision.
            let list=try await cloud.list().map{["record":$0.record,"revision":$0.revision] as [String:Any]}
            let wanted=try Core.call("store_sync_wanted",try storeInput(["records":list])) as? [String] ?? []
            if !wanted.isEmpty {
                var changed=false
                for record in try await cloud.read(wanted) {
                    let input=try storeInput(["record":record.record,"revision":record.revision,"ciphertext":record.ciphertext,"catalogVersion":catalogVersion])
                    let applied=try await Task.detached{try Core.object("store_sync_apply",input)}.value
                    if applied["changed"] as? Bool==true{changed=true}
                    if applied["replacedLocal"] as? Bool==true{notice="Your DNA file was replaced by one imported on another device."}
                }
                if changed{metadata=try Core.object("store_metadata",try storeInput());restoreCustomization(try Core.object("store_customization",try storeInput()));try refreshResults();billing.refreshPasses()}
            }
            var conflict=false
            let outgoingInput=try storeInput()
            for out in try await Task.detached{try Core.array("store_sync_outgoing",outgoingInput)}.value {
                do {
                    let revision=try await cloud.write(out["record"] as? String ?? "",baseRevision:out["baseRevision"] as? Int ?? 0,ciphertext:out["ciphertext"] as? String ?? "")
                    _=try Core.call("store_sync_pushed",try storeInput(["record":out["record"] ?? "","revision":revision,"version":out["version"] ?? 0,"hash":out["hash"] ?? ""]))
                } catch is SyncConflict {conflict=true}
            }
            if !conflict{return}
        }
        throw Core.Failure(message:"Another device keeps changing your data; sync will retry")
    }
    var variantCount:Int { metadata["count"] as? Int ?? 0 }
    func work(_ label:String,_ operation:@escaping @MainActor () async throws -> Void){
        guard !busy else{return}
        busy=true;status=label;error=nil;notice=nil;progress=nil;accessNeeded=nil
        task=Task {
            defer{busy=false;progress=nil}
            // Every change is already written to the encrypted store, so nothing remains to save afterwards.
            do{try await operation();status="Complete"}catch is CancellationError{status="Cancelled"}catch{self.error=error.localizedDescription}
        }
    }
    func cancel(){task?.cancel()}
    var cancellable:Bool{busy && !status.hasPrefix("Cancelled")}
    func origin() throws -> String {
        guard let url=URL(string:backend),url.user==nil,url.password==nil,url.query==nil,url.fragment==nil else{throw Core.Failure(message:"Enter an HTTPS backend origin")}
        var allowed=url.scheme=="https"
        #if DEBUG
        allowed=allowed || (url.scheme=="http" && ["localhost","127.0.0.1"].contains(url.host ?? ""))
        #endif
        guard allowed else{throw Core.Failure(message:"Use HTTPS (debug also supports the local simulator host)")}
        return backend.trimmingCharacters(in:CharacterSet(charactersIn:"/"))
    }
    func request(_ url:URL,_ body:[String:Any]?=nil,bearer:String="",origin:String?=nil) async throws -> [String:Any] {
        var request=URLRequest(url:url);request.timeoutInterval=180;request.setValue("application/json",forHTTPHeaderField:"Accept")
        if !bearer.isEmpty{request.setValue("Bearer \(bearer)",forHTTPHeaderField:"Authorization")}
        if let origin{request.setValue(origin,forHTTPHeaderField:"Origin")}
        if let body{request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:body)}
        let (data,response)=try await URLSession.shared.data(for:request)
        guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode) else{throw Core.Failure(message:"Request failed. Check connection, account and provider settings.")}
        guard let object=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw Core.Failure(message:"Invalid server response")};return object
    }
    func api(_ path:String,_ body:[String:Any]?=nil) async throws -> [String:Any] {
        let base=try origin();guard let url=URL(string:base+path) else{throw Core.Failure(message:"Invalid backend URL")}
        return try await request(url,body)
    }
    func saveSettings() throws {
        _=try origin()
        _=try profileData()
        for (key,value) in [("backend",backend),("provider",provider),("model",model),("api-key-"+provider,apiKey),("ollama-address",ollamaAddress),("ollama-port",ollamaPort)]{try DeviceStore.put(key,value)}
    }
    func selectProvider(_ next:String){do{try DeviceStore.put("api-key-"+provider,apiKey);provider=next;apiKey=DeviceStore.get("api-key-"+next)}catch{self.error="Unable to switch secure provider settings"}}
    func browse(_ query:String,_ trait:String,semantic:Bool,offset:Int=0){work("Loading studies"){
        var components=URLComponents();components.queryItems=[URLQueryItem(name:"search",value:query),URLQueryItem(name:"trait",value:trait),URLQueryItem(name:"searchMode",value:semantic ? "similarity":"exact"),URLQueryItem(name:"limit",value:"50"),URLQueryItem(name:"offset",value:String(offset))]
        let data=try await self.api("/api/studies?"+(components.percentEncodedQuery ?? ""))
        self.studies=(data["data"] as? [[String:Any]] ?? []).map(Record.init)
    }}
    func readFile(_ url:URL) throws -> Data {
        let accessible=url.startAccessingSecurityScopedResource();defer{if accessible{url.stopAccessingSecurityScopedResource()}}
        let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
        guard size<=150*1024*1024 else{throw Core.Failure(message:"File exceeds 150 MB")}
        let data=try Data(contentsOf:url);guard data.count<=150*1024*1024 else{throw Core.Failure(message:"File exceeds 150 MB")};return data
    }
    func importDNA(_ url:URL){work("Importing DNA on device"){
        guard self.acceptedDisclaimer else{throw Core.Failure(message:"Accept the educational-use disclaimer first")}
        try await self.unlockData()
        let data=try self.readFile(url);let handle=try self.handle();let name=url.lastPathComponent
        let metadata=try await Task.detached{try Core.importToStore(handle,data,name)}.value
        try Task.checkCancellation();self.metadata=metadata
        self.resultCount=0;self.resultsVersion+=1
        let names=["23andme":"23andMe","ancestrydna":"AncestryDNA","myheritage":"MyHeritage","ftdna":"FamilyTreeDNA","livingdna":"LivingDNA","mapmygenome":"Mapmygenome","monadic":"Monadic DNA"]
        let format=(metadata["detectedFormat"] as? String).flatMap{names[$0]}.map{" from \($0)"} ?? ""
        // Matching the bundled catalog takes seconds, so it follows the import directly.
        let matches=try await self.runAllData()
        self.notice="Imported \(self.variantCount.formatted()) variants\(format) and found \(matches.formatted()) research matches."
    }}
    func refreshResults() throws{resultCount=try Core.call("store_result_count",try storeInput()) as? Int ?? 0;resultsVersion+=1}
    func resultsPage(filter:String,direction:String,sort:String,offset:Int,limit:Int=100) async throws -> (rows:[Record],total:Int) {
        // Screens can ask while locked; there is nothing to show until the store is open.
        guard storeHandle != nil else{return ([],0)}
        let input=try storeInput(["filter":filter,"direction":direction,"sort":sort,"offset":offset,"limit":limit])
        let page=try await Task.detached{try Core.object("store_results_page",input)}.value
        return ((page["rows"] as? [[String:Any]] ?? []).map(Record.init),page["total"] as? Int ?? 0)
    }
    func resultFor(_ studyId:Int)->Record?{guard let input=try? storeInput(["studyId":studyId]) else{return nil};return (try? Core.call("store_result",input) as? [String:Any]).map(Record.init)}
    func analyze(_ record:Record){work("Matching DNA on device"){
        guard self.dataUnlocked && self.variantCount>0 else{throw Core.Failure(message:"Unlock or import your DNA first")}
        let input=try self.storeInput(["studies":[record.raw],"now":ISO8601DateFormatter().string(from:Date())])
        _=try await Task.detached{try Core.call("store_analyze",input)}.value
        try self.refreshResults();self.queueSync()
        self.notice=self.resultFor(record.id) != nil ? "Match saved to Results." : "Your DNA has no called genotype for this study's risk variant."
    }}
    func loadStudy(_ id:Int){work("Loading study"){
        let data=try await self.api("/api/studies?id=\(id)")
        self.selectedStudy=(data["data"] as? [[String:Any]] ?? []).first.map(Record.init)
    }}
    /// The catalog snapshot bundled with this release, from catalog.json.
    let catalogInfo:[String:Any]?=Bundle.main.url(forResource:"catalog",withExtension:"json").flatMap{try? Data(contentsOf:$0)}.flatMap{try? JSONSerialization.jsonObject(with:$0) as? [String:Any]}
    private static let catalogChunk=50000
    func runAll(){work("Opening the research catalog"){
        let started=Date()
        let matches=try await self.runAllData()
        let seconds=Int(Date().timeIntervalSince(started))
        self.notice="Run all finished in \(seconds/60):\(String(format:"%02d",seconds%60)) and saved \(matches.formatted()) matches from research catalog \(self.catalogInfo?["version"] as? String ?? "")."
    }}
    /// Matches the bundled catalog and returns the number of saved matches.
    private func runAllData() async throws -> Int {
        guard dataUnlocked && variantCount>0 else{throw Core.Failure(message:"Unlock or import your DNA first")}
        // Rust streams the bundled snapshot straight from the app bundle.
        guard let path=Bundle.main.path(forResource:"catalog",ofType:"zst") else{throw Core.Failure(message:"The research catalog is missing from this build")}
        let now=ISO8601DateFormatter().string(from:Date())
        let started=Date();var refreshed=started
        let catalog=try await Task.detached{try Core.catalogOpen(path)}.value
        let handle=catalog["handle"] as? Int ?? 0;let total=catalog["rows"] as? Int ?? 0
        defer{Core.catalogClose(handle)}
        var processed=0
        while true {
            try Task.checkCancellation()
            let store=try self.handle();let size=Self.catalogChunk
            let chunk=try await Task.detached{try Core.catalogAnalyzeNext(handle,store,size,now)}.value
            processed+=chunk["rows"] as? Int ?? 0;resultCount=chunk["saved"] as? Int ?? resultCount
            let elapsed=Int(Date().timeIntervalSince(started))
            progress=total>0 ? Double(processed)/Double(total) : nil
            status="Analyzed \(processed.formatted()) of \(total.formatted()) studies (\(total>0 ? processed*100/total : 0)%) • \(resultCount.formatted()) matches • \(elapsed/60):\(String(format:"%02d",elapsed%60)) elapsed"
            // Matches appear while the run continues; the core drops stale results when a run completes.
            if Date().timeIntervalSince(refreshed)>3{resultsVersion+=1;refreshed=Date()}
            if chunk["done"] as? Bool==true{break}
        }
        try refreshResults();queueSync()
        return resultCount
    }
    func clear(){lockData()}
    func exportResults() throws -> String{try Core.string("store_export",try storeInput())}
    func importResults(_ url:URL){work("Importing results"){
        try await self.unlockData()
        let data=try self.readFile(url)
        _=try Core.call("store_import_results",try self.storeInput(["content":String(decoding:data,as:UTF8.self),"fileName":url.lastPathComponent,"now":ISO8601DateFormatter().string(from:Date())]))
        try self.refreshResults();self.queueSync()
    }}
    /// Deletes this device's data. The cloud copy stays, so this device or another can restore it.
    func deleteVault(){work("Deleting saved data"){
        if let lockTask=self.lockTask{await lockTask.value}
        self.syncTask?.cancel();await self.syncTask?.value
        if let storeHandle=self.storeHandle{await self.dataVault.lock(storeHandle)}
        try await self.dataVault.delete()
        let synced=self.syncEnabled
        self.wipeMemory();self.vaultExists=false;self.storageMessage="Local saved data deleted."
        self.restorable=synced || (try? self.syncKeys.get()) != nil
    }}
    /// Premium status and report passes come from the App Store; Monadic DNA keeps no purchase records. Returns the pass to use, if any.
    private func requireAccess(_ kind:String) async throws -> String? {
        if try Core.object("feature_access",["kind":kind])["allowed"] as? Bool == true{return nil}
        await billing.current()
        let access=try Core.object("feature_access",["kind":kind,"activeSubscription":billing.premium])
        if access["allowed"] as? Bool == true{return nil}
        guard let type=access["reportType"] as? String else{accessNeeded="premium";throw Core.Failure(message:"Chat is part of Premium. Subscribe in Account to continue. The Health report is free.")}
        guard billing.passes[type, default:0]>0 else{accessNeeded="premium";throw Core.Failure(message:"The \(kind) report is part of Premium. Subscribe, or buy a pass for this report, in Account.")}
        return type
    }
    private func complete(_ messages:[[String:Any]]) async throws -> String {
        let config=try Core.object("llm_config",["provider":provider,"model":model,"huggingfaceApiKey":apiKey,"ollamaAddress":ollamaAddress,"ollamaPort":Int(ollamaPort) ?? 11434])
        let endpoint=(config["endpoint"] as? String ?? "").trimmingCharacters(in:CharacterSet(charactersIn:"/"));let identifier=config["identifier"] as? String ?? model
        if provider=="ollama"{
            let data=try await request(URL(string:endpoint+"/api/chat")!,["model":identifier,"messages":messages,"stream":false])
            guard let message=data["message"] as? [String:Any],let content=message["content"] as? String else{throw Core.Failure(message:"Invalid Ollama response")};return content
        }
        if provider=="huggingface" && apiKey.isEmpty{throw Core.Failure(message:"Enter your own provider API key in Settings")}
        let bearer:String
        if provider=="nilai"{bearer=try await nilaiAuthorization(endpoint)}else{bearer=apiKey}
        let data=try await request(URL(string:endpoint+"/chat/completions")!,["model":identifier,"messages":messages,"stream":false],bearer:bearer)
        guard let choices=data["choices"] as? [[String:Any]],let message=choices.first?["message"] as? [String:Any],let content=message["content"] as? String else{throw Core.Failure(message:"Invalid provider response")};return content
    }
    private func nilaiAuthorization(_ endpoint:String)async throws->String{
        let (data,response)=try await URLSession.shared.data(from:URL(string:endpoint+"/public_key")!)
        guard (response as? HTTPURLResponse)?.statusCode==200 else{throw Core.Failure(message:"Unable to retrieve nilAI public key")}
        let serverKey=String(decoding:data,as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines)
        let pair:[String:Any]
        if apiKey.isEmpty{pair=try Core.object("nilai_keypair",["entropy":DeviceStore.entropy(32)])}else{pair=["privateKey":apiKey]}
        var input:[String:Any]=["privateKey":pair["privateKey"]!,"serverKey":serverKey,"nonce":try DeviceStore.entropy(16),"rootNonce":try DeviceStore.entropy(16),"now":Int(Date().timeIntervalSince1970)]
        if apiKey.isEmpty{
            let delegation=try await api("/api/nilai-delegation",["delegationRequest":["public_key":pair["publicKey"]!]])
            guard let envelope=delegation["delegationToken"] as? [String:Any],let token=envelope["delegation_token"] as? String else{throw Core.Failure(message:"Invalid nilAI delegation response")}
            input["delegation"]=token
        }
        return try Core.string("nilai_invocation",input)
    }
    private func reportPrompt(_ kind:String) async throws -> [[String:Any]] {
        let input=try storeInput(["kind":kind,"customization":try profileData(),"context":profile])
        let prompt=try await Task.detached{try Core.object("store_report_prompt",input)}.value
        return prompt["messages"] as? [[String:Any]] ?? []
    }
    /// `onSent` runs once a reply has arrived, so a failed send keeps the user's question.
    func sendChat(_ message:String,onSent:@escaping @MainActor ()->Void={}){work("Asking selected provider"){
        guard self.shareResultsWithLLM else{throw Core.Failure(message:"Confirm sharing matched results with the selected provider first")}
        _=try await self.requireAccess("Chat")
        var messages=try await self.reportPrompt("DNA chat")
        messages+=self.messages.map{["role":$0.0,"content":$0.1]};messages.append(["role":"user","content":message])
        let response=try await self.complete(messages);self.messages.append(("user",message));self.messages.append(("assistant",response));onSent()
    }}
    func generateReport(_ kind:String){work("Generating report"){
        guard self.shareResultsWithLLM else{throw Core.Failure(message:"Confirm sharing results with the selected provider first")}
        guard self.resultCount>0 else{throw Core.Failure(message:"Add your DNA file first so there are matches to report on")}
        let pass=try await self.requireAccess(kind)
        if kind != "Overview" {
            let content=try await self.complete(try await self.reportPrompt(kind))
            let parsed=try Core.object("extract_report",content)
            self.reportTitle=kind;self.report=parsed["report"] as? String ?? content;self.reportQuestions=parsed["questions"] as? [String] ?? []
            // A pass is used only once the report exists, so a failed run keeps it.
            if let pass{self.billing.consumePass(pass)}
            return
        }
        // Groups arrive formatted from the store, so the full result set never reaches Swift.
        let input=try self.storeInput(["groups":(self.resultCount+249)/250])
        let groups=try await Task.detached{try Core.array("store_report_groups",input)}.value
        let userContext=try Core.string("user_context",self.profileData())+"\n"+self.profile
        var summaries:[String]=[]
        for (index,group) in groups.enumerated(){
            try Task.checkCancellation();self.status="Report group \(index+1)/\(groups.count)"
            let prompt=try Core.string("render_prompt",["name":"generateMapPrompt","values":["groupNumber":index+1,"totalGroups":groups.count,"resultsInGroup":group["count"] as? Int ?? 0,"totalResults":self.resultCount,"compactResults":group["text"] as? String ?? "","userContext":userContext]])
            summaries.append(try await self.complete([["role":"user","content":prompt]]))
        }
        let reduce=try Core.string("render_prompt",["name":"generateReducePrompt","values":["groupSummaries":summaries,"userContext":userContext]])
        self.reportTitle=kind;self.report=try await self.complete([["role":"user","content":reduce]])
        if let pass{self.billing.consumePass(pass)}
    }}
}
