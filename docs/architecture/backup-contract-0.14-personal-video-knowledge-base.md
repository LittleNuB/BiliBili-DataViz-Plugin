# 0.14 Personal Video Knowledge-Base Backup Contract

**Status:** DEFERRED FULL-LIBRARY ZIP FORMAT. [The bounded learning-loop scope](../scope-0.14-bounded-learning-loop.md) takes precedence for 0.14.0 on scope-PR review and merge. LG-0 must freeze a separately identified small knowledge-backup format; it must not claim compatibility with the ZIP backup v1 below. Atomic, non-destructive restore remains required. This document does not authorize runtime implementation or release.

## Package Envelope

- The package is an ordinary, unencrypted ZIP. It is neither signed nor authenticated and therefore detects corruption or structural tampering, not the identity of whoever created it.
- Export writes compact JSON with fixed field order, UTF-8 without a BOM, and LF line endings. JSONL entries end every record, including the last, with one LF byte.
- `manifest.json` is written after all data entries and is serialized as one compact JSON object plus one LF. Its exact bytes are the operation journal's archive fingerprint input.
- Restore first reads the bounded ZIP directory and manifest, then streams the declared data entries. It never extracts paths to disk and never persists a file handle.
- Backup format version is independent from the Dexie schema version. Version 14 exports only `backupFormatVersion: 1`.

## Manifest V1

The root object contains these fields in order:

| Field | Contract |
| --- | --- |
| `format` | exact string `bili-bill-knowledge-backup` |
| `backupFormatVersion` | exact safe integer `1` |
| `createdAt` | export Unix-millisecond safe integer; display provenance only, never conflict winner |
| `mode` | `full` or `lightweight` |
| `entries` | ordered descriptors for every allowed data entry |
| `totals` | cross-checked aggregate record and retained-full-text counts |

Each entry descriptor contains, in order, `path`, `recordKind`, `recordCount`, `uncompressedBytes`, and lowercase `sha256` over exact uncompressed entry bytes. `totals` contains `videoCount`, `partCount`, `assetCount`, `assetSourceCount`, `evidenceVersionCount`, `fullTextVersionCount`, `fullTextSegmentCount`, `managedFullTextCanonicalBytes`, and `entryUncompressedBytes`.

Lightweight mode has exactly these five ordered entries:

1. `data/videos.jsonl` as `knowledge_video`
2. `data/parts.jsonl` as `knowledge_video_part`
3. `data/assets.jsonl` as `knowledge_asset`
4. `data/asset-sources.jsonl` as `knowledge_asset_source`
5. `data/evidence-versions.jsonl` as `knowledge_evidence_version`

Full mode appends:

6. `data/fulltext-versions.jsonl` as `managed_fulltext_version`
7. `data/fulltext-segments.jsonl` as `managed_fulltext_segment`

Every required entry exists even at zero records. Lightweight totals require both full-text counts and canonical bytes to be zero. Full-text segment records are sorted by `versionId` and then `ordinal`, which lets restore finish and validate one complete version at a time without one ZIP entry per version.

## Record Projections

Every record starts with `record` and exact `contract: "knowledge-backup-record-v1"`. Export constructs keys in the order below. Every listed nullable field is present as JSON `null` rather than omitted; arrays are present as arrays and preserve their validated semantic order. JavaScript `undefined` is invalid. Restore validates the exact field set, values, and types but does not reject a compatible v1 record merely because its JSON object keys arrived in another order. Unknown or missing fields remain invalid.

| Record | Exact field order after `record`, `contract` |
| --- | --- |
| `knowledge_video` | `bvid`, `avid`, `title`, `description`, `coverUrl`, `creatorName`, `creatorMid`, `categoryName`, `publicTags`, `durationSeconds`, `publishedAt`, `availabilityState`, `createdAt`, `metadataUpdatedAt`, `lastLibraryActivityAt`, `lastVerifiedAt` |
| `knowledge_video_part` | `bvid`, `cid`, `title`, `durationSeconds`, `displayOrder`, `availabilityState`, `createdAt`, `metadataUpdatedAt`, `lastVerifiedAt` |
| `knowledge_asset` | `assetId`, `assetKind`, `title`, `tags`, `createdAt`, `updatedAt`, `userNote`, `userBody`, `savedContentKind`, `savedContentBlocks`, `savedQuestion` |
| `knowledge_asset_source` | `assetSourceId`, `assetId`, `sourceOrder`, `bvid`, `cid`, `startSeconds`, `endSeconds`, `evidenceState`, `activeEvidenceVersionId`, `createdAt`, `updatedAt`, `lastEvidenceCheckedAt` |
| `knowledge_evidence_version` | `evidenceVersionId`, `assetSourceId`, `bvid`, `cid`, `sourceType`, `language`, `sourceVersionFingerprint`, `capturedText`, `startSeconds`, `endSeconds`, `supportedBlockOrdinals`, `capturedAt`, `createdAt` |
| `managed_fulltext_version` | `versionId`, `scopeKey`, `bvid`, `cid`, `sourceType`, `language`, `languageLabel`, `sourceVariantKey`, `sourceVersionFingerprint`, `bodyHash`, `timelineHash`, `segmentCount`, `coverageStartSeconds`, `coverageEndSeconds`, `versionState`, `originKind`, `capturedAt`, `createdAt`, `restoredFromBackupCreatedAt` |
| `managed_fulltext_segment` | `versionId`, `ordinal`, `startSeconds`, `endSeconds`, `text` |

