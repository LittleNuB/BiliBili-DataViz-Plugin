# Bili-Bill video knowledge base PRD / spike

## 1. 背景与目标

Issue #39 关注长视频场景：用户希望在当前视频页快速看到可靠的关键节点，并能从节点手动跳转到对应播放位置；后续可以在更严格的约束下提供可选的自动跳转建议。

本 PRD/spike 不实现字幕抓取、AI 调用、message action、DB schema 或 content script 改动。目标是先定义视频知识库、关键节点与跳转动作的证据边界，避免在没有 transcript、字幕或结构化章节时伪造时间戳，也避免把 metadata/description summary 包装成完整视频理解。

核心原则：

- 关键节点必须能说明来源：metadata、description、分 P、章节、字幕/transcript、用户手动笔记/书签或本地观看记录。
- 没有字幕/transcript 时，不生成声称来自视频正文的时间戳，也不输出完整视频总结。
- 有分 P/章节时，只能引用这些结构本身的时间或标题，不能推断章节内部讲了什么。
- 有字幕/transcript 时，关键节点必须绑定字幕片段或 transcript span，AI 只能围绕证据片段提炼标题、原因和置信度。
- 跳转默认是手动动作；任何自动跳转建议都必须默认关闭，并在用户确认后才触发。

## 2. 与 #37 AI assistant 的关系

#37 已定义 AI assistant 的总入口、source labeling、fallback 和最小 payload 原则。本 PRD 是 #37 的 current-video 能力增强模块，专门回答：什么时候可以从 metadata/description summary 升级到 transcript summary，以及哪些关键节点可以被拿来跳转。

分工如下：

| 范围 | #37 AI assistant | #39 Video knowledge base |
| --- | --- | --- |
| 当前视频帮助 | 定义 intent、入口、fallback、隐私边界 | 证明当前视频正文来源是否可靠，生成可跳转 key nodes |
| metadata/description summary | 允许，但必须标注低到中置信度 | v0 可使用，不生成伪造正文时间戳 |
| transcript summary | 仅当后续能可靠取得 transcript 时使用 | v1 负责定义 transcript 可用性、span 绑定和降级规则 |
| 跳转动作 | #37 只要求跳转由用户明确触发 | #39 细化手动跳转、预览、回退、可选 auto-jump safeguards |
| AI payload | 最小必要上下文 | 只发送当前视频必要字段、用户选中的字幕片段或 top node candidates |

因此，#39 不是新的推荐排序系统，也不是把 AI assistant 变成视频播放器控制器。它只给 current-video assistant 提供可审计的文本证据和可确认的导航动作。

## 3. 分阶段路线

### v0: metadata / description / 分 P / 章节 helper

目标：在没有 transcript 的情况下提供安全的结构化辅助。

可用输入：

- 当前页 BVID、CID、页码、标题、UP、时长。
- B 站视频详情中的简介、标签、分区、发布时间、统计信息。
- 分 P/pages 标题、页码、cid、时长。
- 章节/chapters 标题和 startSeconds，如果页面或接口明确提供。
- 本地播放器进度、seek、pause、heartbeat 记录。

允许输出：

- “基于标题/简介/标签/分 P/章节”的概要和观看建议。
- 分 P 或章节列表的导航辅助。
- 当前观看进度附近的结构化上下文。

禁止输出：

- 没有章节或分 P 时生成任意 timestamp。
- 把简介推断成视频正文内容。
- 声称“视频在某一秒讲到某观点”，除非该秒来自真实章节或 transcript。

### v1: 字幕 / transcript 可用时提取关键节点

目标：在字幕/transcript 可用且可标注来源时，生成真正的关键节点。

可用输入：

- v0 全部输入。
- 字幕/transcript 可用性、语言、来源、更新时间或内容 hash。
- 字幕片段：startSeconds、endSeconds、text、language、source。
- 可选的用户选中片段或 top candidate spans。

允许输出：

