# Popup App decomposition proposal

## Status and scope

This is a behavior-preserving implementation plan for `popup/App.tsx` only. It does not move runtime code, change a message action, change persistence, or add a visual feature. The implementation should be split into small follow-up issues rather than attempted as one large refactor.

The proposal covers both the popup shell and the current-video assistant that currently live in the same module. It does not cover the page-injected assistant in `src/content/player-monitor/assistant-status.ts`.

## Non-negotiable contracts

- Keep the four current-video product surfaces intact: subtitle/source state, summary and highlights, question/session history, and video knowledge. The popup presently renders them as adjacent panels, not as a `tablist`; no extraction may introduce tab navigation, change their order, or merge their state.
- Keep the four-tab coverage term used by the page-assistant QA separate from the popup's implementation. `CurrentVideoSegmentRetrievalPanel` is declared in `popup/App.tsx` but is not mounted by `CurrentVideoAssistantStatus`. It must stay unmounted in a decomposition-only change. Making it visible, removing it, or treating it as a fifth popup surface needs its own product issue.
- A full primary text request remains opt-in. Opening the popup, reading local cache/session state, restoring a summary, changing video, or changing the setting must never send a summary or question request. Generation is bound to the existing `onRefresh` button path and Q&A to the submitted form path.
- Current-video operations remain exact-source operations: `bvid`, `cid`, `page`, selected `sourceIdentityKey`, and the applicable request/session identity must survive every new component boundary. A stale result is discarded rather than retargeted to the new page or source.
- Q&A renders the answer before source metadata and citation controls. A saved answer can be shown for its captured source, but jump and retry must stay disabled when that source is no longer the current video and part.
- All timestamp operations retain preview, explicit confirmation, and return. There is no auto-seek path. The existing shared timestamp-operation busy guard must remain shared across highlights, Q&A citations, and the dormant retrieval flow.
- Preserve the existing Chinese product copy and honest terminal states. UI code continues to use user-facing labels such as `B站字幕` and `本地转录`, and must not surface internal identity, hash, fallback, or raw runtime-error fields.

## Current source map

| Area | Current responsibility | Main evidence |
| --- | --- | --- |
| Popup lifecycle | Initial stats/context fetch, 1.5 second sync-status polling, and one local-storage listener | `popup/App.tsx:171`, `popup/App.tsx:201` |
| Current-video scope | Context, summary, knowledge, subtitle status, action error, revisions, request counters, and refs used to reject late work | `popup/App.tsx:172`, `popup/App.tsx:499`, `popup/App.tsx:530` |
| Current-video root actions | Read context, restore/generate/cancel summary, refresh knowledge, reprobe subtitle, and open settings | `popup/App.tsx:256`, `popup/App.tsx:273`, `popup/App.tsx:346`, `popup/App.tsx:366`, `popup/App.tsx:399`, `popup/App.tsx:454` |
| Popup shell | Header, sync controls/progress, history-tail diagnostic, dashboard link, login/error/no-data states, and quick stats | `popup/App.tsx:592`, `popup/App.tsx:658` |
| Assistant coordinator | Q&A sessions, Q&A request tracking, preview state, and the shared timestamp busy guard | `popup/App.tsx:969`, `popup/App.tsx:1007`, `popup/App.tsx:1034` |
| Assistant composition | Subtitle/source diagnosis, summary/highlights, knowledge, Q&A, and root generation controls | `popup/App.tsx:1590` |
| Existing presentation leaves | Summary/highlight, Q&A/citation, retrieval, and knowledge renderers are local functions in the same file | `popup/App.tsx:1811`, `popup/App.tsx:2099`, `popup/App.tsx:2817`, `popup/App.tsx:3153` |
| Popup-only helpers | Primary-text authorization reads local storage; other helpers map status to natural visible text and validate bindings | `popup/App.tsx:3236`, `popup/App.tsx:3454`, `popup/App.tsx:3525`, `popup/App.tsx:3645` |

### Effects and state ownership today

`App` is the only owner of cross-feature invalidation. A primary-text-selection change increments `primaryTextSelectionRevision`; an operation-invalidating change increments `currentVideoOperationRevision`; a context change gets a new `video:bvid:cid:page` scope key. Summary, knowledge, subtitle re-probe, and child interactions compare their captured scope with the live scope before committing a result. This ownership must not be split between unrelated hooks.

