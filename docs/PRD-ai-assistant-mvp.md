# Bili-Bill AI assistant MVP PRD / spike

## 1. 背景

0.9.0-alpha 已经把 Bili-Bill 从单一观看历史面板扩展为本地内容账单工具，覆盖观看历史、智能收藏、创作者关系和动态账单。当前 popup 首屏仍偏向同步入口和统计摘要，用户反馈希望有一个更主动的对话入口，例如在 B 站视频页询问“总结当前视频”。

本 PRD/spike 的目标不是直接实现助手 UI 或新增 AI 调用，而是定义 v1 助手能安全回答什么、必须拒答或降级什么、每类问题允许使用哪些本地数据，以及哪些状态必须 fallback。核心原则是：没有字幕、正文或 transcript 时，助手不能假装已经理解完整视频内容。

## 2. 产品定位

Bili-Bill AI assistant 是 Bili-Bill 的本地账单与知识辅助入口。它把用户已经授权给 Bili-Bill 的本地数据、当前页面元数据、智能收藏索引和动态账单证据组织成可追问的解释，不替代 B 站推荐、搜索、动态流或创作者关系管理。

v1 需要坚持三条边界：

- 证据优先：回答必须标注信息来自当前视频元数据、简介、字幕/transcript、本地收藏索引、动态账单证据或聚合观看数据。
- 最小上下文：AI 请求只发送当前回答所需的紧凑 payload，不上传完整历史、完整收藏、完整关注或反馈全集。
- 明确降级：信息不足时输出可用范围和缺失项，不补写来源不存在的完整视频理解。

## 3. 入口设计

### 3.1 v1 推荐入口

1. 当前视频页侧边栏或 side panel：最高优先级。它最贴近“总结当前视频”“这条视频适合我吗”“找相关收藏”的即时任务，并能直接读取当前页 BVID/CID、标题、分 P、UP、时长等上下文。
2. Dashboard 助手入口：用于跨模块追问，例如解释动态账单、查收藏、问观看偏好。Dashboard 已经承载智能收藏和动态账单，适合作为长回答和证据展开的主界面。
3. Popup 轻入口：只作为“打开助手/当前页助手”的启动器和少量快捷 prompt，不在 v1 中承载复杂长对话。

### 3.2 v1 非目标入口

- 不把 popup 改造成完整聊天应用首屏。
- 不在 B 站首页现有 sidebar-card 中直接塞入长对话。现有卡片定位是消费小结，视频助手应优先出现在视频页或浏览器 side panel。
- 不默认自动跳转到 Dashboard 或 B 站页面。跳转必须由用户明确点击。
- 不注入完整替代信息流，也不重排 B 站原生页面。

## 4. v1 intents

### 4.1 当前视频：摘要、解释、观看建议

用户问题示例：

- “总结当前视频。”
- “这条视频讲什么？”
- “我需要看完整吗？”
- “帮我解释标题和简介。”

可用数据源：

- content script 当前页上下文：BVID、CID、分 P 序号、标题、时长、UP mid/name。
- B 站视频详情接口补全：标题、简介、UP、分区、标签、封面、发布时间、统计、分 P/章节字段（若接口或页面状态可用）。
- 用户授权的局部本地上下文：该 BVID 的本地观看记录、收藏状态、与该 UP/分区/标签相关的聚合偏好。
- 可选字幕/transcript：仅当后续实现能可靠取得并标注来源时使用。v1 PRD 不假设当前已有字幕采集能力。

最小 payload：

```json
{
  "intent": "current_video_help",
  "video": {
    "bvid": "BV...",
    "cid": 123,
    "title": "...",
    "description": "...",
    "authorName": "...",
    "authorMid": 123,
    "category": "...",
    "tags": ["..."],
    "durationSeconds": 600,
    "pageTitle": "...",
    "parts": [{"page": 1, "title": "...", "durationSeconds": 120}],
    "chapters": [{"title": "...", "startSeconds": 0}]
  },
  "availableSources": {
    "metadata": true,
    "description": true,
    "transcript": false,
    "localWatchSignals": true
  },
  "localContext": {
    "watchedThisVideo": true,
    "completionRate": 0.42,
    "relatedAggregateSignals": ["过去 180 天看过该 UP 3 次"]
  }
}
```

