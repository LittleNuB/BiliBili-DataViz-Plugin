# GATE-014-B1 合成存储基线运行手册

## 目的与边界

GATE-014-B1 只验证确定性合成数据在 Chrome MV3 + IndexedDB 环境中的工程边界：容量、分批、事务可见性、账本修复、重启恢复、取消、清理与恢复暂存。它不读取真实浏览器资料、登录状态、Cookie、Key 或账号数据，也不发起外部网络请求。

本门禁不能证明真实 B 站字幕分布、真实用户性能分位数、平台级容量或最终产品参数。GATE-014-A2 校准、真实字幕代表性与最大实测分片尾部在本报告中必须保持 `insufficient_evidence`；A2 仍阻塞 GATE-014-C/D 与最终参数冻结。

## 固定矩阵

- 候选批次：256、512、1024 条，分别组合 1、2、4 MiB 字节上限。
- 夹具：100、400、500 MiB 普通全文，64 MiB 单版本，以及 16 MiB 高碎片化夹具。
- 每个候选与夹具执行 3 次冷运行和 5 次暖运行，共 360 个运行检查点、4680 项操作收据。
- “冷运行”仅表示全新的临时 Chrome 资料目录和重新打开的扩展，不表示清空操作系统页缓存或磁盘缓存。
- “暖运行”在同一候选/夹具组内复用临时资料目录。每轮开始时，测试扩展会在同一进程内写入、打开并核对一个完整的辅助 generation，并在它保持打开时启动被测 generation；辅助库和被测库在该轮结束后都必须删除并通过 readback。辅助 generation 的准备时间不混入 13 项操作收据，但其完整性、台账一致性和最终清理均为硬断言。断点恢复可使用新的临时资料目录，因为每个待测暖运行都会重新建立并核对自己的完整辅助 generation。
- 每轮固定依次验证 admission、commit visibility、restart、marker normalization、ordered read、ledger repair、capacity boundary、atomic rollback、cancellation、full clear、restore staging、quota refusal 和 selected-version removal。`full clear` 必须先证明完整夹具仍在库中再清空；恢复完整夹具后先验证配额拒绝不改动任何 store，最后才删除指定版本。不得用已经删除为空的单版本夹具冒充完整清空证据。

浏览器必须使用官方 Chrome for Testing Stable，并同时加载本次构建的 `dist` 与固定 ID 的公开安全测试扩展。执行前保存 Chrome for Testing 官方 `last-known-good-versions-with-downloads.json` 原文；runner 会校验 Stable channel、revision、时间戳、Win64 下载地址和原文 SHA-256，再要求可执行文件的 ProductName 精确等于 `Google Chrome for Testing`、ProductVersion 精确为与元数据一致的四段数字版本，不接受前后缀、再品牌版本、普通 Chrome、缺少官方元数据或版本不一致。执行参数启用 Chrome 沙箱、禁用代理、关闭组件更新、模型执行总开关与独立的端侧模型能力，减少全新资料目录或重启触发与存储基准无关的模型组件活动；同时用 `~NOTFOUND` 在整个 Chrome 进程中阻断除 `127.0.0.1` 外的域名解析，因此矩阵没有外部运行时网络依赖。夹具通过带一次性令牌的本机环回地址逐次提供。

