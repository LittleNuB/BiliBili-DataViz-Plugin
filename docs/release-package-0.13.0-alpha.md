# Bili-Bill 0.13.0-alpha Release Package

Date: 2026-08-01

Issue: #199

Branch: `codex/0.13-release-candidate`

Runtime source baseline: `f6b8e1f2d47e2f325500f786e2224653a0408ef5`

## Artifact

| Item | Value |
| --- | --- |
| ZIP | `release-artifacts/bili-bill-0.13.0-alpha.zip` |
| Checksum | `release-artifacts/bili-bill-0.13.0-alpha.zip.sha256` |
| Size | `525030` bytes |
| Files | `24` |
| SHA-256 | `4f564a7bd4ea7f7790daad7c203a17ae2001d6e0e9416301e04bb147c55a09eb` |
| Package version | `0.13.0-alpha` |
| Manifest version | `0.13.0` |
| Manifest version name | `0.13.0-alpha` |

The ZIP and checksum are local generated release artifacts and are excluded from git.

## Method

`npm run package:release` first performs a fresh production build, then invokes the reviewed PowerShell packager with no user profile loading. The packager:

1. Requires an exact semantic version matching package and Manifest metadata.
2. Validates canonical artifact paths before any write or cleanup.
3. Checks all declared runtime entry points, Manifest resources, project license, and third-party notices.
4. Preflights `dist/` paths and text content for source/dependency directories, reparse points, credential-like filenames, and common secret markers.
5. Sorts all file paths and writes a temporary ZIP with extension-relative paths at ZIP root.
6. Uses a fixed ZIP entry timestamp and compression level.
7. Extracts to a newly generated system-temp directory and compares every path and SHA-256 with `dist/`.
8. Promotes the temporary ZIP and checksum only after all checks pass.
9. Refuses to overwrite a different existing release artifact.
10. Removes only canonical temporary files under the artifact directory and verified system-temp audit directory.

Two consecutive package runs produced the same byte size and SHA-256.

## ZIP Boundary

The root contains `manifest.json` and the extension runtime directly. It does not contain a wrapping `dist/` directory.

Required release entries include:

- `manifest.json`
- `background.js`
- `popup.js`
- `dashboard.js`
- `content/player-monitor.js`
- `content/sidebar-card.js`
- `content/page-runtime-bridge.js`
- `popup/index.html`
- `dashboard/index.html`
- `LICENSE.txt`
- `THIRD_PARTY_NOTICES.txt`
- `third_party_licenses/Apache-2.0.txt`
- `third_party_licenses/BSD-3-Clause-d3.txt`
- `third_party_licenses/MIT-wordcloud2.txt`

The package contains no source directories, tests, `node_modules`, git metadata, browser profile, Cookie, login-state, key, PEM, or local release-workspace data.

## Extracted Package Smoke

The deterministic ZIP was extracted to a new ignored local directory and loaded into Microsoft Edge `150.0.4078.105` with a fresh temporary browser profile.

Results:

- MV3 service worker loaded.
- Public single-part and multi-part Bilibili video identity checks passed.
- The current-video assistant rendered its four tabs.
- Visible text showed no forbidden internal identifiers or runtime errors.
- No automatic AI request was emitted.
- The extracted package loaded directly from its root.

## Publication Boundary

This report does not create a tag, GitHub Release, CRX, or Chrome Web Store submission. Those actions remain gated on the draft release-candidate PR being independently reviewed, passing CI, and merging to `main`.
