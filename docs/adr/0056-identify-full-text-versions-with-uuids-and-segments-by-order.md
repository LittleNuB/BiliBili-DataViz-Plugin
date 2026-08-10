---
status: accepted
---

# Identify full-text versions with UUIDs and segments by order

Every managed full-text version receives a stable local UUID that survives backup and restore. Its segment rows use the owning version UUID plus a zero-based contiguous ordinal as their compound identity; segments do not receive independent UUIDs and are never merged across versions. Any body or timeline change creates a new full-text version with a new UUID and a complete ordered segment set. Body and timeline fingerprints remain internal duplicate- and change-detection inputs rather than identity or user-visible fields.
