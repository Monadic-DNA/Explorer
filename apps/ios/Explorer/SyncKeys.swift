import Foundation
import Security

/// Where the user's sync key lives so a new device can restore their data.
protocol SyncKeyStore: AnyObject {
    func get() throws -> String?
    func put(_ key:String) throws
    func delete() throws
}

/// iCloud Keychain. A synchronizable item is end-to-end encrypted and reaches every device
/// signed in to the same Apple ID, so a new iPhone can restore the user's data.
final class KeychainSyncKeys: SyncKeyStore {
    private var query:[String:Any] {[
        kSecClass as String:kSecClassGenericPassword,
        kSecAttrService as String:"com.monadicdna.explorer.sync",
        kSecAttrAccount as String:"sync-key.v1",
        kSecAttrSynchronizable as String:kCFBooleanTrue!,
    ]}
    func get() throws -> String? {
        var request=query;request[kSecReturnData as String]=true;request[kSecMatchLimit as String]=kSecMatchLimitOne
        var item:CFTypeRef?
        let status=SecItemCopyMatching(request as CFDictionary,&item)
        if status==errSecItemNotFound{return nil}
        guard status==errSecSuccess,let data=item as? Data else{throw Core.Failure(message:"Unable to read the sync key from iCloud Keychain")}
        return String(decoding:data,as:UTF8.self)
    }
    func put(_ key:String) throws {
        try delete()
        var item=query;item[kSecValueData as String]=Data(key.utf8)
        // Synchronizable items cannot be device-only; WhenUnlocked is the strictest class that syncs.
        item[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlocked
        guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else{throw Core.Failure(message:"Unable to save the sync key to iCloud Keychain")}
    }
    func delete() throws {
        let status=SecItemDelete(query as CFDictionary)
        guard status==errSecSuccess || status==errSecItemNotFound else{throw Core.Failure(message:"Unable to remove the sync key from iCloud Keychain")}
    }
}
