import Foundation
import Security
import LocalAuthentication

protocol VaultKeyProtector: AnyObject {
    var description: String { get }
    func authenticate() async throws
    func wrap(_ key:Data, id:String) throws -> [String:Any]
    func unwrap(_ wrapped:[String:Any], id:String) throws -> Data
    func reset()
    func delete() throws
}
final class HardwareVaultKey: VaultKeyProtector {
    private let tag=Data("com.monadicdna.explorer.vault-v2".utf8)
    private var context:LAContext?
    var description:String { "Secure Enclave with device authentication" }
    func authenticate() async throws {
        let context=LAContext()
        guard try await context.evaluatePolicy(.deviceOwnerAuthentication,localizedReason:"Unlock your encrypted DNA, results and customization") else {throw Core.Failure(message:"Device authentication is required")}
        self.context=context
    }
    private func privateKey(create:Bool) throws -> SecKey {
        var query:[String:Any]=[kSecClass as String:kSecClassKey,kSecAttrApplicationTag as String:tag,kSecAttrKeyType as String:kSecAttrKeyTypeECSECPrimeRandom,kSecReturnRef as String:true]
        if let context { query[kSecUseAuthenticationContext as String]=context }
        var item:CFTypeRef?
        let status=SecItemCopyMatching(query as CFDictionary,&item)
        if status==errSecSuccess,let item { return (item as! SecKey) }
        guard create && status==errSecItemNotFound else {throw Core.Failure(message:"Device key unavailable. Restore an encrypted backup or cloud copy with your recovery passphrase.")}
        var error:Unmanaged<CFError>?
        guard let access=SecAccessControlCreateWithFlags(nil,kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,[.privateKeyUsage,.userPresence],&error) else {throw Core.Failure(message:"Set a device passcode to protect saved DNA")}
        let attributes:[String:Any]=[
            kSecAttrKeyType as String:kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String:256,
            kSecAttrTokenID as String:kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String:[kSecAttrIsPermanent as String:true,kSecAttrApplicationTag as String:tag,kSecAttrAccessControl as String:access]
        ]
        guard let key=SecKeyCreateRandomKey(attributes as CFDictionary,&error) else {throw Core.Failure(message:"Secure Enclave protection is unavailable on this device")}
        return key
    }
    func wrap(_ key:Data,id:String) throws -> [String:Any] {
        guard let publicKey=SecKeyCopyPublicKey(try privateKey(create:true)) else {throw Core.Failure(message:"Device key unavailable")}
        let payload=try JSONSerialization.data(withJSONObject:["vaultId":id,"key":key.base64EncodedString()],options:.sortedKeys)
        var error:Unmanaged<CFError>?
        guard let encrypted=SecKeyCreateEncryptedData(publicKey,.eciesEncryptionCofactorVariableIVX963SHA256AESGCM,payload as CFData,&error) else {throw Core.Failure(message:"Unable to protect the data key")}
        return ["algorithm":"SE-P256-ECIES","data":(encrypted as Data).base64EncodedString()]
    }
    func unwrap(_ wrapped:[String:Any],id:String) throws -> Data {
        guard wrapped["algorithm"] as? String=="SE-P256-ECIES",let encoded=wrapped["data"] as? String,let data=Data(base64Encoded:encoded) else {throw Core.Failure(message:"Invalid protected key")}
        var error:Unmanaged<CFError>?
        guard let opened=SecKeyCreateDecryptedData(try privateKey(create:false),.eciesEncryptionCofactorVariableIVX963SHA256AESGCM,data as CFData,&error),let object=try JSONSerialization.jsonObject(with:opened as Data) as? [String:Any],object["vaultId"] as? String==id,let encodedKey=object["key"] as? String,let key=Data(base64Encoded:encodedKey),key.count==32 else {throw Core.Failure(message:"Unable to unlock the protected data key")}
        return key
    }
    func reset(){context?.invalidate();context=nil}
    func delete() throws {
        let status=SecItemDelete([kSecClass as String:kSecClassKey,kSecAttrApplicationTag as String:tag] as CFDictionary)
        guard status==errSecSuccess || status==errSecItemNotFound else {throw Core.Failure(message:"Unable to delete the device key")}
        reset()
    }
}

