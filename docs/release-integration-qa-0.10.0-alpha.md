# Bili-Bill 0.10.0-alpha Integration QA Readiness

Issue: #60

Date: 2026-06-10

## Baseline

- Branch under test: `codex/release-0.10-alpha-integration-qa`
- Worktree: `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.10-integration-qa`
- Baseline commit: `40f1c4db60e660d8a792b1928783a8e718e3524d`
- Source base: latest `origin/main` at the requested baseline.

## Scope

This pass covered the 0.10.0-alpha release candidate mainline after the #47-#52 feature slices landed:

- Current Video Assistant popup surface.
- Smart Favorites Q&A local retrieval and optional AI synthesis fallback.
- Video Knowledge v0 source-bound node and manual jump safeguards.
- Existing Popup, Dashboard overview, Dynamic Bill, and Smart Favorites page entry paths.

No product feature, version, tag, release artifact, or GitHub Release change was made.

## Commands And Results

| Command | Result |
| --- | --- |
| `npm ci` | Pass. 28 packages installed, 0 vulnerabilities. |
| `npm run test:favorites` | Pass. 15 tests passed, including favorite sync audit, local Q&A, AI fallback, citation guard, and payload audit cases. |
| `npm run test:current-video-summary` | Pass. 9 tests passed, including source tiers, fallback states, cancellation, and payload audit cases. |
| `npm run test:video-knowledge` | Pass. 5 tests passed, including no-context fallback, metadata-only node, page/chapter nodes, and manual jump preview boundaries. |
| `npm run typecheck` | Pass. `tsc --noEmit` completed. |
| `npm run build` | Pass. Production build completed. |

Build warning:

- Non-blocking known warning remains: Vite reports `dist/chunks/theme-BXY0bwcN.js` is larger than 500 kB after minification.

## Browser / Extension Smoke

Environment:

- Browser: Microsoft Edge from `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- Profile: fresh temporary `--user-data-dir` under `%TEMP%`
- Extension: unpacked `dist/`
- Runtime extension id in this smoke run: `nlhnbmmehkmbfpndhdnjbelafoncpjeb`
- No local browser profile, Cookie store, Bilibili login state, or local key file was reused.

Smoke results:

| Area | Result | Evidence |
| --- | --- | --- |
| Popup opens | Pass | `chrome-extension://.../popup/index.html` loaded with title `Bili-Bill`; no console errors captured. |
| Popup overview entry | Pass | Clicking `Open overview` created `chrome-extension://.../dashboard/index.html`. |
| Popup Dynamic Bill entry | Pass | Clicking the Dynamic Bill entry created `chrome-extension://.../dashboard/index.html#dynamic-bill`. |
| Dashboard overview | Pass | Overview route loaded, showed empty local history metrics and export controls; no console errors captured. |
| Dynamic Bill page | Pass | Route loaded, showed local-evidence positioning, sync/generate controls, empty no-login/no-data states, and three local evidence columns; no console errors captured. |
| Smart Favorites page | Pass | Route loaded, showed sync, index, AI config, Q&A input, disabled AI toggles by default, and empty classification state; no console errors captured. |
| Smart Favorites Q&A empty data | Pass | Submitted an empty-profile question. UI returned `no_result`, low confidence, `AI: local_fallback`, zero cited cards, and no console errors. |
| Current Video Assistant no context | Pass | Popup showed no current video context and explained that a Bilibili video page is needed for metadata/source availability. |
| Video Knowledge v0 no context | Pass | Popup showed Video Knowledge v0, no transcript notice, no context limitations, and no nodes. |
| Manual jump preview | Limited pass | Real jump was not available because the clean profile had no current video context and no nodes. Unit tests verified page/chapter nodes require manual confirmation; smoke verified no auto-jump surface appears in no-context state. |

Limitations:

- This pass intentionally did not use a logged-in Bilibili profile. Dynamic Bill sync, favorite sync, and actual current-video context extraction were only verified through empty/no-context states plus unit tests.
- No write action was made against Bilibili.

## Feature Coverage Notes

### Current Video Assistant

- Local no-context fallback is visible in Popup.
- Source-tier behavior is covered by tests: metadata-only and description summary modes keep transcript/content text unavailable and avoid full-video claims.
- AI disabled, not configured, failed, low-confidence, loading, and cancelled states are covered by focused tests.

### Smart Favorites Q&A

- Dashboard Q&A entry is visible.
- Default AI toggles are off in a clean profile.
- Empty local data returns local cited retrieval fallback rather than generated guesses.
- Focused tests cover cited videos, source fields, sync/index coverage, stale index, incomplete sync diagnostics, AI disabled/not configured/failed, citation rejection, and payload allowlist enforcement.

### Video Knowledge v0

- Popup no-context state is visible.
- Smoke verified no nodes and no automatic jump affordance when no context exists.
- Focused tests cover metadata-only nodes without fabricated timestamps, description helper without jump target, page/chapter nodes with confirmation-required jump actions, invalid chapter filtering, and no-context fallback.

### Dynamic Bill / Dashboard / Popup

- Popup opens and can route to Dashboard overview and Dynamic Bill.
- Dashboard overview opens with empty local history state.
- Dynamic Bill opens without crashing in a clean no-login profile and shows empty sync/generate states.
- Dynamic Bill copy remains positioned as local interest rebalancing and does not present the feature as a generic recommendation feed.

## Forbidden Copy Scan

Runtime/source scan result:

- `dashboard`, `popup`, `public`, `src`, `README.md`, and `tests` were checked for the AGENTS.md forbidden Dynamic Bill copy patterns.
- No runtime/source hit was found in those scoped paths.

Existing historical docs outside this release report still contain those phrases as explicit forbidden examples in planning/QA documents. This report does not add those phrases.

## Privacy / Safety Confirmation

Confirmed:

- Did not read `C:\Users\LittleNub\Desktop\Key.txt`.
- Did not read Cookie files.
- Did not read or reuse a local browser profile.
- Did not read Bilibili login-state files.
- Did not upload full history, full favorites, full following lists, feedback records, or local database dumps.
- Did not write back to Bilibili.
- Extension smoke used a fresh temporary browser profile and only loaded local `dist/`.

## Findings

### Blockers

None found.

### Must-Fix Before Release Prep

None found in this pass.

### Follow-Up

- Keep the Vite large chunk warning on the release-prep checklist as non-blocking build hygiene.
- Run one logged-in manual smoke before broad alpha distribution if the release owner wants real Bilibili favorite/dynamic/current-video data coverage. That should use an explicitly approved test profile and still avoid reading profile files directly.
- Consider a future browser-level smoke harness that can seed extension storage with mock favorites and current-video context, so cited cards and manual jump preview can be verified without personal data.

## Readiness Conclusion

Recommend proceeding to #61/#62 release prep as a draft release candidate.

Rationale: required focused tests, typecheck, build, and clean-profile extension smoke passed. The only observed warning is the known Vite large chunk warning, and no blocker or must-fix item was found. Data-dependent online flows remain a non-blocking manual follow-up because this QA pass intentionally avoided local login state and personal browser data.
