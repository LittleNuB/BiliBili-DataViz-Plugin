---
status: accepted
---

# Migrate core knowledge data atomically and rebuild indexes later

The version-13 to version-14 Dexie upgrade creates the knowledge-space schema and deterministically derives canonical favorite videos plus 升级前收藏来源 relations in one atomic transaction, while retaining the existing favorite, Smart Favorite, and current-video transcript tables unchanged. The upgrade performs no network, AI, subtitle, or full-text work; failure rolls the whole upgrade back to intact version-13 data and exposes a natural retry state rather than clearing storage. Rebuildable search and suggestion indexes run only after a successful open as bounded resumable work and cannot redefine core migration success.
