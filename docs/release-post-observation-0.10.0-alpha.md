# Bili-Bill 0.10.0-alpha 发布后观察与回滚预案

Issue: #66

Date: 2026-06-11

Release: https://github.com/LittleNuB/BiliBili-DataViz-Plugin/releases/tag/v0.10.0-alpha

本文件用于 `v0.10.0-alpha` prerelease 发布后的 0-48 小时观察、分级、回滚与沟通。它只定义观察和处置流程，不修改产品功能、tag、GitHub Release、release asset、manifest、版本号或 Chrome Web Store 状态。

## Release 摘要

| 项目 | 值 |
| --- | --- |
| Release tag | `v0.10.0-alpha` |
| Release URL | `https://github.com/LittleNuB/BiliBili-DataViz-Plugin/releases/tag/v0.10.0-alpha` |
| Release target commit | `3f382e6f8b505b6ee51aa68b0c71da29ce628b26` |
| Zip asset | `bili-bill-0.10.0-alpha.zip` |
| Zip SHA-256 | `49183AFB825FD82CD269B7257EC9C3F1BA69CCAB592B343EA414CD67AC2251C3` |
| Release flags | `draft=false`, `prerelease=true` |
| Package version | `0.10.0-alpha` |
| Manifest version | `0.10.0` |
| Manifest version_name | `0.10.0-alpha` |
| Store status | Chrome Web Store 未发布，本次不涉及商店回滚 |

后续所有观察、公告、补丁和回滚判断都必须以这个公开 release 基线为准，避免混淆“已发布给测试用户的 alpha”与“尚未公开的本地构建”。

## 观察窗口

### 0-2 小时

目标：确认公开 prerelease 可访问、可校验、可加载，没有立即阻断安装或首屏使用的问题。

- [ ] GitHub Release 页面可访问，tag 仍为 `v0.10.0-alpha`，target 仍指向 `3f382e6f8b505b6ee51aa68b0c71da29ce628b26`。
- [ ] 下载到的 zip 文件名仍为 `bili-bill-0.10.0-alpha.zip`，SHA-256 与公开记录一致。
- [ ] 解压后的扩展根目录包含 `manifest.json`、`background.js`、`popup/`、`dashboard/`、`content/`、`assets/`、`chunks/`、`icons/`。
- [ ] Chrome/Edge 开发者模式可加载 unpacked `dist/`，没有 manifest 拒绝、权限拒绝或 MV3 service worker 注册失败。
- [ ] 扩展卡片名称、版本与 prerelease 标识正常显示，`version_name` 暴露 `0.10.0-alpha`。
- [ ] Popup 可以启动，不空白、不立刻崩溃。
- [ ] 从 Popup 打开 Dashboard 成功，概览页可进入。
- [ ] 没有用户反馈表明下载包损坏、zip 解压异常、扩展无法识别或 Service Worker 无法启动。

### 2-24 小时

目标：观察真实内测使用中的启动链路、同步完整性、AI fallback 和产品边界理解。

- [ ] 安装/manifest/MV3 service worker 失败案例已按浏览器版本、OS、错误信息归类。
- [ ] Popup 与 Dashboard 启动路径稳定，未出现高频白屏、卡死或只在旧本地数据环境下触发的 crash。
- [ ] Current Video Assistant 与 Video Knowledge 的当前视频上下文解析可用，能够正确区分 metadata / description / page / chapter 来源。
- [ ] Smart Favorites 同步完整性诊断可解释覆盖不足；Q&A 在 local fallback、AI 禁用、AI 失败三种路径下都不会伪造结论。
- [ ] Dynamic Bill 三栏 `久违更新 / 换换口味 / 被埋没的关注` 仍按兴趣再平衡定位表达，没有被误解为推荐排序或首页推荐流。
- [ ] Dynamic Bill 状态推进仍保持 `未打开 / 已打开 / 已消费 / 已处理`，没有出现错误推进、倒退或解释不清。
- [ ] Dynamic Bill feedback 与 AI fallback 说明清晰，不会让用户误以为插件会写回 B 站关注/收藏关系。
- [ ] 历史、偏好、创作者关系页面可以进入，重点关注旧数据环境下的 crash、空状态误判或关注状态语义误解。
- [ ] 用户关于隐私边界的疑问已归档，重点看是否有人误解为会上传完整历史、完整收藏、完整关注、完整 feedback 或会读取本地敏感文件。

