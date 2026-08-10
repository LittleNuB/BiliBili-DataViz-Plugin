# 0.14 个人视频知识库产品 Grill

Status: DRAFT DURING GRILL. This document records accepted product principles and unresolved decisions. It is not implementation approval, an issue breakdown, or a release commitment.

## 1. North Star

The 0.14 direction is to help a user capture knowledge while watching a Bilibili video, find it accurately later, and return to the exact source. It is not a generic recommendation layer or a bulk AI summary product.

## 2. Accepted Product Boundary

- One video may be related to several Bilibili surfaces, including favorites, watch-later, watch records, and the active video page.
- Those surfaces supply relationships and entry points. They do not by themselves prove that a video has been watched, understood, or turned into knowledge.
- The knowledge base stores durable user-preserved knowledge separately from temporary source and AI caches.
- Removing a Bilibili relationship must not silently delete durable work the user explicitly preserved.
- User-facing wording remains natural Chinese and does not expose raw identifiers, source hashes, confidence fields, subtitle URLs, or runtime errors.
- The product does not write back to Bilibili relationships or content and does not become recommendation ranking.
- 0.14.0 can acquire complete text only from available Bilibili subtitles. The data and backup contracts remain able to represent a future completed local transcript, but 0.14.0 shows no local-transcription entry, setting, status, or unavailable-capability copy.

## 3. Accepted Admission Principle

The admission principle and its persistence triggers are accepted.

- Synced favorites and watch-later items may create lightweight 视频条目 containing available video information and their source relationships.
- Merely opening a current video does not automatically make it durable knowledge.
- A user-created note, timestamp bookmark, saved highlight, explicit save action, or explicitly preserved generated result may create durable 知识资产.
- Saving a durable 知识资产 admits its video into the local knowledge space. If a complete Bilibili subtitle for that exact video and part is already available, it becomes managed 全文资料 at the same boundary.
- The schema reserves a completed-local-transcript source type for a future verified capability. It is not a 0.14.0 action or acceptance criterion. If that capability ships later, starting it must explain retention and backup before work begins, and only a successful completion may admit the 视频条目 and 全文资料; cancellation or failure creates neither.
- Merely opening a current video or temporarily obtaining its Bilibili subtitle does not admit a video outside the knowledge space. Unsaved summaries, answers, and other generated or fetched material remain temporary sources or caches.
- Favorite and watch-later synchronization may create lightweight entries but never bulk-fetches subtitles, starts transcription, or otherwise creates 全文资料 in the background. When the user later opens such an admitted video and obtains complete text, that text becomes managed full-text material.
- If a video leaves favorites or watch-later, its relationship may disappear while its explicitly preserved 知识资产 remains.
- Watch-later membership never means “未观看” or “未看完”.
- Removing or refreshing the last source relationship triggers an atomic retention check. The canonical 视频条目 and its parts remain when any durable 知识资产, current 全文版本, or historical 全文版本 still refers to them.
- A 视频条目 with no source relationship, no durable knowledge asset, and no current or historical full-text version is an empty shell and may be removed automatically together with rebuildable indexes that depend only on it. This cleanup never deletes evidence or user content because those records are prerequisites for retaining the video.
- If a later source synchronization encounters that `bvid` again, it creates a new lightweight entry from current source information. This is source re-entry, not restoration of knowledge that did not exist.
- A successful complete video-part-list read reconciles parts by exact `cid`. Existing parts refresh mutable title, duration, page order, availability, and verification time; a failed, cancelled, or partial read is upsert-only and cannot declare an absent part.
- A previously known `cid` missing from a complete list remains as “视频分 P 暂时无法核对” while any durable asset-source relation, evidence version, or current or historical full-text version references it. With no durable reference, it is removed as an empty part shell.
- A new `cid` is a new part even if it appears at the old page number. Bili-Bill never moves evidence, timestamps, or full text by matching mutable page order, and whole-video inaccessibility never acts as an authoritative empty part list.

## 4. Accepted Ownership Boundary

- The knowledge base belongs to one local personal space in the current browser profile, not to a single Bilibili account.
- Durable notes, bookmarks, saved highlights, and other knowledge assets remain in that local space when the active Bilibili account changes.
- Favorite and watch-later relationships retain the identity of the connected account that supplied them. Syncing or disconnecting one account cannot delete another account's relationships.
- A video referenced by several connected accounts remains one 视频条目 with several account-scoped relationships.
- A newly detected Bilibili account is not imported automatically; connecting its data requires a simple user confirmation.
- Every confirmed connected source account has one auxiliary local registry record. Its synchronized relationships reference that account scope instead of copying the nickname into every row, and disconnecting removes the registry record plus only those relationships in one Dexie transaction before canonical-video retention checks run.
- The registry uses a random local `accountScopeId` as its identity and stores the stable Bilibili UID returned by the authorized sync once as a canonical decimal string used only to match a later sync. Source relationships and deterministic relationship keys use the local scope and never copy the UID.
- A synchronization response without a stable account identifier cannot create or select a connected account scope. Bili-Bill refuses that account import naturally instead of matching by nickname; a nickname change therefore never changes account ownership.
- A connected source account is shown only by the nickname returned during the user-initiated sync, or by a stable local alias such as “已连接账号 1” when no nickname is available. The interface does not display UID or retain an avatar.
- The auxiliary account registry stores only that local scope, one external matching identifier, available nickname, stable fallback-alias ordinal, and connection or verification timestamps. Account identifiers and labels remain local and are excluded from knowledge backup, diagnostic export, logs, AI requests, and knowledge-size reporting. Bili-Bill does not build an account profile or add a local hash-and-salt identity layer.
- Every exact favorite folder, watch-later collection, or later authorized source collection has one auxiliary 来源容器 row scoped to its confirmed account or the reserved upgrade-era legacy scope. It retains mutable label, public description, reported item count, synchronization completeness, and synchronization timestamps even when no video membership exists.
- Favorite containers use their real `mediaId`; watch-later and upgrade-era ungrouped favorites use reserved container value `0` within different source kinds. A deterministic length-prefixed `containerScopeId` combines source kind, local account or legacy scope, and external container ID, while each synchronized video relationship is keyed only by that container scope plus normalized `bvid`.
- Source relationships do not copy container names or synchronization state. Disconnecting an account removes its account registry row, containers, and exact relationships in one Dexie transaction before video retention checks; container data is excluded from knowledge backup, diagnostic export, AI requests, and knowledge-size reporting.
- Disconnecting one source account removes only that account's synchronized relationships and preserves canonical videos that still have another source, personal knowledge, or managed full text.
- Different people sharing a computer should use separate browser profiles; Bili-Bill does not implement its own multi-user security boundary.
- Existing `favoriteItems` and `favoriteFolders` do not record the supplying Bilibili account. The 0.14 migration preserves them as 升级前收藏来源 relationships and never assigns them to whichever account happens to be active during upgrade.
- A later user-authorized favorite sync may reconcile a legacy relationship only after that account's folder sync completes successfully and the Bilibili folder identity plus video identity match exactly. The matching account-scoped relationship replaces the legacy one without duplicating the canonical 视频条目.
- An incomplete, failed, or cancelled sync never claims, deletes, or rewrites legacy relationships. Unmatched legacy records remain visible under 收藏来源 until a later complete sync reconciles them or the user explicitly clears that source data.
- New synchronized source relationships use the deterministic membership scope `source kind + local account scope + source container + bvid`; mutable labels and timestamps do not define identity. These external memberships receive no durable knowledge UUID and are excluded from knowledge backup.
- Only a complete synchronization may remove relationships absent from the exact account-and-container scope it covered. Incomplete, cancelled, blocked, or failed synchronization is upsert-only and cannot delete by omission.
- The local account-scope key is never shown in ordinary UI or diagnostics, included in knowledge backup, or sent to an AI service.
- Legacy favorite rows with a valid normalized `bvid` may create canonical videos during the deterministic version-14 migration. Rows that have only `avid` remain preserved in the existing source data as “视频信息待补全” and do not create a provisional canonical identity.
- A “视频信息待补全” record cannot own a knowledge asset or managed full text. A later user-authorized complete sync or deterministic metadata refresh may create the canonical video only after it obtains the real `bvid`, then attach the preserved favorite relationship without inventing or algorithmically converting an identifier.
- `knowledgeSourceAccounts` stores the local account scope, unique external matching ID, optional nickname, alias ordinal, and connection, verification, and update times. It is keyed by account scope and has only one unique secondary external-ID index.
- `knowledgeSourceContainers` stores container scope, source kind, account-or-legacy owner scope, external container ID, optional label, description and reported count, synchronization completeness, and lifecycle or synchronization times. It is keyed by container scope and indexed only by owner scope and owner-plus-source kind.
- Version 14 source kinds are 收藏 and 稍后再看. Container completeness is upgrade-era unverified, incomplete, or complete; only a complete sync may remove an absent membership. The singular 稍后再看 container and an upgrade-era ungrouped-favorite container use reserved container ID `0` within their different source kinds.
- `knowledgeSourceRelations` stores exact container scope plus normalized `bvid`, optional source-side added time, and first or most recent observation times. Its compound identity plus single-field container and video indexes are its only query paths.
- Account, container, and membership records contain no raw source response or network-error body and carry no restore-operation marker because knowledge backup and restore exclude them.

