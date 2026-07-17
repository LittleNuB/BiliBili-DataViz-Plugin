# Bili-Bill

Bili-Bill is the product context for a user-owned Bilibili content ledger. It gives the project one shared language for content consumption, saved content, and upcoming content decisions.

## Language

**Bili-Bill**:
The canonical product name for the whole browser extension. It frames the product as a personal Bilibili content ledger rather than only a data visualization plugin.
_Avoid_: BiliBili DataViz Plugin, B站消费数据中心, AI 关注收件箱 as the product name

**动态账单**:
The user-facing name for the evidence-guided pre-consumption view of updates from followed Bilibili accounts. Local rules make it usable on their own, while AI may optionally add summaries and explanations.
_Avoid_: AI 关注收件箱, 关注页优化, 动态页增强

**视频投稿动态**:
A followed-account update whose primary content is a Bilibili video submission. It is the only dynamic content type covered by the first version of 动态账单.
_Avoid_: 图文动态, 转发动态, 直播提醒, 专栏, 番剧追番提醒 for version one

**兴趣再平衡**:
The core purpose of 动态账单: helping users notice followed content that has fallen out of their recent consumption pattern. It is not an engagement-ranking system that predicts the videos a user is most likely to click.
_Avoid_: 猜你喜欢, 优先级排序, AI 推荐流

**账单栏目**:
A user-facing section in 动态账单 that explains a specific reason to reconsider a followed video submission. Each column should describe a rebalancing reason, not merely a content category.
_Avoid_: 标签分类, 普通分组, 推荐分区

**账单项**:
An item shown inside 动态账单 that represents one followed creator through that creator's newest unwatched submission in the current update window. A creator appears at most once in each generated bill.
_Avoid_: Repeating one creator across columns, creator-only entries without an actionable submission

**未打开**:
A 账单项 state meaning the user has not opened the surfaced new video from 动态账单.
_Avoid_: 未消费 when the item has never been opened

**已打开**:
A 账单项 state meaning the user opened the surfaced new video from 动态账单, but Bili-Bill has not confirmed meaningful viewing.
_Avoid_: Treating an opened video as consumed

**已消费**:
A 账单项 state meaning Bili-Bill has confirmed meaningful viewing through local watch history or player events.
_Avoid_: User clicked the link once

**已处理**:
A 账单项 state meaning the user manually dismissed or completed the bill item without requiring confirmed viewing.
_Avoid_: Equating manual handling with confirmed consumption

**负反馈**:
A local user signal created by “少提醒这个 UP”. It marks the current 账单项 已处理 and pauses that creator from every 动态账单 column for 30 days. The pause can be undone immediately or restored from Settings, expires automatically, and never changes the user's Bilibili follow relationship. Repeated signals may support a low-pressure 取关提示.
_Avoid_: permanent hidden ranking penalties, Training data upload, writing back to Bilibili, platform-wide 不感兴趣, changing the follow relationship

**取关提示**:
A one-time, low-pressure suggestion shown when the user completes “少提醒这个 UP” for the same creator for the third time. An immediately undone action does not count. The suggestion only offers opening the creator's Bilibili page or dismissing the prompt; it neither changes the current 30-day pause nor modifies the follow relationship. Its minimal local count and shown state are removed with all local data.
_Avoid_: repeated prompts, counting immediately undone actions, Automatic unfollow, modifying Bilibili follow relationships

**被淹没的关注**:
A 动态账单 column for new video submissions from creators with a durable 关注关系 that is absent or nearly absent from available recent consumption. It requires at least one credible 关注记忆证据 but does not require strong historical viewing engagement.
_Avoid_: All low-frequency creators, unvalidated followed accounts, long-history-only column

**收藏关联更新**:
A 动态账单 column for new submissions from followed creators whose earlier work appears in the user's locally synced Bilibili video favorites. Smart-favorite organization may explain the relationship but is not a separate source or an eligibility requirement.
_Avoid_: 冷门收藏, 收藏延伸推荐, treating every favorite as a ranking score

