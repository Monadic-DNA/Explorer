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
    @Published var profile=DeviceStore.get("profile")
    @Published var profileFields:[String:String]=(try? JSONDecoder().decode([String:String].self,from:Data(DeviceStore.get("profile-fields").utf8))) ?? [:]
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
    private(set) var session:Int
    override init(){session=(try? Core.call("session_create") as? Int) ?? 0;super.init()}
    var variantCount:Int { metadata["count"] as? Int ?? 0 }
    func work(_ label:String,_ operation:@escaping @MainActor () async throws -> Void){
        guard !busy else{return}
        busy=true;status=label;error=nil
        task=Task { defer{busy=false};do{try await operation();status="Complete"}catch is CancellationError{status="Cancelled"}catch{self.error=error.localizedDescription} }
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
        try DeviceStore.put("profile-fields",String(decoding:try JSONSerialization.data(withJSONObject:profileFields),as:UTF8.self))
        for (key,value) in [("backend",backend),("provider",provider),("model",model),("api-key-"+provider,apiKey),("ollama-address",ollamaAddress),("ollama-port",ollamaPort),("profile",profile)]{try DeviceStore.put(key,value)}
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
        let data=try self.readFile(url);let session=self.session;let name=url.lastPathComponent
        let metadata=try await Task.detached{try Core.importFile(session,data,name)}.value
        try Task.checkCancellation();self.metadata=metadata
        self.results=[]
    }}
    func refreshResults() throws{results=try Core.array("session_results",["session":session]).map(Record.init)}
    func analyze(_ record:Record){work("Matching DNA on device"){
        guard self.variantCount>0 else{throw Core.Failure(message:"Import your DNA first")}
        let session=self.session;let input:[String:Any]=["session":session,"studies":[record.raw],"now":ISO8601DateFormatter().string(from:Date())]
        _=try await Task.detached{try Core.call("session_analyze",input)}.value
        try self.refreshResults()
    }}
    func runAll(){work("Analyzing catalog on device"){
        guard self.variantCount>0 else{throw Core.Failure(message:"Import your DNA first")}
        var offset=0
        while true{
            try Task.checkCancellation()
            let page=try await self.api("/api/studies?fetchAll=true&searchMode=exact&excludeLowQuality=false&excludeMissingGenotype=false&limit=1000&offset=\(offset)")
            let rows=page["data"] as? [[String:Any]] ?? [];if rows.isEmpty{break}
            let input:[String:Any]=["session":self.session,"studies":rows,"strict":true,"now":ISO8601DateFormatter().string(from:Date())]
            _=try await Task.detached{try Core.call("session_analyze",input)}.value
            offset+=1000;self.status="Analyzed up to \(offset) catalog records"
            if rows.count<1000{break}
        }
        try self.refreshResults()
    }}
    func clear(){task?.cancel();_ = try? Core.call("session_close",["session":session]);session=(try? Core.call("session_create") as? Int) ?? 0;metadata=[:];results=[];messages=[];report="";reportQuestions=[]}
    func exportResults() throws -> String{try Core.string("session_export",["session":session])}
    func importResults(_ url:URL){work("Importing results"){
        let data=try self.readFile(url)
        _=try Core.call("session_import_results",["session":self.session,"content":String(decoding:data,as:UTF8.self),"fileName":url.lastPathComponent,"now":ISO8601DateFormatter().string(from:Date())]);try self.refreshResults()
    }}
    private var vaultURL:URL { FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("monadic-vault.json") }
    func encryptedVault(_ password:String) async throws -> String {
        guard password.count>=8 else{throw Core.Failure(message:"Use a passphrase with at least eight characters")}
        let snapshot=try Core.string("session_snapshot",["session":session]);let salt=try DeviceStore.entropy(16);let iv=try DeviceStore.entropy(12)
        let encrypted=try await Task.detached{try Core.object("seal",["plaintext":snapshot,"password":password,"salt":salt,"iv":iv,"iterations":600000])}.value
        try Task.checkCancellation()
        return String(decoding:try JSONSerialization.data(withJSONObject:encrypted),as:UTF8.self)
    }
    func saveVault(_ password:String){work("Encrypting vault"){
        let encrypted=try await self.encryptedVault(password);let url=self.vaultURL
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
        try Data(encrypted.utf8).write(to:url,options:[.atomic,.completeFileProtection])
        var file=url;var resources=URLResourceValues();resources.isExcludedFromBackup=true;try file.setResourceValues(resources)
    }}
    func unlockVault(_ password:String,file:URL?=nil){work("Unlocking vault"){
        let data=try file.map(self.readFile) ?? Data(contentsOf:self.vaultURL)
        guard var encrypted=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw Core.Failure(message:"Invalid encrypted vault")}
        encrypted["password"]=password;let session=self.session
        let metadata=try await Task.detached{let snapshot=try Core.string("open",encrypted);return try Core.object("session_restore",["session":session,"snapshot":snapshot])}.value
        try Task.checkCancellation();self.metadata=metadata
        try self.refreshResults()
    }}
    func deleteVault() throws {if FileManager.default.fileExists(atPath:vaultURL.path){try FileManager.default.removeItem(at:vaultURL)};clear()}
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
    func checkout(){work("Opening card checkout"){
        guard !self.wallet.isEmpty else{throw Core.Failure(message:"Sign in first")}
        let response=try await self.api("/api/stripe/create-checkout",["walletAddress":self.wallet])
        guard let value=response["url"] as? String,let url=URL(string:value),url.scheme=="https" else{throw Core.Failure(message:"Invalid checkout URL")}
        await UIApplication.shared.open(url)
    }}
    func applyPromo(_ code:String) throws {let response=try Core.object("promo",code);guard response["valid"] as? Bool == true else{throw Core.Failure(message:response["message"] as? String ?? "Invalid promo")};try DeviceStore.put("promo",code);status=response["message"] as? String ?? ""}
    private func requireAccess(_ kind:String) async throws {
        var access=try Core.object("feature_access",["kind":kind,"promo":DeviceStore.get("promo")])
        if access["allowed"] as? Bool == true{return}
        guard !wallet.isEmpty else{throw Core.Failure(message:"Sign in or apply a premium promo code in Account first")}
        subscription=try await api("/api/check-subscription",["walletAddress":wallet])
        let active=(subscription?["subscription"] as? [String:Any])?["isActive"] as? Bool ?? false
        access=try Core.object("feature_access",["kind":kind,"promo":DeviceStore.get("promo"),"activeSubscription":active])
        if access["allowed"] as? Bool == true{return}
        guard let type=access["reportType"] as? String else{throw Core.Failure(message:"An active subscription or premium promo is required for chat")}
        let passes=try await api("/api/report-access",["walletAddress":wallet])
        guard ((passes["availableReports"] as? [String:Any])?[type] as? Int ?? 0)>0 else{throw Core.Failure(message:"Subscribe or buy a \(kind) report pass on the website, then try again")}
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
