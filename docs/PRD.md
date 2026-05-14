# B站个人消费数据中心 — 产品需求文档 (PRD)

## 项目信息

| 项目 | 详情 |
|------|------|
| 项目名称 | BiliBili DataViz Plugin |
| 产品形态 | Chrome Extension (Manifest V3) |
| 目标平台 | Chrome / Edge |
| GitHub | https://github.com/LittleNuB/BiliBili-DataViz-Plugin |

---

## 1. 产品定位

一个 Chrome 扩展，把 B站散落的用户行为数据（历史记录、收藏、投币、关注、播放时长等）聚合为**可读、可分析、可指导行为**的个人消费报告。

**核心假设**: 用户消费数据的透明化本身就能驱动行为改变。这个产品不是数据展示工具，而是一个"消费教练"——告诉你发生了什么（描述），意味着什么（诊断），可以怎么做（建议）。

**目标用户**: B站重度用户（日均观看 ≥30 分钟），对自身消费习惯有认知需求。

---

## 2. 用户场景

| 场景 | 用户诉求 | 解决方案 |
|------|----------|----------|
| 场景1 | 想知道这周在B站花了多少时间、主要看了什么 | 打开 Popup 看快速摘要 |
| 场景2 | 感觉自己最近看的视频类型变了 | 打开 Dashboard → 偏好分析 → 兴趣漂移折线图 |
| 场景3 | 想知道自己对哪些 UP 主形成了"深度绑定" | UP 主关系图谱 → 深度绑定徽章列表 |
| 场景4 | 想优化自己的观看习惯 | 实验与建议 → 每周优化建议 + 兴趣盲盒 |

---

## 3. 功能架构

### 模块 1: 消费总览（首页仪表盘）

5 个核心指标卡片 + 热力图，首屏不滚动即可看完。

| 指标 | 说明 | 可视化 |
|------|------|--------|
| 本周/本月观看时长 | 进度环展示，对比上周/上月变化百分比 | Gauge 环形图 |
| 视频完播率 | 平均观看进度%，低于 30% 标记为"速弃型" | Gauge 环形图 |
| 活跃时段热力图 | 一周 × 24 小时色块矩阵，一眼看出"B站生物钟" | Heatmap 热力图 |
| 连续签到天数 | 激励性指标，鼓励持续使用 | 数字卡片 |
| 消费效率分 | 综合指标：视频数 ÷ 总时长，定义"浏览型"还是"沉浸型" | 数字卡片 + 评分解释 |

### 模块 2: 内容偏好分析

- **分区分布** — 矩形树图（Treemap），按观看时长着色，一眼看出内容版图
- **偏好漂移追踪** — 过去 3 个月分区占比变化折线图。核心叙事："你的兴趣正在从 X 转向 Y"
- **视频时长偏好** — 柱状图，按 `<3min / 3-10min / 10-30min / 30min+` 分桶，判断"碎片型"或"长内容型"
- **标签兴趣图谱** — 从视频 tag 生成词云，一眼看出内容关键词

**洞察文案示例**: "你最近 30 天的知识区消费增长了 40%，游戏区下降了 15%——你的兴趣正在转移。"

### 模块 3: UP主关系图谱

- **TOP 10 UP 主消费排行** — 头像、名字、观看视频数、总时长、完播率
- **「深度绑定」标记** — 完播率 > 80% 且连续观看 ≥ 5 个视频，标记特殊徽章
- **新发现的 UP 主** — 本月首次观看列表，标记哪些后续又看了（留存），哪些只看了一次
- **「过度依赖」提示** — 某 UP 主占总时长 30%+ 时触发预警："你已经把 35% 的 B站时间给了 XX，试试这些同类型 UP 主？"

**产品洞察**: 用户对 UP 主的忠诚度不是均匀分布的，往往 3-5 个 UP 主占据 60% 以上的消费时间。

### 模块 4: 行为模式诊断

- **完播率分布直方图** — X 轴 = 观看进度区间（0-25% / 25-50% / 50-75% / 75-100%），Y 轴 = 视频数。完播率 < 25% 过高 → "你可能容易被封面/标题吸引但内容不符预期"
- **跳片行为分析** — 记录进度条拖拽行为。频繁跳过开头 → "你可能已经对标准开场白免疫"
- **连续观看模式** — "你平均每次打开 B站看 X 个视频，时长为 Y 分钟。周末 session 比工作日多 Z%"
- **决策速度** — "你从首页点进一个视频的平均浏览时间是 X 秒，低于/高于平均值"

