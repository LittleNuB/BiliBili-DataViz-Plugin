---
status: accepted
---

# Evolve the existing QA session store for cross-video turns

Cross-video questions reuse the existing `currentVideoQaSessions` physical table instead of creating a second conversation store. Records gain an internal format version: existing rows remain readable as single-source turns without an eager copy migration, while new-format turns may retain several exact video-or-part source snapshots and their citations. Domain APIs and user-facing language become generic 问答会话 over time, but the physical table name remains unchanged in version 14 to reduce migration risk. The existing bounded-history lifecycle remains separate from durable knowledge and backup; only an explicitly saved selection or validated turn creates an independent knowledge asset.
