# Smart Favorites Q&A v2 PRD / spike

## 1. 背景

Issue #38 要把当前 Smart Favorites 的“模糊描述搜索”升级为收藏知识库问答。用户不是只想输入关键词拿列表，而是希望用问答式对话找回“我记得收藏过的那个视频”，并得到可追溯、可点击、可解释的结果。

本 PRD/spike 只定义产品边界、数据契约、检索流程、证据引用和后续 implementation 切片，不实现 UI、message action、DB schema 或新的 AI 调用。

核心产品要求：

- Smart Favorites Q&A 是“带证据的收藏检索问答”，不是无来源的生成式猜测。
- 每个回答必须引用它使用过的收藏视频来源，包含链接、命中原因、使用字段和置信/证据说明。
- 低证据或同步不完整时必须降级为“没有足够证据”或候选列表，不能补写结论。

## 2. 与 #37 AI assistant 的关系

#37 定义了 Bili-Bill AI assistant 的总原则：证据优先、最小上下文、来源标注、AI fallback、不上传完整收藏列表。#38 是 #37 下的 Smart Favorites 子模块，只处理收藏检索 Q&A。

#38 应复用 #37 的边界：

- 本地先检索和排序，再把 top N 最小字段交给可选 AI 做回答组织。
- AI 只基于传入的 cited videos 和 match evidence 写回答。
- AI 未配置、禁用或失败时，仍展示本地检索结果、命中原因和跳转链接。
- 没有字幕/transcript 或正文知识库时，不回答视频正文内容问题。

#39 Video Knowledge Base 负责 transcript/content QA。#38 第一版只能使用收藏视频元数据、收藏夹路径和已有 Smart Favorite AI 索引，不声称理解完整视频内容。

## 3. 产品定位

Smart Favorites Q&A v2 是 Dashboard 智能收藏页与统一 assistant 入口里的收藏检索问答能力。它帮助用户把自然语言问题映射到本地收藏视频，并解释“为什么这些收藏可能是答案”。

它不替代 B 站搜索，不写回 B 站收藏夹，不创建、移动、删除或重命名收藏，不做实时个性化排序，也不把收藏结果包装成面向观看引导的内容流。

## 4. Q&A scope

第一版允许回答的问题：

- 按模糊描述找收藏：例如“我收藏过那个讲库尔斯克的二战视频吗？”
- 按 UP、分区、标签、收藏夹路径找收藏：例如“找我收藏过的某个 UP 的历史内容。”
- 按已有 Smart Favorite 分类、摘要、关键词、别名找收藏：例如“有没有讲时间管理但标题不一定这么写的视频？”
- 基于结果集合做轻量回答：例如“最可能是哪几个？为什么？”
- 当前视频上下文触发的相关收藏查找：例如“找和当前视频主题相近的收藏。”

可用数据源：

- `favoriteItems`：`bvid`、`avid`、标题、简介、UP 名称、UP mid、原收藏夹、分区、标签、封面、时长、发布时间、收藏时间、同步时间。
- `smartFavoriteIndex`：AI 分类路径、摘要、关键词、别名、`searchableText`、索引状态、索引模型、索引时间。
- `favoriteFolders` 与 `lastSyncDiagnostics`：收藏夹标题、数量、同步时间、同步完整性诊断。
- 当前视频元数据：仅作为查询 hint，例如标题、UP、分区、标签、BVID。

第一版明确不做：

- 不做 transcript/content QA。
- 不总结完整视频正文。
- 不分析画面、音频、弹幕或评论。
- 不下载视频。
- 不读取 Cookie、浏览器 profile、登录态文件、本地 key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。

## 5. 从模糊搜索升级到 Q&A

现有 Smart Favorites 已具备：

- AI 索引生成：分类路径、摘要、关键词、别名。
- query rewrite：把模糊描述扩展为检索词。
- 本地 scoring：标题、UP、分类路径、关键词/别名、摘要、原收藏夹、元数据字段分别计分。
- result reasons：例如“标题相关”“UP主相关”“AI关键词相关”。
- 同步诊断：同步不完整时保留可用数据并显示 audit。

v2 保留这些能力，并升级三层：

