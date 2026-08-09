---
status: accepted
---

# Do not create provisional videos from avid-only legacy rows

The deterministic version-14 migration creates canonical videos only for legacy favorites that already contain a valid normalized `bvid`. An `avid`-only row remains preserved under 收藏来源 as “视频信息待补全”, cannot own knowledge or managed full text, and is not converted through a guess or a network call during upgrade. A later user-authorized complete sync or deterministic metadata refresh may attach it to a canonical video only after obtaining the real `bvid`, avoiding provisional-identity merges and data loss.
