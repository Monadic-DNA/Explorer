import XCTest
@testable import Explorer

final class CloudKitSyncCloudTests:XCTestCase {
    #if targetEnvironment(simulator)
    func testCloudOperationsFailClearlyInSimulator() async {
        let cloud=CloudKitSyncCloud()
        let message="iCloud sync is unavailable in the iOS simulator. Run the signed app on a device to use iCloud sync."

        do{try await cloud.authorize();XCTFail("Simulator CloudKit authorization should fail")}
        catch let error as Core.Failure{XCTAssertEqual(error.message,message)}
        catch{XCTFail("Unexpected authorization error: \(error)")}

        do{_=try await cloud.list();XCTFail("Simulator CloudKit listing should fail")}
        catch let error as Core.Failure{XCTAssertEqual(error.message,message)}
        catch{XCTFail("Unexpected list error: \(error)")}

        do{_=try await cloud.read(["genotype"]);XCTFail("Simulator CloudKit reads should fail")}
        catch let error as Core.Failure{XCTAssertEqual(error.message,message)}
        catch{XCTFail("Unexpected read error: \(error)")}

        do{_=try await cloud.write("genotype",baseRevision:0,ciphertext:"ciphertext");XCTFail("Simulator CloudKit writes should fail")}
        catch let error as Core.Failure{XCTAssertEqual(error.message,message)}
        catch{XCTFail("Unexpected write error: \(error)")}

        do{try await cloud.deleteAll();XCTFail("Simulator CloudKit deletion should fail")}
        catch let error as Core.Failure{XCTAssertEqual(error.message,message)}
        catch{XCTFail("Unexpected deletion error: \(error)")}
    }
    #endif
}