## 5. Accepted Video And Part Identity

- One Bilibili submission is one top-level 视频条目, including submissions with many parts.
- Parts remain subordinate scopes inside the video entry rather than separate top-level cards.
- 视频条目 is an independent canonical knowledge-space entity, unique by normalized `bvid`. Existing favorite items, watch-later items, watch-history rows, account relationships, and current-video text caches may supply metadata or relationships but are not reused as the video's identity or ownership record.
- Each known part has a subordinate identity unique within its video by the stable Bilibili `cid`, with `page` retained as mutable display/order metadata rather than the sole identity. Whole-video assets may omit a part link; time-aligned assets and full-text sources must link to an exact part.
- Source relationships are stored independently from both the canonical video and its parts. Removing or refreshing one relationship cannot delete a video that still has another relationship, a durable 知识资产, or 全文资料.
- Historical full-text versions count as durable references for video retention even when no version is currently eligible for factual AI use.
- A general user note may describe the whole video.
- A timestamp bookmark, subtitle highlight, local passage note, generated highlight, or answer citation must remain bound to the exact part that supplied it.
- Opening a part-bound result first resolves the correct part. A timestamp action still requires preview, confirmation, and return.
- Part renaming, reordering, removal, or temporary unavailability never silently deletes durable personal knowledge. The affected item remains readable with a natural source-availability state.
- Large courses and compilations remain one video entry while allowing search and filtering within their parts.
- Video and part title, description, cover, creator name, duration, publication time, and part order form a refreshable 视频展示快照 rather than video-content evidence. Only a successful sufficiently complete page resolution or authorized synchronization may update it.
- Empty fields, failed requests, and incomplete synchronization preserve existing non-empty snapshot values. A deleted, private, or temporarily unavailable video remains recognizable from its last-known snapshot and shows “视频暂时无法核对” rather than disappearing.
- Backup carries the minimum snapshot needed to identify referenced sources offline. Restore keeps local non-empty values and fills only missing fields until a real source refresh succeeds; device timestamps never choose a silent metadata winner.
- Refreshing a video snapshot never changes a knowledge asset's user-authored title, note, body, or tags.
- `knowledgeVideos` stores canonical `bvid`, optional known `avid`, optional last-known title, description, cover, creator, public category and tags, duration and publication time, required availability and local lifecycle times, optional successful-verification time, accepted knowledge-library activity time, and an optional restore-operation marker. Its only secondary query paths are `[lastLibraryActivityAt+bvid]` and the optional operation marker.
- `knowledgeVideoParts` stores exact `bvid + cid`, optional last-known title, duration and display order, required availability and local lifecycle times, optional successful-verification time, and an optional restore-operation marker. Its only secondary query paths are `bvid`, `[bvid+displayOrder]`, and the optional operation marker.
- Video and part availability is pending verification, available, or unavailable. Migration and restore cannot claim availability; only a successful authoritative source read changes that state.
- Display snapshot fields may be absent. Empty, failed, cancelled, or incomplete source responses cannot erase an existing non-empty value, and only a successful authoritative source result updates successful-verification time. Canonical records store no raw response or network-error body.
- `bvid`, UUIDs, and source enums remain strings. A canonical BVID trims surrounding ASCII whitespace, matches `^BV[0-9A-Za-z]{1,62}$`, and preserves exact case; a malformed value is not guessed. External account and container IDs use canonical non-negative decimal strings, while `avid`, `cid`, creator IDs, page order, counts, ordinals, and byte sizes remain non-negative JavaScript safe integers for compatibility with current-video and navigation code.
- Every `*At` timestamp is a Unix-millisecond safe integer and every `*Seconds` duration is finite and non-negative. Invalid, negative, infinite, unsafe, malformed, or lossy values are rejected before writing rather than rounded or guessed.
- Migration promotes only losslessly validated old identifiers. An invalid legacy value remains in its original source store with a natural incomplete-information state, and backup or restore preserves the accepted JSON type without another numeric conversion.

## 6. Accepted Source Change And Preservation Rule

- User-authored notes remain durable when subtitles, local transcripts, video structure, or generated results change.
- Timestamp bookmarks remain durable and may still navigate when the original part and time position remain available.
- A saved subtitle or transcript excerpt preserves the text captured at save time. If its exact source changes, it receives the natural user-visible state “依据已变化” and no longer represents the current wording.
- Explicitly saved summaries, highlights, and answers remain readable as historical results when their supporting source changes, but they cannot support new answers or current factual citations.
- Regeneration and replacement require a user action. Source changes never trigger silent AI requests, new fees, or automatic overwrites.
- Unsaved source and generated caches may be evicted or regenerated under later capacity rules.
- If the original part is removed or unavailable, durable personal content remains while navigation is disabled with a natural explanation.

## 7. Accepted Global Search Scope

- One global search entry covers every lightweight 视频条目 already in the local knowledge space.
- Search may match available video information, time-aligned video text, personal 知识资产, and explicitly saved summaries or answers.
- A currently open video that has not entered the local knowledge space remains available only to the current-page search and assistant; a global search does not silently persist it.
- Every result states its matched layer in natural Chinese, such as “个人笔记”, “视频文本”, or “视频信息”. A title or description hit must not be presented as proof of what the video says.
- Relevance gives personal knowledge priority over video text, and video text priority over video information. This is retrieval relevance, not recommendation ranking or click prediction.
- Existing `smartFavoriteIndex` rows remain rebuildable 收藏分类 data under 收藏来源. Their category path, generated summary, keywords, aliases, and searchable text may contribute a lower-priority local retrieval signal; a result matched only through this layer states “收藏分类” and never “个人知识” or “视频文本”.
- 收藏分类 is not a 知识资产, 知识标签, 证据快照, or factual video source. It is excluded from knowledge backup and from cross-video AI evidence payloads, and clearing or rebuilding it cannot remove a 视频条目, 全文资料, or durable knowledge.
- A historical result marked “依据已变化” remains findable for review, but its old evidence cannot support a new answer or current factual citation.

## 8. Accepted Retrieval And RAG Boundary

- 0.14.0 has an always-available 本地混合检索 baseline. Exact wording, structured video information, available video text, personal knowledge, aliases, and other local relevance signals may all contribute, while AI or vector indexing is never required for basic search.
- Core knowledge tables add secondary indexes only for accepted product operations: exact source reconciliation, asset type and recency views, personal-tag filtering, source and evidence traversal, managed-full-text scope and timeline reads, and bounded maintenance cleanup. A hypothetical future query does not justify another version-14 index.
- User-authored bodies, notes, captured evidence text, and complete video text never enter ordinary core-table indexes. Personal tags retain the user's display wording on each asset while a derived normalized `tagKeys` multi-entry index supports filtering and suggestions.
- Global body-text retrieval must use the separately rebuildable 知识检索索引. Its physical persisted layout is selected by the blocking full-text-search feasibility gate; failure cannot silently replace that design with a per-query scan over the managed corpus.
- Optional AI query expansion may improve recall, but expanded terms are used only to retrieve local material. They are not evidence and cannot introduce a source or claim.
- 检索增强问答 first chooses a bounded set of eligible videos or parts. For every selected source, the model receives its complete 主要文本来源 rather than only isolated matching fragments; the generated answer appears before its exact citations.
- One question selects at most five exact video or part scopes, including the active video when present. When more candidates match, the interface states “本次采用 5 个来源，另有 N 个相关来源未纳入” and lets the user replace selected sources without exceeding five.
- When selected complete texts exceed 512 KiB of UTF-8 request text, the product shows the source count and natural text scale and requires a per-request confirmation that waiting time and provider fees may increase. Smaller ordinary requests proceed under the existing authorization without this extra step.
- Confirmation sends every selected complete text without discovering a model context window, truncating a source, or substituting retrieval fragments. If the configured provider rejects the context as too large, the original question and source selection remain available for “调整来源” and retry; Bili-Bill never silently produces a fragment-only answer.
- Retrieval relevance determines which sources are considered. It does not establish factual confidence, replace citation validation, or permit metadata-only claims about video content.
- A question sends text only after a user action. If the selected complete texts imply material waiting time or cost, the product shows a natural confirmation before sending.
- 0.14 does not create a remote embedding index of the full knowledge space. That would introduce a new corpus-wide upload, provider-compatibility, cost, and re-indexing contract beyond current-video authorization.
- Local vector semantic retrieval is an independently validated, additive enhancement rather than a 0.14.0 release dependency. If model size, indexing time, memory, browser compatibility, or Chinese recall is unacceptable, the capability can be postponed without disabling search or knowledge-base questions.

