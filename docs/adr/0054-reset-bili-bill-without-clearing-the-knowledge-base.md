---
status: accepted
---

# Reset Bili-Bill without clearing the knowledge base

The existing generic “clear local data” action becomes “重置 Bili-Bill（保留知识库）” and explicitly excludes durable personal knowledge and managed full text. It may clear ordinary module data, local settings, temporary caches, and rebuildable knowledge-search indexes; retained knowledge can regenerate those indexes afterward. Removing personal knowledge or managed full text remains a separate “清空知识库” operation with its own scope preview, backup path, typed confirmation, and atomic knowledge-store transaction. Version 14 does not combine both operations into a misleading cross-storage “clear everything” workflow that cannot guarantee one atomic outcome.
