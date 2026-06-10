# Bili-Bill 0.10.0-alpha Clean Smoke Report

Issue: #63

Date: 2026-06-11

## Baseline

- Branch under test: `codex/release-0.10-alpha-smoke`
- Worktree: `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.10-smoke`
- Final retest baseline includes both blocker fixes now merged to `main`:
  - PR #72 / Issue #71 merge commit: `ee643bcbc9f2eaabdabf9c16f5c6c7f9d6c821e0`
  - PR #74 / Issue #73 merge commit: `2df9665f5fa19eab28752b7edd592dc4aed69360`
- Local rebase base used for this final smoke rerun: `7b6c09b87270f4989815b26d97e0e7ebe44fffa6` (`codex/fix-popup-current-video-tab-resolution`), which corresponds to the changes merged by PR #74.

## Scope

This pass is the final clean smoke rerun after #71 and #73 landed:

- keep PR #70 as a smoke-report-only PR
- run focused tests, typecheck, and build
- verify `dist/content/player-monitor.js` still ships as a classic-content-script-safe bundle without a top-level ESM import
- rerun clean-profile unpacked-extension smoke for:
  - current-video page overlay
  - popup open path
  - dashboard overview path
  - Smart Favorites Q&A local fallback
  - Dynamic Bill entry and clean-profile no-crash state
  - popup Current Video Assistant current-context
  - popup Video Knowledge current-context

No product feature, version metadata, manifest metadata, release notes, artifact, tag, or GitHub Release change was made in this PR.

## Version And Manifest Check

Confirmed in this final rerun:

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
- Temporary browser profile used for this final rerun: `C:\Users\LITTLE~1\AppData\Local\Temp\bilibill-smoke-final-bmwbwq8n`
- Runtime extension id during smoke: `ognjdpcomghnidghkhbdihlfiojmdanf`
- Public video URL used for current-context verification: `https://www.bilibili.com/video/BV1TNE965ESB?track_id=`
- Temporary profile was created only for this rerun and was deleted afterward

## Commands And Results

| Command | Result |
| --- | --- |
| `git rebase --onto codex/fix-popup-current-video-tab-resolution c285cd92651b7fd8322ae6507625e2defa68e755 codex/release-0.10-alpha-smoke` | Pass. Rebased the smoke-report commits onto the post-#73 fix baseline while keeping the branch diff docs-only. |
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
| Current-video page overlay current-context | Pass | On the public Bilibili video page, the injected `Bili-Bill local assistant` overlay loaded and showed a `description summary / medium confidence` result with `BVID BV1TNE965ESB`. |
| Popup opens | Pass | `chrome-extension://.../popup/index.html` loaded with title `Bili-Bill`. |
| Popup overview path | Pass | Clicking the overview entry opened `chrome-extension://.../dashboard/index.html`. |
| Popup Dynamic Bill path | Pass | Clicking the Dynamic Bill entry opened `chrome-extension://.../dashboard/index.html#dynamic-bill`. |
| Dashboard overview | Pass | Overview route loaded with export actions and clean-profile local metrics. |
| Smart Favorites Q&A local fallback | Pass | Clean profile with no synced favorites returned `no_result`, `confidence: low`, `status: no_result`, and `AI: local_fallback`. |
| Dynamic Bill clean-profile state | Pass | Dynamic Bill route loaded, showed the clean-profile empty state, and kept the three local columns `久违更新 / 换换口味 / 被淹没的关注`. |
| Popup Current Video Assistant current-context | Pass | Popup resolved the same public video tab and showed the current-video title, `BVID BV1TNE965ESB / CID unknown`, `description summary`, and local fallback source-status copy instead of no-context. |
| Popup Video Knowledge current-context | Pass | Popup `Video knowledge v0` rendered current-context nodes in the same clean-profile session, including a metadata node and a description helper node, without the previous no-context fallback. |

### Fix Verification

This final smoke rerun confirms both earlier blockers are fixed:

- #71 fix verified:
  - `dist/content/player-monitor.js` no longer ships with a top-level ESM import
  - public Bilibili video-page injection no longer fails on classic content-script parsing
- #73 fix verified:
  - popup current-video requests no longer collapse to the popup extension tab
  - popup Current Video Assistant and popup Video Knowledge now resolve the active Bilibili video context in the clean popup flow

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

None found in this final clean smoke rerun.

### Must-Fix Before Release Prep

None identified in this smoke slice.

### Follow-Up

- Keep the Vite large chunk warning on the release checklist as non-blocking build hygiene.
- If release owners want additional live-data confidence later, run one explicitly approved logged-in manual pass without reading cookies or profile files from disk.
- Package-artifact work can proceed separately now that the clean-profile smoke path is clear.

## Privacy Confirmation

Confirmed for this pass:

- did not read local key files
- did not read Cookie files
- did not read or reuse browser profile files
- did not read Bilibili login-state files
- did not upload full history, favorites, following lists, feedback records, or database contents
- did not write back to Bilibili

## Conclusion

This final clean smoke rerun clears 0.10.0-alpha for Issue #63.

Reason: focused tests, typecheck, build, player-monitor output verification, current-video page overlay, popup current-context, Video Knowledge current-context, Dashboard overview, Smart Favorites local fallback, and Dynamic Bill clean-profile entry state all passed. The only remaining build observation is the known non-blocking Vite large chunk warning.