actor SecureDataVault {
    private let directory:URL
    private var url:URL { directory.appendingPathComponent("vault-v2.json") }
    private let protector:VaultKeyProtector
    private var key:Data?
    private var record:[String:Any]?
    init(protector:VaultKeyProtector=HardwareVaultKey(), directory:URL?=nil) {
        self.protector=protector
        self.directory=directory ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("protected-data",isDirectory:true)
    }
    var exists:Bool { FileManager.default.fileExists(atPath:url.path) }
    var protection:String {protector.description}
    private func wipe(){if key != nil {key!.resetBytes(in:0..<key!.count)};key=nil;record=nil;protector.reset()}
    private func write(_ input:[String:Any]) throws {
        guard let key else {throw Core.Failure(message:"Unlock your saved data first")}
        var value=input;value.removeValue(forKey:"mac")
        value["mac"]=try Core.string("vault_record_mac",["key":key.base64EncodedString(),"record":value])
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.complete])
        var folder=directory;var resources=URLResourceValues();resources.isExcludedFromBackup=true;try folder.setResourceValues(resources)
        try JSONSerialization.data(withJSONObject:value,options:.sortedKeys).write(to:url,options:[.atomic,.completeFileProtection])
        record=value
    }
    func unlock(_ session:Int) async throws -> [String:Any] {
        try await protector.authenticate()
        if exists {
            guard let value=try JSONSerialization.jsonObject(with:Data(contentsOf:url)) as? [String:Any],let envelope=value["envelope"] as? [String:Any],let id=envelope["vaultId"] as? String,let wrapped=value["deviceKey"] as? [String:Any] else {throw Core.Failure(message:"Invalid saved vault")}
            var opened=try protector.unwrap(wrapped,id:id)
            do {
                _=try Core.call("vault_record_verify",["key":opened.base64EncodedString(),"record":value])
                try Core.restorePersisted(session,opened,envelope)
                key=opened;record=value
                return try Core.object("session_customization",["session":session])
            } catch {opened.resetBytes(in:0..<opened.count);wipe();throw error}
        }
        guard let generated=Data(base64Encoded:try DeviceStore.entropy(32)) else {throw Core.Failure(message:"Unable to create a data key")}
        key=generated
        let id=UUID().uuidString.lowercased()
        let envelope=try Core.sealSession(session,generated,id,1,try random(12),["fields":[:],"context":""])
        try write(["version":2,"deviceKey":protector.wrap(generated,id:id),"envelope":envelope,"sync":["enabled":false,"revision":0,"dirty":false]])
        return ["fields":[:],"context":""]
    }
    private func random(_ count:Int) throws -> Data {Data(base64Encoded:try DeviceStore.entropy(count))!}
    func save(_ session:Int,_ customization:[String:Any]) throws {
        guard let key,var current=record,let envelope=current["envelope"] as? [String:Any],let id=envelope["vaultId"] as? String,let revision=envelope["revision"] as? Int else {throw Core.Failure(message:"Unlock your saved data first")}
        current["envelope"]=try Core.sealSession(session,key,id,revision+1,try random(12),customization)
        var sync=current["sync"] as? [String:Any] ?? [:];sync["dirty"]=true;current["sync"]=sync
        try write(current)
    }
    func lock(){wipe()}
    func delete() throws {
        if exists {try FileManager.default.removeItem(at:url)}
        try protector.delete();wipe()
    }
    func backup(_ password:String) throws -> [String:Any] {
        guard let key,let current=record,let envelope=current["envelope"] as? [String:Any] else {throw Core.Failure(message:"Unlock your saved data first")}
        let wrapped=try Core.object("vault_wrap_key",["key":key.base64EncodedString(),"vaultId":envelope["vaultId"]!,"password":password,"salt":DeviceStore.entropy(16),"nonce":DeviceStore.entropy(12)])
        return try authenticatedArchive(["version":2,"envelope":envelope,"wrappedKey":wrapped])
    }
    func restore(_ session:Int,_ archive:[String:Any],_ password:String,allowOlder:Bool=false) async throws -> [String:Any] {
        try await protector.authenticate()
        guard let envelope=archive["envelope"] as? [String:Any],let wrapped=archive["wrappedKey"] as? [String:Any],let id=envelope["vaultId"] as? String,id==wrapped["vaultId"] as? String else {throw Core.Failure(message:"Invalid recovery archive")}
        guard var recovered=Data(base64Encoded:try Core.string("vault_unwrap_key",["wrappedKey":wrapped,"password":password])) else {throw Core.Failure(message:"Invalid recovered key")}
        let temporary=try Core.call("session_create") as! Int
        defer{_ = try? Core.call("session_close",["session":temporary])}
        do {
            _=try Core.call("vault_record_verify",["key":recovered.base64EncodedString(),"record":archive])
            try Core.restorePersisted(temporary,recovered,envelope)
            if !allowOlder,let old=record?["envelope"] as? [String:Any],old["vaultId"] as? String==id,(old["revision"] as? Int ?? 0)>(envelope["revision"] as? Int ?? 0) {throw Core.Failure(message:"This backup is older than this device's saved data")}
            let previous=key;key=recovered
            do {try write(["version":2,"deviceKey":protector.wrap(recovered,id:id),"envelope":envelope,"wrappedKey":wrapped,"sync":["enabled":false,"revision":0,"dirty":false]])} catch {key=previous;throw error}
            try Core.restorePersisted(session,recovered,envelope)
            return try Core.object("session_customization",["session":session])
        } catch {recovered.resetBytes(in:0..<recovered.count);throw error}
    }
    func configuration() -> [String:Any]? {record?["sync"] as? [String:Any]}
    private func authenticatedArchive(_ value:[String:Any]) throws -> [String:Any] {
        guard let key else{throw Core.Failure(message:"Unlock saved data first")}
        var archive=value;archive["mac"]=try Core.string("vault_record_mac",["key":key.base64EncodedString(),"record":value]);return archive
    }
    func archive() throws -> [String:Any] {
        guard let current=record,let envelope=current["envelope"],let wrapped=current["wrappedKey"] else {throw Core.Failure(message:"Set up encrypted sync first")}
        return try authenticatedArchive(["version":2,"envelope":envelope,"wrappedKey":wrapped])
    }
    func enableSync(_ wallet:String,_ password:String) throws {
        guard var current=record else {throw Core.Failure(message:"Unlock your saved data first")}
        current["wrappedKey"]=try backup(password)["wrappedKey"]
        current["sync"]=["enabled":true,"wallet":wallet.lowercased(),"revision":0,"dirty":true]
        try write(current)
    }
    func synced(_ revision:Int,_ uploadedRevision:Int) throws {
        guard var current=record,var sync=current["sync"] as? [String:Any] else {return}
        sync["revision"]=revision;sync["dirty"]=((current["envelope"] as? [String:Any])?["revision"] as? Int) != uploadedRevision;current["sync"]=sync;try write(current)
    }
    func enableExistingSync(_ wallet:String,_ revision:Int) throws {
        guard var current=record else{throw Core.Failure(message:"Unlock saved data first")}
        current["sync"]=["enabled":true,"wallet":wallet.lowercased(),"revision":revision,"dirty":false];try write(current)
    }
    func disableSync() throws {
        guard var current=record,var sync=current["sync"] as? [String:Any] else {return}
        sync["enabled"]=false;current["sync"]=sync;try write(current)
    }
    func genotypeDigest()->String?{(record?["envelope"] as? [String:Any])?["genotypeDigest"] as? String}
    func acceptCloud(_ session:Int,_ archive:[String:Any],_ revision:Int) throws -> [String:Any] {
        var archive=archive
        guard let key,var current=record,let old=current["envelope"] as? [String:Any],var envelope=archive["envelope"] as? [String:Any],old["vaultId"] as? String==envelope["vaultId"] as? String else {throw Core.Failure(message:"This cloud vault needs its recovery passphrase on this device")}
        if envelope["genotype"]==nil,envelope["genotypeDigest"] as? String==old["genotypeDigest"] as? String {envelope["genotype"]=old["genotype"];archive["envelope"]=envelope}
        let temporary=try Core.call("session_create") as! Int
        defer{_ = try? Core.call("session_close",["session":temporary])}
        _=try Core.call("vault_record_verify",["key":key.base64EncodedString(),"record":archive])
        try Core.restorePersisted(temporary,key,envelope)
        current["envelope"]=envelope;current["wrappedKey"]=archive["wrappedKey"]
        var sync=current["sync"] as? [String:Any] ?? [:];sync["revision"]=revision;sync["dirty"]=false;current["sync"]=sync
        try write(current);try Core.restorePersisted(session,key,envelope)
        return try Core.object("session_customization",["session":session])
    }
}
