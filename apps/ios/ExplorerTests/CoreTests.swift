import XCTest
@testable import Explorer

final class CoreTests:XCTestCase{
    func testNativeParserAndRisk()throws{
        let parsed=try Core.object("parse_genotype",["content":"# 23andMe\nrs1 1 100 AG"])
        XCTAssertEqual(parsed["validVariants"] as? Int,1)
        let result=try Core.object("risk_score",["genotype":"AA","riskAllele":"rs1-A","effectSize":"1.5","effectType":"OR"])
        XCTAssertEqual(result["score"] as? Double,2.25)
    }
    func testAuthStateIsBoundToEnvelope()throws{
        let pair=try Core.object("auth_keypair",["entropy":DeviceStore.entropy(32)])
        var envelope=try Core.object("auth_seal",["publicKey":pair["publicKey"]!,"entropy":DeviceStore.entropy(32),"iv":DeviceStore.entropy(12),"state":"expected","plaintext":"test-only"])
        envelope["privateKey"]=pair["privateKey"];envelope["state"]="expected"
        XCTAssertEqual(try Core.string("auth_open",envelope),"test-only")
        envelope["state"]="wrong"
        XCTAssertThrowsError(try Core.call("auth_open",envelope))
    }
}
