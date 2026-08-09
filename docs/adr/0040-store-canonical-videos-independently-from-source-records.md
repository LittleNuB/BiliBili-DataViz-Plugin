---
status: accepted
---

# Store canonical videos independently from source records

The knowledge space stores one canonical video per normalized `bvid` and subordinate parts keyed by stable `cid`, rather than reusing favorite items, watch-later items, watch-history rows, account relationships, or transcript caches as identity records. Folder, account, and source memberships remain independent relationships that may create or retain a lightweight entry but cannot own or duplicate it. This keeps one video stable across several folders and accounts, preserves exact part-scoped knowledge, and prevents source refresh or removal from deleting a video that still has durable knowledge or managed full text.
