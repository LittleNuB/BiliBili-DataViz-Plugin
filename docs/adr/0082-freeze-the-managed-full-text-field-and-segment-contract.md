---
status: accepted
---

# Freeze the managed-full-text field and segment contract

Managed complete text uses the exact fields and Dexie declarations below.

| Table | Required fields | Optional fields | Dexie declaration |
| --- | --- | --- | --- |
| `managedFullTextVersions` | `versionId`, `scopeKey`, `bvid`, `cid`, `sourceType`, `language`, `sourceVariantKey`, `sourceVersionFingerprint`, `bodyHash`, `timelineHash`, `segmentCount`, `coverageStartSeconds`, `coverageEndSeconds`, `serializedBytes`, `versionState`, `originKind`, `capturedAt`, `createdAt` | `currentScopeKey`, `languageLabel`, `lastVerifiedAt`, `restoredFromBackupCreatedAt`, `operationId` | `versionId, scopeKey, &currentScopeKey, bvid, [bvid+cid], versionState, operationId` |
| `managedFullTextSegments` | `versionId`, `ordinal`, `startSeconds`, `endSeconds`, `text` | `operationId` | `[versionId+ordinal], [versionId+startSeconds], operationId` |

`sourceType` is `bilibili_subtitle` or the reserved future value `local_transcript`; version 14.0 creates only the former. Missing source-language metadata becomes normalized `und`, while an optional natural label may be retained for display. `sourceVariantKey` is exact `default` when the platform supplies no stable non-URL discriminator, otherwise lowercase SHA-256 over the fixed `bilibili-subtitle-variant-v1` projection of stable track ID and stable track type. It excludes display label, AI status, endpoint, host, URL, cache identity, body, and timeline. `versionState` is `current`, `historical`, or `pending_revalidation`, and `originKind` is `captured` or `restored`. Only a `current` version has `currentScopeKey`, which exactly equals its required `scopeKey`; historical and pending versions omit it. A restored backup-current version becomes pending, a restored historical version remains historical, and only successful real-source revalidation may make a restored version current.

Every managed version has a positive safe-integer `cid`. Scope identity is exact video, part, source type, normalized language, and source variant. If two same-language Bilibili tracks cannot be stably distinguished and therefore both map to `default`, they cannot coexist as separate current variants; accepting differing content requires an explicit replacement confirmation and retains the prior default version as historical.

The body, timeline, identity, hashes, capture time, and segment set are immutable after insertion. Only current-selection state, successful verification time, and restore-operation staging metadata may change. Segment ordinals are contiguous safe integers beginning at zero, every segment has non-empty well-formed text and `0 <= startSeconds < endSeconds`, and start times never decrease. Source-provided segment overlap is allowed, while gaps need not be synthesized. Stored coverage and segment count must exactly match the complete owned set. Both tables support restore-operation cleanup, and no raw subtitle URL, endpoint name, response body, runtime error, provider field, or temporary cache identity enters either table.
