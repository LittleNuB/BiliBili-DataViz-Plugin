---
status: accepted
---

# Store transactional ledgers in an auxiliary storage-state table

Version 14 adds `knowledgeStorageState` as a fourth auxiliary table. Its primary key is a closed state discriminator rather than a knowledge identity or generic configuration key. The initial required row, `managed-fulltext-usage`, owns only the aggregate managed-full-text byte and version counts plus update and last-verification times; it is updated in the same Dexie transaction as a full-text version change and repaired from per-version authoritative counts. The table contains no user or source text, is excluded from knowledge backup, AI, diagnostics export, and knowledge-size categories, and cannot be used as the sole copy of any durable fact. Search-generation state may enter this table only if the blocking search gate defines another explicit discriminated record; arbitrary feature settings do not.
