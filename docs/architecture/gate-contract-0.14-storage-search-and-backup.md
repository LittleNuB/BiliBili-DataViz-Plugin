# 0.14 Storage, Search, And Backup Gate Contract

**Status:** REQUIRED BEFORE RUNTIME IMPLEMENTATION. Passing this gate selects implementation parameters; library documentation alone is not evidence of a pass.

## Gate Outcomes

The gate produces five independent decisions:

1. whether the accepted 500-MiB managed-full-text boundary is viable in Chrome MV3;
2. which global lexical-search layout becomes `knowledgeSearchIndex`;
3. which streaming ZIP implementation supports backup v1 safely;
4. which conservative restore-staging quota multiplier and fixed reserve are required before writing invisible rows;
5. whether any bounded Blob fallback is allowed, and at what verified maximum.

Each outcome is `pass`, `fail`, or `insufficient_evidence`. A failed or incomplete search outcome blocks global body-text search and the version-14 schema declaration. A failed 500-MiB or restore outcome returns the capacity or backup scope to product review. It cannot be replaced by title-only search, query-time corpus scans, partial restore, hidden eviction, or unbounded in-memory work.

## Candidate Set

### Global lexical search

- **Candidate A: generation-scoped IndexedDB inverted index.** Use NFKC/case-normalized Latin terms plus deterministic CJK exact-sequence and overlapping-bigram tokens. Persist bounded posting shards and compact document metadata under one inactive generation, then atomically activate the complete generation. Core rows remain authoritative and verify every returned excerpt.
- **Candidate B: FlexSearch 0.8 generation pinned by exact package lock and integrity.** Test its documented CJK encoder, worker path, and browser IndexedDB persistence. An export/import configuration that requires the complete 500-MiB-derived index in memory is ineligible even if its query latency is fast.

