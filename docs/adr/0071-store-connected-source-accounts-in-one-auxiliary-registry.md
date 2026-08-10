---
status: accepted
amended-by: 0072
---

# Store connected source accounts in one auxiliary registry

Version 14 adds `knowledgeSourceAccounts` as an auxiliary Dexie table beside the nine core knowledge tables and the `knowledgeOperations` maintenance journal. It owns the minimal local account-matching and display fields refined by ADR 0072, including the opaque local account scope, the nickname returned by a user-initiated authorized synchronization when available, a stable local alias ordinal, and connection or verification timestamps. Synchronized source relations reference that scope instead of duplicating account labels, so disconnecting an account can remove the registry row and all of its relationships in one database transaction while canonical videos and durable knowledge pass the accepted retention check. The registry follows synchronized-source lifecycle, is excluded from knowledge backup, diagnostics, AI requests, and knowledge-size reporting, and is never populated by reading Cookie, login-state, browser-profile, avatar, or key files.
