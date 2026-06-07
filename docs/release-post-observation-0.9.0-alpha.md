# Bili-Bill 0.9.0-alpha 发布后观察与回滚预案

日期：2026-06-07

Issue: #28

Release: https://github.com/LittleNuB/BiliBili-DataViz-Plugin/releases/tag/v0.9.0-alpha

本文件用于 `v0.9.0-alpha` 内测 prerelease 发布后的 24-48 小时观察、反馈分级和回滚决策。它不改变产品功能、数据库 schema、API、AI 逻辑、状态推进或反馈逻辑。

## 发布基线

| 项目 | 值 |
| --- | --- |
| Prerelease tag | `v0.9.0-alpha` |
| Release target commit | `d2550b84a402cad6fef33e54fa0dc8cffe1070d6` |
| Zip SHA-256 | `75DE0E167EC1AEFFFAFA31DBA2D7BEFDB9814FE096B975CF0E5A69B7B8A678BF` |
| Package version | `0.9.0-alpha` |
| Manifest version | `0.9.0` |
| Manifest version_name | `0.9.0-alpha` |
| Release type | GitHub prerelease / alpha 内测 |
| Prior tag | 仓库当前未发现早于 `v0.9.0-alpha` 的 prior tag |

回滚讨论中的“回滚目标”先指向本次 release target commit `d2550b84a402cad6fef33e54fa0dc8cffe1070d6`：所有替代修复、复测和公告都应明确它是从这个已发布 alpha 基线派生或替换。由于仓库当前没有 prior tag，若需要让用户退回更早稳定版本，必须由 PM 或维护者另行指定 commit、branch 或人工安装包。

## 0-2 小时观察清单

目标：确认发布包可以被下载、校验、加载，并且没有立即阻断内测的安装或首屏问题。

- GitHub Release 页面可访问，标记为 prerelease，tag 指向 `d2550b84a402cad6fef33e54fa0dc8cffe1070d6`。
- 下载 zip 后校验 SHA-256 是否为 `75DE0E167EC1AEFFFAFA31DBA2D7BEFDB9814FE096B975CF0E5A69B7B8A678BF`。
- 解压后 zip 根目录包含 `manifest.json`、`background.js`、`popup/index.html`、`dashboard/index.html`、`content/player-monitor.js`、`content/sidebar-card.js`、`assets/`、`chunks/`、`icons/`。
- Chrome/Edge 开发者模式加载解压目录时没有 manifest 拒绝、权限拒绝或 MV3 Service Worker 注册失败。
- 扩展卡片显示 Bili-Bill，`version_name` 暴露 `0.9.0-alpha`。
- 权限提示包含预期权限：`cookies`、`storage`、`unlimitedStorage`、`alarms`、`tabs`，以及 B 站、DeepSeek/OpenAI 默认 host 权限。
- 点击扩展图标可以打开或聚焦 Popup，Popup 不空白、不闪退。
- 从 Popup 进入 Dashboard，Dashboard 总览可渲染，侧边导航可进入智能收藏和动态账单。
- 动态账单页面在未登录或空数据状态下不 crash，能显示同步状态、本地账单状态和 AI fallback 说明。
- 不读取、复制或要求用户提供本地 key 文件、Cookie、浏览器 profile 或 Bilibili 登录态文件。

## 2-24 小时观察清单

目标：观察真实内测环境中的同步、生成、fallback 和用户理解问题。

- 安装/加载失败：收集浏览器版本、操作系统、是否选择了解压后的扩展根目录、扩展错误详情和 `manifest.json` 是否存在。
- Manifest/permission 问题：确认是否因自定义 AI Base URL、默认 host 权限、企业策略或浏览器版本导致 host 权限申请失败。
- Dashboard crash：记录进入路径、具体模块、Console 错误、Service Worker 错误和是否仅发生在已有本地 IndexedDB 数据的 profile。
- Dynamic Bill sync failure：区分未登录、B 站接口不可用、关注关系同步失败、动态 feed 同步失败、视频详情补全失败、本地写入失败。
- Dynamic Bill generation failure：记录本地候选池规模、最近投稿数量、三栏生成数量、排除原因统计是否异常。
- AI fallback failure：确认未启用 AI、未配置 API Key、AI 请求失败、模型返回异常时，页面是否仍展示本地证据 fallback。
- 状态推进：从账单打开视频后，状态是否能推进为已打开；观看历史或播放器事件确认后是否能进入已消费；手动处理是否进入已处理。
- 反馈与取关提示：确认“少提醒这个 UP / 少提醒这个主题”和取关思考提示不会让用户误解为 Bili-Bill 会修改 B 站关注关系。
- 产品定位理解：反馈表述应围绕“兴趣再平衡”，观察用户是否把动态账单误解为实时个性化排序、点击预测或 B 站动态页替代流。
- 隐私边界：确认用户是否理解完整观看历史、完整关注列表、Cookie、用户 mid、个人资料和 feedback 记录不会上传。

