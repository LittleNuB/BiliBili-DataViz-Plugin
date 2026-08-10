# Bili-Bill 0.14 开发计划

状态：待实施。本文把已经完成的 0.14 grill 合同拆成依赖有序、可独立 review 的 tracer-bullet issues；运行时代码必须先通过 Gate，再进入产品实现。

## 1. 依据与优先级

- 产品合同：[`PRD-0.14-personal-video-knowledge-base.md`](./PRD-0.14-personal-video-knowledge-base.md)
- 验收合同：[`acceptance-0.14-personal-video-knowledge-base.md`](./acceptance-0.14-personal-video-knowledge-base.md)
- 存储合同：[`architecture/storage-contract-0.14-personal-video-knowledge-base.md`](./architecture/storage-contract-0.14-personal-video-knowledge-base.md)
- 迁移合同：[`architecture/migration-contract-0.14-personal-video-knowledge-base.md`](./architecture/migration-contract-0.14-personal-video-knowledge-base.md)
- 备份合同：[`architecture/backup-contract-0.14-personal-video-knowledge-base.md`](./architecture/backup-contract-0.14-personal-video-knowledge-base.md)
- 阻塞 Gate：[`architecture/gate-contract-0.14-storage-search-and-backup.md`](./architecture/gate-contract-0.14-storage-search-and-backup.md)
- 集成 QA：[`qa-0.14-integration-matrix.md`](./qa-0.14-integration-matrix.md)
- 领域术语：[`../CONTEXT.md`](../CONTEXT.md)

合同优先级只采用验收合同第 1 节，不在本文另设顺序。任何 issue 若发现合同冲突，先回到 docs issue 收敛，不在实现 PR 中临时改产品规则。

## 2. 工作方式

- 每个 issue 使用独立 clean sibling worktree、`codex/` 分支和 draft PR 到 `main`。
- 实现子任务默认使用 `gpt-5.5 / xhigh`；0.14.0 和 0.14.1 集成前各安排一次 `gpt-5.6 Terra / xhigh` 中立复核。
- 一个 issue 对应一个可演示的纵向切片；不得把未声明的相邻功能、版本发布或仓库维护混入 PR。
- 实现 PR 不修改 release、tag、package version 或发布资产。Gate 选定新依赖时可以只修改实现所需的依赖声明和 lockfile，并必须附许可证、CSP 与包体积收据。
- 不读取 Cookie、profile、login-state、key 文件，也不读取 `C:\Users\LittleNub\Desktop\Key.txt`。
- 不伪造字幕、转录、时间点或来源。视频跳转继续遵守预览、确认、返回。
- 用户可见文案中文优先，不暴露 `fallback`、`transcript`、`confidence`、`sourceHash`、`segmentId`、`subtitle_url`、原始异常或其他工程字段。
- 每个 PR 保持 draft/open，完成主 Agent review、自动验证与相应人工 QA 后，才决定 ready、merge 和 issue 状态。
- 同一依赖层可以并行；有阻塞边的 issue 不得提前派发。任何失败关闭，不以降级文案伪装成功。

## 3. 发布边界

### 0.14.0-alpha

交付个人视频知识库基础闭环：来源关系、视频/分 P 身份、知识资产、完整文本生命周期、全局检索、空间管理、完整/轻量备份与非破坏性恢复。它不包含跨视频 AI 问答。

### 0.14.1-alpha

在 0.14.0 数据与检索合同稳定后，交付单次请求内的跨视频知识问答、来源替换、引用校验和多来源回答保存。它不引入 MCP、Skill 自动触发、云同步或后台代理。

### 后续版本

本地转录正式集成、说话人分离、语义向量检索、云同步、OCR 和自动知识提炼均不属于本轮依赖。

## 4. 依赖图

