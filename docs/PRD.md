# B站消费数据中心 PRD

## 1. 产品定位

B站消费数据中心是一个本地优先的浏览器扩展，用于把 B站观看历史、跨设备观看进度和本机播放事件转化为可读、可分析、可导出的个人消费数据。

核心原则：

- B站历史记录是跨设备主数据源。
- 本机 PC 播放事件是实测增强数据源。
- IndexedDB 是长期历史仓库。
- 展示层必须暴露统计范围、命中记录数和本地历史覆盖范围，避免用户误判数据口径。

## 2. 目标用户

- 高频 B站用户，希望知道自己本周、本月投入了多少时间。
- 希望区分手机、PC、平板等设备观看情况的用户。
- 希望长期保存 B站历史记录，并进行后续分析和导出的用户。

## 3. 核心功能

### 3.1 持久小窗

- 点击浏览器扩展图标打开独立 popup 窗口。
- 已打开窗口时再次点击扩展图标聚焦已有窗口。
- 窗口不会像 Chrome 原生 extension popup 一样失焦自动关闭。

### 3.2 历史同步

- `SYNC_NOW` 支持 `full` 和 `incremental` 两种模式。
- 手动刷新默认执行全量同步。
- 后台定时任务执行增量同步。
- 首次或全量同步从 `/x/web-interface/history/cursor` 首页开始翻页。
- 增量同步遇到本地边界记录后停止。
- 本次同步上限可选 10/50/100/300 页，约 300/1500/3000/9000 条。
- 同步过程中显示页数、获取条数、新增条数、更新条数、当前任务和停止原因。
- 用户可点击停止同步，后台会设置取消标记并 abort 当前网络请求。

### 3.3 长期存储

`watchHistory` 是长期历史仓库：

- Dexie v2。
- 唯一键为 `sessionKey = kid:viewAt`。
- 保留 `viewAt` 索引用于倒序分页、自然周/月统计和趋势分析。
- 兼容同一视频多天观看，不再用单个 `kid` 阻止重复观看入库。

### 3.4 有效观看记录

统计层统一使用“有效观看记录”：

- 先读取 B站历史记录。
- 再读取本机 `playerEvents`。
- 按 `bvid + cid + 日期` 合并。
- 同日同视频同时存在历史记录和本机 PC 事件时，用 PC 实测替代历史估算，避免双算。
- PC 事件缺少 `cid` 时允许按 `bvid + 日期` 参与合并。

### 3.5 统计面板

Popup：

- 今日进度。
- 连续观看天数。
- 本周观看时间。
- 平均完播率。
- 效率评分。
- 同步进度和停止按钮。

Dashboard：

- 总览。
- 偏好。
- UP 主。
- 行为。
- 实验建议。
- 显示本周、本月实际统计范围和命中记录数。
- 显示本地历史最早/最新日期。
- 显示本周本机 PC 实测计入时长和天数。

## 4. 数据口径

### 4.1 时间范围

- 本周：周一 00:00 到今天。
- 本月：当月 1 日 00:00 到今天。
- 日期边界使用浏览器本地时区。

### 4.2 观看时长

- B站历史 `progress` 是估算依据，适合跨设备覆盖。
- 本机 PC 时长从播放器事件估算，适合真实播放增强。
- 连续观看天数同时参考 `watchHistory.viewAt` 和本机 PC 有效播放日期。

### 4.3 设备分布

- 优先使用 B站历史 payload 中的设备类型字段。
- 本机 PC 心跳会作为设备分布增强。
- 同一记录被 PC 实测替代后，设备类型按 PC 计入。

## 5. API 与同步策略

### 5.1 B站 API

- 历史记录：`/x/web-interface/history/cursor`
- 视频详情：`/x/web-interface/view`
- 登录状态：通过浏览器登录态和 API 返回码判断。

### 5.2 请求策略

- 使用 `credentials: include` 携带浏览器登录态。
- Token bucket 限流。
- API 请求 30 秒超时。
- 支持 WBI 失败回退签名。
- 用户停止同步时 abort 当前请求。

### 5.3 同步结果字段

`SyncNowResult` 和 `SyncProgress` 包含：

- `mode`
- `pageLimit`
- `currentTask`
- `fetchedPages`
- `fetchedCount`
- `insertedCount`
- `updatedCount`
- `stoppedReason`
- `reachedEnd`
- `oldestFetchedAt`
- `newestFetchedAt`

## 6. Chrome 扩展形态

Manifest V3：

- `background.service_worker = background.js`
- `action` 不配置 `default_popup`，改为 `chrome.action.onClicked` 创建独立窗口。
- `content/player-monitor.js` 注入 B站视频页。
- `content/sidebar-card.js` 注入 B站首页。
- 权限：`cookies`、`storage`、`unlimitedStorage`、`alarms`、`tabs`。

## 7. 关键修复记录

- 修复 content script 顶层 `import` 导致的 `Cannot use import statement outside a module`。
- 修复未登录时红色错误刷屏，未登录改为可解释状态。
- 修复 `dailyAggregates.date` 唯一索引写入冲突。
- 修复自然周/月统计只像统计今天的问题，增加统计范围和命中记录数诊断。
- 修复 `has_more` 可选字段导致全量同步只扫 1 页的问题。
- 修复 `cid=0` 导致 PC 心跳不计入的问题。
- 修复同步锁残留，增加锁时间戳和超时清理。
- 修复长同步期间 Popup 挂住，改为后台启动 + 轮询进度。
- 修复停止同步只能页边界生效，改为 abort 当前网络请求。
- 修复 B站 SPA 自动连播 URL 读到旧 `__INITIAL_STATE__`，优先使用地址栏 BV 号并延迟重试。

## 8. 非目标

当前版本不做：

- WebDAV/云同步。
- 多设备数据库合并。
- 收藏夹、点赞音乐、弹幕等额外数据源。
- 真实“置顶”窗口。Chrome 扩展窗口可持久存在，但不能强制 always-on-top。

## 9. 验证要求

每次发布前至少运行：

```bash
npm run build
```

并确认：

- `dist/content/*.js` 无顶层 `import`。
- `dist/manifest.json` 无 `default_popup`。
- Popup 可启动全量同步并展示进度。
- 停止同步可在网络请求阶段中止。
- Dashboard 本周、本月范围符合自然周/月。
