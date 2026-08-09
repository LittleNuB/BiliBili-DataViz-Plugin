---
status: accepted
amends: 0048
---

# Use fixed streaming JSONL entries for backup v1

Backup format v1 uses five fixed knowledge JSONL entries and, in full mode, two fixed managed-full-text JSONL entries. Full-text segments from every version share one stream ordered by version UUID and ordinal. This amends ADR 0048's per-version segment-entry wording: a dynamic ZIP path per version would make the manifest and central directory scale with video count without improving bounded-memory processing, while one ordered JSONL stream remains incrementally writable, hashable, readable, and batchable.

The only allowed data paths are `data/videos.jsonl`, `data/parts.jsonl`, `data/assets.jsonl`, `data/asset-sources.jsonl`, `data/evidence-versions.jsonl`, and, for full mode only, `data/fulltext-versions.jsonl` plus `data/fulltext-segments.jsonl`. Every required entry exists even when empty. `manifest.json` is the only root entry and is written after the data hashes are known. Export uses fixed field order, compact `JSON.stringify`, UTF-8 without a BOM, and one LF per record. Restore streams and validates records without treating one complete entry as an in-memory JSON value.

Version 1 rejects unknown, duplicate, encrypted, absolute, backslash, traversal, or non-manifest paths; duplicate JSON keys; unsupported compression methods; a manifest above 1 MiB; any JSONL record above 16 MiB; more than 10,000,000 total records; or more than 2 GiB of declared or observed aggregate uncompressed bytes. These are backup-format safety boundaries, not automatic eviction rules. A durable asset whose canonical backup record would exceed the per-record boundary is refused before save with natural storage guidance so Bili-Bill never creates knowledge that its own current backup format cannot preserve.

All seven record kinds use exact `knowledge-backup-record-v1` projections. Every record begins with `record` and `contract`; the remaining ordered fields are frozen in the backup architecture contract. Nullable optional values serialize as JSON `null`, arrays retain their validated semantic order, and rows use the contract's deterministic identity order. Derived tags, save fingerprints, current-scope keys, byte ledgers, operation markers, verification-only fields, and raw source/runtime data are excluded. Producers must emit the frozen key order, but restore validates the exact field set and types independently from incoming object-key order so a semantically compatible v1 package is not rejected for harmless JSON key reordering.