**关注轮换**:
A 动态账单 column that broadens coverage across the remaining recent submissions from followed creators after stronger rebalancing reasons are applied. It is a transparent breadth rotation, not engagement prediction or recommendation ranking.
_Avoid_: 猜你喜欢, 随机探索, click-probability ranking

**轮换记录**:
The minimal local memory of when a followed creator last appeared anywhere in 动态账单, used by every column to show unseen or least-recently-surfaced creators first. It is not viewing history, consumption evidence, or an interest score.
_Avoid_: 推荐画像, watched-creator history, engagement ranking signal

**关注关系**:
The user's relationship to a Bilibili creator account they follow. It is distinct from historical consumption, because a user can follow a creator for a long time without recently watching them.
_Avoid_: Treating watched creators and followed creators as the same set

**关注记忆证据**:
A fact showing that a 关注关系 has durable meaning beyond a current follow snapshot: known follow age, special-follow status, at least 30 days of continuous local observation, or a real local watch before the recent window. It supports 被淹没的关注 without becoming an interest score.
_Avoid_: Any current follow, inferred follow age, recommendation weight

**已关注时间**:
The age of a 关注关系, used as a taste-memory signal for 动态账单. It can support long-term taste explanations but should not by itself prove current interest.
_Avoid_: Viewing age, creator age, account age

**长期观看窗口**:
The intended 180-day watch-history window that may strengthen evidence when actual local coverage supports it. It is not a prerequisite for fixed product surfaces and never justifies claims beyond the history actually available.
_Avoid_: Lifetime history, treating all available recent history as a durable-interest window, feature unlock gate

**近期观看窗口**:
The default 30-day watch-history window used to identify the user's current consumption pattern.
_Avoid_: Treating the current week alone as recent taste

**可用证据策略**:
The unified rule that every surface keeps a stable user-facing structure and makes only claims supported by the evidence currently available. Longer history may reduce repetition, broaden coverage, or support factual time-range explanations, but it never unlocks or replaces surfaces or creates a positive recommendation score.
_Avoid_: 短历史模式, 标准模式, user-selected history mode, labeling seven-day behavior as durable interest

**视频盲盒**:
A low-pressure exploration surface that randomly draws from a bounded, disclosed candidate pool. It does not rank candidates by predicted engagement or present itself as Bilibili's recommendation feed.
_Avoid_: 猜你喜欢, 推荐排序, unexplained random inventory

**随机探索**:
A 视频盲盒 that randomly selects one openable seed from locally available recent watch records, discloses that seed, and then draws the final video only from its real Bilibili related-video candidates. The local record is only a query anchor, never the final inventory. If there is no usable seed or no real related candidate, the card reports that no candidate is available instead of substituting local history, favorites, or another blind-box source.
_Avoid_: 本地库存抽卡, silently changing candidate sources, using the seed as the final draw, 跨区漫游, opaque recommendation

**跨区漫游**:
A 视频盲盒 that randomly draws a real public video from a Bilibili category outside the user's recently dominant categories; without recent evidence, it discloses a randomly selected public category. It broadens exposure without claiming to eliminate an information bubble.
_Avoid_: 长期换口味, anti-bubble guarantee, personalized ranking

**冷门收藏**:
A local 视频盲盒 that resurfaces an infrequently revisited item already present in the user's local favorites. It is a collection revisit, not a real Bilibili candidate search.
_Avoid_: 真实 B 站探索, external candidate, 收藏延伸

**UP 主考古**:
A 视频盲盒 that randomly draws an older public submission from a followed creator's public archive. It excludes recent followed-account updates so it does not duplicate 动态账单.
_Avoid_: 久违更新, recent followed updates, local-history replay

**盲盒抽取记录**:
A bounded local list of the 50 most recently drawn Bilibili video identities shared by all four 视频盲盒 types. When a candidate pool contains other videos, recent draws are excluded before random selection; when every valid candidate is already in the list, drawing one again is allowed so deduplication never creates a false empty state. The record changes neither source eligibility nor candidate ranking and is removed with all local data.
_Avoid_: permanent exclusion, recommendation score, per-type hidden history, making a valid candidate pool look empty, a separate user-facing preference

**动态内容窗口**:
The default 7-day pool of followed video-submission updates considered by 动态账单.
_Avoid_: Unlimited dynamic archive