### 24-48 小时

目标：基于反馈频率、影响范围和可恢复性决定维持观察、发布补丁还是撤下当前 prerelease 推荐。

- [ ] 汇总安装失败、manifest/permission 问题、Service Worker 失败、Popup/Dashboard crash 的数量与共性环境。
- [ ] 汇总 Current Video Assistant、Video Knowledge、Smart Favorites、Dynamic Bill 的高频失败路径与复现条件。
- [ ] 抽样复核 AI 不可用时的 local fallback，确认核心信息仍然可读且不会输出越界结论。
- [ ] 复核 Dynamic Bill 三栏命中质量、状态推进、反馈抑制和兴趣再平衡文案是否引发系统性误解。
- [ ] 复核历史、偏好、创作者关系页在旧本地数据环境下的兼容表现，确认是否存在必须修补的 IndexedDB 迁移问题。
- [ ] 所有反馈已标记为 `blocker`、`must-fix` 或 `follow-up`，并给出 owner、复现材料和目标版本。
- [ ] 若无 blocker，则保留当前 prerelease 继续观察；若有 blocker，则进入回滚或补丁版本决策。

## 重点观察路径

### 安装、Manifest、MV3 Service Worker

- 检查用户是否选择了正确的 unpacked 扩展根目录。
- 记录 manifest 加载失败、host 权限拒绝、企业策略拦截或 MV3 Service Worker 启动错误。
- 若仅是安装说明不清，优先修正文档或公告，不要替换已发布 zip。

### Popup 与 Dashboard 启动

- 记录空白页、首屏 crash、路由打不开、重复打开异常或只在旧本地数据下触发的问题。
- 区分是 Popup 独立问题、Dashboard 独立问题，还是 Service Worker/存储初始化导致的连带失败。

### Current Video Assistant / Video Knowledge 当前视频上下文

- 观察当前视频上下文能否稳定命中活动 B 站视频页，而不是退化到扩展页上下文。
- 确认 metadata summary、description summary、page/chapter 节点来源标注清楚。
- 若没有 transcript 或正文来源，结果必须保持有限结论，不要被用户解读为完整视频理解。

### Smart Favorites 同步完整性与 Q&A fallback

- 观察收藏同步诊断是否能解释“为什么只同步到部分收藏夹或部分视频”。
- Local fallback 必须保留引用视频、命中原因和低置信说明。
- AI 可用时只做本地结果组织；AI 不可用时仍要保留本地检索结果，不得返回无来源结论。

### Dynamic Bill 三栏、状态推进、反馈、AI fallback

- 三栏仍然服务于兴趣再平衡，不是推荐排序、点击率优化或动态流替代品。
- 状态推进只允许落在 `未打开 / 已打开 / 已消费 / 已处理` 这套语义内。
- “少提醒这个 UP / 少提醒这个主题”类反馈必须被理解为本地抑制信号，而不是写回 B 站关系。
- AI fallback 失败时，本地证据与状态说明仍需可读。

### 历史、偏好、创作者关系页面

- 重点观察旧本地数据库、低覆盖样本、空状态、关注状态未知和历史覆盖不足时的解释是否稳定。
- 若页面可用但文案引导不清，归类为 must-fix 或 follow-up，而不是 blocker。

### 隐私边界误解或用户反馈

- 重点收集“是否上传完整历史/收藏/关注/feedback”“是否会自动取关/改收藏”“是否会读取 Cookie/profile/key 文件”这几类误解。
- 若只是理解偏差，优先补充说明；若发现真实越界行为，立即升级为 blocker。

## 失败分级

### Blocker

满足任一条件即视为 blocker：

