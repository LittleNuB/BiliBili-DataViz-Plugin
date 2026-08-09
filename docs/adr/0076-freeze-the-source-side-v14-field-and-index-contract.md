---
status: accepted
amended-by: 0077
---

# Freeze the source-side v14 field and index contract

The first five version-14 records use the exact fields and Dexie index declarations below. Field representation and numeric validation follow ADR 0077; no unlisted raw response, network-error, or body-text field belongs in these records.

| Table | Required and optional fields | Dexie declaration |
| --- | --- | --- |
| `knowledgeVideos` | `bvid`; optional `avid`, `title`, `description`, `coverUrl`, `creatorName`, `creatorMid`, `categoryName`, `publicTags`, `durationSeconds`, `publishedAt`, `lastVerifiedAt`, `operationId`; required `availabilityState`, `createdAt`, `metadataUpdatedAt`, `lastLibraryActivityAt` | `bvid, [lastLibraryActivityAt+bvid], operationId` |
| `knowledgeVideoParts` | `bvid`, `cid`; optional `title`, `durationSeconds`, `displayOrder`, `lastVerifiedAt`, `operationId`; required `availabilityState`, `createdAt`, `metadataUpdatedAt` | `[bvid+cid], bvid, [bvid+displayOrder], operationId` |
| `knowledgeSourceAccounts` | `accountScopeId`, `externalAccountId`, `aliasOrdinal`, `connectedAt`, `lastVerifiedAt`, `updatedAt`; optional `nickname` | `accountScopeId, &externalAccountId` |
| `knowledgeSourceContainers` | `containerScopeId`, `sourceKind`, `ownerScopeId`, `externalContainerId`, `syncCompleteness`, `createdAt`, `updatedAt`; optional `label`, `description`, `reportedItemCount`, `lastSyncStartedAt`, `lastSyncFinishedAt`, `lastSuccessfulSyncAt` | `containerScopeId, ownerScopeId, [ownerScopeId+sourceKind]` |
| `knowledgeSourceRelations` | `containerScopeId`, `bvid`, `firstObservedAt`, `lastObservedAt`; optional `sourceAddedAt` | `[containerScopeId+bvid], containerScopeId, bvid` |

Display snapshot fields may be absent. Empty, failed, cancelled, or incomplete source values never erase an existing non-empty value, and only a successful authoritative source result changes `lastVerifiedAt`. Descriptions, public tags, and other body-like metadata are not ordinary secondary indexes. Only canonical videos and parts carry optional restore-operation markers because account, container, and membership data are excluded from knowledge backup and restore.
