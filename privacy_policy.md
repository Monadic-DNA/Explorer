# Monadic DNA Explorer - Privacy Policy
**Effective Date:** October 21, 2026
**Version:** 3.0

---

## 1. Overview

Monadic DNA Explorer is operated by **Recherché Inc.** (“we,” “us,” or “our”).  
We are committed to protecting your privacy and limiting data collection to the minimum necessary to operate this research tool.

We do not:
- Store plaintext genetic data, analysis results or customization on our servers (optional sync stores encrypted copies),
- Sell, rent, or share your genetic data with anyone, or
- Use your genetic data for marketing, profiling, or research.

You can use most of the Service without signing in. Signing in is needed for paid features and optional encrypted multi-device sync, as described below.

---

## 2. Data We Process

### 2.1 Genetic Data
- Your genotype file is read and processed **locally** in your browser or native app. Raw files are not uploaded to our servers.
- Web keeps imported DNA/results in memory unless you choose to save them. Android and iOS save genotype data, study matches and customization automatically in an encrypted on-device vault after device authentication.
- Optional native sync uploads encrypted vault data only. We do not receive its decryption key, recovery passphrase or plaintext genetic data.

### 2.2 Saving, Recovery and Optional Encrypted Sync
Web's **Save** controls encrypt data using AES-256-GCM and a PBKDF2-derived passphrase key in IndexedDB. Native apps encrypt data using a random data key wrapped by a device-authenticated Secure Enclave key on iOS or Android Keystore key (StrongBox preferred) on Android. Android hardware backing depends on the device. Local native data is excluded from operating-system backups. Device wrapping keys never sync.

Portable v2 backups and native encrypted sync protect the shared data key with a separate recovery passphrase using Argon2id (64 MiB, three passes). Another device recovers the data key using that passphrase and protects it using its own device key. We cannot recover a forgotten recovery passphrase or replace a lost hardware key. Use a long, unique passphrase and keep a safe recovery backup.

Sync is **opt-in** and requires account sign-in. Our database stores encrypted DNA/results/customization, an encrypted recovery key, and metadata including your wallet address, vault identity, revision, size and update time. This metadata links your account to a ciphertext archive. We cannot read its encrypted contents. Conflicting device edits require explicit resolution; data is not automatically merged. Automatic cloud sync is currently available on native apps; Web can exchange encrypted portable files.

You can lock or delete local data independently of cloud data. Use **Delete encrypted cloud copy** in the native vault controls to delete the live cloud copy. Other device copies and exported files remain until separately deleted. Disabled sync does not delete cloud data. Server backups may retain encrypted copies under the hosting operator's backup retention policy; this feature does not provide immediate cryptographic revocation of previously authorized devices or backups.

You may also export your results to a file on your device. Exported files are not encrypted. They are stored entirely under your control, and you are responsible for their secure handling. We recommend:
- Storing exported files on encrypted storage
- Deleting exported files when no longer needed
- Avoiding upload to cloud services or unsecured locations

### 2.3 Personalization Data
You may optionally enter details such as age, sex at birth, ancestry, health conditions, family history, medications, smoking, alcohol use, and diet to make AI interpretations more relevant. This information is encrypted on your device and, if you enable sync, included in the encrypted cloud archive described in Section 2.2. When you use AI features, it is included in the request sent to the AI provider you select (Section 4.1).

### 2.4 Account and Payment Data
Signing in is optional and required for paid features or encrypted multi-device sync.
- **Sign-in:** Sign-in is provided by **Dynamic** (dynamic.xyz). Depending on the method you choose, Dynamic processes your email address or crypto wallet address. We use your wallet address to identify your purchases.
- **Card payments:** Card payments are processed by **Stripe**. We never see or store your full card details. We store your wallet address in your Stripe customer record so we can confirm your subscription or report purchases.
- **Stablecoin payments:** Stablecoin payments are made on public blockchains. Transactions on a public blockchain, including your wallet address and payment amount, are visible to anyone and cannot be deleted. We check payment status using a blockchain data provider (Alchemy).
- **X account connection (optional):** If you connect your X (Twitter) account through **ReplyCorp** to receive a discount, we store your X user ID and handle in your Stripe customer record and in your browser. When you make a purchase, we report the purchase and its amount to ReplyCorp so it can reward the X users whose posts referred you.

Payment records do not contain plaintext genetic data. Optional encrypted sync associates a ciphertext archive with your account.

### 2.5 Search and Chat Text
- Text you type into study search is sent to our server to find matching studies. Search text and its computed embedding may be cached in our database to speed up later searches. The cache is not linked to you or your account.
- When you use DNA Chat, your question is also sent to our server to find relevant studies. Your genetic data and results are not sent to our server.
- Search and question text is not written to our server logs.

### 2.6 Analytics and Advertising Data
We use **Google Analytics** to understand overall usage patterns and improve the Service. Analytics data includes:
- Browser and OS type
- Device category
- Approximate location (city-level)
- Pages visited and feature usage, such as when a file is uploaded or a report is generated, with counts but never your genotype, matched variants, or results

We also use advertising measurement tools to understand which of our ads lead people to the Service:
- **Google Ads** conversion tracking
- The **Reddit** and **X (Twitter)** advertising pixels, along with their server-side conversion APIs. These receive page visits and events such as sign-ups and purchases, along with your IP address and browser user agent, which those platforms use to match events to ad clicks.

Google Analytics is configured with IP anonymization. You can limit analytics and advertising tracking using your browser's privacy settings, a content blocker, or the [Google Analytics Opt-Out Add-on](https://tools.google.com/dlpage/gaoptout).

We never send genetic data, analysis results, or personalization data to analytics or advertising providers.