- 发布 zip 无法下载、SHA-256 与公开记录不一致，或 zip 内容不是可加载扩展目录。
- 主流 Chrome/Edge 稳定版普遍无法安装，或 manifest / MV3 service worker 失败导致扩展无法启动。
- Popup 或 Dashboard 首屏普遍 crash，导致核心路径不可进入。
- Current Video Assistant、Smart Favorites 或 Dynamic Bill 在正常支持环境下高频失效，且没有可理解的本地 fallback。
- 发现会写回 B 站关注、收藏、动态排序或其他用户关系的行为。
- 发现上传完整历史、完整收藏、完整关注、完整 feedback，或读取本地敏感文件的真实越界行为。

### Must-fix

必须在下一个 alpha 修补，但不一定要求立即撤下当前 prerelease：

- 安装说明、权限说明或隐私说明不清，导致多名用户重复误操作。
- 某个页面或模块在特定旧数据环境下 crash，但存在稳定绕开方式，其他核心路径仍可用。
- Smart Favorites、Current Video Assistant、Video Knowledge 或 Dynamic Bill 的 fallback 能工作，但说明文案明显误导。
- 历史、偏好、创作者关系页面存在显著语义误解或空状态判断偏差。
- 构建仍出现已知 Vite large chunk warning，但不影响安装、加载或核心功能。

### Follow-up

进入普通后续排期：

- 三栏命中质量、阈值、反馈抑制体验或解释质量优化。
- 更细的同步进度、失败重试、诊断导出或说明增强。
- 文案微调、FAQ、帮助文档、问卷或反馈入口优化。
- 构建体积和 chunk 切分优化。

## 回滚与补丁策略

### 总原则

- 不静默覆盖已经公开发布并可能已被下载的 `bili-bill-0.10.0-alpha.zip`。
- 优先保留公开 tag `v0.10.0-alpha` 作为历史指针，不移动、不替换、不强推覆盖。
- Chrome Web Store 尚未发布，本次不涉及商店回滚或商店审查说明。

### Blocker 处置

1. 先确认问题可复现，并记录浏览器版本、OS、扩展 ID、release zip SHA-256、Console 错误、Service Worker 错误、IndexedDB 版本和最小复现步骤。
2. 立即在 issue 与 PR/release 沟通中标明当前 prerelease 有风险。
3. 由维护者决定：
   - 撤下当前 prerelease 的推荐状态，或在 prerelease 说明中显式标记 blocker。
   - 从已发布基线派生修复，并发布 `0.10.0-alpha.1` 或新的 alpha tag。
4. 不要通过静默替换 zip 假装问题从未发生。

### Artifact replacement 规则

只有在极少数发布物层面的事故下，才讨论 replacement：

- 上传损坏、文件名错误、release 页面缺失文件，或公开记录的 SHA-256 与下载文件不一致。

若维护者明确决定替换 asset，则必须：

- 重新生成 zip 与新的 SHA-256。
- 在 release notes 中透明说明替换时间、原因、影响范围和新校验值。
- 保留用户能区分旧 artifact 与新 artifact 的说明。

即便满足 replacement 条件，仍然优先选择发布 `0.10.0-alpha.1` 或新的 tag，而不是复写既有公开下载物。

### Tag 与补丁版本策略

- 不移动 `v0.10.0-alpha`，不 force-move public tag。
- 修复版优先使用 `v0.10.0-alpha.1` 或新的明确 tag。
- 若只是文档说明补充，不需要改 tag 或替换 asset。

## 本地数据与 IndexedDB 兼容说明

- 本版本继续依赖浏览器本地 `IndexedDB` 与 `chrome.storage.local` 保存历史、偏好、Dynamic Bill 本地状态、Smart Favorites 同步诊断和相关本地结果。
- 不要默认建议用户清空本地数据库、删除扩展存储或重装浏览器 Profile。
- 只有在诊断已经确认是本地旧数据损坏、迁移失败或不可恢复缓存导致的问题时，清库才作为最后手段。
- 即使进入诊断，也应先收集错误信息、数据库版本、可复现路径和受影响页面，再决定是否需要让用户执行清理。
- 任何诊断与回滚流程都不应要求用户提供 Cookie、浏览器 profile、Bilibili 登录态文件、`Key.txt` 或其他本地敏感文件。