DevTools 接通后，runner 会观测当时已加载及随后出现的全部扩展 page、background page、service worker 和 shared worker 目标。公开安全 harness 只在本轮全新的临时 profile 中使用 `chrome.management`，要求固定 harness 与本次 `dist/manifest.json` 声明的生产扩展各精确出现一次。从 observer 首次枚举目标开始，初始附件、harness 页面就绪与清单读取、生产 service worker 轮询及 `chrome.runtime` 身份复核共用一个 30 秒设置窗口；提前缓存的附件不能重置窗口。生产 page、background page 或 shared worker 不能代替这项证明。它不会为证明加载而额外打开 dashboard 或改变被测工作负载，枚举结果与扩展 ID也不写入收据。每次浏览器启动的收据只记录生产扩展目标数和 harness 目标数，二者都必须至少为 1，防止 harness-only 运行冒充生产构建基准。生产扩展正常启动时可能尝试访问 B 站 API；这类外部请求尝试会被 DNS 策略阻断并如实计数，不作为“外部依赖已使用”。任何观测期内的外部 HTTP(S) 响应，以及扩展 target 的 Runtime 异常、`console.error`、`console.assert` 或可归因到 `chrome-extension://` 来源的错误日志都会立即失败。CDP `Log` 域也可能把没有扩展来源的 Chrome 内部错误投递给已附加 target；这类事件只累计到 `unattributedLogErrorCount`，不保存错误正文，也不冒充生产扩展或 harness 控制台错误。检查点和环境收据只保留观测范围、目标数和分类计数，不保存 URL、本机路径或错误正文。Chrome 启动到 DevTools 附加之前的事件无法由该 CDP 观测器回溯，收据明确记录 `preAttachEventsObserved: false`；零外部响应或零扩展错误只描述附加后的观测范围，不冒充完整启动期证明。

每次浏览器阶段结束时，runner 必须终止整个 Chrome 进程树并观察到父进程退出；仅发出 kill、只结束父进程或等待超时都不算成功。进程身份不可用、进程树终止失败或 5 秒内未退出均使该轮失败关闭，避免残留子进程污染后续冷/暖运行。

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

官方元数据下载发生在基准启动前，仅用于固定离线执行输入；矩阵与 smoke 运行期间不依赖外部网络。中断续跑时 Chrome 路径、元数据路径及该文件内容都必须保持不变。

矩阵命令要求 tracked worktree 干净，并在采集环境指纹前自行执行一次 `npm run build`。环境收据分别哈希完整生产源码输入和新生成的 `dist`，防止旧构建被误绑定。命令可在中断后原样重跑；它只接受环境指纹、夹具收据和运行身份完全一致的检查点，生产源码、基准源码、构建、浏览器、官方元数据、运行文档或黄金收据发生变化时会拒绝续跑，必须先清理旧检查点：

```powershell
npm run gate014:b1:cleanup
```

清理命令只删除固定的 `tests/fixtures/gate-014/b1-runs/` 目录。生成的大型 JSONL 夹具位于 `tests/fixtures/gate-014/generated/`，逐夹具运行后自动清理，也可使用 `npm run gate014:fixtures:cleanup` 单独清理。两类目录均被 Git 忽略。

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

主线程指标使用浏览器 Long Tasks API。若观察到长任务则记录最大实测时长；若没有事件，只能证明任务低于该 API 的 50 ms 报告阈值，因此收据保守记录 50 ms，而不伪写为 0 ms。该边界仍显著低于 200 ms 门槛。

`navigator.storage.estimate()` 的物理空间回收可能晚于 IndexedDB 数据库删除。报告会同时记录配额估算与数据库枚举/readback；延迟回收不会被伪写成清理失败，但数据库残留、逻辑可见性错误或缺少 readback 均会失败关闭。

恢复预检的 `required - 1` 与 `exact required` 边界由浏览器 harness 和报告推导器共用同一函数。故意不足的路径必须在请求夹具或写入 IndexedDB 前拒绝；服务器请求计数以及 `operations`、`versions`、`segments`、`state` 四个可变 store 的前后计数共同证明没有隐藏读取或写入。允许路径先核对浏览器实测可用空间不少于完整矩阵推导的 `required`（最高暂存放大倍率向上取整、25% 安全裕量和 64 MiB 固定预留），再以 `available = required` 的策略边界通过同一预检函数；只有通过后才发起该轮唯一一次 restore 夹具请求并完成真实写入、可见性和台账 readback。

这里验证的是应用预检策略的包含边界，不声称把 Chrome 的物理剩余配额人为压到刚好相等。完整矩阵结束后，报告仍会依据 40 次实测 restore 收据推导临时冗余量，并逐次核对真实可用空间；允许结论本身不能替代写入和 readback 证据。
