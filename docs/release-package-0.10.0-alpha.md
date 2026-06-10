# Bili-Bill 0.10.0-alpha Release Package

Date: 2026-06-11
Issue: #64
Branch: `codex/release-0.10-alpha-package`
Source commit: `02a075b12ea18f3131faddccb39909f719c3a324`
Baseline: `origin/main @ 02a075b12ea18f3131faddccb39909f719c3a324`

## Scope

This slice packages the verified `0.10.0-alpha` extension artifact from `dist/`, records its checksum, and documents packaging validation.

No product code, version, tag, GitHub Release, or store publication change is included here.

## Artifact

| Item | Value |
| --- | --- |
| Zip path | `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.10-package\release-artifacts\bili-bill-0.10.0-alpha.zip` |
| Checksum path | `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.10-package\release-artifacts\bili-bill-0.10.0-alpha.zip.sha256` |
| File size | `367309` bytes |
| SHA-256 | `49183AFB825FD82CD269B7257EC9C3F1BA69CCAB592B343EA414CD67AC2251C3` |
| `package.json` version | `0.10.0-alpha` |
| Manifest `version` | `0.10.0` |
| Manifest `version_name` | `0.10.0-alpha` |

The zip and checksum files are local release artifacts only and are not committed to git.

## Build Baseline

Commands run:

```powershell
git status --short --branch
git rev-parse HEAD
git merge-base HEAD origin/main
npm ci
npm run test:favorites
npm run test:current-video-summary
npm run test:video-knowledge
npm run typecheck
npm run build
```

Results:

- Worktree was clean before packaging.
- `HEAD` and merge-base both matched `02a075b12ea18f3131faddccb39909f719c3a324`.
- `npm ci` passed with 28 packages installed and 0 vulnerabilities reported.
- `npm run test:favorites` passed with 15 tests.
- `npm run test:current-video-summary` passed with 9 tests.
- `npm run test:video-knowledge` passed with 5 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Vite reported the known non-blocking large chunk warning for `dist/chunks/theme-BXY0bwcN.js` at `721.60 kB` minified.

## Package Method

The artifact was created from `dist/` contents only with a local zip step that preserved extension-relative paths at the zip root.

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
- Manifest `version` is `0.10.0`.
- Manifest `version_name` is `0.10.0-alpha`.
- Required runtime entries exist: `background.js`, `popup/index.html`, `dashboard/index.html`, `content/player-monitor.js`, and `content/sidebar-card.js`.
- Content-boundary scan found no `src/`, `node_modules/`, `.git/`, `release-artifacts/`, local test data, screenshots, logs, Cookie files, key files, login-state files, browser-profile data, or user data in the zip.

## Clean-Profile Load Check

The packaged zip was extracted to a temporary directory and loaded into Microsoft Edge with:

- a fresh temporary `--user-data-dir`
- `--disable-extensions-except=<extracted artifact>`
- `--load-extension=<extracted artifact>`
- remote debugging enabled for inspection

Observed results:

- MV3 service worker target appeared at `chrome-extension://dcdghnaibiagffnjmbladcnfemjfcdgf/background.js`.
- Popup page opened at `chrome-extension://dcdghnaibiagffnjmbladcnfemjfcdgf/popup/index.html` with title `Bili-Bill`.
- Dashboard page opened at `chrome-extension://dcdghnaibiagffnjmbladcnfemjfcdgf/dashboard/index.html` with title `Bili-Bill Dashboard`.
- No manifest rejection was observed during extension load.

## Copy / Positioning Scan

Scoped scans of `README.md`, `dashboard`, `popup`, `public`, and `src` found:

- no forbidden legacy copy hits

Dynamic Bill remains positioned as interest rebalancing rather than recommendation ranking.

## Blocker / Must-Fix / Follow-Up

Blocker:

- None found.

Must-fix:

- None found.

Follow-up:

- The existing Vite large chunk warning remains build hygiene and is not a packaging blocker.
- Tag creation and GitHub prerelease publication remain out of scope for #64 and belong to #65 after main-agent or user confirmation.

## Privacy Confirmation

Confirmed for this packaging slice:

- did not read `C:\Users\LittleNub\Desktop\Key.txt`
- did not read Cookie files
- did not read local browser profile files
- did not read Bilibili login-state files
- did not upload full history, favorites, following lists, feedback records, or local database contents
- did not write back to Bilibili
