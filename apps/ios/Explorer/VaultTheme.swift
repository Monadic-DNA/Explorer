import SwiftUI
import UIKit

// Colors and artwork come from the same checked-in sources as Android.
enum VaultStyle {
    static let ink = Color("vault_darkMain")
    static let canvas = Color("vault_offTone")
    static let lavender = Color("vault_purple200")
    static let purpleInk = Color("vault_purple900")
    static func body(_ size: CGFloat = 17) -> Font { .custom("SpaceGrotesk-Light", size: size, relativeTo: .body) }
    static func heading(_ size: CGFloat = 32) -> Font { .custom("SpaceGrotesk-Bold", size: size, relativeTo: .title) }
    static let cardTitle = Font.custom("EBGaramond-Medium", size: 24, relativeTo: .title2)

    static func cardPalette(_ category: String) -> (background: Color, foreground: Color) {
        let name: String
        switch category {
        case "cardiometabolic", "immune", "medication": name = "green"
        case "sleep_energy": name = "yellow"
        case "body_composition": name = "blue"
        default: name = "purple"
        }
        return (Color("vault_" + name + "200"), Color("vault_" + name + "900"))
    }

    static func configure() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(named: "vault_offTone")
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.font: UIFont(name: "SpaceGrotesk-Bold", size: 20) ?? UIFont.preferredFont(forTextStyle: .headline)]
        nav.largeTitleTextAttributes = [.font: UIFont(name: "SpaceGrotesk-Bold", size: 32) ?? UIFont.preferredFont(forTextStyle: .largeTitle)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(named: "vault_offTone")
        let item = tab.stackedLayoutAppearance
        for state in [item.normal, item.selected] {
            state.titleTextAttributes = [.font: UIFont(name: "SpaceGrotesk-Regular", size: 11) ?? UIFont.preferredFont(forTextStyle: .caption2)]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

struct VaultArt: View {
    var name: String
    var body: some View {
        Image("vault_" + name).resizable().scaledToFit()
            .frame(maxWidth: .infinity).frame(height: 120)
            .accessibilityHidden(true)
    }
}

struct VaultHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image("vault_brand_mark").resizable().scaledToFit().frame(height: 64).frame(maxWidth: .infinity).accessibilityHidden(true)
            Image("vault_wordmark").resizable().scaledToFit().frame(height: 36).frame(maxWidth: .infinity).accessibilityLabel("Monadic DNA")
            Text("EXPLORER").font(.custom("SpaceGrotesk-Regular", size: 12, relativeTo: .caption)).tracking(4).frame(maxWidth: .infinity)
            Text("Your DNA. Your discoveries.").font(VaultStyle.heading()).fixedSize(horizontal:false, vertical:true)
            Text("Explore genetic research while your DNA remains private, protected, and in your hands.").font(VaultStyle.body()).fixedSize(horizontal:false, vertical:true)
        }
        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(.white).background(VaultStyle.ink, in: RoundedRectangle(cornerRadius: 32))
    }
}

struct VaultScreenStyle: ViewModifier {
    func body(content: Content) -> some View {
        content.scrollContentBackground(.hidden).background(VaultStyle.canvas)
    }
}
extension View {
    func vaultScreen() -> some View { modifier(VaultScreenStyle()) }
}
