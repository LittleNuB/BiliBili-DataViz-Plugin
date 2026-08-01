# Background Message Handler Decomposition Plan

**Status:** proposal for [#216](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/216), not an implementation plan patch.

## Scope and baseline

This document decomposes only [`src/background/messages/handlers.ts`](../../src/background/messages/handlers.ts), inspected at `f655d8b` (3,122 lines). It does not change the runtime protocol, product behavior, storage schema, manifest permissions, network behavior, or UI copy.

The current module owns four concerns at once:

1. Chrome runtime registration and tab lifecycle cleanup.
2. Dispatch, Dynamic Bill migration/operation gates, request validation, and error envelopes.
3. Domain orchestration for analytics, history, settings/privacy, favorites, Dynamic Bill, and current-video actions.
4. Current-video authorization, source/version/session guards, and timestamp-operation delivery.

The published protocol is [`RequestAction` (71 actions)](../../src/shared/types/messages.ts#L59-L130), [`ContentAction` (4 actions)](../../src/shared/types/messages.ts#L133-L137), `BiliVizRequest`, `BiliVizContentMessage`, and `BiliVizResponse`. No extraction may add an action, rename an action, loosen `params`, or alter a response shape in this issue family.

### Non-goals

- No runtime refactor is part of #216.
- Do not move business policy into a generic dispatcher, especially Dynamic Bill eligibility, current-video evidence rules, or AI payload contracts.
- Do not create a broad data-access layer over the existing storage/API modules.
- Do not add account data collection, relationship mutations, background uploads, or any access to Cookie, browser-profile, login-state, or local key files.

## Current registration and dispatcher contract

[`setupMessageHandlers`](../../src/background/messages/handlers.ts#L328-L366) is the only public registration entry point today. The decomposition must retain this observable contract:

| Contract | Required preserved behavior |
| --- | --- |
| Runtime listener | Register one `chrome.runtime.onMessage` listener. Recognized content and UI requests return `true` so their asynchronous response channel remains open. A message without an action returns `false`. |
| Content admission | Only `PLAYER_HEARTBEAT`, `PLAYER_ACTION`, `PAGE_NAVIGATION`, and `CURRENT_VIDEO_CONTEXT_UPDATE` are routed as content messages. Their success acknowledgement is `{ success: true }`; thrown failures become `{ success: false, error }`. |
| UI admission | A `BiliVizRequest` with an action enters `handleRequest(request, sender.tab?.id ?? null)`. `sender.tab.id` is part of the security/correctness boundary, not incidental metadata. |
| Error envelope | Top-level dispatch preserves `BiliVizResponse`: expected domain failures may be typed data states, validation/concurrency failures may throw stable error codes, and unknown actions return `{ success: false, error: "Unknown action: ..." }`. The top-level listener converts uncaught errors with `errorMessage`. |
| Dynamic Bill gates | The three action sets at [`handlers.ts` lines 237-279](../../src/background/messages/handlers.ts#L237-L279) remain centralized before any domain handler runs: data-operation serialization plus 0.13 migration; self-gated sync/generate; and migration-only actions. An action must not silently move between these sets. |
| Tab lifecycle | Both `tabs.onRemoved` and URL-bearing `tabs.onUpdated` clear the in-memory current-video context, temporary transcript ownership, and timestamp leases for that tab. |
| Public export | `setupMessageHandlers` remains the background bootstrap import. `handleRequest` remains exportable while direct unit tests or development tooling need it; a direct call must work before setup and must not register Chrome listeners. It becomes a delegating facade over the same production dispatcher used by the Chrome listeners, not a second dispatcher. |

### Stable proposed registration seam

The first implementation slice should introduce an internal, injected dispatcher without changing the public listener. The following is a target shape, not a request to add these types in #216:

```ts
type RequestHandler = (request: BiliVizRequest, context: RequestContext) => Promise<BiliVizResponse>;
type ContentHandler = (message: BiliVizContentMessage, context: ContentContext) => Promise<void>;

interface RequestContext {
  requestTabId: number | null;
}

interface ContentContext {
  senderTabId: number;
  senderTabUrl: string | null;
}

interface MessageDispatcher {
  dispatchRequest<T>(request: BiliVizRequest, context: RequestContext): Promise<BiliVizResponse<T>>;
  dispatchContent(message: BiliVizContentMessage, context: ContentContext): Promise<void>;
  onTabRemoved(tabId: number): void;
  onTabUrlChanged(tabId: number): void;
}

interface ChromeMessageRegistration {
  register(): void;
}
```

`handlers.ts` should remain a thin host adapter and own no domain switch. The dispatcher should route each action exactly once through an explicit action-to-family registry. It must reject duplicate action ownership during construction and retain exhaustive TypeScript coverage over `RequestAction` and `ContentAction`. There must be no fallback that dispatches both old and new handlers, because duplicate execution would duplicate sync, writes, network calls, or tabs.

#### Executable production construction contract

Use one module-level lazy dispatcher and a separately cached Chrome registration adapter. Dispatcher construction and listener registration are deliberately independent state transitions:

```ts
let productionDispatcher: MessageDispatcher | null = null;
let productionRegistration: ChromeMessageRegistration | null = null;

function getDispatcher(): MessageDispatcher {
  productionDispatcher ??= createMessageDispatcher(createProductionMessageDependencies());
  return productionDispatcher;
}

function getChromeRegistration(): ChromeMessageRegistration {
  productionRegistration ??= createChromeMessageRegistration(chrome, getDispatcher());
  return productionRegistration;
}

export function setupMessageHandlers(): void {
  getChromeRegistration().register();
}

export function handleRequest<T>(
  request: BiliVizRequest,
  requestTabId: number | null = null,
): Promise<BiliVizResponse<T>> {
  return getDispatcher().dispatchRequest<T>(request, { requestTabId });
}
```

`createMessageDispatcher(dependencies)` belongs in proposed `messages/dispatcher.ts`. `createChromeMessageRegistration(chromeApi, dispatcher)` belongs in proposed `messages/chrome-registration.ts`; it creates stable runtime/tab callback identities, closes over the supplied dispatcher, and owns a private `registered` flag. Its `register()` is idempotent: after the first successful registration, later calls add no runtime, tab-removal, or tab-update listeners. Constructing or directly using the dispatcher never changes that flag and never touches Chrome listener state.

The two call orders therefore have one result:

| Call order | Required outcome |
| --- | --- |
| `handleRequest` before `setupMessageHandlers` | Lazily create one production dispatcher, dispatch directly, and register zero Chrome listeners. Later setup creates the registration adapter around that same dispatcher. |
| `setupMessageHandlers` before direct `handleRequest` | Lazily create the dispatcher and registration adapter, register each listener once, and make the later direct call use the already-created dispatcher. |
| Repeated `setupMessageHandlers` | Reuse the registration adapter; each Chrome event still has exactly one installed listener. Dispatcher identity and domain state are unchanged. |
| Mixed direct and runtime requests | Both enter the same `dispatchRequest` method and therefore share action ownership, Dynamic Bill gates, in-memory current-video state, cancellation registries, and all other dispatcher-owned coordination. |

Do not add a production singleton reset export. Isolated dispatcher tests should call `createMessageDispatcher` with fakes; registration tests should call `createChromeMessageRegistration` with a fake Chrome facade. The existing bundled handler test may exercise the exported production facades in one fresh bundle, but it must not create or inject a second production dispatcher.

#### Dispatcher-shell migration and rollback boundary

The shell implementation should be one independently revertible commit and follow this order:

1. Add `dispatch-contract.ts`, `dispatcher.ts`, and `chrome-registration.ts`, initially wrapping the existing `handleRequestExclusive`, content switch, and tab cleanup without moving any domain branch.
2. Add the lazy `getDispatcher()` and make exported `handleRequest` delegate to it. Characterize direct-before-setup behavior before changing Chrome registration.
3. Add `getChromeRegistration()` and make `setupMessageHandlers` call its idempotent `register()`. The runtime listener must call its captured dispatcher directly; it must not construct another dispatcher or bounce through a facade backed by different state.
4. Add shared-instance and single-registration tests, then remove the old inline listener registration only after those tests pass.

Keep the existing switch and helpers available behind the initial dispatcher adapter until direct and runtime parity is proven. Do not split the singleton/facade rewrite from the registration rewrite across mergeable PRs: an intermediate state could construct two dispatchers. If construction identity, direct-call behavior, or listener counts differ, revert the entire dispatcher-shell commit; no domain extraction should have started, and the current inline `setupMessageHandlers` plus `handleRequest` path remains the rollback target.

## Complete handler-family inventory

The table is exhaustive for the current action unions. "Effects" lists direct observable effects of the orchestration path; delegated services may have additional internal reads and writes.

| Family and actions | Current dependencies and effects | Proposed extraction target |
| --- | --- | --- |
| **Analytics read**: `GET_QUICK_STATS`, `GET_DASHBOARD_DATA`, `GET_PREFERENCE_DATA`, `GET_CREATOR_DATA`, `GET_BEHAVIOR_DATA`, `GET_EXPERIMENT_DATA`, `GET_DEVICE_DATA` | [`analytics/engine`](../../src/background/analytics/engine.ts) and `analytics/device`; read local aggregates/history and return view models. | `messages/analytics-handlers.ts` |
| **History sync, export, and status**: `SYNC_NOW`, `CANCEL_SYNC`, `EXPORT_DATA`, `EXPORT_DATA_PAGE`, `GET_SYNC_STATUS`, `PROBE_HISTORY_TAIL` | `storage/db`, `storage/config-store`, `sync/initial-backfill`, `sync/history-tail-probe`, and `sync/sync-control`; reads/writes history and config; starts an intentionally detached backfill; cancels active work; uses the Bilibili history/video API indirectly through the sync modules. | `messages/history-handlers.ts` |
| **Config and local-data privacy**: `GET_CONFIG`, `GET_CONFIG_SNAPSHOT`, `UPDATE_CONFIG`, `TEST_AI_CONNECTION`, `GET_LOCAL_DATA_PRIVACY_SUMMARY`, `CLEAR_CURRENT_VIDEO_SUBTITLE_CACHE`, `CLEAR_CURRENT_VIDEO_SUMMARY_HIGHLIGHT_CACHE`, `CLEAR_LOCAL_DATA_CATEGORY`, `REBUILD_SMART_FAVORITE_INDEX`, `CLEAR_ALL_LOCAL_DATA` | `storage/config-store`, `storage/local-data-privacy-repo`, selection/clear coordinators, summary/QA invalidators, `favorites/smart`, and `ai/openai-compatible`; serializes compare-and-save configuration, may abort in-flight AI work, clears scoped local categories with readback, and performs an explicit configured-provider health check. | `messages/settings-privacy-handlers.ts` |
| **Current-video context and evidence setup**: `GET_CURRENT_VIDEO_CONTEXT`, `SAVE_CURRENT_VIDEO_PRIMARY_TEXT_SELECTION`, `PROBE_CURRENT_VIDEO_SUBTITLE_SOURCE`, `GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE`, `GET_CURRENT_VIDEO_SUBTITLE_VIEW_SOURCES` | `current-video-context-resolver`, primary-text selection storage, subtitle probe/cache, transcript repository and temporary owner cache; reads `chrome.windows/tabs`, sends `COLLECT_CURRENT_VIDEO_CONTEXT`, reads/writes selected-source and transcript evidence records, and may fetch current subtitle data through the extension API client. | `messages/current-video-context-handlers.ts` plus a shared `messages/current-video-context-runtime.ts` |
| **Current-video evidence products and assistant sessions**: `GET_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE`, `GENERATE_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS`, `CANCEL_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS`, `GET_CURRENT_VIDEO_QA_SESSIONS`, `RENAME_CURRENT_VIDEO_QA_SESSION`, `DELETE_CURRENT_VIDEO_QA_SESSION`, `CLEAR_CURRENT_VIDEO_QA_SESSIONS`, `ASK_CURRENT_VIDEO_FULL_TEXT`, `CANCEL_CURRENT_VIDEO_FULL_TEXT_QA`, `GET_VIDEO_KNOWLEDGE`, `SEARCH_CURRENT_VIDEO_SEGMENTS`, `GET_CURRENT_VIDEO_RELATED_FAVORITES` | summary/highlight and full-text-QA services, QA-session repository, transcript/summary cache, segment retrieval/rerank, video knowledge, Smart Favorites QA, and the current-video authorization runtime; may read selected source text, persist bounded sessions/caches, start or cancel AI requests, and return honest unavailable/cancelled/no-evidence states. | `messages/current-video-assistant-handlers.ts`, with authorization helpers left in `current-video-context-runtime.ts` |
| **Current-video preview, confirm, return, and lease consumption**: `REQUEST_CURRENT_VIDEO_SEGMENT_JUMP`, `REQUEST_CURRENT_VIDEO_HIGHLIGHT_JUMP`, `REQUEST_CURRENT_VIDEO_QA_CITATION_JUMP`, `REQUEST_CURRENT_VIDEO_SUBTITLE_JUMP`, `RETURN_CURRENT_VIDEO_SEGMENT_JUMP`, `RETURN_CURRENT_VIDEO_SUBTITLE_JUMP`, `CONSUME_CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE` | exact-source transcript/summary/QA repositories, current-video authorization runtime, and `current-video-timestamp-operation-lease`; re-resolves context, verifies preview bindings, issues a one-time lease, sends a message to the content script, and always retires the lease. | `messages/current-video-timestamp-handlers.ts` |
| **Smart Favorites**: `GET_SMART_FAVORITES`, `GET_SMART_FAVORITES_BY_PATH`, `SYNC_FAVORITES`, `PROBE_FAVORITE_FOLDER_GAP`, `BUILD_SMART_FAVORITE_INDEX`, `SEARCH_SMART_FAVORITES`, `ASK_SMART_FAVORITES` | `favorites/sync`, `favorites/folder-gap-probe`, `favorites/smart`, and `favorites/qa`; reads/writes local favorite/index data, may use Bilibili favorites/video API indirectly, and may make an audited AI synthesis request only from local cited results. | `messages/favorites-handlers.ts` |
| **Dynamic Bill**: `GET_DYNAMIC_BILL_OVERVIEW`, `SYNC_DYNAMIC_UPDATES`, `GENERATE_DYNAMIC_BILL`, `BUILD_DYNAMIC_BILL_EXPLANATIONS`, `GET_DYNAMIC_BILL_ITEMS`, `GET_DYNAMIC_BILL_FILTER`, `UPDATE_DYNAMIC_BILL_FILTER`, `ADD_DYNAMIC_BILL_FEEDBACK`, `GET_DYNAMIC_BILL_FEEDBACK_STATE`, `APPLY_DYNAMIC_BILL_CREATOR_LESS_REMINDER`, `UNDO_DYNAMIC_BILL_CREATOR_LESS_REMINDER`, `DISMISS_DYNAMIC_BILL_CREATOR_REVIEW_PROMPT`, `OPEN_DYNAMIC_BILL_CREATOR_REVIEW_PROMPT`, `GET_DYNAMIC_BILL_ACTIVE_PAUSES`, `RESTORE_DYNAMIC_BILL_CREATOR_REMINDER`, `OPEN_DYNAMIC_BILL_VIDEO`, `MARK_DYNAMIC_BILL_ITEM_PROCESSED` | `dynamic-bill` sync/generator/migration/operation-control/AI services and `storage/dynamic-bill-repo`; migration/operation gates protect DB reads and writes; may use followed-creator/dynamic/video APIs indirectly; two actions intentionally create a Bilibili tab after local state transition. | `messages/dynamic-bill-handlers.ts` |
| **Content and lifecycle**: `CURRENT_VIDEO_CONTEXT_UPDATE`, `PLAYER_HEARTBEAT`, `PLAYER_ACTION`, `PAGE_NAVIGATION`; `tabs.onRemoved`; URL-bearing `tabs.onUpdated` | in-memory context/probe maps, temporary transcript owner cache, timestamp lease cache, `storage/db.playerEvents`, history operation control, and Dynamic Bill consumption marking. Context updates are accepted only after URL BVID/page validation; player events write local telemetry and may mark a matching local bill consumed. | `messages/content-event-handlers.ts` and shared `current-video-context-runtime.ts` |

### API and storage boundaries to retain

The dispatcher currently calls domain services rather than raw API modules. Keep that direction after extraction:

| Boundary | Existing modules | Extraction rule |
| --- | --- | --- |
| Bilibili history/favorites/dynamic/video requests | [`sync/initial-backfill`](../../src/background/sync/initial-backfill.ts), `favorites/sync`, `favorites/folder-gap-probe`, [`dynamic-bill/sync`](../../src/background/dynamic-bill/sync.ts), then `background/api/*` | Domain handlers call the existing service entry point only. They must not import `api/client`, create new bulk requests, or pass account-wide local records into a request. |
| Subtitle probe and current-video transcript cache | [`current-video-subtitle-probe`](../../src/background/current-video-subtitle-probe.ts), [`current-video-transcript-cache`](../../src/background/current-video-transcript-cache.ts), transcript repo, temporary-owner cache | Keep exact `bvid`/`cid`/page/language/source identity and clear-generation controls. Runtime session access remains inside extension fetches; no filesystem profile, Cookie, or login-state access is introduced. |
| AI transport | [`ai/openai-compatible`](../../src/background/ai/openai-compatible.ts), summary/full-text/rerank/favorites/Dynamic Bill services | Handlers pass only the current service inputs. Payload construction and auditing stay in shared/domain services, immediately before network use. Do not assemble an AI payload in a dispatcher. |
| Configuration and local-data lifecycle | [`storage/config-store`](../../src/background/storage/config-store.ts), [`storage/local-data-privacy-repo`](../../src/background/storage/local-data-privacy-repo.ts), selection and clear epochs | Preserve optimistic config revision matching, clear coordinators, invalidation callbacks, and post-clear readback. Never bypass repositories with raw Dexie writes. |
| Current-video session/state | [`storage/current-video-qa-session-repo`](../../src/background/storage/current-video-qa-session-repo.ts), transcript repo, summary cache repo, timestamp lease registry | Preserve source-scoped cancellation, bounded session persistence, cache identity binding, and one-time lease consumption. |

## Invariants that extraction must make explicit

### Payload allowlists and privacy

[`assistant-payload-audit.ts`](../../src/shared/assistant-payload-audit.ts) supplies the allowlist contracts for current-video summaries/highlights, full-text QA, Smart Favorites QA, segment rerank, and legacy current-video QA. Its sensitive-field and sensitive-string checks reject account-wide history/favorites/following/feedback, cookies, browser-profile and login-state values, local key paths, user profile identifiers, and unapproved fields.

The extraction must preserve all of the following:

- `assertAssistantPayloadAudit` stays adjacent to the actual payload builder/network path; a handler may choose a domain intent but may not append fields.
- Current-video full text is permitted only under its existing explicit, user-triggered authorization. A source identity is required before reading the transcript body; enabling settings, restoring a session, opening a page, or switching videos does not send AI traffic.
- Smart Favorites AI remains a synthesis over already supplied cited local results. Dynamic Bill AI remains explanatory, not an eligibility/order/status/feedback decision maker.
- No handler sends a full local database, full watch history, full favorites, full following, feedback ledger, notes, credentials, or account state. No handler writes to Bilibili relationships or content.
- Provider errors and validation errors remain sanitized domain results where the existing service does so; no raw provider, internal identity, `sourceHash`, segment ID, subtitle URL, or configuration secret becomes user-visible copy.

### Active-tab and current-video revalidation

The proposed shared `current-video-context-runtime.ts` is a *correctness boundary*, not a convenience helper. It must retain the behavior now spread across [`handlers.ts` lines 444-478](../../src/background/messages/handlers.ts#L444-L478), lines 2205-2336, and lines 2450-2677:

- Prefer the sender/request tab when supplied. Only a request without a tab may use the existing active/recent tab selection behavior.
- Accept a pushed context only when its BVID and page match both its own URL and the sender URL. A late page-1 context may not overwrite page 2, including same-BVID transitions.
- Resolve a fresh context from the target tab when its stored context is stale or URL-mismatched. A non-video URL or missing context returns the existing no-context state, rather than a fabricated result.
- Treat BVID, CID, page, source identity key, and source hash as a compound evidence binding. CID/page checks are required before transcript read, cached highlight/citation lookup, jump, return, or subtitle-line delivery.
- Retain temporary transcript ownership per tab/navigation snapshot. Clear the context, owner cache, and leases when the tab is removed or its URL changes.

### Source, version, configuration, and session isolation

The existing primary-text guard couples `bvid`, `cid`, `page`, `sourceIdentityKey`, selection generation, and transcript-clear generation. Any moved handler must call the same guard before and after sensitive work:

1. Refuse transcript-body access until `primaryTextSelectionsReady` is explicitly true and persisted selection storage is readable.
2. Require the request's selected source identity to equal the saved, currently available source for the exact video part.
3. Recheck selection and transcript-clear generations before evidence bind, before/after segment-body read, before session write/network, and before timestamp delivery.
4. Cancel or return an honest unavailable/no-text/no-evidence state if source, clear generation, config generation, or request identity changes.
5. Keep full-text QA preflight, session write guards, request IDs, session IDs, turn IDs, and persisted citation bindings source-scoped. A completion from an older request must not recreate, overwrite, or cross-contaminate a session.

### Honest failure and preview/confirm/return

The current-video handlers deliberately return typed states rather than inventing a fallback answer. Preserve `no_context`, `no_evidence`, `metadata_only`, `low_confidence`, `stale_context`, `disabled`, `not_configured`, `failed`, `rejected`, and `cancelled` behavior as owned by the existing domain result types.

Jump-like actions must retain the current sequence:

1. A local result exposes a preview and is inert until `confirmed === true`.
2. The background re-resolves the target tab and exact current evidence/citation/highlight/subtitle binding.
3. The background issues a short-lived, tab-bound, operation-kind-bound lease and sends the confirmed target to the content script.
4. The content script consumes the lease exactly once. It may seek or return only after the lease revalidates BVID, CID, page, source identity, and relevant selection/clear generation.
5. Delivery failure, stale evidence, missing confirmation, unavailable player, or a cleared cache returns the existing blocked result. The lease is retired in `finally`.

## Staged extraction sequence

Every stage keeps the runtime listener and public request types unchanged. Add or retain characterization tests before moving a family, move an action through a single registry entry, run its focused regression suite, then commit the slice. Do not combine a business behavior change with an extraction.

| Stage | Work and target modules | Entry/exit checks and rollback point |
| --- | --- | --- |
| 0. Characterize the boundary | Record action ownership, top-level envelope behavior, Dynamic Bill gate membership, direct `handleRequest` before setup, and tab cleanup in `tests/current-video-message-handlers.test.ts` plus focused dynamic tests. | Exit only when each action union member has one documented owner and direct dispatch is proven not to register Chrome listeners. Roll back by reverting test-only scaffolding if it exposes an incorrect existing assumption. |
| 1. Introduce the dispatcher shell | Create proposed `messages/dispatcher.ts`, `messages/dispatch-contract.ts`, and `messages/chrome-registration.ts`; add module-level lazy `getDispatcher()` and separately lazy/idempotent `getChromeRegistration()` in `handlers.ts`. Move no domain behavior initially. | Assert direct-before-setup and setup-before-direct share one dispatcher; two setup calls install one listener per Chrome event; runtime async retention, unknown-action response, and duplicate action-owner rejection remain unchanged. Roll back the complete shell commit before any domain extraction. |
| 2. Extract low-coupling local reads | Move analytics and simple local/history status/export branches to proposed `analytics-handlers.ts` and `history-handlers.ts`. Keep `SYNC_NOW`/`CANCEL_SYNC` together with their operation controls. | Compare response data and error codes; verify sync-start remains detached and cancellation stays effective. Roll back this commit only, restoring the switch branches. |
| 3. Extract settings/privacy lifecycle | Move config, AI-health, privacy summary, scoped clears, and index rebuild to proposed `settings-privacy-handlers.ts`. Keep invalidation callbacks and clear coordinators injected from their established modules. | Run config race, clear-readback, cache invalidation, and no-secret-payload tests. Roll back as one lifecycle slice if a clear/write race regresses. |
| 4. Extract favorites | Move all seven Favorites actions to proposed `favorites-handlers.ts`, retaining the service-level API and QA boundary. | Run favorite sync audit, Smart Favorites QA/payload tests, and related-favorites isolation checks. Roll back without touching the dispatcher shell. |
| 5. Extract Dynamic Bill | Move all seventeen actions to proposed `dynamic-bill-handlers.ts` as one gated family. The outer dispatcher remains the sole owner of the three gate sets. | Run migration, feedback-state, clear-operation, and tab-open characterization tests. Roll back the family as a unit; never temporarily bypass migration/operation gates. |
| 6. Extract current-video context/evidence | Create proposed `current-video-context-runtime.ts`, `content-event-handlers.ts`, and `current-video-context-handlers.ts`. Move maps, fresh context resolution, subtitle probing/viewing, selection authorization, transcript evidence, and lifecycle cleanup together. | Run same-BVID page change, late context, request-tab, temporary-owner, selection/clear generation, and subtitle source tests. Roll back this slice if any exact BVID/CID/page/source guard differs. |
| 7. Extract current-video assistant sessions | Move summary/highlights, full-text QA/session operations, knowledge, segment search/rerank, and related favorites to proposed `current-video-assistant-handlers.ts`; consume, do not rewrite, the shared context runtime. | Run payload audits, source-change cancellation, cache/session race, no-text, provider failure, and citation persistence tests. Roll back as one family to preserve source/session isolation. |
| 8. Extract timestamp operations and retire the switch | Move the seven jump/return/lease actions to proposed `current-video-timestamp-handlers.ts`; then remove only dead private helpers from `handlers.ts`. | Run preview/confirm/return, stale binding, player unavailable, one-time lease, and tab cleanup tests. Roll back by reverting this slice before attempting any cleanup follow-up. |

## Focused regression mapping

The following tests are the minimum mapping for an implementation PR. They are intentionally focused; the full typecheck/build and the complete test suite remain final gates.

| Behavior under extraction | Primary focused tests | Assertions that must not change |
| --- | --- | --- |
| Dispatcher construction and registration | Add focused cases to [`tests/current-video-message-handlers.test.ts`](../../tests/current-video-message-handlers.test.ts), using one fresh bundled module and fake Chrome listener counters. | Direct `handleRequest` before setup creates no listeners; setup reuses that dispatcher; setup twice leaves exactly one runtime/removed/updated listener; a direct request and a runtime request hit the same dispatcher spy/state. |
| Request-tab selection, context update admission, selection readiness, summary/QA cancellation, clear/config races, and timestamp delivery | [`tests/current-video-message-handlers.test.ts`](../../tests/current-video-message-handlers.test.ts) | Sender-tab BVID/page rejection, CID/page revalidation, no transcript body before exact selection, late-write suppression, source-change cancellation, and fail-closed lease authorization. |
| Primary-text selection and clear epochs | [`tests/current-video-primary-text-selection-store.test.ts`](../../tests/current-video-primary-text-selection-store.test.ts), [`tests/current-video-primary-text-selection-clear.test.ts`](../../tests/current-video-primary-text-selection-clear.test.ts) | Interleaved per-part saves persist safely; unknown state is not written; clear blocks/invalidates writes. |
| Transcript cache and subtitle display | `tests/current-video-transcript-cache.test.ts`, `tests/current-video-subtitle-probe.test.ts`, `tests/current-video-subtitle-view.test.ts`, `tests/current-video-subtitle-diagnostics.test.ts` | Exact source identity/hash, CID/page match, temporary owner isolation, honest unavailable/malformed status, and no stale subtitle view. |
| Summary/highlights | [`tests/current-video-summary-highlights.test.ts`](../../tests/current-video-summary-highlights.test.ts) | Full-primary-text audit, evidence-derived timestamps, exact cache identity/model binding, authorization/config cancellation, and no late cache write. |
| Full-text QA and sessions | [`tests/current-video-full-text-qa.test.ts`](../../tests/current-video-full-text-qa.test.ts), [`tests/current-video-qa-sessions.test.ts`](../../tests/current-video-qa-sessions.test.ts) | Complete authorized text only, bounded same-source context, citation validation, controlled provider failures, byte cap, delete/clear/retry race safety. |
| Segment retrieval/rerank and related favorites | `tests/current-video-segment-retrieval.test.ts`, [`tests/current-video-segment-rerank.test.ts`](../../tests/current-video-segment-rerank.test.ts), [`tests/current-video-qa.test.ts`](../../tests/current-video-qa.test.ts), [`tests/smart-favorites-qa.test.ts`](../../tests/smart-favorites-qa.test.ts) | Local evidence stays authoritative; AI cannot introduce timestamps/evidence; related favorites never enter current-video AI payloads. |
| Preview/confirm/return leases | [`tests/current-video-timestamp-operation-lease.test.ts`](../../tests/current-video-timestamp-operation-lease.test.ts) and handler cases | Lease is one-time, exact-bound, expires/cleans up, and a source/part/cache change blocks delivery. |
| History, config/privacy, and Favorite data | [`tests/history-sync-clear-coordinator.test.ts`](../../tests/history-sync-clear-coordinator.test.ts), [`tests/history-sync-diagnostics.test.ts`](../../tests/history-sync-diagnostics.test.ts), [`tests/settings-local-data-privacy.test.ts`](../../tests/settings-local-data-privacy.test.ts), [`tests/favorite-sync-audit.test.ts`](../../tests/favorite-sync-audit.test.ts) | Operation coordination, bounded exports, clear readback, snapshot completeness, and no account-wide upload. |
| Dynamic Bill gates and state | [`tests/dynamic-bill-migration.test.ts`](../../tests/dynamic-bill-migration.test.ts), [`tests/dynamic-bill-feedback-state.test.ts`](../../tests/dynamic-bill-feedback-state.test.ts) | Migration before protected work, gate serialization, no stale writes after clear, idempotent feedback/prompt behavior, and only intentional tab opens. |

## Risk and bad-case table

| Bad case | Existing protection that must move intact | Regression signal / response |
| --- | --- | --- |
| A new action is not registered, or two modules claim it | One explicit action registry and the existing unknown-action envelope | Exhaustiveness/duplicate-registry test; return the established unknown-action response, never fall through. |
| Direct `handleRequest` and the Chrome listener construct separate dispatchers | Module-level lazy `getDispatcher()` is the only production construction path; registration captures its result | Shared-instance test observes one factory call and shared coordination state. Revert the dispatcher-shell commit before moving any domain action. |
| `setupMessageHandlers` is called twice and duplicates side effects | A separately cached `ChromeMessageRegistration` owns stable callback identities and idempotent `register()` | Fake Chrome counters remain one for runtime, tab removal, and tab update; no request is handled twice. |
| A Dynamic Bill branch executes before migration or outside its data-operation lock | Three outer action sets and `handleRequest` gate order | Migration tests fail before DB/network work; revert the Dynamic Bill extraction, not the migration policy. |
| The active tab changes after a popup request was sent | Request tab takes precedence; fresh matching context resolution | Request-tab race test returns no evidence/no context for the old part rather than using another tab. |
| Same BVID but a different page/CID leaks text or a jump | URL BVID/page admission, exact CID/page checks, source guard | Page-change and stale-citation tests block/return no evidence; no content-script delivery. |
| A late content context update overwrites a newer video | Sender URL validation before updating `currentVideoContexts` | Late-page/no-context tests preserve the valid snapshot. |
| Selection changes or subtitle cache clears mid-request | Selection/clear generations checked before/after body read, network, cache/session write, and timestamp delivery | Return the existing cancelled/no-text/blocked state; no cache/session/seek write survives. |
| A summary/QA request races cancel, config change, or a newer same-source request | Preflight/request guards, config generation, `finally` settlement, exact cache identity | Zero/aborted network when appropriate; old result cannot replace a newer cache/session record. |
| A citation/highlight/subtitle preview becomes stale before confirm | Re-read persistent binding and issue a one-time exact lease after confirmation | Return candidate-not-found/stale blocked result; no blind seek or return. |
| AI payload grows from a convenience import | Domain payload builders plus allowlist audit immediately before transport | Payload audit fails on an unapproved path or sensitive key/string; no outbound request is made. |
| Provider/API failure exposes raw internal data or invents an answer | Service validation/sanitization and typed honest failure states | Controlled `failed`, `rejected`, `not_configured`, `no_text`, or `no_evidence` result with no raw internal token. |
| Clear-all or scoped clear races a background write | Existing operation coordinators plus post-clear readback | Clear tests show no final write survives; do not replace repository calls with direct DB access. |
| An extracted tab-open action creates a tab before durable state change | Dynamic Bill handler continues to await repository resolution first | Prompt/video tests observe at most one intentional tab and correct local status. |

## Separately proposed implementation issue slices

These are intentionally independent implementation issues after #216. Each gets one branch, one draft PR, a rollback commit boundary, and no product behavior changes.

1. **Dispatcher shell, lazy production instance, and Chrome registration.** Add `createMessageDispatcher`, module-level lazy `getDispatcher`, the separately cached idempotent registration adapter, and direct/runtime shared-instance characterization tests; retain all current handlers as delegates and make this one rollback boundary.
2. **Analytics and history handler extraction.** Move the seven analytics actions and six history/export/status actions, preserving sync controls and response codes.
3. **Settings and local-data lifecycle extraction.** Move configuration, privacy, clears, and AI health check with config/clear race coverage.
4. **Favorites handler extraction.** Move Favorites sync/index/search/QA paths without changing provider calls or Smart Favorites evidence boundaries.
5. **Dynamic Bill handler extraction.** Move all seventeen actions under unchanged central migration/operation gates.
6. **Current-video context and evidence runtime extraction.** Move content event handling, tab lifecycle cleanup, context revalidation, transcript/subtitle lookup, and primary-text authorization as a single exact-binding boundary.
7. **Current-video assistant and session extraction.** Move summaries, highlights, full-text QA, sessions, knowledge, retrieval/rerank, and related favorites while retaining payload audits and source/session guards.
8. **Current-video timestamp handler extraction.** Move preview/confirm/return and lease consumption after the context runtime is stable; remove dead private helpers only in a separate cleanup commit.

## Completion criteria for a later implementation series

- `handlers.ts` is a registration facade and has no business-domain switch.
- Direct `handleRequest` and every Chrome listener resolve to the same lazily constructed production dispatcher; dispatcher construction alone registers nothing, and repeated setup registers each Chrome listener once.
- All 75 message actions have exactly one registered owner; the dispatcher retains the same async and error behavior.
- Every current-video body read, AI request, cache/session write, and timestamp operation has the exact existing BVID/CID/page/source/version/session checks.
- Payload audits remain in the services that build outbound payloads and continue to fail before network transport.
- Dynamic Bill gates remain central and mechanically auditable.
- The existing focused tests pass for each moved family; `git diff --check`, `npm run typecheck`, and `npm run build` pass for each implementation PR.
- No new access to sensitive local files or account bulk data is added, and no Bilibili relationship/content mutation is introduced.
