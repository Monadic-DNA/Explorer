# Run All performance

All three clients now use the shared Rust batch scorer. Native uses a bounded Rayon pool (up to four available CPU threads); Web distributes batches to up to four background workers running the same import-free WASM library. Browsers with limited memory use at most two workers. Browsers that cannot start workers use the same scorer with event-loop yields.

The scorer rejects nonmatching SNPs before effect parsing or JSON allocation, indexes native genotypes with a hash table, and maintains a study-ID index for constant-time updates to saved matches. Common numeric effect sizes avoid regex captures, with the previous JavaScript-compatible prefix parser retained as fallback. Release optimization prioritizes this hot path. Parallel completion preserves catalog order and the existing overwrite behavior.

Native catalog loading prefetches three 5,000-row pages concurrently instead of one 1,000-row page at a time. This cuts request count roughly fivefold and permits three requests to overlap, without unbounded requests or genome uploads. Database pagination uses stable study IDs, so parallel page requests select disjoint ranges. Progress updates after each analyzed page; cancellation stops pending requests and retains completed matches through the encrypted save flow. Downloading a mutable catalog does not provide a transactional snapshot across requests.

Web reads cached studies with bounded IndexedDB `getAll` batches, replacing a browser/JavaScript callback for every single row. Reading, matching and progress updates overlap. Workers receive only the genotypes needed for their current batch, not a copy of the complete genome. Workers terminate after completion or error. Onboarding uses the same worker pool and scorer; its optional result limit preserves input order. Existing-result lookups use a memoized index rather than scanning the saved-results array for each study.

## Measurements in this workspace

- The real TypeScript/WASM session boundary processed 20,000 synthetic studies with 4,000 matches in **159 ms**, compared with **840–859 ms** before these changes: approximately **5.3× faster**. The small synthetic genome isolates matching/result-update cost; this is not an end-to-end production catalog benchmark.
- Chromium imported the pinned public 23andMe genome (929,696 parsed variants), then analyzed a cached **100,000-row** catalog in **2.818 seconds using four workers**. This catalog consists of 100 ID-adjusted copies of the pinned 1,000-study fixture. All **14,200** results matched the independent Python reference on SNP, genotype, effect type, direction and score; results export and encrypted vault export also passed.
- Native serial/parallel equality tests compare 12,000 results byte-for-byte, including stable order and signed beta effects. WASM tests compare batch and session results, duplicate updates and invalid/missing genotype/effect filtering. Native public-sample tests exercise the same parallel scorer. The Android app test expands the pinned catalog to 11,000 rows, checks every expected result across three pages, and asserts that real HTTP requests overlap while remaining bounded to three.

Timings depend on device, catalog, cache and network. Cold runs still need the catalog download/decompression, and encryption/persistence adds separate work. The measurements above do not promise a fixed speedup on every phone. Synthetic native scoring can be limited by allocation/memory bandwidth; bounded parallelism complements the algorithm and networking improvements.

## Reproduce

```bash
npm run core:build
npx tsx scripts/benchmark-run-all.ts
cargo run --locked --release -p explorer-core --example benchmark_run_all
npm run test:public-sample:prepare
# Start a production Web build, then:
EXPLORER_PERF_COPIES=100 npm run test:public-sample:web
```

The normal browser CI uses one pinned fixture copy and verifies that background workers run successfully, as well as checking every result. Performance thresholds are not asserted in CI because shared runner timing varies.
