# Bili-Bill 动态账单开发方案

## 1. 当前代码基线

现有插件已经具备以下可复用能力：

- Chrome MV3 background service worker。
- B 站 API client，包含登录态、限流、超时、WBI 回退。
- Dexie IndexedDB 本地仓库。
- 观看历史同步和播放器事件采集。
- 智能收藏夹的数据同步、AI 索引、自然语言搜索、短批次生成流程。
- Dashboard 和 popup 的消息协议。
- OpenAI-compatible AI 配置和请求函数。

当前缺口：

- 没有关联关注关系的数据表。
- 没有动态/关注更新同步。
- 没有动态账单规则引擎。
- Dashboard 旧 UI 与动态账单原型视觉语言不一致。

## 2. 开发原则

- API 优先，DOM 采集只作为 fallback。
- 数据同步和 AI 生成分离。
- 本地规则决定入选，AI 只负责摘要和解释。
- 上传给 AI 的数据最小化。
- 第一版只覆盖已关注 UP 的视频投稿动态。
- 不写回 B 站关注关系，不直接取关。
- 先跑通无 AI 账单，再接 AI 解释。
- 旧页面只做品牌外壳统一，不做深度重构。

## 3. 技术 Spike

### 3.1 动态视频投稿接口验证

目标：确认能否稳定获取最近 7 天内已关注账号的视频投稿动态。

需要验证：

- 登录态是否可复用现有 `biliGet`。
- 分页方式。
- 是否支持仅视频类型过滤。
- 返回字段是否包含 UP mid、UP 名称、bvid、avid、标题、简介、封面、发布时间、动态发布时间。
- 是否能区分图文、转发、直播等非视频投稿并过滤。
- 请求频率和限流表现。

候选方向：

- B 站 Web 动态页使用的动态 feed 接口。
- 若 API 不稳定，再评估 content script 从动态页提取视频投稿 DOM 的 fallback。

输出：

- `docs/spikes/dynamic-feed-api.md`
- 最小可运行脚本或临时调试记录。
- 是否进入正式实现的结论。

### 3.2 关注关系接口验证

目标：确认能否获取关注 UP 列表及已关注时间。

需要验证：

- 当前登录用户 mid 获取是否可复用现有 nav 接口。
- 关注列表分页方式。
- 关注时间字段是否存在，字段名和单位是什么。
- 互关、特别关注、分组等场景是否影响关注时间语义。
- 是否能得到 UP face、name、mid、sign 等基础信息。

候选方向：

- B 站关系接口。
- 社区接口资料中出现的 `mtime` 字段必须实测确认。

输出：

- `docs/spikes/following-api.md`
- 字段语义和降级策略。

## 4. 数据模型

新增类型文件：

- `src/shared/types/dynamic-bill.ts`

建议核心类型：

```ts
export type DynamicBillColumn = '久违更新' | '换换口味' | '被淹没的关注';
export type DynamicBillStatus = 'unopened' | 'opened' | 'consumed' | 'processed';

export interface FollowedCreator {
  mid: number;
  name: string;
  face: string;
  sign: string;
  followedAt?: number;
  followAgeKnown: boolean;
  syncedAt: number;
}

export interface FollowedVideoUpdate {
  updateKey: string;
  dynamicId: string;
  bvid: string;
  avid: number;
  title: string;
  intro: string;
  cover: string;
  duration: number;
  pubtime: number;
  dynamicTime: number;
  authorMid: number;
  authorName: string;
  tagName: string;
  tags: string[];
  syncedAt: number;
}

export interface DynamicBillEvidence {
  longWindowText: string;
  recentWindowText: string;
  reason: string;
  balanceScore: number;
  facts: string[];
}

export interface DynamicBillExplanation {
  summary: string;
  reason: string;
  viewingAngle: string;
  keywords: string[];
  confidence: number;
  model: string;
  generatedAt: number;
  status: 'generated' | 'failed';
  error?: string;
}

export interface DynamicBillItem {
  billKey: string;
  column: DynamicBillColumn;
  status: DynamicBillStatus;
  updateKey?: string;
  creatorMid: number;
  historyBvids: string[];
  evidence: DynamicBillEvidence;
  localRank: number;
  openedAt?: number;
  consumedAt?: number;
  processedAt?: number;
  generatedAt: number;
}

export interface DynamicBillFeedback {
  id?: number;
  scope: 'creator' | 'topic';
  key: string;
  label: string;
  reason: 'not_interested' | 'stale_follow' | 'wrong_topic';
  createdAt: number;
}
```

