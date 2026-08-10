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

浏览器必须使用官方 Chrome for Testing Stable，并同时加载本次构建的 `dist` 与固定 ID 的公开安全测试扩展。执行前从 Chrome for Testing 官方 `last-known-good-versions-with-downloads.json` 读取 Stable 版本号；runner 会核对可执行文件的 ProductName 与四段版本号，不接受普通 Chrome、缺少官方版本声明或版本不一致。执行参数启用 Chrome 沙箱，阻断除 `127.0.0.1` 外的域名解析；夹具通过带一次性令牌的本机环回地址逐次提供。每次浏览器启动还会通过 CDP 观测 runner 页的网络与控制台事件，任何外部 HTTP(S) 请求或错误事件都会立即失败；检查点和环境收据只保留分类计数，不保存 URL、本机路径或错误正文。

## 执行

先安装依赖并构建当前提交：

```powershell
npm ci
npm run build
$stable = (Invoke-RestMethod 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json').channels.Stable.version
$env:GATE_014_B1_CHROME_PATH = '<Chrome for Testing chrome.exe 的绝对路径>'
$env:GATE_014_B1_CFT_STABLE_VERSION = $stable
npm run gate014:b1:browser-smoke
npm run gate014:b1:matrix
```

官方版本号查询发生在基准启动前，仅用于固定离线执行输入；矩阵与 smoke 运行期间不依赖外部网络。中断续跑时两个环境变量都必须保持不变。

矩阵命令可在中断后原样重跑。它只接受环境指纹、夹具收据和运行身份完全一致的检查点；基准源码、构建、浏览器、运行文档或黄金收据发生变化时会拒绝续跑，必须先清理旧检查点：

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

环境和每项操作通过 SHA-256 精确绑定；验证器会重算全部收据并拒绝字段、覆盖、哈希或规范序列化漂移。验证器还会重新哈希当前基准源码、`package-lock.json`、`dist` 和全部 A1 golden receipts，确认记录的基准提交仍为当前 HEAD 的祖先；一组内部自洽但已经过期的报告不能通过。四份报告先全部写入同目录临时文件，再作为一个 bundle 安装；Node 进程可观察到的任一安装失败会回滚整组旧产物。这里不宣称四个独立文件具备跨进程崩溃或断电原子性；若发生这类中断，验证器会对缺失或混合版本的产物失败关闭，随后须从严格绑定的检查点重新生成并安装完整 bundle。

## 判定说明

任何必需指标缺失都返回 `insufficient_evidence`。500 MiB 写入/恢复不得超过 15 分钟；顺序读、账本修复和完整清理不得超过 10 分钟；已成功提交的写事务分批 p95 不得超过 2 秒、单批不得超过 5 秒；只读批次和主动回滚批次只进入独立诊断统计，不冒充已提交写事务。每项操作的提交计数必须与提交时长数组一一对应。进度、重启、取消、主线程、堆增长、原子提交和容量边界按门禁合同逐项判定，不以平均值掩盖失败。

主线程指标使用浏览器 Long Tasks API。若观察到长任务则记录最大实测时长；若没有事件，只能证明任务低于该 API 的 50 ms 报告阈值，因此收据保守记录 50 ms，而不伪写为 0 ms。该边界仍显著低于 200 ms 门槛。

`navigator.storage.estimate()` 的物理空间回收可能晚于 IndexedDB 数据库删除。报告会同时记录配额估算与数据库枚举/readback；延迟回收不会被伪写成清理失败，但数据库残留、逻辑可见性错误或缺少 readback 均会失败关闭。

恢复预检的 `required - 1` 与 `exact required` 边界由浏览器 harness 和报告推导器共用同一函数。故意不足的路径必须在请求夹具或写入 IndexedDB 前拒绝；服务器请求计数以及 `operations`、`versions`、`segments`、`state` 四个可变 store 的前后计数共同证明没有隐藏读取或写入。允许路径先核对浏览器实测可用空间不少于完整矩阵推导的 `required`（最高暂存放大倍率向上取整、25% 安全裕量和 64 MiB 固定预留），再以 `available = required` 的策略边界通过同一预检函数；只有通过后才发起该轮唯一一次 restore 夹具请求并完成真实写入、可见性和台账 readback。

这里验证的是应用预检策略的包含边界，不声称把 Chrome 的物理剩余配额人为压到刚好相等。完整矩阵结束后，报告仍会依据 40 次实测 restore 收据推导临时冗余量，并逐次核对真实可用空间；允许结论本身不能替代写入和 readback 证据。
