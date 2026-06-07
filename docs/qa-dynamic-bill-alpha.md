# Dynamic Bill Pre-Release QA And Alpha Report

Date: 2026-06-06
Branch: `codex/issue-11-dynamic-bill-qa`
Baseline: `e2fad7135b199f3058b5b09bf812020dcca4327e` from remote `codex/bili-bill-vnext`
PR policy: PR #12 remains draft. This QA does not merge `codex/bili-bill-vnext` into `main`.

## Conclusion

Dynamic bill vNext is suitable to keep as the draft replacement candidate for the current main line, but should not be merged to `main` until #12 is explicitly promoted out of draft after review.

No open blocker remains from this QA pass. Two must-fix issues were found and fixed in this branch:

- AI prompt facts for buried-follow items included privacy-audit category names such as complete history / complete following list. The prompt now filters those terms and the buried-follow fact no longer carries that meta copy.
- The rendered dynamic bill page did not directly say "兴趣再平衡"; the hero copy now states that positioning without using "猜你喜欢".

## Findings

### Blocker

None found.

### Must-Fix

Fixed: AI payload privacy wording leak.

- Before fix: `localEvidence.facts` could include a human-facing sentence mentioning complete history and complete following list. No actual complete history/list data was present, but the payload still contained forbidden category names.
- Fix: `src/background/dynamic-bill/ai.ts` now excludes facts containing privacy-sensitive terms before building the AI payload, and `src/background/dynamic-bill/buried-follow.ts` no longer inserts the meta privacy sentence into item facts.
- Verification: browser extension smoke captured AI payload keys as `column`, `video`, `localEvidence`; forbidden token scan returned `[]`.

Fixed: Alpha positioning copy.

- Before fix: the dynamic bill page described local ranking and fallback, but did not explicitly say "兴趣再平衡".
- Fix: `dashboard/modules/dynamic-bill/DynamicBillPage.tsx` hero copy now starts with "面向兴趣再平衡".
- Verification: rendered UI text contains "兴趣再平衡" and does not contain "猜你喜欢".

### Follow-Up

- Vite still reports the existing large chunk warning for `chunks/theme-*.js` at about 721 kB minified. This is not a dynamic bill functional blocker.
- This pass used a QA-operator alpha proxy with close-to-real seeded data. A separate human alpha sample can still be useful before promoting PR #12 from draft.

## Commands

```powershell
npm ci
npm run typecheck
npm run build
python .issue11_smoke.py
```

`npm run typecheck`: passed.

`npm run build`: passed. Only warning was Vite chunk-size guidance.

Browser smoke: passed with Chromium + built extension `dist`.

## Smoke Data

Seeded data approximated a real local profile:

- 12 watch-history records across older long-window and recent-window periods.
- 4 followed creators.
- 4 recent followed video updates.
- AI request intercepted at `https://api.deepseek.com/chat/completions` to cover success and failure without sending real user data.

Generated dynamic bill counts:

| Column | Count |
| --- | ---: |
| 久违更新 | 2 |
| 换换口味 | 1 |
| 被淹没的关注 | 3 |

## Required Verification Matrix

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Pass | `tsc --noEmit` completed. |
| `npm run build` | Pass | Vite production build completed. |
| Watch history / Dashboard overview | Pass | `GET_QUICK_STATS` and `GET_DASHBOARD_DATA` returned expected overview keys. |
| Smart favorites | Pass | `GET_SMART_FAVORITES` returned folders, counts, and tree keys without error. |
| Three dynamic bill columns generate | Pass | Counts: AFK 2, variety 1, buried-follow 3. |
| State flow | Pass | `unopened -> opened -> consumed -> processed`; reopening after processed stayed `processed`. |
| Filter preference persistence | Pass | Processed filter remained selected after page reload. |
| Less-remind creator/topic does not advance status | Pass | Status stayed `consumed` before/after creator and topic feedback. |
| Unfollow prompt safety | Pass | UI implementation only offers "打开 UP 主页" and "暂不处理"; copy says Bili-Bill will not modify following relationships or provide in-plugin unfollow. |
| AI generated success | Pass | Intercepted AI response produced `status=generated`, `generated=3`. |
| AI failed fallback | Pass | Forced 500 produced `status=failed`, `failed=1`, `fallback=1`. |
| AI not configured fallback | Pass | Empty API key produced `status=not_configured`, fallback for all items. |
| AI disabled fallback | Pass | Disabled config produced `status=disabled`, fallback for all items. |
| AI payload privacy | Pass | Captured payload only included `column`, `video`, `localEvidence`; forbidden-token scan was empty. |
| Source/UI no "未消费" | Pass | Implementation paths `dashboard`, `src`, `public`, `README.md` contain no "未消费"; only planning docs mention it as a forbidden legacy wording. |

## Alpha Notes

Flow exercised:

1. Seed close-to-real local history, followed creators, recent updates, and sync state.
2. Generate local bill.
3. Generate AI explanations through success, failure, disabled, and not-configured paths.
4. Open a bill video.
5. Confirm consumption via player heartbeat.
6. Mark processed.
7. Add less-remind feedback for creator and topic.

User-understanding proxy:

- "兴趣再平衡" is now directly visible in the dynamic bill hero.
- The detail panel explains "为什么出现" with local facts such as long-window positive signals, recent cooldown, followed-UP update, and same-video exclusion.
- A user can point to at least one reason for a bill item: for example, long-term positive interest, recent decline or absence, and a new post from a followed UP.
- Negative feedback and unfollow prompt should not imply direct unfollow: the prompt says Bili-Bill will not modify the Bilibili following relationship and does not provide in-plugin unfollow.

## Replacement Readiness

Recommendation: keep PR #12 as draft replacement candidate and proceed to review/promotion after this QA report is reviewed. Do not merge into `main` from this issue alone.
