---
status: accepted
---

# Bound cross-video requests without truncating selected sources

One knowledge-base question selects at most five exact video or part scopes, including the active video, and sends the complete primary text of every selected source. Additional candidates are disclosed and may replace a selected source but cannot silently expand the request. Complete-text payloads above 512 KiB require a per-request waiting-time and possible-provider-cost confirmation. Bili-Bill does not discover provider context windows, truncate selected sources, or fall back to fragment-only answers; if the provider rejects an oversized request, the original question and source set remain available for adjustment and retry. This keeps the interaction simple while bounding automatic breadth and preserving the accepted complete-source evidence contract.