1. Query understanding：保留 query rewrite / semantic alias，允许在 AI 可用时扩展用户问题，但扩展词只用于本地检索。
2. Evidence ranking：把 score/reasons 升级为结构化 evidence，记录命中的字段、词、权重和数据新鲜度。
3. Cited answer：可选 AI 只负责把 top N cited videos 组织成自然语言答案；所有结论都必须指向引用视频。

## 6. 检索与回答流程

推荐流程：

1. Normalize query：清理空白、分词、识别 UP/分区/路径/时间等显式约束。
2. Optional query rewrite：AI 可用时生成最多 8 个扩展词；AI 不可用时使用本地 fallback terms。
3. Local prefilter：在本地按标题、简介、UP、标签、原收藏夹、智能路径、摘要、关键词、别名召回候选。
4. Ranking：用字段权重、精确命中、路径/UP/标签约束、索引状态、同步新鲜度、当前视频 hints 计算 score。
5. Top N context：只选 top N，例如 5-12 条，构造最小 cited payload。
6. Optional AI answer synthesis：AI 只接收 cited payload 和用户问题，不接收完整收藏列表、完整收藏夹结构或未命中项。
7. Cited answer rendering：展示回答摘要、候选视频卡片、引用展开、低置信/缺失提示和本地 fallback 状态。

AI synthesis 的系统约束：

- 只能使用 `citedVideos` 中的事实。
- 必须为每个主要结论标注引用。
- 不能写“你一定收藏过某个未列出的视频”。
- 不能根据标题/简介推断完整视频正文。
- 证据不足时必须输出“没有足够证据”，并列出最接近候选或建议用户补充关键词。

## 7. Cited answer 数据契约

每个回答必须包含 `citedVideos`。建议 v2 response shape：

```json
{
  "answerType": "retrieval_answer",
  "query": "用户原始问题",
  "answer": "基于本地收藏证据的简短回答。",
  "confidence": "medium",
  "evidenceSummary": "命中了标题、AI关键词和原收藏夹；没有 transcript 证据。",
  "status": {
    "kind": "ok",
    "notes": []
  },
  "citedVideos": [
    {
      "bvid": "BV...",
      "avid": 123,
      "title": "...",
      "authorName": "...",
      "folderTitle": "...",
      "smartPath": ["知识", "历史", "二战"],
      "link": "https://www.bilibili.com/video/BV...",
      "matchReasons": ["标题相关", "AI关键词相关", "原收藏夹相关"],
      "sourceFields": ["title", "smart.keywords", "folderTitle"],
      "confidence": "high",
      "evidence": "查询词与标题、关键词和收藏夹路径同时命中。",
      "score": 86,
      "indexedAt": 1760000000000,
      "syncedAt": 1760000000000
    }
  ]
}
```

字段要求：

- `bvid`：优先使用 BVID；没有 BVID 但有 avid 时允许使用 av 链接，并标注 BVID 缺失。
- `title`、`authorName`、`folderTitle`、`smartPath`：用于用户判断结果是否正确。
- `link`：可点击 B 站视频链接。
- `matchReasons`：面向用户的命中原因。
- `sourceFields`：面向审计的来源字段，例如 `title`、`intro`、`tags`、`smart.summary`。
- `confidence`：该引用本身的证据强度，不表示视频质量。
- `evidence`：一句话说明为什么这条视频被引用。

## 8. Retrieval answer vs generative guess

v2 必须区分回答类型：

| 类型 | 触发 | 允许行为 | 禁止行为 |
| --- | --- | --- | --- |
| `retrieval_answer` | 有足够本地候选，至少 1 条引用达到中等证据 | 回答“最可能是这些收藏”，并引用视频 | 声称未引用视频存在或总结完整视频正文 |
| `candidate_list` | 候选存在但证据分散或低置信 | 列候选、命中原因和缺失项 | 给出唯一确定结论 |
| `no_result` | 本地检索无候选 | 说明没有找到，并建议改写查询/同步/生成索引 | 编造“可能收藏过”结果 |
| `insufficient_evidence` | 查询要求正文、字幕、观点或细节，但只有元数据 | 说明第一版不支持正文问答，可展示相关收藏候选 | 根据标题/简介生成正文答案 |
| `local_fallback` | AI 未配置、禁用或失败 | 展示本地检索列表、reasons 和 links | 隐藏 AI 失败并伪装成生成回答 |

