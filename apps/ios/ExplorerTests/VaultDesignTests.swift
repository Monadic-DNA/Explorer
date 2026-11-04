import XCTest
import SwiftUI
@testable import Explorer

final class VaultDesignTests: XCTestCase {
    @MainActor func testBundledVaultDesignAndRenderings() throws {
        for name in ["SpaceGrotesk-Light", "SpaceGrotesk-Regular", "SpaceGrotesk-Bold", "EBGaramond-Medium"] {
            XCTAssertNotNil(UIFont(name:name, size:17), "Missing Vault font: \(name)")
        }
        for name in ["brand_mark", "wordmark", "discover", "vault", "star"] {
            XCTAssertNotNil(UIImage(named:"vault_"+name), "Missing Vault artwork: \(name)")
        }
        let renderer = ImageRenderer(content: VaultHero().padding().background(VaultStyle.canvas))
        renderer.proposedSize = ProposedViewSize(width:390, height:nil)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.uiImage)
        let attachment = XCTAttachment(image:image)
        attachment.name = "Vault-branded Explorer home"
        attachment.lifetime = .keepAlways
        add(attachment)
        let result = Record(raw:["studyId":1,"traitName":"Sleep duration", "matchedSnp":"rs123", "userGenotype":"AG", "effectType":"beta", "riskScore":0.12, "riskLevel":"Increased trait"])
        let card = ImageRenderer(content: ResultView(record:result).font(VaultStyle.body()).padding().background(VaultStyle.canvas))
        card.proposedSize = ProposedViewSize(width:390, height:nil)
        card.scale = 2
        let cardAttachment = XCTAttachment(image:try XCTUnwrap(card.uiImage))
        cardAttachment.name = "Vault-styled research result"
        cardAttachment.lifetime = .keepAlways
        add(cardAttachment)
    }

    @MainActor func testReportsAndYouViewsRender() throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:directory)}
        let store=ExplorerStore(dataVault:SecureDataVault(protector:TestVaultProtector(),directory:directory),syncKeys:TestSyncKeys(),cloud:TestSyncCloud())

        let reports=ImageRenderer(content:ReportsView(openChat:{},export:{_,_ in}).environmentObject(store).frame(width:390,height:844))
        reports.scale=2
        let reportsAttachment=XCTAttachment(image:try XCTUnwrap(reports.uiImage))
        reportsAttachment.name="Reports guidance and access"
        reportsAttachment.lifetime = .keepAlways
        add(reportsAttachment)

        let you=ImageRenderer(content:YouView(done:{},vault:{EmptyView()}).environmentObject(store).frame(width:390,height:844))
        you.scale=2
        let youAttachment=XCTAttachment(image:try XCTUnwrap(you.uiImage))
        youAttachment.name="You profile and data layout"
        youAttachment.lifetime = .keepAlways
        add(youAttachment)
    }
}
