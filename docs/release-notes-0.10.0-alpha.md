# Bili-Bill 0.10.0-alpha 内测发布说明

发布日期：2026-06-10

`0.10.0-alpha` 是 Bili-Bill 的内测 prerelease，面向愿意手动加载 unpacked extension、验证新功能边界并反馈问题的测试用户。这个版本延续 0.9.0-alpha 的定位：Bili-Bill 是本地个人内容账单与知识辅助工具，不替代 B 站搜索、推荐、动态流或创作者关系管理。

本说明只覆盖 0.9.0-alpha 之后的功能变化、安装升级、隐私边界和已知限制。发布 tag、GitHub Release、商店包、manifest 版本和 release artifact 由 release owner 单独处理。

## 版本重点

### Smart Favorites 同步完整性与诊断

- 收藏夹同步现在会逐文件夹记录同步诊断，包括 B 站报告数量、已抓取页数、原始资源数、实际写入视频数、过滤项、剩余分页、错误和数量差异。
- 当诊断显示同步不完整时，扩展会保留本次已获取的数据和诊断信息，但不会用不完整快照破坏本地已有收藏快照。
- Smart Favorites Q&A 会读取这些诊断；在同步覆盖不足时，回答会限定为“当前已同步收藏中的结果”，不会声称已经覆盖用户全部收藏。

### Creator Relationships 关注语义

- 创作者分析新增关注状态分组：已关注、未关注、未知。
- 当本地存在关注快照时，创作者会被归入已关注或未关注；当没有可用快照或覆盖不足时，状态会降级为未知。
- 这些状态用于解释本地观看关系和创作者面板，不会写回 B 站，也不会提供插件内关注、取关或批量修改关系。

### Interest Drift 日 / 周 / 月颗粒度

- 兴趣漂移视图支持按日、周、月切换，方便区分短期波动、近期趋势和更长周期的兴趣变化。
- 页面会根据本地历史覆盖天数给出可信度提示：短覆盖更适合日粒度，较长覆盖更适合周/月视图。
- 该视图只解释本地观看结构变化，不作为动态账单或 B 站动态内容的实时推荐排序依据。

### Current Video Assistant

- 视频页现在可以收集当前视频上下文，包括 BVID、CID、标题、UP、时长、当前分 P、分 P 列表、简介可用性、章节可用性和来源状态。
- Popup 中的 Current Video Assistant 可以在有视频上下文时显示 metadata summary 或 description summary；没有简介、字幕或正文来源时会明确降级。
- 当前版本不会把标题、标签或简介包装成完整视频总结。没有可靠 transcript / content text 时，只能说明“基于元数据”或“基于简介”的有限结论。
- AI 未配置、禁用、请求失败、低置信或用户取消时，仍会展示本地 fallback 和来源限制。

### Smart Favorites Q&A

- 智能收藏页新增带引用的本地问答检索：先在本地按标题、简介、UP、分区、标签、原收藏夹、智能路径、摘要、关键词和别名召回并排序。
- 每个回答必须包含引用视频、链接、命中原因、来源字段和证据说明；证据不足时会返回候选列表、低置信或 no result，而不是生成无来源结论。
- 可选 AI synthesis 只负责把本地 top cited videos 组织成自然语言答案。AI 禁用、未配置、失败或引用越界时，页面继续保留本地 cited retrieval 结果。
- 第一版不做收藏视频正文问答，不分析画面、音频、弹幕或评论。

### AI Payload Privacy Audit

- Current Video Assistant 和 Smart Favorites Q&A 的 AI payload 增加 allowlist 审计。
- 审计会拒绝完整历史、完整收藏、完整关注、完整反馈、本地 key 路径、Cookie / login token、用户 profile、authorMid / userMid 等不应进入 AI 请求的字段或敏感 token。
- Smart Favorites Q&A 在同步不完整时会把本地诊断详情留在本地，只向 AI 发送覆盖状态摘要，不发送具体私有收藏夹名称、mediaId 或错误详情。

### Video Knowledge v0

- Video Knowledge v0 可以基于当前视频 metadata、description、分 P pages 和 chapters 生成安全节点。
- metadata / description 节点不带跳转时间，不声称理解完整视频正文。
- page / chapter 节点只使用真实分 P 或章节来源，并提供 manual jump preview；跳转前需要用户确认。
- auto-jump 不启用。没有 transcript 时，不生成 AI key-node extraction，也不伪造时间戳。

## Dynamic Bill 定位保持不变

动态账单继续面向 **兴趣再平衡**：帮助用户在打开 B 站关注动态前，看见长期兴趣、近期关注度下降或被近期口味覆盖的已关注视频投稿。

它不是推荐排序、点击预测或 B 站动态页替代品。它不改写 B 站原生动态排序，不以提升点击率或观看时长为目标，也不会替用户修改关注、收藏、评论、点赞或投币状态。