- 绑定字幕片段的关键节点。
- transcript summary，必须标注“根据字幕/transcript”。
- 节点级跳转按钮，跳转到字幕片段起点或前置 buffer。

禁止输出：

- 从 transcript 之外补全画面、弹幕、评论或音频内容。
- transcript language mismatch 时强行总结。
- transcript 缺口较大时给出高置信完整总结。

### v2: 用户手动 notes / bookmarks 与本地视频知识库

目标：让用户把自己确认过的时间点沉淀成本地知识。

可用输入：

- 用户手动创建的笔记、书签、标签、引用片段。
- 关联 bvid、cid、page、timestamp、createdAt、updatedAt。
- 本地观看记录与播放器事件。
- v0/v1 产生且用户保存的 key nodes。

允许输出：

- 本地视频知识库中的个人节点。
- “我标过的重点”“上次看到这里”“这段我写过笔记”等本地辅助。
- 与当前视频、同 UP 或同收藏项相关的已保存节点。

禁止输出：

- 把本地笔记上传为默认 AI 上下文。
- 自动把 AI 生成节点写入知识库；需要用户保存或明确启用。
- 读取浏览器 profile、Cookie、key 文件或 B 站登录态文件来补全知识库。

### v3: 可选 auto-jump suggestions

目标：在用户明确启用后，提供自动跳转建议，但不默认执行。

约束：

- 默认关闭。
- 只在高置信 transcript node、用户保存的 bookmark、或明确章节节点上提供。
- 必须先展示预览：将跳到哪里、来源是什么、为什么建议跳转。
- 必须用户确认后触发跳转。
- 跳转后必须提供返回上一播放位置的动作。
- 播放器正在缓冲、直播、试看、广告、全屏交互或用户刚手动 seek 时，不触发建议。

## 4. 数据源与可信等级

| 数据源 | 示例字段 | 可信用途 | 不允许推断 |
| --- | --- | --- | --- |
| 标题 | title | 主题线索、metadata summary | 正文细节和时间点 |
| 简介 | description | description summary、UP 自述范围 | 未出现在简介中的视频正文 |
| 标签/分区 | tags、category | 主题线索、检索辅助 | 节点时间戳 |
| UP | authorName、authorMid | 来源、创作者上下文 | 用户一定喜欢或必须观看 |
| 分 P/pages | page、cid、title、duration | 分段导航、页级 key node | 分 P 内部正文 |
| 章节/chapters | title、startSeconds | 章节导航、结构化 timestamp | 章节标题之外的论点 |
| 字幕/transcript | text、start/end、language、source | transcript summary、关键节点、证据 span | 画面、评论、弹幕、音频情绪 |
| 播放器进度 | currentTime、duration、seek events | 当前位置、回退点、观看上下文 | 内容理解 |
| 用户笔记/书签 | note、timestamp、tags | 用户确认的本地知识 | 代表所有用户的客观重点 |
| 本地观看记录 | completion、watchedAt、playerEvents | 上次观看、已看区间 | 视频正文含义 |

source label 必须是枚举或稳定字符串，例如：

- `metadata`
- `description`
- `page`
- `chapter`
- `transcript`
- `user_bookmark`
- `user_note`
- `local_watch_event`
- `local_fallback`

## 5. Key node 输出 schema

建议 schema：

```json
{
  "id": "node:bvid:cid:source:start",
  "bvid": "BV...",
  "cid": 123456,
  "page": 1,
  "timestamp": 312.4,
  "endTimestamp": 356.2,
  "title": "关键节点标题",
  "reason": "为什么这是一个节点",
  "source": "transcript",
  "confidence": 0.86,
  "evidence": {
    "textSpan": "字幕或简介中的短证据片段",
    "startChar": 0,
    "endChar": 24,
    "language": "zh-CN",
    "sourceId": "subtitle:zh-CN:hash"
  },
  "jumpAction": {
    "type": "seek",
    "targetSeconds": 309.4,
    "previewLabel": "跳到 05:09",
    "requiresConfirmation": true,
    "returnPointSeconds": 128.7
  },
  "safetyFlags": [
    "transcript_bound",
    "manual_confirm_required"
  ],
  "createdAt": 1780848000000,
  "updatedAt": 1780848000000
}
```

