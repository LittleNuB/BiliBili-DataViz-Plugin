---
status: accepted
---

# Store tags as normalized asset-local text

0.14 stores normalized user-visible tag strings directly with each knowledge asset rather than creating durable tag entities and relation rows. Surrounding whitespace, case-only differences, and duplicates collapse within an asset while natural display wording is retained; the cross-asset filter and suggestion list is a rebuildable aggregation, and tag edits affect only the current asset. Asset tags enter knowledge backup, but the aggregate index does not, and 0.14 omits global tag rename, merge, and orphan cleanup.
