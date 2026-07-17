# Bili-Bill 0.13 本地转录 Spike 报告

结论日期：2026-07-17

Issue：[#175 ASR-013-SPIKE](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/175)

## 结论

**No-go。0.13 不开放普通 UI 本地转录入口，不创建 ASR-013-IMPL。**

本次三个 machine-readable 证据 gate 通过：固定公开视频音频证据 3/3、固定 runtime/model 元数据、隔离的 MV3/offscreen/WASM/worker 与临时目录清理。它们只证明报告引用的证据满足声明条件，不代表本地 ASR 产品门槛通过。

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
- PATH 中未发现：`ffmpeg`、`chrome`、`msedge`、`playwright`、`@playwright/test`。
- 当前正式 manifest：Manifest V3；没有 `offscreen` 权限；没有 `tabCapture` 权限；没有扩展页 `wasm-unsafe-eval` CSP。

## 可复现命令

```powershell
node scripts\asr-local-transcription-spike.mjs
node scripts\asr-local-transcription-spike.mjs --mv3-only
node --test scripts\asr-local-transcription-spike.test.mjs
```

最终完整 harness 证据时间为 `2026-07-17T10:42:16.119Z`。它只访问公开 API、公开媒体 URL、npm registry 与固定 revision 的 Hugging Face 元数据 API；不写入音频文件、不下载模型文件、不读取 Cookie、任何既有浏览器 profile、Bilibili 登录状态、本地 key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。

## Machine-readable 证据 gates

完整命令输出区分证据完整性与产品结论：

```text
overall.ok=true
overall.evidenceGatesOk=true
overall.asrProductGatesOk=false
overall.decision=no-go
harnessExitCode=0
```

- `publicSamples` gate：3/3 通过，0 个失败样本。每支均要求 API 状态和业务码、BVID/标题/CID/时长、无字幕、音频 codec/MIME、Range `206`、非空首块、完整读取与长度一致、严格取消证据同时通过；长样本另要求不少于 90 分钟和完整流长度一致。
- `modelRuntime` gate：npm/Hugging Face HTTP、runtime 名称/版本/许可、model id/exact revision/许可、12 个文件的 size/hash/algorithm 和总字节全部通过。
- `mv3` gate：唯一 target/marker 的真实 WASM/worker 结果与有界清理全部通过。

这里的 `overall.ok` 只表示本次命令所声明的证据 gate 没有假通过。任一证据 gate 失败时，`overall.ok=false`、列出 `failedGates` 且进程 exit 1。产品 ASR gate 固定为未通过，所以即使 harness exit 0，最终决定仍是 no-go。

## 固定公开视频样本

| 样本 | BVID / CID | 时长 / 字幕 | Range 结果 | 取消 `result` | `aborted` |
| --- | --- | --- | --- | --- | --- |
| 普通中文口播/知识视频 | `BV1xdNt6TEP3` / `39943406244` | 2337 秒 / 0 条 | `206`；首块 810 B；1,048,576 / 26,182,107 B | `AbortError:This operation was aborted`；首块 810 B 后请求；380 ms | `true`，通过 |
| 中英术语混合样本 | `BV1CaZxYFEFG` / `29173615369` | 897 秒 / 0 条 | `206`；首块 16,384 B；1,048,576 / 10,302,925 B | `AbortError:This operation was aborted`；首块 16,384 B 后请求；177 ms | `true`，通过 |
| 117 分钟长视频 | `BV1oSKg63E1t` / `39992362063` | 7050 秒 / 0 条 | `206`；首块 790 B；262,144 / 74,087,460 B | `AbortError:This operation was aborted`；首块 789 B 后请求；117 ms | `true`，通过 |

三条样本均返回 3 条 DASH 音频，首条编码均为 `mp4a.40.2`，媒体 MIME 均为 `video/mp4`。长视频另以 `200` 完整流式读取并丢弃 74,087,460 B：首块 788 B，body 正常结束，读取字节与 `Content-Length: 74087460` 精确一致，耗时 89,562 ms。进程 RSS 前后差为 -1,925,120 B，但这不是峰值内存，也不能作为 ASR 资源释放证明。

取消实现会在首个非空数据块后调用 `AbortController.abort()`，随后继续 `reader.read()`。只有同时满足实际捕获 `AbortError`、`abortReason=after-first-chunk`、`bytesReadBeforeAbort>0` 和非空 HTTP status 才设置 `aborted=true`；首块前 safety timeout、`status=null`、`resolved:206` 或正常读完均判为未通过。音频获取判断仍为部分通过：尚未证明真实当前视频页运行态、多 P 切换、过期 URL、扩展消息路由、WebAudio 解码或离页取消。

## MV3 / offscreen / WASM

临时 harness 动态创建了最小 MV3 扩展，包含：

- `offscreen` 权限；
- 扩展页 CSP：`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`
- 唯一随机 target marker、带 marker 的唯一 service-worker 文件名、offscreen document、本地 worker 和一个最小 WASM add 函数；
- 临时 root 的独立随机所有权 marker。递归删除前必须通过 root/marker `lstat` 非链接、类型和 marker 精确匹配检查。

CDP 隔离与判定规则：

- Edge 使用 `--remote-debugging-port=0` 由运行时分配端口；harness 只读取自己刚创建的临时 `user-data-dir` 中的 `DevToolsActivePort`，不请求固定端口，也不读取任何既有 profile。
- 通过该浏览器的 CDP `Target.getTargets` 精确匹配本次唯一 service-worker 文件名，再附着到该 target；不读取 `/json/list`。
- 通过该 target 的 `Runtime.evaluate` 同时读取 `globalThis.ASR_SPIKE_RESULT` 与 `chrome.storage.local` 中的 `ASR_SPIKE_RESULT`。marker、完成态、WASM `2 + 3 = 5`、worker marker、首字节 `7` 和清空 buffer 引用必须全部一致才允许 `mv3OffscreenWasmProbe.ok=true`。

两次执行结果：

```text
--mv3-only: ok=true, runtime port=62755, elapsed=676 ms
full harness: ok=true, runtime port=53016, elapsed=675 ms
WASM add=5, worker firstByte=7, marker checks=true
Edge exited within bound=true, ownership checks=true, temp root removed=true, cleanup warnings=[]
```

因此最小 MV3/offscreen/WASM/worker 容器门槛通过。worker 在读取首字节标量后同时清空 `ArrayBuffer` 和 `Uint8Array` view 引用，再回传仅含标量的结果；`released=true` 只证明这两个 JavaScript 引用不再保留，不是垃圾回收、峰值内存或模型资源释放证明。正式 manifest 未加入任何实验权限或 CSP，本 PR 也没有修改它们。

## 模型候选

仅固定一个候选用于评估基线：

- 运行时：`@huggingface/transformers` `4.2.0`，Apache-2.0，npm integrity `sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==`。
- 运行时依赖包含 `onnxruntime-web@1.26.0-dev.20260416-b7804b056c`、`onnxruntime-node@1.24.3`、`sharp`。正式扩展若采用该路径，必须证明浏览器 bundle 不包含 Node/native 路径。
- 模型：`Xenova/whisper-tiny`，revision `5332fcc35e32a33b86612b9a57a89be7906102b1`，Apache-2.0。元数据明确请求 `api/models/Xenova/whisper-tiny/revision/5332fcc35e32a33b86612b9a57a89be7906102b1?blobs=true`；返回 `id` 与 `sha` 均和声明值一致，`modelIdVerified=true`、`revisionVerified=true`。
- 统一 gate 同时验证 npm/Hugging Face HTTP `200`、runtime/model identity 与许可、exact revision，以及该 revision 下 12 个选定文件的精确 size/hash/algorithm；12 文件合计 100,102,365 B。ONNX LFS 文件按 API 返回的 SHA-256 记录；普通 Git 文件只标记为 `git-blob-sha1`，不冒充 SHA-256。关键模型文件 SHA-256：
  - `onnx/encoder_model_q4.onnx`：`f895af36f57fec9cbeac8d29a982ae47b2e81e461d98320fbd30c47d01a6a13f`
  - `onnx/decoder_model_merged_q4.onnx`：`462a65ea8459402cded5e6f22a378ac410ec7e0aad9367ebb08431906c237660`

模型/runtime 元数据 gate 通过；模型实际运行门槛未通过。该候选没有在 MV3/offscreen/WASM 中初始化，没有转录公开视频样本，也没有证明中文、中英混合、时间戳、长视频性能或峰值内存。

## 硬门槛矩阵

| 门槛 | 结果 |
| --- | --- |
| 公开视频证据 machine gate | 通过：3/3 的 API/身份/时长/无字幕/codec/MIME/Range/首块/长度/取消检查均通过 |
| 公开视频样本覆盖中文、中英混合、长视频、无字幕 | 部分通过：样本固定且均无字幕，但未人工固定 20 个抽检点 |
| 完整音频获取，不读取敏感本地状态 | 部分通过：公开 API、Range 和 117 分钟完整媒体流可行；未验证真实扩展页身份、多 P 和 URL 过期 |
| MV3/offscreen/WASM 容器 | 通过：隔离临时 profile、唯一 target/marker、CDP 读取真实 WASM/worker 结果；不包含模型运行 |
| 解封装与 16 kHz PCM | 未通过 |
| 一个模型候选固定版本、许可、体积、哈希 | 通过：固定 revision API 身份校验与 12 文件元数据完整 |
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