字段规则：

- `timestamp` 必须来自章节、分 P、字幕/transcript 或用户手动保存的时间点。
- `title` 可以由 AI 改写，但不能超出 evidence 表达的事实范围。
- `reason` 必须说明节点来源，例如“字幕片段出现了定义/结论/步骤切换”。
- `confidence` 表示证据完整度和节点质量，不表示视频质量。
- `evidence.textSpan` 对 transcript node 必填；metadata/page/chapter node 可以为空，但必须有 source。
- `jumpAction.requiresConfirmation` 在 v0-v3 都默认为 true。
- `safetyFlags` 用于 UI 降级和审计，例如：
  - `metadata_only`
  - `description_only`
  - `page_bound`
  - `chapter_bound`
  - `transcript_bound`
  - `user_confirmed`
  - `low_confidence`
  - `language_mismatch`
  - `stale_source`
  - `manual_confirm_required`
  - `auto_jump_disabled`

## 6. 关键节点生成边界

### 无 transcript

- 只显示 metadata/description summary。
- 不生成 transcript key nodes。
- 不生成任意 timestamp。
- 如果有分 P，则可显示分 P 节点，source=`page`。
- 如果有章节，则可显示章节节点，source=`chapter`。
- UI 必须显示“没有可用字幕/transcript，本结果只基于标题、简介、标签、分 P 或章节”。

### 有分 P / 章节

- 分 P 节点的 timestamp 只能是该 P 起点或播放器可跳转到的页级入口。
- 章节节点的 timestamp 只能是章节 startSeconds。
- 节点标题可使用原始分 P/章节标题，AI 只可做轻量整理。
- 不把分 P/章节标题扩写为正文理解。

### 有字幕 / transcript

- 关键节点必须绑定字幕 span。
- 节点 timestamp 默认取 span startSeconds，可加 2-5 秒 pre-roll。
- 如果字幕语言与用户请求语言不匹配，必须标注并降低置信度，或要求用户确认是否继续。
- 如果 transcript 缺失片段、时间轴异常、文本过短或重复严重，必须降级为 low confidence。
- 如果字幕来源或 hash 变化，旧节点标记为 stale，不直接作为高置信节点使用。

## 7. Jump UX

### 手动跳转

节点卡片提供手动跳转按钮：

- 展示目标时间、来源、证据片段和置信度。
- 点击前可展开预览，说明“将跳到 05:09，来源：字幕片段”。
- 执行 seek 前记录 returnPointSeconds。
- 跳转后提供“返回上一位置”动作。
- 不改变播放速度、音量、弹幕、全屏状态或用户原有播放器设置。
- 如果播放器不可用、CID 不匹配、页面已切换或视频时长变化，跳转按钮禁用并提示原因。

### 键盘与播放器状态

- 键盘快捷键只在用户焦点位于视频助手区域时生效。
- 不抢占 B 站播放器原生快捷键。
- 播放器暂停时跳转后保持暂停；播放中跳转后保持播放，除非浏览器或播放器限制。
- 正在 seek、buffering、广告态、直播态、互动视频或番剧特殊播放器时，先进入 preview-only。

### Auto-jump suggestions

自动跳转建议不是默认功能。即使 v3 启用，也遵守：

- 默认关闭。
- 用户为当前视频或全局设置明确启用。
- 每次建议展示 preview，不直接 seek。
- 必须点击确认才跳转。
- 只允许来源为 `transcript`、`chapter` 或 `user_bookmark` 的高置信节点。
- 低置信、metadata-only、description-only 节点禁止进入 auto-jump。
- 跳转后 10-30 秒内不再弹出新建议，避免打断观看。

## 8. 本地存储边界

