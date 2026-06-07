# Bili-Bill 0.9.0-alpha Clean Install Smoke

Date: 2026-06-07
Issue: #25
Branch: `codex/release-0.9-alpha-clean-smoke`
Baseline: `origin/main @ 021935b49a96461e5719ce8d4dd3afd243937718`

## Environment

| Item | Value |
| --- | --- |
| OS | Microsoft Windows 11 Home China 10.0.26200 |
| Browser | Microsoft Edge `Edg/149.0.4022.52` |
| Node | `v24.14.1` |
| npm | `11.11.0` |
| Package version | `0.9.0-alpha` |
| Manifest | MV3, `version=0.9.0`, `version_name=0.9.0-alpha` |
| Extension load mode | Unpacked `dist/` in a temporary empty Edge profile |

The smoke used a clean temporary browser profile and did not read, copy, or reuse local Bilibili cookies, existing browser profile data, local API keys, or any local key files.

## Commands

```powershell
git status --short --branch
git fetch origin main --prune
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
npm ci
npm run typecheck
npm run build
```

Results:

- Worktree was clean before the smoke.
- `HEAD`, `origin/main`, and merge-base were all `021935b49a96461e5719ce8d4dd3afd243937718`.
- `npm ci` passed with 28 packages installed and 0 vulnerabilities reported.
- `npm run typecheck` passed.
- `npm run build` passed.
- Vite reported the existing non-blocking large chunk warning for `dist/chunks/theme-BXY0bwcN.js` at about 721.60 kB minified.

## Extension Smoke

Method:

- Launched Microsoft Edge with `--user-data-dir` pointing at a new temp directory.
- Loaded only the built extension with `--disable-extensions-except=<repo>\dist` and `--load-extension=<repo>\dist`.
- Verified the MV3 service worker target appeared at `chrome-extension://aehoiebcoeplmkaokiobjokbbjbiljoo/background.js`.
- Opened extension pages through `chrome-extension://...` URLs and checked visible rendered text and crash state.

| Check | Result | Classification | Evidence |
| --- | --- | --- | --- |
| Clean worktree and current main baseline | Pass | None | Clean branch at `021935b49a96461e5719ce8d4dd3afd243937718`; merge-base matched `origin/main`. |
| Clean install with `npm ci` | Pass | None | Completed successfully; 0 vulnerabilities. |
| `npm run typecheck` | Pass | None | `tsc --noEmit` completed. |
| `npm run build` | Pass | Follow-up | Build completed; Vite large chunk warning remains non-blocking. |
| Built `dist/` loads as unpacked extension | Pass | None | Edge exposed the extension service worker target; no manifest rejection observed. |
| Popup opens | Pass | None | Popup rendered `Bili-Bill`, sync controls, quick stats, `打开总览`, and `动态账单入口`. |
| Popup can enter Dashboard | Pass | None | Clicking `打开总览` opened `chrome-extension://.../dashboard/index.html`. |
| Dashboard overview renders | Pass | None | Overview showed `Dashboard / 总览`, empty local history state, and summary cards without crash UI. |
| Watch history overview entry renders | Pass | None | The overview navigation and empty local history text rendered in the clean profile. |
| Smart favorites entry renders | Pass | None | `Dashboard / 智能收藏` showed folder/video/index counters and controls without crash UI. |
| Dynamic bill entry renders | Pass | None | `Dashboard / 动态账单` showed sync, local bill, AI controls, status filters, and empty counts without crash UI. |
| Dynamic bill logged-out / empty state | Pass | None | Clean profile showed `待同步`, zero followed creators, zero recent posts, and no crash UI. |
| Dynamic bill three-column generation | Not covered | Follow-up | No Bilibili login state was used, and no committed seed fixture or mock smoke harness was available in this branch. |
| AI disabled / not configured fallback evidence | Pass | None | Dynamic bill page displayed local evidence fallback copy and stated AI is only used for explanation display. |
| No local sensitive file access | Pass | None | The smoke did not read, copy, log, or submit local key files, including `C:\Users\LittleNub\Desktop\Key.txt`. |
| Product positioning | Pass | None | Rendered dynamic bill copy states `面向兴趣再平衡`; no product-function files contain the forbidden legacy status wording. |

## Blocker / Must-Fix / Follow-Up

Blocker:

- None found.

Must-fix:

- None found in this smoke.

Follow-up:

- Vite still emits the known large chunk warning for the theme chunk. This is build hygiene, not a release blocker for this smoke.
- Three-column dynamic bill generation still needs a logged-in human smoke or a committed deterministic seed/mock harness. This pass intentionally did not reuse local cookies or browser profile data.

## Conclusion

The 0.9.0-alpha clean install smoke passes for install, typecheck, production build, unpacked extension loading, popup-to-dashboard navigation, dashboard overview, smart favorites, dynamic bill entry rendering, logged-out clean-profile behavior, and AI fallback copy.

No blocker or must-fix item was found. The only release follow-ups are the existing large chunk warning and a separate logged-in or seeded dynamic bill generation pass.
