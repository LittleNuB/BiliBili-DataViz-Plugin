# Bili-Bill 0.13.0-alpha Clean Smoke Report

Date: 2026-08-01

Issue: #199

## Baseline

- Branch: `codex/0.13-release-candidate`
- Clean sibling worktree: `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-0.13-release-candidate`
- Runtime baseline: `origin/main @ f6b8e1f2d47e2f325500f786e2224653a0408ef5`
- Release metadata: package `0.13.0-alpha`; Manifest `version = 0.13.0`, `version_name = 0.13.0-alpha`

The branch adds release-only documentation, packaging automation, and a smoke-harness path override. It does not alter extension runtime behavior.

## Environment

- OS: `Microsoft Windows NT 10.0.26200.0`
- Node.js: `v24.14.1`
- npm: `11.11.0`
- Python: `3.12.10`
- Microsoft Edge: `150.0.4078.105`
- Browser state: fresh temporary Playwright profile only

No Cookie, browser profile, login-state, key, or `C:\Users\LittleNub\Desktop\Key.txt` file was read.

## Commands And Results

| Check | Result |
| --- | --- |
| `npm ci` | Pass; 29 packages installed, audit summary 0 vulnerabilities. |
| `npm test` | Pass; 478/478. |
| `npm run typecheck` | Pass. |
| `npm run build` | Pass; both extension targets built and five required license files verified in `dist/`. |
| `npm audit` | Pass; 0 vulnerabilities. |
| `git diff --check` | Pass. |
| Copy scan | Pass; no blocked dynamic-bill wording in implementation/user documentation scope. |
| Visible raw-field checks | Pass in production Browser/mock suites; source hits are internal guards/types/tests only. |

The build still emits the known dynamic/static import notices and a `766.07 kB` minified chart/theme chunk warning. They are recorded as non-blocking follow-up work.

## Production Browser / Mock QA

| Area | Result | Coverage |
| --- | --- | --- |
| Preference word cloud | Pass | Real production canvas rendered; nonblank pixel threshold and no horizontal overflow at 1280 px and 390 px. |
| Video blind boxes | Pass | Four fixed cards, real/local source labels, ready state, upstream failure, no seed, no candidate, and unopenable states. |
| Settings and local data | Pass | Persisted AI switches, privacy copy, six data categories, category clear, all-clear confirmation, readback, and responsive states. |
| Dynamic Bill | Pass | Fixed three-column layout, feedback, pause, undo, restore, prompt flow, compact partial-empty layout, and natural failures. |
| Current-video popup | Pass | Summary/highlights, answer-before-citations, unsupported and overlong context, cancellation, session isolation, immutable snapshots, preview/confirm/return, responsive and visible-copy checks. |
| Current-video primary text | Pass | Four tabs, subtitle viewing/search/follow/export, 4/8 highlights, cache and model isolation, stale/late response rejection, source changes, sessions, and timestamp races. |

## Public Bilibili Clean-Profile Smoke

The built `dist/` and the final deterministic ZIP were each loaded as an unpacked MV3 extension in a new temporary Edge profile.

Pass criteria met for both:

- MV3 service worker loaded.
- A public single-part page was recognized as the current video.
- A public multi-part page recognized the exact current part.
- The four assistant tabs rendered without visible internal identifiers or runtime errors.
- Enabling a fake AI configuration did not cause any automatic AI request while opening pages, switching videos, or opening tabs.
- The deterministic release ZIP's extracted root loaded directly without a wrapping `dist/` directory.

## Privacy And Safety Boundaries

- No real browser user-data directory or credential file was reused.
- No local key file or Bilibili login-state file was read.
- The smoke used public pages and a fake local AI probe only.
- No full history, favorites, following list, feedback records, or local database content was uploaded.
- No Bilibili relationship or content mutation was performed.
- Current-video jumps remain previewed and user-confirmed; automated tests do not invent time points.

## Residual Risk

- The clean profile did not provide a logged-in real subtitle body or call a user's actual AI provider. Those paths are covered by deterministic contracts and production mocks, but a final human pass with the user's own configured environment remains useful.
- The known large chart/theme chunk should be optimized after release rather than mixed into the candidate.

## Conclusion

No release blocker or must-fix item remains in this smoke pass. The exact 0.13 runtime baseline, release-only tooling, built distribution, and extracted package satisfy the declared alpha gate.