## 9. Accepted Single-Input Evidence Scope

- The assistant keeps one ordinary question input and does not require a persistent “当前视频 / 知识库” mode switch.
- Every submitted question receives a local 证据范围判断: current video only, personal knowledge space only, or current video plus the knowledge space. The decision itself does not call AI or send any text.
- With an active video, questions that clearly refer to “以前收藏的”, “之前看过的”, comparisons, or other cross-video knowledge may automatically include eligible knowledge-base sources. The active video can participate as a temporary source without becoming a durable 视频条目.
- An ambiguous follow-up such as “还有别的观点吗” remains scoped to the active video. The interface may offer one lightweight “也查个人知识库” action for that question instead of changing a persistent mode.
- Without an active video, questions naturally use the personal knowledge space.
- Every answer displays a compact natural-language scope such as “本次参考：当前视频” or “本次参考：当前视频及知识库中的 3 个视频”. A correction may retry with a narrower or broader scope but does not rewrite the original turn or silently change later turns.
- Internal question routing calls the extension's knowledge retrieval capability directly. It does not require a Skill selector, model tool-calling loop, MCP client, companion process, or MCP server.
- The internal retrieval boundary may later be exposed through an optional MCP adapter when an external assistant needs authorized access. That adapter is not part of the in-extension answer path or a 0.14 requirement.

## 10. Accepted Knowledge-Base AI Data Boundary

- Knowledge-base AI access requires the separately accepted authorization flow described below rather than inheriting the existing current-video full-text authorization.
- A user-submitted knowledge-base question may send the complete 主要文本来源 of the selected videos or parts and only the personal 知识资产 retrieved as directly relevant to that question.
- Personal knowledge remains visibly distinct from video text. A “个人笔记” source may support what the user recorded, but it cannot establish what a video said unless it retains a current, valid citation to that video's exact part and text source.
- Saved highlights, summaries, or answers with valid current evidence may contribute within that evidence boundary. An item marked “依据已变化” may remain locally searchable and readable but cannot support a new generated answer or current factual citation.
- The request may include the user's question and the minimum video title, part, and natural source labels needed to explain citations. Account identifiers remain local.
- The request never includes the entire knowledge space, unrelated notes, complete favorites, watch-later or history lists, account relationships, unsaved temporary results, raw source fields, or background caches.
- Local retrieval and global search remain available when knowledge-base AI authorization is absent or disabled. No authorization state causes a background upload or AI request by itself.

## 11. Accepted Knowledge-Base AI Authorization

- 知识库 AI 授权 is a persistent local permission separate from the existing “当前视频 AI 助手” full-text authorization. An upgrade never infers or enables it from an older setting.
- The permission starts disabled. When a submitted question first resolves to a knowledge-base evidence scope, the assistant presents an inline explanation without sending the user to Settings.
- The first-use explanation states how many selected videos or parts will send complete text, whether directly relevant personal knowledge is included, and the actual text scale. It does not expose account identifiers, source hashes, internal statuses, or other raw fields.
- “允许并继续” stores the authorization and continues the already submitted question. Granting authorization by itself never starts a background upload, index build, or AI request unrelated to that question.
- After authorization, ordinary knowledge-base questions do not repeat the consent step. The answer still displays its resolved evidence scope, and a request above the accepted 512-KiB complete-text boundary receives the separate natural warning before sending.
- Declining preserves the user's question and does not silently answer a cross-video question from the current video alone. When an active video exists, the assistant may offer the explicit alternative “仅按当前视频回答”.
- Settings provides a persistent authorization control. Turning it off prevents new knowledge-base AI requests but does not delete local knowledge, previous answers, or local search capability.

## 12. Accepted Durable Knowledge Asset Rule

- Every user-authored note, timestamp bookmark, explicitly saved excerpt, and manually preserved highlight, summary, or answer is a durable 知识资产.
- Every durable asset relates to at least one exact 视频条目. A pure note may relate to a whole video without captured wording or a time range, but 0.14 does not create free-floating notes with zero video relations. Creating a note from the knowledge-base entry therefore starts by selecting one or more existing videos.
- The stable primary types are 笔记, 时间书签, 摘录, and 已保存回答. Saved highlights, summaries, subtitle selections, and answer selections remain 摘录 with a natural subtype label rather than expanding the primary filter set.
- Durable knowledge assets are never candidates for automatic age-, count-, size-, or least-recently-used eviction.
- Removing a favorite or watch-later relationship, disconnecting an account source, clearing subtitle or transcript caches, rebuilding a search or vector index, changing an AI model, or upgrading an internal schema must not delete them.
- If a durable save cannot be committed safely because storage is unavailable or a hard safety boundary would be exceeded, Bili-Bill refuses the new save with a natural explanation and offers storage management or export. It never deletes older knowledge to make room.
- Backup format v1 allows at most 16 MiB for one canonical JSONL record. A save whose one asset, relation, or evidence record cannot fit is refused before commit with natural “内容过大，暂时无法保存” guidance, so 0.14 never creates durable knowledge that its own current backup format cannot preserve.
- Only an explicit user deletion, a separately confirmed knowledge-clear operation, or an explicit restore operation whose conflict behavior the user has accepted may remove or replace a durable knowledge asset.
- Complete text for an active video outside the local knowledge space remains a temporary source cache. Once a video belongs to the local knowledge space, an available complete Bilibili subtitle becomes separately managed 全文资料; a completed local transcript follows the same rule only in a future release that has shipped that capability. Full-text material remains distinct from a user-authored knowledge asset and from that asset's minimal evidence snapshot.

## 13. Accepted Conversation Lifecycle

- A 问答会话 is persistent local history but does not make every question or answer a permanent 知识资产.
- Cross-video questions evolve the existing local QA-session store rather than creating a second conversation history. Existing single-video sessions remain readable, while new turns may retain several exact video or part source snapshots under an internal record-format version.
- The physical compatibility name remains internal. User-facing language and new domain APIs use 问答会话 without exposing a distinction between legacy current-video rows and new multi-source rows.
- Session history remains capacity-bounded and may remove the least recently accessed non-current sessions when its independently measured storage boundary is reached. It does not expire after a fixed number of days.
- The existing 0.13 baseline of 200 sessions or 25 MiB remains the starting compatibility assumption, but the implementation review must re-check serialized cross-video answer size before freezing the 0.14 limit.
- The user may explicitly preserve selected conversation content as durable knowledge through the accepted selection action or the secondary whole-turn save action. Multi-source citations remain attached to one saved asset.
- Once preserved, the resulting knowledge asset is independent from its source session. Deleting or automatically evicting the ordinary session cannot delete the saved asset.
- 0.14 does not add permanent retention or pinning for an entire conversation. Users retain separate deletion and clear-history controls, while durable knowledge uses its own management boundary.

## 14. Accepted Multi-Source Knowledge Asset

