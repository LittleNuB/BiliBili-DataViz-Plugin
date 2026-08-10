---
status: accepted
---

# Remove only video shells with no durable references

A canonical video remains while it has any source relationship, durable knowledge asset, or current or historical managed-full-text version. After the last source relationship is removed, Bili-Bill may automatically delete the video and its rebuildable-only dependents only when none of those durable references exists; evidence and user content therefore cannot be removed by this cleanup path. A later sync may recreate the same `bvid` as a new lightweight source entry, which is source re-entry rather than knowledge restoration.
