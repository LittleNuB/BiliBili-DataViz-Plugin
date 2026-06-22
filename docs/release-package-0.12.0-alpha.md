# Bili-Bill 0.12.0-alpha Release Package

Date: 2026-06-22
Issue: #157
Branch: `codex/release-0.12-alpha-package`
Source commit: `e566bac65badd312c4f333dfbecd396a8fe3d0d9`
Baseline: `origin/main @ e566bac65badd312c4f333dfbecd396a8fe3d0d9`

## Scope

This slice packages the verified `0.12.0-alpha` extension artifact from `dist/`, records its checksum, and documents package validation.

No runtime feature logic, database schema, AI rules, sync rules, package or manifest version metadata, tag, GitHub Release, or store publication change is included here.

## Artifact

| Item | Value |
| --- | --- |
| Zip path | `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.12-package\release-artifacts\bili-bill-0.12.0-alpha.zip` |
| Checksum path | `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.12-package\release-artifacts\bili-bill-0.12.0-alpha.zip.sha256` |
| File size | `446627` bytes |
| SHA-256 | `8A36A68747D3D980F2E5AEEEA255CD7DB4A02FDBB29A4470A5999CB9B967F5E1` |
| `package.json` version | `0.12.0-alpha` |
| Manifest `version` | `0.12.0` |
| Manifest `version_name` | `0.12.0-alpha` |

The zip and checksum files are local release artifacts only and are not committed to git.

## Build Baseline

Commands run:

```powershell
git status --short --branch
git rev-parse HEAD
git merge-base HEAD origin/main
npm ci
npm run typecheck
npm run build
```

Results:

- Worktree was clean before packaging.
- `HEAD` and merge-base both matched `e566bac65badd312c4f333dfbecd396a8fe3d0d9`.
- `npm ci` passed with 28 packages installed.
- `npm ci` reported 1 high severity dependency audit item; a read-only audit confirmed it is for the Vite development dependency and was not changed in this packaging slice.
- `npm run typecheck` passed.
- `npm run build` passed.
- Build output included Vite chunk-organization notices and the known non-blocking large chunk warning for `dist/chunks/theme-BXY0bwcN.js` at `721.60 kB` minified.

## Package Method

The artifact was created from `dist/` contents only with a local zip step that wrote extension-relative paths directly at the zip root.

Zip root boundary:

- `manifest.json`
- `background.js`
- `popup.js`
- `dashboard.js`
- `assets/`
- `chunks/`
- `content/`
- `dashboard/`
- `icons/`
- `popup/`

## Validation

Checks completed against the generated zip:

- `manifest.json` exists at the zip root.
- Manifest JSON parses successfully.
- Manifest `version` is `0.12.0`.
- Manifest `version_name` is `0.12.0-alpha`.
- Required runtime entries exist: `background.js`, `popup.js`, `dashboard.js`, `popup/index.html`, `dashboard/index.html`, `content/player-monitor.js`, `content/sidebar-card.js`, and `content/page-runtime-bridge.js`.
- Runtime folders exist: `assets/`, `chunks/`, `content/`, `dashboard/`, `icons/`, and `popup/`.
- Zip entry count is `20`.
- Checksum file content matches a fresh SHA-256 calculation.
- Main-agent recheck confirmed the zip file list and per-file SHA-256 hashes match the current `dist/` output.
- Content-boundary scan found no source directories, git metadata, dependencies directory, docs, tests, local release artifact folder, logs, screenshots, browser user-data directories, session credential files, local key files, or local user data in the zip.
- `dist/content/player-monitor.js` has no top-level static import statement.

## Clean Browser Load Check

The packaged zip was extracted to a temporary directory and loaded into Microsoft Edge with:

- a fresh temporary `--user-data-dir`
- `--disable-extensions-except=<extracted artifact>`
- `--load-extension=<extracted artifact>`
- remote debugging enabled for inspection

Observed results:

- Browser: Microsoft Edge `Edg/149.0.4022.80`.
- MV3 service worker target appeared at `chrome-extension://npdjaloljfdhhjbncnidclehlglciifo/background.js`.
- Popup page opened at `chrome-extension://npdjaloljfdhhjbncnidclehlglciifo/popup/index.html` with title `Bili-Bill`.
- Dashboard page opened at `chrome-extension://npdjaloljfdhhjbncnidclehlglciifo/dashboard/index.html` with title `Bili-Bill 面板`.
- No manifest rejection was observed during extension load.
- The temporary clean browser data directory and extracted check directory were removed after the check.

## Copy / Positioning Scan

Scoped scans of the changed report found:

- no new forbidden legacy status wording
- no new forbidden Dynamic Bill positioning wording
- no user-facing implementation-field copy

Dynamic Bill 定位保持为“兴趣再平衡”。

## Blocker / Must-Fix / Follow-Up

Blocker:

- None found.

Must-fix:

- None found.

Follow-up:

- The Vite development dependency audit item should be handled in a separate dependency-maintenance slice; it was not changed here because #157 is package/report only.
- The existing Vite large chunk warning and current chunk-organization notices remain build hygiene, not a package blocker.
- Tag creation, GitHub Release creation, and store publication remain out of scope for #157.

## Privacy Confirmation

Confirmed for this packaging slice:

- did not read local key files
- did not read browser session credential files
- did not read real browser user-data directories
- did not read Bilibili login files from disk
- used only a temporary clean browser data directory for the load check
- did not upload full history, favorites, following lists, feedback records, or local database contents
- did not write back to Bilibili
