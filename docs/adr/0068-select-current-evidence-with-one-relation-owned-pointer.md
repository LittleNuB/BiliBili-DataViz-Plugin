---
status: accepted
---

# Select current evidence with one relation-owned pointer

Each source-backed `knowledgeAssetSources` row owns one nullable `activeEvidenceVersionId`. Evidence-version body, source, part, timing, and citation data remain immutable and carry no mutable current/corrected flag: the referenced version is current, while other versions owned by the same relation are derived as “已更正”. Source relocation atomically inserts one new evidence version and switches the relation pointer without rewriting the prior evidence row. A pointer may be null for an evidence-free whole-video note relation, but the asset still owns at least one video relation; every write, backup, restore, conflict-UUID rewrite, and readback must prove that a non-null pointer targets a version owned by that exact relation.
