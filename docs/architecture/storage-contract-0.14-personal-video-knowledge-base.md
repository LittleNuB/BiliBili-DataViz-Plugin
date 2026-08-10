# 0.14 Personal Video Knowledge-Base Storage Contract

**Status:** DRAFT DURING DEVELOPMENT-READINESS GRILL. This document records accepted storage decisions only and is not runtime implementation approval.

## Scope And Baseline

Version 14 extends the existing `BiliAnalyticsDB` v13 schema. It does not reuse favorite, Smart Favorite, current-video transcript, summary/highlight, or QA-session tables as durable knowledge storage. The v13-to-v14 core migration remains deterministic, local, and atomic; post-open derived-index construction is resumable and is not part of migration success.

## Accepted Table Topology

| Table | Logical identity | Owns | Backup |
| --- | --- | --- | --- |
| `knowledgeVideos` | normalized `bvid` | canonical video identity and last-known display snapshot | Included when referenced by exported knowledge or full text |
| `knowledgeVideoParts` | `[bvid, cid]` | stable part scope and last-known title, duration, and display order | Included when referenced |
| `knowledgeSourceRelations` | `[containerScopeId, normalized bvid]` | favorite, watch-later, account, and legacy-source video membership | Excluded |
| `knowledgeAssets` | stable local UUID | asset type, editable user layer, optional immutable saved-content layer, tags, lifecycle timestamps | Always included |
| `knowledgeAssetSources` | stable local UUID | one asset-to-video-or-part relationship plus its nullable current-evidence pointer | Always included |
| `knowledgeEvidenceVersions` | stable local UUID | immutable evidence snapshot and active/corrected history | Always included |
| `managedFullTextVersions` | stable local UUID | immutable full-text source/version metadata, state, fingerprints, and deterministic byte accounting | Included only in full backup |
| `managedFullTextSegments` | `[version UUID, ordinal]` | ordered time-aligned text owned by one full-text version | Included only in full backup |
| `knowledgeSearchIndex` | derived entry identity | rebuildable search, tag-suggestion, and optional validated semantic data | Excluded |

The exact durable and auxiliary field declarations frozen below exclude only the rebuildable `knowledgeSearchIndex`, whose physical schema remains blocked on the global-search feasibility gate. Auto-increment database row numbers, timestamps, and fingerprints are not durable backup identity.

The nine rows above are the core knowledge topology. Version 14 additionally adds four auxiliary tables:

| Table | Logical identity | Owns | Backup |
| --- | --- | --- | --- |
| `knowledgeSourceAccounts` | random local `accountScopeId` UUID | one unique external account ID for authorized-sync matching, available nickname, stable alias ordinal, and connection or verification timestamps | Excluded |
| `knowledgeSourceContainers` | deterministic `containerScopeId` | exact account-or-legacy source collection, mutable labels, reported count, completeness, and synchronization timestamps | Excluded |
| `knowledgeStorageState` | closed state discriminator | transactionally coupled derived ledgers, initially managed-full-text byte and version totals | Excluded |
| `knowledgeOperations` | stable operation UUID | text-free bounded restore staging, index rebuild, export, and other approved resumable-maintenance state | Excluded |

No auxiliary table is a knowledge entity, durable source, backup entry, user-visible result, or part of knowledge-size reporting.

## Cross-Table Invariants

1. One normalized `bvid` maps to at most one canonical video. One exact `[bvid, cid]` maps to at most one part; page order is display metadata rather than identity.
2. A source relationship may retain a lightweight video but cannot own a knowledge asset or managed full text.
3. An asset owns one or more asset-source relations, so every asset remains related to at least one video. A pure note may use a whole-video relation with no evidence snapshot; “without evidence” never means a zero-relation free-floating asset. A source-backed relation owns immutable evidence-version history and selects at most one current version through its nullable `activeEvidenceVersionId`.
4. A managed full-text version owns a complete contiguous segment sequence beginning at ordinal zero. No segment is current evidence independently from its owner.
5. One exact `[bvid, cid, source type, language, source variant]` full-text scope has at most one version carrying its unique `currentScopeKey`. Historical and pending-validation versions omit that key.
6. Knowledge assets and evidence snapshots remain readable after managed full text, synchronized source relations, temporary caches, or derived indexes are removed.
7. The search index contains no sole copy of user text, source text, tags, evidence, or identity and can be dropped and rebuilt.
8. `knowledgeAssets` stores the current editable user layer and may separately own one immutable saved-content layer. Explicit edit save atomically replaces only title, user-authored body or note, normalized tags, and update time; it cannot change saved content and no durable edit-revision table exists.
9. Video and part display snapshots are mutable non-evidence. A successful sufficiently complete source read may refresh them; an empty, failed, or incomplete read cannot erase an existing non-empty field or alter identity.
10. Every confirmed non-legacy account-scoped synchronized relationship references one `knowledgeSourceAccounts` row. The reserved upgrade-era unknown-account scope is not presented as a connected account and does not require a fabricated registry row.
11. Only `knowledgeSourceAccounts` stores the external Bilibili account identifier. Its source relationships and their deterministic keys carry only the referenced local `accountScopeId`.
12. Every synchronized source relationship references one `knowledgeSourceContainers` row and cannot duplicate its mutable label or completeness state. Empty containers remain representable without a fabricated video membership.
13. A video part is identified only by exact `[bvid, cid]`. Display order cannot select, merge, replace, or transfer a durable part reference.
14. `knowledgeVideos.lastLibraryActivityAt` changes only for accepted local knowledge-space activity and cannot be derived from metadata refresh, repeated source synchronization, verification, or recommendation signals.
15. Immutable asset saved content is an ordered block array. Evidence versions may support complete block ordinals only; character offsets and unmatched free-text claims are not durable mappings.
16. Evidence validity is mutable state on `knowledgeAssetSources`. Immutable evidence versions never carry an independently mutable current, corrected, or unavailable flag.
17. `knowledgeStorageState` accelerates validated derived totals only. Per-version rows remain repair authority, and no state row may own user text, source text, or durable identity.
18. `knowledgeOperations` contains active or recovering maintenance only. A marked core row with no valid owning operation is never treated as committed user-visible data.