```text
DOC-014
  |
  +--> GATE-014-A1
  +--> GATE-014-A2

GATE-014-A1 + GATE-014-A2
  --> GATE-014-B
         |
         +--> GATE-014-C
         +--> GATE-014-D

GATE-014-B + GATE-014-C + GATE-014-D
  --> GATE-014-E
         |
         +--> DB-014-A
                |
                +--> KB-014-A
                +--> SRC-014-A --> SRC-014-B
                +--> KA-014-A
                +--> FT-014-A --> FT-014-B
                         |          |
   KA-014-A + FT-014-A --> KA-014-B
   KB-014-A + KA-014-B + FT-014-B --> SEARCH-014
   KA-014-B + FT-014-B --> BACKUP-014-A --> BACKUP-014-B

all 0.14.0 slices
  --> QA-014-0
         |
         +--> AI-014-A --> AI-014-B --> AI-014-C --> QA-014-1
```

## 5. 合同与 Gate Issues

### DOC-014：冻结 0.14 单一合同

范围：

- 合并 PRD、领域词汇、ADR、存储/迁移/备份合同、验收合同和 QA 矩阵。
- 明确 0.14.0 与 0.14.1 的发布边界及 Gate-first 依赖。
- 只改文档，不改业务代码、数据库版本、依赖、release 或 issue 状态。

验收：

- 所有相对 Markdown 链接有效，ADR 编号唯一且无缺号冲突。
- 静态字段、枚举、索引、哈希、备份和迁移规则不存在互相矛盾的现行定义。
- 中立 reviewer 给出 `GO` 或修复完全部 P0/P1 后的 `GO WITH FIXES`。
- `git diff --check` 通过。

### GATE-014-A1：公开安全合成 fixture 与基准收据框架

依赖：DOC-014。

范围：

- 生成确定性的 100 MiB、400 MiB、500 MiB 语料、单视频 64 MiB 极端样本和高碎片化病态样本。
- 建立统一的计时、内存、IndexedDB 占用、索引体积、重启恢复和失败注入收据格式。
- 固定并输出合成样本的分段长度、每视频分段数、重叠率、中英文比例、标点和时长分布。
- fixture 只使用合成/公开安全文本，不含真实用户历史、收藏、字幕、账号或环境路径。
- 在 GATE-014-A2 通过前，真实 B 站字幕代表性和最大实测分段数尾部必须保持 `insufficient_evidence`。

不包含：选择搜索或 ZIP 方案；声明合成 fixture 已代表真实 B 站字幕分布。

验收：同一 seed 重跑得到一致哈希和记录数；fixture 可分批生成、清理且不会进入发布包；完整只读回执复算、focused tests 与隐私扫描通过。

### GATE-014-A2：公开安全真实分布校准

依赖：DOC-014。

范围：

- 从有许可证、公开或另行明确授权的来源取得只含聚合统计的 B 站字幕分布证据。
- 固定分段长度、每视频分段数、重叠率与时长、中英文/数字/标点比例、视频时长桶和最大实测分段数尾部。
- 记录样本量、选择方法、来源、许可证或授权、采集日期、排除规则和局限；不保留原始字幕措辞、BVID/CID 列表、账号标识或本地路径。
- 为聚合校准收据和由其派生的 fixture 配置固定版本与 SHA-256；后续候选运行必须在同一条 run record 中绑定该校准收据 SHA-256、派生配置版本/SHA-256 和实际 fixture 收据 SHA-256。
- 只有通过隐私、来源和代表性 review 后，才允许用该聚合收据校准 GATE-014-A1 fixture。

不包含：登录态采集、Cookie/profile/login-state 读取、用户历史或账号数据、候选搜索/ZIP 实现。

验收：提交可复核且不含原文/账号标识的聚合收据，并把高碎片化样本绑定到最大实测尾部；校准收据、派生配置和 fixture 收据缺少上述可机器复核绑定时不得通过；找不到合法且有代表性的来源时保持 `insufficient_evidence`，不得启动 GATE-014-B。

### GATE-014-B：500 MiB IndexedDB 与分批写入 Gate

依赖：GATE-014-A1、GATE-014-A2。

范围：

