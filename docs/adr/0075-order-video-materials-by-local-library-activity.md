---
status: accepted
---

# Order video materials by local library activity

`knowledgeVideos` stores and indexes `lastLibraryActivityAt` for the default 视频资料 order. It is initialized when a video first enters the local knowledge space and changes only when related durable knowledge is saved, edited, or deleted, or managed full text is admitted, accepted, or removed. Routine metadata refresh, source verification, repeated synchronization, and adding another synchronized relationship to an already-known video do not bump it. Backup restore reconstructs the value from retained original valid activity timestamps rather than the restore wall-clock time, so an import does not masquerade as newly created knowledge. Descending activity time with normalized `bvid` as the stable tie-breaker is a local maintenance order, never recommendation ranking.
