# Bili-Bill 0.10.0-alpha Clean Smoke Report

Issue: #63

Date: 2026-06-11

## Baseline

- Branch under test: `codex/release-0.10-alpha-smoke`
- Worktree: `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.10-smoke`
- Baseline commit: `8d94e9d356dab4c8510a8a43feac0d821afde58d`
- Source base check: `origin/main` resolved to `8d94e9d356dab4c8510a8a43feac0d821afde58d`

## Scope

This pass covered the clean smoke verification slice only:

- confirm release metadata on latest main
- run install, focused tests, typecheck, and build
- load `dist/` as an unpacked extension in a fresh temporary browser profile
- smoke Popup, Dashboard overview, Smart Favorites Q&A local fallback, Current Video Assistant, Video Knowledge, and Dynamic Bill entry states

No product feature, version, package metadata, manifest metadata, tag, release artifact, or GitHub Release change was made.

## Version And Manifest Check

Confirmed from latest main before smoke:

- `public/manifest.json`: `version = 0.10.0`
- `public/manifest.json`: `version_name = 0.10.0-alpha`
- `dist/manifest.json`: `version = 0.10.0`
- `dist/manifest.json`: `version_name = 0.10.0-alpha`
- `package.json`: `version = 0.10.0-alpha`

## Environment

- OS: `Microsoft Windows NT 10.0.26200.0`
- Node.js: `v24.14.1`
- npm: `11.11.0`
- Browser: `Microsoft Edge 149.0.4022.52`
- Browser executable: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- Extension load target: unpacked `dist/`
- Temporary browser profile used for smoke: `C:\Users\LITTLE~1\AppData\Local\Temp\bilibill-smoke-rhypgety`
- Runtime extension id during smoke: `ognjdpcomghnidghkhbdihlfiojmdanf`
- Public video URL used for current-context attempt: `https://www.bilibili.com/video/BV1TNE965ESB?track_id=`
- Temporary profile was created only for this smoke run and was deleted afterward

## Commands And Results

| Command | Result |
| --- | --- |
| `git fetch origin main` | Pass. `origin/main` updated to `8d94e9d356dab4c8510a8a43feac0d821afde58d`. |
| `npm install` | Pass. 28 packages installed, 0 vulnerabilities. |
| `npm run test:favorites` | Pass. 15 tests passed. |
| `npm run test:current-video-summary` | Pass. 9 tests passed. |
| `npm run test:video-knowledge` | Pass. 5 tests passed. |
| `npm run typecheck` | Pass. `tsc --noEmit` completed. |
| `npm run build` | Pass. Production build completed. |

Build warning:

- Non-blocking known warning remains: Vite reported `dist/chunks/theme-BXY0bwcN.js` above 500 kB after minification.

## Browser / Extension Smoke

Privacy boundary for this pass:

- fresh temporary browser profile only
- no reuse of local Bilibili cookies
- no reuse of real browser profile data
- no reuse of login-state files
- no read of `C:\Users\LittleNub\Desktop\Key.txt`

### Pass

| Area | Result | Evidence |
| --- | --- | --- |
| Popup opens | Pass | `chrome-extension://.../popup/index.html` loaded with title `Bili-Bill`. |
| Popup overview path | Pass | Clicking `打开总览` opened `chrome-extension://.../dashboard/index.html`. |
| Popup Dynamic Bill path | Pass | Clicking `动态账单入口` opened `chrome-extension://.../dashboard/index.html#dynamic-bill`. |
| Dashboard overview | Pass | Overview route loaded with `导出 JSON` / `导出 CSV`, empty weekly/monthly metrics, and empty local-history state. |
| Smart Favorites Q&A local fallback | Pass | Clean profile with no synced favorites returned `no_result`, `confidence: low`, `status: no_result`, and `AI: local_fallback`. |
| Current Video Assistant no-context | Pass | Popup showed `No current video context. Open a Bilibili video page to see metadata and source availability.` |
| Video Knowledge no-context | Pass | Popup showed `Video knowledge v0` and `No current video context is available for knowledge nodes.` |
| Dynamic Bill no-crash state | Pass | Dynamic Bill route loaded, showed clean-profile empty state, sync/generate controls, and the three local columns `久违更新 / 换换口味 / 被淹没的关注`. |

### Blocked

| Area | Result | Evidence |
| --- | --- | --- |
| Current Video Assistant current-context | Blocked | On a public Bilibili video page, popup still stayed in `No current video context` after refresh and after reopening the popup in a fresh extension window. |
| Video Knowledge current-context | Blocked | On the same public Bilibili video page, popup still showed zero knowledge nodes and the same no-context message. |

### Root Cause Evidence

This is not a login-state limitation. The blocker reproduced on a public video page in a clean profile and points to the current-video content script build output:

- `dist/content/player-monitor.js` starts with an ESM import:
  - `import { ... } from "../chunks/current-video-summary-BGvYK5Jn.js";`
- `manifest.json` registers `content/player-monitor.js` as a classic content script under `content_scripts`, not as a module script.
- On the public video page smoke attempt, the page surfaced:
  - `Cannot use import statement outside a module`
- Because `player-monitor` did not execute cleanly on the video page, the background `CURRENT_VIDEO_CONTEXT_UPDATE` path never produced usable runtime current-video context for Popup or Video Knowledge.

Observed related noise:

- homepage/sidebar card smoke also emitted a non-blocking timeout while waiting for homepage sidebar targets
- those homepage/sidebar observations are secondary; the blocking issue for #63 is the current-video content script load failure

## Coverage Limits That Are Not Blockers

- This pass intentionally did not reuse or inspect any real Bilibili login state.
- Real logged-in Dynamic Bill sync, followed-creator snapshots, favorite sync against live account data, and real current-user history data were not exercised.
- Not covering real login-backed three-column generation is expected for this clean-profile smoke and is not a blocker by itself.

## Copy Scan

Scoped scan completed for:

- `dashboard`
- `popup`
- `public`
- `src`
- `README.md`
- this smoke report

Results:

- no hit for the AGENTS.md forbidden Dynamic Bill copy patterns

## Findings

### Blockers

- Current-video clean smoke is blocked on the `player-monitor` content script build artifact being emitted as ESM while the manifest injects it as a classic content script. This prevents current-context runtime collection on public Bilibili video pages, which in turn blocks Popup Current Video Assistant current-context and Video Knowledge current-context smoke coverage.

### Must-Fix Before Release Prep

- Fix the `content/player-monitor.js` bundling/loading path so the content script executes on `*://www.bilibili.com/video/*` without `import` parse failure, then rerun the clean smoke for Popup Current Video Assistant and Video Knowledge current-context states.

### Follow-Up

- Keep the Vite large chunk warning on the release checklist as non-blocking build hygiene.
- After the current-video content script load issue is fixed, rerun this clean-profile smoke before package-artifact work.
- If release owners still want live-data confidence after clean smoke passes, run one explicitly approved logged-in manual pass without reading cookies or profile files from disk.

## Privacy Confirmation

Confirmed for this pass:

- did not read local key files
- did not read Cookie files
- did not read or reuse browser profile files
- did not read Bilibili login-state files
- did not upload full history, favorites, following lists, feedback records, or database contents
- did not write back to Bilibili

## Conclusion

This clean smoke pass does not clear 0.10.0-alpha yet.

Reason: install, focused tests, typecheck, build, Popup entry paths, Dashboard overview, Smart Favorites local fallback, and Dynamic Bill no-crash state all passed, but current-video current-context and Video Knowledge current-context are blocked by the `player-monitor` content script load failure on public Bilibili video pages. The known Vite large chunk warning remains non-blocking.