隐私边界：

- 不读取 Cookie、登录态文件、浏览器 profile 或本地 key 文件。
- 不发送完整观看历史，只发送与当前视频直接相关的聚合信号或极少量证据句。
- 不发送弹幕、评论或画面识别结果，除非后续 issue 单独定义数据源、授权和降级方式。

fallback：

- AI 未配置：展示本地模板回答，说明只基于元数据/简介/本地聚合信号。
- AI 禁用：同上，并提示可在配置中启用 AI 生成。
- AI 请求失败：保留本地证据 fallback，允许重试。
- 视频详情补全失败：只使用页面可读的 BVID、标题、UP、时长，并标注“视频详情不可用”。
- 无字幕/transcript：只能总结标题、简介、标签、分 P/章节等可见文本，不能写“本视频完整讲了”或“视频中详细说明了”这类完整内容判断。

### 4.2 找相关收藏

用户问题示例：

- “找我收藏过的类似视频。”
- “有没有收藏过同一个 UP 的内容？”
- “我记得收藏过一个讲类似主题的视频。”

可用数据源：

- `favoriteItems`：收藏视频标题、简介、UP、原收藏夹、分区、标签、时长、收藏时间。
- `smartFavoriteIndex`：AI 分类路径、摘要、关键词、别名、可检索文本。
- 当前视频元数据作为查询上下文。

最小 payload：

```json
{
  "intent": "find_related_favorites",
  "query": "...",
  "currentVideoHints": {
    "title": "...",
    "authorName": "...",
    "category": "...",
    "tags": ["..."]
  },
  "retrievedFavorites": [
    {
      "bvid": "BV...",
      "title": "...",
      "authorName": "...",
      "folderTitle": "...",
      "smartPath": ["知识", "历史"],
      "summary": "...",
      "matchReasons": ["标题相关", "AI关键词相关"]
    }
  ]
}
```

隐私边界：

- 检索在本地先完成；AI 只接收 top N 结果的必要字段和匹配原因。
- 不上传完整收藏列表、完整收藏夹结构或未命中的收藏项。
- 不写回 B 站收藏夹，不创建、移动、删除或重命名收藏。

fallback：

- 智能索引不存在或失败：退回本地元数据检索，基于标题、简介、UP、分区、标签和原收藏夹匹配。
- AI 未配置/禁用/失败：展示本地检索结果、匹配原因和跳转按钮。
- 收藏未同步：提示先同步收藏夹；不凭空生成“你可能收藏过”的结果。

### 4.3 动态账单追问

用户问题示例：

- “为什么这条动态账单出现？”
- “这条算久违更新还是换换口味？”
- “AI 解释失败时本地证据是什么？”

可用数据源：

- `dynamicBillItems`：栏目、状态、新视频证据、长期/近期窗口、关注证据、阈值、分数和本地排序。
- `dynamicBillExplanations`：已生成、失败、未配置或禁用状态下的解释/fallback。
- `dynamicBillFeedback`：仅使用与该账单项相关的本地少提醒摘要，不发送完整反馈记录。

最小 payload：

```json
{
  "intent": "dynamic_bill_follow_up",
  "billKey": "...",
  "column": "afk_update",
  "status": "opened",
  "video": {
    "title": "...",
    "authorName": "...",
    "category": "...",
    "tags": ["..."]
  },
  "localEvidence": {
    "facts": ["过去 180 天看过该 UP 12 次", "最近 30 天 0 次"],
    "thresholds": ["长期正反馈不少于 3 次"],
    "follow": "已关注，关注时长未知"
  },
  "aiExplanationStatus": "failed"
}
```

隐私边界：

- 只引用已入选账单项和紧凑证据事实。
- 不上传完整历史、完整关注列表、用户 mid、个人资料、Cookie 或反馈全集。
- AI 不决定入选、排序、状态推进或少提醒规则。

