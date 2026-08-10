---
status: accepted
---

# Enforce full-text capacity with version bytes and a repairable ledger

Every managed full-text version stores a deterministic uncompressed UTF-8 byte count covering its canonical version metadata and complete ordered segment representation. A singleton usage ledger caches the sum and is updated in the same transaction as every admitted or removed version, but the per-version counts remain the repair authority. Database open validates the ledger against a lightweight sum of version counts; missing, negative, malformed, or mismatched data triggers repair before any new retained-text admission. The 400-MiB warning and 500-MiB hard boundary use these uncompressed bytes rather than ZIP size, and final admission checks the exact new bytes inside the write transaction rather than trusting a preflight estimate.