低证据回答示例原则：

- 可以说：“没有足够证据确认唯一结果。下面 3 条收藏在标题/关键词上接近。”
- 不可以说：“你收藏过的就是某某视频”，除非引用证据足够集中。

## 9. 状态与降级

Q&A v2 必须覆盖以下状态：

| 状态 | 触发 | 用户可见行为 |
| --- | --- | --- |
| No result | 本地候选为空 | 显示“没有找到匹配收藏”，提供改写建议和同步/索引入口 |
| Low confidence | top N 分数低、命中字段少、只有宽泛标签命中 | 显示低置信，优先列候选而不是定论 |
| Stale index | 收藏同步时间晚于索引时间、待索引/失败项较多 | 标注索引可能过期，提供“生成智能索引/重试失败项”入口 |
| Incomplete sync | `lastSyncDiagnostics` 存在 error、delta、has_more after stop 或 max pages reached | 标注“本地收藏覆盖不完整”，不能假装全量覆盖 |
| AI not configured | 没有 API Key | 不发 AI 请求，显示本地检索 fallback |
| AI disabled | 用户禁用 AI | 同上，并显示可启用入口 |
| AI failed | 请求失败、超时、MV3 中断或权限失败 | 保留本地候选和引用，显示失败摘要和重试 |
| Index missing | 未生成 Smart Favorite index | 使用元数据检索，说明摘要/关键词/别名不可用 |

同步完整性必须结合 #34 的 favorite sync diagnostics 思路和现有 `sync-audit.ts`。当收藏夹同步被判定为 blocked 或有诊断缺口时，回答应写成“在当前已同步数据中找到/未找到”，不能写成“你的全部收藏中没有”。

## 10. 隐私边界

Q&A v2 的隐私边界：

- 不上传完整收藏列表。
- 不上传完整收藏夹结构。
- 不上传未命中项。
- 不上传 Cookie、API key、浏览器 profile、Bilibili 登录态文件、用户个人资料或本地 key 文件。
- 不读取 `C:\Users\LittleNub\Desktop\Key.txt`。
- AI 只接收本地检索出来的 top N 最小字段：标题、简介摘录、UP、分区/标签、原收藏夹、智能路径、摘要、关键词/别名、链接、命中原因和同步/索引状态摘要。
- AI 请求不包含完整 IndexedDB dump、完整导出文件、完整 feedback、完整历史或完整关注列表。

最小 AI payload 示例：

```json
{
  "intent": "smart_favorites_qa",
  "question": "我收藏过讲库尔斯克的二战视频吗？",
  "syncCoverage": {
    "complete": true,
    "lastSyncedAt": 1760000000000
  },
  "availableSources": {
    "favoriteMetadata": true,
    "smartIndex": true,
    "transcript": false
  },
  "citedVideos": [
    {
      "bvid": "BV...",
      "title": "...",
      "authorName": "...",
      "folderTitle": "历史",
      "smartPath": ["知识", "历史", "二战"],
      "summary": "...",
      "keywords": ["库尔斯克", "苏德战争"],
      "matchReasons": ["AI关键词相关", "分类路径相关"],
      "sourceFields": ["smart.keywords", "smart.path"]
    }
  ]
}
```

## 11. UX

入口：

- Dashboard 智能收藏页：在现有搜索框附近增加 Q&A 模式入口，适合长答案、引用展开和同步诊断提示。
- Assistant 统一入口：当用户问收藏相关问题时路由到 Smart Favorites Q&A 子模块。
- 当前视频页 assistant：可把当前视频标题、UP、分区、标签作为 query hints，触发“找相关收藏”。

结果展示：

- 顶部回答：短句回答或“没有足够证据”。
- 引用视频卡片：标题、UP、收藏夹、智能路径、封面、打开链接、命中原因、置信度。
- 引用展开：显示 source fields、匹配词、摘要/关键词/别名、同步/索引时间。
- 状态提示：AI fallback、低置信、同步不完整、索引过期、无 transcript。
- 操作：打开视频、复制链接、重新生成索引、同步收藏夹、改写问题。

AI 未配置/禁用/失败时：