## Secondary-Index Boundary

- Version 14 creates secondary indexes only for accepted product reads and bounded maintenance. Identity and uniqueness constraints remain mandatory, but a possible future feature is not a reason to index another field.
- The accepted business-query families are exact synchronized-source scope plus video membership, asset type and update order, normalized personal tags, asset evidence state, asset-to-source and source-to-evidence traversal, managed-full-text scope and current selection, per-video or per-part full-text management, and segment traversal by owning version and start time.
- Every core table that can hold restore-staged rows has an optional operation identifier index so cleanup, visibility normalization, and interruption recovery can process bounded batches without scanning large text bodies.
- `knowledgeAssets` retains natural user-visible tag text and derives normalized `tagKeys` for one multi-entry filter/suggestion index. The derived keys are not another durable tag entity and are rebuilt from the asset when needed.
- User-authored body or note text, evidence body text, managed-full-text segment text, descriptions, and other large text fields are not ordinary IndexedDB secondary indexes. Their sole durable copy remains in the owning core row.
- Global body-text retrieval uses `knowledgeSearchIndex`, which remains derived, independently clearable, generation-scoped, and never authoritative. The blocking search gate chooses its exact persisted shard or library layout before the declaration is frozen.
- A failed or unavailable derived index shows a bounded rebuild state. It cannot trigger a query-time scan of hundreds of MiB of core source rows or silently reduce an ordinary global search to title-only results.
- A later accepted query that cannot use these index families requires an explicit database-schema review and, where necessary, another database-version upgrade.

## Frozen Source-Side Fields And Dexie Declarations

Fields marked optional may be absent; no raw source-response body, network-error body, or unlisted payload field is retained. The representation and validation rules in the following section apply before any indexed write.

| Table | Required fields | Optional fields | Dexie declaration |
| --- | --- | --- | --- |
| `knowledgeVideos` | `bvid`, `availabilityState`, `createdAt`, `metadataUpdatedAt`, `lastLibraryActivityAt` | `avid`, `title`, `description`, `coverUrl`, `creatorName`, `creatorMid`, `categoryName`, `publicTags`, `durationSeconds`, `publishedAt`, `lastVerifiedAt`, `operationId` | `bvid, [lastLibraryActivityAt+bvid], operationId` |
| `knowledgeVideoParts` | `bvid`, `cid`, `availabilityState`, `createdAt`, `metadataUpdatedAt` | `title`, `durationSeconds`, `displayOrder`, `lastVerifiedAt`, `operationId` | `[bvid+cid], bvid, [bvid+displayOrder], operationId` |
| `knowledgeSourceAccounts` | `accountScopeId`, `externalAccountId`, `aliasOrdinal`, `connectedAt`, `lastVerifiedAt`, `updatedAt` | `nickname` | `accountScopeId, &externalAccountId` |
| `knowledgeSourceContainers` | `containerScopeId`, `sourceKind`, `ownerScopeId`, `externalContainerId`, `syncCompleteness`, `createdAt`, `updatedAt` | `label`, `description`, `reportedItemCount`, `lastSyncStartedAt`, `lastSyncFinishedAt`, `lastSuccessfulSyncAt` | `containerScopeId, ownerScopeId, [ownerScopeId+sourceKind]` |
| `knowledgeSourceRelations` | `containerScopeId`, `bvid`, `firstObservedAt`, `lastObservedAt` | `sourceAddedAt` | `[containerScopeId+bvid], containerScopeId, bvid` |

- `knowledgeVideos` and `knowledgeVideoParts` alone carry optional `operationId` because they may be staged by knowledge restore. Account, container, and source-membership rows are excluded from restore.
- `description`, `publicTags`, and other body-like metadata are not ordinary secondary indexes. Their global matching representation belongs only to the rebuildable search index after its gate passes.
- `lastVerifiedAt` changes only after a successful authoritative source result. Empty, failed, cancelled, and incomplete values preserve prior non-empty display fields.
- Video and part `availabilityState` is `pending_verification`, `available`, or `unavailable`. Migration and restore use pending; only a successful authoritative read selects available or unavailable.

## Frozen Asset, Relation, And Evidence Fields

