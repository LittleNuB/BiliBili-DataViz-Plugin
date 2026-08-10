---
status: accepted
amended-by: 0086
---

# Use stable UUIDs for durable personal records

Canonical videos and parts use normalized Bilibili `bvid` and `cid` identities, while knowledge assets, asset-source relations, and evidence versions use locally generated UUIDs preserved through backup and restore; Dexie auto-increment row numbers are never portable identity. Restore skips the same UUID with identical durable content, but a same-UUID content conflict retains the local graph and imports a complete copy under new UUIDs rather than selecting a timestamp winner. Internal content fingerprints support idempotency and conflict detection without becoming user-visible fields.
