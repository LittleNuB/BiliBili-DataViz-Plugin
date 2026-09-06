---
status: proposed
---

# Ship a bounded learning loop before full-library gates

The user accepted a bounded first release on 2026-09-06. The implementation proposal is [the bounded learning-loop scope](../scope-0.14-bounded-learning-loop.md), tracked by [#268](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/268). This ADR remains proposed until its docs-only scope PR is reviewed and merged. It does not claim implementation or measured capacity.

The first 0.14.0 delivery captures explicitly saved personal knowledge and exact source snapshots, retrieves that bounded collection locally, returns to the original source through preview/confirm/return, and exports/restores it without data loss. It does not retain complete subtitle corpora, migrate source-account relationships, replace Smart Favorites navigation, or introduce cross-video AI.

The bounded route has its own small synthetic workload validation and finite capacity. Its proposed 1,000-asset / 10-MiB logical-knowledge envelope is an engineering candidate, not a measured support promise. Failed validation requires a scope revision or fix, never silent eviction, partial restore, or a relaxed result.

A2 is not an entry dependency for that new route because the new route neither stores nor claims to model a complete native-subtitle workload. ADR 0089/0090 and GATE-014-A2/C/D/E continue unchanged for the deferred complete-text library. Existing synthetic B1 evidence remains valid only for its original scope. No old failure or insufficient-evidence outcome becomes a pass.

On scope-PR merge, the linked scope document explicitly overrides conflicting release obligations in the old 0.14 contracts and ADRs only for the bounded release. Unaffected evidence, privacy, no-eviction, atomicity, and existing-runtime regression rules remain mandatory. Old task state is not automatically mutated; no Ready, merge, close, release, or new runtime task dispatch is authorized by this ADR alone.

This narrows the first user-visible learning loop while retaining the deferred architecture as future work. It trades full-corpus archival and source automation for an earlier independently testable capture/find/revisit workflow. Backup portability, source truthfulness, and protection of existing knowledge are not deferred.