The storage effect has two separate meanings that must stay explicit:

1. A primary-text selection change cancels dependent work and refetches the context so its evidence state is current.
2. A relevant AI config change cancels a generated summary when necessary, preserves a prior readable result only under the existing gate rules, and restores cache without silently generating.

Within `CurrentVideoAssistantStatus`, the Q&A session view and in-flight request map are separate from the summary request state in `App`. The `segmentQuery` state is currently shared by Q&A and the unmounted retrieval panel; an extraction may rename it internally only if its actual input value and reset behavior are preserved. The `timestampBusyRef` deliberately serializes all kinds of seeks and returns. Do not replace it with independent per-panel locks.

## Dependency and message boundaries

`popup/utils/messaging.ts` is the only popup-to-service-worker transport. It builds `BiliVizRequest`, checks `BiliVizResponse.success`, and exposes a typed `requestSW` result. Components and hooks introduced by the refactor should use that transport through a controller/action boundary; presentational leaves should receive data and callbacks only.

| Boundary | Existing actions or API | Extraction rule |
| --- | --- | --- |
| Popup -> service worker | `GET_QUICK_STATS`, `GET_SYNC_STATUS`, `SYNC_NOW`, `CANCEL_SYNC`, `PROBE_HISTORY_TAIL` | Keep history/sync state outside current-video controllers. Do not make leaf UI call `requestSW`. |
| Context/subtitle | `GET_CURRENT_VIDEO_CONTEXT`, `GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE` | The context controller owns re-probe ordering, exact identity comparison, and no-context fallback. |
| Summary/highlights | `GET_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE`, `GENERATE_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS`, `CANCEL_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS` | Preserve cache-read versus user-triggered generation distinction, retained prior-ready result, request ID, and cancellation params. |
| Knowledge | `GET_VIDEO_KNOWLEDGE` | Preserve primary-text authorization before dispatch and the no-evidence wording. |
| Q&A sessions | `GET_CURRENT_VIDEO_QA_SESSIONS`, `RENAME_CURRENT_VIDEO_QA_SESSION`, `DELETE_CURRENT_VIDEO_QA_SESSION` | Session list reads are local restoration, not AI requests. Keep active-session selection and delete/cancel serialization together. |
| Q&A execution | `ASK_CURRENT_VIDEO_FULL_TEXT`, `CANCEL_CURRENT_VIDEO_FULL_TEXT_QA` | Dispatch only from explicit submit/retry. Retain `(sessionId, requestId, turnId)` matching and the captured source snapshot. |
| Timestamp navigation | `REQUEST_CURRENT_VIDEO_HIGHLIGHT_JUMP`, `REQUEST_CURRENT_VIDEO_QA_CITATION_JUMP`, `REQUEST_CURRENT_VIDEO_SEGMENT_JUMP`, `RETURN_CURRENT_VIDEO_SEGMENT_JUMP` | Keep preview binding validation before a request with `confirmed: true`; only expose return after an accepted response supplies a return point. |
| Dormant retrieval | `SEARCH_CURRENT_VIDEO_SEGMENTS` | Keep its controller and panel code reachable only through its current non-mounted path until a separate product decision changes that fact. |
| Browser APIs | `chrome.storage.local`, `chrome.storage.onChanged`, `chrome.tabs.create`, `chrome.runtime.getURL` | Confine browser APIs to controllers/shell actions. Do not read browser profiles, cookies, login state, or key files. |

`src/shared/types/messages.ts` is the action-name contract and `src/background/messages/handlers.ts` is the runtime routing boundary. The refactor must not rename actions, relax parameter checks, move authorization to the popup, or change which route resolves the active/requesting tab. The shared types retain the evidence boundary: current context is identified by `bvid`/`cid`/`page`; summary cache bindings retain exact source and model; Q&A stores a source snapshot per turn; and citation bindings retain session/request/turn/citation identity.

## Proposed module boundaries

The target is a small composition root rather than a new generic state framework. Each proposed hook is local to the popup and may call existing shared helpers, but it does not redefine shared contracts.

