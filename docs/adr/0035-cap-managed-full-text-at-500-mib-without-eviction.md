---
status: accepted
---

# Cap managed full text at 500 MiB without eviction

Managed full-text material is measured by complete UTF-8 serialized source metadata and time-aligned text rows, warns at 400 MiB, and refuses retained full-text writes beyond 500 MiB without imposing a separate video-count limit. Durable knowledge assets, evidence snapshots, and rebuildable indexes remain separately measured. Reaching the boundary never evicts an older complete text and does not prevent a knowledge asset from being saved when its own evidence snapshot fits; if local transcription ships later, its preflight must block work that cannot fit and an unexpectedly large result must remain temporary for direct export or retry after storage management. The fixed first-release boundary limits local footprint and backup cost even though the extension's existing unlimited-storage permission removes the browser's ordinary quota and eviction behavior.