建议把视频知识库视为本地 IndexedDB 的独立域，但本 PRD 不新增 schema。后续实现可以按以下边界切片：

- `videoKnowledgeSources`：记录 bvid、cid、sourceType、language、contentHash、fetchedAt、sourceUpdatedAt。
- `videoKeyNodes`：记录节点 schema、source hash、confidence、stale 状态。
- `videoBookmarks`：记录用户手动书签、timestamp、title、note、tags。
- `videoNotes`：记录用户手动笔记、可选引用 nodeId 或 transcript span。

关联规则：

- 所有节点必须关联 bvid。
- 可跳转节点必须关联 cid；多 P 视频还要记录 page。
- transcript 相关节点必须关联 transcript source hash。
- 当视频详情、CID、分 P、章节或 transcript hash 变化时，旧节点标记 `stale_source`。
- stale 节点仍可展示为历史笔记或用户书签，但不作为高置信 AI 节点或 auto-jump candidate。
- 用户手动笔记/书签优先保留，不因 transcript stale 自动删除。

存储非目标：

- 不写回 B 站。
- 不把 AI 生成节点默认保存为用户笔记。
- 不同步到云端，除非后续单独定义用户主动导出/备份流程。
- 不读取本地 key 文件、Cookie、浏览器 profile 或 B 站登录态文件。

## 9. 隐私与 AI payload

隐私边界沿用 #37，并在视频知识库场景收紧：

- 不读取 Cookie、key、浏览器 profile、B 站登录态文件、用户个人资料文件。
- 不上传完整历史、完整收藏、完整关注列表、完整本地知识库或完整用户笔记。
- 不上传弹幕、评论或画面识别结果，除非后续 issue 单独定义来源、授权和降级规则。
- AI payload 只发送当前回答必要上下文：
  - 当前视频 metadata。
  - 用户当前选中的字幕片段。
  - 本地检索出的 top node candidates。
  - 必要的 source labels、confidence 和 evidence spans。
- 对 key-node 提取，优先在本地完成候选 span 选择，再把 top candidates 发送给 AI 做标题和原因提炼。
- AI 输出必须经过 schema 校验；不能引入 payload 中不存在的 timestamp。

示例最小 payload：

```json
{
  "intent": "current_video_key_nodes",
  "video": {
    "bvid": "BV...",
    "cid": 123456,
    "page": 1,
    "title": "视频标题",
    "durationSeconds": 1800,
    "authorName": "UP 主",
    "tags": ["tag-a", "tag-b"]
  },
  "availableSources": {
    "metadata": true,
    "description": true,
    "pages": true,
    "chapters": false,
    "transcript": true
  },
  "candidateSpans": [
    {
      "startSeconds": 300.1,
      "endSeconds": 340.2,
      "text": "字幕片段",
      "language": "zh-CN",
      "sourceHash": "abc123"
    }
  ]
}
```

## 10. 与 #38 Smart Favorites Q&A 的关系

#38 第一版可以继续基于收藏视频 metadata、简介、UP、分区、标签和智能索引做 Q&A，不依赖 transcript QA。

未来关系：

- 收藏 Q&A 可以引用视频知识库节点，但必须显示节点来源。
- 如果收藏视频没有 transcript，只能引用 metadata/description/page/chapter 或用户手动笔记。
- 收藏 Q&A 不应为了回答问题上传完整收藏夹或完整视频知识库。
- #38 的检索结果可以跳转到视频；#39 的节点结果可以进一步跳到视频内时间点。

#39 不改变 #38 第一版验收范围，也不把视频知识库定位成自动推荐或排序系统。

## 11. 失败与低置信 UX