```text
popup/App.tsx
  PopupShell
    usePopupHistorySync
    usePopupCurrentVideoController
      useCurrentVideoScope
      useCurrentVideoSummaryHighlights
      useCurrentVideoKnowledge
      CurrentVideoAssistant
        useCurrentVideoQaSessions
        useCurrentVideoTimestampOperations
        CurrentVideoSubtitleStatusPanel
        CurrentVideoSummaryHighlightsPanel
        CurrentVideoFullTextQaPanel
        VideoKnowledgePanel
```

| Boundary | Owns | Must not own |
| --- | --- | --- |
| `App` / `PopupShell` | Page layout and shell, history-sync, diagnostics, quick-stat states, and opening dashboard/login/settings pages | Current-video request counters, source authorization, Q&A mutation details, or timestamp validation. |
| `usePopupHistorySync` | Existing signals, sync polling, sync/cancel, history-tail diagnostic state | Current-video storage changes or any AI action. |
| `useCurrentVideoScope` | Pure context key/equality helpers and a scope snapshot containing context key, selection revision, operation revision, and per-action request ID comparison | Dispatching a message or committing UI results itself. |
| `usePopupCurrentVideoController` | One storage listener; context refresh; selection/config invalidation; subtitle re-probe; summary cache/generate/cancel; knowledge refresh; public action scope | Q&A session list rendering or duplicated timestamp locks. It is the single bridge between popup lifecycle and child interactions. |
| `useCurrentVideoSummaryHighlights` | Summary request ref, active request details, previous-ready retention, and summary-specific cancel/restore behavior | Config storage subscription or child visual state such as selected highlight preview. |
| `useCurrentVideoKnowledge` | Knowledge result/loading and its authorized refresh action | Summary cache or Q&A state. |
| `CurrentVideoAssistant` | Assistant layout and child interaction controller; accepts already-authorized actions and scope snapshot | Popup sync and direct storage subscriptions. |
| `useCurrentVideoQaSessions` | Session load/select/new/rename/delete, per-session in-flight map, submitted source snapshot, retry/cancel, and per-session error | Shared seek delivery or a source-independent retry. |
| `useCurrentVideoTimestampOperations` | One shared busy ref; highlight/Q&A/retrieval preview, confirmation, return state, and captured scope checks | Generating answers or silently selecting a source. |
| Presentation components | Existing natural Chinese copy, visible states, and event callbacks | `chrome.*`, `requestSW`, source re-authorization, or mutation of cross-panel refs. |

The dormant `CurrentVideoSegmentRetrievalPanel` may be moved with its presentation helpers only after the ownership decision is recorded. Its unmounted status is part of the behavior baseline for this plan; no proposed controller should mount it opportunistically.

## Staged extraction sequence

Each stage is independently mergeable and leaves message actions, shared types, storage keys, and persisted record schemas unchanged.

1. **Characterize before moving behavior.** Add or refine focused popup-controller tests only where existing coverage does not observe the seam. Capture component/export shape, source references, and exact visible labels in the implementation issue. No runtime extraction yet.
2. **Extract pure scope and visible-copy helpers.** Move context key/equality, summary gate, binding equality, source-current comparison, and visible-copy helpers to popup-local modules. Keep signatures and output identical; unit-test stale identity, answer-before-citations support values, and raw-field redaction before changing a hook.
3. **Separate non-current-video popup shell.** Extract stat/sync/tail-diagnostic presentation leaves with props only, then `usePopupHistorySync` if it reduces the remaining `App` ownership. Keep signals as the source of truth and retain the 1.5 second timer cleanup exactly once.
4. **Move one current-video lifecycle owner.** Introduce `usePopupCurrentVideoController` around the existing `App` state and functions, without changing `CurrentVideoAssistantStatus` inputs. The hook remains sole owner of the storage listener, invalidation revisions, context request sequence, subtitle re-probe sequence, and settings action.
5. **Split summary/highlights and knowledge from the lifecycle owner.** Move summary cache/generate/cancel and knowledge refresh behind narrow actions; retain prior-ready summary behavior and only restore local cache after invalidation. Move existing presentational summary/knowledge functions with unchanged props before reducing their prop shape.
6. **Split Q&A sessions from timestamp navigation.** Move session mutation and request lifecycle first, then move the shared timestamp-preview/confirm/return state as one controller. Preserve the single busy lock and every scope check. Do not turn a preview click into a seek.
7. **Reduce the composition root and assess dormant retrieval.** Once all previous slices are green, leave `App` as composition plus shell state and decide in a distinct issue whether the unmounted retrieval implementation is retained, relocated, or productized. It is not a cleanup item for stages 1-6.