- 搜索和排序仍在本地完成。
- 页面显示本地结果卡片和引用信息。
- 不显示由 AI 生成的自然语言答案；可显示模板化回答，例如“在当前已同步收藏中，找到 5 个接近结果。”

## 12. 评估指标

建议指标：

- 目标收藏找回率：用户是否能通过问答找到想找的视频。
- 引用点击率：回答中的 cited videos 是否被打开。
- 无结果率：`no_result` 占比。
- 低置信率：`candidate_list` / `insufficient_evidence` 占比。
- 错误引用反馈率：用户标记“引用不相关”或“不是我要找的”。
- AI fallback 率：AI 未配置、禁用或失败时的 fallback 频率。
- 同步覆盖风险率：回答时存在 incomplete sync 或 stale index 的比例。

这些指标只记录聚合状态和本地产品事件，不需要上传完整收藏内容。

## 13. 非目标

本 issue 不做：

- 不实现 Q&A UI。
- 不新增 message action。
- 不修改 Smart Favorites 代码。
- 不修改 DB schema。
- 不新增 AI 调用。
- 不创建 GitHub issues。
- 不改动态账单、发布包、release 或 tag。
- 不把收藏 Q&A 写成观看引导型推荐定位。
- 不把正文、字幕、弹幕、评论或画面内容纳入第一版证据。

## 14. 后续 implementation issue 切片建议

以下只是建议切片，等待主 Agent 或用户确认后再创建 issue：

1. Smart Favorites Q&A response contract：定义 `answerType`、`confidence`、`status`、`citedVideos`、`sourceFields` 和 sync/index coverage 字段。
2. Local evidence ranking v2：把现有 `scoreItem` reasons 扩展为结构化 evidence，记录命中字段、匹配词、权重和低置信阈值。
3. Q&A local fallback UI：在 Dashboard 智能收藏页增加问答入口、结果卡片、引用展开、no-result/low-confidence/incomplete-sync 状态。
4. Optional AI answer synthesis：在本地 top N 后加入可选 AI 组织回答，强制只引用 `citedVideos`，并覆盖 AI 未配置/禁用/失败 fallback。
5. Sync/index coverage guard：把 `lastSyncDiagnostics`、pending/failed/stale index 转为 Q&A 状态提示，避免同步不完整时声称全量覆盖。
6. Current video related favorites entry：从当前视频 assistant 传入标题、UP、分区、标签 hints，复用同一 Q&A 检索流程。
7. Evaluation and feedback：记录 no-result、low-confidence、引用点击、错误引用反馈等本地指标和最小聚合上报策略。
8. Privacy payload audit tests：为 AI payload 增加测试，确保不包含完整收藏列表、完整收藏夹结构、未命中项、Cookie、key、profile 或本地敏感路径内容。

## 15. 验收标准

- PRD 明确 #38 是 #37 AI assistant 下的 Smart Favorites 检索 Q&A 子模块。
- PRD 明确第一版 scope 只覆盖收藏元数据、标题、简介、UP、分区/标签、收藏夹路径、别名和已有 Smart Favorite AI summary/keywords/path。
- PRD 明确不做 transcript/content QA，并把真正正文/字幕问答依赖到 #39。
- PRD 定义 local prefilter/ranking -> top N context -> optional AI answer synthesis -> cited answer 流程。
- PRD 定义每个回答必须包含 cited videos：`bvid/title/author/folder/path/link/matchReasons/sourceFields/confidence/evidence`。
- PRD 区分 retrieval answer 与 generative guess，低证据时返回候选或没有足够证据。
- PRD 覆盖 no-result、low-confidence、stale-index、incomplete-sync 和 AI fallback 状态。
- PRD 结合 favorite sync diagnostics，要求同步不完整时不能假装全量覆盖。
- PRD 明确隐私边界：不上传完整收藏列表、完整收藏夹结构、未命中项、Cookie/key/profile；AI 只接收 top N 最小字段。
- PRD 说明现有 fuzzy search 的保留点和升级路径。
- PRD 覆盖 Dashboard 智能收藏入口、assistant 统一入口、结果卡片、引用展开和本地 fallback UX。
- PRD 给出评估指标和后续 implementation issue 切片建议，但不直接创建 issue。
