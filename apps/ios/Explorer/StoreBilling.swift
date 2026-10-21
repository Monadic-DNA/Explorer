import Foundation
import StoreKit
import UIKit

@MainActor final class StoreBilling: ObservableObject {
    @Published var products: [Product] = []
    @Published var loading = false
    @Published var message = ""
    private weak var store: ExplorerStore?
    private var updates: Task<Void, Never>?
    private var submitting: Set<UInt64> = []
    private var ids: Set<String> {
        Set(((try? Core.array("billing_catalog")) ?? []).compactMap { $0["id"] as? String })
    }
    func attach(_ store: ExplorerStore) {
        self.store = store
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                do { try await self?.deliver(result) }
                catch { self?.message = "Purchase verification is pending. Sign in to the original Explorer account and restore purchases to retry." }
            }
        }
    }
    deinit { updates?.cancel() }
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
    }
    func purchase(_ product: Product) async {
        guard let store, !store.wallet.isEmpty else { message = "Sign in before purchasing."; return }
        loading = true; message = ""
        defer { loading = false }
        do {
            let response = try await store.api("/api/mobile-billing/account", ["walletAddress":store.wallet,"store":"apple"])
            guard let id = response["accountId"] as? String, let token = UUID(uuidString:id) else { throw Core.Failure(message:"Unable to prepare purchase") }
            switch try await product.purchase(options:[.appAccountToken(token)]) {
            case .success(let result): try await deliver(result)
            case .pending: message = "Purchase pending approval. Access will appear after approval and verification."
            case .userCancelled: message = "Purchase cancelled."
            @unknown default: message = "Purchase is not complete."
            }
        } catch { message = error.localizedDescription }
    }
    private func deliver(_ result: VerificationResult<Transaction>) async throws {
        guard case .verified(let transaction) = result else { throw Core.Failure(message:"The App Store could not verify this purchase") }
        guard ids.contains(transaction.productID), !submitting.contains(transaction.id) else { return }
        guard let store, !store.wallet.isEmpty else { throw Core.Failure(message:"Sign in to restore this purchase") }
        submitting.insert(transaction.id)
        defer { submitting.remove(transaction.id) }
        let response = try await store.api("/api/mobile-billing/verify", ["walletAddress":store.wallet,"store":"apple","productId":transaction.productID,"proof":String(transaction.id)])
        guard response["accepted"] as? Bool == true else { throw Core.Failure(message:"Purchase verification has not completed") }
        // Only finish after the backend durably records the purchase. Unfinished transactions retry on restore/relaunch.
        await transaction.finish()
        store.refreshSubscription()
        message = "Purchase verified. Your account access has been updated."
    }
    func restore() async {
        guard let store, !store.wallet.isEmpty else { message = "Sign in to restore purchases."; return }
        loading = true; message = ""
        defer { loading = false }
        do {
            try await AppStore.sync()
            try await recover()
            store.refreshSubscription()
            message = "Purchases restored. Remaining report passes are attached to your Explorer account."
        } catch { message = error.localizedDescription }
    }
    func recover() async throws {
        guard let store, !store.wallet.isEmpty else { return }
        for await result in Transaction.unfinished { try await deliver(result) }
        for await result in Transaction.currentEntitlements { try await deliver(result) }
    }
    func manage() async {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        do { try await AppStore.showManageSubscriptions(in:scene) }
        catch { message = "Unable to open subscription management." }
    }
}
