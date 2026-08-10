---
status: accepted
---

# Restore knowledge without overwriting local assets

Knowledge restore validates the complete backup and atomically merges it without deleting or overwriting local assets. New assets are added, identical assets are skipped, and same-identity content conflicts keep both the local and clearly labeled imported versions for later review. Complete texts use the same non-destructive principle: an identical source is skipped, a differing backup copy is retained as a read-only historical version while the local version stays active, and a backup-only source remains “来自备份，待核对” until exact revalidation. If full-text import would exceed 500 MiB, the user may atomically restore knowledge without any backed-up full text or cancel; no arbitrary partial restore or timestamp-selected winner is allowed. Users who need replacement must separately clear the knowledge space before restoring.
