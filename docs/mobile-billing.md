# Apple and Google Play billing

Explorer mobile uses StoreKit 2 (iOS 17+) and Google Play Billing 8 (Android). Stripe/card and stablecoin checkout remain on Web. The mobile account screens say **“Stablecoin payments are available only on Web”**, and provide no external payment link. The store subscription-management actions open Apple's subscription sheet or Google's subscription management page.

## Products to create

Both stores use the IDs in `shared/billing-catalog.json`; native clients read the same catalog through `explorer-core`.

| Product ID | Store type | Entitlement |
| --- | --- | --- |
| `explorer_premium_monthly` | Auto-renewable monthly subscription | Premium reports and DNA chat while active |
| `explorer_report_overview` | Consumable / consumable one-time product | One Overview report run |
| `explorer_report_healthspan` | Consumable / consumable one-time product | One Healthspan report run |
| `explorer_report_top_traits` | Consumable / consumable one-time product | One Top traits report run |

Create these for bundle/package **`com.monadicdna.explorer`**. Set the subscription period to one month. On Play, create one active monthly auto-renewing base plan without an introductory offer; the client selects its base-plan offer. Disable multi-quantity purchases for report products. Set store prices and localized product descriptions in each console: prices displayed in mobile come from the store, not Web's USD price constants. Complete agreements, tax/banking details, availability, app signing and the store's required subscription disclosures/review information. Generic Web promo-code unlocking is not exposed in mobile; promotions should use store-managed offers.

## Backend configuration

Apply `POSTGRES_DB=… npm run billing:migrate` to the intended database before enabling billing. The migration adds only account/purchase metadata tables; no DNA is uploaded. Remote database TLS certificates must validate; supply `DATABASE_CA_CERT` for a private project CA.

Configure these **server-only** variables through the deployment's secret manager; never embed them in mobile or commit private keys:

- `MOBILE_BILLING_ENABLED=true` after configuration and migration.
- `MOBILE_BILLING_TOKEN_KEY`: base64 of 32 cryptographically random bytes. This AES-GCM key encrypts purchase proofs in the database, authenticated to the account ID. Keep it backed up securely; rotating it requires re-encrypting existing proofs.
- `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`: App Store Connect In-App Purchase API credentials (PEM `.p8` key; literal `\n` or actual newlines accepted).
- `APPLE_APP_ID`: Apple's numeric application ID, required in production.
- `APPLE_STORE_ENVIRONMENT`: `Production` (default) or explicitly `Sandbox` for an isolated test deployment. Local Xcode StoreKit configuration transactions are not accepted by the production/Sandbox server verifier.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: Android Publisher service-account credential JSON, granted the required purchase/subscription permissions in Play Console for this package.
- `GOOGLE_PLAY_ALLOW_TEST_PURCHASES=true` **only** on an isolated test deployment/database. Production rejects Play test purchases by default.
- `GOOGLE_RTDN_AUDIENCE`: exact audience configured for the authenticated Pub/Sub push subscription, normally the Google notification endpoint URL.
- `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`: exact Google service-account email authorized to send that Pub/Sub push.

Without configuration, buying fails before the native purchase sheet opens. No fallback to external checkout is offered. Store verification and payment-status failures do not grant access. Keep sandbox and production databases, token-encryption keys and webhook configuration separate; never enable test receipts in production.

## Ownership, verification and recovery

A signed-in user proves wallet ownership using the existing verified Dynamic JWT. `/api/mobile-billing/account` returns a stable random account UUID, used as StoreKit's `appAccountToken` and Play's obfuscated account ID. Receipts cannot be claimed for a different Explorer account, even if their transaction ID/token is copied.

`/api/mobile-billing/verify` fetches purchase state from Apple's authenticated Server API or Google's Android Publisher API. Apple signed payloads are verified with the official App Store Server Library and Apple's public G3 root, with revocation checks enabled. Verification checks the environment, bundle/package, allowlisted product, product type and account binding. Google pending/on-hold/paused/refunded purchases do not grant access. Cancelled subscriptions retain access until their verified paid expiry; configured store grace periods remain supported.

The backend durably upserts a unique store/purchase record before acknowledging/consuming a Play purchase. StoreKit finishes only after that server confirmation. Retries cannot add credits twice. Finished consumable purchases are restored through the Explorer account ledger, rather than relying on StoreKit/Play to return consumed purchases. Spending a mobile report credit uses a PostgreSQL row lock and atomic update, so two devices cannot spend one credit twice.

The existing `/api/check-subscription` and `/api/report-access` endpoints include verified store entitlements for authenticated account requests on Web and mobile. Stripe and blockchain access checks remain available. Access checks revalidate current store state; no premium grant is based solely on client flags or a cached receipt. An unavailable store verification fails closed. Old tokens that the store definitively stops serving are retired; network failures do not retire or grant purchases.

## Store notifications

Configure App Store Server Notifications V2 (including the Sandbox URL on the isolated test deployment) to:

`https://<backend>/api/mobile-billing/apple-notifications`

The endpoint verifies Apple's signed notification and its signed transaction, then fetches current subscription/purchase state again. Refunds, revocations and renewals update the existing ledger entry.

Configure Play Real-time Developer Notifications to a Pub/Sub topic. Give Google's documented Play notification publisher permission to publish to that topic. Create an **authenticated** push subscription targeting:

`https://<backend>/api/mobile-billing/google-notifications`

Set its OIDC service account and audience to the variables above, and grant the Pub/Sub service agent the required token-creation permission. The endpoint verifies the Google-signed identity token, exact audience, verified email, package and purchase/account binding. Subscription, one-time-product and voided-purchase notifications fetch current store state before updating the ledger. One-time products are consumed and subscriptions acknowledged only after durable recording, including approvals while the app is closed. Notifications and client retries are idempotent. A transient failure returns an error so store/Pub/Sub retries can recover.

## Validation before release

Run `npm run test:billing`. For the database concurrency tests, use an explicitly selected local test database, run the migration, and set `BILLING_DB_TEST=true`. CI creates a disposable PostgreSQL service and runs these tests, plus the existing Web/Rust/native checks.

Automated tests cover invalid/forged Apple assertions, cross-account/SKU/environment mismatches, production rejection of test purchases, pending/refunded/expired states, cancelled subscription expiry, encrypted proof storage, replay and concurrent report consumption.

**Store setup is not yet completed.** Live Sandbox/Play purchase flows require the console products and credentials above. Before submission, install a signed build through Apple's Sandbox/TestFlight and Play's internal testing track and verify actual purchase, cancellation, Ask to Buy/pending approval, restore on a second device, renewal, refund/revocation, report consumption and notification redelivery. Confirm subscription disclosures and product types against the final store listings. No real payment or store purchase is made by the repository tests.
