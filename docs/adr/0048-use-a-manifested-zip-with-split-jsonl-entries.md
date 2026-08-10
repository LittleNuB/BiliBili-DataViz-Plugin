---
status: accepted
amended-by: 0085
---

# Use a manifested ZIP with split JSONL entries

Knowledge backup uses one ordinary ZIP with a versioned root manifest and separate UTF-8 JSONL entries for videos, parts, assets, source relations, evidence versions, full-text metadata, and time-aligned rows instead of one giant JSON value. The manifest declares mode, counts, uncompressed sizes, allowed paths, and SHA-256 values over exact uncompressed entry bytes. Restore rejects envelope, path, and declared-limit failures before staging; checksum, JSONL, identity, reference, rewrite, and final-capacity validation may use bounded invisible staging but must pass before one atomic user-visible commit. ZIP is explicitly not encryption, and the eventual archive library must independently pass package-size, bounded-memory, license, malformed-input, cancellation-cleanup, and Chrome MV3 gates. ADR 0085 amends the exact entry layout and projection rules.
