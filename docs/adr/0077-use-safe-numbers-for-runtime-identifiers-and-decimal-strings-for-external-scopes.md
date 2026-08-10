---
status: accepted
amends: 0076
---

# Use safe numbers for runtime identifiers and decimal strings for external scopes

Version 14 keeps `bvid`, UUIDs, and enum-like source values as strings; stores `externalAccountId` and `externalContainerId` as canonical non-negative decimal strings; and retains `avid`, `creatorMid`, page order, counts, ordinals, and byte sizes as non-negative JavaScript safe integers to remain compatible with current-video and navigation code. Every stored part, evidence, asset-source, or full-text `cid` is a positive safe integer; a whole-video asset-source relation omits `cid` rather than storing zero. Every `*At` value is a non-negative Unix-millisecond safe integer, while every `*Seconds` value is finite and non-negative. `NaN`, infinity, negative values, unsafe integers, malformed decimal strings, and lossy external conversions are rejected before a version-14 write. Migration promotes an existing numeric value only when it validates without loss; otherwise the original source row remains and the canonical record stays naturally incomplete rather than guessing a replacement. Backup preserves the stored JSON types exactly and restore never round-trips identifiers through another numeric representation.
