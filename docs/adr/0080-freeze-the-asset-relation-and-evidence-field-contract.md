---
status: accepted
---

# Freeze the asset, relation, and evidence field contract

The three durable knowledge tables use the exact fields and Dexie declarations below.

| Table | Required and optional fields | Dexie declaration |
| --- | --- | --- |
| `knowledgeAssets` | required `assetId`, `assetKind`, `title`, `tags`, `tagKeys`, `createdAt`, `updatedAt`; optional `userNote`, `userBody`, `savedContentKind`, `savedContentBlocks`, `savedQuestion`, `saveFingerprint`, `operationId` | `assetId, [updatedAt+assetId], [assetKind+updatedAt], *tagKeys, &saveFingerprint, operationId` |
| `knowledgeAssetSources` | required `assetSourceId`, `assetId`, `sourceOrder`, `bvid`, `evidenceState`, `createdAt`, `updatedAt`; optional `cid`, `startSeconds`, `endSeconds`, `activeEvidenceVersionId`, `lastEvidenceCheckedAt`, `operationId` | `assetSourceId, &[assetId+sourceOrder], bvid, [bvid+cid], evidenceState, operationId` |
| `knowledgeEvidenceVersions` | required `evidenceVersionId`, `assetSourceId`, `bvid`, `cid`, `sourceType`, `sourceVersionFingerprint`, `capturedText`, `startSeconds`, `endSeconds`, `supportedBlockOrdinals`, `capturedAt`, `createdAt`; optional `language`, `operationId` | `evidenceVersionId, [assetSourceId+createdAt+evidenceVersionId], bvid, [bvid+cid], operationId` |

Every asset owns at least one video relation. A pure note may use a whole-video relation with omitted `cid`, `not_applicable`, and a null evidence pointer, but version 14 does not create a zero-relation asset. Every stored part/evidence `cid` is a positive safe integer. `evidenceState` is `not_applicable`, `current`, `changed`, `unavailable`, or `pending_revalidation` and belongs to the mutable relation, not an immutable evidence version. A non-null active pointer must target an evidence version owned by the same relation, and the relation's current video, part, and time projection must equal that active version. `saveFingerprint` is an optional sparse unique SHA-256 over the canonical source-save origin and excludes editable user fields; it prevents concurrent duplicate context-menu or whole-turn saves but is not identity or UI. `tagKeys` are derived with trim, Unicode NFKC normalization, and locale-independent lowercase while first-occurrence display tags remain in `tags`. All three tables may carry restore-operation markers.
