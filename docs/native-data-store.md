# Native data store and sync: design proposal

Status: implemented. Scope: the Android and iOS apps and the shared Rust core. The Monadic DNA backend stores no user data, customer or purchase records; sync uses each user's own iCloud or Google Drive. Cross-platform sync is a later step. The web vault (`lib/secure-vault.ts`, deployed from `main` through release tags) is unchanged. None of this branch's v2 envelope, cloud sync or portable vault code is deployed, so formats can change freely and no migration is needed.

## Problem

Native apps keep the whole decrypted session in memory and persist it as one encrypted, gzip-compressed envelope (`vault-v2.json`). Measured with the public 23andMe sample (929,696 variants, 86,859 matches against the bundled catalog):

- Live session in the Rust core: about 340 MB (genotypes 123 MB, results 216 MB).
- Unlock decrypts and parses the entire envelope: 8 s on a 2 GB Android emulator.
- Every save re-serializes, compresses and re-encrypts all genotypes and results, even after a one-field personalization edit.
- Sync uploads that whole envelope, and any concurrent change makes the user choose one entire copy over the other.

## Local store

The Rust core owns one encrypted SQLite database per device, using SQLCipher (`rusqlite` with `bundled-sqlcipher`). Android and iOS share the implementation. SQLCipher encrypts every page, including indexes, so sorting and filtering by trait or effect does not expose genetic information on disk.

Builds: iOS uses Apple's CommonCrypto, so it needs no extra dependency. Android uses vendored OpenSSL built with the NDK (`bundled-sqlcipher-vendored-openssl`), adding about 2 to 3 MB per ABI; this size cost is accepted. A short spike confirms the Android cross-build first.

### Location and platform protection

| | Android | iOS |
|---|---|---|
| Database | `noBackupFilesDir/protected-data/explorer.db` | `Application Support/protected-data/explorer.db` |
| Journal files | `-wal` and `-shm` beside it; WAL pages are SQLCipher-encrypted and `-shm` holds no data | Same |
| At rest | Credential-encrypted storage (file-based encryption) | Data Protection "Complete" through the app's default data-protection entitlement, so SQLite's own journal files are covered too |
| Backups | Excluded: `no_backup`, `allowBackup="false"`, and data extraction rules exclude cloud backup and device transfer | Folder marked `isExcludedFromBackup` |

The bundled research catalog is public and stays outside the database (`no_backup/catalog` on Android, the app bundle on iOS).

### Keys

- Each device generates a random 32-byte local key on first use and stores it wrapped by the platform key store, as today: Android Keystore with StrongBox preferred and user authentication required; iOS Secure Enclave with user presence required.
- Unlock: the host authenticates the user, unwraps the local key and calls `store_open(path, key)`. The core derives the SQLCipher key with HKDF under its own domain label and passes it as a raw key, so no passphrase KDF runs on each unlock. Opening is well under a second regardless of data size.
- Lock: `store_close` closes the connection, clears SQLite's page cache and zeroizes key buffers.
- Delete data from this device: close, delete the database files and the wrapped local key. No export prompt.

