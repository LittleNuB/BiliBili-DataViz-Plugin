# Bili-Bill 0.14 集成 QA 矩阵

状态：待 gate 与实现后执行。本文不授权发布、改版本、打 tag、合并 PR 或关闭 issue。

## 1. 通用环境与自动验证

- clean integration worktree，基于已审查的 `origin/main` 和 production unpacked build。
- deterministic mock/fake-indexeddb 用于迁移、容量、冲突、失败、竞态和时间推进；新建临时 Chrome profile 用于 Browser QA。
- 真实 B站 smoke 仅访问用户有权查看的公开视频和当前浏览器运行态。需要登录或手动开启 AI 字幕时由用户操作；QA 不读取或导出 Cookie、profile、login-state 或 key 文件。
- 自动基线：focused tests、全量相关测试、`npm run typecheck`、`npm run build`、`git diff --check`、`npm audit --audit-level=high`、release-dist 验证、500,000-byte chunk 校验、文案与 raw 泄漏扫描。
- 所有 Browser/mock 场景同时检查桌面和窄屏关键布局、键盘焦点、无重叠、无横向溢出、无未处理 console error。

## 2. 阻塞 Gate

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| GT-01 | 100/400/500 MiB managed-full-text gate | 每档完整记录环境、运行次数、内存、时间、索引和 ZIP 指标；缺测为 insufficient_evidence |
| GT-02 | 64 MiB 单全文版本 | 一个版本的 metadata + 全部分段原子提交或回滚；不得增加隐藏时长上限 |
| GT-03 | 自建 IndexedDB 与 FlexSearch 候选 | 至少一项通过全部构建、查询、持久化、增删、取消和 MV3 恢复标准后才冻结搜索 schema |
| GT-04 | zip.js 与 fflate 候选 | 至少一项通过流式写读、backpressure、畸形输入、取消、CSP、license、build 和 chunk 标准 |
| GT-05 | Blob fallback 8/16/32/64 MiB | 选择最大通过值；8 MiB 也失败则不提供 fallback，不伪造兼容 |
| GT-06 | 精确 400/500 MiB 边界 | 400 MiB 开始预警；恰好 500 MiB 成功并显示已满；再加 1 byte 拒绝 |
| GT-07 | worker 中断与检查点 | 搜索最多重做一批；恢复只续跑清理并要求重新选文件；导出不声称可续传 |
| GT-08 | 依赖审计 | 版本、integrity、许可证、worker/WASM、CSP、bundle 与 release license 全部可追溯 |
| GT-09 | 字幕统计轮廓与高碎片 fixture | 固定分段长度/数量、重叠、中英文、标点和时长分布收据；病态样本不依赖友好分段 |
| GT-10 | restore staging headroom | 冻结倍率+reserve 可提前拒绝不足配额且不误拒全部 passing fixtures；最终 write/readback 仍为权威 |
| GT-11 | operation state/phase 中断矩阵 | 每个合法 phase 可恢复或清理；非法组合拒绝；journal 无正文、路径、handle 或 raw exception |

## 3. 数据库迁移

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| MG-01 | 空 v13 首次打开 v14 | 新 schema 建立；全文账本为 0；无伪造视频、账号、来源、知识或索引内容 |
| MG-02 | 一个合法旧收藏 | 创建 pending 视频、legacy 收藏容器和精确关系；不创建知识或全文 |
| MG-03 | 同一 BVID 跨多个文件夹 | 只有一个 canonical video；每个容器各有关系；metadata 按固定排序合并 |
| MG-04 | 合法 BVID 但 folder ID 无效 | 使用“升级前未分组收藏”；不丢旧 favorite row |
| MG-05 | avid-only / 非法 BVID | 原记录保持“视频信息待补全”；不猜 BVID、不创建 canonical video |
| MG-06 | unsafe numeric / 空字段 / 重复 tag | 非法可选值省略；不舍入；字段选择和去重确定一致 |
| MG-07 | Smart Favorite、persistent transcript cache、QA session 同时存在 | 原表内容和数量不变；不提升为知识、全文、标签或证据 |
| MG-08 | v13 没有 watch-later 表 | 不创建稍后再看容器或关系 |
| MG-09 | 注入 upgrade transaction 失败 | 全部 v14 写入回滚；v13 数据完整；重开可重试 |
| MG-10 | 大收藏 fixture 与多次重开 | 结果哈希一致，无依赖遍历顺序、当前账号或 wall clock 的变化 |
| MG-11 | migration network/AI spy | 零网络、零 AI、零字幕读取、零 profile/key 文件访问 |

