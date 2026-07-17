# Bili-Bill 0.13 本地转录 Spike 报告

结论日期：2026-07-17

Issue：[#175 ASR-013-SPIKE](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/175)

## 结论

**No-go。0.13 不开放普通 UI 本地转录入口，不创建 ASR-013-IMPL。**

第五轮安全复核后，当前 machine-readable aggregate **不通过**。Windows 上可以通过本次隔离 CDP 连接安全请求关闭本次浏览器并确认根进程退出，但没有 Job Object 就不能证明启动时进程树所有权或所有后代均已终止；因此不删除临时 root，MV3 cleanup gate 必须 fail closed。第五轮完整运行还遇到三个公开域名的连接超时，所以 `publicSamples`、`modelRuntime`、`mv3` 均未通过。第四轮取得的公开样本与固定 revision 数值仅保留为历史证据，不能覆盖当前失败。

但本次 spike 没有通过硬门槛：

- 最小 MV3/offscreen/WASM/worker 容器已经验证，但没有在该容器内加载候选运行时或模型，不能把最小 WASM 通过等同于本地 ASR 通过。
- 没有在扩展页 WebAudio 中完成 MP4/AAC 解封装、解码和 16 kHz 单声道 PCM 转换。
- 没有在浏览器 WASM 中实际运行候选模型，也没有取得任何可评估的转录文本或时间戳。
- 没有完成每支视频预先固定 20 个语句抽检点的准确度与时间对齐验收。
- 没有完成 90 分钟以上样本的端到端转录、取消、峰值内存与结束释放验收。

任何一项失败都不能用其他正向结果抵消，因此本地转录必须继续保持技术验证状态，不进入 0.13 普通用户入口。

## 环境

- 系统：Windows x64，本地 PowerShell。
- Node：v24.14.1。
- Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 存在。
- 第五轮返工基线：branch `codex/0.13-local-transcription-spike`，起始 HEAD `dbc7facfcca22f065f988d521662397e1815bd44`，`origin/main` `a777b5252a4a2ad7028ac4a078f7b7e86be54d52`；本轮未 rebase。
- PATH 中未发现：`ffmpeg`、`chrome`、`msedge`、`playwright`、`@playwright/test`。
- 当前正式 manifest：Manifest V3；没有 `offscreen` 权限；没有 `tabCapture` 权限；没有扩展页 `wasm-unsafe-eval` CSP。

## 可复现命令

```powershell
node scripts\asr-local-transcription-spike.mjs
node scripts\asr-local-transcription-spike.mjs --mv3-only
node --test scripts\asr-local-transcription-spike.test.mjs
```

第五轮完整 harness 时间为 `2026-07-17T13:26:26.078Z`，进程按预期 exit 1；独立 MV3 运行时间为 `2026-07-17T13:23:54.767Z`，同样按预期 exit 1。脚本 focused tests 为 24/24 通过。它只访问公开 API、公开媒体 URL、npm registry 与固定 revision 的 Hugging Face 元数据 API；不写入音频文件、不下载模型文件、不读取 Cookie、任何既有浏览器 profile、Bilibili 登录状态、本地 key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。

## Machine-readable 证据 gates

完整命令输出区分证据完整性与产品结论：

```text
overall.ok=false
overall.evidenceGatesOk=false
overall.asrProductGatesOk=false
overall.decision=no-go
overall.failedGates=[publicSamples, modelRuntime, mv3]
overall.exitCode=1
harnessExitCode=1
```

- `publicSamples` gate：第五轮 0/3，通过数为 0。`api.bilibili.com` 的请求出现 `TypeError: fetch failed`；随后独立轻量复核记录底层 `UND_ERR_CONNECT_TIMEOUT`。任何 API、身份、Range、取消或完整流检查缺失都会使样本失败。第四轮 3/3 结果只作为下文历史证据。
- `modelRuntime` gate：第五轮 npm registry 与 Hugging Face metadata 请求均出现相同连接失败，runtime/model gate 未通过。固定 identity、revision、许可、12 文件 hash 和总字节仍保留为第四轮历史证据。
- `mv3` gate：真实 WASM/worker、唯一 target/marker、storage terminal 和 exact CDP `Browser.close` 均通过；但 Windows process-tree ownership、后代终止和安全删除前提未被证明，所以 aggregate 必须失败。

JSON 元数据请求 deadline 为 20 秒，Range 为 30 秒，117 分钟完整媒体流为 180 秒；取消探针继续使用独立的 15 秒 safety timeout。前三类 deadline 会中止 fetch/body 读取并保留 `timedOut`、status、错误和已读字节证据；它们产生的 `AbortError` 不是取消成功证据。任一请求失败或 timeout 都使对应 gate 失败并令进程 exit 1。Focused tests 覆盖请求 1 MiB 但只返回 4 B 的合法短 `206`、无响应 metadata JSON、停滞 Range body、停滞完整流 body、deadline 与取消语义隔离、Windows CDP-only fail-closed、quarantine replacement race，以及 service-worker 持久化连续失败；24 项测试结束后没有未处理 rejection。产品 ASR gate 固定为未通过，最终决定始终是 no-go。

## 固定公开视频样本历史证据

下表来自第四轮成功运行 `2026-07-17T11:20:44.454Z`，用于保留已验证的样本身份、Range 契约和取消证据。第五轮当前运行没有重现这些成功值，不能把下表计入当前 aggregate passed count。

| 样本 | BVID / CID | 时长 / 字幕 | Range 结果 | 取消 `result` | `aborted` |
| --- | --- | --- | --- | --- | --- |
| 普通中文口播/知识视频 | `BV1xdNt6TEP3` / `39943406244` | 2337 秒 / 0 条 | `206`；请求/响应 `0-1048575`；首块 810 B；1,048,576 / 26,182,107 B | `AbortError:This operation was aborted`；首块 811 B 后请求；360 ms | `true`，通过 |
| 中英术语混合样本 | `BV1CaZxYFEFG` / `29173615369` | 897 秒 / 0 条 | `206`；请求/响应 `0-1048575`；首块 16,384 B；1,048,576 / 10,302,925 B | `AbortError:This operation was aborted`；首块 16,384 B 后请求；175 ms | `true`，通过 |
| 117 分钟长视频 | `BV1oSKg63E1t` / `39992362063` | 7050 秒 / 0 条 | `206`；请求/响应 `0-262143`；首块 15,258 B；262,144 / 74,087,460 B | `AbortError:This operation was aborted`；首块 784 B 后请求；118 ms | `true`，通过 |

该历史运行中，三条样本均返回 3 条 DASH 音频，首条编码均为 `mp4a.40.2`，媒体 MIME 均为 `video/mp4`，所有 JSON/Range/完整流操作均为 `timedOut=false`。长视频另以 `200` 完整流式读取并丢弃 74,087,460 B：首块 785 B，body 正常结束，读取字节与 `Content-Length: 74087460` 精确一致，耗时 88,993 ms。进程 RSS 前后差为 5,906,432 B，但这不是峰值内存，也不能作为 ASR 资源释放证明。

取消实现会在首个非空数据块后调用 `AbortController.abort()`，随后继续 `reader.read()`。只有同时满足实际捕获 `AbortError`、`abortReason=after-first-chunk`、`bytesReadBeforeAbort>0` 和非空 HTTP status 才设置 `aborted=true`；首块前 safety timeout、`status=null`、`resolved:206` 或正常读完均判为未通过。音频获取判断仍为部分通过：尚未证明真实当前视频页运行态、多 P 切换、过期 URL、扩展消息路由、WebAudio 解码或离页取消。

## MV3 / offscreen / WASM

临时 harness 动态创建了最小 MV3 扩展，包含：

- `offscreen` 权限；
- 扩展页 CSP：`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`
- 唯一随机 target marker、带 marker 的唯一 service-worker 文件名、offscreen document、本地 worker 和一个最小 WASM add 函数；
- 临时 root 的独立随机所有权 marker。任何仍允许调用的 owned-root 删除 helper 都必须先把 root 原子 rename 到同父目录随机 quarantine，再对新路径重新检查 marker、非链接和类型，复验通过后才允许递归删除；rename 后整体路径替换的确定性回归会保留替换物并失败。

CDP 隔离与判定规则：

- Edge 使用 `--remote-debugging-port=0` 由运行时分配端口；harness 只读取自己刚创建的临时 `user-data-dir` 中的 `DevToolsActivePort`，不请求固定端口，也不读取任何既有 profile。
- 通过该浏览器的 CDP `Target.getTargets` 精确匹配本次唯一 service-worker 文件名，再附着到该 target；不读取 `/json/list`。
- 通过该 target 的 `Runtime.evaluate` 同时读取 `globalThis.ASR_SPIKE_RESULT` 与 `chrome.storage.local` 中的 `ASR_SPIKE_RESULT`。成功结果必须由 storage terminal 持久化；若失败持久化本身连续拒绝，顶层 promise 会在内部捕获第二次失败，并保留 global terminal failure，不产生未观察 rejection。
- 证据读取结束后，只通过本次 browser-level CDP 连接发送 `Browser.close` 并有界等待根进程退出。Windows 不执行 `taskkill`、PID signal、进程枚举或 profile 扫描。即使 CDP closure 已确认且根进程退出，PID 重用风险和后代所有权仍不能由 PID 或根退出证明；没有 Job Object 时固定输出 `launchTimeProcessTreeOwnershipVerified=false`、`descendantTerminationVerified=false`、`treeTerminationVerified=false`、`tempRootRemovalAllowed=false`。
- 因此 Windows 实际 harness 不尝试递归删除临时 root，而是保留本次目录并输出 `tempRootRetained=true`、basename、retention reason 和 warning。该安全失败直接使 cleanup、MV3 machine gate 与 aggregate 失败。

两次执行结果：

```text
--mv3-only: harnessExitCode=1, failedGates=[mv3], runtime port=53434, elapsed=616 ms
full harness: harnessExitCode=1, failedGates=[publicSamples, modelRuntime, mv3], runtime port=60953, elapsed=591 ms
WASM add=5, worker firstByte=7, storage terminal=true, marker checks=true
CDP Browser.close requested=true, acknowledged=true, rootExited=true
jobObjectUsed=false, treeTerminationVerified=false, tempRootRemovalAttempted=false
tempRootRetained=true, retained names=bili-bill-asr-spike-QL4G4b / bili-bill-asr-spike-zjiOpr
```

最小 MV3/offscreen/WASM/worker **执行证据**通过，但包含清理安全性的 MV3 machine gate 未通过。worker 在读取首字节标量后同时清空 `ArrayBuffer` 和 `Uint8Array` view 引用，再回传仅含标量的结果；`released=true` 只证明这两个 JavaScript 引用不再保留，不是垃圾回收、峰值内存或模型资源释放证明。正式 manifest 未加入任何实验权限或 CSP，本 PR 也没有修改它们。

## 模型候选

仅固定一个候选用于评估基线：

- 运行时：`@huggingface/transformers` `4.2.0`，Apache-2.0，npm integrity `sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==`。
- 运行时依赖包含 `onnxruntime-web@1.26.0-dev.20260416-b7804b056c`、`onnxruntime-node@1.24.3`、`sharp`。正式扩展若采用该路径，必须证明浏览器 bundle 不包含 Node/native 路径。
- 模型：`Xenova/whisper-tiny`，revision `5332fcc35e32a33b86612b9a57a89be7906102b1`，Apache-2.0。元数据明确请求 `api/models/Xenova/whisper-tiny/revision/5332fcc35e32a33b86612b9a57a89be7906102b1?blobs=true`；返回 `id` 与 `sha` 均和声明值一致，`modelIdVerified=true`、`revisionVerified=true`。
- 统一 gate 同时验证 npm/Hugging Face HTTP `200`、runtime/model identity 与许可、exact revision，以及该 revision 下 12 个选定文件的精确 size/hash/algorithm；12 文件合计 100,102,365 B。ONNX LFS 文件按 API 返回的 SHA-256 记录；普通 Git 文件只标记为 `git-blob-sha1`，不冒充 SHA-256。关键模型文件 SHA-256：
  - `onnx/encoder_model_q4.onnx`：`f895af36f57fec9cbeac8d29a982ae47b2e81e461d98320fbd30c47d01a6a13f`
  - `onnx/decoder_model_merged_q4.onnx`：`462a65ea8459402cded5e6f22a378ac410ec7e0aad9367ebb08431906c237660`

上述 identity、revision、许可、体积和 hash 来自第四轮成功运行。第五轮当前 `modelRuntime` gate 因 npm/Hugging Face 连接失败而未通过，不能标为当前成功；模型实际运行门槛也未通过。该候选没有在 MV3/offscreen/WASM 中初始化，没有转录公开视频样本，也没有证明中文、中英混合、时间戳、长视频性能或峰值内存。

## 硬门槛矩阵

| 门槛 | 结果 |
| --- | --- |
| 公开视频证据 machine gate | 当前未通过：第五轮 0/3，公开 API 连接失败；第四轮 3/3 仅为历史证据 |
| 公开视频样本覆盖中文、中英混合、长视频、无字幕 | 部分历史证据：样本固定且第四轮均无字幕，但未人工固定 20 个抽检点 |
| 完整音频获取，不读取敏感本地状态 | 部分历史证据：第四轮公开 API、Range 和 117 分钟完整媒体流可行；第五轮未重现，且未验证真实扩展页身份、多 P 和 URL 过期 |
| MV3/offscreen/WASM machine gate | 未通过：执行证据成功，但 Windows tree ownership/后代终止未证明，临时 root 按要求保留 |
| 解封装与 16 kHz PCM | 未通过 |
| 一个模型候选固定版本、许可、体积、哈希 | 当前未通过：第五轮网络失败；第四轮固定 revision 与 12 文件元数据保留为历史证据 |
| 候选模型实际转录 | 未通过 |
| 每支 18/20 语句准确度 | 未通过 |
| 每支 18/20 时间点落在 3 秒内 | 未通过 |
| 不出现连续超过 10 秒有效语音缺失 | 未通过 |
| 完整转录耗时不超过视频时长 1.5 倍 | 未通过 |
| 峰值新增内存不超过 2 GB | 未通过 |
| CPU / 电量风险 | 未通过：未运行候选模型，无法取得有意义的负载或耗电测量 |
| ASR 取消后 5 秒内停止并释放 | 未通过；三次音频 fetch 取消已真实得到 `AbortError`，但没有 ASR 任务或模型资源 |
| 90 分钟样本完整处理、取消、时间对齐和释放 | 未通过；只验证了完整音频流式读取 |
| 音频不离开设备，不读取 Cookie/profile/login-state/key | 通过 |

## 最小权限与 CSP 差异

若未来重新打开该 spike，最小实验差异应是：

```json
{
  "permissions": ["offscreen"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
}
```

不应保留 `tabCapture`，除非只做明确的否定性对照；生产路径不能依赖实时录取播放器音频。所有 JavaScript/WASM 运行时代码必须随扩展打包，模型只能作为固定版本数据文件下载并校验。

## 架构草图

```text
用户确认
  -> content script 锁定 BVID / CID / 分 P / 当前页面身份
  -> service worker 记录任务身份并创建 offscreen document
  -> offscreen 拉取当前 CID 音频 Range/流
  -> WebAudio 解封装与 16 kHz PCM 分块
  -> 本地 WASM worker 转录并合并时间轴
  -> 完整结果校验
  -> 用户预览
  -> 用户确认后作为本地转录来源原子保存
```

本次没有证明上述完整链路可用。可以保留的事实限于：部分公开视频的当前 CID 音频可在无 Cookie 条件下获取和取消；隔离的最小 MV3/offscreen/WASM/worker 容器可执行；候选模型的固定 revision 元数据可复现。它们都不能推出真实本地转录可用。

## 最终决定

- 0.13 普通 UI：不显示“转录当前分 P”或“重新转录”入口。
- 0.13 正式功能：字幕全文、摘要、亮点、问答等正式切片不得依赖本地转录。
- 后续 issue：不创建 ASR-013-IMPL，除非继续完成 WebAudio PCM、候选模型真实转录、固定抽检点、90 分钟端到端 ASR 和资源释放验收。