### 4.1 Dexie 表

新增数据库版本，建议 `version(4)`：

- `followedCreators`: `&mid, followedAt, syncedAt`
- `followedVideoUpdates`: `&updateKey, dynamicId, bvid, authorMid, dynamicTime, pubtime, syncedAt`
- `dynamicBillItems`: `&billKey, column, status, creatorMid, updateKey, generatedAt, localRank`
- `dynamicBillExplanations`: `&billKey, status, generatedAt, model`
- `dynamicBillFeedback`: `++id, [scope+key], scope, key, createdAt`

保留策略：

- `followedVideoUpdates` 默认保留 14-30 天即可。
- `dynamicBillItems` 可保留 30-90 天用于回看和状态追踪。
- `followedCreators` 保留完整快照，下一次同步做 upsert 和缺失标记，不直接删除历史关系时间。

## 5. API 与同步模块

新增模块：

- `src/background/api/dynamic.ts`
- `src/background/api/following.ts`
- `src/background/dynamic-bill/sync.ts`
- `src/background/storage/dynamic-bill-repo.ts`

同步流程：

1. 获取当前用户登录态。
2. 同步关注关系快照。
3. 同步最近动态视频投稿。
4. 对动态视频补全 `/x/web-interface/view` 详情，复用现有 `batchFetchVideoInfo`。
5. 写入本地 `followedCreators` 和 `followedVideoUpdates`。
6. 不在每次动态同步后自动跑 AI。

失败策略：

- 未登录：返回可解释状态，不刷红错误。
- 动态接口失败：保留旧账单，提示“动态同步失败”。
- 关注时间不可用：记录 `followAgeKnown=false`，账单解释降级。
- 视频详情补全失败：保留动态接口原始字段，不阻断同步。

## 6. 规则引擎

新增模块：

- `src/background/dynamic-bill/rules.ts`
- `src/background/dynamic-bill/windows.ts`
- `src/background/dynamic-bill/highlights.ts`
- `src/background/dynamic-bill/feedback.ts`

输入：

- 最近 7 天 `followedVideoUpdates`。
- 长期观看窗口记录。
- 近期观看窗口记录。
- 关注关系。
- 本地负反馈。

输出：

- `DynamicBillItem[]`
- 每个账单项包含本地证据、栏目、排序、历史代表视频 bvid 列表。

### 6.1 阈值策略

自适应为主，固定下限兜底。

建议先集中放在：

- `src/background/dynamic-bill/strategy.ts`

配置示例：

```ts
export const DYNAMIC_BILL_STRATEGY = {
  longWindowDays: 180,
  recentWindowDays: 30,
  updateWindowDays: 7,
  minCreatorPositiveViews: 3,
  maxHighlightsPerItem: 3,
  maxItemsPerColumn: 20,
};
```

具体阈值在实现中保持集中可调，不进用户设置。

### 6.2 久违更新规则

候选条件：

- 长期窗口内该 UP 达到正反馈下限。
- 近期窗口明显下降或没有观看。
- 动态窗口内该 UP 有新视频。
- 负反馈未屏蔽该 UP。

排序方向：

- 历史正反馈更强优先。
- 冷却时间更长优先。
- 已关注时间更长优先。
- 新视频越新可适度加权。

### 6.3 换换口味规则

候选条件：

- 长期窗口中某分区/标签占比稳定。
- 近期窗口中同分区/标签占比明显下降。
- 动态窗口内出现该分区/标签新投稿。
- 负反馈未屏蔽该主题。

排序方向：

- 长期-近期落差更大优先。
- 该视频来自非近期高频 UP 可适度加权。
- 历史代表视频完播率高优先。