| Table | Required fields | Optional fields | Dexie declaration |
| --- | --- | --- | --- |
| `knowledgeAssets` | `assetId`, `assetKind`, `title`, `tags`, `tagKeys`, `createdAt`, `updatedAt` | `userNote`, `userBody`, `savedContentKind`, `savedContentBlocks`, `savedQuestion`, `saveFingerprint`, `operationId` | `assetId, [updatedAt+assetId], [assetKind+updatedAt], *tagKeys, &saveFingerprint, operationId` |
| `knowledgeAssetSources` | `assetSourceId`, `assetId`, `sourceOrder`, `bvid`, `evidenceState`, `createdAt`, `updatedAt` | `cid`, `startSeconds`, `endSeconds`, `activeEvidenceVersionId`, `lastEvidenceCheckedAt`, `operationId` | `assetSourceId, &[assetId+sourceOrder], bvid, [bvid+cid], evidenceState, operationId` |
| `knowledgeEvidenceVersions` | `evidenceVersionId`, `assetSourceId`, `bvid`, `cid`, `sourceType`, `sourceVersionFingerprint`, `capturedText`, `startSeconds`, `endSeconds`, `supportedBlockOrdinals`, `capturedAt`, `createdAt` | `language`, `operationId` | `evidenceVersionId, [assetSourceId+createdAt+evidenceVersionId], bvid, [bvid+cid], operationId` |

- `assetKind` is `note`, `bookmark`, `excerpt`, or `saved_answer`. `savedContentKind` is `source_excerpt`, `generated_highlight`, `generated_summary`, `answer_excerpt`, or `qa_turn`.
- `savedContentBlocks` is an ordered non-empty array when saved content exists. `savedQuestion` is required for `answer_excerpt` and `qa_turn` and absent otherwise.
- `userBody` belongs only to a pure `note`. `savedContentBlocks` are immutable after creation; editing may change only title, `userNote`, `userBody` where allowed, tags, derived tag keys, and `updatedAt`.
- `evidenceState` is `not_applicable`, `current`, `changed`, `unavailable`, or `pending_revalidation`. A null active pointer requires `not_applicable`; a source-backed relation has a non-null pointer and another state.
- Every non-null active pointer targets a version owned by the same `assetSourceId`. The relation's current `bvid`, `cid`, `startSeconds`, and `endSeconds` projection equals the selected version; relocation updates that projection and pointer together while old evidence keeps its original values.
- `supportedBlockOrdinals` contains sorted unique safe integers. Source-backed excerpts and answers map every current evidence version to at least one in-range block; a bookmark snapshot may use an empty array.
- `saveFingerprint` is an optional sparse unique lowercase SHA-256 over a pinned canonical source-save origin excluding editable fields. It prevents racing duplicate selection and whole-turn saves but is not identity, UI, or an AI field.
- `tagKeys` are derived by trimming, Unicode NFKC normalization, and locale-independent lowercase. Duplicate keys retain the first display spelling in `tags`; the two arrays are validated together and neither creates a separate tag entity.
- All three tables allow optional restore-operation staging and therefore index `operationId`.

## Frozen Managed-Full-Text Fields

| Table | Required fields | Optional fields | Dexie declaration |
| --- | --- | --- | --- |
| `managedFullTextVersions` | `versionId`, `scopeKey`, `bvid`, `cid`, `sourceType`, `language`, `sourceVariantKey`, `sourceVersionFingerprint`, `bodyHash`, `timelineHash`, `segmentCount`, `coverageStartSeconds`, `coverageEndSeconds`, `serializedBytes`, `versionState`, `originKind`, `capturedAt`, `createdAt` | `currentScopeKey`, `languageLabel`, `lastVerifiedAt`, `restoredFromBackupCreatedAt`, `operationId` | `versionId, scopeKey, &currentScopeKey, bvid, [bvid+cid], versionState, operationId` |
| `managedFullTextSegments` | `versionId`, `ordinal`, `startSeconds`, `endSeconds`, `text` | `operationId` | `[versionId+ordinal], [versionId+startSeconds], operationId` |

- `sourceType` is `bilibili_subtitle` or the reserved future `local_transcript`; version 14.0 creates only `bilibili_subtitle`. It is a natural content-source category rather than a Bilibili endpoint, subtitle-track URL, or runtime adapter name.
- `language` is a trimmed, lowercase language key; missing source metadata becomes `und`. `languageLabel` may retain a natural source-provided display label, but ordinary UI falls back to “未标明语言” rather than showing `und`.
- `sourceVariantKey` is either exact `default` or a lowercase SHA-256. For a Bilibili subtitle, the hash input is the canonical `bilibili-subtitle-variant-v1` object containing only the stable trimmed non-URL track discriminator and a stable safe-integer track type when supplied; missing values are JSON `null`. Display labels, AI availability status, endpoint kind, host, subtitle URL, temporary cache identity, body, and timeline are excluded.
- When neither stable discriminator exists, the only representable variant is `default`. Two same-language candidates that collapse to it cannot coexist as distinct current tracks: selecting differing content requires explicit user confirmation, preserves the former version as historical, and uses natural “替换默认字幕版本” copy rather than claiming a known-track update.
- `scopeKey` is a deterministic lowercase SHA-256 over exact normalized `bvid`, positive `cid`, natural source type, normalized language, and exact `sourceVariantKey`. It groups all versions of one source scope without relying on mutable page order.
- `versionState` is `current`, `historical`, or `pending_revalidation`; `originKind` is `captured` or `restored`. Only a current version has `currentScopeKey`, and it equals that row's `scopeKey`. Historical and pending versions omit the sparse unique key.
- A backup-current version is restored as pending revalidation. A backup-historical version remains historical. Only a successful read of the real Bilibili video, exact part, source type, language, source variant, body, and timeline may promote a restored version to current.
- Body, timeline, source scope, capture time, segment count, coverage, and fingerprints are immutable. Only current-selection state, `lastVerifiedAt`, and restore-operation staging metadata may change after insertion.
- Every version owns at least one segment. Ordinals are contiguous safe integers from zero; text is non-empty and well-formed Unicode; `0 <= startSeconds < endSeconds`; start times never decrease. Source-provided overlaps are valid, and no synthetic segment is inserted merely to fill a gap.
- `segmentCount`, `coverageStartSeconds`, and `coverageEndSeconds` exactly match the complete owned segment set. All reads validate ownership before presenting a source as complete.
- `managedFullTextSegments` does not add a redundant `versionId` index because the `[versionId+ordinal]` primary key supports prefix traversal. The time index supports exact-version seek and ordered navigation without indexing text.
- Both tables permit restore-operation staging and index `operationId`. No subtitle URL, raw endpoint or response body, runtime error, provider detail, temporary cache ID, or unsupported source field is retained.

