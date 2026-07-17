# Bili-Bill 0.13 本地转录 Spike 报告

结论日期：2026-07-17

Issue：[#175 ASR-013-SPIKE](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/175)

## 结论

**No-go。0.13 不开放普通 UI 本地转录入口，不创建 ASR-013-IMPL。**

公开视频音频获取有部分正向证据：三个无字幕公开视频样本均可在不读取 Cookie、浏览器 profile、登录状态或本地 key 文件的情况下，通过公开 `view` / `player/v2` / `playurl` API 取得当前 CID 的 DASH 音频信息；117 分钟样本可完整流式读取音频并丢弃。

但本次 spike 没有通过硬门槛：

- 没有验证当前 Manifest V3 扩展中的 offscreen document、WebAssembly、worker 与模型容器。临时 headless Edge harness 没有出现自身扩展的 service worker target。
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
```

上述 harness 只访问公开 API 和公开媒体 URL。它不写入音频文件、不下载模型文件、不读取 Cookie、浏览器 profile、Bilibili 登录状态、本地 key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。

## 固定公开视频样本

| 样本 | BVID / CID | 时长 | 字幕状态 | 音频获取结果 |
| --- | --- | ---: | --- | --- |
| 普通中文口播/知识视频 | `BV1xdNt6TEP3` / `39943406244` | 2337 秒 | `player/v2` 字幕 0 条 | DASH 音频 3 条；首条 `mp4a.40.2`；Range `206`，1,048,576 / 26,182,107 B；取消 105 ms |
| 中英术语混合样本 | `BV1CaZxYFEFG` / `29173615369` | 897 秒 | `player/v2` 字幕 0 条 | DASH 音频 3 条；首条 `mp4a.40.2`；Range `206`，1,048,576 / 10,302,925 B；取消 107 ms |
| 117 分钟长视频 | `BV1oSKg63E1t` / `39992362063` | 7050 秒 | `player/v2` 字幕 0 条 | DASH 音频 3 条；首条 `mp4a.40.2`；Range `206`，262,144 / 74,087,460 B；取消 106 ms；完整流式读取 74,087,460 B，88,936 ms |

音频获取判断：公开视频主路径值得后续继续研究，但本次只证明公开 API 与媒体 Range/流式读取可行，没有证明真实当前视频页运行态、多 P 切换、过期 URL、扩展消息路由、WebAudio 解码或离页取消。

## MV3 / offscreen / WASM

临时 harness 动态创建了最小 MV3 扩展，包含：

- `offscreen` 权限；
- 扩展页 CSP：`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`
- service worker、offscreen document、本地 worker 和一个最小 WASM add 函数。

执行结果：

```text
node scripts\asr-local-transcription-spike.mjs --mv3-only
mv3OffscreenWasmProbe.ok=false
error=No extension service worker target appeared before timeout.
```

因此不能声称 offscreen/WASM 容器已在扩展环境内可用。正式 manifest 也未加入任何实验权限或 CSP，本 PR 不修改它们。

## 模型候选

仅固定一个候选用于评估基线：

- 运行时：`@huggingface/transformers` `4.2.0`，Apache-2.0，npm integrity `sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==`。
- 运行时依赖包含 `onnxruntime-web@1.26.0-dev.20260416-b7804b056c`、`onnxruntime-node@1.24.3`、`sharp`。正式扩展若采用该路径，必须证明浏览器 bundle 不包含 Node/native 路径。
- 模型：`Xenova/whisper-tiny`，revision `5332fcc35e32a33b86612b9a57a89be7906102b1`，Apache-2.0。
- 选定 q4 文件集体积：100,102,365 B。关键模型文件 SHA-256：
  - `onnx/encoder_model_q4.onnx`：`f895af36f57fec9cbeac8d29a982ae47b2e81e461d98320fbd30c47d01a6a13f`
  - `onnx/decoder_model_merged_q4.onnx`：`462a65ea8459402cded5e6f22a378ac410ec7e0aad9367ebb08431906c237660`

模型判断：未通过。该候选只完成版本、许可、体积与文件哈希固定；没有在 MV3/offscreen/WASM 中初始化，没有转录公开视频样本，也没有证明中文、中英混合、时间戳、长视频性能或峰值内存。

## 硬门槛矩阵

| 门槛 | 结果 |
| --- | --- |
| 公开视频样本覆盖中文、中英混合、长视频、无字幕 | 部分通过：样本固定且均无字幕，但未人工固定 20 个抽检点 |
| 完整音频获取，不读取敏感本地状态 | 部分通过：公开 API 和媒体流可行；未验证真实扩展页身份、多 P 和 URL 过期 |
| MV3/offscreen/WASM 容器 | 未通过 |
| 解封装与 16 kHz PCM | 未通过 |
| 一个模型候选固定版本、许可、体积、哈希 | 部分通过 |
| 候选模型实际转录 | 未通过 |
| 每支 18/20 语句准确度 | 未通过 |
| 每支 18/20 时间点落在 3 秒内 | 未通过 |
| 不出现连续超过 10 秒有效语音缺失 | 未通过 |
| 完整转录耗时不超过视频时长 1.5 倍 | 未通过 |
| 峰值新增内存不超过 2 GB | 未通过 |
| ASR 取消后 5 秒内停止并释放 | 未通过；只验证了音频 fetch 取消 |
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

本次没有证明上述链路可用。当前可以保留的唯一事实是：部分公开视频的当前 CID 音频可在无 Cookie 条件下被公开获取。

## 最终决定

- 0.13 普通 UI：不显示“转录当前分 P”或“重新转录”入口。
- 0.13 正式功能：字幕全文、摘要、亮点、问答等正式切片不得依赖本地转录。
- 后续 issue：不创建 ASR-013-IMPL，除非重新完成 MV3/offscreen/WASM、WebAudio PCM、候选模型真实转录、固定抽检点、90 分钟长视频和资源释放验收。