### 6.4 被淹没的关注规则

候选条件：

- UP 有关注关系。
- 已关注时间较长，或关注时间未知但在关注列表中稳定存在。
- 近期窗口中该 UP 缺席或近乎缺席。
- 动态窗口内该 UP 有新视频。
- 不要求强历史正反馈。

排序方向：

- 已关注时间更长优先。
- 最近缺席时间更长优先。
- 同 UP 被多次负反馈时降权，并触发取关提示。

### 6.5 历史代表视频

只从本地观看历史选择。

优先级：

1. 同 UP 下长期窗口内完播率高的视频。
2. 同 UP 下观看时长高的视频。
3. 同 UP 下重复观看或近期以前高互动的视频。

排除：

- 最近 30 天看过的视频。
- 当前新视频本身。
- 缺少标题或 bvid 的异常记录。

## 7. AI 解释

新增模块：

- `src/background/dynamic-bill/ai.ts`

复用：

- `src/background/ai/openai-compatible.ts`
- `UserConfig.ai`
- 智能收藏夹的短批次 UI 轮询模式。

AI 输入：

- 入选账单项的新视频元数据。
- UP 主名称和已关注时间。
- 历史代表视频标题和完播摘要。
- 本地证据事实。
- 栏目名称。

AI 输出：

```ts
{
  "summary": "一句话摘要",
  "reason": "为什么进入此栏目",
  "viewingAngle": "建议观看角度",
  "keywords": ["关键词"],
  "confidence": 0.82
}
```

失败策略：

- AI 失败不影响账单项展示。
- 展示本地证据和视频标题。
- `dynamicBillExplanations.status='failed'`，允许重试。

## 8. 消息协议

更新：

- `src/shared/types/messages.ts`
- `src/background/messages/handlers.ts`

新增 actions：

- `GET_DYNAMIC_BILL_OVERVIEW`
- `SYNC_DYNAMIC_UPDATES`
- `GENERATE_DYNAMIC_BILL`
- `BUILD_DYNAMIC_BILL_EXPLANATIONS`
- `GET_DYNAMIC_BILL_ITEMS`
- `MARK_DYNAMIC_BILL_OPENED`
- `MARK_DYNAMIC_BILL_PROCESSED`
- `ADD_DYNAMIC_BILL_FEEDBACK`

响应类型：

- `DynamicBillOverview`
- `DynamicSyncResult`
- `DynamicBillGenerateResult`
- `DynamicBillExplanationResult`
- `DynamicBillItemView[]`

## 9. 状态推进

打开新视频：

1. 用户点击动态账单中的打开新视频。
2. 写入 `openedAt`，状态变为 `opened`。
3. 打开 B 站视频页。

确认消费：

1. 后台历史同步或播放器事件发现同 bvid 有有效观看。
2. 将状态从 `opened` 或 `unopened` 推进为 `consumed`。
3. 写入 `consumedAt`。

手动处理：

1. 用户点击标记已处理。
2. 状态变为 `processed`。
3. 不等同于 `consumed`。

## 10. 负反馈与取关提示

负反馈入口：

- 少提醒这个 UP。
- 少提醒这个主题。

本地影响：

- creator scope 反馈降低或屏蔽该 UP 的账单项。
- topic scope 反馈降低或屏蔽相关分区/标签账单项。

取关提示：

- 同一 UP 多次负反馈后，在详情页显示提示。
- 提示只提供打开 UP 主页和暂不处理。
- 提示文案强调只检查关注关系，不暗示插件会直接取关。
- 不提供插件内取关。

## 11. Dashboard 与 UI

### 11.1 新页面

新增：

- `dashboard/modules/dynamic-bill/DynamicBillPage.tsx`

参考原型：

- `../dynamic-bill-prototype/src/App.tsx`
- `../dynamic-bill-prototype/src/mock.ts`
- `../dynamic-bill-prototype/src/styles.css`

页面结构：

- 顶部状态区。
- 兴趣再平衡摘要。
- 状态筛选：未打开、已打开、已消费、已处理。
- 三栏账单板。
- 详情面板。
- 负反馈和处理操作。

