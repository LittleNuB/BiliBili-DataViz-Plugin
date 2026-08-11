# GATE-014-B1 合成存储基线运行手册

## 目的与边界

GATE-014-B1 只验证确定性合成数据在 Chrome MV3 + IndexedDB 环境中的工程边界：容量、分批、事务可见性、账本修复、重启恢复、取消、清理与恢复暂存。它不读取真实浏览器资料、登录状态、Cookie、Key 或账号数据，也不发起外部网络请求。

本门禁不能证明真实 B 站字幕分布、真实用户性能分位数、平台级容量或最终产品参数。GATE-014-A2 校准、真实字幕代表性与最大实测分片尾部在本报告中必须保持 `insufficient_evidence`；A2 仍阻塞 GATE-014-C/D 与最终参数冻结。

## 固定矩阵

- 候选批次：256、512、1024 条，分别组合 1、2、4 MiB 字节上限。
- 夹具：100、400、500 MiB 普通全文，64 MiB 单版本，以及 16 MiB 高碎片化夹具。
- 每个候选与夹具执行 3 次冷运行和 5 次暖运行，共 360 个运行检查点、4680 项操作收据。
- “冷运行”仅表示全新的临时 Chrome 资料目录和重新打开的扩展，不表示清空操作系统页缓存或磁盘缓存。
- 每次暖运行也使用独立的全新临时资料目录。该轮开始时，测试扩展会在同一浏览器进程内写入、打开并核对一个完整的辅助 generation，并在它保持打开时启动被测 generation；“暖”描述被测时已存在且已打开的完整 generation，不表示跨重复运行复用 profile。辅助库和被测库在该轮结束后都必须删除并通过 readback。辅助 generation 的准备时间不混入 13 项操作收据，但其完整性、台账一致性和最终清理均为硬断言。因此 `--max-new-runs` 可以在任意运行检查点后暂停，续跑不会改变尚未执行运行的 profile 条件。
- 每轮固定依次验证 admission、commit visibility、restart、marker normalization、ordered read、ledger repair、capacity boundary、atomic rollback、cancellation、full clear、restore staging、quota refusal 和 selected-version removal。`full clear` 必须先证明完整夹具仍在库中再清空；恢复完整夹具后先验证配额拒绝不改动任何 store，最后才删除指定版本。不得用已经删除为空的单版本夹具冒充完整清空证据。

候选 byte cap 按当前 transaction 实际读取的规范记录负载计算。segment store 使用每条 segment JSONL 行的 UTF-8 字节；version store 使用夹具 ingest 时直接从 A1 原始 version metadata JSONL 行取得的 UTF-8 字节。后者作为 `versionRecordCanonicalBytes` 派生保存，不由运行时 `JSON.stringify` 估算、不包含该派生字段自身，也不表示 IndexedDB 磁盘占用。version 的 `canonicalBytes` 仍是该版本关联全文的唯一账本 aggregate，只用于逻辑求和，不能拿来切分 metadata row，否则会与随后读取的 segments 重复计算同一全文负载。任一 record bytes 缺失、非正整数或单条超过候选 cap 都失败关闭。

浏览器必须使用官方 Chrome for Testing Stable，并加载本次构建的 `dist` 与固定 ID 的公开安全测试扩展。执行前保存 Chrome for Testing 官方 `last-known-good-versions-with-downloads.json` 原文；runner 会校验 Stable channel、revision、时间戳、Win64 下载地址和原文 SHA-256，再要求可执行文件的 ProductName 精确等于 `Google Chrome for Testing`、ProductVersion 精确为与元数据一致的四段数字版本，不接受前后缀、再品牌版本、普通 Chrome、缺少官方元数据或版本不一致。执行参数启用 Chrome 沙箱、禁用代理、关闭组件更新、模型执行总开关与独立的端侧模型能力，减少全新资料目录或重启触发与存储基准无关的模型组件活动；同时用 `~NOTFOUND` 在整个 Chrome 进程中阻断除 `127.0.0.1` 外的域名解析，因此矩阵没有外部运行时网络依赖。夹具通过带一次性令牌的本机环回地址逐次提供。