## 24-48 小时观察清单

目标：根据反馈频率、影响面和可恢复性决定是否继续观察、发修复版或撤下 alpha。

- 统计安装/加载失败案例数，并按浏览器、操作系统、加载方式和错误类型归类。
- 汇总 Dashboard crash 和 Dynamic Bill failure 是否集中在特定 IndexedDB 版本、旧数据、未登录状态或特定 B 站接口返回。
- 抽样复核 AI fallback：AI 禁用、未配置、请求失败三种路径都应保持本地证据可用。
- 复核动态账单三栏反馈：久违更新、换换口味、被淹没的关注是否存在系统性误报或文案误解。
- 检查是否出现用户以为插件会自动取关、批量取关或写回 B 站关注关系的反馈。
- 确认没有用户报告本地数据被上传、关注关系被修改、收藏夹被写回或 B 站动态页排序被改写。
- 对所有反馈标记 blocker / must-fix / follow-up，并为 blocker 和 must-fix 指定 owner、复现材料和目标修复版本。
- 若没有 blocker，保留 prerelease，继续收集 normal backlog；若存在 blocker，进入回滚或修复版决策。

## 分级标准

### Release blocker

满足任一条件即视为 blocker，需要停止扩大内测、发布公告，并评估撤下 alpha 或发布替代修复版本：

- 发布 zip 无法下载、SHA-256 与公告不一致，或 artifact 内容不是扩展运行时根目录。
- 主流 Chrome/Edge 稳定版无法加载扩展，且不是用户选择了错误目录导致。
- Manifest 权限错误导致扩展无法安装或 Service Worker 无法启动。
- Popup 或 Dashboard 首屏大面积 crash，用户无法进入核心页面。
- Dynamic Bill 同步或生成对已登录用户普遍失败，且没有可用的本地状态保留或错误说明。
- AI 未启用、未配置或失败时，本地证据 fallback 同时不可用，导致动态账单解释区不可用或误导用户。
- 发现会写回、自动修改或疑似修改 B 站关注关系、收藏夹、动态页原生排序的行为。
- 发现完整观看历史、完整关注列表、Cookie、用户 mid、个人资料、feedback 记录或本地-only 数据被意外上传。

### Must-fix

必须在下一个 alpha 修复，但不一定要求立即撤下当前 prerelease：

- 安装说明或权限说明导致多名用户重复误操作，但扩展包本身可加载。
- Dashboard 单一模块 crash，且可通过绕开该模块继续使用其他核心能力。
- Dynamic Bill 某一阶段在部分环境失败，但页面能保留本地已有数据并清楚显示错误。
- AI fallback 文案、状态说明或三栏说明造成明显误解，但没有触发数据安全或写回风险。
- “少提醒”或取关提示让用户困惑，但用户没有实际被引导执行错误的外部操作。
- Vite large chunk warning 等构建卫生问题，若不影响安装、加载或核心功能。

### Follow-up

进入普通 backlog，按影响面和产品节奏排期：

- 三栏命中质量、误报率、阈值口径和解释质量优化。
- 更细的同步进度、失败重试、导出诊断材料。
- 大 chunk 拆分、延迟加载和构建体积优化。
- 更完善的 seeded/mock smoke harness 或登录态外的动态账单生成验证。
- 文案微调、反馈入口、内测问卷和帮助文档增强。

## 回滚与替代发布策略

### 决策路径

1. 先确认问题是否可复现，并记录浏览器版本、扩展 ID、release zip SHA-256、Console 错误、Service Worker 错误、IndexedDB 版本和最小复现步骤。
2. 若是用户安装目录、浏览器策略或说明不清，优先更新公告和安装说明，不替换 artifact。
3. 若是功能 bug 但不影响安装和数据安全，保留 `v0.9.0-alpha`，从 `d2550b84a402cad6fef33e54fa0dc8cffe1070d6` 派生修复并发布 `0.9.0-alpha.1` 或新 tag。
4. 若是 blocker，立即在 release 页面和 issue 中公告，并选择“标记/撤下当前 alpha”或“发布替代修复版本”。
5. 不悄悄覆盖用户已经下载过的 artifact。任何 artifact 变化都必须有明确公告、新校验值和可追踪版本。

### GitHub Release artifact replacement

允许替换 asset 的情况：

- 上传过程损坏、release 页面文件缺失、文件名错误或 artifact 与记录的 SHA-256 不一致。
- 外部尚未下载，且 PM 或维护者明确确认可以替换。
- 替换后必须更新 release note、SHA-256、时间和原因。

不应替换 asset，应发布 `0.9.0-alpha.1` 或新 tag 的情况：

- 已有用户下载或安装过 `v0.9.0-alpha`。
- 修复涉及代码、构建产物、manifest、权限、DB schema、AI 逻辑、状态推进或文案行为。
- 需要用户区分“旧 alpha”和“修复版 alpha”。
- 需要保留可复现的历史 artifact 以便排查反馈。