- A saved cross-video comparison or synthesis becomes one 多来源知识资产 rather than one duplicate per cited video.
- The asset belongs to the local knowledge space and links to every cited 视频条目 and exact part. It does not require an arbitrary primary video.
- Every linked video's related-knowledge view may surface the same asset, but editing, deleting, exporting, or restoring it operates on one stable asset identity.
- Each citation independently retains its video, part, primary-text source, captured text, time range when available, and current source state.
- If one citation later becomes “依据已变化” or its source is unavailable, only that supporting relationship changes state. The remaining citations and the saved synthesis remain intact and readable.
- A single-video asset uses the same model with one linked source; the product does not maintain separate single-video and cross-video storage concepts.

## 15. Accepted Conversation And Subtitle Save Interaction

- The primary fine-grained save interaction is a native selection context-menu action, “保存选中内容到知识库”. It requires an explicit extension `contextMenus` permission and must be included in release permission review.
- In 0.14.0, this action appears only for selections inside Bili-Bill-rendered validated answers and Bilibili-subtitle views. A future release may also enable it in a completed local-transcript view after that capability ships. It does not clip arbitrary text from the surrounding Bilibili page.
- Selecting answer text creates a 选区摘录 containing the selected text, its originating user question, and only the validated citations mapped to the selected answer content.
- Selecting Bilibili-subtitle text creates a 选区摘录 containing the exact selected text, video, part, primary-text source, and real mapped time range. The same contract applies to completed local-transcript text only in a future release that supports it.
- A selection crossing unrelated answers, unsupported UI, or source blocks that cannot be represented exactly is refused with a natural explanation. Bili-Bill does not concatenate it, assign an arbitrary source, or silently save it as source-backed knowledge.
- A successful action saves immediately without a modal, derives an initial title from the question or selected text, and offers “查看”. The title and a separate user note may be edited later in the knowledge view.
- Repeating the same save action for the same selected source snapshot does not create a duplicate asset.
- New validated answers retain ordered answer blocks and their evidence mapping for saving. A legacy ready session that lacks that mapping may still save the whole turn as one preserved block supported by its validated citation union, but it does not expose precise selection saving and states naturally that the old answer cannot map a selected passage exactly.
- A validated answer's secondary overflow menu provides “保存本轮问答” for users who want the complete question, answer, and mapped citations. This is secondary to selection saving and does not add whole-conversation pinning.
- Rejected, insufficient-evidence, or citation-invalid AI output does not expose either source-backed save action. Deleting its ordinary source session later does not delete a successfully saved asset.
- Removing a saved excerpt from the knowledge space is an explicit deletion and must receive a separate confirmation.

## 16. Accepted Evidence Snapshot And Full-Text Retention Rule

- A 知识资产 stores only its durable identity, type, editable 用户整理内容, lifecycle timestamps, and other asset-level state. It does not embed an indivisible array containing every video, part, citation, and evidence history.
- A source-backed or generated asset may additionally store one immutable 保存内容 layer at asset level: its saved-content kind, ordered non-empty body blocks, and original question for a saved answer or answer excerpt. A multi-source answer, summary, highlight, or answer selection is stored once rather than copied into every citation.
- The editable title, personal note, tags, and pure-note body remain separate. Saved content cannot be edited in place; a user rewrite becomes a separate personal note and cannot replace what was originally preserved.
- Each related video or exact part is represented by an independent 资产来源关系. A multi-source synthesis owns several relations; a whole-video personal note may have a video relation without a captured excerpt, while a timestamped or source-backed asset requires exact part scope.
- Read-only source support is stored as immutable 证据版本 owned by one source relationship. Each version retains only the exact source excerpt, video, part, time range, source identity, and unique in-range saved-content block ordinals it supports. Each relationship holds at most one current-evidence selection; 重新定位来源 atomically creates the replacement and switches that selection while leaving the prior evidence record, saved content, and every other source relationship untouched. The prior mapping is then displayed as 已更正.
- Evidence state is mutable relation-level status: 无需证据, 当前有效, 依据已变化, 来源暂时无法核对, or 来自备份待核对. Historical evidence versions have no mutable current flag; the active pointer and relation state determine ordinary display and filtering.
- A sparse unique source-save fingerprint prevents concurrent duplicates for the same validated context-menu selection or whole-turn save. It excludes editable title, personal note and tags, remains internal, and is never presented as asset identity.
- Provider, model, prompt, confidence, and other raw generation fields are not durable knowledge fields. Backup includes the immutable saved content with its asset and the independent evidence versions required to understand its source support.
- Creating a source-backed asset atomically commits the asset, all required source relationships, and their initial evidence versions. A failed write leaves none of those partial durable records; editing 用户整理内容 never rewrites evidence versions.
- Every source-backed 证据版本 contains the minimum 证据快照 needed to read what was preserved and identify its video, exact part, natural source type, captured text, and real time range when available.
- The evidence snapshot belongs to the durable asset and is not deleted when the complete subtitle, local transcript, answer session, generated cache, or search index is removed.
- Complete text for an active video that has not entered the local knowledge space remains a bounded temporary cache and is not included in a knowledge backup.
- When a 视频条目 belongs to the local knowledge space and its complete Bilibili subtitle is available, that source becomes 全文资料. A completed local transcript follows the same rule only in a future release that has separately shipped that capability. 全文资料 is retained by default, participates in local reading and search, and is included by default in a full knowledge backup.
- Managed 全文资料 has a durable storage lifecycle independent from `currentVideoTranscriptSources` and `currentVideoTranscriptSegments`, which remain bounded current-video caches. Admission atomically copies the exact validated source metadata and all of its time-aligned rows into dedicated managed-full-text storage; a cache row is never made durable by toggling a persistence flag.
- The existing current-video cache field named `persistent` means only that cached evidence may remain readable beyond one temporary page owner. It is not knowledge admission, retained full text, backup inclusion, or a user-visible saved state, and the managed-full-text schema does not reuse it as a lifecycle field.
- A failed or interrupted admission writes neither a managed source nor partial managed segments. After a successful commit, clearing, expiring, or replacing the current-video cache cannot remove or mutate the managed copy.
- Managed full text is versioned within the exact video, part, language, natural source type, and stable internal source-variant scope, with at most one current 全文版本. Reacquiring identical body and timeline content refreshes only the current version's verification time and does not create a duplicate.
- The current version alone carries a unique scope selection derived from `bvid + cid + source type + language + source variant`; mutable `page` order, display label, endpoint, and subtitle URL do not participate. A Bilibili-provided stable non-URL track discriminator produces a private variant key. If no stable discriminator exists, the scope is the single “默认 B站字幕” variant; choosing different same-language content then requires explicit replacement confirmation and is not described as an update to a known identical track. Historical and restored-pending-validation versions carry no current selection, and the internal variant key is never shown to users.
- When reacquired body or timeline content differs, the new current-page source remains a temporary “字幕有更新，待确认” candidate and does not silently replace managed text. Confirming the update atomically creates the new current version and changes the former current version to a read-only historical state.
- The confirmation transaction transfers the unique current selection only after the complete new version and segments fit and validate. Failure rolls back the transfer and preserves the former current version.
- Historical full-text versions remain readable, locally searchable with a natural historical label, and included in full backup, but cannot support a new current factual answer or citation. They count toward the 500-MiB full-text boundary and may be explicitly removed in 空间管理 without deleting related assets or evidence snapshots.
- Storage separates immutable 全文版本 metadata from ordered, time-aligned 全文片段 rows. A whole-video transcript is not persisted only as one large opaque record.
- Segment-heavy reads, indexing, backup, restore, and removal may use bounded batches, but admitting, accepting, restoring, or deleting one full-text version commits its version metadata and every owned segment atomically. A failed operation leaves neither an orphan version nor partial segments.
- Every 全文版本 has a stable local UUID preserved by backup and restore. Its fragments use the compound identity `[version UUID, zero-based ordinal]`, with contiguous ordinals and no independent fragment UUIDs.
- A version records only its exact video, part, natural source type, normalized language, private stable source-variant key, immutable content and timeline fingerprints, segment count, coverage, deterministic byte count, lifecycle state, source-capture time, and required local lifecycle metadata. Version 14.0 admits B站字幕 only; `本地转录` remains a reserved future source type behind its separate release gate.
- Missing source-language metadata is stored as an internal unknown-language key and shown naturally as “未标明语言”. Raw subtitle URLs, endpoint names, response bodies, runtime errors, temporary cache identifiers, and other engineering fields are never retained or shown as full-text metadata.
- Each non-empty fragment retains its exact source text and real start and end time. Fragment order begins at zero and cannot skip or move backward; source-provided time overlap is preserved rather than rewritten, and missing intervals are not filled with invented text.
- Any body or timeline change creates a new version UUID with a complete ordered fragment set. Internal body and timeline fingerprints detect identical or changed content but never become record identity or user-visible copy.
- Full-text byte accounting and source fingerprints use one versioned canonical UTF-8 JSON/JSONL representation. Exact source text is preserved without whitespace, punctuation, or Unicode normalization; mutable lifecycle state, verification time, operation markers, ZIP compression, and browser implementation overhead do not change the retained-text count.
- If the confirmed replacement and retained history would exceed the hard boundary, the update is refused before commit and the existing current version remains unchanged. The user may remove an unneeded historical version, export, or otherwise manage storage before retrying.
- Knowledge-base synchronization never acquires complete text in bulk. In 0.14.0, full-text material enters only through an explicit knowledge save with Bilibili subtitle text already available, user-driven subtitle retrieval while viewing an admitted video, or restore from a full backup. A future verified local-transcription capability may add successful user-confirmed completion as another admission event.
- 全文资料 is never removed by age-, count-, size-, or least-recently-used eviction. A separately measured unified full-text capacity guards this category; reaching it stops new complete-text acquisition, restore, or promotion into the knowledge space and offers backup or storage management instead of deleting an older source. The same boundary must also block future local transcription before it starts.
- The warning begins at 419,430,400 canonical bytes (400 MiB). A write whose exact resulting total exceeds 524,288,000 bytes (500 MiB) is refused; exactly 500 MiB may commit and then displays the full state. Existing over-limit or accounting-invalid material remains readable and exportable while further full-text writes pause for checking or storage management.
- Reaching the full-text limit does not prevent creation of a lightweight 视频条目 or a durable 知识资产 when their own required data and 证据快照 can still be committed safely.
- Managed 全文资料 is measured by its complete UTF-8 serialized source metadata and time-aligned text rows. It has no separate video-count limit, warns at 400 MiB, and refuses new retained full-text writes beyond a 500 MiB hard boundary.
- Every full-text version stores its deterministic uncompressed UTF-8 byte count. A transactionally maintained aggregate ledger accelerates capacity checks but is verified against the per-version totals when the database opens.
- A missing, invalid, or mismatched ledger is repaired before new full-text admission. Existing retained text remains readable while the interface states “正在核对全文空间”; Bili-Bill never guesses that more text fits.
- Final capacity admission uses the exact new version bytes and transaction-local aggregate. A duration-based or source-size estimate may warn before work starts but cannot override the hard boundary, and compressed backup size never defines local usage.
- Durable knowledge assets and evidence snapshots have their own no-eviction safety boundary. Rebuildable search or vector indexes are reported separately and do not consume the 500 MiB managed-full-text allowance.
- If local transcription ships in a later release, Bili-Bill must estimate retained-text space from video duration and current usage before starting. If the conservative estimate does not fit, transcription does not start and the user is offered backup or storage management. This is a future capability contract, not 0.14.0 UI.
- If a future completed transcription unexpectedly cannot be committed within the hard boundary, its result remains available only in the current temporary page scope when that runtime permits. The user may export it directly or free space and retry retention; Bili-Bill does not discard an older managed source or falsely report the new transcript as backed up.
- When a knowledge asset save succeeds but an available complete source cannot be promoted because the full-text boundary is reached, the asset and evidence snapshot remain saved and the interface states naturally that the complete text was not retained.
- Explicitly removing one 全文资料 leaves every related knowledge asset and evidence snapshot readable and may still allow opening the correct video and part. Timestamp navigation continues to require preview, confirmation, and return.
- The snapshot remains eligible as personal knowledge about what the user preserved. It cannot by itself support a new claim about the video's current wording while the complete current source is unavailable; current-video or cross-video factual use requires reacquiring and validating the source.
- A removed Bilibili subtitle may be re-detected or fetched again when available. If local transcription is available in a later release, removing one requires a new user-initiated transcription to recreate it; Bili-Bill never starts that work automatically.
- Full-text search and new AI questions clearly state when a relevant video's complete text must be reacquired. The absence of a source cache does not become a false “no matching knowledge” result when a durable snapshot still matches.
- Search indexes, optional vector indexes, unsaved generated results, and other derived caches are rebuildable and may be cleared or evicted without deleting knowledge assets. Synchronized source relationships may be cleared or re-synced under their own category without deleting assets.

