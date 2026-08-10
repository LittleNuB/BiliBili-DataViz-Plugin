---
status: accepted
---

# Enforce one current full-text version with a sparse unique scope key

A managed full-text version is current only when it owns the optional unique `currentScopeKey` derived from normalized `bvid`, exact positive `cid`, natural source type, normalized language, and the stable internal source-variant key; mutable page order, display label, endpoint, and URL never participate. A Bilibili subtitle without a stable non-URL track discriminator uses the sole `default` variant, and differing same-language content requires explicit replacement confirmation rather than being claimed as a known-track update. Historical and restored-pending-validation versions omit the key and therefore do not collide. Accepting changed source text atomically removes the prior version's key and inserts the complete new version with that same key, so unique-index enforcement and transaction rollback prevent two current versions or a committed no-current intermediate state. Body and timeline remain immutable, identical reacquisition updates only verification metadata, and restored text may acquire the key only after real-source revalidation.