- 在目标浏览器上测量完整文本元数据、分段、容量台账和 256/512/1024 条、1/2/4 MiB 批次组合。
- 覆盖 100/400/500 MiB、64 MiB 单版本、事务失败、扩展重启、中止清理和台账修复。
- 选出写入/读取批次、进度反馈阈值和 restore staging 的保守配额预留系数；浏览器配额估算只可提前拒绝，不能授权最终提交。

验收：满足 Gate 合同的容量、响应性、恢复与删除阈值；输出原始收据和明确 pass/fail，不改产品 UI。

### GATE-014-C：全局词法检索候选基准

依赖：GATE-014-A1、GATE-014-A2、GATE-014-B。

范围：

- 对比自管 generation-scoped IndexedDB 倒排索引与固定版本 FlexSearch。
- 覆盖中文精确/二元词、英文归一化、标题/标签/笔记/回答/亮点/完整文本、删除、重建、MV3 中断和扩展重启。
- 测量构建耗时、查询延迟、索引体积、召回 fixture 与 worker/CSP 兼容性。

验收：按 Gate 阈值选择一个方案，或给出 `NO-GO`；不得以仅内存 demo 证明持久检索可行。

### GATE-014-D：流式 ZIP、恢复与 Blob 回退基准

依赖：GATE-014-A1、GATE-014-A2、GATE-014-B。

范围：

- 对比固定版本 zip.js 与 fflate 的流式导出/读取、worker、CSP、许可证和包体积。
- 覆盖 7 个固定 JSONL entry、2 GiB 解压上限、16 MiB 单行、10,000,000 条记录、损坏/重复/未知/加密/路径穿越 entry。
- 对 8/16/32/64 MiB 测量无 File System Access API 时的 Blob 回退上限。

验收：选定 ZIP 库、流式策略和 Blob 阈值，失败注入后无半可见恢复数据；若 8 MiB 回退也不可靠，则明确不提供 Blob 回退。

### GATE-014-E：裁决 Gate 并冻结运行时合同

依赖：GATE-014-B、GATE-014-C、GATE-014-D。

范围：

- 汇总可复现收据，冻结搜索存储 schema、批次、包版本、worker/CSP 方式和 Blob 回退阈值。
- 更新相关 ADR、架构合同与验收矩阵；记录被否决方案及原因。
- 只允许选择 Gate 已验证的方案；任一硬门槛失败则停止后续运行时 issues。

验收：主 Agent 与中立 reviewer 对 Gate 收据给出 `GO`；合同中不再存在实现者需要自行猜测的搜索/备份字段。

## 6. 0.14.0 基础 Issues

### DB-014-A：v14 schema 与确定性迁移

依赖：GATE-014-E。

范围：

- 实现 v14 知识库主表、辅助状态表、全文版本/分段、操作日志和已冻结搜索 schema。
- 只迁移可确定投影的 v13 收藏夹/收藏项；avid-only、当前视频缓存和派生索引不得伪造为知识。
- 数据库升级原子完成；派生索引在打开后按 generation 重建。

验收：全套迁移 fixtures、回滚/中断、重复打开、非法 BVID、无文件夹和空库场景通过；旧数据不丢失且无网络/AI 请求。

### KB-014-A：知识库入口与视频资料架构

依赖：DB-014-A。

范围：

- 将原“智能收藏”顶级入口收敛为“知识库”，提供“已保存知识”“视频资料”“收藏来源”三个固定主视图和二级空间管理入口。
- 全局搜索位于三个视图上方，提交后替换当前主体为统一结果态；它不是第四个主视图。
- 展示迁移后的收藏来源、视频条目、分 P 和可解释的空/待核实/不可用状态。
- 旧入口升级后可达新位置，不复制第二套收藏或搜索产品。

验收：桌面常用宽度和窄宽 Browser/mock QA；空库、仅迁移收藏、离线、来源待核实、不可用封面均可理解且不泄漏工程字段。

### SRC-014-A：授权账号与收藏来源同步

依赖：DB-014-A、KB-014-A。

