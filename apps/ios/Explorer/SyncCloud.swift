import Foundation
import CloudKit

/// A stored sync record: its name, revision and (when read) base64 ciphertext.
struct CloudRecord { let record:String; let revision:Int; var ciphertext:String="" }
struct SyncConflict:Error{}

/// Where a user's encrypted sync records live. Always the user's own cloud account (iCloud on iOS);
/// never the Monadic DNA backend. The core encrypts every record before it gets here.
protocol SyncCloud: AnyObject {
    /// Checks the user can sync, for example that they are signed in to iCloud. Called when the user turns sync on.
    func authorize() async throws
    func list() async throws -> [CloudRecord]
    func read(_ records:[String]) async throws -> [CloudRecord]
    /// Writes `record` if the cloud is still at `baseRevision`; returns the new revision or throws `SyncConflict`.
    func write(_ record:String,baseRevision:Int,ciphertext:String) async throws -> Int
    func deleteAll() async throws
}

/// CloudKit's private database in the user's own iCloud account. Data counts against their iCloud storage.
/// Saving with `.ifServerRecordUnchanged` gives a real compare-and-set.
final class CloudKitSyncCloud: SyncCloud {
    private let database=CKContainer.default().privateCloudDatabase
    private static let type="SyncRecord"
    func authorize() async throws {
        let status=try await CKContainer.default().accountStatus()
        guard status == .available else{throw Core.Failure(message:status == .restricted ? "iCloud is restricted on this device, so sync can't be turned on." : "Sign in to iCloud in Settings, with iCloud Drive turned on, to keep your data on a new iPhone.")}
    }
    private func id(_ record:String)->CKRecord.ID{CKRecord.ID(recordName:record)}
    private func fetch(_ names:[String]) async throws -> [String:CKRecord] {
        var out:[String:CKRecord]=[:]
        for (recordID,result) in try await database.records(for:names.map(id)) {
            switch result {
            case .success(let record): out[recordID.recordName]=record
            case .failure(let error as CKError) where error.code == .unknownItem: continue
            case .failure(let error): throw error
            }
        }
        return out
    }
    func list() async throws -> [CloudRecord] {
        try await fetch(Self.names).map{CloudRecord(record:$0.key,revision:$0.value["revision"] as? Int ?? 0)}
    }
    func read(_ records:[String]) async throws -> [CloudRecord] {
        try await fetch(records).compactMap{name,record in
            guard let asset=record["ciphertext"] as? CKAsset,let url=asset.fileURL,let data=try? Data(contentsOf:url) else{return nil}
            return CloudRecord(record:name,revision:record["revision"] as? Int ?? 0,ciphertext:String(decoding:data,as:UTF8.self))
        }
    }
    func write(_ record:String,baseRevision:Int,ciphertext:String) async throws -> Int {
        let existing=try await fetch([record])[record]
        guard (existing?["revision"] as? Int ?? 0)==baseRevision else{throw SyncConflict()}
        let item=existing ?? CKRecord(recordType:Self.type,recordID:id(record))
        // Records can exceed CloudKit's field limit, so the ciphertext travels as an asset.
        let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data(ciphertext.utf8).write(to:file,options:.completeFileProtection)
        defer{try? FileManager.default.removeItem(at:file)}
        item["ciphertext"]=CKAsset(fileURL:file);item["revision"]=baseRevision+1
        do{_=try await database.modifyRecords(saving:[item],deleting:[],savePolicy:.ifServerRecordUnchanged)}
        catch let error as CKError where error.code == .serverRecordChanged{throw SyncConflict()}
        return baseRevision+1
    }
    func deleteAll() async throws {
        _=try await database.modifyRecords(saving:[],deleting:Self.names.map(id))
    }
    /// The records the core syncs; see `RECORDS` in crates/explorer-core/src/sync.rs.
    private static let names=["genotype","results","customization","imported-results","report-passes"]
}