runner 只启用本机 `--remote-debugging-pipe` 和动态扩展调试，不开放 TCP DevTools 端口。每个浏览器阶段先把新构建的生产 `dist` 复制到独立受管临时目录，并逐路径、逐字节复算 SHA-256；接通管道后先以 `Target.setAutoAttach(waitForDebuggerOnStart=true)` 为 service worker 安装启动屏障，再通过 `Extensions.loadUnpacked` 依次加载固定 harness 与本阶段验证过的生产副本。首段与同 profile 重启段都执行这一顺序。生产身份和合成未登录启动响应完成闭环后、合成存储 workload 开始前，runner 必须通过 `Extensions.uninstall` 移除本阶段生产登记，并以 `Extensions.getExtensions` 确认该 ID 已不存在；固定 harness 来源及其合成 IndexedDB 保留。Chrome 进程树终止后，本阶段生产副本根目录必须删除并读回为不存在，下一阶段才能启动。首段 `Extensions.loadUnpacked` 实际返回的生产 ID 还会仅在当前进程内加入 forbidden 集合并传给同 profile 重启段；任何匹配 prior production ID 的 worker 无论暂停与否都在恢复前失败关闭。本阶段实际加载得到的 production ID 不得与 forbidden 集合冲突，observer 也会保留此前 nonpaused attach 的历史，即使目标随后 detach，也不能在 ID 返回后冒充已受屏障保护的 current production。删除旧源路径只是附加边界，不能替代这条 ID 级重启证明。重启时若固定 harness worker 已运行，observer 可以从接通后开始观察它；该公开安全 worker 只登记空的安装监听，不参与生产屏障证明。未归因扩展 worker 也可以继续被观测，但不能提供生产屏障、身份或启动响应证明，其网络与错误仍按相同严格规则检查。current production service worker 必须以 `waitingForDebugger=true` 自动附加，并在恢复前启用 `Runtime`、`Network`、`Log` 和 `Fetch`。teardown 期间 listener 会保持到 auto-attach 关闭且新增 attachment 再次完成结算，关闭窗口内出现 forbidden worker 仍会使本阶段失败。生产自动附加缺失、未暂停、prior production 目标重现、production ID 冲突、配置超时、手动 attach 替代、启动响应未闭环、暂存哈希不符、卸载/读回失败或副本清理失败均失败关闭。临时路径和扩展 ID 不写入收据或报告。

生产扩展启动后，只对动态加载返回的生产扩展 ID 发往原始查询串严格等于 `/x/web-interface/history/cursor?ps=30` 的 HTTPS GET 请求使用 CDP 本地返回公开安全的“未登录”响应；其他扩展、方法、主机、路径、端口或查询形状一律失败关闭。生产 ID 尚未返回时最多暂存 8 条已暂停请求，第 9 条立即失败；身份确定后，暂存请求仍按完整规则逐条复核。动态加载返回的 ID 还必须与 harness `chrome.management` 清单中本次 `dist/manifest.json` 的唯一生产扩展一致。该响应不读取 Cookie、登录态或真实用户资料，不经过 DNS 或外部网络，并单独累计为 `syntheticUnauthenticatedResponseCount`；每次浏览器启动必须至少观察到并闭合一条 `Fetch`/`Network` 请求响应关联，否则本轮失败。