### 2.7 Data Stored in Your Browser
Besides the optional encrypted vault (Section 2.2), the Service stores some non-genetic data in your browser's local storage: your theme and AI provider settings, onboarding and terms acceptance flags, a cache of the public GWAS Catalog, promo and subscription status, and, if you connected X, your X user ID and handle. If you enter an API key for an AI provider, it is also stored in your browser.


---

## 3. Purpose of Data Processing

We use the data described above only to:
- Operate and improve the Service,
- Match your variants with published research,
- Process payments and confirm access to paid features,
- Measure usage and the effectiveness of our advertising in aggregate.

We do **not** use your genetic data for:
- Marketing or profiling,
- External research, or
- Commercial resale.

---

## 4. Third-Party Services

### 4.1 AI Providers
AI features (study interpretation, DNA Chat, and reports) send the relevant analysis results, your question, and any personalization details to the AI provider you select:
- **Nillion nilAI (default):** Requests are processed inside **Trusted Execution Environments (TEEs)**. Recherché Inc. never accesses the plaintext content and receives no retained output.
- **Ollama:** Requests are sent to the Ollama server address you configure. If that server is not on your own device, its operator can see the content.
- **Hugging Face:** Requests are sent to Hugging Face using your own API key and are handled under Hugging Face's terms and privacy policy. They are not processed in a TEE.

We are **not responsible** for data handling, breaches, or malfeasance within AI providers' systems.

### 4.2 Other Services
- **Dynamic** provides sign-in. See Dynamic's privacy policy.
- **Stripe** processes card payments. See [Stripe's Privacy Policy](https://stripe.com/privacy).
- **Alchemy** provides blockchain data for checking stablecoin payments.
- **ReplyCorp** receives purchase information if you connect your X account (Section 2.4).
- **Google Analytics and Google Ads** operate under Google's [Privacy Policy](https://policies.google.com/privacy).
- **Reddit** and **X** advertising tools operate under those companies' privacy policies.
- **Europe PMC** is queried for public study abstracts. These requests contain only public study identifiers.

---

## 5. Data Retention

- Web data stays in memory unless saved. Native genotype data, study results and customization persist encrypted until deleted (Section 2.2).
- Saved data stays encrypted in your browser until you delete it or clear your browser's site data.
- Optional cloud copies remain encrypted in the database until you delete them; hosting backups may retain ciphertext under their configured retention. Plaintext genetic data and results are not logged or stored in our databases.
- Exported files are stored entirely on your device under your control; we have no access to or responsibility for them.
- Account and payment records are kept by Dynamic and Stripe for as long as needed to provide paid features and meet legal and tax obligations. Blockchain transactions are permanent.
- Cached search text is kept until it is removed during routine cache cleanup.
- Analytics data is retained by Google Analytics under its configured retention limits (typically 2 to 14 months). Advertising platforms retain data under their own policies.

---

## 6. Cookies and Tracking

We use:
- Essential cookies and browser storage for app functionality and sign-in.
- Analytics cookies for usage statistics.
- Advertising pixels and cookies from Google, Reddit, and X to measure ad performance.

You may disable cookies or block trackers in your browser settings. Core features remain available, although sign-in and payments may require cookies.

---

## 7. Security

We implement industry-standard security practices, including:
- All communications use **TLS (HTTPS)**.
- Genetic analysis runs locally. Saved data is encrypted using browser passphrase protection or native device key protection; recovery/sync uses a separate recovery passphrase.
- Regular code reviews and dependency scanning for vulnerabilities.
- Minimal data collection to reduce exposure.

However, no system is perfectly secure.
We are **not liable** for third-party incidents (e.g., AI providers, sign-in or payment providers, analytics providers, or hosting provider breaches).

---

## 8. Breach Notification and User Communication

We do not keep contact details in our own systems, so we generally cannot send individualized breach notices, policy updates, or identity verification requests.

In the event of a security incident that may affect user data, we commit to making **reasonable efforts** to notify users through:
- **Prominent in-app banner** displayed on the application homepage
- **Public announcement** on our official social media channels (Twitter/X, LinkedIn)
- **Notice posted** in our public GitHub repository

We encourage you to:
- Review this Privacy Policy periodically for updates
- Follow our official social media accounts for important announcements
- Check the application homepage for any security notices

---

## 9. Research Ethics

Monadic DNA Explorer does not perform independent research with user data.  
If future aggregated research use is proposed, we will implement **explicit opt-in consent** before participation.

---

## 10. International Processing

Our servers are located in the **United States**. Third-party providers described in Section 4 may process data in other countries.  
By using the Service, you consent to such processing under U.S. law.

---

## 11. Children’s Privacy

This Service is intended for individuals **18 years or older**.  
We do not knowingly process data from minors.

---

## 12. Policy Updates

We may update this policy periodically.  
All changes will be posted publicly with a new **Effective Date**.  
Because we do not keep contact details, we cannot send direct notices.  
Continued use constitutes acceptance of updated terms.

---

## 13. Contact

**Recherché Inc.**  
Attn: Legal Department  
456 Johnson Ave, Unit 216
Brooklyn, NY 11237

Email: support@monadicdna.com

---

## 14. Acknowledgment

By using Monadic DNA Explorer, you acknowledge that:
- Genetic data is processed locally. Optional native sync stores an encrypted copy, never its plaintext or decryption key.
- If you choose to save data on your device, you are responsible for your passphrase and your device's security.
- We collect usage analytics and advertising measurement data, but never your genetic data or results.
- Paid features involve sign-in and payment providers who process your account and payment data.
- We are not responsible for third-party systems such as AI providers, Dynamic, Stripe, Google, Reddit, or X.