### Canonical full-text hashes

- Every canonical hash input declares `managed-full-text-v1`, uses explicitly ordered object construction plus ECMAScript `JSON.stringify`, encodes UTF-8 without a BOM, and uses LF where a record stream is required. Inputs reject lone surrogates, non-finite numbers, negative zero, and values that violate the field contract.
- `bodyHash` is lowercase SHA-256 over one LF-terminated canonical record per ordinal containing `contract`, `ordinal`, and exact `text`. Source text is not Unicode-normalized, trimmed, collapsed, or punctuation-rewritten.
- `timelineHash` is lowercase SHA-256 over one LF-terminated canonical record per ordinal containing `contract`, `ordinal`, `startSeconds`, and `endSeconds`.
- `scopeKey` is lowercase SHA-256 over one canonical object containing `contract`, normalized `bvid`, exact positive `cid`, natural `sourceType`, normalized `language`, and exact `sourceVariantKey`.
- `sourceVersionFingerprint` is lowercase SHA-256 over one canonical object containing `contract`, `scopeKey`, `bodyHash`, and `timelineHash`. Version UUID, lifecycle state, verification time, and restore origin do not affect source equality.

### Canonical asset-save fingerprint

- `saveFingerprint` uses the separate `knowledge-save-origin-v1` contract. Its single canonical JSON object contains saved-content kind, exact saved question or `null`, immutable saved-content blocks in order, and source origins in `sourceOrder` order.
- Every source-origin projection contains exact `bvid`, exact `cid` or `null`, start and end seconds or `null`, source-version fingerprint, captured evidence text, and sorted supported block ordinals. It includes no generated UUID.
- Asset title, personal note, editable note body, tags, derived tag keys, lifecycle timestamps, provider/model/prompt fields, and operation markers are excluded. Deleting an asset removes its sparse unique fingerprint and permits a later intentional save of the same origin.

## Field Representation And Validation

- `bvid`, local UUIDs, source-kind values, language values, and other enumerated domain codes are strings validated against their owning contract. BVID trims surrounding ASCII whitespace, must match `^BV[0-9A-Za-z]{1,62}$`, and preserves exact case. Durable random IDs use canonical lowercase RFC 4122 UUIDv4; deterministic restore-conflict IDs use canonical lowercase UUIDv5.
- `externalAccountId` and `externalContainerId` are canonical non-negative decimal strings. Leading plus signs, whitespace, exponent notation, decimals, and lossy number-to-string conversions are rejected.
- `avid`, `creatorMid`, display order, counts, ordinals, and byte sizes are non-negative JavaScript safe integers. Every `cid` stored by `knowledgeVideoParts`, `knowledgeAssetSources`, `knowledgeEvidenceVersions`, or managed-full-text rows is a positive JavaScript safe integer; a whole-video asset-source relation omits `cid` instead of storing zero.
- Every field ending in `At` is a non-negative Unix-millisecond safe integer. Every field ending in `Seconds` is finite and non-negative; timing order is additionally validated by the owning evidence or segment contract.
- `NaN`, positive or negative infinity, negative values, unsafe integers, malformed decimal strings, and values already rounded by an unsafe conversion cannot enter version-14 tables.
- The v13-to-v14 migration promotes an old numeric value only when it is already finite, integral, in range, and lossless. Otherwise the original row remains in its existing source store and no guessed canonical video, part, account, container, or relationship is created.
- Backup serializes these JSON types as stored. Restore validates the same types before staging and never parses a decimal-string external scope through a JavaScript number.

## Frozen Auxiliary State And Operation Fields

| Table | Required fields | Optional fields | Dexie declaration |
| --- | --- | --- | --- |
| `knowledgeStorageState` | `stateKey`, `managedFullTextBytes`, `managedFullTextVersionCount`, `updatedAt` for the `managed-fulltext-usage` variant | `lastVerifiedAt` | `stateKey` |
| `knowledgeOperations` | `operationId`, `kind`, `lockScope`, `state`, `phase`, `checkpointBatchOrdinal`, `processedRecordCount`, `processedBytes`, `startedAt`, `updatedAt` | `checkpointEntry`, `checkpointRecordOrdinal`, `checkpointByteOffset`, `archiveFingerprint`, `targetGenerationId`, `cancelRequestedAt`, `committedAt`, `failureCode` | `operationId, &lockScope, [kind+state], updatedAt` |

