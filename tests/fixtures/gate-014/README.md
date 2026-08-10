# GATE-014-A fixture receipts

This directory commits only small public-safe receipts for deterministic 0.14 gate fixtures.

- `receipts/*.receipt.json` freezes generator version, seed, canonical byte totals, SHA-256 values, counts, distribution profile, planted retrieval targets, and reusable receipt-helper contracts.
- `generated/` is intentionally ignored. It is the opt-in destination for large JSONL fixture artifacts and must not be committed.
- Artifact and golden-receipt publication use same-directory unique temp files, readback/hash verification, and atomic rename. Failed writes remove their temp files and preserve any prior valid target.

Commands:

```sh
npm run gate014:fixtures:receipts
npm run gate014:fixtures:verify
npm run gate014:fixtures:write
npm run gate014:fixtures:cleanup
npm run test:gate014
```

`gate014:fixtures:verify` is the read-only full verification path. It recomputes all five required fixtures, deep-compares every committed receipt field, exits non-zero on drift, and writes neither receipts nor large artifacts. CI runs it separately from the fast `test:gate014` unit suite.

`gate014:fixtures:cleanup` derives the fixed generated directory from the repository root, rejects redirected ancestors, and removes only known generated fixture JSONL and exact generator temp names.

The synthetic profile is public-safe fixture material only. No public-safe timing/overlap dataset supporting real Bilibili subtitle representativeness or a maximum measured tail is attached, so both claims remain `insufficient_evidence`. Browser-only metrics also remain `insufficient_evidence` until later gate runs. Synthetic `local_transcript` rows are schema/load edge cases only and do not claim local ASR availability.