DevTools 接通后，runner 会观测随后动态加载或出现的扩展 page、background page、service worker 和 shared worker 目标。公开安全 harness 只在全新临时 profile 中使用 `chrome.management`，要求固定 harness 与生产扩展各精确出现一次。从启动屏障安装开始，动态加载、harness 页面就绪与清单读取、生产 service worker 轮询及 `chrome.runtime` 身份复核共用一个 30 秒设置窗口；提前缓存的附件不能重置窗口。生产 page、background page 或 shared worker 不能代替生产 service worker 证明。它不会为证明加载而额外打开 dashboard 或改变被测工作负载，枚举结果与扩展 ID 也不写入收据。每次启动的 v4 收据要求 `productionServiceWorkerStartupBarrierEnabled: true`，且生产扩展目标数和 harness 目标数都至少为 1。合成响应不算外部 HTTP(S) 响应；任何其他观测到的外部响应，以及扩展 target 的 Runtime 异常、`console.error`、`console.assert` 或可归因到扩展来源的错误日志都会立即失败。CDP `Log` 域中 `source=javascript` 的错误按扩展错误处理；`source=other` 的错误只累计到 `unattributedLogErrorCount`，不根据 target URL 升级归因，也不保存错误正文。检查点和环境收据只保留观测范围、目标数和分类计数，不保存 URL、本机路径或错误正文。Chrome 自身在调试管道接通前的事件仍无法回溯，因此收据保持 `preAttachEventsObserved: false`；该限制不适用于在屏障安装后才动态加载的生产 service worker，但零错误仍不被描述成完整 Chrome 启动期证明。

每次浏览器阶段结束时，runner 必须终止整个 Chrome 进程树并观察到父进程退出；仅发出 kill、只结束父进程或等待超时都不算成功。在 Windows 上，runner 保持 CDP 管道存活，先读取进程 ID 与父进程 ID，并确认根进程仍在终止前进程表中且尚未退出；原生 `taskkill /T /F` 必须成功启动并完成。原生命令返回后启动一个绝对 5 秒的共享收敛窗口，同时覆盖父进程退出和已捕获 lineage 的 50 ms 轮询归零，不会在父进程退出后重新获得另一段 5 秒。每次轮询都以终止前同一份不可变进程表为基线，并累计已经观察到的后代身份，因此父进程先退出时，其仍存活的后续子孙不会从证据中丢失。已完成的原生终止尝试即使返回数值非零，也只有在“父进程退出”和“lineage 无残留”两个独立后置条件同时成立时才可通过；该结果不推断非零退出的具体原因。命令无法启动、超时、被 signal 中断、任一次进程表读取失败、父进程未在共享窗口内退出或窗口结束时存在残留后代仍失败关闭。只有完整闭环成立后才关闭 CDP 管道；检查不读取命令行、可执行文件路径或浏览器 profile，也不把退出码、进程 ID、轮询次数、路径或命令输出写入收据。

共享收敛窗口内每次 PowerShell 进程表读取的 timeout 都取当时剩余毫秒数，而不是另给独立的 10 秒；读表完成时已经越过绝对截止时间，即使返回空表也失败关闭。父进程耗尽窗口后不再启动读表。

## 执行

先安装依赖并构建当前提交：

```powershell
npm ci
npm run build
$cftMetadata = Join-Path $env:TEMP 'gate-014-b1-cft-stable.json'
Invoke-WebRequest 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' -OutFile $cftMetadata
$env:GATE_014_B1_CHROME_PATH = '<Chrome for Testing chrome.exe 的绝对路径>'
$env:GATE_014_B1_CFT_METADATA_PATH = $cftMetadata
npm run gate014:b1:browser-smoke
npm run gate014:b1:matrix
```

官方元数据下载发生在基准启动前，仅用于固定离线执行输入；矩阵与 smoke 运行期间不依赖外部网络。只有 `--max-new-runs` 在某一轮 checkpoint、profile 清理和 active lease 删除全部完成后产生的受控暂停才能续跑；续跑时 Chrome 路径、元数据路径及该文件内容都必须保持不变。浏览器轮次失败、进程崩溃、signal 中断或清理/报告安装失败不属于可续跑中断。

