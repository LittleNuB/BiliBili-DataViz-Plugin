# LG-0 有限学习数据合同与验证原型

关联 #270。基线：main `0413176`，范围 PR #269 已合并。

状态：**候选合同 / 隔离原型，未冻结为生产合同，LG-0 未通过**。本文件不解锁 LG-1。先验证有界数据方案，记录真实性能和缺口，不改旧 A2/B1/C/D/E 门槛或产物。

## 数据候选

- 四类资产：note、bookmark、excerpt、answer。一条资产只含一个视频、可空的一个分 P，引用全部内嵌，因此不存在跨表引用孤儿。它们是内部字段，生产 UI 必须中文映射。
- ID 为 64 位小写十六进制；生产保存动作拟生成随机 256-bit ID，并在重试/重复点击时复用，不按标题或时间重新生成。合成 fixture 使用明确的确定性序号 ID。
- 所有字段必需：id、kind、createdAt、updatedAt、video、part、personal、snapshot、bookmarkMs、importedFrom。空值使用 null，不忽略字段。
- video={bvid,title}；part=null 或 {cid,page}。CID 用十进制字符串避免精度损失。时间戳/毫秒为非负安全整数，updatedAt 不早于 createdAt；page >= 1。
- personal={title,note,tags} 可编辑；video/part/snapshot/bookmarkMs 是保存时快照，不经编辑接口覆盖。标题最多 4096 UTF-16 code units，标签最多 64 个、单个最多 256 code units，无重复；正文上限仅受总容量约束。拒绝非完整 Unicode 字符串。
- note 无来源要求；bookmark 必须有精确分 P 和真实位置，但无需字幕。excerpt/answer 必须有 snapshot={origin,body,source,citations}，source={kind,hash}，每个 citation={fromMs,toMs,text}，正长度区间。引用 1–4096 条，全部属于资产自身的同一分 P。
- subtitle 摘录正文必须等于捕获原句按换行连接；summary/highlights/answer 只能保存上游已经逐条验证的完整结果（正文、类型、引用一致）。原型在预检及事务写入前重新校验当前证据提供器。生产适配器、跨页面 stale token 和真实跳转仍待 LG-2/LG-3 验证。
- 备份恢复只复原历史快照，绝不能把其中的来源摘要当作“当前已验证”。原型不发送 AI 请求、不读取视频、网络字幕或生产库。

## 容量与写入

规范 JSON 采用对象键字典序、资产按 ID 字典序、其他数组保留顺序、无空白、JSON 标准转义、不做 Unicode 归一化。逻辑字节为整个规范 assets 数组的 UTF-8 bytes，包括方括号/逗号、所有展示字段、引用及导入身份记录。数量 <= 1000 且字节 <= 10,485,760，等于可入、任意超 1 整体拒绝。

Dexie v14 原型只新增 lgAssets（主键 id）和 lgMeta（主键 key）。v13 fixture 由真实生产数据库类在 `lg0-` 专用名称下创建，并填入公开合成标记；从不打开默认 BiliAnalyticsDB 名称。每个旧表升级前后比对。固定大小的 epoch/revision 是协调信息，不是个人知识；物理 IDB/索引/缓存开销不归入 10 MiB 宣称。

预检读取一致快照，在事务外做容量/解析/哈希，写事务内比较 revision 并检查调用方 epoch。CAS 冲突最多 4 次尝试，仍冲突明确 busy，不覆盖并发结果。每次写入替换的是有界 lgAssets 表，绝不覆盖旧表。清空在同一事务清表并推进 epoch，旧编辑稿不能迟到复活。普通设置重置和缓存清理未接入原型，生产保护尚待验证。

提交状态明确为短暂不可取消；AbortSignal 只覆盖提交前。模拟 abort/quota 在写入后故意抛错以检验事务回滚，**不等于真实磁盘配额或进程崩溃证据**。保存失败不修改调用方原始编辑稿。重复保存同 ID 同内容幂等；同 ID 不同内容拒绝。只有个人层编辑接口可更新个人字段与更新时间。

## 搜索与备份