## 17. Accepted Knowledge Backup Boundary

- 0.14 provides a user-initiated “导出知识库备份” operation that writes one local, versioned, machine-readable compressed backup package. It does not upload the package or require a cloud account.
- The export click first opens the system file picker and obtains a user-chosen destination, then streams the ZIP directly to that file. Bili-Bill does not build a large archive entirely in memory and does not add a broad download-management permission for this operation.
- After the destination is chosen, export keeps existing knowledge readable but pauses knowledge and synchronized-source mutations until the stable snapshot finishes, fails, or is cancelled. It never reports success before the writable stream closes and all manifest counts and hashes are complete.
- If writable-file streaming is unavailable, only a separately benchmarked small backup may use a Blob fallback. A large backup refuses before construction and states naturally that a supported current Chrome version is required rather than risking excessive memory use.
- The package is an ordinary ZIP named like `bili-bill-knowledge-YYYY-MM-DD.zip`, not one monolithic JSON value. Its root `manifest.json` declares `backupFormatVersion: 1`, export time, full or lightweight mode, record and byte counts, the allowed entry list, and a SHA-256 value for the exact uncompressed bytes of every data entry. Backup format versioning is independent from the Dexie database version.
- Version 1 stores canonical videos, parts, knowledge assets, asset-source relations, and evidence versions as five fixed UTF-8 JSONL entries. Full backup adds one full-text-version entry and one globally ordered full-text-segment entry; streaming by version UUID and ordinal keeps memory bounded without creating one ZIP path per version.
- Every backup contains every durable 知识资产 and its stable UUID, the UUIDs of its 资产来源关系 and 证据版本, each relation's nullable current-evidence selection, user-authored title, note and tags, creation and modification time, necessary public `bvid` and `cid` identities and titles, multi-source links, 证据快照, real time ranges, source states, and a backup schema version. Dexie auto-increment row numbers are never backup identity.
- “包含完整文本” is selected by default. When selected, the package additionally contains every available 全文资料 in the local knowledge space; in 0.14.0 these are Bilibili subtitles, while a future release may also include completed local transcripts. Temporary source caches for active videos outside the knowledge space remain excluded.
- Before export, the interface shows the estimated package size and a natural coverage receipt, including how many complete source texts will be included and how many known video or part sources are not currently available. The user may deselect the full-text option to create a clearly labeled 轻量备份 containing only durable knowledge and evidence snapshots.
- Cancelling export, closing the dashboard, losing the worker, or exhausting disk space releases the operation lock and never claims a valid backup. Browser behavior for an incomplete destination file is part of the release gate, and the UI tells the user when that file may need manual removal.
- A full backup includes current and retained historical 全文版本 and preserves which one was current at export time. Historical versions remain historical after restore and never become current solely because their backup is newer.
- The export explains in natural Chinese that the package may contain personal notes, saved content, and available complete texts. It names only source types actually present in that package, does not claim encryption, and does not imply that possession of the package is harmless.
- ZIP packaging does not provide encryption. Export and restore UI state this boundary directly and never describe the file as password-protected or private merely because it is compressed.
- The backup excludes audio, transcription model files, search or vector indexes, generated caches, ordinary 问答会话 history, favorites, watch-later and watch-history lists, account source relationships, account identifiers, local AI settings, model configuration, API keys, login state, and other credentials.
- Conversation content enters the backup only after the user explicitly saves it as a durable knowledge asset.
- A complete text restored from a full backup becomes 全文资料 and is immediately available for local reading and search. Before it can support a new current-video or cross-video factual answer, Bili-Bill must revalidate its video, exact part, and source state; restore never silently promotes an older backup copy to current evidence.
- Complete source texts absent from a lightweight or incomplete backup can be reacquired separately. Their absence never deletes or invalidates a restored knowledge asset or its historical evidence snapshot.
- The backup format remains independent from one browser profile so it can support the accepted non-destructive restore and migration behavior below.

## 18. Accepted Non-Destructive Restore