范围：

- 只在用户主动同步时读取当前已授权 B 站页面可用的账号/收藏容器信息，建立本地 owner scope、容器和成员关系。
- 完整同步才允许按缺席删除关系；不完整/失败同步保留上次已知关系并标记状态。
- 账号切换、断开和重新连接不删除本地知识资产、全文或其他 owner scope。

验收：同账号重复同步、账号切换、断开、分页中断、空收藏夹、条目移出/移回和离线 fixtures；请求审计确认不读取 Cookie/profile/login-state/key。

### SRC-014-B：稍后再看与分 P 对账

依赖：SRC-014-A。

范围：

- 将稍后再看作为独立来源关系接入同一视频条目，不复制视频身份。
- 按 cid 对账分 P；重排、改名、新增、移除分 P 不重绑既有证据。
- 来源删除只删除相应关系；仍有其他来源、资产或全文的视频条目继续存在。

验收：收藏与稍后再看重叠、单 P/多 P、cid 重排、部分元数据失败和断开账号 Browser/mock QA。

### KA-014-A：笔记与书签的持久闭环

依赖：DB-014-A、KB-014-A。

范围：

- 从当前视频或知识库创建、查看、编辑和删除笔记/书签。
- 明确可编辑用户层与只读证据版本；保存视频/分 P、时间范围和来源定位。
- 跳转必须先预览目标，再确认跳转，并支持返回原位置；证据不可用时保留资产并解释。

验收：CRUD、刷新/重开、重复保存、证据版本切换、失效来源、预览/确认/返回和删除最后引用的 shell 场景。

### FT-014-A：完整文本准入、版本与当前指针

依赖：DB-014-A。

范围：

- 仅在明确成功的知识保存/完整文本保留动作后，将可用 B 站字幕准入为受管完整文本。
- 使用冻结的 scope、fingerprint、canonical JSONL、current/historical/pending 状态和稀疏唯一当前指针。
- 在字幕 adapter 边界验证 source variant：可信稳定 track ID/type 参与变体；缺失或不可信时只能使用 `default`；URL、显示名、AI 状态和 endpoint 变化不得改变变体。
- B 站 AI 字幕需要手动打开或暂不可取时，提供可执行引导，不把缺失字幕伪装成空文本。

验收：同文去重、正文变化、时间轴变化、语言缺失、多 P、手动开启 AI 字幕、来源失效、重开和事务中断 fixtures。

### FT-014-B：容量、空间管理与全文移除

依赖：FT-014-A。

范围：

- 按 canonical serialized bytes 执行 400 MiB 提醒、500 MiB 硬上限和无自动淘汰策略。
- 提供总量/视频/版本视图、单视频全文移除、台账修复和清理失败恢复。
- 移除全文不删除知识资产或证据快照；普通“重置 Bili-Bill”保留知识库。

验收：边界字节、并发写入、容量刚好等于上限、超过上限、台账漂移、取消/重启、移除 current 后状态修复和重置分类测试。

### KA-014-B：从视频内容保存四类知识资产

依赖：KA-014-A、FT-014-A。

范围：

- 支持通过明确按钮或文本选择后的右键操作保存笔记、书签、亮点和生成回答。
- 保存字幕/生成回答时记录有序来源关系与证据版本；多来源回答保存为一个资产。
- 同一保存指纹防重复；用户标题、正文、标签可编辑，来源与证据保持只读。

验收：四类资产、选中文本右键、无选择、重复点击、跨分 P、证据变化、生成回答无有效引用和全文容量不足状态。

### SEARCH-014：generation-scoped 全局检索

依赖：KB-014-A、KA-014-B、FT-014-B、GATE-014-E。

范围：

- 按 Gate 选定方案索引视频元数据、用户标签、四类资产正文和受管完整文本。
- 统一结果页显示命中类型、视频/分 P、可读片段和可用动作；全文命中仍走预览/确认/返回。
- 新 generation 完整提交后再切换；旧 generation、删除数据和重建中断可清理/恢复。

