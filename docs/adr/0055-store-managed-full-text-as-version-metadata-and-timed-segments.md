---
status: accepted
---

# Store managed full text as version metadata and timed segments

Each managed full-text version stores its immutable source identity, language, lifecycle state, hashes, byte accounting, and verification metadata in one version record, while its body is stored as ordered time-aligned rows in a separate segment table. Reads, indexing, backup, restore, and removal may stream or batch segments by version to bound memory use, but creation, accepted source update, restore admission, and deletion of one version still commit the version row and all of its segments atomically. A full video transcript is never stored only as one large opaque row, and segment rows never become independently current evidence without their owning version.