| 状态 | 触发 | UX |
| --- | --- | --- |
| no transcript | 当前视频没有可用字幕/transcript | 显示 metadata/description summary，禁用 transcript nodes |
| metadata only | 只有标题、UP、标签、时长等 | 标注低置信，不显示正文时间戳 |
| description only | 有简介但无字幕 | 标注“基于简介”，不声称完整视频总结 |
| transcript unavailable | 字幕接口失败、权限不足或网络失败 | 保留 v0 helper，提供重试 |
| subtitle language mismatch | 字幕语言与请求不匹配 | 降低置信或要求用户确认 |
| low confidence | span 太短、重复、来源少或时间轴异常 | 节点折叠到“低置信候选”，禁用 auto-jump |
| request failed | AI 请求失败 | 展示本地候选和证据 fallback |
| local fallback | AI 未配置、禁用或失败 | 显示来源、可用范围和缺失项 |
| stale source | transcript 或视频结构变化 | 标记旧节点，不作为高置信跳转建议 |
| player unavailable | 找不到 video element 或 CID 不匹配 | 禁用跳转，保留节点文本 |

## 12. 风险分级

### Blocker

- 无 transcript 时生成伪造 timestamp。
- AI 输出 payload 中不存在的时间点并被 UI 接受。
- 自动跳转默认开启或未确认就 seek。
- 跳转到错误 CID、错误分 P 或错误视频。
- 读取本地 key、Cookie、browser profile 或 B 站登录态文件。

### Must-fix before implementation ships

- transcript node 缺少 evidence span。
- source label 不可见或与实际来源不一致。
- low confidence 节点仍可进入 auto-jump。
- stale transcript 节点未降级。
- AI payload 包含完整历史、完整收藏、完整关注或完整本地笔记。
- 跳转后没有返回上一位置。
- 播放器状态被意外改变。

### Follow-up

- 多语言 transcript 合并与翻译策略。
- 章节、分 P、字幕三类节点的去重和排序。
- 用户笔记导出/导入。
- 长 transcript 的本地 chunking 与候选 span 选择。
- 对互动视频、番剧、直播回放等特殊播放器的适配。
- 节点质量评估与用户反馈闭环。

## 13. 后续 implementation issue 切片建议

以下只是建议切片，不在本 PRD 中创建 GitHub issues：

1. 当前视频上下文 contract：定义 content script 到 background 的当前视频 metadata、分 P、章节和 source availability payload。
2. 字幕/transcript 来源 spike：调研 B 站字幕可用性、语言、时间轴、权限、失败状态和 source hash。
3. v0 视频 helper UI：在当前视频页展示 metadata/description/分 P/章节 helper 和 no transcript 状态。
4. Key node schema 与本地候选生成：实现 schema 校验、source labels、confidence 和 safety flags。
5. Transcript key-node extraction：只对绑定字幕 span 的候选生成节点，并提供 transcript summary 升级路径。
6. Manual jump UX：节点预览、确认跳转、return point、播放器状态保护和错误状态。
7. 用户书签与笔记：本地保存 user_bookmark/user_note，并关联 bvid/cid/page/timestamp。
8. Stale source handling：视频结构或 transcript hash 变化后的降级和重新生成流程。
9. Privacy payload audit：测试 AI payload 不包含完整历史、完整收藏、完整关注、Cookie、用户 mid、个人资料、key 路径或完整笔记。
10. Auto-jump suggestions guarded MVP：默认关闭，只对高置信 transcript/chapter/user_bookmark 节点展示确认式建议。

## 14. 验收标准

- PRD 明确 #39 是 #37 current-video transcript/key-node 来源证明与增强模块。
- PRD 覆盖 v0-v3 路线，且从安全手动辅助逐步走向可选自动跳转建议。
- PRD 定义数据源、关键节点 schema、jump UX、本地存储、隐私边界、失败状态和风险分级。
- PRD 明确无 transcript 不生成伪造 timestamp，也不声称完整视频理解。
- PRD 明确有分 P/章节只能引用这些结构，有字幕时节点必须绑定字幕片段。
- PRD 明确 #38 第一版不依赖 transcript QA，未来可引用视频知识库节点。
- PRD 只新增文档，不实现 transcript 抓取、message action、DB schema、AI 调用或 content script 改动。
