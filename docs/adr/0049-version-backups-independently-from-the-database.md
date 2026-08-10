---
status: accepted
---

# Version backups independently from the database

`backupFormatVersion` is independent from the Dexie schema version: 0.14 writes only format v1, rejects unsupported newer formats without staged or visible rows, and provides no downgrade export. Future readers may support an older format only through an explicit deterministic version-by-version migration that leaves the original ZIP unchanged. Envelope validation precedes staging; the complete migrated current-format candidate must pass streamed, cross-record, conflict, quota, and capacity validation before any user-visible commit. Fixed fixtures for every supported format must prove idempotent restore, conflict retention, malformed-input rejection, capacity refusal, invisible staging cleanup, and zero-visible-write rollback.