## Focused QA and test mapping

| Behavior seam | Existing evidence | Required implementation-slice check |
| --- | --- | --- |
| Popup source selection, summary states, cache restore, stale completions, knowledge, Q&A, timestamp races, and responsive rendering | `tests/current-video-popup.mock-qa.py` | Run this popup mock QA after stages 4-6. Add a case only when a newly extracted boundary lacks an existing race or copy assertion. |
| Summary all-or-nothing evidence, exact cache identity/model, cancellation, previous result retention, and highlight preview binding | `tests/current-video-summary-highlights.test.ts` | Run after stage 5; preserve cache-read/no-auto-generate behavior and no-primary-text persistence. |
| Exact source authorization and identity/version changes | `tests/current-video-primary-text-authorization.test.ts`, `tests/current-video-primary-text.test.ts`, `tests/current-video-transcript-cache.test.ts` | Run after stages 2 and 4; stale or ambiguous sources must fail closed. |
| Q&A session lifetime, retry ordering, delete/clear races, rolling context, and cross-video refusal | `tests/current-video-qa-sessions.test.ts` | Run after stage 6; a late completion must not resurrect/overwrite a session or cross sources. |
| Answer evidence and payload separation | `tests/current-video-qa.test.ts`, `tests/current-video-summary-highlights.test.ts` | Assert answer before citations in popup UI and preserve payload allowlists/explicit requests. |
| Popup/background source, config, owner-tab, and request lifecycle boundary | `tests/current-video-message-handlers.test.ts` | Run after each controller stage; no action/params or request-tab behavior changes. |
| Re-probe copy and no-internal-field diagnosis | `tests/current-video-subtitle-diagnostics.test.ts` | Run after stage 4; retain actionable Chinese states and truthful unavailable/no-text results. |
| Confirmed jump, return point, source mismatch, lease, and stale return | `tests/current-video-timestamp-jump.test.ts`, `tests/current-video-timestamp-operation-lease.test.ts` | Run after stage 6; confirmation remains mandatory and return never crosses source/video boundaries. |
| Page-assistant four-tab and source-isolation contract shared with popup | `tests/current-video-primary-text.mock-qa.py`, `tests/current-video-qa-sessions.mock-qa.py` | Run as cross-surface regression evidence when shared contracts are touched, while keeping their page-assistant scope distinct from popup UI. |

For every implementation slice, run `git diff --check`, `npm run typecheck`, and the rows above that exercise the changed seam. Any UI-move slice should run the popup mock QA at desktop and mobile sizes. A test that only checks shared contracts is not a substitute for the popup mock flow, because the latter catches rendered Chinese copy, no-overflow, and click ordering.

## Rollback points

| After stage | Rollback boundary | Why it is safe |
| --- | --- | --- |
| 2 | Revert popup-local pure-helper moves | No message, storage, or render ownership has changed. |
| 3 | Revert shell presentation/hook commit | Current-video code remains untouched; signals and service-worker actions are unchanged. |
| 4 | Revert only the lifecycle-controller commit | The original `CurrentVideoAssistantStatus` prop contract remains available, so context/invalidation ownership returns to `App` in one change. |
| 5 | Revert summary/knowledge controller commit | Summary cache schema and service-worker actions are unchanged; previous-ready retention stays in the prior controller. |
| 6 | Revert Q&A/timestamp controller commit | Session persistence, request IDs, and player jump routes are unchanged; one commit restores the previous shared busy lock. |
| 7 | Do not bundle dormant-retrieval decisions with cleanup | Retention/removal/visibility is product behavior, not a mechanical rollback target. |

No stage needs a new feature flag, storage migration, or message version. If a stage requires one, it is not a pure decomposition and should be stopped for a separate design review.

## Risks and bad cases