fallback：

- AI 未配置/禁用/失败：展示本地证据 fallback。
- 本地证据不足：明确提示是本地数据不足，而不是补写原因。
- 账单项已过期或不存在：提示刷新/重新生成，不自动同步或跳转。

### 4.4 观看历史/偏好问答

用户问题示例：

- “我最近是不是只看某一类内容？”
- “这个 UP 和我的长期偏好匹配吗？”
- “最近一个月我看知识区多吗？”

可用数据源：

- 聚合观看数据：自然周/月、分区/标签占比、有效观看、连续观看、本机 PC 播放增强。
- 局部证据：用户明确追问的 UP、分区、标签、视频或时间窗口。
- 动态账单已计算的长期/近期窗口摘要，若问题与账单项相关。

最小 payload：

```json
{
  "intent": "watch_preference_qa",
  "question": "...",
  "window": {"kind": "month", "days": 30},
  "aggregates": [
    {"label": "知识", "watchSeconds": 3600, "videoCount": 12, "share": 0.28}
  ],
  "localEvidence": ["最近 30 天知识区占比 28%"]
}
```

隐私边界：

- 默认只发送聚合值和少量证据句。
- 只有用户明确选择“引用具体视频”时，才发送少量相关视频标题/BVID/UP 作为证据。
- 不上传完整历史表、完整导出文件或跨账号数据。

fallback：

- 历史数据不足：输出“本地覆盖不足”并标注可用时间范围。
- 用户关闭历史或接口不返回更早数据：不推断缺失时期。
- AI 未配置/禁用/失败：展示本地聚合图表/指标解释。

## 5. 当前视频总结输出分级

当前视频回答必须按来源分级标注，不允许把低级来源包装成完整内容总结。

| 等级 | 来源 | 允许表达 | 禁止表达 | 置信度建议 |
| --- | --- | --- | --- | --- |
| Metadata summary | 标题、UP、分区、标签、时长、发布时间、分 P/章节标题 | “从元数据看，这可能是...” “适合先关注...” | “视频完整讲述了...” “作者在视频中证明了...” | 低到中 |
| Description summary | 元数据 + 简介文本 | “简介显示...” “可概括为...” | 声称覆盖未出现在简介或元数据中的正文内容 | 中 |
| Transcript summary | 元数据 + 简介 + 字幕/transcript | “根据字幕...” “视频内容主要包括...” | 超出字幕证据的画面、评论、弹幕判断 | 中到高 |

UI 必须显示：

- 来源标签：元数据 / 简介 / 字幕。
- 置信度：低 / 中 / 高，或 0-100%，但必须解释它只表示回答证据完整度，不表示视频质量。
- 缺失提示：例如“没有可用字幕，本回答只基于标题、简介和标签。”
- 可追问建议：例如“要不要找相关收藏？”“要不要只看简介重点？”

## 6. UX 状态

| 状态 | 触发 | 用户可见行为 |
| --- | --- | --- |
| AI not configured | `ai.apiKey` 为空 | 展示本地证据 fallback，提示配置 OpenAI-compatible API 后可生成自然语言解释 |
| AI disabled | 用户关闭助手 AI 或动态账单 AI 解释 | 不发起 AI 请求，展示本地证据和可启用入口 |
| Request failed | AI 请求超时、模型错误、MV3 中断或权限失败 | 保留本地证据，显示失败原因摘要和重试按钮 |
| Local evidence fallback | AI 不可用或不需要 AI | 明确标注“本地证据 fallback”，列证据来源 |
| No transcript | 当前视频无可用字幕/transcript | 回答降级为元数据/简介摘要，并禁止完整视频总结措辞 |
| Low confidence | 来源少、简介短、标签缺失或本地覆盖不足 | 标注低置信度，给出缺失项和建议下一步 |
| Loading | 正在读取视频详情、检索收藏、生成回答 | 显示可取消状态，不锁死页面 |
| Cancel | 用户取消请求 | 停止后续 AI 请求或忽略返回结果，保留已取到的本地证据 |

## 7. 非目标和安全边界

