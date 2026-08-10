---
status: accepted
---

# Build only query-driven secondary indexes

Version 14 adds secondary indexes only for accepted product operations: exact synchronized-source reconciliation, asset type and recency views, normalized personal-tag filtering, asset-source and evidence-history traversal, managed-full-text scope and timeline reads, and bounded maintenance cleanup. User-authored bodies, notes, evidence text, and complete video text never enter ordinary core-table indexes; display tags remain durable on the asset while derived normalized `tagKeys` use a multi-entry index. Global text retrieval must use the separately rebuildable `knowledgeSearchIndex`, whose physical shard layout is selected by the blocking feasibility gate, and cannot fall back to scanning hundreds of MiB of source rows per query. A later genuinely new query may require another database-version upgrade rather than speculative indexes in version 14.
