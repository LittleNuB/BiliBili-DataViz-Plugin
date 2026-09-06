# LG-0 首轮合成验证

关联 #270。隔离原型，未接入生产扩展。日期 2026-09-06。

## 当前裁决

**产物验证 pass；性能候选 fail；LG-0 未完成，不能开始 LG-1。**

首轮原始收据在 [2026-09-06T08-18-46-671Z-a891606c](2026-09-06T08-18-46-671Z-a891606c/report.json)，测前冻结记录在 [preflight.json](2026-09-06T08-18-46-671Z-a891606c/preflight.json)，完整裁决在 [verdict.json](2026-09-06T08-18-46-671Z-a891606c/verdict.json)。runner 的 lg0GateStatus 是未裁决占位，最终以 verifier 的 candidateGateStatus 为准；不得用占位值掩盖已测出的失败。

6 个固定场景，每个 3 cold + 5 warm，共 48 次，无运行错误、无页面外部请求。真实 Chrome 152.0.7977.77（已安装 stable）、Node v24.14.1。官方 2026-09-04 的 [stable 元数据](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json) 为 152.0.7977.82；本轮未自动升级浏览器，不声称验证最新 patch。精确 OS/CPU/内存见收据。

| 场景 | 冷搜索 p95 ms | 暖搜索 p95 ms | 最长主线程任务 ms | 最大阶段采样堆增长 MiB |
| --- | ---: | ---: | ---: | ---: |
| 空库 | 113.2 | 6.7 | 0 | 0.8 |
| 30 条典型 | 126.4 | 6.8 | 0 | 1.7 |
| 1000 条数量边界 | 465.7 | 10.8 | 59 | 27.4 |
| 1000 条合计 10 MiB | 198.8 | 205.2 | 767 | 372.7 |
| 单条 10 MiB | 70.2 | 62.5 | 781 | 500.0 |
| 1000 条引用密集 | 78.3 | 41.0 | 277 | 76.9 |

搜索均达到 cold <=2000ms / warm <=500ms 候选。后三场景主线程任务超过 200ms；两个 10 MiB 场景的阶段采样增长超过预先声明的 256 MiB 候选。采样不是绝对峰值，但已观察到的超额足以证明该方案未达到该候选，不需要将未测到的峰值当作通过。

全部 48 次往返提交回读一致；18 次播种后的正常浏览器关闭/重开保留数据，21 个真实 v13 schema 的合成表均保持内容不变。注入升级失败、事务 abort/quota、提交前取消与清空后的旧 epoch 写入均被拒绝且不损害已有记录。以上不证明真实磁盘配额耗尽、强制杀进程或扩展 service worker 被终止后的行为。

## 解释与最小修复方向

证据支持**当前主线程全量 JSON 预检/恢复原型存在计算与分配开销**，不支持“10 MiB 产品范围必须放弃”或“浏览器环境是唯一原因”。当前实现同时持有原记录、JSON 字符串、UTF-8 缓冲、解码结果、冲突副本与事务克隆；阶段时延与高水位定位了风险，但未做逐函数内存归因，不能把全部增长都归因于某一个函数。

下一技术迭代应保持 1000/10 MiB 和全部失败场景：将校验/序列化/检索移到 Worker；复用验证结果、缩短对象生命周期、避免无变化恢复重写；补运行中取消/进度和绝对内存/中断证据，再复跑同一矩阵。Worker 只能隔离主线程，不能单独证明内存问题解决。需要降低容量或改变时间目标时另行提出范围修订，不能静默改。

## 验证与边界

- `node --test tests/lg0-learning-contract.test.ts`：初版 11/11。
- `node scripts/lg0/verify-report.mjs --verify docs/benchmarks/lg0/2026-09-06T08-18-46-671Z-a891606c`：检查场景、次数、计时、容量、故障及源码绑定；验证器 PASS 不等于候选通过。
- 全量测试初版 619/620；唯一失败仍是现有 CI 文件 CRLF 与 LF-only 正则不兼容（tests/gate-014-b1-matrix-runner.test.ts:99），未改该文件或测试。
- typecheck / build 通过；release distribution 18 notices、8 entries、14 chunks；npm audit 0 vulnerabilities。
- 历史 B1 verify 仍 pass，4680 operations，绑定未改；没有重跑或替换旧 B1。
- 未读 Cookie、用户 profile、登录状态、凭据或用户库，未采集字幕、调用 AI、修改 release/tag/package。

新脚本及这份报告不是生产实现，候选数据合同还需审查与补齐文档所列缺口。PR 保持 Draft，不将 #270 或 0.14.0 标记完成。