真实实现注意：

- 三栏数据量大时需要限制每栏默认数量。
- 可先做“显示更多”，后续再虚拟滚动。
- 移动端单列展示，详情作为选中卡片下方或独立区域。
- 原型里的“未消费”筛选文案不能直接沿用；真实实现必须区分“未打开”和“已消费”。
- 原型锁定的是 Bili-Bill shell、顶部状态、兴趣再平衡摘要、三栏账单板、卡片详情主从结构和关键操作入口；精确配色、mock 指标、toast 文案和右侧 sticky 详情位置只作为设计参考。

### 11.2 品牌外壳刷新

必须同版本完成：

- `dashboard/App.tsx` 改为 Bili-Bill shell。
- `dashboard/components/TabBar.tsx` 替换或改造为侧边栏导航。
- Dashboard 默认首页 v1 继续保留现有总览，动态账单作为一级入口。
- 统一浅色主题、卡片、按钮、状态标签、字体层级。
- 旧页面放入新 shell，但不重构内部指标逻辑。

建议新增共享组件：

- `dashboard/components/AppShell.tsx`
- `dashboard/components/SideNav.tsx`
- `dashboard/components/SegmentedControl.tsx`
- `dashboard/components/StatusPill.tsx`
- `dashboard/components/MetricCard.tsx`

### 11.3 Popup

第一版最小改造：

- 品牌名改为 Bili-Bill。
- 增加动态账单入口和未打开数量。
- 不做完整 popup redesign。

## 12. 配置变更

更新：

- `src/shared/types/config.ts`

变更：

- `DEFAULT_CONFIG.retentionDays` 从 90 调整到 180。
- 老用户配置不自动覆盖。

可新增配置：

```ts
dynamicBill: {
  enabled: boolean;
  autoSync: boolean;
  updateWindowDays: number;
}
```

第一版不需要开放复杂阈值给用户。

## 13. 开发里程碑

### Milestone 0：文档与原型确认

- PRD 完成。
- 开发方案完成。
- 原型通过。
- ADR 和 `CONTEXT.md` 已记录关键决策。

### Milestone 1：接口 Spike

- 验证动态 feed API。
- 验证关注关系 API。
- 明确字段和降级策略。
- 输出 spike 文档。

退出标准：

- 能拿到最近关注视频投稿，或确认必须走 DOM fallback。
- 能拿到关注关系，或确认已关注时间不可用时的降级方案。

### Milestone 2：数据模型与仓库

- 新增 shared types。
- 新增 Dexie version。
- 新增 repo 方法。
- 新增消息类型空壳。

退出标准：

- typecheck 通过。
- 能写入和读取 mock 动态账单数据。

### Milestone 3：动态与关注同步

- 实现关注关系同步。
- 实现动态视频投稿同步。
- 视频详情补全。
- Dashboard 可显示同步状态。

退出标准：

- 登录用户可同步真实或 mock 动态视频投稿。
- 非视频投稿被过滤。
- 未登录、接口失败有可解释状态。

### Milestone 4：本地规则账单

- 实现三个栏目规则。
- 实现历史代表视频选择。
- 实现负反馈对规则的影响。
- 不接 AI，先展示本地证据。

退出标准：

- 可生成三个栏目。
- 每个账单项有证据事实。
- 规则结果可通过本地数据解释。

### Milestone 5：Dashboard 页面与品牌外壳

- 实现动态账单页面。
- 接入新 Bili-Bill shell。
- 旧页面外壳统一。
- Popup 加入口。

退出标准：

- 原型主流程在真实项目中可用。
- 状态筛选使用未打开、已打开、已消费、已处理四种文案。
- 新旧页面视觉不割裂。
- 移动端基本可用。

### Milestone 6：AI 解释

- 实现账单项 AI 解释生成。
- 短批次处理。
- 失败可重试。
- AI 配置复用。

退出标准：

- AI 成功时显示摘要和解释。
- AI 失败时仍展示本地证据。
- 不上传完整历史和完整关注列表。