## 用户沟通模板

### 安装失败

```text
我们收到了 Bili-Bill 0.10.0-alpha 的安装/加载失败反馈。请先确认你加载的是解压后的扩展根目录，并核对下载文件的 SHA-256 是否为 49183AFB825FD82CD269B7257EC9C3F1BA69CCAB592B343EA414CD67AC2251C3。

如果仍然失败，请提供浏览器版本、操作系统、扩展报错截图和最小复现步骤。请不要提供 Cookie、浏览器 profile、登录态文件或本地 key 文件。
```

### AI 不可用

```text
0.10.0-alpha 的 AI 能力是可选增强，不是核心可用性的前提。即使 AI 未配置、被禁用或请求失败，Bili-Bill 仍应保留本地 fallback 结果。

如果你看到的是空白或无来源结论，请反馈具体页面、当时是否启用 AI、报错信息和截图，我们会优先确认 fallback 是否异常。
```

### 同步不完整

```text
这类反馈通常需要先看同步诊断，而不是直接清空本地数据。请记录是哪个页面、哪一类数据覆盖不足，以及页面给出的同步状态或诊断信息。

我们会先判断是接口返回范围、同步中断、旧本地数据兼容，还是展示文案问题。默认不会建议你先清库，除非诊断已经确认本地数据损坏。
```

### 隐私边界

```text
Bili-Bill 0.10.0-alpha 不会读取本地 Cookie、浏览器 profile、Bilibili 登录态文件或 key 文件，也不会上传完整历史、完整收藏、完整关注或完整 feedback 数据。

它也不会写回 B 站关注/收藏关系。如果你看到让你怀疑越界的行为，请直接反馈页面、时间点和截图，我们会按 blocker 级别核查。
```

### 已修复补丁

```text
针对 v0.10.0-alpha 中的 [问题摘要]，我们已经发布修复补丁 [新版本号]。原 `v0.10.0-alpha` 保留为历史 prerelease，新版本会提供独立下载说明和新的 SHA-256。

这次补丁不会写回 B 站关系，也不会要求你提供 Cookie、profile 或本地敏感文件。若你已经安装旧版，请按新的 release 说明升级。
```

## 后续 Triage 流程

1. 每条反馈先记录来源、浏览器、OS、安装方式、是否启用 AI、是否存在旧本地数据、release zip SHA-256 和最小复现步骤。
2. 先按类别归档：
   - 安装/manifest/service worker
   - Popup/Dashboard 启动
   - Current Video Assistant / Video Knowledge 当前视频上下文
   - Smart Favorites 同步完整性 / Q&A fallback
   - Dynamic Bill 三栏 / 状态推进 / feedback / AI fallback
   - 历史 / 偏好 / 创作者关系
   - 隐私边界 / 用户误解
3. 先判断是否命中 blocker；命中则单开高优先级 issue，并在标题中直接写影响面，例如 `Blocker: MV3 service worker fails to start on 0.10.0-alpha`。
4. 未命中 blocker 但需要下一个 alpha 修补的，拆成 must-fix issue；标题应具体描述用户可见症状，不写模糊的“优化体验”。
5. 其余进入 follow-up issue，记录样本、预期行为和建议方向。
6. 每个拆出的 issue 至少包含：
   - 观察窗口与首次发现时间
   - 影响版本与 release SHA-256
   - 复现步骤
   - 实际结果与期望结果
   - 是否涉及旧本地数据
   - 是否触及隐私或写回边界
   - 建议分级：blocker / must-fix / follow-up

## 发布后记录栏

| 时间窗 | 状态 | 记录人 | 摘要 | 后续动作 |
| --- | --- | --- | --- | --- |
| 0-2 小时 | 待观察 |  |  |  |
| 2-24 小时 | 待观察 |  |  |  |
| 24-48 小时 | 待观察 |  |  |  |