## AI 功能与本地 fallback

0.10.0-alpha 的 AI 能力都是可选增强，不是核心功能可用性的前提。

- 不填写 OpenAI 兼容 API Key 时，观看历史分析、创作者分析、动态账单本地证据、收藏同步、Smart Favorites 本地检索、Current Video metadata / description summary 和 Video Knowledge v0 仍可使用。
- 启用 AI 后，AI 请求只应包含当前任务所需的最小上下文，例如当前视频的有限元数据 / 简介、Smart Favorites 本地召回的 top cited videos，或动态账单单条项目的紧凑证据。
- AI 不接收完整观看历史、完整收藏列表、完整关注列表、完整 feedback 记录、Cookie、API key、本地 key 文件路径、浏览器 profile、B 站 login-state 或完整本地数据库。
- AI 不决定动态账单入选、排序、状态推进或反馈 suppression；这些仍由本地规则处理。

## 隐私与安全边界

Bili-Bill 0.10.0-alpha 的边界如下：

- 不读取本地 key 文件、Cookie 文件、浏览器 profile 文件、B 站 login-state 文件或个人资料文件。
- 不上传完整观看历史、完整收藏列表、完整收藏夹结构、完整关注列表、完整 feedback 记录、完整本地笔记或完整本地数据库。
- 不写回 B 站关注、收藏或互动关系；不关注、取关、移动收藏、删除收藏、评论、点赞、投币或修改 B 站原生设置。
- 需要真实登录态的同步仍必须由用户明确在扩展运行时中执行，例如在当前浏览器 Profile 已登录 B 站后点击同步按钮；开发和 QA 不应从磁盘提取登录凭据。
- AI 配置保存在浏览器本地存储中；是否配置、启用或调用 AI 由用户决定。

## 安装与升级

0.10.0-alpha 仍按 unpacked extension 方式进行内测。

1. 使用测试用浏览器 Profile，并按需在该 Profile 中登录 B 站。
2. 切换到 release owner 提供的 0.10.0-alpha 对应代码或构建来源。
3. 安装依赖并构建：

   ```bash
   npm install
   npm run build
   ```

4. 打开 Chrome/Edge 的 `chrome://extensions`。
5. 开启“开发者模式”。
6. 首次安装时点击“加载已解压的扩展程序”，选择项目 `dist/` 目录。
7. 已安装开发版时，在扩展卡片上点击“重新加载”。
8. 打开 Popup 或 Dashboard，按需同步观看历史、收藏夹或动态账单数据。涉及 B 站登录态的数据同步只通过扩展运行时发起。

## 已知限制

- `0.10.0-alpha` 是内测 prerelease，不是 Chrome Web Store 正式发布包。
- 当前 release notes PR 不创建 tag、不发布 GitHub Release、不生成 zip、不修改 manifest 或版本号。
- B 站历史、收藏、关注关系、动态和视频详情接口的返回范围由 B 站决定；接口不返回的数据，Bili-Bill 无法凭空恢复。
- Smart Favorites Q&A 第一版不做 transcript extraction 或 content QA；没有正文、字幕或可靠 transcript 时，不回答视频正文细节。
- Current Video Assistant 当前只支持 metadata summary 和 description summary 的安全降级；transcript summary 需要后续可靠字幕 / transcript 来源。
- Video Knowledge v0 不做 AI key-node extraction；只使用 metadata、description、分 P 和 chapters 等已有结构化来源。
- auto-jump 不启用；page / chapter 跳转需要 manual preview 和用户确认。
- 真实登录态同步仍需要用户明确通过扩展运行时操作；开发和 QA 不读取本地 Cookie、profile 或 login-state 文件。
- AI 请求失败、模型返回异常、权限不足或 MV3 Service Worker 中断时，AI 生成内容可能缺失，但本地 fallback 应继续可用。
- 生产构建仍可能出现既有 Vite large chunk warning，主要是构建体积 hygiene 问题；只要构建完成，它不是本次 alpha 的功能阻塞项。

## 内测反馈建议

- Smart Favorites：同步诊断是否能解释收藏覆盖不足；Q&A 的引用视频、命中原因和低置信提示是否足够清楚。
- Current Video Assistant：metadata summary / description summary 的来源标签是否清晰；没有 transcript 时是否避免了完整视频总结误解。
- Video Knowledge v0：分 P / 章节节点和 manual jump preview 是否容易理解；是否有任何节点看起来像伪造时间戳。
- Creator Relationships：已关注、未关注、未知三类是否符合你对当前本地快照覆盖的理解。
- Interest Drift：日、周、月颗粒度是否能帮助区分短期波动和长期兴趣变化。
- Dynamic Bill：是否仍能理解它是兴趣再平衡，而不是推荐排序或点击预测。
