---
status: accepted
---

# Normalize the version-14 knowledge storage topology

Version 14 adds nine responsibility-specific tables to the existing `BiliAnalyticsDB`: canonical videos, video parts, synchronized source relations, knowledge assets, asset-source relations, evidence versions, managed full-text versions, managed full-text segments, and a rebuildable search index. The first eight preserve their accepted ownership and transaction boundaries rather than embedding the graph in favorite rows, assets, transcript caches, or one polymorphic record table; the ninth owns derived search data only. Knowledge backup excludes synchronized source relations and the search index, while including the durable knowledge graph and, for a full backup, managed full-text versions and segments.
