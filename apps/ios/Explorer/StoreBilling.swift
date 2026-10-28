import Foundation
import Combine
import StoreKit
import UIKit

/// The App Store is the only record of purchases; Monadic DNA keeps none.
/// - Premium is an active, verified subscription in `Transaction.currentEntitlements`.
/// - A report pass is a consumable. Each verified transaction is credited once in the encrypted store,
///   which syncs to the user's other devices, then finished. Generating the report records a use.
@MainActor final class StoreBilling: ObservableObject {
    @Published var products: [Product] = []
    @Published var loading = false
    @Published var message = ""
    @Published private(set) var premium = false
    /// Unused report passes by report type (overview, healthspan, top_traits).
    @Published private(set) var passes: [String:Int] = [:]
    private var updates: Task<Void, Never>?
    /// The encrypted store's handle while unlocked. Purchases that arrive while locked stay unfinished;
    /// StoreKit delivers them again and they are credited after unlock.
    var store: () -> Int? = { nil }
    private var catalog: [[String:Any]] { (try? Core.array("billing_catalog")) ?? [] }
    private var ids: Set<String> { Set(catalog.compactMap { $0["id"] as? String }) }
    private func reportType(_ productID:String) -> String? { catalog.first { $0["id"] as? String == productID }?["reportType"] as? String }
    init() {
        updates = Task { [weak self] in
            for await result in Transaction.updates { await self?.handle(result) }
        }
    }
    deinit { updates?.cancel() }

    /// Re-reads unused passes from the encrypted store.
    func refreshPasses() {
        guard let handle = store(), let value = try? Core.object("store_passes", ["store":handle]) else { passes = [:]; return }
        passes = value.compactMapValues { $0 as? Int }
    }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            products = try await Product.products(for: ids).filter { product in
                if product.id == "explorer_premium_monthly" {
                    return product.type == .autoRenewable && product.subscription?.subscriptionPeriod.unit == .month && product.subscription?.subscriptionPeriod.value == 1
                }
                return product.type == .consumable
            }.sorted { $0.id < $1.id }
            if products.isEmpty { message = "Purchases are not available yet. Please try again later." }
        } catch { message = "Unable to connect to the App Store. Please try again." }
        await current()
    }
    func purchase(_ product: Product) async {
        loading = true; message = ""
        defer { loading = false }
        do {
            switch try await product.purchase() {
            case .success(let result): await handle(result); message = "Purchase complete."
            case .pending: message = "Purchase pending approval. Access appears once the App Store approves it."
            case .userCancelled: message = "Purchase cancelled."
            @unknown default: message = "Purchase is not complete."
            }
        } catch { message = error.localizedDescription }
    }
    /// Credits a verified consumable once, then finishes the transaction. Subscriptions are read from entitlements.
    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result, ids.contains(transaction.productID) else { return }
        if let type = reportType(transaction.productID), transaction.revocationDate == nil {
            guard let handle = store() else { message = "Unlock your saved data to add your report pass."; return }
            do { _ = try Core.call("store_pass_credit", ["store":handle,"transactionId":String(transaction.id),"reportType":type]) }
            catch { message = "Your report pass could not be saved yet. It will be added the next time you unlock."; return }
            refreshPasses()
        }
        await transaction.finish()
        await current()
    }
    /// Refreshes Premium from the App Store; call before a premium check so a renewal or cancellation is seen.
    func current() async {
        for await result in Transaction.unfinished { await handle(result) }
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result, transaction.productType == .autoRenewable, transaction.revocationDate == nil, ids.contains(transaction.productID) { active = true }
        }
        premium = active
        refreshPasses()
    }
    /// Uses one pass for `reportType`. Call only after the report was generated successfully.
    func consumePass(_ reportType:String) {
        guard let handle = store() else { return }
        _ = try? Core.call("store_pass_use", ["store":handle,"reportType":reportType])
        refreshPasses()
    }
    func restore() async {
        loading = true; message = ""
        defer { loading = false }
        do { try await AppStore.sync(); await current(); message = premium || !passes.isEmpty ? "Purchases restored from the App Store." : "No active purchases found for this Apple ID." }
        catch { message = error.localizedDescription }
    }
    func manage() async {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        do { try await AppStore.showManageSubscriptions(in:scene) }
        catch { message = "Unable to open subscription management." }
    }
}
