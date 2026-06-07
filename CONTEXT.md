# Bili-Bill

Bili-Bill is the product context for a user-owned Bilibili content ledger. It gives the project one shared language for content consumption, saved content, and upcoming content decisions.

## Language

**Bili-Bill**:
The canonical product name for the whole browser extension. It frames the product as a personal Bilibili content ledger rather than only a data visualization plugin.
_Avoid_: BiliBili DataViz Plugin, B站消费数据中心, AI 关注收件箱 as the product name

**动态账单**:
The user-facing name for the AI-guided pre-consumption view of updates from followed Bilibili accounts. It helps the user decide what followed dynamic content is worth consuming before opening the original Bilibili feed or video.
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
An item shown inside 动态账单. It can center on a creator with representative videos, or on a new video submission with creator context.
_Avoid_: Treating every bill item as exactly one video card

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
A local user signal that a creator or topic should be shown less often in 动态账单. It can also reveal stale follow relationships that the user may want to clean up on Bilibili.
_Avoid_: Training data upload, writing back to Bilibili, platform-wide 不感兴趣

**取关提示**:
A suggestion that appears when repeated 负反馈 indicates a followed creator may no longer belong in the user's follow graph. It points the user to Bilibili for action rather than unfollowing automatically.
_Avoid_: Automatic unfollow, modifying Bilibili follow relationships

**久违更新**:
A 动态账单 column for new video submissions from creators the user historically consumed with meaningful engagement but has not watched recently.
_Avoid_: Simply newest updates from old creators

**换换口味**:
A 动态账单 column for new video submissions in long-term interests that have been under-consumed in the user's recent viewing pattern.
_Avoid_: Random exploration, unrelated recommendations

It is primarily based on the gap between long-term and recent Bilibili categories or tags, not AI-invented topic clusters.

**被淹没的关注**:
A 动态账单 column for new video submissions from creators with a durable 关注关系 that is absent or nearly absent from recent consumption. Unlike 久违更新, it does not require strong historical viewing engagement.
_Avoid_: All low-frequency creators, unvalidated followed accounts, duplicating 久违更新

**关注关系**:
The user's relationship to a Bilibili creator account they follow. It is distinct from historical consumption, because a user can follow a creator for a long time without recently watching them.
_Avoid_: Treating watched creators and followed creators as the same set

**已关注时间**:
The age of a 关注关系, used as a taste-memory signal for 动态账单. It can support long-term taste explanations but should not by itself prove current interest.
_Avoid_: Viewing age, creator age, account age

**长期观看窗口**:
The default 180-day watch-history window used to infer durable interests; if less local history exists, Bili-Bill uses all available local history.
_Avoid_: Lifetime history unless bounded by available local data

**近期观看窗口**:
The default 30-day watch-history window used to identify the user's current consumption pattern.
_Avoid_: Treating the current week alone as recent taste

**动态内容窗口**:
The default 7-day pool of followed video-submission updates considered by 动态账单.
_Avoid_: Unlimited dynamic archive

**Dashboard**:
The main Bili-Bill workspace where feature modules are surfaced as top-level views. It is the first home for 动态账单, though its overall information architecture is expected to evolve.
_Avoid_: Treating Dashboard as only a retrospective analytics panel

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

Domain expert: "Start with 久违更新, 换换口味, and 被淹没的关注. Additional columns can be added after these prove useful."

Developer: "Is every 动态账单 entry just a video?"

Domain expert: "No. A 账单项 may focus on a UP主 and include new or historical representative videos, or focus on a new video while still explaining the creator context."

Developer: "Does opening a new video count as consumption?"

Domain expert: "No. Opening creates 已打开; only watch history or player events can confirm 已消费. The user can also manually mark a bill item 已处理."

Developer: "Should 动态账单 learn when a user dislikes an old surfaced interest?"

Domain expert: "Yes, but only locally. Repeated 负反馈 can reduce future surfacing and may trigger a 取关提示, but Bili-Bill should not write back to Bilibili automatically."

Developer: "Can a creator be important even if the user has not watched them recently?"

Domain expert: "Yes. 已关注时间 is a separate taste-memory signal; long-followed creators can be worth resurfacing even when recent watch history is quiet."

Developer: "What time windows define 动态账单 by default?"

Domain expert: "Use 180 days for long-term watch history, 30 days for recent watch history, and 7 days for followed video submissions. Follow age should use the available relationship timestamp without truncation."
