import Foundation
import SwiftUI
import AuthenticationServices
import UIKit

@MainActor final class ExplorerStore: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
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
    @Published var wallet=DeviceStore.get("wallet")
    @Published var metadata:[String:Any]=[:]
    @Published var studies:[Record]=[]
    @Published var results:[Record]=[]
    @Published var selectedStudy:Record?
    @Published var subscription:[String:Any]?
    @Published var busy=false
    @Published var status=""
    @Published var error:String?
    @Published var report=""
    @Published var reportTitle=""
    @Published var reportQuestions:[String]=[]
    @Published var messages:[(String,String)]=[]
    @Published var acceptedDisclaimer=false
    @Published var shareResultsWithLLM=false
    private var authSession:ASWebAuthenticationSession?
    private var task:Task<Void,Never>?
    let billing = StoreBilling()
    private(set) var session:Int
    let dataVault:SecureDataVault
    @Published private(set) var dataUnlocked=false
    @Published private(set) var storageMessage="Your saved data is locked."
    @Published private(set) var syncing=false
    private var dataDirty=false
    private var dataVersion=0
    private var lastCustomization=Data()
    private var restoring=false
    @Published private(set) var locking=false
    private var autosave:Task<Void,Never>?
    private var lockTask:Task<Void,Never>?
    private var syncTask:Task<Void,Never>?
    private var syncAgain=false
    init(dataVault:SecureDataVault){
        self.dataVault=dataVault;session=(try? Core.call("session_create") as? Int) ?? 0
        super.init();billing.attach(self);Task {try? await billing.recover()}
    }
    override convenience init(){self.init(dataVault:SecureDataVault())}
    private func customization()->[String:Any]{["fields":profileFields,"context":profile]}
    private func customizationChanged(){if dataUnlocked && !restoring {markDataChanged()}}
    private func restoreCustomization(_ value:[String:Any]) {
        restoring=true
        profile=value["context"] as? String ?? "";profileFields=value["fields"] as? [String:String] ?? [:]
        lastCustomization=(try? JSONSerialization.data(withJSONObject:customization(),options:.sortedKeys)) ?? Data()
        restoring=false
    }
    func unlockData() async throws {
        if let lockTask {await lockTask.value}
        if dataUnlocked{return}
        let existed=await dataVault.exists
        restoreCustomization(try await dataVault.unlock(session))
        metadata=try Core.object("session_metadata",["session":session]);try refreshResults()
        dataUnlocked=true;storageMessage="Saved on device • \(await dataVault.protection)"
        if !existed {
            let fields=(try? JSONSerialization.jsonObject(with:Data(DeviceStore.get("profile-fields").utf8))) as? [String:Any] ?? [:]
            restoreCustomization(["fields":fields,"context":DeviceStore.get("profile")])
            dataDirty=true;try await flushData();try DeviceStore.put("profile","");try DeviceStore.put("profile-fields","")
        }
        queueSync()
    }
    func unlockSavedData(){work("Unlocking saved data"){try await self.unlockData()}}
    private func markDataChanged(){
        dataDirty=true;dataVersion+=1;storageMessage="Saving securely…"
        autosave?.cancel()
        autosave=Task {
            do {try await Task.sleep(nanoseconds:500_000_000);while busy {try await Task.sleep(nanoseconds:100_000_000)};try Task.checkCancellation();try await flushData()}
            catch is CancellationError {} catch {if dataUnlocked{storageMessage="Changes not saved. Please retry.";self.error=error.localizedDescription}}
        }
    }
    func flushData() async throws {
        guard dataUnlocked && dataDirty else{return}
        let version=dataVersion;let custom=customization()
        try await dataVault.save(session,custom)
        lastCustomization=try JSONSerialization.data(withJSONObject:custom,options:.sortedKeys)
        if version==dataVersion{dataDirty=false}
        storageMessage=dataDirty ? "Saving securely…" : "Saved on device • \(await dataVault.protection)"
        queueSync()
    }
    private func wipeMemory(){
        _=try? Core.call("session_close",["session":session]);session=(try? Core.call("session_create") as? Int) ?? 0
        dataUnlocked=false;dataDirty=false;metadata=[:];results=[];messages=[];report="";reportQuestions=[];selectedStudy=nil
        restoreCustomization(["fields":[:],"context":""])
    }
    func lockData(){
        guard !locking else{return};locking=true
        let running=task;let pendingSave=autosave;let pendingSync=syncTask
        lockTask=Task {
            running?.cancel();await running?.value;pendingSave?.cancel();await pendingSave?.value;pendingSync?.cancel();await pendingSync?.value
            do{try await flushData()}catch{self.error="Latest changes could not be saved. The previous encrypted copy is intact."}
            await dataVault.lock();wipeMemory();storageMessage="Your saved data is locked.";locking=false
        }
    }
    func backgroundLock(){if dataUnlocked{lockData()}}
    private func queueSync(){
        guard dataUnlocked && !locking else{return}
        if syncing{syncAgain=true;return}
        if syncTask != nil {syncAgain=true;return}
        syncTask=Task {
            defer{syncing=false;syncTask=nil}
            guard let config=await dataVault.configuration(),config["enabled"] as? Bool==true else{return}
            do {while busy {try await Task.sleep(nanoseconds:100_000_000)};try await Task.sleep(nanoseconds:1_000_000_000)} catch{return}
            syncing=true
            do{repeat{syncAgain=false;try await syncOnce()}while syncAgain}
            catch is CancellationError {} catch{storageMessage="Saved on device. Sync needs attention.";self.error=error.localizedDescription}
        }
    }
    private func syncOnce() async throws {
        guard let config=await dataVault.configuration(),config["enabled"] as? Bool==true else{return}
        guard !wallet.isEmpty,wallet.lowercased()==config["wallet"] as? String else{throw Core.Failure(message:"Sign in to the account used to enable sync")}
        let syncWallet=wallet
        let observedVersion=dataVersion
        let response=try await api("/api/vault-sync",["walletAddress":syncWallet,"action":"read","knownRevision":config["revision"] ?? 0,"knownGenotype":await dataVault.genotypeDigest() ?? ""])
        let revision=response["revision"] as? Int ?? 0;let base=config["revision"] as? Int ?? 0
        guard wallet.lowercased()==syncWallet.lowercased(),let latest=await dataVault.configuration(),latest["enabled"] as? Bool==true,latest["wallet"] as? String==config["wallet"] as? String else{return}
        if revision==base {
            if config["dirty"] as? Bool==true {
                var archive=try await dataVault.archive();var envelope=archive["envelope"] as! [String:Any]
                let uploaded=envelope["revision"] as! Int
                if envelope["genotypeDigest"] as? String==response["genotypeDigest"] as? String {envelope.removeValue(forKey:"genotype");archive["envelope"]=envelope}
                let result=try await api("/api/vault-sync",["walletAddress":syncWallet,"action":"write","baseRevision":base,"archive":archive])
                try await dataVault.synced(result["revision"] as! Int,uploaded)
            }
        } else {
            if let cloud=response["archive"] as? [String:Any] {
                let local=try await dataVault.archive()
                if cloud["mac"] as? String==local["mac"] as? String {
                    try await dataVault.synced(revision,(local["envelope"] as! [String:Any])["revision"] as! Int);return
                }
            }
            guard !dataDirty,observedVersion==dataVersion,!busy,latest["dirty"] as? Bool != true else{throw Core.Failure(message:"Another device has changes. Restore the cloud copy to replace device data, or export a backup before resolving this conflict.")}
            guard let archive=response["archive"] as? [String:Any] else{throw Core.Failure(message:"The cloud copy was removed. Disable sync or set it up again explicitly.")}
            restoreCustomization(try await dataVault.acceptCloud(session,archive,revision))
            metadata=try Core.object("session_metadata",["session":session]);try refreshResults()
        }
        storageMessage="Saved on device and encrypted sync is up to date."
    }
    func syncNow(){work("Syncing encrypted data"){try await self.unlockData();try await self.flushData();self.queueSync()}}
    func enableSync(_ password:String){work("Setting up encrypted sync"){
        guard !self.wallet.isEmpty else{throw Core.Failure(message:"Sign in before enabling sync")}
        try await self.unlockData();try await self.flushData();try await self.dataVault.enableSync(self.wallet,password);self.queueSync()
    }}
    func disableSync(){work("Disabling sync on this device"){try await self.dataVault.disableSync();self.storageMessage="Saved on device. Sync is disabled on this device."}}
    private func prepareRecovery() async throws {
        guard dataUnlocked else{return}
        locking=true;defer{locking=false}
        autosave?.cancel();await autosave?.value;syncTask?.cancel();await syncTask?.value
        try await flushData();await dataVault.lock();wipeMemory()
    }
    func restoreCloud(_ password:String){work("Restoring encrypted cloud data"){
        guard !self.wallet.isEmpty else{throw Core.Failure(message:"Sign in to restore cloud data")}
        let response=try await self.api("/api/vault-sync",["walletAddress":self.wallet,"action":"read"])
        guard let archive=response["archive"] as? [String:Any],let revision=response["revision"] as? Int else{throw Core.Failure(message:"No encrypted cloud copy exists for this account")}
        try await self.prepareRecovery()
        self.restoreCustomization(try await self.dataVault.restore(self.session,archive,password,allowOlder:true))
        self.dataUnlocked=true;self.dataDirty=false;self.metadata=try Core.object("session_metadata",["session":self.session]);try self.refreshResults()
        try await self.dataVault.enableExistingSync(self.wallet,revision);self.storageMessage="Restored encrypted cloud data and enabled sync."
    }}
    func deleteCloud(){work("Deleting cloud copy"){
        guard !self.wallet.isEmpty else{throw Core.Failure(message:"Sign in first")}
        let response=try await self.api("/api/vault-sync",["walletAddress":self.wallet,"action":"read"])
        _=try await self.api("/api/vault-sync",["walletAddress":self.wallet,"action":"delete","baseRevision":response["revision"] ?? 0])
        try await self.dataVault.disableSync();self.storageMessage="Cloud copy deleted. The encrypted device copy is retained."
    }}
    var variantCount:Int { metadata["count"] as? Int ?? 0 }
    func work(_ label:String,_ operation:@escaping @MainActor () async throws -> Void){
        guard !busy else{return}
        guard !syncing else{error="Encrypted sync is in progress. Please retry in a moment.";return}
        busy=true;status=label;error=nil
        task=Task {
            defer{busy=false}
            do{try await operation();status="Complete"}catch is CancellationError{status="Cancelled"}catch{self.error=error.localizedDescription}
            do{try await flushData()}catch{storageMessage="Changes not saved. Please retry.";self.error=error.localizedDescription}
        }
    }
    func cancel(){task?.cancel()}
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
        return try await request(url,body,bearer:DeviceStore.get("auth-token"))
    }
    func saveSettings() throws {
        _=try origin()
        _=try profileData()
        if dataUnlocked{markDataChanged()}
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
        try await self.unlockData();self.markDataChanged()
        let data=try self.readFile(url);let session=self.session;let name=url.lastPathComponent
        let metadata=try await Task.detached{try Core.importFile(session,data,name)}.value
        try Task.checkCancellation();self.metadata=metadata
        self.results=[];self.markDataChanged()
    }}
    func refreshResults() throws{results=try Core.array("session_results",["session":session]).map(Record.init)}
    func analyze(_ record:Record){work("Matching DNA on device"){
        guard self.dataUnlocked && self.variantCount>0 else{throw Core.Failure(message:"Unlock or import your DNA first")}
        self.markDataChanged()
        let session=self.session;let input:[String:Any]=["session":session,"studies":[record.raw],"now":ISO8601DateFormatter().string(from:Date())]
        _=try await Task.detached{try Core.call("session_analyze",input)}.value
        self.markDataChanged();try self.refreshResults()
    }}
    func runAll(){work("Analyzing catalog on device"){
        guard self.dataUnlocked && self.variantCount>0 else{throw Core.Failure(message:"Unlock or import your DNA first")}
        self.markDataChanged()
        let pageSize=5000
        var offset=0,processed=0,matches=0,finished=false
        let now=ISO8601DateFormatter().string(from:Date())
        while !finished {
            try Task.checkCancellation()
            let start=offset
            // Three bounded requests overlap latency; commit pages in catalog order.
            let pages=try await withThrowingTaskGroup(of:(Int,[[String:Any]]).self) { group in
                for index in 0..<3 {
                    group.addTask {
                        let page=try await self.api("/api/studies?fetchAll=true&searchMode=exact&excludeLowQuality=false&excludeMissingGenotype=false&limit=\(pageSize)&offset=\(start+index*pageSize)")
                        return (index,page["data"] as? [[String:Any]] ?? [])
                    }
                }
                var output:[(Int,[[String:Any]])]=[]
                for try await page in group{output.append(page)}
                return output.sorted{$0.0<$1.0}.map{$0.1}
            }
            for rows in pages {
                try Task.checkCancellation()
                if rows.isEmpty{finished=true;break}
                self.markDataChanged()
                let input:[String:Any]=["session":self.session,"studies":rows,"strict":true,"now":now]
                let count=try await Task.detached{try Core.call("session_analyze_count",input) as! Int}.value
                self.markDataChanged();processed+=rows.count;matches+=count
                self.status="Analyzed \(processed) studies • \(matches) matches"
                if rows.count<pageSize{finished=true;break}
            }
            offset+=pageSize*3
        }
        try self.refreshResults()
    }}
    func clear(){lockData()}
    func exportResults() throws -> String{try Core.string("session_export",["session":session])}
    func importResults(_ url:URL){work("Importing results"){
        try await self.unlockData();self.markDataChanged()
        let data=try self.readFile(url)
        _=try Core.call("session_import_results",["session":self.session,"content":String(decoding:data,as:UTF8.self),"fileName":url.lastPathComponent,"now":ISO8601DateFormatter().string(from:Date())]);try self.refreshResults()
    }}
    private var vaultURL:URL { FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("monadic-vault.json") }
    func encryptedVault(_ password:String) async throws -> String {
        try await unlockData();try await flushData()
        return String(decoding:try JSONSerialization.data(withJSONObject:await dataVault.backup(password)),as:UTF8.self)
    }
    func saveVault(_ password:String){work("Saving data securely"){try await self.unlockData();self.dataDirty=true;try await self.flushData()}}
    func unlockVault(_ password:String,file:URL?=nil){work("Restoring encrypted data"){
        let data=try file.map(self.readFile) ?? Data(contentsOf:self.vaultURL)
        guard var encrypted=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw Core.Failure(message:"Invalid encrypted vault")}
        if encrypted["version"] as? Int==2 {
            try await self.prepareRecovery()
            self.restoreCustomization(try await self.dataVault.restore(self.session,encrypted,password))
            self.dataUnlocked=true;self.dataDirty=false
        } else {
            try await self.unlockData();encrypted["password"]=password
            let snapshot=try Core.string("open",encrypted);_=try Core.call("session_restore",["session":self.session,"snapshot":snapshot]);self.markDataChanged();try await self.flushData()
        }
        self.metadata=try Core.object("session_metadata",["session":self.session]);try self.refreshResults()
        self.storageMessage="Saved on device • \(await self.dataVault.protection)"
    }}
    func deleteVault(){work("Deleting saved data"){
        self.autosave?.cancel();await self.autosave?.value;self.syncTask?.cancel();await self.syncTask?.value
        try await self.dataVault.delete()
        if FileManager.default.fileExists(atPath:self.vaultURL.path){try FileManager.default.removeItem(at:self.vaultURL)}
        self.dataDirty=false;self.wipeMemory();self.storageMessage="Local saved data deleted."
    }}
    func beginAuth() throws {
        let pair=try Core.object("auth_keypair",["entropy":DeviceStore.entropy(32)])
        let state=try DeviceStore.entropy(32).replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
        let pending:[String:Any]=["privateKey":pair["privateKey"]!,"state":state,"expires":Date().timeIntervalSince1970*1000+300000]
        try DeviceStore.put("pending-auth",String(decoding:try JSONSerialization.data(withJSONObject:pending),as:UTF8.self))
        var components=URLComponents(string:try origin()+"/mobile-auth")!;components.queryItems=[URLQueryItem(name:"state",value:state),URLQueryItem(name:"publicKey",value:pair["publicKey"] as? String)]
        guard let url=components.url else{throw Core.Failure(message:"Invalid sign-in request")}
        let session=ASWebAuthenticationSession(url:url,callbackURLScheme:"monadicexplorer"){[weak self] callback,error in
            Task{@MainActor in if let callback{self?.receiveAuth(callback)}else if let error{self?.error=error.localizedDescription};self?.authSession=nil}
        }
        session.presentationContextProvider=self;authSession=session
        guard session.start() else{throw Core.Failure(message:"Unable to open system sign-in")}
    }
    func presentationAnchor(for session:ASWebAuthenticationSession)->ASPresentationAnchor{
        UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).first(where:{$0.isKeyWindow}) ?? ASPresentationAnchor()
    }
    func receiveAuth(_ url:URL){work("Completing sign-in"){
        guard url.scheme=="monadicexplorer",url.host=="auth",let pending=try JSONSerialization.jsonObject(with:Data(DeviceStore.get("pending-auth").utf8)) as? [String:Any],let state=pending["state"] as? String else{throw Core.Failure(message:"Invalid sign-in callback")}
        let query=URLComponents(url:url,resolvingAgainstBaseURL:false)
        guard query?.queryItems?.first(where:{$0.name=="state"})?.value==state,(pending["expires"] as? Double ?? 0)>=Date().timeIntervalSince1970*1000 else{throw Core.Failure(message:"Expired or mismatched sign-in response")}
        let fragment=URLComponents(string:"https://callback/?"+(query?.fragment ?? ""))
        guard var encoded=fragment?.queryItems?.first(where:{$0.name=="payload"})?.value else{throw Core.Failure(message:"Missing encrypted sign-in response")}
        encoded=encoded.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");encoded+=String(repeating:"=",count:(4-encoded.count%4)%4)
        guard let data=Data(base64Encoded:encoded),var sealed=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw Core.Failure(message:"Invalid encrypted sign-in response")}
        sealed["privateKey"]=pending["privateKey"];sealed["state"]=state
        let plaintext=try Core.string("auth_open",sealed)
        guard let auth=try JSONSerialization.jsonObject(with:Data(plaintext.utf8)) as? [String:Any],let wallet=auth["walletAddress"] as? String,wallet.range(of:"^0x[a-fA-F0-9]{40}$",options:.regularExpression) != nil,let token=auth["token"] as? String,(auth["expiresAt"] as? Double ?? 0)>=Date().timeIntervalSince1970*1000 else{throw Core.Failure(message:"Invalid or expired account response")}
        try DeviceStore.put("auth-token",token);try DeviceStore.put("wallet",wallet);try DeviceStore.put("pending-auth","");self.wallet=wallet
        self.subscription=try await self.api("/api/check-subscription",["walletAddress":wallet])
    }}
    func signOut() throws {for key in ["auth-token","wallet","pending-auth"]{try DeviceStore.put(key,"")};wallet="";subscription=nil}
    func refreshSubscription(){work("Refreshing subscription"){guard !self.wallet.isEmpty else{throw Core.Failure(message:"Sign in first")};self.subscription=try await self.api("/api/check-subscription",["walletAddress":self.wallet])}}
    private func requireAccess(_ kind:String) async throws {
        var access=try Core.object("feature_access",["kind":kind])
        if access["allowed"] as? Bool == true{return}
        guard !wallet.isEmpty else{throw Core.Failure(message:"Sign in to your Explorer account first")}
        subscription=try await api("/api/check-subscription",["walletAddress":wallet])
        let active=(subscription?["subscription"] as? [String:Any])?["isActive"] as? Bool ?? false
        access=try Core.object("feature_access",["kind":kind,"activeSubscription":active])
        if access["allowed"] as? Bool == true{return}
        guard let type=access["reportType"] as? String else{throw Core.Failure(message:"An active subscription is required for chat")}
        let passes=try await api("/api/report-access",["walletAddress":wallet])
        guard ((passes["availableReports"] as? [String:Any])?[type] as? Int ?? 0)>0 else{throw Core.Failure(message:"Purchase a subscription or report pass in Account, then try again")}
        _=try await api("/api/report-access",["walletAddress":wallet,"reportType":type,"action":"consume"])
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
    func sendChat(_ message:String){work("Asking selected provider"){
        guard self.shareResultsWithLLM else{throw Core.Failure(message:"Confirm sharing matched results with the selected provider first")}
        try await self.requireAccess("Chat")
        let prompt=try Core.object("report_prompt",["kind":"DNA chat","results":self.results.map(\.raw),"customization":try self.profileData(),"context":self.profile])
        var messages=prompt["messages"] as? [[String:Any]] ?? []
        messages+=self.messages.map{["role":$0.0,"content":$0.1]};messages.append(["role":"user","content":message])
        let response=try await self.complete(messages);self.messages.append(("user",message));self.messages.append(("assistant",response))
    }}
    func generateReport(_ kind:String){work("Generating report"){
        guard self.shareResultsWithLLM else{throw Core.Failure(message:"Confirm sharing results with the selected provider first")}
        guard !self.results.isEmpty else{throw Core.Failure(message:"Analyze studies or import results first")}
        try await self.requireAccess(kind)
        if kind != "Overview" {
            let prompt=try Core.object("report_prompt",["kind":kind,"results":self.results.map(\.raw),"customization":try self.profileData(),"context":self.profile])
            let content=try await self.complete(prompt["messages"] as? [[String:Any]] ?? [])
            let parsed=try Core.object("extract_report",content)
            self.reportTitle=kind;self.report=parsed["report"] as? String ?? content;self.reportQuestions=parsed["questions"] as? [String] ?? []
            return
        }
        let groups=try Core.call("partition_results",["results":self.results.map(\.raw),"groups":(self.results.count+249)/250]) as? [[[String:Any]]] ?? []
        let userContext=try Core.string("user_context",self.profileData())+"\n"+self.profile
        var summaries:[String]=[]
        for (index,group) in groups.enumerated(){
            try Task.checkCancellation();self.status="Report group \(index+1)/\(groups.count)"
            let compact=try Core.string("format_results",group)
            let prompt=try Core.string("render_prompt",["name":"generateMapPrompt","values":["groupNumber":index+1,"totalGroups":groups.count,"resultsInGroup":group.count,"totalResults":self.results.count,"compactResults":compact,"userContext":userContext]])
            summaries.append(try await self.complete([["role":"user","content":prompt]]))
        }
        let reduce=try Core.string("render_prompt",["name":"generateReducePrompt","values":["groupSummaries":summaries,"userContext":userContext]])
        self.reportTitle=kind;self.report=try await self.complete([["role":"user","content":reduce]])
    }}
}
