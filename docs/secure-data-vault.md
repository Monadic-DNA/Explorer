# Secure data persistence and encrypted sync

Android and iOS automatically persist imported genotype data, saved study results and profile customization in an atomic, authenticated encrypted file. Unlock requires device authentication and a device passcode. Lock/background clears the decrypted Rust session, profile and visible results; Android blocks screenshots, and iOS covers the app while inactive. Save failures are displayed. Customization saves after a short debounce; terminating an app before a pending save completes can lose the latest edit.

## Keys and device storage

Each vault has a cryptographically random 256-bit data encryption key (DEK). The shared Rust core encrypts compressed state with AES-256-GCM, authenticating the format, vault UUID and revision. A domain-separated HMAC-derived key encrypts the genotype blob, so changing results/profile does not require encrypting the genome again. State authenticates the genotype ciphertext digest. The full local record and portable archive have a keyed MAC, including recovery and sync metadata.

- **iOS:** a permanent, non-exportable P-256 Secure Enclave private key wraps the DEK using Apple ECIES. Its access control requires user presence and `WhenPasscodeSetThisDeviceOnly`. No simulator/software fallback exists in production. The ciphertext file uses complete file protection and is excluded from backups.
- **Android:** a non-exportable, authentication-required AES-256 Android Keystore key wraps the DEK. StrongBox is preferred, followed by the device's normal Keystore implementation. The app reports the actual hardware/software protection level; hardware backing cannot be guaranteed on every Android device. Authentication permits a 30-second Keystore operation window, while app unlock always requests authentication. The ciphertext file is in `noBackupFilesDir`; app backups are disabled.
- The DEK must enter app memory while data is unlocked. It is wiped on lock where practical; hardware wrapping keys are never exported. Runtime/OS copies and a compromised unlocked device cannot be made inaccessible by application encryption.
- Provider credentials/account tokens remain in the existing Keychain/Keystore credential storage. They are **not** included in data sync. Generated chat/report text remains session-only; the persisted results are saved study matches.

Removing a passcode, losing a device key or reinstalling can make the local copy unrecoverable. Export a recovery backup or enable encrypted sync before losing access. Uninstalling does not promise to delete every cloud/exported copy; explicit cloud deletion is available separately.

## Recovery and cross-platform transfer

Portable v2 archives contain encrypted data and the DEK encrypted under a recovery passphrase using Argon2id (64 MiB, 3 passes, one lane), a fresh 16-byte salt, and AES-256-GCM. Use a long, unique passphrase (minimum 12 characters); store it in a password manager. There is no server password reset for encrypted data. The server could attempt offline guesses, so account 2FA does not replace a strong recovery passphrase.

Web, Android and iOS use the same Rust format and can import/export v2 DNA, results and customization. Legacy v1 PBKDF2 portable files remain readable. Web imports initially restore memory; existing browser save controls persist those sections in the encrypted IndexedDB vault. Web vault protection is passphrase/WebCrypto based and does not promise Secure Enclave protection. **Automatic cloud sync is currently implemented in the native apps; Web interoperability uses encrypted portable files.**

Hardware keys intentionally remain on their originating devices. Another device uses the recovery passphrase to decrypt the shared DEK, then wraps it with its own hardware key. Syncing hardware private keys would defeat this boundary.

## Opt-in native sync

Sign in to the same Explorer account, unlock the local vault, and enable encrypted sync with a recovery passphrase. On another device, sign in and choose **Restore cloud copy** with that passphrase. This explicitly replaces local data. Sync happens after local saves, at unlock, and with **Sync now** while the app is open; background synchronization is not promised.

The authenticated backend stores one ciphertext archive per account. Dynamic JWT wallet ownership is required. It receives ciphertext, encrypted recovery material and metadata (account, vault ID, size, revision and update time), never the DEK, passphrase, plaintext genome or profile. Catalog matching remains local. User-consented LLM requests continue to send selected results/profile to the chosen provider independently of sync.

Compare-and-swap revisions reject concurrent uploads and stale deletes. Unchanged genotype ciphertext is omitted in transfers. A cloud update never silently replaces unsaved/local conflicting changes. Back up local changes, then explicitly restore the cloud copy to resolve a conflict. This release uses whole-state replacement, not automatic field/result merging. Devices detect cloud deletion; they do not silently recreate it from a stale revision. A server can still deny availability or replay a previously valid archive to a new device; there is no independent transparency log.

Disabling sync affects this device only. Deleting the cloud copy retains other device copies and exported backups. Changing recovery protection is not cryptographic revocation of devices that already possess the DEK; device revocation/data-key rotation is not yet implemented.

## Deployment

1. Apply `npm run vault:migrate` against the intended `POSTGRES_DB` database (migration `002-encrypted-vault-sync.sql`).
2. Configure existing Dynamic authentication and validated database TLS.
3. Set `VAULT_SYNC_ENABLED=true` on the backend. It defaults off and reports unavailable until configured.
4. Apply normal TLS ingress, authenticated request limits and account deletion/retention policy to the ciphertext endpoint `/api/vault-sync` (40 MiB maximum request).

No production database or deployment is changed by merely merging this implementation.

## Verification

Core/WASM tests include independent Node Argon2id/AES-GCM/HMAC decoding, wrong passwords/keys, changed headers, substituted genotype references, metadata authentication and customization restoration. Postgres tests exercise concurrent create/update, delta reconstruction, account isolation and stale deletion/recreation rejection. Native simulator tests use an explicitly injected test-only key protector and real Rust encryption/files to exercise restart, recovery, genotype reuse and tampering. These tests do not establish physical-device Secure Enclave/StrongBox behavior. Before release, test biometric/PIN unlock, cancel, background lock, reboot, passcode removal and lost-key recovery on physical iOS/Android devices, including StrongBox and TEE Android models.