每个指标采用 Spotify Wrapped 式的叙述风格，一句话解释数据对用户的意义。

### 模块 5: 实验与建议

- **「如果...会怎样」模拟器** — 基于消费数据做假设分析：
  - "如果你把刷短视频的 30% 时间用来看长视频，每月可以多看 X 个完整教程"
  - "如果你给 3 个新分区各 5% 的观看时长，可能会发现 XX 和 XX"
- **每周优化建议** — 系统自动生成：
  - "本周你跳过了 12 个视频的前 30 秒，试试主动选择想看的？"
  - "你已经追了 XX UP 主的 18 个视频但还没关注 Ta"
- **兴趣盲盒** — "根据你的偏好，本周推荐 3 个你从未看过的分区/UP 主"

---

## 4. UI 形态

| 触点 | 访问方式 | 功能 |
|------|----------|------|
| 工具栏 Popup | 点击扩展图标 | 快速摘要：今日时长、连续天数、效率分 + "打开完整面板"按钮 |
| 完整 Dashboard | Popup 按钮跳转独立页面 | 5 个模块完整数据，Tab 切换，B站风配色 |
| B站首页侧边栏 | 自动注入 B站首页右侧 | "本周消费小结"轻量卡片，点击展开详情 |

**设计语言**: 深色主题 + B站粉 (#FB7299) 为强调色，与 B站原生页面和谐共存。

---

## 5. 数据来源

| 数据 | 来源 | 说明 |
|------|------|------|
| 观看历史 | B站 API: `/x/web-interface/history/cursor` | 每 5 分钟增量拉取，首次安装全量回填 |
| 视频详情 | B站 API: `/x/web-interface/view` | 批量获取分类、标签、UP 主信息，缓存 12h |
| 播放行为 | Content Script 监听播放器事件 | play / pause / seek / ended / heartbeat |
| 本地累积 | IndexedDB + chrome.storage.local | API 历史受限（~1000条），本地持续累积形成完整数据 |

---

## 6. 面试叙事

面试官问"为什么做这个"，你可以说：

> "这个插件的核心假设是：**用户消费数据的透明化本身就能驱动行为改变**。我设计它的方法论是——不是做一个数据展示工具，而是做一个'消费教练'：告诉你发生了什么（描述），意味着什么（诊断），可以怎么做（建议）。
>
> 具体来说，我从三个层次设计了这个产品：
> 1. **数据层**: 聚合散落在B站的用户行为数据，形成统一的消费画像
> 2. **分析层**: 不只是展示数据，而是做'行为诊断'，比如识别'深度绑定 UP 主'、'兴趣漂移趋势'
> 3. **建议层**: 基于数据生成可行动的建议，比如'兴趣盲盒'、'如果...会怎样模拟器'
>
> 如果这个产品在 B站落地，可以驱动两个核心指标：**用户活跃天数**（通过连续签到和每周报告形成回访习惯）和**跨分区探索率**（通过兴趣盲盒和建议引导用户发现新内容）。
>
> 它与 B站 PM 工作中'洞察需求 → 设计实验 → 分析数据 → 迭代优化'的闭环是高度一致的。"

---

# 技术方案

## 7. 技术栈

| 层面 | 选择 | 理由 |
|------|------|------|
| 构建工具 | Vite + TypeScript | 多入口构建、Tree-shaking、优秀 TS 支持 |
| UI 框架 | Preact + @preact/signals | 3KB 体积、Signal 细粒度响应式，Popup 体积敏感 |
| 图表 | ECharts (模块化导入) | 原生支持所有图表类型（热力图/树图/词云/仪表盘），中文文档齐全 |
| 数据库 | Dexie.js (IndexedDB) | Promise API、复合索引、批量操作，适合时序行为数据 |
| 配置存储 | chrome.storage.local | 轻量 K-V，存放用户设置 |
| 包管理 | pnpm | 快速、磁盘高效 |

## 8. 项目目录结构

```
Bili-Plugin-dev/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   └── PRD.md
├── src/
│   ├── background/              # Service Worker
│   │   ├── index.ts             # 入口：注册 alarms + 消息监听
│   │   ├── api/                 # B站 API 封装
│   │   │   ├── client.ts        # HTTP 客户端（cookie 透传 + 重试）
│   │   │   ├── history.ts       # 历史记录 API
│   │   │   ├── video-info.ts    # 视频详情批量查询
│   │   │   ├── wbi-sign.ts      # WBI 签名算法
│   │   │   └── rate-limiter.ts  # Token bucket 限速器 (5 req/s)
│   │   ├── storage/
│   │   │   ├── db.ts            # Dexie Schema 定义
│   │   │   ├── watch-history-repo.ts
│   │   │   ├── aggregate-repo.ts
│   │   │   └── config-store.ts
│   │   ├── sync/
│   │   │   ├── scheduler.ts     # chrome.alarms 调度编排
│   │   │   ├── history-sync.ts  # 增量同步 + 去重
│   │   │   ├── initial-backfill.ts # 首次安装全量回填
│   │   │   └── dedup.ts
│   │   ├── analytics/
│   │   │   ├── engine.ts        # 分析编排器
│   │   │   ├── aggregator.ts    # 通用聚合框架
│   │   │   ├── metrics.ts       # 消费指标
│   │   │   ├── category.ts      # 内容偏好
│   │   │   ├── creator.ts       # UP 主关系
│   │   │   ├── behavior.ts      # 行为诊断
│   │   │   ├── scores.ts        # 效率评分
│   │   │   └── suggestions.ts   # 建议生成
│   │   └── messages/
│   │       └── handlers.ts      # 消息路由分发
│   │
│   ├── content/                 # Content Scripts
│   │   ├── player-monitor/
│   │   │   ├── index.ts         # 入口
│   │   │   ├── video-detector.ts # MutationObserver 检测 video 元素
│   │   │   ├── event-capture.ts # 媒体事件监听
│   │   │   └── heartbeat.ts     # 每 5s 进度快照上报
│   │   ├── sidebar-card/
│   │   │   ├── index.ts         # 首页侧边栏注入
│   │   │   ├── renderer.ts      # DOM 构建
│   │   │   └── styles.css
│   │   └── utils/
│   │       ├── page-detector.ts # URL 模式匹配
│   │       └── dom-utils.ts     # 安全 DOM 工具
│   │
│   ├── popup/                   # 工具栏弹窗
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── WatchTimeRing.tsx
│   │       ├── StreakBadge.tsx
│   │       ├── MiniHeatmap.tsx
│   │       ├── QuickStats.tsx
│   │       └── OpenDashboard.tsx
│   │
│   ├── dashboard/               # 完整面板
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── App.tsx
│   │   ├── modules/
│   │   │   ├── overview/        # 模块1：消费总览
│   │   │   ├── preference/      # 模块2：内容偏好
│   │   │   ├── creator/         # 模块3：UP主关系
│   │   │   ├── behavior/        # 模块4：行为诊断
│   │   │   └── experiments/     # 模块5：实验建议
│   │   └── components/          # 共享组件
│   │       ├── ChartContainer.tsx
│   │       ├── StatCard.tsx
│   │       ├── DateRangePicker.tsx
│   │       ├── LoadingSkeleton.tsx
│   │       ├── EmptyState.tsx
│   │       └── ErrorBoundary.tsx
│   │
│   └── shared/                  # 跨上下文共享
│       ├── types/
│       │   ├── watch-event.ts
│       │   ├── video-info.ts
│       │   ├── analytics.ts
│       │   ├── messages.ts
│       │   └── config.ts
│       ├── constants.ts         # 端点、颜色、分类映射
│       ├── utils/
│       │   ├── time.ts
│       │   ├── math.ts
│       │   ├── color.ts
│       │   └── format.ts
│       └── echarts/
│           ├── register.ts      # 按需导入 ECharts 模块
│           ├── theme.ts         # B站风暗色主题
│           └── options.ts       # 共享 chart option 工厂
```

## 9. 架构设计

### 9.1 通信架构

```
┌──────────┐  sendMessage  ┌───────────────┐  fetch + cookie  ┌──────────┐
│  Popup   │◄─────────────►│               │◄────────────────►│ B站 API  │
│ (Preact) │               │ Service Worker│                  │          │
└────┬─────┘               │  (background) │                  └──────────┘
     │ chrome.tabs.create  │               │
     ▼                     │  IndexedDB    │
┌──────────┐  sendMessage  │  Dexie.js     │
│ Dashboard│◄─────────────►│               │
│ (Preact) │               │  chrome       │
└──────────┘               │   .alarms     │
                           └───────┬───────┘
                                   ▲
┌──────────┐  chrome.runtime        │
│ Content  │──sendMessage───────────┘
│ Scripts  │  (PLAYER_EVENT)
│(vanilla) │
└──────────┘
```

### 9.2 数据流

```
采集                   存储                 处理                  展示
─────────────────────────────────────────────────────────────────────

B站 History API ──┐
                   ├──► watchHistory ──┐
Player Events ────┘   (IndexedDB)     │
                                      ├──► dailyAggregates ──► Popup
B站 Video API ────►  video cache      │   (IndexedDB)         Dashboard
                    (IndexedDB)       │                        Sidebar
                                      │
                    chrome.storage ───┘
                    (UserConfig)
```

1. **采集**: SW 每 5 分钟拉取 B站历史 API + Content Script 实时监听播放器事件
2. **存储**: watchHistory + playerEvents + dailyAggregates 三张表存 IndexedDB
3. **处理**: 增量聚合引擎按天计算所有指标，存入 dailyAggregates
4. **展示**: UI 发消息获取预计算数据，SW 即时返回

### 9.3 消息协议

```typescript
// Popup/Dashboard → Service Worker
type RequestAction =
  | 'GET_QUICK_STATS'      // Popup 快速摘要
  | 'GET_DASHBOARD_DATA'   // 模块1：消费总览
  | 'GET_PREFERENCE_DATA'  // 模块2：内容偏好
  | 'GET_CREATOR_DATA'     // 模块3：UP主关系
  | 'GET_BEHAVIOR_DATA'    // 模块4：行为诊断
  | 'GET_EXPERIMENT_DATA'  // 模块5：实验建议
  | 'SYNC_NOW'             // 强制立即同步
  | 'UPDATE_CONFIG'        // 更新用户设置

// Content Script → Service Worker
type ContentAction =
  | 'PLAYER_HEARTBEAT'     // 每 5s 进度快照
  | 'PLAYER_ACTION'        // play/pause/seek/complete
  | 'PAGE_NAVIGATION'      // 页面导航事件
```

### 9.4 分析引擎架构

```
src/background/analytics/
├── aggregator.ts     # 通用聚合：group-by by day, windowed aggregation
├── metrics.ts        # 消费指标：watchTime, completion, streak
├── category.ts       # 内容偏好：distribution, drift, buckets, tags
├── creator.ts        # UP主关系：ranking, deepBond, newCreator, overDependency
├── behavior.ts       # 行为诊断：sessions, completionDistribution
├── scores.ts         # 效率评分：weighted composite 0-100
├── suggestions.ts    # 建议生成：rule-based tips + blind box
└── engine.ts         # 编排器：统一入口，协调各模块
```

**数据依赖关系**:
```
watchHistory (raw) ──► metrics.ts ──► dailyAggregates (computed)
                    ├──► category.ts ──► DailyAggregate.categoryBreakdown
                    ├──► creator.ts  ──► DailyAggregate.creatorBreakdown
                    ├──► behavior.ts ──► DailyAggregate.{sessions,totalSeeks,...}
                    └──► scores.ts   ──► DailyAggregate.efficiencyScore

dailyAggregates ──► engine.ts ──► { QuickStats, DashboardOverview, ... }
                             ──► suggestions.ts ──► { WeeklyTip[], BlindBoxItem[] }
```

**效率分公式**:
```
efficiencyScore = (
  0.30 × normalizedCompletionRate +   // 完播率
  0.25 × categoryDiversityIndex +     // 分区多样性 (uniqueCategories / total watched)
  0.20 × streakContinuity +           // 连续观看天数 / 最大可能值
  0.15 × goalAchievement +            // 实际时长 / 目标时长
  0.10 × (1 - maxCreatorShare)        // 反过度依赖
) × 100
```

**分析触发时机**:
- `chrome.alarms` 每 60 分钟触发 `daily-aggregate` 任务
- 首次安装后立即触发初始聚合
- UI 请求时从 `dailyAggregates` 表读取预计算数据，按需做周/月汇总

### 9.5 关键设计决策

| 决策 | 说明 |
|------|------|
| Rate Limiting | Token bucket 5 req/s，video info 缓存 12h |
| WBI 签名 | 自适应：先无签名请求，403/400 时回退 WBI |
| SW 持久性 | chrome.alarms 最小 60s 间隔触发增量同步，避免 SW 超时 |
| 样式隔离 | BEM 命名 `bdc-*` 前缀，避免与 B站 CSS 冲突 |
| 隐私 | 全本地存储，无外部服务器，无遥测 |
| ECharts 打包 | 按需导入 Bar/Line/Pie/Treemap/Heatmap/Gauge + wordcloud，~250KB gzipped |
| 空状态 | 所有 UI 有空状态引导："去B站看几个视频后回来查看数据分析" |

## 10. 数据存储 Schema

### watchHistory 表

```typescript
interface WatchHistoryRecord {
  id?: number;              // 自增主键
  kid: number;              // B站历史记录 ID（去重）
  avid: number;             // AV 号
  bvid: string;             // BV 号
  cid: number;              // 分P ID
  title: string;            // 视频标题
  authorName: string;       // UP 主名称
  authorMid: number;        // UP 主 MID
  tagName: string;          // 主分类
  tags: string[];           // 全部标签
  viewAt: number;           // 观看时间戳
  progress: number;         // 观看进度（秒）
  duration: number;         // 视频时长（秒）
  actualCompletion: number; // 实际完播率（来自播放器事件，更精确）
  isFavorite: boolean;      // 是否已收藏
  business: string;         // archive / pgc / live
  syncedAt: number;         // 同步时间戳
}
// 索引: ++id, &kid, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt
```

### playerEvents 表

```typescript
interface PlayerEvent {
  id?: number;
  bvid: string;
  cid: number;
  eventType: 'play' | 'pause' | 'seek' | 'complete' | 'heartbeat' | 'ratechange';
  timestamp: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
  seekFrom?: number;
  seekTo?: number;
  tabId: number;
}
// 索引: ++id, [bvid+cid], eventType, timestamp
```

### dailyAggregates 表

```typescript
interface DailyAggregate {
  id?: number;
  date: string;                         // 'YYYY-MM-DD'（唯一）
  totalWatchTime: number;               // 总观看秒数
  videoCount: number;                   // 观看视频数
  avgCompletion: number;                // 平均完播率
  uniqueCreators: number;               // 不同 UP 主数
  uniqueCategories: number;             // 不同分区数
  sessions: number;                     // 观看会话数
  totalSeeks: number;                   // 跳片次数
  totalPauses: number;                  // 暂停次数
  avgDecisionTime: number;              // 平均决策时间（ms）
  categoryBreakdown: Record<string, number>;  // { 分区: 观看秒数 }
  creatorBreakdown: Record<string, number>;   // { UP主MID: 观看秒数 }
  durationBreakdown: Record<string, number>;  // { 时长桶: 视频数 }
  hourlyHeatmap: number[][];            // 24×7 热力图矩阵
  efficiencyScore: number;              // 效率分 0-100
}
// 索引: ++id, &date
```

### 效率分公式

```
efficiencyScore = (
  0.30 × normalizedCompletionRate +   // 完播率
  0.25 × categoryDiversityIndex +     // 分区多样性
  0.20 × streakContinuity +           // 连续观看天数
  0.15 × goalAchievement +            // 目标达成率
  0.10 × lowOverDependency            // 反过度依赖
) × 100
```

## 11. Chrome Extension 配置

### Manifest 权限

```json
{
  "manifest_version": 3,
  "name": "B站消费数据中心",
  "version": "1.0.0",
  "description": "分析你的B站观看习惯，提供个性化消费洞察",
  "permissions": [
    "cookies",
    "storage",
    "unlimitedStorage",
    "alarms",
    "tabs"
  ],
  "host_permissions": [
    "*://api.bilibili.com/*",
    "*://www.bilibili.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://www.bilibili.com/video/*"],
      "js": ["content/player-monitor.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://www.bilibili.com/"],
      "js": ["content/sidebar-card.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/index.html",
    "default_title": "B站消费数据"
  }
}
```

## 12. 实现阶段

### Phase 1: 基础骨架 + 数据采集（约 2 周） ✅

- [x] Vite 多入口构建 + TypeScript 严格模式
- [x] Manifest V3 声明 + 所有权限
- [x] Dexie 数据库 Schema（3 张表 + 复合索引）
- [x] B站 API 客户端（cookie 透传 + Token bucket 限速器 + 重试）
- [x] 历史记录增量同步（cursor 分页 + kid 去重 + 持久化）
- [x] 首次安装全量回填（分页拉取所有可用历史）
- [x] chrome.alarms 调度器（每 5 分钟同步，每天聚合）
- [x] 消息路由基础架构

### Phase 2: 分析引擎（约 1 周） 🔄

- [ ] 通用聚合框架（aggregator.ts: group-by + time-window）
- [ ] 消费指标计算（metrics.ts: watch time / completion / streak）
- [ ] 内容偏好分析（category.ts: distribution / drift / buckets / tags）
- [ ] UP 主关系分析（creator.ts: ranking / deep bond / new creator / over-dependency）
- [ ] 行为模式诊断（behavior.ts: sessions / completion distribution）
- [ ] 效率评分 + 建议生成（scores.ts + suggestions.ts）
- [ ] 编排器 + 集成（engine.ts + wires into index.ts + handlers.ts）

### Phase 3: Content Scripts（约 1 周）

- [ ] 播放器事件监听（MutationObserver → video 元素 → media events）
- [ ] 心跳上报（每 5 秒进度快照）
- [ ] 首页侧边栏卡片注入

### Phase 4: Popup UI（约 1 周）

- [ ] Preact + ECharts 集成
- [ ] 进度环、连续天数、快速统计、打开面板按钮
- [ ] B站深色主题 + 粉红强调色

### Phase 5: Dashboard（约 3 周）

- [ ] 模块 1：消费总览（Gauge 环 + 热力图 + 卡片）
- [ ] 模块 2：内容偏好（树图 + 折线图 + 柱状图 + 词云）
- [ ] 模块 3：UP主关系（排行柱图 + 徽章列表 + 预警提示）
- [ ] 模块 4：行为诊断（直方图 + 跳片分析 + Session 模式）
- [ ] 模块 5：实验建议（模拟器 + 建议卡片 + 盲盒）
- [ ] ChartContainer 封装 + DateRangePicker + Loading/Empty/Error 状态

### Phase 6: 打磨（约 1 周）

- [ ] 未登录/无数据状态处理
- [ ] API 错误降级 + 超时重试
- [ ] 数据导出（CSV/JSON）
- [ ] 类型检查零错误 + 基础单元测试

## 13. 风险与缓解

| 风险 | 概率 | 缓解措施 |
|------|------|----------|
| B站 API 变更/限流导致数据中断 | 高 | 抽象 API 客户端层；Token bucket 限速 5 req/s；video info 缓存 12h |
| WBI 签名需求扩展到更多端点 | 中 | 自适应签名层：先无签名请求，403/400 回退 WBI；mixin key 缓存 1h |
| Service Worker 超时终止中断同步 | 中 | chrome.alarms 分段处理，每 tick 处理 1 页 (30 条)；游标状态持久化 |
| Content Script 找不到 video 元素 | 中 | 多策略：MutationObserver 多容器 + 轮询 fallback (500ms×60次) |
| B站 SPA 导航不触发 content script 重新注入 | 低 | webNavigation.onHistoryStateUpdated 监听 + 条件重新注入 |
| 用户无观看历史 → 全部空白 | 低 | 所有 UI 组件有空状态引导 + 文案 |
| chrome.storage.local 5MB 溢出 | 低 | 已声明 unlimitedStorage；主数据在 IndexedDB |

---

## 14. 验证方案

### 功能验证

1. 安装扩展 → 打开 B站 → DevTools 确认 SW 开始拉取历史记录
2. 连续观看 3-5 个视频 → 确认 player-monitor 捕获事件并写入 IndexedDB
3. 打开 Popup → 确认快速摘要数据正确
4. 打开 Dashboard → 逐一验证 5 个模块的图表和数据
5. 切换日期范围 → 确认数据正确重载
6. 清除所有历史 → 确认 EmptyState 显示
7. 退出 B站登录 → 确认"未登录"状态提示

### 代码质量

- TypeScript `strict: true`，`tsc --noEmit` 零错误
- 所有 UI 组件的 Loading / Empty / Error 三态手动验证
- Chrome DevTools → Application → IndexedDB 验证 Schema 和数据完整性
- chrome.alarms 调度日志确认同步频率和成功率