## 4. 来源、账号与视频身份

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| SR-01 | 首次用户授权收藏同步 | 只从当前响应取得最小账号匹配 ID 与昵称；UI 不显示 ID |
| SR-02 | 响应缺少稳定账号 ID | 不按昵称猜账号；不创建/选择账号 scope |
| SR-03 | 检测到新账号 | 先要求用户确认；未确认不合并、不删除旧账号来源 |
| SR-04 | 账号昵称变化 | 只更新显示名；accountScopeId 与关系不变 |
| SR-05 | complete sync 缺少旧项 | 只删除该账号、该容器内确实缺失的关系 |
| SR-06 | incomplete/failed/cancelled sync | 只 upsert，不按缺失删除；保留上次成功内容 |
| SR-07 | 空文件夹 complete sync | 容器仍存在且计数为 0，不伪造视频关系 |
| SR-08 | 断开账号 A | 原子删除 A registry/container/relations；B 与 durable knowledge/full text 保留 |
| SR-09 | legacy folder 与授权完整同步精确匹配 | 只在真实 folder ID + BVID 匹配后完成关系归属，不按标题猜测 |
| SR-10 | 同视频出现在收藏与稍后再看 | 一个 canonical video、两条来源关系；不等于两份知识 |
| SR-11 | part reorder | exact CID 不变；只改 display order，不移动证据或全文 |
| SR-12 | complete part list 缺少旧 CID | 有 durable reference 时显示暂时无法核对；无引用时仅删除空 shell |
| SR-13 | failed/partial part list | upsert-only，不把未返回 part 视为删除 |
| SR-14 | source relation 全部删除 | 有 asset/fulltext 时 video 保留；三者都无才清空 shell |
| SR-15 | metadata refresh | 不改用户标题/笔记/标签，不作为视频内容证据，不 bump library activity |

## 5. 知识资产与证据

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| KA-01 | 新建纯笔记 | 先选择至少一个 existing video；生成 whole-video relation 和用户正文，但不伪造证据、时间或全文 |
| KA-02 | 当前视频创建时间书签 | 保存真实视频/分 P/时间；打开后仍需预览、确认、可返回 |
| KA-03 | 保存已验证摘要或亮点 | 保存一份 immutable content blocks，并映射真实证据 |
| KA-04 | 在 B站字幕视图选区右键保存 | 菜单只在合法选区出现；保存 exact text、part、time 和 source snapshot |
| KA-05 | 在回答中选区右键保存 | 先保存回答摘录，再按 block ordinal 关联当前有效引用 |
| KA-06 | 次级“保存整轮” | 保存问题与完整回答一次；多个来源不复制回答正文 |
| KA-07 | 同一选区/整轮双击和并发 | sparse unique fingerprint 只产生一项；显示自然“已保存”状态 |
| KA-08 | 两项故意不同内容但来源相同 | 不因标题/tag 或 UUID 误判；按 canonical source-save origin 契约处理 |
| KA-09 | source-backed create 中途失败 | asset/source/evidence 全部回滚，无孤儿行或错误 active pointer |
| KA-10 | 编辑 title/note/tag 或纯 note body | 保存只替换 user layer；saved content/evidence 不变；取消零写入 |
| KA-11 | 离开未保存编辑 | 明确放弃确认；不隐藏 autosave |
| KA-12 | tag NFKC/大小写/空白重复 | 保留首个自然显示写法；过滤 key 去重；无独立 tag orphan |
| KA-13 | 重新定位一个来源 | 选择连续真实正文并预览确认；新证据 active，旧证据显示已更正 |
| KA-14 | 多来源资产重新定位 | 只改变选中 citation；其他来源和保存回答不变 |
| KA-15 | 无完整当前文本时重新定位 | 拒绝近似匹配；可创建关联所选 whole video、但无 evidence snapshot 的个人笔记，不改原证据 |
| KA-16 | source text 或 part 变化 | 资产保留并显示依据已变化；不能用于新事实引用 |
| KA-17 | 删除资产 | 删除完整 graph；不修改 B站关系、其他资产或全文 |
| KA-18 | canonical backup record 超过 16 MiB | 保存前拒绝并显示“内容过大，暂时无法保存”；不驱逐旧知识 |
| KA-19 | saved content 含模型/provider/raw 字段 | 只保留用户选中的自然内容与证据；工程字段不持久化、不展示 |