FlexSearch's official repository documents browser IndexedDB persistence, workers, export/import, and `Charset.CJK`; these claims qualify it for the gate but do not establish compatibility with this extension's data or lifecycle. See [FlexSearch official repository](https://github.com/nextapps-de/flexsearch).

### Streaming ZIP

- **Candidate A: zip.js, exact package version pinned by the spike.** Test direct Web Streams integration, incremental write/read, worker and native compression options, CSP/package behavior, malformed archive handling, and tree-shaken bundle output.
- **Candidate B: fflate, exact package version pinned by the spike.** Test streaming `Zip`/`Unzip`, asynchronous worker variants, output backpressure into `FileSystemWritableFileStream`, cancellation, and parser-envelope enforcement.

The official zip.js repository documents incremental writing, Web Streams, large-data design, browser workers, and a BSD-3-Clause license; fflate documents browser streaming ZIP, asynchronous worker APIs, and a small ESM implementation. These are candidate facts, not Bili-Bill performance claims. See [zip.js official repository](https://github.com/gildas-lormeau/zip.js) and [fflate official repository](https://github.com/101arrowz/fflate).

No dependency enters production `package.json` during the spike. The report records candidate version, integrity, transitive dependency tree, license, minified/gzipped contribution, worker/WASM assets, and the release verifier's 500,000-byte chunk result.

## Deterministic Fixtures

- Build public-safe seeded fixtures at exactly 100 MiB, 400 MiB, and 500 MiB under `managed-full-text-v1`. They reproduce a separately recorded public-safe Bilibili-subtitle statistical profile without copying source wording or the user's local history, favorites, notes, profile, or login state.
- The committed golden receipt fixes segment-length percentiles, segments-per-video percentiles, overlap rate and duration, CJK/Latin/number/punctuation proportions, video-duration buckets, and malformed-row exclusion counts. Add a high-fragmentation fixture with short segments and the maximum measured segment-count tail. A claim of “realistic distribution” without this receipt is `insufficient_evidence`.
- Include one 64-MiB single-version stress fixture because long videos cannot be excluded merely to make transactions easy. Failure returns the atomic-version contract to review; it does not introduce an undocumented video-duration cap.
- Include current, historical, restored-pending, multi-part, multi-language, duplicate-source, changed-timeline, and Unicode edge cases. Future `local_transcript` rows are synthetic schema/load fixtures only and never claim an ASR capability.
- Every fixture has a seed, generator version, canonical byte receipt, record counts, SHA-256 values, and planted retrieval targets. Generated fixtures are not committed when their size is impractical; the generator and small golden receipts are.
- Use a fixed query suite with at least 50 Chinese exact targets, 25 Chinese multi-term queries, 20 mixed Chinese/Latin queries, 20 English queries, 10 punctuation/number queries, and 20 common-term distractor queries. Expected source/version/segment identities are declared before candidate runs.

## Environment And Repetition

- Run as an unpacked production build in current stable Chrome on Windows, using a fresh temporary test profile with no Bilibili login, Cookie import, browser-profile read, user database, API key, or network dependency.
- Record OS build, CPU, logical cores, memory, free disk, Chrome version, extension commit, Node version, package lock hash, candidate versions, fixture hashes, storage estimate, run start/end time, and whether memory metrics were available.
- Use at least three clean cold runs and five warm runs per candidate and fixture size. Cold means a fresh index generation and reopened extension; warm means an already opened complete generation with caches allowed by the candidate contract.
- Record median and p95 where applicable. An unavailable required metric is `insufficient_evidence`, never zero or a pass.

## Managed-Full-Text And IndexedDB Matrix

Measure admission, exact-byte ledger update, ordered read, selected-version removal, ledger repair, full clear, restore staging, commit visibility, marker normalization, and extension restart at 100, 400, and 500 MiB. Restore runs record source canonical bytes, staged IndexedDB usage delta, temporary search/metadata overhead, free quota before/after cleanup, and the highest observed amplification ratio.

Test transaction/batch candidates of 256, 512, and 1,024 records, each additionally capped at 1, 2, or 4 MiB of canonical payload. Select the largest combination that satisfies every latency, memory, cancellation, and restart constraint; record rejected combinations rather than averaging them away.

Required assertions:

- one version's metadata and complete segment set commits or rolls back together, including the 64-MiB stress version;
- aggregate ledger and sum of per-version bytes agree after every mutation, injected abort, restart, and repair;
- exact 500 MiB commits, any positive byte beyond it refuses, and existing data remains readable/exportable;
- no ordinary read sees pre-commit restore rows; committed rows become visible together; orphan-marked rows remain hidden and cleanable;
- cancellation is acknowledged within 1 second and produces no writes after 2 seconds;
- any UI-main-thread task stays at or below 200 ms;
- peak measurable JavaScript-heap growth above idle stays at or below 256 MiB.

The selected restore preflight rule uses the highest observed clean-run staging amplification rounded up to the next 0.25, plus at least 25% safety margin, and a fixed reserve of at least 64 MiB. It must early-refuse a deliberately insufficient-quota fixture, allow every passing near-limit fixture, and still treat the final write/readback as authoritative. If no finite rule can do both across required runs, restore is `insufficient_evidence` and runtime work remains blocked.

## Search Pass Criteria

- Initial build completes within 3 minutes at 100 MiB, 12 minutes at 400 MiB, and 15 minutes at 500 MiB.
- Persisted search bytes are no more than 1.5 times managed source bytes; peak measurable JavaScript-heap growth above idle is no more than 256 MiB.
- Warm query p95 at 500 MiB is at most 500 ms; cold query p95 is at most 2 seconds.
- Every unique exact planted target appears at rank 1. At least 95% of declared multi-term targets appear in the top 10, and every result maps to the exact retained layer, video, part, version state, and source interval before display.
- A historical or pending result is naturally labeled and never eligible as current answer evidence. Search relevance never becomes evidence confidence or recommendation ranking.
- MV3 worker interruption redoes at most one committed checkpoint batch. No mixed generation becomes current, duplicate posting appears, or full rebuild silently restarts.
- Adding or removing one deterministic 1-MiB source becomes reflected within 10 seconds. After removal and completed readback, none of its exact text remains searchable.
- Index clear, rebuild, failed generation, stale generation, and core-source mismatch produce explicit bounded states. No path scans the complete core corpus per query or silently returns metadata-only results as global text search.

The winning report freezes the exact store declaration, generation-state record, tokenization, document/fragment identity, posting or library persistence layout, checkpoint shape, update/remove semantics, and stale-read behavior. No semantic/vector feature is required to pass.

## ZIP And Restore Pass Criteria

- Stream full and lightweight backup directly into a user-selected writable-file stream without constructing the complete archive as a Blob or retaining a file handle after the operation.
- Validate exact backup-v1 paths, manifest, counts, canonical fields, CRC, SHA-256, duplicate keys, unknown fields, references, full-text hashes, record and aggregate limits, and deterministic conflict rewrites while memory remains bounded.
- Measure export and restore duration, compressed bytes, compression ratio, main-thread blocks, heap growth, cancellation latency, stream backpressure, final close, and post-close readback at 100, 400, and 500 MiB.
- Inject cancellation and failure during every entry and lifecycle phase, including destination rejection, disk/quota failure, malformed central directory, path traversal, duplicate path, encrypted entry, unsupported compression, truncated stream, oversized record, wrong count/hash, extension reload, and MV3 worker interruption.
- A failed export never reports success. The report records whether Chrome leaves a partial destination and verifies the natural manual-removal notice.
- A failed or interrupted restore exposes no staged item, preserves all prior data, resumes bounded cleanup after restart, releases its operation row, and requires a fresh file selection.
- Successful restore proves first import, repeated idempotent import, same-UUID deterministic conflict, edited imported conflict, exact full-text deduplication, local-current preservation, knowledge-only capacity fallback, final ledger equality, and post-commit marker normalization.
- The selected library and worker assets pass `npm audit --audit-level=high`, license-copy requirements, extension CSP, typecheck, build, release-dist verification, and the 500,000-byte minified-chunk ceiling.

## Blob Fallback Gate

Test canonical uncompressed backup candidates at 8, 16, 32, and 64 MiB only after the streaming path passes. The fallback maximum is the largest size whose complete Blob construction, ZIP finalization, browser download handoff, cancellation, and cleanup all pass with peak heap growth no more than 128 MiB and no UI-main-thread task above 200 ms. If 8 MiB fails, version 14 ships no Blob fallback and explains the supported-Chrome requirement before archive construction.

The verified threshold applies to estimated uncompressed entry bytes, not compressed ZIP size. The export rechecks exact bytes before choosing the fallback and refuses when the final candidate exceeds the threshold.

## Report Template

Every candidate report contains:

1. commit, command, environment, dependency, license, and fixture receipts;
2. raw run table plus median/p95 summary;
3. all pass criteria with `pass`, `fail`, or `insufficient_evidence` and linked evidence;
4. cancellation, restart, cleanup, malformed-input, and privacy observations;
5. selected batch sizes, restore-staging multiplier and reserve, Blob threshold, store declarations, and package versions, or the exact blocking failure;
6. limitations that automated engineering checks cannot establish, including subjective usefulness and real-user adoption.

No report may contain user notes, local source text, account identifiers, Cookie/profile/login-state data, key material, file paths, or raw runtime errors in screenshots intended for public review.
