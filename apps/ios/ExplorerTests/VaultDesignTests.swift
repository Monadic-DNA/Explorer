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
}