### Tag handling

- 默认保留公开 tag `v0.9.0-alpha`，即使撤下或标记 release，也不要移动 tag。
- 修复版使用新 tag，例如 `v0.9.0-alpha.1`，并在公告中说明它替代 `v0.9.0-alpha`。
- 避免 force-move public tag。只有在确认 release 从未被外部下载、没有用户安装、且 PM 显式确认的情况下，才可讨论移动 tag。
- 若需要撤下当前 alpha，优先将 GitHub Release 标记为不推荐或删除 release asset，并保留 tag 作为历史指针；具体操作需由维护者确认后执行。

## 数据兼容说明

`0.9.0-alpha` 的 IndexedDB 数据库为 `BiliAnalyticsDB`，动态账单相关 schema 增加如下：

- v4: `followedCreators`、`followedVideoUpdates`，保存本地关注快照和最近视频投稿。
- v5: `dynamicBillItems`，保存本地生成的动态账单项。
- v6: `dynamicBillFeedback`，保存“少提醒”类本地反馈。
- v7: `dynamicBillExplanations`，保存 AI 解释或 fallback 状态相关记录。

这些数据默认保存在浏览器本地 IndexedDB 或 `chrome.storage.local` 中：

- 本地 dynamic bill items、feedback、AI explanations、同步状态和筛选偏好都属于本地-only 数据。
- 降级、回滚、撤下 alpha 或发布修复版时，不写回 B 站关注关系。
- 降级、回滚、撤下 alpha 或发布修复版时，不上传本地 dynamic bill items、feedback、AI explanations、完整观看历史、完整关注列表、Cookie、用户 mid 或个人资料。
- 如果用户回到旧代码，旧代码可能无法识别 v4-v7 新表，但不应因此修改 B 站侧关注关系或上传这些本地表。
- 若修复版需要 schema 变更，必须另写迁移说明，明确兼容旧 alpha 本地数据的读写策略。

## 用户沟通模板

### 发现 blocker

```text
我们在 Bili-Bill 0.9.0-alpha 内测中发现一个阻断问题：[一句话说明影响]。

请暂时不要继续安装或扩大使用 v0.9.0-alpha。已经安装的用户如遇到该问题，请保留浏览器版本、扩展错误截图和复现步骤，先不要删除本地数据。

我们正在基于 release target commit d2550b84a402cad6fef33e54fa0dc8cffe1070d6 排查，并会在确认后发布修复版或撤下当前 alpha。Bili-Bill 不会写回 B 站关注关系，也不会上传本地动态账单、feedback 或 AI 解释数据。
```

### 发布修复版

```text
Bili-Bill 已发布 0.9.0-alpha.1，用于修复 v0.9.0-alpha 中的 [问题摘要]。

建议内测用户改用 0.9.0-alpha.1。原 v0.9.0-alpha 保留为历史 prerelease，不再建议新用户安装。修复版的下载地址和 SHA-256 已在 release note 中更新。

本次修复不写回 B 站关注关系，不上传本地 dynamic bill items、feedback 或 AI explanations。
```

### 撤下 alpha

```text
我们已撤下或标记 Bili-Bill v0.9.0-alpha 为不推荐安装，原因是：[问题摘要]。

这次撤下只影响 GitHub prerelease 的推荐状态，不会自动修改你浏览器里已经安装的扩展，也不会写回 B 站关注关系。请等待后续修复版，或按维护者提供的步骤切回指定版本。

如你已经安装并愿意协助排查，请提供浏览器版本、扩展错误信息和复现步骤；不要提供 Cookie、浏览器 profile、API Key 或其他敏感文件。
```

## 后续 triage 流程

1. 每条反馈先记录来源、浏览器、OS、安装方式、release zip SHA-256、是否登录 B 站、是否启用 AI、是否有本地旧数据。
2. 按安装/加载、manifest/permission、Dashboard crash、Dynamic Bill sync、Dynamic Bill generation、AI fallback、关注/取关理解、隐私边界、其他体验分类。
3. 先判定是否命中 blocker；命中则停止扩大内测并进入回滚或修复版决策。
4. 未命中 blocker 时判定是否 must-fix；must-fix 需要绑定修复版本和复现材料。
5. 其余进入 normal backlog，保留用户原始描述、期望行为和可验证验收标准。
6. 对涉及定位的反馈，保持“兴趣再平衡”表述，避免把动态账单写成实时个性化排序或点击预测能力。

## 发布后记录栏

| 时间段 | 状态 | 记录人 | 摘要 | 后续动作 |
| --- | --- | --- | --- | --- |
| 0-2 小时 | 待观察 |  |  |  |
| 2-24 小时 | 待观察 |  |  |  |
| 24-48 小时 | 待观察 |  |  |  |