矩阵命令要求 worktree 中没有已修改、已暂存或未跟踪的非忽略文件；只有 `.gitignore` 明确排除且位于生产输入之外的本门禁生成物和检查点可以存在。runner 还会把实际生产输入文件清单与 Git 跟踪清单逐项比对，因此 `public/*.local` 之类被忽略但会进入构建的文件也会在读取和构建前失败关闭。随后 runner 在采集环境指纹前自行执行一次 `npm run build`。环境收据分别哈希完整生产源码输入和新生成的 `dist`，防止本地未提交输入或旧构建被误归因给记录的 HEAD。受控暂停后可原样重跑；它只接受环境指纹、夹具收据和运行身份完全一致的检查点，生产源码、基准源码、构建、浏览器、官方元数据、运行文档或黄金收据发生变化时会拒绝续跑，必须先清理旧检查点：

```powershell
npm run gate014:b1:cleanup
```

清理命令只删除固定的 `tests/fixtures/gate-014/b1-runs/` 目录。生成的大型 JSONL 夹具位于 `tests/fixtures/gate-014/generated/`，逐夹具运行后自动清理，也可使用 `npm run gate014:fixtures:cleanup` 单独清理。两类目录均被 Git 忽略。

每次夹具准备、单轮运行、夹具清理和最终报告安装前，runner 都会在检查点目录中安装唯一 `active-run.json`。单轮只有在 lifecycle、checkpoint 校验/安装、profile 清理全部完成后才删除 lease；删除后才把该轮计为完成。任一异常会尝试以不覆盖方式安装 `failure.json`，并保留 active lease。failure marker 只含 session/环境绑定摘要、公开夹具与候选身份、封闭阶段/分类、可选的受控 browser/harness code 和已完成 checkpoint 数；不写异常正文、stack、stderr、URL、路径、PID 或凭据。harness code 只能由浏览器内合成 harness 的 factory 创建，并经模块私有 `WeakMap` 来源登记、固定 envelope 和字符集校验后传出；Node 浏览器控制链只能从封闭 stage code 集合中创建外层 code，并由另一个模块私有 `WeakMap` 登记。浏览器控制码进一步区分生产副本、环境、进程、扩展加载、worker、合成启动响应、harness 执行、观测收敛及清理边界；进程清理还区分终止前状态、原生终止、父进程退出、lineage 收敛、终止证据校验和 CDP 管道关闭。已证明的主错误在清理失败时保持优先。两侧伪造同名自有属性都不会通过来源校验。CDP exception description、`Error.message`、stack 与 cause 都不会被解析或提升为 marker 字段。这里的安装原子性仅指同目录 Node 可观察边界，不宣称断电持久性。

`run` 与 `verify` 共用同一目录审计；`run` 会在构建、创建 session 或启动浏览器前完成审计，`verify` 会在读取报告前完成审计。任一 active lease、failure marker、残留 `.tmp`、未知文件/目录、无 session 的 checkpoint 或损坏状态均永久拒绝当前 session，不允许通过重跑选取更好样本。后续同配置诊断运行即使通过，也不能恢复失败的矩阵。唯一恢复方式是执行 `npm run gate014:b1:cleanup`，并从 0 重跑全部 360 轮。

## 验证与产物

完整矩阵结束后执行：

```powershell
npm run gate014:b1:verify
npm run test:gate014:b1
npm run test:gate014
npm run gate014:fixtures:verify
npm run typecheck
npm run build
git diff --check
```

最终提交四份有界、公开安全的证据文件：

- `gate-014-b1-environment.json`：环境、源码、构建和浏览器指纹。
- `gate-014-b1-raw-operations.jsonl`：4680 项规范 JSONL 操作收据。
- `gate-014-b1-report.json`：严格重算后的门禁报告与候选裁决。
- `gate-014-b1-summary.md`：中文摘要与证据限制。

环境和每项操作通过 SHA-256 精确绑定；验证器会重算全部收据并拒绝字段、覆盖、哈希或规范序列化漂移。验证器还会重新哈希当前基准源码、完整生产源码输入、`package-lock.json`、`dist` 和全部 A1 golden receipts，确认记录的基准提交仍为当前 HEAD 的祖先；一组内部自洽但已经过期的报告不能通过。四份报告先全部写入同目录临时文件，再作为一个 bundle 安装；Node 进程可观察到的任一安装失败会回滚整组旧产物。这里不宣称四个独立文件具备跨进程崩溃或断电原子性；若发生这类中断，验证器会对缺失或混合版本的产物失败关闭，随后须从严格绑定的检查点重新生成并安装完整 bundle。