| Bad case | Existing protection to preserve | Extraction-specific guard |
| --- | --- | --- |
| User switches browser tab, video, or part while a request is in flight | Context key plus operation/selection revisions reject late work | Pass an immutable scope snapshot into every async controller action; never read a new context to salvage an old response. |
| Subtitle source text or timeline changes | Exact `sourceIdentityKey` and selected primary source must match active evidence | Keep source authorization in one function and recheck before dispatch/seek; do not pass only `bvid` or `cid`. |
| AI setting changes while summary is generating | Config invalidation cancels and preserves only the allowed prior result | Keep the storage listener and active-summary cancellation in the lifecycle owner, not in a visual panel. |
| Summary refresh fails, is invalid, or is cancelled | Prior ready result remains visible; terminal state is honest | Preserve `previousReady` and request-ID matching; never replace a good summary with an empty placeholder. |
| Q&A retry/delete/clear races | Per-session request map and persisted source snapshot prevent late writes | Keep `(sessionId, requestId, turnId)` together and reload the active session only after matching completion. |
| Citation/highlight becomes stale after preview | Binding comparison rejects confirmation | Preview state contains full binding, not just an array index or timestamp. |
| Two panels try to seek at once | One shared timestamp busy ref serializes operations | Keep a single timestamp controller for all present and dormant routes. |
| No context, no text, stale text, or unavailable subtitle | Authorization and diagnostics fail closed with user-actionable Chinese copy | Do not add a metadata/description fallback that looks like a full-video answer. |
| Child displays service-worker/internal data directly | Visible-text sanitizer and status mapping hide raw fields | Apply the same presentation helpers in moved leaves; do not expose `sourceHash`, `segmentId`, `CID`, or transport errors. |
| Mechanical move changes hidden product behavior | Retrieval panel is currently unmounted | Treat visibility/order of current-video surfaces as characterization-test assertions before moving code. |

## Proposed implementation issue slices

These are follow-up implementation issues, not work in #215.

1. **refactor(popup): characterize and extract pure current-video scope helpers**
   - Scope: popup-local identity, binding, authorization-display, and copy helpers with targeted unit tests.
   - Excludes: hook/component moves, message changes, storage changes.

2. **refactor(popup): isolate shell sync and history-tail presentation**
   - Scope: header, sync controls/progress, tail diagnostic, empty/error/stat leaves, and optionally `usePopupHistorySync`.
   - Excludes: current-video lifecycle and AI routes.

3. **refactor(popup): introduce one current-video lifecycle controller**
   - Scope: context fetch, storage invalidation, subtitle re-probe, scope revisions, summary/knowledge action surface, and existing assistant props.
   - Gate: popup mock QA plus handler/primary-text contract tests.

4. **refactor(popup): extract summary-highlights and knowledge controller/panels**
   - Scope: summary cache/generate/cancel, prior-result retention, knowledge refresh, and existing display leaves.
   - Gate: exact-source/model cache, cancellation, preview-replacement, and natural failure-copy checks.

5. **refactor(popup): extract current-video Q&A session controller**
   - Scope: session CRUD, explicit submit/retry/cancel, request/turn matching, source snapshots, answer-before-citations rendering.
   - Gate: session race and cross-source/cross-video refusal coverage.

6. **refactor(popup): centralize current-video timestamp preview-confirm-return**
   - Scope: one shared busy controller for highlight and Q&A citation flows; move dormant retrieval helpers without mounting them.
   - Gate: confirmation, return, stale binding, double-click, and lease tests.

7. **decision(current-video): resolve the unmounted popup retrieval panel**
   - Scope: product decision and a separate implementation plan for retain, delete, or expose behavior.
   - Gate: explicit UX acceptance; it must not piggyback on any refactor PR.

## Source references used by this proposal

- `popup/App.tsx:171`
- `popup/App.tsx:201`
- `popup/App.tsx:256`
- `popup/App.tsx:969`
- `popup/App.tsx:1590`
- `popup/App.tsx:1811`
- `popup/App.tsx:2099`
- `popup/App.tsx:2817`
- `popup/App.tsx:3153`
- `popup/App.tsx:3236`
- `popup/utils/messaging.ts:1`
- `src/shared/types/messages.ts:58`
- `src/shared/types/current-video-context.ts:75`
- `src/shared/types/current-video-summary.ts:115`
- `src/shared/types/current-video-full-text-qa.ts:68`
- `src/shared/types/current-video-qa-session.ts:28`
- `src/shared/current-video-primary-text-selection.ts:108`
- `src/background/messages/handlers.ts:672`
- `tests/current-video-popup.mock-qa.py:48`
- `tests/current-video-message-handlers.test.ts:127`