## 6. 完整文本生命周期与容量

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| FT-01 | source-only 视频同步成功 | 只建 lightweight video；不批量抓字幕、不启动转录 |
| FT-02 | 知识空间外普通视频取得字幕 | 仍是 current-video cache；不开启 durable full text |
| FT-03 | 保存知识时 exact B站字幕已可用 | 同一 admission boundary 原子保存全文版本与 segments |
| FT-04 | admitted 视频后来主动取得字幕 | 用户动作后加入 managed full text；同步本身不触发 |
| FT-05 | 轨道存在但正文需手动开启 | 显示“需要先在 B 站视频页开启字幕”和“打开视频” |
| FT-06 | current-video cache `persistent=true` | 不显示“全文已保存”，缓存清理不影响 durable full text |
| FT-07 | 同 scope/body/timeline 再取得 | 只刷新验证时间；不创建重复版本、不增加用量 |
| FT-08 | 正文相同、时间轴变化 | 形成待确认候选；不静默覆盖 |
| FT-09 | 确认更新 | 新版 current、旧版 historical、唯一 scope key 原子转移 |
| FT-10 | 确认更新时容量或事务失败 | 旧 current 保持；新版本和 segments 零残留 |
| FT-11 | historical/pending 搜索与阅读 | 自然标注状态，可读但不可作为当前 AI 事实证据 |
| FT-12 | 删除一个 historical 或整视频全文 | 对应 rows/ledger/index 清理；asset/evidence snapshot 保留 |
| FT-13 | ledger 缺失/负数/不匹配 | 旧全文可读；新写入暂停；repair 后与每版本总和一致 |
| FT-14 | source segment overlap/gap | 保留真实 overlap，不合成 gap；ordinal、coverage、hash 精确 |
| FT-15 | local_transcript reserved type | 0.14.0 普通 UI 无入口、设置或假状态；fixture 不宣称 ASR 可用 |
| FT-16 | 空文本、倒序、NaN、lone surrogate | 整版本拒绝；无部分 rows、无 raw error |
| FT-17 | 同语言存在两个稳定可区分轨道 | stable track ID/type 产生不同 variant，可各自保留 current；URL、显示名、AI 状态变化不改 variant；UI 不显示内部 key |
| FT-18 | 同语言轨道无稳定区分值且正文不同 | 只使用“默认 B站字幕”scope；明确确认替换，旧版 historical，不宣称同轨更新 |

## 7. 知识库视图、检索与导航

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| KB-01 | 打开知识库 | 默认已保存知识；三视图一次只显示一个；空间管理为次级动作 |
| KB-02 | 打开 legacy `#smart-favorites` | 跳到知识库收藏来源；旧同步/分类能力可用 |
| KB-03 | 四类 asset 列表 | 使用不同自然类型图标/名称；不全部画成视频卡片 |
| KB-04 | desktop/narrow master-detail | 桌面列表+详情；窄屏详情有返回；文字不溢出、不遮挡 |
| KB-05 | 视频资料默认排序 | 按 library activity desc + bvid tie-break；不描述成推荐或猜你喜欢 |
| KB-06 | 全局搜索命中 note | 标注“个人笔记”等知识层；相关视频为次级信息 |
| KB-07 | 命中 current full text | 标注 B站字幕和 exact part；可预览定位 |
| KB-08 | 命中 historical/pending | 显示历史/待核对；不把其普通结果当 current evidence |
| KB-09 | 命中 metadata only | 明确“视频信息”；不声称命中视频正文 |
| KB-10 | search index missing/building/failed | 显示重建状态；不扫描 core corpus、不冒充 title-only 成功 |
| KB-11 | source text 删除并更新 index | 10 秒内不再命中 exact removed text；asset snapshot 仍可命中其自身层 |
| KB-12 | 时间结果点击 | 打开预览；确认后跳 exact video/part/time；返回原位置 |
| KB-13 | preview 后 source/part/version 变化 | 旧确认作废，播放位置不变 |
| KB-14 | 视频不可用 | asset 可读；打开动作说明暂时无法核对，不丢内容 |
| KB-15 | empty states | 分别显示没有已保存知识、暂无完整文本、尚未同步/成功空来源 |