- `kind` is `restore`, `backup_export`, `search_rebuild`, or `fulltext_ledger_repair`. No generic caller-defined operation kind is accepted.
- `lockScope` is `knowledge_snapshot`, `search_index`, or `fulltext_ledger`. The unique index prevents two operations in one scope; the acquisition transaction additionally enforces the cross-scope conflict matrix.
- Restore is exclusive with every other maintenance operation. Backup export conflicts with restore and ledger repair, but it may coexist with generation-isolated search rebuild because backups exclude the derived index and export already freezes source mutations. Ledger repair blocks full-text mutations; search rebuild never authorizes a source mutation.
- `state` is `preparing`, `running`, `commit_ready`, `committed`, `normalizing`, `cancelling`, or `cleaning`. `phase` is selected from the exact kind/state matrix in ADR 0083 and never accepts arbitrary display copy. Restore uses `envelope_preflight`, `staging_entries`, `validating_candidate`, `visibility_committed`, `clearing_markers`, `cancel_requested`, or `removing_staged`; export uses `snapshot_locked`, `writing_entries`, `finalizing_and_readback`, `destination_verified`, `cancel_requested`, or `releasing_export`; search rebuild uses `allocating_generation`, `indexing_sources`, `verifying_generation`, `activating_generation`, `removing_stale_generations`, `cancel_requested`, or `removing_target_generation`; ledger repair uses `scanning_versions`, `recomputing_versions`, `verifying_total`, `publishing_total`, `cancel_requested`, or `releasing_repair`.
- Counters, byte offsets, and batch ordinals are non-negative safe integers. Checkpoints advance only after the corresponding bounded transaction commits, so recovery may redo at most the current uncommitted batch.
- `checkpointEntry` may name only a fixed backup-format entry, `archiveFingerprint` is a lowercase SHA-256 over the validated manifest contract, and `failureCode` is absent or one of `cancel_requested`, `worker_interrupted`, `source_reselection_required`, `destination_incomplete`, `invalid_archive`, `unsupported_backup_version`, `integrity_mismatch`, `capacity_exceeded`, `quota_exceeded`, `read_failed`, `write_failed`, `cleanup_failed`, `index_verification_failed`, `ledger_invalid`, or `operation_conflict`. No raw exception, file name, file path, handle, user text, source text, archive body, or provider response is stored.
- The table is an active journal, not permanent operation history. Successful completion or completed cleanup deletes the row in the same transaction that releases its final lock-bearing state.
- Ordinary repositories show rows without `operationId` and rows whose owning restore is `committed` or `normalizing`. Pre-commit staged rows and orphan-marked rows remain invisible; orphan recovery removes them in bounded cleanup.
- Because selected file handles are not retained, restore or export cannot resume its user-selected stream after worker loss. Restore resumes cleanup and asks for a fresh file selection; export releases the journal and explains that an incomplete destination file may need manual removal. Search rebuild and ledger repair may resume from validated checkpoints.

## Canonical Video-Metadata Merge

- `knowledgeVideos` retains normalized `bvid`, optional known `avid`, last-known title, description, cover, creator name and public creator identifier where already supplied by an authorized source, duration, publication time, availability state, and last successful verification time.
- `knowledgeVideos` separately retains and indexes `lastLibraryActivityAt`. It initializes when the canonical video first enters the local space and updates when related durable knowledge is saved, edited, or deleted, or managed full text is admitted, accepted, or removed.
- Metadata updates, verification timestamps, repeated synchronization, and an additional synchronized relationship to an already-known video never update `lastLibraryActivityAt`. Default 视频资料 reads order it descending and use normalized `bvid` as a deterministic tie-breaker.
- `knowledgeVideoParts` retains `[bvid, cid]`, last-known part title, duration, display page/order, and last successful verification time. Changing page order never creates another part.
- A source refresh updates only fields actually present in a successful sufficiently complete result. Missing or empty fields preserve the prior non-empty value; a failed or incomplete sync is never interpreted as authoritative blank metadata.
- Deleted, private, or temporarily unavailable sources retain the snapshot and use a natural unavailable-for-verification state. They are not removed while any accepted retention reference remains.
- Knowledge backup includes the minimum last-known snapshot needed to identify every referenced video and part offline. Restore keeps local non-empty values, fills missing values from backup, and waits for a later real source refresh instead of using backup or device timestamps as a winner rule.
- Backup retains the original valid knowledge-library activity times required by its referenced videos and assets. Restore reconstructs ordering from those retained values and never assigns the restore wall-clock time to every imported video.
- Video metadata cannot overwrite an asset's user-authored title, body, note, or tags and cannot support a claim about video content.
- Only a successful complete part-list read may reconcile previously known parts that are now absent. A failed, cancelled, or partial read performs upserts only and cannot erase or mark absent parts.
- An observed exact `cid` refreshes only its mutable last-known title, duration, display order, availability, and verification time. Reordering changes display metadata and never identity.
- A `cid` absent from a complete list remains with an unavailable-for-verification state while any asset-source relation, evidence version, current or historical full-text version, or other accepted durable record references `[bvid, cid]`. An absent part with no durable reference is deleted as an empty shell.
- A newly observed `cid` creates another part even when it occupies a formerly used page number. No evidence pointer, evidence version, full-text version, timestamp, or navigation target transfers by page equality.
- A whole-video inaccessible, private, deleted, failed, or incomplete result preserves referenced parts and their snapshots. It is not interpreted as a complete zero-part response.

## Synchronized Source-Reconciliation Contract