搜索是有界线性扫描：个人标题/备注/标签、视频标题、保存正文和引用原句。查询最多 256 code units，以 NFKC + 小写标准化、空白分词、词间 AND、单词子串匹配；类型/视频精确筛选；结果仅返回稳定 ID，按 ID 排序，不承诺相关性排名。每次从当前提交状态读取，因此不维护可能失效的持久搜索索引。正文不包含全部视频字幕。

备份唯一格式是规范 UTF-8 JSON：`{"assets":[],"format":"bili-bill-learning","version":1}`。未加密，与旧 ZIP v1 无关系。文件上限为 10,485,760 + 规范空封套字节（由 MAX_FILE_BYTES 同一常量计算）；读入前检查 Blob.size。严格 UTF-8 解码、完整白名单、资产验证及规范编码相等检查，拒绝未知字段/版本、重复 JSON 键、重复 ID、额外空白和损坏文件。只接受本工具规范导出，不承诺接受手工改格式的 JSON。

恢复保留本地：ID 不存在则新增、完整内容一致则跳过。ID 冲突时以 `SHA256('lg0-import:' + incoming.id + ':' + SHA256(canonical(incoming)))` 生成副本 ID，并记录 importedFrom={id,digest}。重复导入通过副本身份识别；副本个人层后来修改也保留，不再制造相同副本。保留 ID 已被其他来源占用则整体拒绝，不能覆盖本地。所有副本的额外字节仍参与最终容量检查。导入身份真实性/恶意保留 ID 验证还需补齐后才冻结生产合同。

## 本次固定测量设计

首次正式测量前，runner 写 preflight.json：OS/CPU/内存、Node、源码文件 SHA-256、实际浏览器 bundle SHA-256、seed、容量、运行次数、度量边界。浏览器执行时记录 Browser.getVersion 精确版本；安装位置由显式参数指定，禁止使用任何既有用户配置目录。每个 profile 都在工作区 release-artifacts/lg0 下新建，仅包含合成 fixture，不遍历或读取 profile 文件。

6 场景：空库、30 条典型、1000 条数量边界、1000 条合计恰好 10 MiB、单条恰好 10 MiB、1000 条每条 16 个引用的中英文资产。每场景 3 个独立新 profile，播种后关闭浏览器，再重开测一次 cold；第三个 profile 接着 5 次 warm。共 48 次，失败和重跑分别保留。cold 指浏览器/连接冷重开，不宣称操作系统磁盘缓存也冷。

搜索从提交调用开始，到结果数量写入 output 后第二个 animation frame；cold 含打开库，warm 复用连接。导出、导入校验、冲突预检、原子提交分别计时。主线程 PerformanceObserver longtask 记录 >=50ms 任务，候选最大 <=200ms；搜索候选 cold p95 <=2000ms / warm p95 <=500ms。六个场景分别判定，不用全局平均掩盖失败。

运行阶段边界采样 performance.memory.usedJSHeapSize，候选增长预算 256 MiB，**这是阶段采样高水位，不是绝对峰值或 renderer RSS，也未覆盖恶意输入峰值**。此限制意味着本轮内存证据不能直接放行 LG-0。后续需完善可取消预检/进度、实际峰值内存及故障中断测量，必要时转 Worker，不静默放宽候选。

## 运行与缺口

`node --test tests/lg0-learning-contract.test.ts`

设置 LG0_PLAYWRIGHT_MODULE 为已有 Playwright index.mjs、LG0_CHROME_EXECUTABLE 为 Chrome stable 可执行文件，再运行 `node scripts/lg0/run-browser.mjs`。使用现有外部测试工具，不修改 package/lock。runner 仅服务固定 loopback 页面和 bundle，外部解析被阻断，所有浏览器与服务器在结束后关闭。原始报告保存在工作区 release-artifacts/lg0，提交仅选公开 JSON 报告，绝不提交 profile 内容。

未覆盖的放行项：正式 Worker/UI 进度与取消（不把预先取消测试当成运行中取消）、真实进程/扩展中断与恢复、实际 quota 故障、恶意输入内存峰值、导入身份安全加固、生产重置保护。LG-0 保持未完成，不开始 LG-1，不宣布 0.14.0 完成。
