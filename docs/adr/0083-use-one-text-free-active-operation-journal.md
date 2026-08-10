---
status: accepted
---

# Use one text-free active-operation journal

`knowledgeOperations` contains only active or recovering maintenance work and uses the exact required fields `operationId`, `kind`, `lockScope`, `state`, `phase`, `checkpointBatchOrdinal`, `processedRecordCount`, `processedBytes`, `startedAt`, and `updatedAt`; optional fields are `checkpointEntry`, `checkpointRecordOrdinal`, `checkpointByteOffset`, `archiveFingerprint`, `targetGenerationId`, `cancelRequestedAt`, `committedAt`, and bounded `failureCode`. Its Dexie declaration is `operationId, &lockScope, [kind+state], updatedAt`.

Allowed kinds are `restore`, `backup_export`, `search_rebuild`, and `fulltext_ledger_repair`. Lock scopes are `knowledge_snapshot`, `search_index`, and `fulltext_ledger`; acquisition runs in one transaction, enforces one operation per scope through the unique index, and also checks the explicit cross-scope conflict matrix. Restore is exclusive with every other maintenance operation. Backup export conflicts with restore and ledger repair but may coexist with search rebuild because exported backups exclude the derived index and source mutations are frozen. Ledger repair blocks retained-full-text mutation, while search rebuild remains derived and generation-isolated.

Generic transitions are forward-only: `preparing -> running -> commit_ready -> committed`, with `committed -> normalizing` only where the table below allows it; any pre-commit state may enter `cancelling -> cleaning`, and a non-user failure may enter `cleaning` directly. `normalizing` and successful `cleaning` delete the journal instead of retaining history. `committed` never returns to a pre-commit state.

| Kind | State | Exact phase | Checkpoint / recovery rule |
| --- | --- | --- | --- |
| restore | `preparing` | `envelope_preflight` | counters are zero; reject locally decidable envelope errors before staging |
| restore | `running` | `staging_entries` | fixed entry, record ordinal, byte offset, batch ordinal, counts, and bytes advance only after each staging transaction |
| restore | `commit_ready` | `validating_candidate` | full stream read; verify references, rewrites, resulting capacity, quota outcome, and current local state |
| restore | `committed` | `visibility_committed` | `committedAt` required; repositories expose the complete operation atomically |
| restore | `normalizing` | `clearing_markers` | resume bounded marker clearing; visible graph cannot roll back |
| restore | `cancelling` | `cancel_requested` | stop accepting new staged batches and enter cleanup |
| restore | `cleaning` | `removing_staged` | resume deletion of invisible rows, then delete journal and require fresh file selection |
| backup_export | `preparing` | `snapshot_locked` | destination already selected; counters are zero |
| backup_export | `running` | `writing_entries` | fixed entry, record ordinal, byte offset, counts, and bytes are progress only, never a resumable file cursor |
| backup_export | `commit_ready` | `finalizing_and_readback` | finish ZIP, close destination, and perform required readback before success |
| backup_export | `committed` | `destination_verified` | destination is complete and verified; delete journal after success reporting |
| backup_export | `cancelling` | `cancel_requested` | stop new writes and enter release cleanup |
| backup_export | `cleaning` | `releasing_export` | release lock; state that a partial destination may require manual deletion |
| search_rebuild | `preparing` | `allocating_generation` | `targetGenerationId` required before index writes |
| search_rebuild | `running` | `indexing_sources` | source ordinal and batch checkpoint may resume, redoing at most one uncommitted batch |
| search_rebuild | `commit_ready` | `verifying_generation` | prove source receipt, query integrity, and generation completeness |
| search_rebuild | `committed` | `activating_generation` | atomically switch the current generation |
| search_rebuild | `normalizing` | `removing_stale_generations` | resume bounded removal of non-current generations |
| search_rebuild | `cancelling` | `cancel_requested` | stop new target-generation writes |
| search_rebuild | `cleaning` | `removing_target_generation` | delete incomplete generation, then journal |
| fulltext_ledger_repair | `preparing` | `scanning_versions` | initialize a deterministic version-order receipt |
| fulltext_ledger_repair | `running` | `recomputing_versions` | version ordinal and batch checkpoint may resume |
| fulltext_ledger_repair | `commit_ready` | `verifying_total` | verify every repaired version byte count and aggregate |
| fulltext_ledger_repair | `committed` | `publishing_total` | atomically publish the verified ledger, then delete journal |
| fulltext_ledger_repair | `cancelling` | `cancel_requested` | preserve previous ledger and stop new repair writes |
| fulltext_ledger_repair | `cleaning` | `releasing_repair` | remove incomplete repair state, then journal |

`failureCode` is absent or exactly one of `cancel_requested`, `worker_interrupted`, `source_reselection_required`, `destination_incomplete`, `invalid_archive`, `unsupported_backup_version`, `integrity_mismatch`, `capacity_exceeded`, `quota_exceeded`, `read_failed`, `write_failed`, `cleanup_failed`, `index_verification_failed`, `ledger_invalid`, or `operation_conflict`. It is an internal classifier mapped to natural Chinese and never contains an exception message.

Restore and export never persist a selected file name, path, handle, archive body, or source text. After worker loss they cannot silently reopen or resume that user-selected stream: a pre-commit restore enters `removing_staged` and requires a fresh selection; export enters `releasing_export` and reports that an incomplete destination file may need manual removal. A committed restore resumes `clearing_markers`. Search rebuild and full-text-ledger repair may resume from validated checkpoints. Raw exceptions never enter the journal.