- Restoring a 知识库备份 performs a 非破坏性恢复. A normal restore never removes local assets, overwrites local content, or behaves as a hidden replace-all operation.
- Before staging, Bili-Bill validates the bounded ZIP directory, manifest, supported schema version, exact paths, declared safety limits, and every error that can be decided without a cross-record pass. A structurally invalid or unsupported envelope is rejected without writing staged or visible rows.
- 0.14 exports only backup format v1 and does not offer downgrade export. A reader that encounters a higher unsupported format rejects it without partial parsing and states naturally “备份版本较新，请更新 Bili-Bill”.
- Future support for an older backup format requires an explicit deterministic migration chain through every intervening format version. Migration produces a candidate current-format representation without modifying the original ZIP; only after migration and complete current-format validation may the atomic restore transaction begin.
- Validation rejects unknown or duplicate archive paths, path traversal, entries absent from the manifest, missing declared entries, and declared safety-limit overflow before staging. Streamed SHA-256, malformed JSONL, duplicate durable identities, broken cross-record references, conflict rewrites, and exact resulting capacity may be resolved through bounded invisible staging; none may reach a user-visible commit.
- A restore preview states how many assets will be added, skipped as identical, or retained as conflicts. It does not expose raw internal fields in ordinary UI.
- A backup-only asset is added with its preserved UUID. An asset with the same UUID and identical semantic graph is skipped without creating a duplicate; internal content fingerprints make repeated restore idempotent but are not shown in ordinary UI.
- When an asset UUID matches but durable content differs, Bili-Bill keeps the local asset and imports the complete backup asset graph under deterministic conflict UUIDs derived from the original UUID and semantic graph fingerprint. The result is a separate, naturally labeled “导入版本” with its backup date; another restore of the same graph is skipped instead of creating another copy. Device clocks or modification times never select a silent winner.
- Restore does not interrupt the user with one dialog per conflict. After success, one conflict review list lets the user compare, edit, or explicitly delete retained versions.
- The entire restore commits atomically. Validation, capacity, or write failure leaves the local knowledge space unchanged rather than producing a partial import.
- For large archives, “atomically” means one user-visible commit rather than one unsafe archive-sized IndexedDB transaction. Validated rows may be written in bounded batches under an internal restore operation while remaining invisible to all ordinary reads.
- During restore, existing knowledge remains readable but knowledge saves, edits, deletes, source synchronization, full-text changes, another restore, and knowledge clear pause with “正在恢复知识库”. The operation does not freeze unrelated Bili-Bill views.
- After all streamed and cross-record validation succeeds, one small commit makes every staged result visible together and updates the exact full-text ledger. Background marker cleanup may continue afterward without changing visible results.
- Cancellation, malformed input, capacity or quota refusal, and pre-commit worker interruption clean only invisible staged rows, with cleanup itself resumable from a committed checkpoint. The selected file handle is not retained, so source reading never silently resumes after worker loss; another attempt requires a fresh user-selected file. The pre-restore knowledge space remains unchanged and no partial imported item appears.
- The ZIP implementation is not selected by this product decision. Its implementation gate must verify package and runtime size, bounded-memory export and restore near the 500-MiB full-text boundary, license compatibility, malformed-archive defenses, cancellation cleanup, and Chrome MV3 Browser QA before release.
- Every supported backup format retains fixed full and lightweight fixtures covering first restore, repeated idempotent restore, same-identity conflict retention, unsupported newer version, malformed migration input, capacity refusal, and zero-write rollback.
- A blocking near-limit restore gate additionally covers cancellation during every stage, disk/quota failure, extension reload, MV3 worker interruption, staged-row invisibility, resumable cleanup, atomic visibility, and post-commit readback at close to 500 MiB.
- Restore, backup export, search rebuild, and full-text-ledger repair share one text-free active-operation journal. It retains only bounded lifecycle, lock, progress, checkpoint, fingerprint, and recovery fields; it never retains a selected file name, path, handle, archive body, source text, or raw runtime error, and it is deleted after success or completed cleanup.
- Restore is exclusive with other maintenance work. Backup export may coexist only with the independently generated search index; capacity-ledger repair blocks retained-full-text changes. All conflicts are refused before work begins with natural Chinese state rather than relying on best-effort cancellation.
- Restore never imports excluded sessions, temporary source caches, audio, transcription models, indexes, synchronized relationships, account data, configuration, or credentials. Complete source texts present in a full backup are restored as 全文资料 and remain non-current evidence until revalidated.
- A backed-up complete text with the same video, exact part, language, source type, source variant, body, and timeline as a local full-text material is skipped without creating a duplicate.
- When that stable source scope matches but the body or timeline differs, the local version remains active and the distinct backup version is retained as a read-only historical “备份版本（备份日期）”. A later restore of the same distinct historical version is skipped.
- A backup-only complete text is restored with the visible state “来自备份，待核对”. Historical and unvalidated backup versions remain readable and locally searchable but cannot support new AI answers or current factual citations until exact source revalidation succeeds.
- Restore never chooses a full-text winner from modification time, backup time, or device clock. Revalidation may mark one version current later, but does not delete the other version automatically.
- A managed-full-text UUID conflict is rewritten deterministically from the original UUID and exact source-version fingerprint. Identical source scope, body, and timeline are skipped even when UUIDs differ; rewritten bytes are recomputed before capacity admission.
- Full restore preflight includes the resulting managed-full-text usage. When it would exceed 500 MiB, the user may choose “仅恢复知识内容” to atomically restore durable assets and evidence snapshots without any backed-up full text, or cancel; restore does not import an arbitrary partial subset of full texts.
- A true replacement requires the user to complete the separately confirmed knowledge-clear operation first and then restore. Ordinary restore itself offers no replace-all option.

## 19. Accepted Whole Knowledge-Space Clear

- Settings provides the explicit destructive action “清空知识库”. It is separate from ordinary session-history, temporary-source-cache, synchronized-source, settings, and all-local-data controls.
- The operation removes all durable 知识资产, user-authored titles, notes and tags, 证据快照, multi-source links, every 全文资料, imported conflict versions, and video-entry shells that remain only because of the deleted personal knowledge.
- It also removes or rebuilds every local search or optional vector index entry derived from deleted knowledge or full-text material so removed personal text cannot remain searchable.
- It does not delete ordinary 问答会话 history, temporary source caches for active videos outside the knowledge space, favorites, watch-later or watch-history relationships, account source relationships, settings, AI configuration, API keys, login state, or unrelated Bili-Bill module data.
- Retained favorite, watch-later, or other source relationships may recreate lightweight 视频条目 after synchronization. Those entries do not restore deleted notes, excerpts, full-text material, source states, or personal edits.
- Before confirmation, the interface states the number of notes, bookmarks, saved excerpts or answers, complete source texts, and their total storage size. It clearly states which local categories remain and that synchronized source entries may reappear. “先导出备份” is the recommended first action.
- Continuing requires the user to type “清空知识库”. The operation cannot be undone in place; only a prior 知识库备份 can restore removed knowledge and backed-up full texts.
- Clear commits atomically and invalidates pending knowledge saves and restore writes before deletion begins. A late request cannot recreate cleared knowledge after completion.
- The existing generic clear operation becomes “重置 Bili-Bill（保留知识库）”. Its scope preview and completion message explicitly state that every 个人知识数据 and 完整文本数据 record remains.
- Reset may clear ordinary module data, local settings, temporary caches, and 知识检索索引. Retained knowledge regenerates the index after reset, with a natural “正在重建检索” state rather than appearing empty or deleted.
- Version 14 exposes no combined “clear everything” action. A user who intends to remove both ordinary local data and the knowledge space performs the two separately scoped operations; this avoids claiming an atomic result across unrelated browser storage and the atomic knowledge transaction.
- Space management also allows the user to remove one video's 全文资料 without deleting its related knowledge assets or evidence snapshots.
- Space management lists current and historical full-text usage separately enough for the user to remove a selected historical version without deleting the current version, related knowledge assets, or evidence snapshots.
- Local-data reporting separates 个人知识数据, 完整文本数据, and 知识检索索引. These categories must not be collapsed into one count or one generic clear handler.
- 个人知识数据 contains durable assets, their user-authored fields, asset-source relationships, and evidence versions. It is removable only per asset or through the atomic typed-confirmation 清空知识库 transaction.
- 完整文本数据 contains current, historical, imported, and pending-revalidation full-text versions plus their time-aligned segments. It is managed only through 空间管理, and removal preserves durable assets and evidence snapshots.
- 知识检索索引 contains only rebuildable search, tag-suggestion, and optional semantic-index data. It may be cleared and rebuilt independently and cannot retain the only copy of personal text or evidence.