验收：中文/英文、标题/标签/正文/全文、排序稳定、删除后不可检出、重建中断、扩展重启、500 MiB 基准和无结果 Browser/mock QA。

### BACKUP-014-A：完整/轻量流式备份

依赖：KA-014-B、FT-014-B、GATE-014-E。

范围：

- 按固定 manifest 与 JSONL entries 导出轻量或完整知识库 ZIP；完整备份包含全文，轻量备份不含全文。
- 优先流式写入用户选择文件；只在 Gate 允许范围内提供 Blob 回退。
- 导出日志不保存文件句柄、路径、正文或原始异常；取消/失败释放操作锁。

验收：空库、小库、接近 500 MiB、取消、磁盘/流失败、重启和校验哈希；备份内容审计确认不含账号标识、会话、缓存、API Key、AI provider 或搜索索引。

### BACKUP-014-B：校验、暂存与非破坏性恢复

依赖：BACKUP-014-A。

范围：

- ZIP 目录、manifest、路径、声明大小和可逐条判定的格式错误在 staging 前拒绝；需要跨记录、冲突改写或最终容量才能判定的内容可写入不可见 staging generation。
- 相同语义资产跳过；冲突资产按确定性 UUID 保留导入版本；本地当前全文不被覆盖。
- 只有完整流校验、跨引用校验、冲突改写、配额/容量复核全部成功才原子提交可见性；失败、取消或 worker 重启后可清理并要求重新选择文件。

验收：完整/轻量、重复恢复、冲突、损坏哈希、超限、未知/重复 entry、路径穿越、悬空引用、中断和恢复后搜索重建 fixtures。

### QA-014-0：0.14.0 集成、回归与中立复核

依赖：KB-014-A、SRC-014-B、KA-014-B、FT-014-B、SEARCH-014、BACKUP-014-B。

范围：

- 执行 [`qa-0.14-integration-matrix.md`](./qa-0.14-integration-matrix.md) 中 0.14.0 全矩阵和旧功能回归。
- 审计用户文案、网络请求、持久数据、清理边界、候选泄漏和失败关闭状态。
- 安排 `gpt-5.6 Terra / xhigh` 中立 code/docs review；修复全部 P0/P1，并对 P2 明确处理或延期理由。

验收：自动验证、Browser/mock QA、真实浏览器人工体验和隐私扫描均有可追溯收据；不在此 issue 修改版本或发布资产。

## 7. 0.14.1 跨视频 AI Issues

### AI-014-A：知识库 AI 授权与本地范围选择

依赖：QA-014-0。

范围：

- 增加独立、默认关闭的“知识库 AI”授权，不继承当前视频 AI 开关。
- 会话作为问答基础单元，可在不同视频继续；本地范围路由决定当前视频或知识库问题，不引入 MCP/Skill。
- 请求前展示将发送的视频/分 P、文本量、长上下文等待与费用提示，并允许用户替换来源。

验收：开关持久化、拒绝授权、无完整文本、来源替换、跨页面恢复和请求 payload 审计；未确认时零正文外发。

### AI-014-B：完整来源上下文问答与引用校验

依赖：AI-014-A。

范围：

- 每次请求发送用户已确认来源的完整受管文本、当前会话必要历史和当前问题；不做隐藏 top-N 片段截断。
- 先生成直接回答，再列可核对引用；每条引用必须映射到已发送来源和真实时间范围。
- 校验失败保留旧结果并给出可恢复状态，不把引用片段直接当回答，也不展示 raw 模型结构。

验收：单/多视频、同一问题跨视频、长上下文确认、超服务限制、慢响应、取消、引用缺失/错位、来源变化和追问连续性 Browser/mock QA。

### AI-014-C：保存多来源回答并继续会话

依赖：AI-014-B、KA-014-B。

范围：

- 用户明确保存时，把通过校验的回答保存为一个生成回答资产，并保留全部有序来源和证据版本。
- 不自动保存完整会话为知识；会话本地保留，来源未变化时可继续，来源更新/清理后只读回看并允许新建会话。
- 缓存受明确上限约束，清理缓存不删除已保存回答或完整文本。

