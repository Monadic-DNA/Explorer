# Public 23andMe sample validation

Test date: 2026-10-21.

The input is a full, publicly volunteered 23andMe export from [gedankenstuecke/genotyping_23andme](https://github.com/gedankenstuecke/genotyping_23andme). Its README explicitly invites research use. The file's header identifies 23andMe, plus-strand calls, and genome assembly build 36. Tests match by rsID; they do not equate build-36 coordinates with modern GWAS coordinates.

Pinned source: [raw export at revision b5160492a1fad18c7180d7ee88b54807b1712c8e](https://raw.githubusercontent.com/gedankenstuecke/genotyping_23andme/b5160492a1fad18c7180d7ee88b54807b1712c8e/genome_Bastian_Greshake_Full_20110503120911.txt).

SHA-256: `65d5965670d8eb1072f187ab408c9044b0fdc88846d1b0132b0f5c4a3249a92e`.

The 24,913,943-byte file has 966,983 genotype rows. Under the existing Explorer parser's rules:

- 929,696 variants are imported, including 4,634 no-call rows.
- 10,249 internal identifiers are excluded.
- 27,038 single-allele calls are excluded. This is an inherited parser limitation, not a claim that those source rows are invalid.
- No-call rows never produce called A/C/G/T Run All matches.

A separate Python implementation reads the original text and calculates expected allele dosage, OR exponentiation, signed beta effects, match identity, and direction. It does not call Rust or the JavaScript application. A frozen snapshot of the environment's 1,000 public GWAS study records is stored in `tests/fixtures/public-sample-studies.json`. This keeps all clients' inputs identical. It is a sample of the catalog, not the complete production GWAS catalog.

Expected and verified web/native binding results: **142 matched study records**. Every SNP, genotype, effect type, direction, and numeric score agrees with the independent reference to an absolute tolerance of `1e-12`. There are 138 beta effects and four odds ratios, with 74 direction-decreasing and 68 direction-increasing associations; a decreasing beta is a change in the studied trait and should not automatically be interpreted as a health benefit.

## Executed checks

| Client/layer | Check | Result |
| --- | --- | --- |
| Web | Chromium: real file input, WASM parsing, visible import count, Run All through the existing IndexedDB catalog path, TSV download | Passed: 929,696 variants, 142 rows; all compared fields and scores match |
| Android native binding | Kotlin/JNA calling the actual Rust library with the full file, all 1,000 studies, and TSV round-trip | Passed: identical counts and all 142 results |
| Android app | Instrumented Compose test: app import method, Results navigation, Run all button, HTTP fixture transport, visible results, all scores, TSV round-trip | Passed on Android 8/API 26 emulator: 929,696 variants, all 142 corrected results agree; two UI tests passed |
| iOS Rust target | `cargo check --features ffi --target aarch64-apple-ios` | Passed |
| iOS app | Full-file Swift binding test and app file-import/published-result test | Passed on macOS CI / iOS Simulator ([run](https://github.com/Monadic-DNA/Explorer/actions/runs/39608592827)) |

The browser test seeds the real IndexedDB catalog with the frozen study snapshot. It blocks optional external account/analytics/provider traffic, while loading the SQL.js dependency through the configured proxy with TLS verification. It therefore does not verify login, purchases, or LLM reports. The Android UI test uses MockWebServer to deliver the same frozen snapshot through the application's real HTTP code. The local backend's corresponding 1,000-record Run All API response was also checked separately.

## Issues caught during this run

The public-file test caught and now guards against a web navigation bug: the portable-vault link performed a full reload, clearing the in-memory genome and results. It now uses Next.js client-side navigation. The browser test exports a portable vault after following that link, decrypts it independently with Node crypto, and checks the full variant and result counts.

The Run All API also omitted `ci_text` and evidence metadata from its minimal payload. Interval text determines beta versus odds ratio and the sign of a beta. The API now retains these fields. The final fixture was refreshed from the database with complete metadata, and the expected scores were recalculated independently; the match count remains 142, but the effect types and scores change. `npm run test:public-sample:api` checks every metadata field against the real local backend.

The Android emulator import initially timed out while passing the full file as base64 JSON. Native file imports now use a binary UniFFI buffer to reach the shared Rust decoder and parser, avoiding large string construction and escaping on the JVM. Swift uses the same binary entry point. Gzip/plain-text parity and malformed UTF-8 handling are covered by a native Rust contract test.

## Reproduce

```sh
npm ci
npm run test:public-sample:prepare
# Start the web app with its normal local development backend in another terminal.
npx playwright install chromium
npm run test:public-sample:web
# Or use an existing browser:
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:public-sample:web
```

The web origin defaults to `http://127.0.0.1:3000`; override `EXPLORER_TEST_URL` if needed. The test creates a fresh browser context and modifies only its own IndexedDB. In cloud environments whose Node runtime requires proxy opt-in, set `NODE_USE_ENV_PROXY=1`.

```sh
node scripts/build-native.mjs android x86_64
apps/android/gradlew -p apps/android -PexplorerAbis=x86_64 testDebugUnitTest connectedDebugAndroidTest
```

For Android hardware, build/package the corresponding ABI instead. The full-file tests are `PublicSampleCoreTest` and `PublicSampleTest`.

On macOS, run preparation before generating the Xcode project, then follow [the iOS build instructions](clients.md#ios). The XCTest classes are `PublicSampleTests` and `CoreTests`. The native CI workflow prepares the public sample before running Android and iOS tests.

Raw DNA and generated expected results are downloaded/generated under ignored `.test-data/`, Android test assets, and iOS test resources. The raw genome is not committed. Browser screenshots and the verified TSV export are generated in `.test-data/public-sample/`. This cloud run also captured the native Results screen as `.test-data/public-sample/android-results.png`.
