# BiliBili DataViz Plugin

B站消费数据中心是一个 Chrome/Edge 扩展，用于长期归档 B站观看历史，并把跨设备历史记录和本机网页播放行为合成为个人观看分析面板。

## 当前能力

- 使用 B站历史接口 `/x/web-interface/history/cursor` 作为跨设备主数据源，覆盖 PC、手机、平板等历史记录。
- 使用本机网页 `playerEvents` 作为 PC 实测增强，修正本机观看时长、连续观看天数和设备分布。
- IndexedDB 长期保存历史记录，不依赖每次临时读取接口。
- 支持全量同步、增量同步、同步进度显示、同步取消和本次同步数量上限。
- Popup 改为独立持久小窗，点击扩展图标会打开或聚焦窗口，不会失焦自动关闭。
- Dashboard 展示自然周、自然月统计范围、命中记录数、本地历史覆盖范围和设备分布。
- 支持 JSON/CSV 导出本地历史数据。

## 数据口径

- 本周：周一 00:00 到今天当前可用数据。
- 本月：当月 1 日 00:00 到今天当前可用数据。
- B站历史记录中的 `progress` 是跨设备估算字段，不等同于真实播放时长。
- 本机 PC 播放时长来自扩展运行后的播放器心跳和播放事件。
- 同日同视频同时存在 B站历史记录和本机 PC 事件时，优先使用本机实测，避免重复计数。

## 同步机制

- 首次同步或手动刷新：从 cursor 首页开始翻页归档，最多可选 10/50/100/300 页，约 300/1500/3000/9000 条。
- 日常后台同步：每 5 分钟执行增量同步，遇到本地已有边界记录后停止。
- 去重键：`sessionKey = kid:viewAt`，兼容同一视频多天重复观看。
- 同步锁：防止重复点击造成并发写库；异常锁会按超时策略自动清理。
- 停止同步：点击停止会设置取消标记并 abort 当前网络请求。

## 安装与构建

```bash
npm install
npm run build
```

然后在 Chrome/Edge 打开 `chrome://extensions`：

1. 打开“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择项目的 `dist/` 目录。
4. 更新代码后需要重新运行 `npm run build`，并在扩展管理页点击“重新加载”。

## 使用方式

1. 先在同一个浏览器 Profile 登录 [B站](https://www.bilibili.com)。
2. 点击扩展图标，打开持久小窗。
3. 选择本次最多同步条数。
4. 点击刷新图标开始全量同步。
5. 同步过程中可查看页数、获取条数、新增/更新数量、当前步骤，也可以停止同步。
6. 点击“查看完整面板”打开 Dashboard。

## 项目结构

```text
src/
  background/
    api/                 B站 API client、历史接口、视频详情接口
    analytics/           有效观看记录、指标、设备、偏好、行为分析
    messages/            Popup/Dashboard/Content Script 消息路由
    storage/             Dexie schema、仓库、配置和同步状态
    sync/                全量/增量同步、去重、取消控制
  content/
    player-monitor/      B站视频页播放器事件和心跳采集
    sidebar-card/        B站首页侧栏卡片
  shared/
    types/               跨上下文类型
    utils/               日期、格式、sessionKey 等工具
popup/                   持久小窗 UI
dashboard/               完整分析面板 UI
public/manifest.json     Chrome MV3 manifest
```

## 开发命令

```bash
npm run dev        # watch build
npm run typecheck  # TypeScript 检查
npm run build      # 类型检查 + 生产构建
```

## 调试

- Service Worker：`chrome://extensions` -> 扩展卡片 -> Service Worker。
- IndexedDB：DevTools -> Application -> IndexedDB -> `BiliAnalyticsDB`。
- Content Script：在 B站视频页打开 Console，过滤 `[BiliViz]`。

## 限制

- B站接口返回范围由 B站决定；“无限保存”指扩展会长期保存每次可获取到的历史。
- 扩展安装前未采集到的本机 PC 心跳无法补回。
- 如果用户关闭 B站历史记录，或接口不返回更早数据，扩展无法凭空恢复。

## License

MIT
