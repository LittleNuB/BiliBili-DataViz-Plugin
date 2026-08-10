---
status: accepted
---

# Stage large restores and commit their visibility atomically

Version 14 adds one non-domain `knowledgeOperations` infrastructure table alongside the nine accepted core knowledge tables. Large restore rows are validated and written in bounded batches with a restore-operation ID while remaining invisible to ordinary reads; knowledge browsing stays available, but knowledge mutations and synchronized-source writes pause until the operation ends. After archive, reference, conflict, and capacity validation succeeds, one small transaction marks the operation committed, applies the exact capacity-ledger change and bounded canonical-metadata patches, and makes every staged row visible together. Later marker normalization is resumable and does not change visibility. Cancellation, validation failure, quota failure, or pre-commit worker interruption removes or resumes only invisible staged rows and leaves the prior knowledge space unchanged. This is atomic user-visible restore, not one unsafe 500-MiB IndexedDB transaction, and requires a near-limit interruption gate before release.
