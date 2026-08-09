---
status: accepted
---

# Key synchronized source relations by external membership scope

Each synchronized source relationship uses a deterministic compound identity derived from source kind, local account scope, source container, and normalized `bvid`; favorite-folder titles, display names, and sync timestamps never define identity. A complete sync may remove only absent relationships inside the exact account-and-container scope it authoritatively covered, while an incomplete, blocked, cancelled, or failed sync may only add or update. Legacy pre-account favorite relationships retain a separate unknown-account scope and reconcile only after an authorized complete sync finds the accepted exact folder-and-video match. These rebuildable external memberships receive no UUID, are excluded from knowledge backup, and never expose their local account key to ordinary UI or AI requests.
