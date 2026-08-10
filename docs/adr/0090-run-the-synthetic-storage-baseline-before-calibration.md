---
status: accepted
---

# Run the synthetic storage baseline before measured subtitle calibration

GATE-014-B1 may begin after the reviewed GATE-014-A1 fixture receipts are available. B1 uses only the deterministic 100/400/500 MiB, 64 MiB single-version, and high-fragmentation synthetic fixtures to establish capacity enforcement, atomicity, bounded batching, cancellation, restart, ledger, cleanup, and restore-staging correctness. GATE-014-A2 is not an entry dependency for B1.

A B1 pass is deliberately narrow. It does not establish real Bilibili-subtitle representativeness, a measured maximum segment-count tail, real-user latency percentiles, or platform-wide capacity. Its report pins the exact A1 fixture receipts and keeps every unsupported real-workload claim at `insufficient_evidence`.

A2 remains an independent evidence track and continues to block GATE-014-C, GATE-014-D, real-workload claims, and final parameter freezing. After A2 passes, calibrated C/D runs and any bounded B1 parameter-confirmation run bind the calibration receipt, derived fixture configuration, and actual fixture receipt in one machine-checkable record. Calibration may raise conservative batching or restore-headroom parameters before GATE-014-E, but it does not invalidate B1 correctness already proved against its declared synthetic envelope.

This staging prevents the absence of a lawful representative subtitle corpus from stopping storage engineering while preserving the evidence boundary. A2 still stores no raw subtitle wording, BVID/CID list, account identifier, local path, Cookie, profile, login state, history, or key material.

This ADR amends ADR 0089 only for the dependency edge that made A2 block every candidate gate. ADR 0089 remains normative for the A1/A2 separation, provenance requirements, receipt binding, privacy constraints, and prohibition on treating synthetic fixtures as real-distribution evidence.