## 8. 备份、恢复与空间管理

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| BR-01 | 打开导出 | 先说明范围、完整文本覆盖、估计大小和 ZIP 不加密；默认完整备份 |
| BR-02 | 点击导出 | 同步调用 save picker 后才开始异步枚举/压缩；取消 picker 零操作 row |
| BR-03 | lightweight export | 固定 5 data entries；fulltext counts/bytes 为 0；资产和证据完整 |
| BR-04 | full export | 固定 7 data entries；包含 current/historical/pending 全文和 exact segments |
| BR-05 | manifest/readback | 路径、顺序、counts、bytes、SHA、totals 全部匹配；空 entry 仍存在 |
| BR-06 | near-500-MiB streaming export | 不构造完整 Blob；heap/main-thread/chunk/close 达 gate 标准 |
| BR-07 | unsupported writable stream | 低于 verified Blob threshold 才 fallback；超限在构造前拒绝 |
| BR-08 | export cancel/disk failure/worker loss | 不报成功，释放 journal；自然说明 partial destination 可能需删除 |
| BR-09 | restore valid lightweight | 原子加入资产/证据；不导入账号、来源列表、会话、缓存或 index |
| BR-10 | repeated restore | identical graphs skipped；数量和 IDs 不增殖 |
| BR-11 | same asset UUID/different content | 本地保留；确定性 UUIDv5 导入一份；再次恢复不再增加 |
| BR-12 | imported conflict 后用户编辑再恢复 | 编辑版保留；backup 原语义版本按冲突合同保留，不覆盖 |
| BR-13 | same fulltext fingerprint/different UUID | 跳过 exact duplicate；不重复计费容量 |
| BR-14 | backup current 与 local current 不同 | local current 保持；backup copy historical，不抢 current key |
| BR-15 | backup-only current | 恢复为“来自备份，待核对”；阅读/搜索可用，AI current evidence 不可用 |
| BR-16 | full restore 超过 500 MiB | 提供“仅恢复知识内容”或取消；不挑部分全文 |
| BR-17 | path traversal/duplicate/encrypted/unknown path | preflight 拒绝；零可见写入、零解压到磁盘 |
| BR-18 | bad JSON/duplicate key/field/type/enum/record size | 流式读取时拒绝；既有 staged rows 全清，零可见写入；普通 UI 只显示安全中文分类 |
| BR-19 | restore cancel/quota/worker interruption | prior knowledge unchanged；staged rows invisible；cleanup 可续跑 |
| BR-20 | commit 后 marker normalization 中断 | committed graph 仍完整可见；重启续清 marker；无重复导入 |
| BR-21 | 空间管理统计 | 分开显示个人知识、完整文本、索引；fulltext current/history 用量可核对 |
| BR-22 | remove selected fulltext version | 只删除所选版本及 index 派生；资产/证据不变 |
| BR-23 | 重置 Bili-Bill（保留知识库） | 设置/普通缓存等按范围清理；个人知识和完整文本全部保留并回读 |
| BR-24 | 清空知识库 typed confirmation | 预览范围、建议备份、输入“清空知识库”；原子清知识/fulltext，不清来源关系 |
| BR-25 | clear 与 late save/restore race | 清理门禁使迟到请求失效；完成后不会重建已清知识 |
| BR-26 | envelope 合法但 entry hash/count 或跨记录引用错误 | 允许 bounded invisible staging；完整流/最终验证拒绝，零可见数据，cleanup 完整 |
| BR-27 | restore staging headroom 不足 | Gate 冻结规则在 staging 前拒绝并进入空间管理；不靠估算授权提交或裁掉类别 |
| BR-28 | incoming v1 JSON key 顺序不同 | exact field set/types/hash 均合法时接受；未知/缺失/重复 key 仍拒绝 |