### Milestone 7：状态与反馈闭环

- 打开视频标记 `opened`。
- 历史/播放器事件确认后标记 `consumed`。
- 支持 `processed`。
- 支持少提醒 UP/主题。
- 支持取关提示。

退出标准：

- 状态筛选正确。
- 反馈后后续生成结果受影响。
- 不直接取关。

### Milestone 8：QA 与发布准备

- 构建验证。
- 权限验证。
- 真实账号小样本测试。
- 老用户配置迁移测试。
- 数据不足和接口失败测试。

退出标准：

- `npm run typecheck` 通过。
- `npm run build` 通过。
- Dashboard 动态账单主流程可用。
- 隐私边界符合 PRD。

## 14. 验证清单

基础：

- 未登录时不崩溃。
- 没有关注数据时显示空状态。
- 没有动态视频投稿时显示空状态。
- 本地历史不足 180 天时显示提示。
- AI Key 缺失时仍能生成无 AI 账单。

规则：

- 久违更新不等同于最新视频列表。
- 换换口味来自长期-近期分区/标签落差。
- 被淹没的关注不要求强观看历史。
- 负反馈会降低或屏蔽对应 creator/topic。

状态：

- 点击打开视频后变成已打开。
- 有有效观看记录后变成已消费。
- 标记已处理不等于已消费。
- 未打开不显示为未消费。
- 默认视图不被已处理项占满。

隐私：

- AI 请求不包含完整观看历史。
- AI 请求不包含完整关注列表。
- AI 请求不包含 Cookie 或用户个人资料。

UI：

- 桌面三栏和详情面板可用。
- 窄屏/移动端单列可用。
- 旧页面外壳与动态账单视觉一致。
- 按钮文本不换行到不可读状态。

## 15. 主要风险与缓解

### 动态 API 不稳定

缓解：

- 先做 spike。
- 保留 DOM fallback 方案。
- UI 显示最后成功同步时间。

### 关注时间不可用

缓解：

- `followAgeKnown=false`。
- 被淹没的关注降级为稳定关注关系和近期缺席。
- 解释中不展示虚假的关注时长。

### AI 成本和失败

缓解：

- AI 生成低频。
- 短批次。
- 失败后展示本地证据。
- 用户手动重试。

### 旧 UI 刷新拖大范围

缓解：

- 只刷新品牌 shell。
- 不重构旧页面内部指标。
- 深度 redesign 另开版本。

### 账单项过多

缓解：

- 每栏默认限制数量。
- 状态筛选。
- 显示更多。
- 后续再做虚拟滚动。

## 16. 建议文件清单

新增：

- `src/shared/types/dynamic-bill.ts`
- `src/background/api/dynamic.ts`
- `src/background/api/following.ts`
- `src/background/storage/dynamic-bill-repo.ts`
- `src/background/dynamic-bill/sync.ts`
- `src/background/dynamic-bill/rules.ts`
- `src/background/dynamic-bill/windows.ts`
- `src/background/dynamic-bill/highlights.ts`
- `src/background/dynamic-bill/feedback.ts`
- `src/background/dynamic-bill/ai.ts`
- `dashboard/modules/dynamic-bill/DynamicBillPage.tsx`
- `dashboard/components/AppShell.tsx`
- `dashboard/components/SideNav.tsx`
- `dashboard/components/SegmentedControl.tsx`
- `dashboard/components/StatusPill.tsx`
- `dashboard/components/MetricCard.tsx`

修改：

- `public/manifest.json`
- `src/shared/constants.ts`
- `src/shared/types/config.ts`
- `src/shared/types/messages.ts`
- `src/background/storage/db.ts`
- `src/background/messages/handlers.ts`
- `src/background/index.ts`
- `dashboard/App.tsx`
- `popup/App.tsx`
- `popup/styles/popup.css`
- `README.md`

文档：

- `docs/PRD-dynamic-bill.md`
- `docs/development-plan-dynamic-bill.md`
- `docs/spikes/dynamic-feed-api.md`
- `docs/spikes/following-api.md`
