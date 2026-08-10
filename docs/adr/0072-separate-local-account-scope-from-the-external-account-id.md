---
status: accepted
amends: 0071
---

# Separate local account scope from the external account ID

Each confirmed `knowledgeSourceAccounts` row uses a random local UUID `accountScopeId` as its primary identity and stores the canonical decimal-string Bilibili UID once as a unique `externalAccountId` only for matching later user-initiated authorized synchronizations. Synchronized relationships and their deterministic keys use `accountScopeId`, never the external ID; nickname changes update display metadata without changing scope. A response without a stable external account ID cannot create or select an account scope, and a nickname is never used as identity. Upgrade-era unknown-account favorites continue using their reserved legacy scope without a fabricated account row. The external ID is excluded from ordinary UI, backup, diagnostics, logs, and AI requests; local hashing is not added because retaining the salt and mapping in the same local boundary would add failure modes without materially reducing exposure.
