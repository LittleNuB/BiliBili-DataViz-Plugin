---
status: accepted
---

# Retain knowledge-linked full text without replacing evidence snapshots

Every source-backed knowledge asset stores its own minimal durable evidence snapshot. Complete text for an active video outside the local knowledge space remains a bounded temporary cache, but an available complete Bilibili subtitle associated with a video inside the knowledge space becomes managed full-text material; a completed local transcript follows the same rule only after a future release ships that capability. Managed full text is retained, backed up by default, and never silently evicted. A unified capacity boundary stops new full-text acquisition, restore, promotion, and any future transcription preflight that would exceed the boundary, and asks the user to back up or manage storage instead of deleting an older source. Removing complete text cannot remove a related knowledge asset or its evidence snapshot, and a snapshot alone cannot establish a video's current wording for a new factual answer.