## 判定说明

任何必需指标缺失都返回 `insufficient_evidence`。500 MiB 写入/恢复不得超过 15 分钟；顺序读、账本修复和完整清理不得超过 10 分钟；已成功提交的纯写事务分批 p95 不得超过 2 秒、单批不得超过 5 秒。每项操作分别提交 `readBatchDurationsMs`、`committedBatchDurationsMs` 和包含两者的全量诊断数组，报告分别输出读取与已提交写事务的计数、median、p95 和 maximum。扫描读取与随后写入不得合并成一次写入计时；只读批次和主动回滚批次只进入独立诊断统计，不冒充已提交写事务。admission、commit visibility、marker normalization、ledger repair、capacity boundary、cancellation、full clear、restore staging 和 selected-version removal 必须具有非零的已提交写事务证据；全部 13 项操作都必须具有严格大于 0 的读取证据，并用命名字段记录该操作结束前的最终账本与可见版本 readback。admission/restore 还必须分别命名并记录提交前可见图、提交前账本与可见版本、提交后可见图三项严格大于 0 的计时。每个命名读取计时都必须按数值及重复次数包含在 `readBatchDurationsMs` 中，分类后的全部读取与提交时长又必须按数值及重复次数完整包含在全量诊断数组中，而不只是数量不超限。每项操作的提交计数仍必须与提交时长数组一一对应。报告还按 9 个候选、5 个夹具、13 项操作及冷/暖模式生成固定 1170 组重复运行中位数与 p95。进度、重启、取消、主线程、堆增长、原子提交和容量边界按门禁合同逐项判定，不以平均值掩盖失败。

只读批次从 read-batch 调用前开始计时，只有其内部 readonly transaction 的 `oncomplete` 到达后才结束；cursor 的 `onsuccess` 只冻结这一批的结果，不能提前结算计时。transaction error、abort、结果缺失或重复均失败关闭；浏览器计时分辨率下仍为 0 ms 的读取继续视为证据不足，不通过等待、钳位、伪增量或重试挑选更好样本来修饰。

主线程指标使用浏览器 Long Tasks API。若观察到长任务则记录最大实测时长；若没有事件，只能证明任务低于该 API 的 50 ms 报告阈值，因此收据保守记录 50 ms，而不伪写为 0 ms。该边界仍显著低于 200 ms 门槛。

`navigator.storage.estimate()` 的物理空间回收可能晚于 IndexedDB 数据库删除。报告会同时记录配额估算与数据库枚举/readback；延迟回收不会被伪写成清理失败，但数据库残留、逻辑可见性错误或缺少 readback 均会失败关闭。

恢复预检的 `required - 1` 与 `exact required` 边界由浏览器 harness 和报告推导器共用同一函数。故意不足的路径必须在请求夹具或写入 IndexedDB 前拒绝；服务器请求计数以及 `operations`、`versions`、`segments`、`state` 四个可变 store 的前后计数共同证明没有隐藏读取或写入。允许路径先核对浏览器实测可用空间不少于完整矩阵推导的 `required`（最高暂存放大倍率向上取整、25% 安全裕量和 64 MiB 固定预留），再以 `available = required` 的策略边界通过同一预检函数；只有通过后才发起该轮唯一一次 restore 夹具请求并完成真实写入、可见性和台账 readback。

这里验证的是应用预检策略的包含边界，不声称把 Chrome 的物理剩余配额人为压到刚好相等。完整矩阵结束后，报告仍会依据 40 次实测 restore 收据推导临时冗余量，并逐次核对真实可用空间；允许结论本身不能替代写入和 readback 证据。