- `source kind` distinguishes favorite from watch-later and is never inferred from display copy.
- Version 14 source kind is exactly `favorite` or `watch_later`; adding another family requires a schema-contract review rather than accepting an arbitrary string.
- `local account scope` distinguishes relationships supplied by different authorized Bilibili accounts. It is a random local UUID and remains the only account value copied into relationship rows or their deterministic keys.
- Account-scope metadata is acquired only from the response to a user-initiated authorized sync. It stores the minimum local identifier plus nickname; no Cookie file, login-state file, browser profile, key file, avatar, or account profile is read or retained.
- One auxiliary `knowledgeSourceAccounts` row owns `accountScopeId`, the authorized response's stable Bilibili UID as canonical decimal-string `externalAccountId`, available nickname, stable fallback-alias ordinal, and connection or verification timestamps. `externalAccountId` has one local unique index and is never shown or propagated beyond account matching.
- A response without a stable external account ID cannot create or select an account row. Nickname-only matching is forbidden, while a later nickname change updates only display metadata.
- The source UI shows the nickname or, when unavailable, a stable local alias such as “已连接账号 1”. It never exposes the account identifier.
- `source container` is represented by one `knowledgeSourceContainers` row. Its deterministic `containerScopeId` covers exact source kind, confirmed `accountScopeId` or reserved legacy scope, and external container ID.
- Favorite folders use their positive real `mediaId` as canonical decimal-string external container IDs. Watch-later and the upgrade-era ungrouped-favorite container use `0` within their distinct source kinds. Container titles, public descriptions, reported counts, completeness, and timestamps are mutable metadata only.
- Container `syncCompleteness` is `legacy_unverified`, `incomplete`, or `complete`; only complete permits absence-based deletion. `ownerScopeId` is a connected account's local UUID or reserved `legacy-v13`.
- `containerScopeId` is exact ASCII `ksc1|<kindLength>:<sourceKind>|<ownerLength>:<ownerScopeId>|<containerLength>:<externalContainerId>`, with canonical decimal character counts and no leading zero. It never embeds the external account identifier.
- A container row remains valid when it has zero video memberships. Source relationships reference `containerScopeId` and never copy its label, count, or synchronization state.
- A normalized `bvid` identifies the video membership. An `avid`-only legacy row remains outside canonical source relations as `视频信息待补全` until a real `bvid` is obtained.
- The deterministic relationship identity `[containerScopeId, normalized bvid]` is equivalent to the accepted source-kind plus account-scope plus container plus video key and does not weaken isolation.
- A complete sync may delete only relationships absent from each exact `containerScopeId` that the sync covered completely. It cannot delete another account's, another container's, or an upgrade-era unknown-account relationship by omission.
- An incomplete, blocked, cancelled, or failed sync performs upserts only. It cannot treat a partial page set as authoritative absence.
- Upgrade-era favorite relationships use a distinct unknown-account source scope. A later authorized complete favorite sync may reconcile one only through the already accepted exact folder-and-video match; otherwise it remains independent.
- A newly detected account is not admitted automatically. Disconnecting a confirmed account removes only that account scope, its containers, and its synchronized relationships; canonical videos survive whenever another relationship, durable asset, or full-text version retains them.
- Disconnecting or clearing one connected source account deletes its registry row, exact containers, and exact account-scoped relationships in one Dexie transaction, then applies the accepted canonical-video empty-shell retention check. It cannot affect another account scope.
- The external identifier, local scope, nickname, and alias are excluded from knowledge backup, ordinary diagnostics, logs, AI requests, and knowledge-size reporting. A local hash-and-salt identity layer is not introduced because it would live inside the same storage boundary without removing the matching identifier requirement.

## Atomic Write Groups

- Creating any asset commits the asset and at least one required video source relation together. A source-backed asset additionally commits every initial evidence version in that same atomic outcome; a pure whole-video note uses `not_applicable` with a null evidence pointer.
- An asset-level saved-content block array is written once in that creation transaction. Multi-source evidence versions map to it and cannot own duplicate authoritative copies of the answer, summary, highlight, or selected generated wording.
- Saving an edit updates only the selected asset's current user layer in one transaction. Cancel writes nothing, and editing never changes evidence-version rows.
- Relocating one source commits a new immutable evidence version and switches only that relation's `activeEvidenceVersionId` in one transaction. The prior evidence row is not rewritten.
- Every non-null evidence pointer is validated on create, readback, backup, restore, and UUID-conflict rewrite: its target must exist and have the same asset-source relation ID. An unsourced whole-video relation may keep a null pointer.
- Admitting, accepting, restoring, or deleting one managed full-text version commits its version record and complete segment set together.
- `currentScopeKey` is a sparse unique secondary key present only on the current version. It is derived from normalized `bvid`, exact positive `cid`, natural source type, normalized language, and exact source variant; `page` is excluded.
- Accepting changed text removes the old current key and inserts the new complete version with that key in one transaction. Any uniqueness, capacity, segment, or readback failure rolls back the old key removal.
- Historical and restored-pending-validation versions have no current key. Real-source revalidation is required before a restored version may acquire it.
- `清空知识库` removes the durable knowledge graph and managed full text in one knowledge-store transaction, then removes or rebuilds derived index data. It does not clear synchronized source relations.
- Core v13-to-v14 migration creates the accepted schema and eligible legacy-derived records in one upgrade transaction. It performs no network, AI, subtitle retrieval, or full-text work.
- Exact projection, tie-break, empty-target, rollback, and fixture rules are frozen in [the migration contract](./migration-contract-0.14-personal-video-knowledge-base.md). No runtime implementation may substitute current account state, wall-clock order, an avid-to-BVID guess, or current-video cache promotion.

## Large-Restore Atomic-Visibility Protocol

