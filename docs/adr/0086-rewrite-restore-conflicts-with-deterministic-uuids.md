---
status: accepted
amends: 0044
---

# Rewrite restore conflicts with deterministic UUIDs

Restore computes a `knowledge-asset-graph-v1` semantic fingerprint over one backup asset's immutable and editable content plus its ordered source and evidence graph, excluding generated UUIDs, derived keys, lifecycle timestamps, mutable verification state, and operation markers. The compact canonical JSON object contains the asset's kind, title, tags, user layer, saved-content kind, blocks and question; source projections in `sourceOrder`; and, under each source, semantic evidence projections sorted by their own canonical JSON. Evidence includes an `isActive` boolean so relocation changes the graph, while relation evidence state and last-check time do not. The fingerprint is lowercase SHA-256 over that well-formed UTF-8 JSON plus one LF.

If the original asset UUID is occupied by different content, every imported UUID is derived with UUIDv5 namespace `cf5191ba-2b6b-4262-94cd-e6c46a7384a6`. Exact UTF-8 names are `asset|<originalAssetId>|<graphFingerprint>`, `asset-source|<originalAssetId>|<originalAssetSourceId>|<graphFingerprint>`, and `evidence-version|<originalAssetId>|<originalAssetSourceId>|<originalEvidenceVersionId>|<graphFingerprint>`. The complete rewritten graph is still staged atomically and labeled as an imported version.

Before creating a conflict copy, restore checks both the original UUID and the deterministic candidate. An identical graph at either identity is skipped; a different graph at the deterministic candidate is treated as an integrity conflict and refuses the restore rather than selecting another random suffix. Evidence pointers are rewritten from one complete validated map. This preserves local content, prevents repeated restore from generating unbounded duplicate imports, and requires no provenance index or user-visible internal identifier.

Managed-full-text UUID conflicts use the exact name `fulltext-version|<originalVersionId>|<sourceVersionFingerprint>` in the same namespace; content equality is determined by exact source scope, body, and timeline rather than mutable lifecycle state. Identical source fingerprints are skipped even when UUIDs differ. Any UUID rewrite recalculates canonical serialized bytes before capacity admission. UUIDv5 is used only for conflict copies; ordinary new personal records and operation IDs use lowercase RFC 4122 UUIDv4 from `crypto.randomUUID()`, while restore accepts canonical lowercase UUIDv4 or UUIDv5 only.
