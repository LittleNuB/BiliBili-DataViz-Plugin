---
status: accepted
---

# Reconcile video parts by cid without rebinding evidence

Only a successful complete part-list read may reconcile missing parts; failed, cancelled, or partial reads are upsert-only. An observed `cid` refreshes its last-known title, duration, display order, availability, and verification time. A previously known `cid` absent from a complete list remains as unavailable-for-verification when any durable asset-source relation, evidence version, current or historical full-text version, or other accepted durable reference still targets it, while an unreferenced missing part is removed as an empty shell. A new `cid` is a new part even when it occupies the same page number, so evidence and full text never migrate by page position. Whole-video inaccessibility preserves every referenced part and its last-known metadata rather than acting as a complete empty list.
