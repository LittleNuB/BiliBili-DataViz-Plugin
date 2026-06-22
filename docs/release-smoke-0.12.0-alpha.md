# Bili-Bill 0.12.0-alpha Clean Smoke Report

Issue: #156

Date: 2026-06-22

## Baseline

- Branch under test: `codex/release-0.12-alpha-smoke`
- Worktree: `C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.12-alpha-smoke`
- Baseline commit: `d03aa49dca21915e9c7f79da0e7593d169b87d81`
- Baseline source: refreshed `origin/main` after #154 metadata and #155 release notes were merged.

## Scope

This pass verifies the `0.12.0-alpha` clean release candidate after the release metadata and release notes landed.

Covered areas:

- Settings: AI configuration, feature switches, privacy copy, and local-data actions.
- Current-video Agent: no-context/current-context states, cited answers, query rewrite, and preview/confirm/return timestamp flow.
- Related favorites: current-video related collection hints scoped to currently synced favorites.
- Smart Favorites: local cited Q&A and incomplete-sync boundary behavior.
- Video blind box: random exploration, variety exploration, local收藏回访, local interest review, source explanations, and degraded states.
- Copy, privacy, and raw/internal field visibility boundaries.

This PR changes only this smoke report. It does not change product behavior, version metadata, manifest metadata, release notes, release artifacts, tags, or GitHub Releases.

## Version And Manifest Check

Confirmed on `origin/main` after #154:

- `package.json`: `version = 0.12.0-alpha`
- `package-lock.json`: root package version = `0.12.0-alpha`
- `public/manifest.json`: `version = 0.12.0`
- `public/manifest.json`: `version_name = 0.12.0-alpha`

## Environment

- OS: `Microsoft Windows NT 10.0.26200.0`
- Node.js: `v24.14.1`
- npm: `11.11.0`
- Browser used by the delegated smoke pass: Microsoft Edge `149.0.4022.80`
- Extension load target: unpacked `dist/`
- Browser data policy: temporary clean browser user-data directory only; no real browser user-data directory or local credential files were reused.

## Commands And Results

| Command | Result |
| --- | --- |
| `npm ci` | Pass in delegated smoke pass. Installed dependencies and reported the existing high-severity Vite audit advisory. |
| `npm audit --json` | Completed in delegated smoke pass. Reported the existing Vite advisories `GHSA-v6wh-96g9-6wx3` and `GHSA-fx2h-pf6j-xcff`. |
| `node --test tests/ai-connection.test.ts tests/settings-local-data-privacy.test.ts` | Pass. 6 passed. Covers minimal AI health-check payload and settings local-data/privacy messages. |
| `node --test` current-video focused group | Pass. 106 passed in the main-agent rerun. Covers context resolution, subtitle diagnostics, evidence cache, Q&A, local query rewrite, guarded rerank, timestamp preview/confirm/return, summary, and knowledge nodes. |
| `npm run test:favorites` | Pass. 29 passed. Covers favorite sync diagnostics, Smart Favorites index/Q&A, incomplete-sync boundaries, related favorites, AI payload audit, and cited local answers. |
| `npm run test:experiments` | Pass. 5 passed. Covers video blind-box source boundaries, real candidate downgrades, local evidence empty states, and no local-random replacement when real candidates fail. |
| `npm run typecheck` | Pass. `tsc --noEmit` completed. |
| `npm run build` | Pass in delegated smoke pass and main-agent validation. Main Vite build and dedicated player-monitor build completed. Existing dynamic/static import and chunk-size warnings remain. |
| Copy scan for blocked Dynamic Bill wording | Completed. Implementation paths had no hits; existing docs-only planning/QA notes still contain historical or forbidden-example references. This report avoids repeating those blocked phrases. |
| Raw/internal visibility scan | Completed. Source/test hits were internal types, payload guards, assertions, styles, or docs-only privacy explanations. Mock visible text checks did not expose raw engineering identifiers. |

## Browser / Mock Smoke

The delegated smoke pass used clean browser state and committed mocks. It did not reuse the user's normal browser data.

### Browser Harness Notes

- Edge was launched with `--load-extension=dist` and a temporary clean user-data directory.
- The browser launched, but the CDP endpoint was not reliably available for automated DOM reads of extension pages in that run.
- The in-app Browser could not open `file://` committed mocks due to policy.
- The pass switched to a temporary `127.0.0.1:8123` static server for committed mocks. The server was stopped after the run.

