---
status: accepted
---

# Separate durable knowledge, managed full text, and rebuildable index lifecycles

Version 14 reports personal knowledge, managed full text, and knowledge-search indexes as three distinct local-data categories instead of registering them as one generically clearable category. Durable personal knowledge may be removed only per asset or by the atomic, typed-confirmation “清空知识库” transaction; managed full text may be removed only through space-management operations that preserve assets and evidence snapshots; rebuildable indexes may be cleared and regenerated independently. Existing generic category-clearing code must not silently delete durable knowledge or managed full text, and the broader all-local-data flow requires a separately specified orchestration boundary before it may include either category.
