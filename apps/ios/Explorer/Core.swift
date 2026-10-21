import Foundation

enum Core {
    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
    static func importFile(_ session:Int,_ bytes:Data,_ name:String)throws->[String:Any]{
        let response=importGenotype(session:UInt64(session),bytes:bytes,fileName:name)
        guard let envelope=try JSONSerialization.jsonObject(with:Data(response.utf8)) as? [String:Any] else{throw Failure(message:"Invalid core response")}
        guard envelope["ok"] as? Bool == true else{throw Failure(message:envelope["error"] as? String ?? "Unable to import DNA file")}
        guard let metadata=envelope["value"] as? [String:Any] else{throw Failure(message:"Invalid import metadata")}
        return metadata
    }
    static func sealSession(_ session:Int,_ key:Data,_ id:String,_ revision:Int,_ nonce:Data,_ customization:[String:Any]) throws -> [String:Any] {
        let encoded=String(decoding:try JSONSerialization.data(withJSONObject:customization),as:UTF8.self)
        let response=persistSession(session:UInt64(session),key:key,vaultId:id,revision:UInt64(revision),nonce:nonce,customization:encoded)
        return try persistenceResponse(response)
    }
    static func restorePersisted(_ session:Int,_ key:Data,_ envelope:[String:Any]) throws {
        let encoded=String(decoding:try JSONSerialization.data(withJSONObject:envelope),as:UTF8.self)
        _=try persistenceResponse(restorePersistedSession(session:UInt64(session),key:key,encrypted:encoded))
    }
    private static func persistenceResponse(_ response:String) throws -> [String:Any] {
        guard let object=try JSONSerialization.jsonObject(with:Data(response.utf8)) as? [String:Any],object["ok"] as? Bool==true,let value=object["value"] as? [String:Any] else {throw Failure(message:"Unable to authenticate saved data")}
        return value
    }
    static func call(_ operation: String, _ input: Any = NSNull()) throws -> Any {
        let data = try JSONSerialization.data(withJSONObject: ["version":1,"operation":operation,"input":input], options: [.sortedKeys])
        let response = coreCall(request: String(decoding:data,as:UTF8.self))
        guard let envelope = try JSONSerialization.jsonObject(with:Data(response.utf8)) as? [String:Any] else { throw Failure(message:"Invalid core response") }
        guard envelope["ok"] as? Bool == true else { throw Failure(message:envelope["error"] as? String ?? "Shared core failed") }
        return envelope["value"] ?? NSNull()
    }
    static func object(_ operation: String,_ input: Any = NSNull()) throws -> [String:Any] {
        guard let object = try call(operation,input) as? [String:Any] else {throw Failure(message:"Invalid core object")};return object
    }
    static func array(_ operation: String,_ input: Any = NSNull()) throws -> [[String:Any]] {
        guard let array = try call(operation,input) as? [[String:Any]] else {throw Failure(message:"Invalid core array")};return array
    }
    static func string(_ operation: String,_ input: Any = NSNull()) throws -> String {
        guard let string = try call(operation,input) as? String else {throw Failure(message:"Invalid core string")};return string
    }
}

struct Record: Identifiable {
    let raw: [String:Any]
    var id: Int { (raw["id"] as? Int) ?? (raw["studyId"] as? Int) ?? 0 }
    func text(_ key: String,_ fallback: String = "") -> String { raw[key] as? String ?? fallback }
    func number(_ key: String) -> Double { (raw[key] as? NSNumber)?.doubleValue ?? 0 }
}

struct ProfileField: Decodable, Identifiable {
    let key:String
    let label:String
    let type:String
    let options:[Option]?
    var id:String { key }
    struct Option: Decodable, Identifiable { let value:String;let label:String;var id:String{value} }
}
