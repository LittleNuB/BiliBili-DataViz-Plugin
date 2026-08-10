---
status: accepted
---

# Gate global full-text search before runtime implementation

Global search over managed full text cannot enter runtime implementation until a separate Chrome MV3 feasibility gate passes against realistic Chinese Bilibili-subtitle distributions plus 100-, 400-, and 500-MiB future-compatible fixtures. The gate compares at least an IndexedDB lexical-index approach and a proven chunk-persistable search library without making vectors or semantic indexing a release dependency, and measures build/resume time, peak memory, index size, Chinese and English query latency, cancellation, rebuild, and service-worker restart recovery. Failure returns capacity or search scope to product review; version 14 must not silently substitute metadata-only search, per-query scans over hundreds of MiB, or an unvalidated engine.
