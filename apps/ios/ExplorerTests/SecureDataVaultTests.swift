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
/// An in-memory stand-in for iCloud Keychain, shared by simulated devices.
final class TestSyncKeys:SyncKeyStore {
    var key:String?
    func get()throws->String?{key}
    func put(_ key:String)throws{self.key=key}
    func delete()throws{key=nil}
}
final class SecureDataVaultTests:XCTestCase {
    func testStorePersistsIsEncryptedRejectsOtherKeysAndDeletes() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        let protector=TestVaultProtector()
        let vault=SecureDataVault(protector:protector,directory:root)
        let missing=await vault.exists;XCTAssertFalse(missing)
        var handle=try XCTUnwrap(try await vault.unlock()["handle"] as? Int)
        _=try Core.importToStore(handle,Data("# 23andMe\nrs1 1 100 AG\n".utf8),"private.txt")
        _=try Core.call("store_set_customization",["store":handle,"customization":["fields":["age":"42"],"context":"private context"]])
        await vault.lock(handle)
        // Nothing private is readable on disk.
        let raw=String(decoding:try Data(contentsOf:root.appendingPathComponent("explorer.db")),as:UTF8.self)
        for secret in ["private context","private.txt","SQLite format"]{XCTAssertFalse(raw.contains(secret),secret)}
        // A restarted app opens the same data with the same device key.
        let restarted=SecureDataVault(protector:protector,directory:root)
        handle=try XCTUnwrap(try await restarted.unlock()["handle"] as? Int)
        XCTAssertEqual(try Core.object("store_metadata",["store":handle])["count"] as? Int,1)
        XCTAssertEqual((try Core.object("store_customization",["store":handle])["fields"] as? [String:String])?["age"],"42")
        await restarted.lock(handle)
        // Another device's key cannot open it.
        do{_=try await SecureDataVault(protector:TestVaultProtector(),directory:root).unlock();XCTFail("Another device key opened the store")}catch{}
        try await restarted.delete()
        let deleted=await restarted.exists;XCTAssertFalse(deleted)
    }
}
