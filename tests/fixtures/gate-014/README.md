# GATE-014-A fixture receipts

This directory commits only small public-safe receipts for deterministic 0.14 gate fixtures.

- `receipts/*.receipt.json` freezes generator version, seed, canonical byte totals, SHA-256 values, counts, distribution profile, planted retrieval targets, and reusable receipt-helper contracts.
- `generated/` is intentionally ignored. It is the opt-in destination for large JSONL fixture artifacts and must not be committed.

Commands:

```sh
npm run gate014:fixtures:receipts
npm run gate014:fixtures:write
npm run test:gate014
```

The synthetic profile is public-safe fixture material only. The receipts use `insufficient_evidence` for real Bilibili subtitle representativeness and for browser-only metrics that require later gate runs.
