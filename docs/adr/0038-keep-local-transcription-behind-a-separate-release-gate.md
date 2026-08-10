---
status: accepted
---

# Keep local transcription behind a separate release gate

0.14.0 acquires complete text only from available Bilibili subtitles and does not expose local-transcription UI, while its durable source and backup contracts remain able to represent a future completed local transcript. The 0.13 spike is explicitly No-go and the repository has no production local-ASR runtime; TrainPal's Ark/豆包 ASR work proves useful audio-normalization, task-state, retry, cancellation, cleanup, time-alignment, and coverage-gate patterns, but it does not prove an on-device Chrome-extension path. Any later 0.14.x local-transcription issue therefore requires a separate passing gate for model artifacts and licensing, extension runtime and permissions, audio acquisition, MV3 lifecycle, long-video behavior, resource pressure, time-aligned coverage, cleanup, privacy, and Browser QA, with no remote transcription fallback.
