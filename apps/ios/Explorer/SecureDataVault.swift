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

/// The device's encrypted store (docs/native-data-store.md). A random 32-byte local key, wrapped by the
/// Secure Enclave, opens the SQLCipher database. The local key never leaves this device.
actor SecureDataVault {
    private static let keyID="Explorer store key v1"
    private let directory:URL
    private let protector:VaultKeyProtector
    private var keyURL:URL { directory.appendingPathComponent("device-key.json") }
    private var databaseURL:URL { directory.appendingPathComponent("explorer.db") }
    init(protector:VaultKeyProtector=HardwareVaultKey(), directory:URL?=nil) {
        self.protector=protector
        self.directory=directory ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("protected-data",isDirectory:true)
    }
    var exists:Bool { FileManager.default.fileExists(atPath:keyURL.path) && FileManager.default.fileExists(atPath:databaseURL.path) }
    var protection:String { protector.description }
    private func removeDatabase(){for suffix in ["","-wal","-shm"]{try? FileManager.default.removeItem(atPath:databaseURL.path+suffix)}}
    /// Authenticates the user, then opens (creating on first use) the store. Returns its handle and metadata.
    func unlock() async throws -> [String:Any] {
        try await protector.authenticate()
        defer{protector.reset()}
        // The app's default Data Protection entitlement makes SQLite's own journal files "Complete" too.
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.complete])
        var folder=directory;var resources=URLResourceValues();resources.isExcludedFromBackup=true;try folder.setResourceValues(resources)
        // Earlier development builds kept a single encrypted blob here; it is never read.
        try? FileManager.default.removeItem(at:directory.appendingPathComponent("vault-v2.json"))
        var key:Data
        if FileManager.default.fileExists(atPath:keyURL.path) {
            guard let wrapped=try JSONSerialization.jsonObject(with:Data(contentsOf:keyURL)) as? [String:Any] else{throw Core.Failure(message:"Invalid protected key")}
            key=try protector.unwrap(wrapped,id:Self.keyID)
        } else {
            // A key without its database would be useless; start both fresh.
            removeDatabase()
            guard let random=Data(base64Encoded:try DeviceStore.entropy(32)),random.count==32 else{throw Core.Failure(message:"Secure random numbers are unavailable")}
            key=random
            try JSONSerialization.data(withJSONObject:try protector.wrap(key,id:Self.keyID),options:.sortedKeys).write(to:keyURL,options:[.atomic,.completeFileProtection])
        }
        defer{key.resetBytes(in:0..<key.count)}
        return try Core.openStore(databaseURL.path,key)
    }
    func lock(_ handle:Int){Core.closeStore(handle)}
    /// Deletes this device's data and its wrapping key. The cloud copy is handled by sync.
    func delete() throws {
        removeDatabase();try? FileManager.default.removeItem(at:keyURL);try protector.delete()
        guard !exists else{throw Core.Failure(message:"Unable to delete saved data")}
    }
}
