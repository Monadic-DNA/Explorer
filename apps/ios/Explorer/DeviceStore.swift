import Foundation
import Security

enum DeviceStore {
    private static let service = "com.monadicdna.explorer"
    static func put(_ key: String,_ value: String) throws {
        let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        if value.isEmpty { SecItemDelete(query as CFDictionary);return }
        let attrs:[String:Any] = [kSecValueData as String:Data(value.utf8),kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status=SecItemUpdate(query as CFDictionary,attrs as CFDictionary)
        if status==errSecItemNotFound {
            let addStatus=SecItemAdd(query.merging(attrs){_,new in new} as CFDictionary,nil)
            guard addStatus==errSecSuccess else{throw Core.Failure(message:"Unable to save securely in Keychain")}
        }else if status != errSecSuccess {throw Core.Failure(message:"Unable to update Keychain")}
    }
    static func get(_ key: String) -> String {
        let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var item:CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess,let data=item as? Data else{return ""}
        return String(decoding:data,as:UTF8.self)
    }
    static func entropy(_ count: Int) throws -> String {
        var bytes=[UInt8](repeating:0,count:count)
        guard SecRandomCopyBytes(kSecRandomDefault,count,&bytes)==errSecSuccess else{throw Core.Failure(message:"Secure random generation failed")}
        return Data(bytes).base64EncodedString()
    }
}