The nullable fields are `avid`, video and part display metadata, `lastVerifiedAt`, asset user/saved-content fields, asset-source `cid`/times/pointer/check time, evidence `language`, full-text `languageLabel`, and `restoredFromBackupCreatedAt`. Required arrays such as `tags` and `supportedBlockOrdinals` cannot be null; optional array fields such as `publicTags` and `savedContentBlocks` use null when absent. Derived `tagKeys`, `saveFingerprint`, `currentScopeKey`, `serializedBytes`, full-text `lastVerifiedAt`, and every `operationId` are excluded.

Record order is deterministic: videos by `bvid`; parts by `bvid` then numeric `cid`; assets by `assetId`; asset sources by `assetId`, numeric `sourceOrder`, then `assetSourceId`; evidence versions by `assetSourceId`, numeric `createdAt`, then `evidenceVersionId`; full-text versions by `versionId`; and full-text segments by `versionId` then numeric `ordinal`. Only videos and exact parts referenced by exported assets, evidence, or included full text enter the package.

Export preserves IDs, user text, saved-content blocks, source order, active evidence pointers, evidence history, source snapshots, original lifecycle timestamps, full-text source hashes, and whether a full-text version was current, historical, or pending when exported. Restore recomputes `tagKeys`, `saveFingerprint`, scope and source fingerprints, `serializedBytes`, and every conflict rewrite instead of trusting derived backup values.

## Structural Validation

Restore rejects before persistent visibility when any condition below fails:

- ZIP paths are not the exact mode-specific set, appear more than once, are encrypted, use unsupported compression, contain a backslash, are absolute, traverse directories, or disagree with the manifest.
- `manifest.json` exceeds 1 MiB, an individual JSONL record exceeds 16 MiB, total records exceed 10,000,000, or declared or observed aggregate uncompressed bytes exceed 2 GiB.
- Declared counts, exact streamed byte counts, CRC, SHA-256, JSONL line boundaries, canonical export order in producer fixtures, JSON types, required fields, enum values, or per-record size do not validate. Restore accepts any incoming object-key order with the exact compatible field set; duplicate JSON keys and unknown fields are invalid.
- A durable ID is duplicated, a reference is missing, a part references another video, an evidence pointer targets another relation, source orders or supported block ordinals are invalid, or an asset graph is incomplete.
- A full-text version lacks segments, ordinals are not contiguous from zero, timing is invalid, counts or coverage disagree, hashes differ, two exported versions claim the same current scope, or managed-full-text canonical bytes do not recompute exactly.

The source ZIP remains unchanged. Envelope and locally decidable record failures reject before staging. The 2-GiB aggregate and 16-MiB record limits are parser/format safety boundaries, not promises that the browser can admit that much local data. Before staging, the runtime also requires `StorageManager.estimate()` headroom using the conservative multiplier and fixed reserve selected by the Gate from measured IndexedDB staging overhead. Missing or insufficient trustworthy headroom refuses early; a passing estimate never overrides a later quota, full-text, or transactional check.

UUID rewrites, preview counts, cross-record validity, and resulting capacity are computed against invisible staged candidates; no staged row is user-visible or committable until the complete current-format candidate passes every check. A staging quota failure preserves existing knowledge, enters resumable cleanup, and leads to the same space-management/retry path rather than silently reducing the restored categories.

## Merge And Conflict Rules

- Canonical videos and parts merge by `bvid` and `[bvid, cid]`. Local non-empty metadata wins; backup fills missing display metadata. Backup verification timestamps and availability never make a restored source current.
- An asset with an unused UUID preserves that UUID. The same UUID with the same semantic graph is skipped. Different content retains the local graph and uses the deterministic UUIDv5 conflict map from ADR 0086 for the complete imported graph.
- The semantic graph fingerprint includes asset kind, title, tags, user-authored content, saved content and question, sources in `sourceOrder`, and canonical semantic evidence with active selection. It excludes all generated IDs, derived keys, lifecycle timestamps, relation verification state, last-check time, and operation markers, so revalidation alone cannot manufacture a duplicate import.
- Source-backed restored asset relations become `pending_revalidation`; `not_applicable` remains unchanged. Active evidence selection and immutable history are preserved, but only later real-source validation may make the relation current.
- A full-text version with an already present identical `sourceVersionFingerprint` is skipped. A differing same-UUID version uses the deterministic conflict UUID and recalculates exact bytes.
- A backup historical version remains historical. A backup current or pending version becomes pending when no local current exists for that scope; when a different local current already exists, the imported copy is historical. Local current selection is never removed by restore.
- Every imported full-text version uses `originKind: restored`, sets `restoredFromBackupCreatedAt` to manifest `createdAt`, and omits `lastVerifiedAt` and `currentScopeKey` until real-source revalidation.
- Final preview and commit use the post-deduplication, post-rewrite graph and exact resulting full-text bytes. Capacity refusal offers knowledge-only restore or cancellation and never chooses an arbitrary subset of full text.

## Excluded Data

No backup entry contains synchronized favorite/watch-later/account/container relationships, account identifiers or labels, watch history, current-video caches, ordinary QA sessions, derived search or Smart Favorite indexes, AI settings, provider/model/prompt fields, API keys, Cookie data, login state, browser-profile data, audio, transcription models, file paths, operation journals, storage ledgers, diagnostics, or raw runtime/network errors.

## Required Fixtures

Format v1 keeps deterministic lightweight and full fixtures for empty content, one source, multi-source saved answers, evidence relocation history, Unicode and overlapping subtitle times, current/historical/pending full text, repeated restore, same-UUID conflict rewrite, local-current preservation, 400-MiB warning, exact-500-MiB commit, over-limit refusal, malformed archive classes, cancellation, worker interruption, quota failure, cleanup, and post-commit readback.
