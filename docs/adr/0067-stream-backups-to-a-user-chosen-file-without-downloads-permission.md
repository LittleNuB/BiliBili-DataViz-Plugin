---
status: accepted
---

# Stream backups to a user-chosen file without downloads permission

Knowledge backup begins from an explicit dashboard click that obtains a user-selected file handle before any expensive work, then streams the ZIP directly through the handle's writable stream instead of constructing the complete archive as an in-memory Blob. The extension adds no `downloads` permission. After the handle is obtained, export pauses knowledge and synchronized-source mutations while keeping reads available so one stable snapshot is serialized; success closes the stream only after manifest and entry hashes complete. Unsupported environments may use a Blob fallback only below a separately benchmarked small-file boundary, while large backup refuses safely with natural Chrome guidance. Restore reads only a file explicitly selected for that operation and never retains a handle for later automatic access.
