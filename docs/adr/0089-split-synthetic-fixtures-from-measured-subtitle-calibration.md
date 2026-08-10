---
status: accepted
---

# Split synthetic fixtures from measured subtitle calibration

GATE-014-A is split into two independently reviewed blockers. A1 builds deterministic public-safe synthetic fixtures and fail-closed receipt formats. A2 supplies a separately reviewed public-safe aggregate Bilibili-subtitle distribution, including provenance, authorization or license, sample method, exclusions, limitations, and the maximum measured segment-count tail. Passing A1 never turns its synthetic distributions into evidence of real Bilibili representativeness.

GATE-014-B and later candidate gates may begin only after both A1 and A2 pass. A2 stores no raw subtitle wording, BVID/CID list, account identifier, local path, Cookie, profile, login state, history, or key material. If no lawful and representative aggregate source is available, A2 remains `insufficient_evidence` and the dependent gates stay blocked rather than substituting synthetic success.

Every B/C/D candidate run binds the accepted A2 calibration-receipt SHA-256, its derived fixture-configuration version and SHA-256, and the actual A1 fixture-receipt SHA-256 in one machine-checkable run record. A report that only attaches the receipts without this binding is insufficient.

Raw run tables, median/p95 summaries, restore amplification, quota selection, ledger assertions, and candidate-specific package evidence remain responsibilities of GATE-014-B/C/D reports. They are not pulled into the A1 fixture-helper contract.