## 20. Accepted Knowledge-Base Information Architecture

- The Dashboard sidebar replaces the top-level “智能收藏” destination with “知识库”. The product does not expose two overlapping destinations for preserving and finding video-related material.
- Existing Smart Favorites synchronization, folder organization, classification, and index diagnostics remain available inside the knowledge base under 收藏来源. This is a navigation and domain-boundary migration, not a deletion or reset of synchronized source data.
- 全局知识检索 is the single search surface across personal knowledge, available full text, and video information. The old collection-only search does not remain as a parallel product entry; source-management filters may still narrow the 收藏来源 view locally.
- A legacy `#smart-favorites` route redirects to the knowledge base's 收藏来源 view so old bookmarks do not fail or expose an empty removed page.
- Existing Smart Favorites records are interpreted as source relationships and lightweight 视频条目. They do not become durable 知识资产 merely because the navigation moved.
- 动态账单 and 视频盲盒 remain independent top-level views with their existing purposes. The knowledge base does not absorb interest rebalancing or blind-box exploration.
- The knowledge base has three fixed primary views. 已保存知识 is the default and contains durable notes, bookmarks, excerpts, and saved answers; 视频资料 contains video entries and managed complete texts; 收藏来源 contains synchronized favorite source management and the former Smart Favorites capabilities.
- 视频资料 defaults to descending 知识库活动时间 with normalized `bvid` as a stable tie-breaker. This is a deterministic local maintenance order, not video recommendation or predicted-interest ranking.
- A video's knowledge-library activity time is initialized when it first enters the local space and changes only when related durable knowledge is saved, edited, or deleted, or managed full text is admitted, accepted, or removed. Metadata refresh, source verification, repeated synchronization, and another source relationship to an existing video do not bump it.
- Restore rebuilds that order from retained valid original activity timestamps and never writes the restore wall-clock time across all imported videos.
- 全局知识检索 remains visible above all three views. Submitting a query replaces the current view body with one unified result list across personal knowledge, video text, and video information, while each result states its matched layer in natural Chinese.
- 空间管理 opens from a secondary action in the knowledge-base header. Storage usage, per-video full-text removal, backup, restore, conflict review, and 清空知识库 do not occupy a fourth primary content tab.
- 已保存知识 does not introduce a knowledge-folder tree in 0.14. Its default list is ordered by most recently edited and provides fixed type filters for notes, bookmarks, excerpts, and saved answers.
- The user may further narrow saved knowledge by related video, 知识标签, and evidence state. One asset may have several local user-authored tags, and those tags are preserved in backup and restore.
- Bilibili favorite folders remain source organization inside 收藏来源. They do not automatically become knowledge tags or folders, and moving a favorite between source folders does not reorganize or delete a durable knowledge asset.
- A 知识资产 stores its own normalized tag text values rather than UUID references to a durable tag table. Within one asset, values are trimmed, compared case-insensitively for duplicates, and retain natural user-visible wording.
- The tag list used for filtering and input suggestions is a rebuildable aggregation over current assets. It is excluded from backup and may be regenerated without changing asset tags.
- 0.14 edits tags per asset and does not provide global tag rename, merge, or deletion. Removing the last use of a tag therefore requires no orphan-tag cleanup.

## 21. Accepted Knowledge-Asset Editing Boundary

- Every durable 知识资产 separates 用户整理内容 from a read-only 证据层. The interface never presents captured source material and editable personal interpretation as one undifferentiated text field.
- The user may edit an asset's title, personal note, and 知识标签. A pure user note also has an editable body.
- Editing provides explicit “保存” and “取消” actions. Save atomically replaces only the asset's current 用户整理内容; cancel writes nothing.
- 0.14 does not retain a product-visible revision history for titles, note bodies, personal annotations, or tags. A prior knowledge backup may recover an older copy through the accepted conflict-preserving restore flow, but it appears as a separate imported asset rather than an edit-history revision.
- Saved source wording, including Bilibili subtitles and any future completed local transcript, preserved answer wording, source video, exact part, time range, source state, and citation relationships remain read-only after capture.
- 已保存知识 uses a desktop master-detail layout: the stable knowledge list remains on the left while the selected asset opens on the right. In a narrow viewport, detail occupies the view and provides an ordinary back action.
- Title, personal note, and tags edit in place but remain a local draft until the user chooses “保存”. A failed save states that the draft remains on the current page and offers retry; navigation with unsaved changes requires discard confirmation rather than hidden autosave.
- The evidence section remains visibly separate and read-only, showing natural source video, exact part, time range, captured wording, and current source state without raw identifiers.
- A source mapping that is genuinely wrong is corrected through “重新定位来源”. The user searches an existing video, chooses a part, selects one continuous passage or time range from available complete text, and previews the new source, exact wording, and timing before confirmation.
- Confirmation creates a new immutable evidence version and switches the selected relation's current-evidence pointer while preserving the prior read-only mapping as 已更正 in the asset's evidence history. Directly editing visible evidence text or a hidden identifier never changes the mapping.
- A 多来源知识资产 relocates only the selected citation. The operation never replaces every source relationship as a side effect.
- When exact complete text is unavailable, relocation is refused rather than approximated. The user may first obtain Bilibili subtitle text, use completed local-transcript text only if that capability is available in the release, or separately copy 用户整理内容 into a new personal note related to the selected whole video but carrying no evidence snapshot, while leaving the original asset unchanged.
- Deleting an asset remains an explicit confirmed action and does not mutate its related video's source relationships or other assets.

## 22. Accepted Knowledge-View States

- 已保存知识 uses distinct note, bookmark, excerpt, and saved-answer icons and names as its primary identity, with related video sources as secondary information. It never uses a generic video card for every asset.
- When no durable asset exists, 已保存知识 states “还没有已保存知识” and offers the direct commands “打开最近视频” and “查看收藏来源”. It does not miscount lightweight source entries as saved knowledge.
- An asset whose source changed shows “依据已变化”; a restored unvalidated source shows “来自备份，待核对”. A failed user edit states “保存失败，内容仍保留在本页” and offers retry without exposing a raw storage error.
- 视频资料 leads with video identity and source coverage. A source-only entry with neither durable asset nor full text shows “仅有视频信息”; an admitted video without full text shows “暂无完整文本”.
- 收藏来源 keeps an `avid`-only legacy record visible as “视频信息待补全” with a retryable synchronization action. It does not count that record as a canonical knowledge-space video, expose a raw missing-identifier field, or silently drop it from migration totals.
- When a Bilibili subtitle track is not yet readable because it still requires user action on the video page, the view states “需要先在 B 站视频页开启字幕” and offers “打开视频” rather than claiming that no subtitle exists.
- Retained complete text in 0.14.0 shows “完整文本已保存 · B站字幕”. “完整文本已保存 · 本地转录” appears only in a future release that has actually shipped local transcription. A restored unvalidated text offers “打开视频核对”.
- A changed available subtitle shows “字幕有更新，待确认” with compare and confirm actions. A retained former version is labeled “历史版本” and never appears as the current text merely because it is newer than another backup copy.
- At the 500-MiB boundary, 视频资料 displays the page-level state “全文空间已满，知识仍可保存” with “空间管理”. It does not repeat one raw error card for every video.
- 收藏来源 distinguishes “尚未同步收藏来源”, a real synchronization progress state, “同步未完成，可重试”, and the successful empty state “当前来源没有可用视频”. A failed refresh preserves prior synchronized data and never exposes a raw runtime or network error.
- States use both familiar icons and text and do not rely on color alone. 知识资产, 视频资料, and 收藏来源 use visibly different row structures so their domain boundaries remain scannable.

## 23. Accepted Release Slicing

### 0.14.0-alpha: Personal knowledge foundation