- A restore creates one `knowledgeOperations` row with a stable operation ID, kind `restore`, `knowledge_snapshot` lock scope, lifecycle state, validated manifest fingerprint, progress checkpoint, and timestamps. The journal stores no file identity, handle, user text, source text, or archive body.
- Archive entries are streamed, checked, and staged in bounded transactions. Newly staged core rows carry the operation ID and are excluded from every ordinary repository read while the operation is uncommitted.
- Knowledge browsing remains available from the pre-restore state. New knowledge saves, edits, deletions, full-text admission/removal, other restores, knowledge clear, and synchronized-source writes pause with a natural “正在恢复知识库” state until commit, cancellation, or cleanup completes.
- Preflight checks the ZIP directory, manifest, declared limits, and browser storage headroom before staging. The Gate freezes a conservative multiplier and reserve from observed staging overhead; the estimate may refuse work early but can never authorize the final commit. Final validation rechecks checksums, JSONL shape, duplicate IDs, references, conflict rewrites, exact managed-full-text bytes, quota outcome, and current local state before commit.
- One small commit transaction changes the operation to `committed`, applies the exact managed-full-text ledger delta plus bounded missing-metadata patches, and thereby makes all staged rows visible together. It does not rewrite every segment's visibility state in that transaction.
- After commit, repositories treat rows belonging to the committed operation as visible while a resumable background normalization clears operation markers in batches. The journal remains until normalization and readback finish, then is deleted.
- Cancellation or any pre-commit failure removes only invisible staged rows in bounded batches. A worker interruption resumes cleanup from the recorded checkpoint; because the selected source handle is not retained, it never silently reopens or restarts the restore and requires a fresh file selection for another attempt.
- A quota or disk failure during staging reports that restore did not complete and preserves the pre-restore knowledge space. The operation cannot claim atomic success merely because some physical rows were written.
- The protocol must pass near-500-MiB full and lightweight restore fixtures, cancellation at each lifecycle phase, malformed archive, capacity refusal, quota failure, duplicate/conflict handling, extension reload, MV3 worker interruption, cleanup, and post-commit readback before runtime release.
- Backup format v1 and deterministic conflict handling are frozen in [the backup contract](./backup-contract-0.14-personal-video-knowledge-base.md). Restore stages only that fully validated post-deduplication graph; random conflict suffixes, per-video ZIP paths, and trust in backed-up derived byte or tag keys are forbidden.

## Streaming Backup Export

- The dashboard's explicit export click calls the supported system save picker before hashing, compression, database enumeration, or other asynchronous work. This preserves the required transient user activation and yields the destination handle before the operation lock begins.
- After destination selection, `knowledgeOperations` records the export and pauses knowledge plus synchronized-source mutations while ordinary reads remain available. The exporter captures stable counts and identities, then writes deterministic JSONL entries and `manifest.json` through a bounded-memory streaming ZIP writer directly to the file's writable stream.
- Export never assembles the complete ZIP as a Blob and never adds the extension `downloads` permission. The stream is closed only after all declared entries, counts, uncompressed byte totals, and SHA-256 values complete successfully.
- Cancellation, source read failure, compression failure, disk/quota failure, dashboard closure, and extension reload must not report success or retain an operation lock. The implementation gate records whether the platform leaves an incomplete destination file and ensures the UI tells the user naturally when manual removal may be required.
- When `showSaveFilePicker` or writable-file streaming is unavailable, only a separately benchmarked small backup may use a Blob/download fallback. A large backup refuses before archive construction and asks the user to use a supported current Chrome version; it cannot risk an unbounded in-memory fallback.
- Restore accepts only a ZIP explicitly selected for the current operation, streams its bytes, and does not persist a file handle or later reopen files automatically.
- A worker interruption cannot resume an export stream from the journal. Recovery releases the operation after bounded cleanup and reports that the user-selected incomplete destination may need manual removal; it never claims a completed backup.
- Official capability evidence checked on 2026-08-10: [Chrome File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) documents user-gesture picker timing and writable file streams; [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads) documents the required `downloads` manifest permission.

## Separate Local-Data Lifecycles

- `个人知识数据`: durable assets, editable user fields, asset-source relations, and evidence versions. Per-asset deletion or `清空知识库` only.
- `完整文本数据`: full-text versions and segments. Managed through `空间管理` and also removed by `清空知识库`.
- `知识检索索引`: derived and independently clearable/rebuildable.
- `重置 Bili-Bill（保留知识库）` may clear ordinary module data, settings, temporary caches, and the derived index, but preserves the first two categories.

## Managed-Full-Text Capacity Ledger

