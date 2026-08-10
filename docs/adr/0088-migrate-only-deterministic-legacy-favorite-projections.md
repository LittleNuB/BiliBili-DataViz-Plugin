---
status: accepted
---

# Migrate only deterministic legacy-favorite projections

The version-13 to version-14 Dexie upgrade preserves every existing table and creates only deterministic projections from `favoriteFolders` and `favoriteItems`. Each valid favorite folder or item container becomes a `favorite` container owned by `legacy-v13` with `legacy_unverified` completeness. A valid favorite item BVID creates or merges one pending canonical video and one exact container membership; an invalid or missing folder ID uses the reserved legacy ungrouped container `0`. Items without a valid BVID remain only in the existing favorite store as “视频信息待补全”.

When several rows describe one BVID, metadata candidates sort by descending valid `syncedAt`, descending valid `favTime`, then ascending `itemKey`; each field takes the first valid non-empty candidate. Creation time uses the earliest valid favorite or sync time, metadata update time uses the latest, and initial knowledge-library activity uses the latest valid favorite time with latest sync time as fallback. Invalid optional values are omitted, never rounded. Containers and relationships use corresponding deterministic minimum/maximum valid source times, with zero only when no valid source time exists.

The upgrade creates no parts, accounts, knowledge assets, evidence, managed full text, operation rows, QA copies, or search content; it initializes the managed-full-text usage ledger to zero. It performs no network, AI, source synchronization, subtitle read, transcript promotion, UUID conflict work, or wall-clock winner selection. Existing favorites, Smart Favorite rows, current-video caches, QA sessions, and all unrelated module data remain unchanged. Any exception aborts the whole Dexie upgrade, after which the version-13 database remains the retry source and no cleanup path clears it.