- Upgrade `BiliAnalyticsDB` from version 13 to version 14 through one deterministic Dexie transaction that creates the knowledge-space tables, canonicalizes eligible existing favorite videos, and writes 升级前收藏来源 relationships. Failure rolls back the complete version upgrade and preserves the version-13 database for retry.
- Eligible favorites are sorted and merged deterministically from validated legacy fields. Latest valid sync/favorite data supplies non-empty display fields, minimum and maximum source times establish lifecycle bounds, and no migration result depends on IndexedDB iteration order or the upgrade wall clock.
- Valid legacy folder IDs retain their exact folder scope. A valid-BVID item with no valid folder uses “升级前未分组收藏”; invalid or missing BVID rows remain only in existing favorites as “视频信息待补全”. Version 13 has no eligible watch-later source table, so migration creates no fabricated watch-later relationship.
- The version-14 upgrade neither clears nor rewrites `favoriteFolders`, `favoriteItems`, `smartFavoriteIndex`, `currentVideoTranscriptSources`, or `currentVideoTranscriptSegments`. It performs no network request, AI call, subtitle acquisition, full-text promotion, or other externally dependent work.
- No existing current-video transcript cache row is promoted during migration, including rows whose internal `persistent` flag is true. A favorite-derived canonical video still requires a later explicit knowledge save or user-driven subtitle retrieval while viewing that admitted video before exact current text may be copied into managed full-text storage.
- The upgrade canonicalizes only legacy favorite rows that already contain a valid `bvid`; `avid`-only rows remain untouched and visible as “视频信息待补全” until later authorized source work resolves them.
- Rebuildable global-search and suggestion indexes run only after the database opens successfully, through bounded resumable work that may pause, fail, clear, or retry without changing canonical videos or durable knowledge. Their completion is not used to claim that the core migration itself failed.
- When the core migration cannot complete, the knowledge-base entry states “知识库升级未完成，可重试” without exposing a raw Dexie error or automatically clearing local data.
- Ordinary UI never maps the current-video cache's internal `persistent` value to “已保存”, “全文已保存”, or another durable-knowledge claim.
- Introduce the local knowledge-space schema, one-or-more video source links, durable knowledge assets, evidence snapshots, retained Bilibili-subtitle 全文资料, a future-compatible complete-text source type, a unified full-text capacity guard, and required migration and privacy-category boundaries.
- Replace the top-level Smart Favorites entry with Knowledge Base, preserve its synchronization capabilities under 收藏来源, redirect the legacy route, and migrate existing records without promoting them to durable knowledge.
- Present account-unscoped migrated favorites naturally as “升级前收藏来源”. Do not expose an internal migration code or imply that the currently active account supplied those records.
- Preserve existing Smart Favorites classification and index diagnostics as rebuildable 收藏分类 data. Do not convert generated summaries, paths, keywords, aliases, model fields, or failure state into personal tags, notes, evidence, or backup content.
- Create lightweight video entries from authorized favorite and watch-later source relationships without equating those relationships with watched, understood, or durable knowledge.
- Support user notes, timestamp bookmarks, explicitly saving existing validated highlights or answers, native context-menu selection saving inside Bili-Bill answers and Bilibili-subtitle views, and secondary whole-turn saving. Do not surface unavailable local-transcription controls or copy.
- Provide the 已保存知识, 视频资料, and 收藏来源 views, persistent global local hybrid search, per-video related knowledge, natural matched-layer labels, and safe opening or timestamp preview, confirmation, and return.
- Provide durable-knowledge usage reporting, full or lightweight compressed backup, non-destructive restore, conflict review, per-video full-text management, and independently confirmed whole knowledge-space clear.
- Keep the existing current-video AI assistant behavior and authorization intact. Its validated output may be saved, but 0.14.0 does not automatically include other knowledge-base sources in an answer.
- Use a data model that can represent multi-source assets from the start, while deferring new cross-video AI generation and its visible authorization controls.

### 0.14.1-alpha: Cross-video knowledge questions

- Add single-input local evidence-scope routing across the current video, personal knowledge space, or both.
- Add the separately granted knowledge-base AI authorization, selected-source full-text requests, directly relevant personal knowledge context, and materially large request warnings.
- Add source-bounded cross-video retrieval-augmented answers, exact multi-source citation validation, transparent evidence-scope labels, and multi-source answer saving.
- Select no more than five exact source scopes per request, support source replacement, and apply the 512-KiB complete-text confirmation without context-window discovery or silent truncation.
- 0.14.1 builds on the observed storage, search, save, backup, and restore behavior of 0.14.0 rather than coupling those foundations to the first cross-video model call.

### Follow-up validation, not release dependencies

- Local vector semantic retrieval remains an independent technical and quality validation.
- External Skill or MCP access remains an optional adapter for future external assistants.
- Arbitrary Bilibili page text clipping remains outside the scoped Bili-Bill answer and transcript selection flow.
- Local ASR requires a fresh, independent technical gate before any later 0.14.x implementation. The gate must validate an on-device model and pinned artifact, model/runtime license, extension packaging and download strategy, required permissions and CSP, audio acquisition, MV3 lifecycle ownership, long-video progress and cancellation, memory and CPU pressure, time-aligned coverage, failure cleanup, privacy, and Chrome browser QA. It must not use a remote transcription fallback.
- TrainPal provides useful prior art for 16-kHz mono PCM preparation, time-aligned final results, retry classification, explicit start, bounded task states, cancellation, FFmpeg cleanup, and honest complete/partial/insufficient coverage. Its Ark/豆包 ASR service path does not satisfy Bili-Bill's on-device privacy or extension-runtime gate.
- Only a passing local-ASR gate may create a later 0.14.x implementation issue. Until then, the future source type remains a compatibility contract rather than a user-visible capability.

### Blocking validation before runtime implementation

- Global full-text search must first pass the deterministic synthetic-fixture foundation and the separately reviewed public-safe Bilibili-subtitle distribution calibration, then pass the Chrome MV3 feasibility gate before its runtime issue begins. Synthetic fixture success alone does not establish representativeness. The candidate gate uses the calibrated distribution plus deterministic 100-, 400-, and 500-MiB fixtures and compares at least an IndexedDB lexical index with one proven chunk-persistable search library.
- It measures build and resume duration, peak memory, persisted index size, cold and warm Chinese/English query latency, cancellation, add/remove updates, rebuild, result integrity, and service-worker restart recovery. Vector or semantic indexing remains optional and cannot be required for a pass.
- On the recorded release-QA machine and Chrome build, initial indexing must finish within 3 minutes at 100 MiB, 12 minutes at 400 MiB, and 15 minutes at 500 MiB; peak JavaScript-heap growth must remain within 256 MiB; and persisted index size must remain within 1.5 times source bytes.
- At 500 MiB, warm-query p95 must be at most 500 ms and cold-query p95 at most 2 seconds. Every fixed deliberately planted target must be found, and a completed source removal must leave none of its text searchable.
- Indexing keeps individual UI-main-thread blocks within 200 ms, acknowledges cancellation within 1 second and stops new writes within 2 seconds, resumes after worker interruption by redoing at most one checkpoint batch, and updates one added or removed 1-MiB source within 10 seconds.
- Missing metrics, integrity failures, or success only on smaller fixtures are `insufficient_evidence`, not a pass.
- A failed gate returns the accepted 500-MiB capacity or global-full-text search scope to product review. The implementation cannot silently degrade to title-only search or scan hundreds of MiB of source text per query.

## 24. Interaction Still To Resolve

The 0.14.0 and 0.14.1 product decisions now have bounded interaction contracts. No product decision remains open; only development-readiness work remains below.

## 25. Development-Readiness Gates

### Development-readiness closure

1. **Static contract closed:** the durable and auxiliary fields, source reconciliation, byte ledger, canonical fingerprints, backup format v1, deterministic restore conflicts, and v13-to-v14 migration are frozen in the linked architecture contracts. The rebuildable search store and measured batch sizes intentionally remain gate outputs rather than guessed schema.
2. **Next blocking gate:** execute the storage, search, ZIP, restore, and Blob-fallback matrix in [the gate contract](./architecture/gate-contract-0.14-storage-search-and-backup.md). Validate the 400-MiB warning and 500-MiB hard boundary with public-safe realistic Chinese subtitle fixtures and synthetic future-compatible local-transcript fixtures; fixture compatibility does not claim an ASR runtime, and contradictory evidence returns to product review rather than silently changing the contract.
3. Write final acceptance criteria and a browser/mock QA matrix covering privacy, account switching, migration, save/edit/delete, search, navigation confirmation, capacity, backup/restore, and failure states.
4. Decompose the accepted scope into dependency-ordered issues and draft-PR review gates, then obtain a neutral first-principles review before runtime implementation begins.
