# Bili-Bill 动态账单开发 Backlog

本文档把 `docs/PRD-dynamic-bill.md` 和 `docs/development-plan-dynamic-bill.md` 转成可发布到 GitHub Issues 的开发任务。当前先作为本地 PM backlog；GitHub 授权完成后，可按本文档逐条发布 issue。

## 已发布 GitHub Issues

- [#2 动态账单：验证动态 feed 与关注关系 API](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/2)
- [#3 动态账单：建立 Bili-Bill shell 与动态账单入口](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/3)
- [#4 动态账单：同步已关注 UP 与最近视频投稿](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/4)
- [#5 动态账单：生成本地证据版久违更新账单](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/5)
- [#6 动态账单：生成本地证据版换换口味账单](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/6)
- [#7 动态账单：生成本地证据版被淹没的关注账单](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/7)
- [#8 动态账单：实现账单项四态与筛选](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/8)
- [#9 动态账单：实现本地负反馈与取关提示](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/9)
- [#10 动态账单：接入 AI 摘要与解释 fallback](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/10)
- [#11 动态账单：发布前 QA 与 alpha 验证](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/11)

## 推进原则

- 动态账单完成后作为 Bili-Bill vNext 主线方向推进，但不直接覆盖 `main`。
- 建议新建分支：`codex/bili-bill-vnext`。
- 第一批任务先验证风险最高的接口和最小闭环，不一次性铺满所有增强项。
- 每个任务尽量是可独立验证的纵向切片，而不是单纯按前端、后端、数据表横向拆分。
- AI 只做摘要和解释；本地规则决定入选和排序。
- v1 不以点击率、观看时长或留存提升作为成功目标。

## 主线替代门槛

动态账单版本可以替代当前 GitHub 主线前，至少满足：

- `npm run typecheck` 通过。
- `npm run build` 通过。
- 观看历史、Dashboard、智能收藏夹没有核心回归。
- Bili-Bill 品牌名、manifest、README、Dashboard shell 完成统一。
- 动态账单可展示久违更新、换换口味、被淹没的关注三栏。
- 账单项具备本地证据事实，AI 不可用时仍可理解。
- 状态模型完整区分未打开、已打开、已消费、已处理。
- 负反馈使用“少提醒这个 UP/主题”，且不写回 B 站。
- 取关提示只打开 UP 主页或暂不处理，不提供插件内取关。
- AI 请求不包含完整观看历史、完整关注列表、Cookie、用户 mid 或个人资料。
- 至少完成一次真实账号小样本验证。

## Issue 1：验证动态 feed 与关注关系 API

Type: HITL

Blocked by: None - can start immediately

User stories covered:

- 用户希望动态账单只覆盖已关注 UP 的视频投稿动态。
- 用户希望已关注时间能作为长期品味线索，但不可用时仍有可信降级。

### What to build

验证 B 站动态 feed API 和关注关系 API 是否足够支撑动态账单 v1。输出 spike 文档，明确能否稳定获取最近 7 天关注视频投稿、关注 UP 列表、已关注时间字段，以及必要的 DOM fallback 方案。

### Acceptance criteria

- [ ] 输出 `docs/spikes/dynamic-feed-api.md`。
- [ ] 输出 `docs/spikes/following-api.md`。
- [ ] 明确动态 feed 是否能过滤或识别视频投稿动态。
- [ ] 明确关注列表是否包含已关注时间、字段单位和语义。
- [ ] 明确接口失败、限流、未登录时的降级策略。
- [ ] 给出是否进入 API-first 正式实现的结论。

## Issue 2：建立 Bili-Bill shell 与动态账单入口

Type: AFK

Blocked by: None - can start immediately

User stories covered:

- 用户希望整个扩展以 Bili-Bill 命名，而不是旧的 B站消费数据中心。
- 用户希望动态账单是 Dashboard 一级入口，但 v1 默认首页仍保留总览。

### What to build

建立 Bili-Bill vNext 的 Dashboard shell。动态账单作为一级导航入口出现，默认首页继续保留现有总览。旧页面进入新 shell，但不重构内部指标和信息架构。

### Acceptance criteria

- [ ] 插件主标题和 Dashboard shell 使用 Bili-Bill。
- [ ] Dashboard 默认首页仍为总览。
- [ ] 动态账单作为一级入口出现。
- [ ] 旧页面外壳与新动态账单视觉不割裂。
- [ ] 不重构旧分析页内部指标口径。
- [ ] Popup 至少出现 Bili-Bill 品牌名和动态账单入口位置。

## Issue 3：同步已关注 UP 与最近视频投稿

Type: AFK

Blocked by: Issue 1

User stories covered:

- 用户希望动态账单只基于已关注 UP 的视频投稿动态。
- 用户希望接口失败或未登录时看到可解释状态。

### What to build

实现关注关系快照和最近 7 天视频投稿动态同步。同步结果写入本地仓库，并在动态账单页面展示同步状态、最后成功同步时间和空状态。

### Acceptance criteria

- [ ] 能同步关注 UP 基础信息。
- [ ] 能同步最近 7 天关注视频投稿动态。
- [ ] 非视频投稿动态被过滤或不进入账单池。
- [ ] 关注时间不可用时记录为未知，不展示虚假时长。
- [ ] 未登录时页面不崩溃，并显示可解释状态。
- [ ] 动态接口失败时保留旧账单或显示同步失败状态。

## Issue 4：生成本地证据版久违更新账单

Type: AFK

Blocked by: Issue 3

User stories covered:

- 用户希望看到过去看过但近期冷却的 UP 的新投稿。
- 用户希望知道账单项为什么出现。

### What to build

实现久违更新栏目的本地规则账单。该栏目只展示长期观看窗口内有正反馈、近期明显冷却、且最近 7 天有新视频投稿的关注 UP。

### Acceptance criteria

- [ ] 久违更新不等同于最新视频列表。
- [ ] 每个账单项包含长期窗口和近期窗口证据事实。
- [ ] 排除近期已经看过的同一新视频。
- [ ] 已关注时间只能加权或辅助解释，不能单独决定入选。
- [ ] AI 未启用时仍可展示本地证据。

## Issue 5：生成本地证据版换换口味账单

Type: AFK

Blocked by: Issue 3

User stories covered:

- 用户希望发现长期喜欢但近期消费下降的主题。
- 用户希望动态账单不是随机探索或普通推荐流。

### What to build

实现换换口味栏目的本地规则账单。该栏目基于长期观看窗口和近期观看窗口之间的分区/标签落差，展示已关注 UP 在相关长期兴趣中的新投稿。

### Acceptance criteria

- [ ] 换换口味来自长期-近期分区或标签落差。
- [ ] 不使用 AI 自创主题簇决定入选。
- [ ] 每个账单项包含长期兴趣与近期下降的证据事实。
- [ ] 负反馈 topic 后，后续生成结果会降低或屏蔽对应主题。
- [ ] AI 未启用时仍可展示本地证据。

## Issue 6：生成本地证据版被淹没的关注账单

Type: AFK

Blocked by: Issue 1, Issue 3

User stories covered:

- 用户希望看见关注很久但最近几乎没看的 UP。
- 用户希望关注关系能作为品味记忆，但不被误当成观看兴趣。

### What to build

实现被淹没的关注栏目的本地规则账单。该栏目展示有关注关系、近期观看缺席或近乎缺席、且最近 7 天有新视频投稿的 UP；不要求强历史观看正反馈。

### Acceptance criteria

- [ ] 被淹没的关注不要求强历史观看正反馈。
- [ ] 已关注时间可用时参与排序和解释。
- [ ] 已关注时间不可用时使用“已关注，关注时长未知”降级文案。
- [ ] 不把所有低频 UP 都纳入栏目。
- [ ] 同 UP 多次负反馈后可触发取关提示。

## Issue 7：实现账单项四态与筛选

Type: AFK

Blocked by: Issue 4 or Issue 5 or Issue 6

User stories covered:

- 用户希望区分只是打开过和真正消费过。
- 用户希望可以手动处理账单项，但不把处理等同于消费。

### What to build

实现账单项状态推进和筛选。状态必须完整区分未打开、已打开、已消费、已处理。默认视图优先展示未打开和已打开，已消费和已处理可通过筛选查看。

### Acceptance criteria

- [ ] 点击打开新视频后状态变为已打开。
- [ ] 观看历史或播放器事件确认有效观看后状态变为已消费。
- [ ] 用户可手动标记已处理。
- [ ] 已处理不等同于已消费。
- [ ] 未打开不得显示为未消费。
- [ ] 状态筛选覆盖未打开、已打开、已消费、已处理。

## Issue 8：实现本地负反馈与取关提示

Type: AFK

Blocked by: Issue 7

User stories covered:

- 用户希望减少错误提醒，但不希望插件修改 B 站关注关系。
- 用户希望在旧关注可能失效时获得低压力检查入口。

### What to build

实现 creator/topic 两类本地负反馈，入口文案为“少提醒这个 UP”和“少提醒这个主题”。重复 creator 负反馈后显示取关提示，只提供打开 UP 主页和暂不处理。

### Acceptance criteria

- [ ] 负反馈只写入本地，不上传、不训练外部模型、不写回 B 站。
- [ ] creator 负反馈会降低或屏蔽对应 UP 的后续账单项。
- [ ] topic 负反馈会降低或屏蔽对应分区/标签的后续账单项。
- [ ] 取关提示不提供插件内取关。
- [ ] 取关提示文案不暗示 Bili-Bill 会替用户审判或修改关注关系。

## Issue 9：接入 AI 摘要与解释 fallback

Type: AFK

Blocked by: Issue 4 or Issue 5 or Issue 6

User stories covered:

- 用户希望快速理解视频内容和为什么它值得重新考虑。
- 用户希望 AI 不可用时动态账单仍可使用。

### What to build

接入 AI 摘要和解释生成。AI 只处理已入选账单项的必要视频元数据和紧凑证据事实，不参与入选或排序。AI 失败、未配置或用户未启用时，页面展示本地证据 fallback。

### Acceptance criteria

- [ ] AI 输出包含 summary、reason、viewingAngle、keywords、confidence。
- [ ] confidence 不参与入选或排序。
- [ ] AI 失败时账单项仍可展示。
- [ ] AI 请求不包含完整观看历史。
- [ ] AI 请求不包含完整关注列表。
- [ ] AI 请求不包含 Cookie、用户 mid 或个人资料。

## Issue 10：发布前 QA 与 alpha 验证

Type: HITL

Blocked by: Issue 2, Issue 3, Issue 4, Issue 5, Issue 6, Issue 7, Issue 8, Issue 9

User stories covered:

- 用户希望动态账单可信、可解释，并且不会越权处理关注关系。
- 项目需要判断 Bili-Bill vNext 是否可以替代当前主线。

### What to build

完成发布前 QA、隐私审计和小样本 alpha 验证。确认动态账单 v1 是否达到替代当前主线的门槛。

### Acceptance criteria

- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] 观看历史、Dashboard、智能收藏夹无核心回归。
- [ ] 三个账单栏目可在真实或足够接近真实的数据下生成。
- [ ] AI payload 审计通过。
- [ ] 小样本用户能理解“兴趣再平衡”而非“猜你喜欢”。
- [ ] 用户能说清至少一个账单项出现的原因。
- [ ] 负反馈和取关提示不让用户误解为插件会直接取关。

## 待发布 GitHub Issues 的顺序

1. Issue 1：验证动态 feed 与关注关系 API
2. Issue 2：建立 Bili-Bill shell 与动态账单入口
3. Issue 3：同步已关注 UP 与最近视频投稿
4. Issue 4：生成本地证据版久违更新账单
5. Issue 5：生成本地证据版换换口味账单
6. Issue 6：生成本地证据版被淹没的关注账单
7. Issue 7：实现账单项四态与筛选
8. Issue 8：实现本地负反馈与取关提示
9. Issue 9：接入 AI 摘要与解释 fallback
10. Issue 10：发布前 QA 与 alpha 验证