**Dashboard**:
The main Bili-Bill workspace where feature modules are surfaced as top-level views. It is the first home for 动态账单, though its overall information architecture is expected to evolve.
_Avoid_: Treating Dashboard as only a retrospective analytics panel

**辅助摘要**:
A full-primary-text AI overview of the active part. It presents the video's subject, content arc, and key points without displaying subtitle excerpts inline, and it is unavailable when no 主要文本来源 exists. It is displayed only as part of a combined summary-and-highlights result whose evidence mappings all validate against the current primary-text version.
_Avoid_: 字幕罗列, 引用片段列表, treating retrieved evidence as the summary, displaying a partially validated generation

**视频亮点**:
A small set of full-primary-text moments that capture the active part's key ideas, turning points, or demonstrations. Each highlight has a reliable time range mapped to the current primary-text version and supports preview, confirmed navigation, and return to the previous playback position. Any invalid highlight rejects the new combined summary-and-highlights result.
_Avoid_: 辅助知识节点, 完整章节目录, time points inferred only from metadata, keeping only the valid-looking parts of a failed generation

**当前视频问答**:
A full-primary-text answer about what the active video says, available only under 完整文本授权. It gives a direct answer before cited video fragments and declines when the active part's text cannot support the answer. Every citation must map to the active part, the current primary-text version, and a real time range; an answer with any invalid citation is rejected as a whole. General model knowledge is not video evidence.
_Avoid_: 关键词命中当回答, 只列引用片段, unmarked general-knowledge completion, showing an answer with unverifiable citations

**问答会话**:
A locally persisted question-and-answer timeline that can remain open while the user moves between videos. The user sees one ordinary conversation, its history, and the current reference video rather than a fixed main question or visible video branches. Every submitted turn captures the active video, part, and exact primary-text content version; its answer and citations remain bound to that captured evidence even after the page changes. Every validated answer carries a compact natural-language source line with the video title, part when relevant, and “B站字幕” or “本地转录”. The source line can open the corresponding video but never seeks directly; timestamp citations retain preview, confirmation, and return. Switching videos changes only the evidence used by the next submitted question and never sends a request or inserts a conversation message automatically. Earlier turns stay readable in the same timeline, while facts and citations from another video or an earlier text version cannot support a new current-video answer. A conversation begins when its first question is submitted, and a failed generation or validation remains one retryable logical turn without becoming conversation context. The session stores validated turns for later review but does not duplicate full video text or resend all stored history on every question.
_Avoid_: fixed main questions, user-visible video branches, video-switch system messages, automatically asking after a video switch, direct seeking from an answer source label, treating another video's answer as current evidence, adding duplicate turns for retries, using failed answers as conversation context, hiding an old text version behind a raw identifier, freezing the whole session after one video's text changes, duplicating full transcripts inside session storage, resending the entire stored conversation on every question

**对话脉络**:
A bounded, rolling summary used only while consecutive questions share the same active video, part, and exact 主要文本来源 identity. It helps same-evidence follow-up questions retain continuity but is not video evidence and cannot support an answer or citation by itself. When the video, part, or primary-text identity changes, the model-side context resets even though the locally visible 问答会话 timeline remains. It changes only after a newly generated answer and all of its citations have passed validation.
_Avoid_: treating conversation context as video evidence, carrying any context across a video/part/text-identity change, preserving unsupported model claims, updating context from a rejected answer

**字幕全文**:
A dedicated view of the active video's selected viewing text source, preserving its time alignment for reading, search, navigation, and export. It can show available Bilibili subtitle body text or a completed local transcript. The viewing source is independent from the 主要文本来源 used by the video assistant. “Available” Bilibili subtitles means readable body text has been obtained and matched to the active part; a subtitle that may exist or a detected track without body text is not yet available. It is an evidence surface, not part of the 辅助摘要.
_Avoid_: 在摘要中展开字幕证据, treating subtitle text as an AI summary, treating a detected subtitle track as usable body text, changing the video assistant source by browsing another subtitle source