## 9. 0.14.1 跨视频知识问答

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| QA-01 | 升级/首次打开设置 | “知识库 AI”默认关闭，与当前视频助手授权分开 |
| QA-02 | 开启授权或打开/切换知识库 | 零 AI 请求；只有明确提问发送 |
| QA-03 | 问题只指当前视频 | 本地 scope 为当前视频；仅发送该 exact part 完整 current text |
| QA-04 | 问题只指个人知识 | 从知识空间选来源；不自动带当前视频 |
| QA-05 | 问题明确要求比较 | scope 为两者；最多五个 exact video/part 来源 |
| QA-06 | scope 含糊 | UI 显示本轮范围并允许替换；不靠 MCP/Skill 暗中扩展 |
| QA-07 | retrieved source fragments | 只负责选择来源；模型收到每个选中来源完整文本，不把片段当答案上下文 |
| QA-08 | relevant personal notes | 只发送直接相关资产并标注个人知识；不冒充视频原话 |
| QA-09 | 选中正文 >512 KiB | 提交前一次规模/等待/费用提醒；取消零请求，确认后按原范围发送 |
| QA-10 | provider rejects long context | 保留问题和来源；不裁剪、不分批、不换模型、不改 scope |
| QA-11 | valid answer | 先完整中文回答，再显示 exact sources/citations |
| QA-12 | one claim/citation unmapped | 整次新回答拒绝；不展示部分“看起来正确”内容 |
| QA-13 | source historical/pending/unavailable | 不用于 current factual answer；可作为明确历史个人知识阅读 |
| QA-14 | source changes during request | 结果只绑定提交快照；不能冒充当前来源，迟到结果不覆盖新请求 |
| QA-15 | replace one source and resubmit | 明确新范围并产生新请求；不静默替换其余来源 |
| QA-16 | save valid multi-source answer | 一份 saved answer blocks + 多关系证据；删除会话不删 asset |
| QA-17 | AI off/unconfigured/failure | 本地知识库和检索仍可用；不暴露 provider/raw error |
| QA-18 | payload audit | 无未选中知识、完整收藏/历史/关注、账号 ID、Cookie、key、会话全集或 raw 字段 |

## 10. 文案、隐私与回归扫描

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| PV-01 | 用户可见源码与 dist 扫描 | 无 `未消费`；无“猜你喜欢/推荐排序”产品表述；否定性测试命中单独分类 |
| PV-02 | raw 字段扫描 | `fallback/transcript/confidence/sourceHash/segmentId/subtitle_url/document is not defined` 不出现在用户可见路径 |
| PV-03 | ID 与错误泄漏 | UI/截图/诊断不显示 account ID、UUID、BVID/CID、hash、file path、raw exception |
| PV-04 | AI payload audit | 只含当前意图允许的 exact source text 与相关知识；没有全库或关系清单 |
| PV-05 | 备份内容审计 | 不含账号、Cookie、登录态、key、AI 配置、会话、cache、index、audio 或 model artifacts |
| PV-06 | B站写操作 spy | 无 follow/unfollow、favorite-folder edit、like/coin/comment 或其他关系写回 |
| PV-07 | 0.13 回归 | 当前视频助手、动态账单、盲盒、设置与清理保持已验收路径；盲盒不再出现 raw runtime error |

## 11. 完成报告

最终 QA 报告必须包含：

- integration branch/worktree、base/head commit、全部 PR 与 issue 列表；
- 每个矩阵 ID 的 pass/fail/blocked 和证据路径；
- gate 原始报告与最终冻结 schema/batch/package/Blob threshold；
- focused/full tests、typecheck、build、audit、release-dist、diff check、文案与 payload scan；
- Browser/mock 的 Chrome 版本、临时 profile、desktop/narrow viewport、console/network 记录；
- 未读取 Cookie/profile/login-state/key 文件及 `C:\Users\LittleNub\Desktop\Key.txt`；
- 未改 B站关系，未发布、打 tag 或修改 package version；
- 自动测试未能证明的剩余风险和需要用户人工体验的路径。
