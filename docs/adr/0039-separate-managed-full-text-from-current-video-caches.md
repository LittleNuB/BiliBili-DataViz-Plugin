---
status: accepted
---

# Separate managed full text from current-video caches

The existing `currentVideoTranscriptSources` and `currentVideoTranscriptSegments` remain bounded temporary caches rather than becoming knowledge-base storage through a persistence flag. When exact validated text enters the knowledge space, Bili-Bill atomically copies its source metadata and complete time-aligned rows into dedicated managed-full-text storage, after which cache expiry, clearing, or replacement cannot mutate the durable copy. This separation makes retention, capacity, backup, restore, clear, and migration boundaries enforceable and prevents an interrupted promotion from leaving a partial durable source.
