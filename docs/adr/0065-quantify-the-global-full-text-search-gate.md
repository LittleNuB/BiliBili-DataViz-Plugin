---
status: accepted
---

# Quantify the global full-text search gate

On the recorded release-QA machine and Chrome version, the global-search gate requires initial index builds within 3 minutes at 100 MiB, 12 minutes at 400 MiB, and 15 minutes at 500 MiB; no more than 256 MiB peak JavaScript-heap growth above idle; persisted index size no larger than 1.5 times source bytes; and, at 500 MiB, warm-query p95 at or below 500 ms and cold-query p95 at or below 2 seconds. Indexing must keep individual UI-main-thread blocks at or below 200 ms, acknowledge cancellation within 1 second and stop writes within 2 seconds, resume after worker interruption by redoing at most one checkpoint batch, and update one added or removed 1-MiB version within 10 seconds. Fixed integrity queries must recover every deliberately planted target, and completed deletion must leave no searchable source text. Missing measurements or smaller-only success are insufficient evidence, not a pass.
