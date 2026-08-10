---
status: accepted
---

# Store source containers in one auxiliary registry

Version 14 adds `knowledgeSourceContainers` as auxiliary synchronized-source storage. One deterministic `containerScopeId` represents exact source kind, confirmed local account scope or reserved legacy scope, and external container ID; favorite folders use their real `mediaId`, while a source such as watch-later uses one fixed internal container value. The row owns mutable container label and description, reported item count, synchronization completeness, and synchronization timestamps, including an empty container with no video relationships. `knowledgeSourceRelations` references that scope and uses `[containerScopeId, normalized bvid]` as its deterministic membership identity, which preserves the previously accepted source-plus-account-plus-container-plus-video semantics without duplicating container metadata. Disconnecting an account removes its registry row, containers, and relationships in one transaction before canonical-video retention checks. Container records follow synchronized-source lifecycle and are excluded from knowledge backup, diagnostics export, AI requests, and knowledge-size reporting.