### Schema

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- schema version, DNA file metadata, catalog version
CREATE TABLE genotypes (rsid TEXT PRIMARY KEY, call TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE results (
  study_id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,        -- 'catalog' (recomputed per device) or 'imported' (from a results file; synced)
  trait TEXT NOT NULL, risk_level TEXT NOT NULL, effect_type TEXT NOT NULL,
  effect_rank REAL NOT NULL,   -- |beta| or |ln OR|, for "Effect size" sorting
  p_mlog REAL,                 -- for "P-value" sorting
  row TEXT NOT NULL            -- the existing saved-result JSON, unchanged
);
CREATE INDEX results_trait ON results(trait COLLATE NOCASE);
CREATE INDEX results_level ON results(risk_level);
CREATE INDEX results_effect ON results(effect_rank DESC);
CREATE INDEX results_p ON results(p_mlog DESC);
CREATE TABLE customization (field TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, device TEXT NOT NULL);
CREATE TABLE sync_state (record TEXT PRIMARY KEY, revision INTEGER NOT NULL, dirty INTEGER NOT NULL);
```

Keeping the full result JSON in `row` preserves the current result shape, so the scorer, reports and TSV export do not change.

### Core operations

- Import: parse as today, then replace `genotypes` in one transaction and mark the genotype record dirty for sync.
- Run all: load genotypes into the in-memory map for the run (about 120 MB for about 9 s), stream the bundled catalog, and upsert matches in batched transactions. A completed run deletes `catalog` results the catalog no longer produces. Cancelling keeps the work done so far.
- Results screen, study sheet, counts and Home summary: SQL queries on the indexes above.
- Reports and chat: the report functions read rows streamed from the database. The Overview report reads groups with `ORDER BY effect_rank`, matching the current ordering.
- Customization: one row per field, written on change.

## Sync

One sync feature, per platform for now: a user who installs the app on a new iPhone or Android phone finds their data already there, without signing in, entering a passphrase or approving from another device. Compatibility between iOS, Android and Web is a later step.

Sync is on by default. When DNA is first saved, the app explains once that it keeps an end-to-end encrypted copy so a new device fills in automatically. Turning sync off in Vault stops syncing and deletes the cloud copy; local data stays.

### What syncs

Sync carries only what the user created and cannot regenerate:

| Record | Content | Size | Changes |
|---|---|---|---|
| `genotype` | The imported genotype calls and file metadata | About 6 MB compressed | Only when a new DNA file is imported |
| `results` | Catalog match results, tagged with the catalog version and the genotype file's digest | About 2.5 MB compressed for 86,859 matches | When the DNA file or the bundled catalog changes |
| `customization` | Personalization fields and context | Under a few KB | Field by field |
| `imported-results` | Results imported from a TSV or JSON file | Usually small | On import |
| `report-passes` | iOS App Store report passes: one credit per purchase and one entry per use | A few KB | On purchase and on use |

Catalog results sync so a new device shows them immediately. A device uses synced results only when their tag matches its own bundled catalog version and genotype digest. Otherwise, for example when two devices run different app versions, it recomputes from the synced genotypes in about 10 s and uploads the newer results. Rerunning with the same DNA file and catalog produces identical results, so a content hash skips the upload. Genotypes still sync because catalog updates and single-study matching need them. Chat messages and generated reports are not persisted today, so they are out of scope.

### The sync key

Each user has one random 32-byte sync key, separate from every device's local database key. The platform's end-to-end encrypted secret store carries it to new devices:

- iOS: a synchronizable iCloud Keychain item (`kSecAttrSynchronizable`, accessible only while unlocked). iCloud Keychain is end-to-end encrypted, and any device signed into the same Apple ID receives the item.
- Android: Google Play services Block Store with cloud backup enabled. Block Store data is end-to-end encrypted when the device has a screen lock, which the app already requires before storing DNA, and it is restored when the user sets up a new phone from their Google account.

The local database key stays hardware-bound and never leaves the device; only the sync key travels.

### Where records are stored

Encrypted records are stored in the user's own cloud account, never on the Monadic DNA backend:

- iOS: CloudKit's private database (container `iCloud.com.monadicdna.explorer`), one `SyncRecord` per record with the ciphertext as an asset. Saving uses `.ifServerRecordUnchanged`, a real compare-and-set.
- Android: the Google Drive app-data folder, a hidden folder only Explorer can see, one file per record with the revision in `appProperties`. The app asks once for the `drive.appdata` scope. Drive has no compare-and-set, so the app checks the revision just before writing; a write that races another device's is merged on the next sync.

Data counts against the user's iCloud or Drive storage. No sign-in to Explorer is needed.

### Encryption

Every record is encrypted with AES-256-GCM under a key derived from the sync key, with the record name, an ID derived from the sync key and the revision bound as associated data. Apple and Google store only ciphertext.

### Protocol

- The cloud keeps `record -> (revision, ciphertext)`. A write supplies the revision it is based on and succeeds only if that is still current.
- A device pulls records whose revision is newer than its own, then pushes its changed records.
- Conflicts resolve per record without asking the user:
  - `customization`: merged per field, newest `updated_at` wins, so edits to different fields on two devices are both kept.
  - `genotype`: the most recent import wins. A device whose DNA file was replaced shows "Your DNA file was replaced by one imported on another device" and recomputes results.
  - `results`: the record whose tag matches this device's catalog and current genotype digest is used; otherwise the device recomputes. Newer catalog versions replace older ones.
  - `imported-results`: merged by study ID, newest wins.
  - `report-passes`: credits and uses are merged as sets, so uses made offline on two devices both count.
- Sync runs after unlock, after each change (debounced) and when the app returns to the foreground. It never blocks the UI, and failures retry with backoff.

### New device

1. On first launch, before showing the setup steps, the app looks for a sync key: iCloud Keychain on iOS, Block Store on Android.
2. If one exists, the user creates the local database with device authentication as usual. The app then downloads and decrypts the records and writes them to the database. If the synced results match this device's catalog version, Home shows them immediately; otherwise the app runs the catalog match first.
3. If none exists, the app generates a sync key on first save and stores it in the platform secret store.

### To confirm on devices

- Android: that Block Store restores the sync key during new-phone setup, and whether an already set-up second device can retrieve it.
- iOS: that the iCloud Keychain item arrives before first launch, and the behaviour with iCloud Keychain or iCloud Drive turned off.

## Removed

- Native v2 envelope files, `persist_session` and `restore_persisted_session`, and native-only v2 seal and open operations.
- All backend sync storage: the sync tables, migration and `/api/vault-sync`.
- `app/portable-vault` and native encrypted backup files. Sync replaces portable transfer for now.
- Wallet-based sync authentication and Dynamic sign-in in the apps. Purchases are read from the App Store and Google Play (see [clients](clients.md#mobile-payments)).

## Expected effect

- Unlock: well under a second, independent of data size.
- Memory while browsing: a bounded page cache plus the visible page, instead of about 340 MB.
- Memory during Run all: about 120 MB for genotypes plus one 50,000-row chunk, released after the run.
- Saves: only changed rows. Sync: only changed records, usually a few KB; about 8.5 MB (genotypes and results) once per DNA import, and about 2.5 MB per catalog update.

## Testing

- Core contract tests: open, import, Run all, page, sort, filter, report groups and customization, with results identical to the current JSON operations.
- Wrong key, truncated file and tampered page fail to open without crashing. After `store_close`, all operations fail until reopened.
- Sync: record encryption round trips, associated-data tampering is rejected, compare-and-set conflicts, field-level customization merge, genotype replacement and report-pass merge.
- Two-device end-to-end on two emulators sharing a Google account: set up on one, confirm the other fills in, edit different fields on each, import a new DNA file on one.
- Android instrumented and iOS XCTest public-sample tests, and the memory benchmark on the 2 GB emulator.

## Deployment and running the tests

- No backend changes are needed for sync. Enable CloudKit for the iOS app ID with container `iCloud.com.monadicdna.explorer`, and add the `drive.appdata` scope to the app's OAuth consent screen in Google Cloud.
- Core: `cargo test -p explorer-core` (store and sync tests in `crates/explorer-core/tests/store.rs`).
- Android: `connectedDebugAndroidTest` runs the store, public-sample and two-device sync tests against an in-memory cloud.
- iOS: `PublicSampleTests` and `SecureDataVaultTests` in Xcode.
- A real new-phone restore needs a Google account (Android) or iCloud (iOS) and a second device.
