import XCTest
import CryptoKit
@testable import Explorer

// Explicit simulator test dependency; production never substitutes for Secure Enclave.
final class TestVaultProtector:VaultKeyProtector {
    let key=SymmetricKey(size:.bits256)
    var description:String{"Explicit test protector"}
    func authenticate() async throws{}
    func wrap(_ data:Data,id:String)throws->[String:Any]{
        ["data":try AES.GCM.seal(data,using:key,authenticating:Data(id.utf8)).combined!.base64EncodedString()]
    }
    func unwrap(_ value:[String:Any],id:String)throws->Data{
        try AES.GCM.open(AES.GCM.SealedBox(combined:Data(base64Encoded:value["data"] as! String)!),using:key,authenticating:Data(id.utf8))
    }
    func reset(){}
    func delete()throws{}
}
final class SecureDataVaultTests:XCTestCase {
    func testRestartRecoveryTamperAndGenotypeReuse() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let second=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let protector=TestVaultProtector(),vault=SecureDataVault(protector:TestVaultProtector(),directory:second)
        let local=SecureDataVault(protector:protector,directory:root)
        let s=try Core.call("session_create") as! Int,t=try Core.call("session_create") as! Int
        defer{_ = try? Core.call("session_close",["session":s]);_ = try? Core.call("session_close",["session":t]);try? FileManager.default.removeItem(at:root);try? FileManager.default.removeItem(at:second)}
        _=try await local.unlock(s)
        _=try Core.call("session_import",["session":s,"content":"# 23andMe\nrs1 1 100 AG","fileName":"private.txt"])
        try await local.save(s,["fields":["age":"42"],"context":"private context"])
        try await local.enableSync("0x"+String(repeating:"a",count:40),"unique recovery passphrase")
        let first=try await local.archive(),initial=first["envelope"] as! [String:Any]
        try await local.save(s,["fields":["age":"43"],"context":"private context"])
        let backup=try await local.backup("unique recovery passphrase"),next=backup["envelope"] as! [String:Any]
        XCTAssertEqual(initial["genotypeDigest"] as? String,next["genotypeDigest"] as? String)
        let raw=try String(contentsOf:root.appendingPathComponent("vault-v2.json"),encoding:.utf8)
        XCTAssertFalse(raw.contains("private context"));XCTAssertFalse(raw.contains("private.txt"));XCTAssertFalse(raw.contains("rs1"))
        await local.lock()
        let restarted=SecureDataVault(protector:protector,directory:root)
        let customization=try await restarted.unlock(t)
        XCTAssertEqual((customization["fields"] as? [String:String])?["age"],"43")
        XCTAssertEqual(try Core.object("session_metadata",["session":t])["count"] as? Int,1)
        do{_=try await vault.restore(t,backup,"incorrect recovery password");XCTFail("Wrong password accepted")}catch{}
        let absent=await vault.exists;XCTAssertFalse(absent)
        let restored=try await vault.restore(t,backup,"unique recovery passphrase")
        XCTAssertEqual((restored["fields"] as? [String:String])?["age"],"43")
        await restarted.lock()
        var changed=try JSONSerialization.jsonObject(with:Data(raw.utf8)) as! [String:Any]
        changed["sync"]=["enabled":true,"revision":999]
        try JSONSerialization.data(withJSONObject:changed).write(to:root.appendingPathComponent("vault-v2.json"))
        do{_=try await restarted.unlock(t);XCTFail("Tampered record accepted")}catch{}
        await vault.lock()
    }
}
