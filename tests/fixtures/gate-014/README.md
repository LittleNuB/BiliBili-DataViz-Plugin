# GATE-014-A fixture receipts

This directory commits only small public-safe receipts for deterministic 0.14 gate fixtures.

- `receipts/*.receipt.json` freezes generator version, seed, canonical byte totals, SHA-256 values, counts, distribution profile, planted retrieval targets, and reusable receipt-helper contracts.
- `generated/` is intentionally ignored. It is the opt-in destination for large JSONL fixture artifacts and must not be committed.

Commands:

```sh
npm run gate014:fixtures:receipts
npm run gate014:fixtures:write
npm run gate014:fixtures:cleanup
npm run test:gate014
```

`gate014:fixtures:cleanup` removes only known generated fixture JSONL and generator temp names after resolving and verifying the intended generated directory.

The synthetic profile is public-safe fixture material only. The receipts use `insufficient_evidence` for real Bilibili subtitle representativeness, maximum measured-tail claims, and browser-only metrics that require later gate runs. Synthetic `local_transcript` rows are schema/load edge cases only and do not claim local ASR availability.
