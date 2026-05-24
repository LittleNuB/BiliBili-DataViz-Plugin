# BiliBili DataViz Plugin

B站消费数据中心是一个 Chrome/Edge 扩展，用于长期归档 B站观看历史，并把跨设备历史记录和本机网页播放行为合成为个人观看分析面板。
同时提供智能收藏夹能力：在不改动 B站原收藏夹的前提下，同步收藏视频元数据，生成由 B站原生分区驱动的智能分类树，并支持自然语言找回收藏内容。

## 当前能力

- 使用 B站历史接口 `/x/web-interface/history/cursor` 作为跨设备主数据源，覆盖 PC、手机、平板等历史记录。
- 使用本机网页 `playerEvents` 作为 PC 实测增强，修正本机观看时长、连续观看天数和设备分布。
- IndexedDB 长期保存历史记录，不依赖每次临时读取接口。
- 支持全量同步、增量同步、同步进度显示、同步取消和本次同步数量上限。
- Popup 改为独立持久小窗，点击扩展图标会打开或聚焦窗口，不会失焦自动关闭。
- Dashboard 展示自然周、自然月统计范围、命中记录数、本地历史覆盖范围和设备分布。
- Dashboard 展示当前连续观看时间段和历史最长连续观看时间段。
- 智能收藏夹支持同步 B站收藏夹、OpenAI 兼容模型配置、B站分区驱动的智能分类树、分类下钻、自然语言搜索和视频跳转。
- 支持 JSON/CSV 导出本地历史数据。

## 数据口径

- 本周：周一 00:00 到今天当前可用数据。
- 本月：当月 1 日 00:00 到今天当前可用数据。
- B站历史记录中的 `progress` 是跨设备估算字段，不等同于真实播放时长。
- 本机 PC 播放时长来自扩展运行后的播放器心跳和播放事件。
- 同日同视频同时存在 B站历史记录和本机 PC 事件时，优先使用本机实测，避免重复计数。
- 连续观看天数同时参考 B站历史记录和本机 PC 有效播放日期；当前连续和最长连续都会展示真实起止日期。
- 智能收藏夹只使用收藏视频元数据（标题、简介、UP 主、B站分区、标签、原收藏夹等）进行本地分类和检索增强，不下载视频、不分析画面、不写回 B站收藏夹。

## 同步机制

- 首次同步或手动刷新：从 cursor 首页开始翻页归档，最多可选 10/50/100/300 页，约 300/1500/3000/9000 条。
- 日常后台同步：每 5 分钟执行增量同步，遇到本地已有边界记录后停止。
- 去重键：`sessionKey = kid:viewAt`，兼容同一视频多天重复观看。
- 同步锁：防止重复点击造成并发写库；异常锁会按超时和 Service Worker 重启检测策略自动清理。
- 停止同步：点击停止会设置取消标记并 abort 当前网络请求，视频详情补全、限流等待、重试等待和页间等待也会尽快中断。

## 智能收藏夹

- 在 Dashboard 的“智能收藏”页使用。
- 点击“同步收藏夹”会读取当前 B站登录账号的全部收藏夹和收藏视频，以完整快照保存到本地 IndexedDB；同一视频存在于多个收藏夹时会形成多条收藏记录，同时单独显示去重视频数。
- 在“AI 配置”中填写 OpenAI 兼容接口参数，默认适配 DeepSeek：`https://api.deepseek.com` 和 `deepseek-v4-flash`。
- 保存自定义 AI Base URL 时，扩展会申请对应 host 访问权限；用户拒绝授权时不会保存不可用配置。
- 点击“生成智能索引”会先用 B站新版/旧版分区 ID 和标签生成稳定分类路径，再用 AI 补摘要、关键词、别名和末级主题；AI 不可用时会保存为降级索引，不进入未分类。
- 当前每批处理 8 条，支持取消当前批次，降低 MV3 Service Worker 长任务中断风险。
- 顶部统计会区分去重视频、收藏条目、索引成功、AI 降级、索引失败和待索引；失败项再次生成索引会按失败队列重试一轮。
- 分类树支持展开/收起，点击分类名称会在右侧展示该分类及子分类下的视频。
- 搜索框支持模糊描述，例如“苏德战争 库尔斯克”；结果卡片可跳转到对应 B站视频。
- 智能收藏夹不会创建、移动、删除或重命名 B站原收藏夹。

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
    ai/                  OpenAI 兼容模型调用
    api/                 B站 API client、历史接口、视频详情接口、收藏夹接口
    analytics/           有效观看记录、指标、设备、偏好、行为分析
    favorites/           智能收藏夹同步、AI 索引和检索
    messages/            Popup/Dashboard/Content Script 消息路由
    storage/             Dexie schema、历史/收藏仓库、配置和同步状态
    sync/                全量/增量同步、去重、取消控制
    utils/               后台通用工具
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
npm run test:taxonomy # B站分区归一化断言
npm run build      # 类型检查 + 生产构建
```

## 调试

- Service Worker：`chrome://extensions` -> 扩展卡片 -> Service Worker。
- IndexedDB：DevTools -> Application -> IndexedDB -> `BiliAnalyticsDB`。
- Content Script：在 B站视频页打开 Console，过滤 `[BiliViz]`。

## 限制

- B站接口返回范围由 B站决定；“无限保存”指扩展会长期保存每次可获取到的历史。
- 默认配置会保留最近 90 天观看历史，旧数据会被后台清理任务删除；如需真正长期归档，应调整保留天数配置。
- 扩展安装前未采集到的本机 PC 心跳无法补回。
- 如果用户关闭 B站历史记录，或接口不返回更早数据，扩展无法凭空恢复。
- 智能收藏夹的 AI 能力是可选增强；没有 OpenAI 兼容 API Key 或模型请求失败时，仍会保存 B站分区驱动的分类路径，并在 UI 中标记为 AI 降级。API Key 明文保存在本地 `chrome.storage.local`。

## License

MIT
