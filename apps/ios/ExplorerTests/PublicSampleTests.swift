import XCTest
@testable import Explorer

final class PublicSampleTests:XCTestCase {
    @MainActor func testAppFileImportAndPublishedResults() async throws {
        guard let folder=Bundle(for:Self.self).url(forResource:"TestData",withExtension:nil) else{throw XCTSkip("Prepare public sample resources first")}
        let expected=try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("expected.json"))) as? [String:Any])
        let wanted=try XCTUnwrap((expected["results"] as? [[String:Any]])?.first)
        let studies=try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("studies.json"))) as? [[String:Any]])
        let study=try XCTUnwrap(studies.first{($0["id"] as? Int)==(wanted["studyId"] as? Int)})
        let store=ExplorerStore()
        defer{store.clear();_ = try? Core.call("session_close",["session":store.session])}
        store.acceptedDisclaimer=true
        store.importDNA(folder.appendingPathComponent("23andme-public.txt"))
        let deadline=Date().addingTimeInterval(180)
        while store.busy && Date()<deadline{try await Task.sleep(nanoseconds:50_000_000)}
        XCTAssertNil(store.error)
        XCTAssertEqual(store.variantCount,expected["parsedVariants"] as? Int)
        store.analyze(Record(raw:study))
        while store.busy && Date()<deadline{try await Task.sleep(nanoseconds:50_000_000)}
        XCTAssertNil(store.error)
        let result=try XCTUnwrap(store.results.first)
        XCTAssertEqual(result.text("userGenotype"),wanted["userGenotype"] as? String)
        XCTAssertEqual(result.number("riskScore"),try XCTUnwrap(wanted["riskScore"] as? Double),accuracy:1e-12)
    }
    func testFullPublic23andMeSample() throws {
        guard let folder=Bundle(for:Self.self).url(forResource:"TestData",withExtension:nil) else{throw XCTSkip("Run python scripts/prepare-public-sample.py before generating the Xcode project")}
        let expected=try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("expected.json"))) as? [String:Any])
        let studies=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("studies.json")))
        let session=try XCTUnwrap(Core.call("session_create") as? Int)
        defer{_ = try? Core.call("session_close",["session":session])}
        let bytes=try Data(contentsOf:folder.appendingPathComponent("23andme-public.txt"))
        let metadata=try Core.importFile(session,bytes,"23andme-public.txt")
        XCTAssertEqual(metadata["count"] as? Int,expected["parsedVariants"] as? Int)
        let rows=try Core.array("session_analyze",["session":session,"studies":studies,"strict":true,"now":"2026-10-21T00:00:00Z"])
        let wanted=try XCTUnwrap(expected["results"] as? [[String:Any]])
        XCTAssertEqual(rows.count,wanted.count)
        let byId=Dictionary(uniqueKeysWithValues:wanted.map{($0["studyId"] as! Int,$0)})
        for actual in rows {
            let row=try XCTUnwrap(byId[actual["studyId"] as! Int])
            for key in ["matchedSnp","userGenotype","effectType","riskLevel"]{XCTAssertEqual(actual[key] as? String,row[key] as? String)}
            XCTAssertEqual(try XCTUnwrap(actual["riskScore"] as? Double),try XCTUnwrap(row["riskScore"] as? Double),accuracy:1e-12)
        }
        let exported=try Core.string("session_export",["session":session])
        let imported=try Core.object("import_results",["content":exported,"fileName":"results.tsv"])
        XCTAssertEqual((imported["results"] as? [Any])?.count,wanted.count)
    }
}