验收：多来源保存、重复保存、刷新/回看、来源更新、全文删除、会话清理、缓存上限和资产恢复测试。

### QA-014-1：0.14.1 集成、费用边界与中立复核

依赖：AI-014-C。

范围：

- 执行跨视频问答 QA 矩阵、服务异常/长上下文/引用完整性和 0.14.0 回归。
- 对所有 AI 请求做正文授权、来源、会话历史、工程字段和敏感数据审计。
- 安排 `gpt-5.6 Terra / xhigh` 中立 code/docs review，修复 P0/P1 并记录 P2。

验收：用户能理解发送什么、为什么等待、回答依据和如何替换来源；失败不会覆盖旧结果、保存错误知识或绕过授权。

## 8. 每个实现 PR 的验证基线

- 与切片风险匹配的 focused unit/integration tests。
- `npm run typecheck`。
- `npm run build`。
- `git diff --check`。
- 受影响页面的 Browser/mock QA；涉及跳转时覆盖预览、确认、返回。
- 用户文案扫描：`未消费|猜你喜欢` 以及已禁止 raw 工程字段。
- 网络/持久化边界扫描：无 Cookie/profile/login-state/key 读取，无未授权正文外发，无正文进入操作日志、搜索诊断或错误消息。
- 数据变更 PR 必须包含升级、重开、中断、失败清理和重复执行测试。
- 大数据 PR 必须引用 Gate 收据，不得用小 fixture 推断 500 MiB 行为。

## 9. Review 与合并门槛

- PR 作者先附：scope、非目标、测试命令、Browser/mock 收据、数据/网络影响和回滚方式。
- 主 Agent 按合同、代码、测试、UI/文案、隐私五个维度 review；发现合同外需求退回 issue，不顺手扩展。
- 数据 schema、备份、恢复、检索、AI 请求边界至少需要一份独立 review 结论。
- Draft PR 只有在依赖已合并、所有 required checks 通过、人工 QA 有收据且无未解决 P0/P1 时才能转 Ready。
- 只在对应 PR 合并并核对 merge commit 后关闭 issue；不得批量预关后续 issues。

## 10. 推荐派发顺序

1. 合并 DOC-014。
2. 并行完成 GATE-014-A1 与 GATE-014-A2；两者都通过后才派发 B，随后并行推进 C/D，最后 E 裁决。
3. Gate `GO` 后完成 DB-014-A。
4. 以 DB 为共同底座并行推进 KB、SRC、KA-A、FT-A；随后完成各自依赖切片。
5. 完成 SEARCH、BACKUP、RESTORE 后执行 QA-014-0。
6. 只有 0.14.0 review/merge/close 后，才派发 AI-014-A 至 QA-014-1。
7. 发布、tag、package version 和 release notes 另立 release issue，并再次取得用户授权。

## 11. GitHub Issue 映射

| Slice | Issue | Slice | Issue |
| --- | --- | --- | --- |
| DOC-014 | #236 | GATE-014-A1 | #237 |
| GATE-014-A2 | #262 | GATE-014-B | #238 |
| GATE-014-C | #239 | GATE-014-D | #240 |
| GATE-014-E | #241 | DB-014-A | #242 |
| KB-014-A | #243 | SRC-014-A | #244 |
| SRC-014-B | #245 | KA-014-A | #246 |
| FT-014-A | #247 | FT-014-B | #248 |
| KA-014-B | #249 | SEARCH-014 | #250 |
| BACKUP-014-A | #251 | BACKUP-014-B | #252 |
| QA-014-0 | #253 | AI-014-A | #254 |
| AI-014-B | #255 | AI-014-C | #256 |
| QA-014-1 | #257 | | |

这些编号只表示任务已建档。issue 仍按前述阻塞边逐一派发；下游 issue 的存在不构成提前实现、合并或发布授权。
