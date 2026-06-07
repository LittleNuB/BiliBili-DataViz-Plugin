# Bili-Bill 0.9.0-alpha Release Package

Date: 2026-06-07
Issue: #26
Branch: `codex/release-0.9-alpha-package`
Source commit: `17d7c0d54d6bf0f65ed8309c28afb4246ece60d9`
Baseline: `origin/main @ 17d7c0d54d6bf0f65ed8309c28afb4246ece60d9`

## Artifact

| Item | Value |
| --- | --- |
| Local path | `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-package\release-artifacts\bili-bill-0.9.0-alpha.zip` |
| File size | `340994` bytes |
| SHA-256 | `75DE0E167EC1AEFFFAFA31DBA2D7BEFDB9814FE096B975CF0E5A69B7B8A678BF` |
| Manifest `version` | `0.9.0` |
| Manifest `version_name` | `0.9.0-alpha` |

The zip is a local release artifact and is not committed to git.

## Build

Commands:

```powershell
git status --short --branch
git rev-parse HEAD
git merge-base HEAD origin/main
npm ci
npm run typecheck
npm run build
Compress-Archive -Path .\dist\* -DestinationPath .\release-artifacts\bili-bill-0.9.0-alpha.zip -CompressionLevel Optimal
Get-FileHash -Algorithm SHA256 .\release-artifacts\bili-bill-0.9.0-alpha.zip
```

Results:

- Worktree was clean before packaging.
- `HEAD` and merge-base matched `17d7c0d54d6bf0f65ed8309c28afb4246ece60d9`.
- `npm ci` passed with 28 packages installed and 0 vulnerabilities reported.
- `npm run typecheck` passed.
- `npm run build` passed.
- Vite reported the known non-blocking large chunk warning for `dist/chunks/theme-BXY0bwcN.js` at `721.60 kB` minified.

## Content Boundary

The package was created from the contents of `dist/` only. The zip root contains the extension runtime files:

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

Validation found no `src/`, `node_modules/`, `.git/`, `release-artifacts/`, local test data, screenshots, logs, Cookie files, key files, local browser profile data, or user data in the zip.

## Unpack Verification

The zip was extracted to a temporary directory and checked as an unpacked extension payload.

Checks:

- `manifest.json` exists at the zip root.
- Manifest JSON parses as UTF-8.
- Manifest `version` is `0.9.0`.
- Manifest `version_name` is `0.9.0-alpha`.
- Required runtime entries exist: `background.js`, `popup/index.html`, `dashboard/index.html`, `content/player-monitor.js`, and `content/sidebar-card.js`.
- Content boundary scan found 0 forbidden entries.

Microsoft Edge was also launched with a new temporary empty profile and the extracted artifact loaded via `--load-extension`. Remote debugging observed the MV3 service worker target:

```text
chrome-extension://hojcnbaciddinjjgjfodobhijacmofcn/background.js
```

This verification did not reuse local browser profiles, Bilibili cookies, local API keys, key files, or other sensitive files.

## Release Scope

No tag was created.
No GitHub Release was created.
No store package was published.

Dynamic bill remains documented as interest rebalancing, not recommendation ranking.

## Blocker / Must-Fix / Follow-Up

Blocker:

- None found.

Must-fix:

- None found.

Follow-up:

- The existing Vite large chunk warning remains build hygiene and is not a packaging blocker.
- Tag creation, GitHub Release creation, and store publication remain out of scope for #26 and are left for #27 after user or main Agent confirmation.
