---
status: accepted
---

# Preserve last-known video metadata without treating it as evidence

Canonical `bvid` and part `cid` identities never change, while titles, descriptions, covers, creator names, durations, and part order are refreshable display snapshots rather than factual video-content evidence. Only a successful sufficiently complete page resolution or authorized synchronization may update a snapshot; empty fields, request failures, and incomplete synchronization cannot erase an existing non-empty value. Deleted, private, or temporarily unavailable videos retain their last-known display data and durable knowledge with a natural unavailable-for-verification state. Knowledge backup carries the last-known snapshot for offline source recognition; restore keeps local non-empty values and fills only missing fields until a real source refresh succeeds, never choosing a winner from device timestamps.
