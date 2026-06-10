# Bili-Bill 0.10.0-alpha Clean Smoke Report

Issue: #63

Date: 2026-06-11

## Baseline

- Branch under test: `codex/release-0.10-alpha-smoke`
- Worktree: `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.10-smoke`
- Retest baseline includes the #71 blocker fix from PR #72:
  - merged PR: `https://github.com/LittleNuB/BiliBili-DataViz-Plugin/pull/72`
  - GitHub merge commit: `ee643bcbc9f2eaabdabf9c16f5c6c7f9d6c821e0`
  - local rebase base used for this retest: `c285cd92651b7fd8322ae6507625e2defa68e755` (`codex/fix-player-monitor-content-script`)
- Previous smoke report blocker: `player-monitor` classic content script was emitted with a top-level ESM import and failed on public Bilibili video pages.

## Scope

This pass re-ran the clean smoke after the #71 fix:

- keep the PR scope as smoke reporting only
- re-run focused tests, typecheck, and build
- verify `dist/content/player-monitor.js` is now emitted as a classic content script without a top-level ESM import
- re-run clean-profile unpacked-extension smoke for popup, dashboard overview, Smart Favorites Q&A local fallback, Dynamic Bill entry, Current Video Assistant current-context, and Video Knowledge current-context

No product feature, version metadata, manifest metadata, tag, release artifact, or GitHub Release change was made in this PR.

## Version And Manifest Check

Confirmed in this retest:

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
- Temporary browser profile used for this retest: `C:\Users\LITTLE~1\AppData\Local\Temp\bilibill-smoke-rerun-h0cv57sv`
- Runtime extension id during smoke: `ognjdpcomghnidghkhbdihlfiojmdanf`
- Public video URL used for current-context retest: `https://www.bilibili.com/video/BV1TNE965ESB?track_id=`
- Temporary profile was created only for this retest and was deleted afterward

## Commands And Results

| Command | Result |
| --- | --- |
| `git rebase codex/fix-player-monitor-content-script` | Pass. Smoke branch rebased onto the local head that corresponds to merged PR #72. |
| `npm run test:favorites` | Pass. 15 tests passed. |
| `npm run test:current-video-summary` | Pass. 9 tests passed. |
| `npm run test:video-knowledge` | Pass. 5 tests passed. |
| `npm run typecheck` | Pass. `tsc --noEmit` completed. |
| `npm run build` | Pass. Main Vite build plus dedicated `vite.player-monitor.config.ts` build completed. |
| `rg -n "^import\\s" dist/content/player-monitor.js` | Pass. No top-level ESM import remained in the emitted classic content script. |

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
| Current-video page overlay current-context | Pass | On the public Bilibili video page, the injected `Bili-Bill local assistant` overlay loaded and showed `description summary / medium confidence`, `BVID BV1TNE965ESB`, and source availability details. |
| Popup opens | Pass | `chrome-extension://.../popup/index.html` loaded with title `Bili-Bill`. |
| Popup overview path | Pass | Clicking `打开总览` opened `chrome-extension://.../dashboard/index.html`. |
| Popup Dynamic Bill path | Pass | Clicking `动态账单入口` opened `chrome-extension://.../dashboard/index.html#dynamic-bill`. |
| Dashboard overview | Pass | Overview route loaded with export actions and empty/local-only metrics in the clean profile. |
| Smart Favorites Q&A local fallback | Pass | Clean profile with no synced favorites returned `no_result`, `confidence: low`, `status: no_result`, and `AI: local_fallback`. |
| Dynamic Bill no-crash state | Pass | Dynamic Bill route loaded, showed clean-profile empty state, and kept the three local columns `久违更新 / 换换口味 / 被淹没的关注`. |

### Fixed By #71

The previous blocker is fixed in this retest:

- `dist/content/player-monitor.js` no longer ships with a top-level ESM import
- public Bilibili video page injection no longer hit `Cannot use import statement outside a module`
- current-video overlay now renders on the public video page with metadata/description context

### New Remaining Blocker

| Area | Result | Evidence |
| --- | --- | --- |
| Popup Current Video Assistant current-context | Blocked | Even with the video page open and overlay active, the popup still rendered `No current video context. Open a Bilibili video page to see metadata and source availability.` |
| Popup Video Knowledge current-context | Blocked | In the same popup session, `Video knowledge v0` still rendered `No current video context is available for knowledge nodes.` |

### Root Cause Evidence

The remaining blocker is different from the old content-script import failure.

Observed runtime behavior:

- the public video page overlay loaded successfully, proving the `player-monitor` content script executed and produced current-video page context
- immediately after opening the popup window, Popup and Video Knowledge still resolved to no-context state

Confirmed debug evidence from the extension runtime:

- when the popup window is open, the background tab lookup returns the popup tab itself:
  - `chrome.tabs.query({ active: true, currentWindow: true })`
  - returned `chrome-extension://.../popup/index.html`
- `chrome.tabs.query({ active: true, lastFocusedWindow: true })` returned the same popup tab in this smoke run

Relevant code path:

- `src/background/messages/handlers.ts`
- `getCurrentVideoContextForActiveTab()` still queries the active tab from the popup window context instead of resolving the last active Bilibili video tab that already published current-video context

Effect:

- #71 fixed current-video page collection
- Popup / Video Knowledge current-context remains blocked because the lookup path points at the popup extension tab rather than the Bilibili video tab

## Coverage Limits That Are Not Blockers

- This pass intentionally did not reuse or inspect any real Bilibili login state.
- Real logged-in Dynamic Bill sync, followed-creator snapshots, favorite sync against live account data, and real current-user history data were not exercised.
- Not covering real login-backed Dynamic Bill generation is expected for this clean-profile smoke and is not a blocker by itself.

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

- #71 fixed the original `player-monitor` content-script build blocker.
- A new runtime blocker remains: Popup Current Video Assistant and Popup Video Knowledge still do not resolve current-context in the clean popup window flow because active-tab lookup resolves the popup extension page, not the Bilibili video tab.

### Must-Fix Before Release Prep

- Update current-video / Video Knowledge tab resolution so popup requests can read the already-collected current-video context from the active Bilibili video tab instead of the popup extension tab, then rerun clean smoke.

### Follow-Up

- Keep the Vite large chunk warning on the release checklist as non-blocking build hygiene.
- After the popup current-context tab-resolution issue is fixed, rerun the clean-profile smoke before package-artifact work.
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

This clean smoke retest still does not clear 0.10.0-alpha yet.

Reason: #71 fixed the original content-script import blocker and restored current-video page overlay behavior on a public Bilibili video page, but the popup flow still cannot resolve current-video context or Video Knowledge current-context because it queries the popup extension tab instead of the video tab. The known Vite large chunk warning remains non-blocking.