**语音转录**:
A user-initiated conversion of the active video's audio into a separate, time-aligned text source that preserves the original spoken language. It remains available whether or not Bilibili subtitles exist, but never claims automatic superiority or silently replaces them. Translation, manual correction, and speaker diarization are separate derived capabilities, not part of 语音转录.
_Avoid_: 自动上传音频, silently overwriting Bilibili subtitles, treating transcription as already available, presenting translation as the speaker's original words, editing the generated transcript in place, treating TTS as speaker diarization

**本地转录**:
A form of 语音转录 performed on the user's device after explicit activation, with neither audio nor the generated text sent to a remote transcription service. If the result becomes the 主要文本来源, its text may be sent to the configured chat service only under 完整文本授权; audio always remains local.
_Avoid_: 远程转录降级, reusing a chat model as an audio model, background transcription without user action

**主要文本来源**:
The user-selected time-aligned text source used by 辅助摘要, 视频亮点, and 当前视频问答. It can be the available Bilibili subtitles or a completed local transcript and never changes silently; title and description may supplement it but never replace it.
_Avoid_: 自动覆盖原字幕, metadata-only video understanding, mixing unlabeled text sources

**完整文本授权**:
The permission represented by the single “当前视频 AI 助手” setting to send the active part's full 主要文本来源 to the configured chat service. Enabling it sends nothing by itself; generation and questions remain user-initiated, and turning it off stops new requests without deleting local results.
_Avoid_: Silent full-text upload, audio upload, cross-video context, treating provider capacity as guaranteed

## Flagged Ambiguities

**动态**:
In Bili-Bill, "动态" means Bilibili updates from followed accounts, not animation, visual motion, or generic activity logs.

**动态内容 scope**:
Version one of 动态账单 narrows dynamic content to 视频投稿动态 only. Other Bilibili dynamic types are intentionally out of scope until video guidance is validated.

## Example Dialogue

Developer: "Should this feature live under the old B站消费数据中心 name?"

Domain expert: "No. The product is Bili-Bill now; individual modules can describe their purpose, but the extension brand should be Bili-Bill."

Developer: "Is 动态账单 another analytics dashboard?"

Domain expert: "No. 动态账单 is shown before content consumption; it guides which followed updates are worth opening."

Developer: "Should 动态账单 replace the Bilibili dynamic page?"

Domain expert: "No. The first version belongs in the Bili-Bill Dashboard as a top-level view; the native Bilibili page remains the place where content is opened."

Developer: "Do we summarize every kind of Bilibili dynamic?"

Domain expert: "No. Version one only handles 视频投稿动态, because videos match the existing Bili-Bill content model."

Developer: "Should 动态账单 rank the videos the user is most likely to click?"

Domain expert: "No. Bilibili already optimizes for recent preference and engagement. 动态账单 should support 兴趣再平衡 by surfacing followed updates the user may have forgotten or under-consumed."

Developer: "Which columns belong in the first version?"

Domain expert: "Use 被淹没的关注, 收藏关联更新, and 关注轮换 as the stable columns. More history can strengthen their evidence, but it does not change the visible set."

Developer: "Is every 动态账单 entry just a video?"

Domain expert: "Each 0.13 账单项 focuses on one UP主 and one latest unwatched post from the current dynamic window. Historical videos may support the local evidence explanation, but cannot replace the new post or become the card's primary content."

Developer: "Does opening a new video count as consumption?"

Domain expert: "No. Opening creates 已打开; only watch history or player events can confirm 已消费. The user can also manually mark a bill item 已处理."

Developer: "Should 动态账单 learn when a user dislikes an old surfaced interest?"

Domain expert: "Yes, but only locally. Repeated 负反馈 can reduce future surfacing and may trigger a 取关提示, but Bili-Bill should not write back to Bilibili automatically."

Developer: "Can a creator be important even if the user has not watched them recently?"

Domain expert: "Yes. 已关注时间 is a separate taste-memory signal; long-followed creators can be worth resurfacing even when recent watch history is quiet."

Developer: "What time windows define 动态账单 by default?"

Domain expert: "Use 180 days for long-term watch history, 30 days for recent watch history, and 7 days for followed video submissions. Follow age should use the available relationship timestamp without truncation."
