---
status: accepted
amended-by: 0078
---

# Separate assets, source relations, and evidence versions

A knowledge asset stores editable user organization and, when applicable, the single immutable saved-content layer refined by ADR 0078 independently from one-or-more 资产来源关系. Version 14 does not create an asset with zero video relations. Each source relationship owns its immutable 证据版本 history with at most one active version. Whole-video notes may have a video relation without captured evidence, while timestamped and source-backed assets retain an exact part and evidence version. Creation commits the required records atomically, and source relocation replaces only the selected relationship's active evidence while preserving its prior version and every other citation.