v1 明确不做：

- 不读取 Cookie、浏览器 profile、登录态文件、用户个人资料文件或 `C:\Users\LittleNub\Desktop\Key.txt`。
- 不上传完整观看历史、完整收藏列表、完整关注列表、完整反馈记录或完整本地数据库。
- 不下载视频、不识别画面、不分析音频。
- 不抓取或上传弹幕、评论，除非后续 issue 单独定义授权、来源标注和降级规则。
- 不写回 B 站，不修改关注关系，不改收藏夹，不发评论，不点赞投币收藏。
- 不伪造 full-video summary。没有字幕/transcript/正文时，只能输出元数据或简介摘要。
- 不默认自动跳转到 B 站或 Dashboard。
- 不把动态账单定位成 B 站推荐替代；动态账单仍是兴趣再平衡和本地证据解释入口。
- 不新增 message action、DB schema、AI 调用、UI 实现、release/tag。

## 8. 与 #38 / #39 的关系

- #37：定义总入口、v1 intent、数据最小化、来源标注、降级策略和安全边界。本 issue 只交付 PRD/spike 文档。
- #38 Smart Favorites Q&A：在 #37 边界下实现收藏问答和检索增强。它应复用本 PRD 的 top N 检索、来源标注、AI fallback 和“不上传完整收藏列表”原则。
- #39 Video Knowledge Base：在 #37 边界下研究字幕/transcript、视频详情、章节、分 P 和当前视频知识库。它负责证明哪些正文来源可靠，才能把当前视频总结从 metadata/description 提升到 transcript summary。

## 9. 后续 implementation issue 切片建议

以下只是建议切片清单，等待主 Agent 或用户确认后再创建 GitHub issues：

1. 当前视频上下文 contract：定义 content script 到 background 的当前视频 payload，覆盖 BVID/CID、标题、UP、分 P、章节、简介可用性和来源标记。
2. 视频助手 side panel MVP：视频页入口、快捷 prompt、loading/cancel、AI 未配置/禁用/失败和 no transcript 状态。
3. 当前视频摘要分级实现：metadata summary 和 description summary 先落地，transcript summary 仅在 #39 证明来源后启用。
4. Smart Favorites Q&A：本地 top N 检索、AI query rewrite、结果证据引用、无 AI fallback，对齐 #38。
5. 动态账单追问：从账单详情页进入助手，复用 `dynamicBillItems` 和 `dynamicBillExplanations` 的本地证据。
6. 观看偏好 Q&A：只用聚合数据和用户授权的局部证据，提供可解释窗口和覆盖不足提示。
7. 隐私 payload audit：为每个 intent 增加测试或日志审计，确保 AI 请求不包含完整历史、完整收藏、完整关注、Cookie、用户 mid、个人资料或本地 key 路径内容。
8. Assistant UX 状态 QA：覆盖 AI not configured、disabled、request failed、local evidence fallback、no transcript、low confidence、loading/cancel。

## 10. 验收标准

- PRD 明确 AI assistant 是 Bili-Bill 的本地账单/知识辅助入口，不替代 B 站推荐或搜索。
- PRD 覆盖 popup、Dashboard、当前视频页侧边栏/side panel 的入口优先级和非目标入口。
- PRD 覆盖当前视频、找相关收藏、动态账单追问、观看历史/偏好问答四类 v1 intents。
- 每个 intent 都列出数据源、最小 payload、隐私边界和 AI 未配置/禁用/失败 fallback。
- 当前视频总结明确分为 metadata summary、description summary、transcript summary，并标注来源和置信度。
- 无字幕/transcript 时必须降级，不能声称总结或理解完整视频内容。
- UX 状态覆盖 AI not configured、disabled、request failed、local evidence fallback、no transcript、low confidence、loading/cancel。
- 非目标明确包含不读取 Cookie/key/profile、不上传完整历史/收藏/关注、不写回 B 站、不伪造完整视频总结、不默认自动跳转。
- 明确 #37 与 #38/#39 的拆分关系，并只给后续 implementation issue 切片建议，不直接创建 issues。
