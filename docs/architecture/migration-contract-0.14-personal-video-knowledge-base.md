# 0.14 Personal Video Knowledge-Base Migration Contract

**Status:** DEFERRED FULL-LIBRARY MIGRATION. [The bounded learning-loop scope](../scope-0.14-bounded-learning-loop.md) takes precedence for 0.14.0 on scope-PR review and merge. Its migration adds only the bounded schema frozen by LG-0 and preserves existing v13 records; the favorite projections and full-library stores below are not bounded-release obligations. No runtime migration is implemented or authorized by this document.

## Verified Version-13 Baseline

The current `BiliAnalyticsDB` version 13 contains `favoriteFolders`, `favoriteItems`, `smartFavoriteIndex`, `currentVideoTranscriptSources`, `currentVideoTranscriptSegments`, `currentVideoSummaryHighlights`, and `currentVideoQaSessions` alongside watch-history and Dynamic Bill stores. It has no durable knowledge table, managed-full-text table, connected source-account registry, source-container registry, or watch-later membership table.

The migration therefore has exactly two eligible legacy inputs:

- `favoriteFolders`: folder identity and last-known display/synchronization metadata.
- `favoriteItems`: folder membership, BVID where already present, public video snapshot, favorite time, and synchronization time.

Smart Favorite generated classification, current-video text caches, summary/highlight caches, QA sessions, watch history, followed creators, and Dynamic Bill data are not migration evidence for personal knowledge.

## Schema Upgrade Boundary

- `version(14).stores(...)` repeats every version-13 declaration unchanged and adds the durable and auxiliary declarations frozen in the storage contract. The derived search store declaration is inserted only after its blocking gate selects a layout; no runtime v14 upgrade ships with a placeholder schema that would force a second migration.
- The Dexie `upgrade` callback reads and writes IndexedDB only. No extension message, browser tab, source API, AI provider, file picker, or current-video cache adapter participates.
- All projection writes remain inside the one Dexie version-upgrade transaction. Chunked `bulkPut` may reduce working memory but cannot commit independently.
- The existing stores are neither cleared nor rewritten. Failure aborts new schema and projection writes and leaves version 13 available for another open attempt.

## Legacy Source Scope

- The reserved owner scope is exact `legacy-v13`; it has no `knowledgeSourceAccounts` row and is never presented as a connected account.
- Every positive safe-integer folder `mediaId` becomes its canonical decimal-string `externalContainerId`. A valid-BVID item whose folder ID is absent, zero, negative, unsafe, or malformed uses external container `0`, shown naturally as “升级前未分组收藏”.
- Container scope uses exact ASCII `ksc1|<kindLength>:<sourceKind>|<ownerLength>:<ownerScopeId>|<containerLength>:<externalContainerId>`. Folder rows and item-only containers converge on the same identity without an asynchronous hash inside the upgrade transaction.
- All migrated containers use `sourceKind: favorite` and `syncCompleteness: legacy_unverified`. No migrated absence may delete a relationship until a later user-authorized complete sync reconciles that exact folder and video.

## Canonical Video Projection

Only an item whose trimmed BVID passes `^BV[0-9A-Za-z]{1,62}$` participates. Candidate rows for one BVID sort by descending valid `syncedAt`, descending valid `favTime`, and ascending `itemKey`. For each optional field, migration takes the first valid non-empty value in that order:

| Legacy field | Canonical field |
| --- | --- |
| `avid` | `avid` when a positive safe integer |
| `title` | `title` |
| `intro` | `description` |
| `cover` | `coverUrl` |
| `authorName` | `creatorName` |
| `authorMid` | `creatorMid` when a positive safe integer |
| `tagName` | `categoryName` |
| `tags` | `publicTags` after non-empty string validation and stable de-duplication |
| `duration` | `durationSeconds` when finite and non-negative |
| `pubtime` | `publishedAt` after accepted timestamp validation |

Every created video uses `availabilityState: pending_verification`. `createdAt` is the earliest valid `favTime` or `syncedAt` across candidates, falling back to zero. `metadataUpdatedAt` is the latest valid source time, falling back to zero. `lastLibraryActivityAt` is the latest valid `favTime`, then latest valid `syncedAt`, then zero. These are deterministic initial ordering values; a later metadata refresh or repeated sync does not bump library activity.

Migration creates no `knowledgeVideoParts` row because version-13 favorites contain no verified exact `cid`/part-list contract. An `avid`-only row is not converted to a BVID, and a malformed BVID does not create a provisional video.

## Container And Relationship Projection

- A folder-backed container takes validated `title`, `intro`, and `mediaCount` as label, description, and reported count. Item-only and ungrouped containers may omit all three.
- Container `createdAt` is the earliest valid folder creation, folder synchronization, item favorite, or item synchronization time in that scope. `updatedAt` is the latest corresponding valid time. Missing all source times yields zero.
- One relation is emitted per exact `[containerScopeId, bvid]`. `firstObservedAt` is the earliest valid item favorite or sync time and `lastObservedAt` is the latest; missing both yields zero. `sourceAddedAt` is present only for a valid favorite time.
- Duplicate legacy item rows merge deterministically. They never create duplicate canonical videos or source memberships.

## Empty Targets

The migration leaves these new tables empty: `knowledgeVideoParts`, `knowledgeSourceAccounts`, `knowledgeAssets`, `knowledgeAssetSources`, `knowledgeEvidenceVersions`, `managedFullTextVersions`, `managedFullTextSegments`, `knowledgeOperations`, and the gated `knowledgeSearchIndex`. It creates no watch-later container because version 13 has no eligible watch-later source table.

`knowledgeStorageState` receives exactly one `managed-fulltext-usage` row with byte and version totals zero and `updatedAt: 0`; post-open verification may set a real verification time without changing migration success.

## Post-Open Work

- Repositories verify graph invariants and the zero full-text ledger before enabling knowledge writes.
- Search and tag-suggestion data build only through the separately gated resumable index process. Failure leaves core knowledge usable with an explicit rebuild state and does not roll back the database upgrade.
- Account discovery, favorite reconciliation, watch-later synchronization, video/part verification, subtitle acquisition, and full-text admission require later explicit authorized actions.
- A failed open states “知识库升级未完成，可重试”. Raw Dexie errors remain internal and no automatic reset or database deletion is offered.

## Required Migration Fixtures

Fixtures cover empty v13, one valid favorite, duplicate BVIDs across folders, item-only folder scope, avid-only rows, malformed and whitespace BVIDs, unsafe numeric IDs, missing optional metadata, deterministic tie breaks, empty folders, legacy Smart Favorite rows, persistent transcript caches, QA sessions, large favorite sets, injected transaction failure, reopen retry, and unchanged counts/content in every pre-existing store.