- Each `managedFullTextVersions` row stores `serializedBytes`, computed with `managed-full-text-v1` before admission. Its canonical UTF-8 stream is one LF-terminated version-metadata JSON record followed by every LF-terminated segment JSON record in ordinal order, without a BOM.
- The metadata projection contains, in order, `record`, `contract`, `versionId`, `scopeKey`, `bvid`, `cid`, `sourceType`, `language`, nullable `languageLabel`, `sourceVariantKey`, `sourceVersionFingerprint`, `bodyHash`, `timelineHash`, `segmentCount`, `coverageStartSeconds`, `coverageEndSeconds`, `originKind`, `capturedAt`, `createdAt`, and nullable `restoredFromBackupCreatedAt`. Each segment projection contains `record`, `contract`, `ordinal`, `startSeconds`, `endSeconds`, and exact `text`.
- `versionState`, `currentScopeKey`, `lastVerifiedAt`, `serializedBytes`, `operationId`, and browser storage overhead are excluded from that stable capacity projection. Restore recalculates the projection after a UUID or restore-origin rewrite instead of trusting a backed-up byte count.
- One `knowledgeStorageState` row keyed `managed-fulltext-usage` stores aggregate `managedFullTextBytes`, `managedFullTextVersionCount`, `updatedAt`, and optional `lastVerifiedAt`. Its Dexie declaration is only `stateKey`; no secondary index is needed.
- The singleton row is an acceleration ledger, not an independent source of truth or generic configuration bag. No text, account data, file path, or raw error belongs in it.
- Adding or removing a version updates the version/segment rows and aggregate ledger in the same transaction. The final 500-MiB check runs against the exact transaction-local total; preflight estimates cannot authorize a write.
- Database open compares the ledger with a sum of per-version `serializedBytes` values without reading every segment body. Missing, negative, malformed, overflowed, or mismatched values block new full-text writes and start repair.
- Repair recomputes invalid per-version values from their complete canonical metadata and segments, then rewrites the aggregate. Existing text remains readable during repair, while new retained-text admission states naturally that space usage is being checked.
- The warning threshold is exactly 419,430,400 canonical bytes and the hard boundary is exactly 524,288,000 canonical bytes. A resulting total at or above the warning threshold is warned; a result above the hard boundary is refused. Exactly 500 MiB may commit and then reports full.
- Existing malformed, unsafe, or over-limit data remains readable and exportable but blocks another full-text write until ledger repair or explicit storage management. ZIP compression ratios, temporary current-video caches, and rebuildable indexes do not change the result.

## Existing QA-Session Store Evolution

- The existing physical `currentVideoQaSessions` table remains in place and is not counted among the nine new knowledge tables.
- Session records gain an internal format version. Existing records decode as legacy single-source turns and remain readable without an eager row-copy migration.
- New-format turns store their resolved evidence scope plus an ordered set of exact video-or-part source snapshots. Full transcripts are not duplicated into session rows; source snapshots preserve only the accepted compact identity, natural labels, answer, and mapped citation evidence needed for later review.
- One session may contain turns submitted from different active videos or from a bounded cross-video source set. Each turn remains bound to the evidence captured when it was submitted.
- Domain APIs and visible copy use the generic term 问答会话, while the physical table name remains an internal compatibility detail for version 14.
- The existing 200-session and 25-MiB bounded-history behavior remains the compatibility baseline pending serialized multi-source fixture validation. Eviction or explicit session deletion cannot remove an independently saved knowledge asset.
- QA sessions remain ordinary local-data history: `重置 Bili-Bill（保留知识库）` may clear them, `清空知识库` does not, and knowledge backup excludes them.

## Blocking Global-Search Feasibility Gate

- No runtime global-full-text search issue may begin before both the deterministic synthetic-fixture foundation and the separately reviewed public-safe Bilibili-subtitle distribution calibration pass, followed by the Chrome MV3 candidate gate at 100, 400, and 500 MiB. Synthetic fixture success alone does not establish representativeness. Synthetic future-compatible local-transcript rows may test schema and load only; they do not claim an ASR capability.
- Compare at least an IndexedDB lexical-index design and one proven search library whose index can be built, persisted, loaded, and resumed in bounded chunks. A vector-only design is ineligible, and semantic indexing remains optional follow-up validation.
- Record source bytes, indexed documents and fragments, build and resume duration, peak process or JS-heap growth where measurable, persisted index bytes, warm and cold Chinese/English query latency, result integrity, cancellation latency, checkpoint recovery, rebuild behavior, and MV3 worker-restart behavior.
- The test must include add-one-version, remove-one-version, evidence-preserving full-text removal, index clear/rebuild, and crash/restart cases. The index must never be the sole copy of text or leave deleted personal text searchable after a completed rebuild.
- Gate failure blocks implementation and returns the 500-MiB capacity or global-full-text search scope to product review. It cannot be waived by searching metadata only, scanning the complete text corpus on each query, or hiding a title-only fallback behind ordinary search copy.
- Every gate report records the release-QA machine's CPU, memory, operating system, Chrome version, extension build, fixture hashes, run count, and cold/warm procedure. Missing required measurements are `insufficient_evidence`, not a pass.
- Initial build must complete within 3 minutes at 100 MiB, 12 minutes at 400 MiB, and 15 minutes at 500 MiB. A candidate that passes only smaller fixtures does not establish the accepted boundary.
- Peak JavaScript-heap growth above the recorded idle baseline must not exceed 256 MiB. Persisted search-index bytes must not exceed 1.5 times managed source bytes.
- At 500 MiB, warm-query p95 must be at most 500 ms and cold-query p95 at most 2 seconds across the fixed Chinese/English suite. Every deliberately planted exact target must be found under its declared expected-result contract.
- Indexing must keep each UI-main-thread block at or below 200 ms. Cancellation is acknowledged within 1 second and produces no new writes after 2 seconds.
- After MV3 worker interruption, resume may redo at most one checkpoint batch and must not restart the complete build, duplicate postings, or expose a mixed generation as current.
- Adding or removing one deterministic 1-MiB full-text version must update the current index within 10 seconds. After completed removal and rebuild/readback, none of that version's source text may remain searchable.

## Open Storage Details

- The rebuildable search-index field and store declaration selected by the blocking global-search feasibility gate.
- Exact bounded batch sizes and transaction checkpoints for near-limit backup and restore, selected by the blocking restore gate.
- The maximum verified Blob fallback size for environments without writable-file streaming.
- Search-index generation marker, resumability, and stale-read behavior after the blocking feasibility gate selects an approach.
- Exact new-format QA-session and multi-source-turn fields after fixture validation.