These harness limits are not product blockers because the same flows were covered through committed mocks, focused tests, and the prior #141 integration QA.

### Pass

| Area | Result | Evidence |
| --- | --- | --- |
| Settings AI/privacy | Pass | Settings AI service configuration, model/key fields, save/test states, feature switches, and privacy text were exercised through committed settings mocks. |
| Settings local-data actions | Pass | Refresh status, current-video cache cleanup, Smart Favorites index rebuild, and dangerous local-data cleanup confirmation were covered by tests and settings mock UI. |
| Smart Favorites Q&A | Pass | Local cited Q&A, no-result, weak-evidence, stale-index, incomplete-sync, optional AI synthesis, and AI rejection paths passed focused tests. |
| Current-video no-context shell | Pass | Committed current-video shell mock rendered the no-context and bounded local states without exposing internal field names. |
| Current-video cited answer | Pass | Current-video focused tests verified cited answers only from current-video evidence and rejected unknown references or invented timestamps. |
| Timestamp preview/confirm/return | Pass | Preview did not seek; confirm changed playback position; return restored the original position. Wrong-video, stale, invalid, and live-player states failed safely. |
| Related favorites | Pass | Related favorites rendered separately from current-video answer evidence and stayed scoped to currently synced favorites. |
| Subtitle diagnostics and cached evidence states | Pass | Mock and tests covered missing CID, available tracks, active cached body, endpoint failure, access-needed state, language mismatch, and malformed source states. |
| Video blind box ready state | Pass | Random exploration and variety exploration used real B-site candidate sources; local收藏回访 and local interest review kept local-source positioning. |
| Video blind box degraded state | Pass | Empty/degraded states showed reasons and retry actions, did not show empty cards, and did not substitute local inventory for unavailable real candidates. |
| Copy/privacy boundary | Pass | Visible mock text did not expose raw engineering identifiers, local credential paths, or blocked Dynamic Bill positioning. |

## Real Site Coverage

No logged-in real B-site page smoke was performed in this slice.

Reason:

- The release rule forbids reading or reusing local credential files or real browser user-data directories.
- Real subtitle-body coverage with a logged-in account requires explicit release-owner approval and a user-prepared browser session.
- The clean automated run only used temporary browser state.

This is not a blocker for #156 because #141 already covered a temporary-browser real-page smoke with no subtitle body available, and this pass reran the committed mock and focused test coverage that exercises the cited-answer and timestamp safety paths.

## Copy / Raw Field Scan Classification

Blocked Dynamic Bill wording:

- `dashboard`, `popup`, `public`, `src`, `README.md`, and tests did not show implementation/UI hits.
- Existing Dynamic Bill planning and QA docs still contain historical examples and guardrail notes. They were not introduced by this smoke report.
- Dynamic Bill remains described as `兴趣再平衡`.

Raw/internal field visibility:

- Source/test hits are expected in type definitions, guardrails, payload audits, and test assertions.
- Docs hits are either historical QA notes or privacy explanations.
- Mock visible-text checks did not expose raw engineering identifiers to ordinary users.

## Privacy Confirmation

Confirmed for this pass:

- did not read local key files
- did not read browser credential files
- did not read or reuse real browser user-data directories
- did not read B-site login files from disk
- did not upload full history, favorites, following lists, feedback records, or database contents
- did not write back to B-site
- did not create tags, GitHub Releases, packaged zips, or store artifacts

## Findings

### Blockers

None found in this clean smoke pass.

### Must-Fix Before Packaging

None identified in this smoke slice.

### Follow-Up

- Release owner should decide whether the existing Vite audit advisory gates packaging or can be handled separately.
- Keep the existing Vite dynamic/static import and chunk-size warnings on the release checklist as build hygiene.
- If release owners want extra logged-in real subtitle-body assurance, run a separately approved manual pass using a user-prepared session; do not read local credential files from disk.

## Conclusion

Issue #156 is clear from the smoke perspective.

Focused tests, typecheck, production build, committed mock checks, privacy/copy scans, and clean temporary-browser smoke all passed or were classified. The remaining observations are existing dependency/build hygiene items rather than release-blocking functional failures.
