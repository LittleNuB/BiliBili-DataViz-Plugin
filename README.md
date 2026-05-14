# BiliBili DataViz Plugin

B站个人消费数据中心 — Chrome 扩展，聚合你的B站观看行为数据，提供可读、可分析、可指导行为的个人消费报告。

> **核心假设**: 用户消费数据的透明化本身就能驱动行为改变。这不是一个数据展示工具，而是一个"消费教练"——告诉你发生了什么（描述），意味着什么（诊断），可以怎么做（建议）。

---

## 目录

- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [安装指南](#安装指南)
- [使用说明](#使用说明)
- [开发指南](#开发指南)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [常见问题](#常见问题)

---

## 功能概览

### 模块 1: 消费总览

了解你在B站的时间投入。

| 指标 | 说明 |
|------|------|
| 本周/本月观看时长 | 进度展示，对比上周/上月变化百分比 |
| 平均完播率 | 低于 30% 标记为"速弃型" |
| 活跃时段热力图 | 24 小时 × 7 天的色块矩阵，一眼看出你的"B站生物钟" |
| 连续签到天数 | 激励性指标，鼓励持续使用 |
| 消费效率分 | 0-100 综合评分，定义你是"浏览型"还是"沉浸型"用户 |

### 模块 2: 内容偏好分析

追踪你的兴趣变化轨迹。

- **分区分布** — 饼图，按观看时长着色，一眼看出内容版图
- **兴趣漂移追踪** — 过去 3 个月分区占比变化折线图
- **视频时长偏好** — 柱状图，判断你是"碎片型"还是"长内容型"
- **标签兴趣图谱** — 视频 tag 词云，直观展示内容关键词

### 模块 3: UP主关系图谱

理解你与创作者的互动模式。

- **TOP 10 排行** — 按观看时长排序，显示视频数、完播率
- **深度绑定标记** — 完播率 > 80% 且连续观看 ≥ 5 个视频
- **新发现 UP 主** — 本月首次观看的创作者，标记留存情况
- **过度依赖预警** — 某 UP 主占总时长 30%+ 时触发提醒

### 模块 4: 行为模式诊断

发现你的观看习惯。

- **完播率分布** — 直方图，揭示你是"完播党"还是"跳片党"
- **Session 模式** — 每次打开 B站看多少个视频、多长时间
- **工作日 vs 周末** — 消费时段差异分析
- **高峰时段** — 一天中你最活跃的时间

### 模块 5: 实验与建议

基于数据生成可行动的建议。

- **每周优化建议** — 自动生成个性化建议（如"你跳过了很多视频的前 30 秒"）
- **兴趣盲盒** — 推荐从未看过的分区/UP 主，打破信息茧房

---

## 技术栈

| 层面 | 选择 | 说明 |
|------|------|------|
| 构建 | Vite 6 + TypeScript 5 | 多入口构建、ES2022 target |
| UI | Preact 10 + @preact/signals | ~3KB 运行时，Signal 细粒度响应式 |
| 图表 | ECharts 5（模块化） | Gauge/Heatmap/Pie/Line/Bar/Treemap/WordCloud |
| 数据库 | Dexie.js 4 (IndexedDB) | Promise API、复合索引、批量操作 |
| 存储 | chrome.storage.local | 用户配置持久化 |
| 平台 | Chrome Extension Manifest V3 | Service Worker + Content Scripts |

---

## 安装指南

### 前置条件

- Chrome 浏览器（或 Edge）最新版
- Node.js ≥ 18
- 一个 B站 账号（需要登录状态才能拉取观看历史）

### 步骤 1: 构建扩展

```bash
# 克隆仓库
git clone https://github.com/LittleNuB/BiliBili-DataViz-Plugin.git
cd BiliBili-DataViz-Plugin

# 安装依赖
npm install

# 生产构建
npm run build
```

构建产物在 `dist/` 目录。

### 步骤 2: 加载到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions` 回车
2. 打开右上角 **「开发者模式」** 开关
3. 点击左上角 **「加载已解压的扩展程序」**
4. 选择项目的 `dist/` 文件夹
5. 扩展卡片出现「B站消费数据中心」即为安装成功

### 步骤 3: 验证安装

1. 打开 [B站首页](https://www.bilibili.com) 并登录
2. 浏览器右上角工具栏会出现 B站粉色的扩展图标
3. 点击图标 → 弹出 Popup 窗口，显示加载中或数据

---

## 使用说明

### 第一次使用

1. **登录 B站**：扩展依赖 B站 的登录 Cookie 来拉取你的观看历史。请先在浏览器中登录 [bilibili.com](https://www.bilibili.com)。
2. **等待首次同步**：安装后，扩展会自动同步你最近的观看历史（最多约 1000 条）。首次同步可能需要 1-2 分钟。
3. **继续正常使用 B站**：扩展每 5 分钟自动增量同步你的最新观看记录。数据会持续累积在本地。

### 查看消费数据

**快速摘要（Popup）：**
- 点击浏览器工具栏的 B站粉色图标
- 弹出窗口显示：今日观看进度环、连续天数、本周观看时长、效率评分
- 点击底部「查看完整面板 →」按钮打开详细面板

**完整仪表盘（Dashboard）：**
- 通过 Popup 按钮或直接打开 `chrome-extension://[扩展ID]/dashboard/index.html`
- 顶部 5 个标签切换：**总览 / 偏好 / UP主 / 行为 / 实验**
- 每个标签页展示对应的数据图表和洞察

**首页侧边栏（自动注入）：**
- 打开 B站首页，右侧栏会出现「本周消费小结」卡片
- 显示今日观看时长、连续天数、效率评分
- 点击「查看完整面板 →」跳转到 Dashboard

### 数据导出

1. 打开 Dashboard
2. 顶部标题下方有 **「导出 JSON」** 和 **「导出 CSV」** 按钮
3. 点击对应按钮，浏览器会自动下载你的观看历史数据
4. CSV 格式包含：BV号、标题、UP主、分区、观看时间、进度、时长、完播率

### 数据隐私

- **所有数据存储在浏览器本地**（IndexedDB），不会上传到任何外部服务器
- 扩展仅通过 HTTPS 直接从浏览器访问 B站 API，不经过第三方
- 随时可以通过 Chrome 扩展管理页面删除扩展来清除所有数据

---

## 开发指南

```bash
# 安装依赖
npm install

# 开发模式（watch 自动重构建）
npm run dev

# 类型检查
npm run typecheck

# 生产构建
npm run build
```

### 构建输出

| 输出文件 | 说明 |
|----------|------|
| `dist/background.js` | Service Worker（~118KB） |
| `dist/popup/` | 工具栏弹窗（Preact App） |
| `dist/dashboard/` | 完整面板（Preact App） |
| `dist/content/player-monitor.js` | 播放器事件监听 |
| `dist/content/sidebar-card.js` | 首页侧边栏卡片 |
| `dist/chunks/theme-*.js` | ECharts 共享分包（~720KB） |

### 开发调试

```
npm run dev                    # watch 模式，改动自动构建
```

构建后，在 `chrome://extensions` 点击扩展卡片的刷新按钮即可加载最新代码。

**Service Worker 调试：** `chrome://extensions` → 点击「Service Worker」链接打开 DevTools

**Content Script 调试：** 在 B站 页面按 F12 → Console 标签查看 `[BiliViz]` 前缀的日志

**IndexedDB 检查：** DevTools → Application → IndexedDB → `BiliAnalyticsDB`

---

## 项目结构

```
Bili-Plugin-dev/
├── docs/
│   └── PRD.md                   # 产品需求文档
├── public/
│   ├── manifest.json            # Chrome Extension Manifest V3
│   └── icons/                   # 扩展图标 (16/32/48/128px)
├── scripts/
│   └── generate-icons.cjs       # 图标生成脚本
├── src/
│   ├── background/              # Service Worker
│   │   ├── api/                 # B站 API 客户端 + 限速器 + WBI签名
│   │   ├── sync/                # 历史同步 + 首次回填 + 去重
│   │   ├── analytics/           # 分析引擎（8个模块）
│   │   ├── storage/             # Dexie DB Schema + Repos
│   │   └── messages/            # 消息路由分发
│   ├── content/                 # Content Scripts
│   │   ├── player-monitor/      # 播放器事件捕获 + 心跳
│   │   ├── sidebar-card/        # 首页侧边栏渲染
│   │   └── utils/               # DOM工具 + 页面检测
│   ├── popup/                   # Popup UI (Preact)
│   │   ├── components/          # ProgressRing / QuickStats / OpenDashboard
│   │   ├── utils/messaging.ts   # SW 消息封装
│   │   └── signals.ts           # 响应式状态
│   ├── dashboard/               # Dashboard UI (Preact)
│   │   ├── components/          # ChartContainer / StatCard / TabBar / ...
│   │   └── modules/             # 5个分析模块页
│   └── shared/                  # 跨上下文共享
│       ├── types/               # TypeScript 类型定义
│       ├── echarts/             # ECharts 注册 + 主题 + 预设
│       └── utils/               # 工具函数 (time/math/color/format)
├── popup/                       # Popup 入口 (HTML + TSX)
├── dashboard/                   # Dashboard 入口 (HTML + TSX)
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 架构设计

```
┌──────────┐  sendMessage  ┌───────────────┐  fetch+cookie  ┌──────────┐
│  Popup   │◄─────────────►│               │◄──────────────►│ B站 API  │
│ (Preact) │               │ Service Worker│                │ Servers  │
└────┬─────┘               │  (background) │                └──────────┘
     │tabs.create          │               │
     ▼                     │  IndexedDB    │
┌──────────┐  sendMessage  │  Dexie.js     │
│Dashboard │◄─────────────►│               │
│ (Preact) │               │  chrome.alarms│
└──────────┘               └───────┬───────┘
                                   ▲
┌──────────┐  sendMessage           │
│ Content  │──PLAYER_EVENT─────────┘
│ Scripts  │
└──────────┘
```

**数据流**: B站 API → 历史同步（每5分钟）→ IndexedDB → 分析引擎（每60分钟聚合）→ UI 按需查询

---

## 常见问题

### Q: Popup 显示"加载中..."一直转？

A: 需要先在浏览器中登录 B站。打开 [bilibili.com](https://www.bilibili.com) 并登录你的账号，然后重新点击扩展图标。

### Q: Popup 显示"请先登录B站账号"？

A: 同上，登录 B站 后即可。

### Q: Dashboard 图表显示空白？

A: 可能是尚未同步到数据。确认已经在 B站 观看过视频，等待 1-2 分钟后刷新 Dashboard。

### Q: 数据会占用多少空间？

A: 约 1000 条观看记录大约占用 50-100KB。扩展使用 IndexedDB 存储，不会影响浏览器性能。

### Q: 如何清除所有数据？

A: 两种方式：① 在 `chrome://extensions` 中移除扩展；② 在 DevTools → Application → IndexedDB 中手动删除 `BiliAnalyticsDB`。

### Q: 为什么看不到很久以前的观看记录？

A: B站 历史 API 最多返回最近约 1000 条记录。扩展安装越早，积累的本地数据越完整。

### Q: 扩展支持哪些浏览器？

A: Chrome 和 Edge（基于 Chromium）均支持。Firefox 需要调整 Manifest V3 兼容性。

---

## 文档

- [产品需求文档 (PRD)](docs/PRD.md) — 完整的产品需求与技术方案

## License

MIT
