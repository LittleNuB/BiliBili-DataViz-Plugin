# Bili-Bill 0.13 本地转录 Spike 报告

结论日期：2026-07-17

Issue：[#175 ASR-013-SPIKE](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/175)

## 唯一结论

**No-go。0.13 不开放普通 UI 本地转录入口，不创建 ASR-013-IMPL。**

第六轮安全复核确认，现有 Windows 浏览器生命周期不能把可变 profile 路径中的 `DevToolsActivePort` 端点可靠绑定到脚本启动的 Edge；基于路径复验后再递归删除目录也不能消除最终删除前的路径替换窗口。按 no-go spike 的比例原则，本轮不引入 Job Object、原生句柄遍历、进程枚举、PID 杀进程或复杂 CDP pipe，而是完全禁用实时浏览器 harness 和路径递归删除。

当前 MV3 machine gate 因此明确失败：不启动浏览器，不创建临时 root，不连接 CDP，不发送 `Browser.close`，也不删除任何目录。此前的 CDP、offscreen、WASM 和 worker 运行结果只属于历史背景，不是当前 machine evidence，也不能证明当时端点属于“本次启动”。

即使不考虑该安全失败，spike 仍未完成真实音频解封装与 PCM 转换、候选模型浏览器内转录、固定抽检点准确度与时间对齐、90 分钟端到端处理、峰值内存及 ASR 取消释放门槛。任何一项失败都足以维持 no-go。

## 范围与基线

- 系统：Windows x64；Node `v24.14.1`。
- branch：`codex/0.13-local-transcription-spike`。
- 第六轮起始 HEAD：`601a4bf2c4425905af2e2b11e933cddb24f6e349`。
- base：`origin/main` `a777b5252a4a2ad7028ac4a078f7b7e86be54d52`。
- 本轮未 rebase、未 force-push；最终 HEAD 以同一 draft PR #184 的 head 为准。
- 没有生产 UI、正式 manifest、package、版本、发布资产或业务实现变更。

## 当前可复现验证

本轮只运行本地、无公开下载的验证：

```powershell
node --test scripts\asr-local-transcription-spike.test.mjs
node scripts\asr-local-transcription-spike.mjs --mv3-only
npm run test:current-video-transcript
npm run typecheck
npm run build
git diff --check
```

`--mv3-only` 预期 exit 1；这是 fail-closed 证据，不是 harness 异常。完整命令 `node scripts\asr-local-transcription-spike.mjs` 仍保留公开样本和模型元数据探针，但第六轮按安全复核要求未执行，未下载或持久化音频/模型，也不把旧运行数值当作当前通过证据。

本轮结果：spike focused tests 19/19 通过；current-video tests 18/18 通过；typecheck 通过；build 通过并仅出现仓库既有的动态导入与大 chunk 警告；`--mv3-only` 的 machine-readable 断言通过且命令本身按预期 exit 1。

以下是 `--mv3-only` stdout **关键字段的有效嵌套 JSON 摘录**，不是完整命令输出：

```json
{
  "mv3Lifecycle": {
    "ok": false,
    "executed": false,
    "platform": "win32",
    "reason": "mv3-lifecycle-ownership-binding-unavailable",
    "ownershipSafeLifecycleAvailable": false,
    "launchAttempted": false,
    "tempRootCreationAttempted": false,
    "cdpConnectionAttempted": false,
    "browserCloseAttempted": false,
    "recursiveDeletionAttempted": false,
    "staticSourceEvidence": {
      "available": true,
      "historicalOnly": true,
      "countedAsCurrentMachineEvidence": false
    }
  },
  "machineGates": {
    "publicSamples": null,
    "modelRuntime": null,
    "mv3": {
      "ok": false,
      "failures": [
        "mv3-lifecycle-ownership-binding-unavailable"
      ]
    }
  },
  "overall": {
    "ok": false,
    "evidenceGatesOk": false,
    "asrProductGatesOk": false,
    "decision": "no-go",
    "exitCode": 1,
    "requestedGates": [
      "mv3"
    ],
    "failedGates": [
      "mv3"
    ]
  },
  "harnessExitCode": 1
}
```

## 当前 machine gates

| Gate | 当前结果 | 说明 |
| --- | --- | --- |
| `mv3` | 未通过 | `executed=false`；安全生命周期绑定不可用，所有 live 操作尝试字段均为 `false` |
| `publicSamples` | 本轮未执行 | `--mv3-only` 输出为 `null`，不得标为 passed |
| `modelRuntime` | 本轮未执行 | `--mv3-only` 输出为 `null`，不得标为 passed |
| `overall.evidenceGatesOk` | `false` | 当前请求的 MV3 gate 失败 |
| `overall.asrProductGatesOk` | `false` | 未完成真实本地 ASR 产品门槛 |
| `overall.decision` | `no-go` | 唯一产品结论 |

完整模式若未来由独立授权复跑，公开样本、模型/runtime 和 MV3 必须各自通过才可能令 evidence aggregate 通过；当前 MV3 gate 固定 fail closed，所以完整模式最终仍应非零退出且保持 no-go。

## 安全生命周期处理

当前生产可调用的 spike 路径中已移除：

- Edge/浏览器子进程启动；
- `DevToolsActivePort` 读取、WebSocket/CDP 连接与 `Browser.close`；
- PID、进程树、`taskkill` 或 signal 停止逻辑；
- 临时 root 创建、marker 检查、quarantine rename 与递归删除 helper。

因此当前 harness 没有浏览器子进程等待或挂起路径，也不会接触其他浏览器、既有 profile 或先前运行遗留的临时目录。旧临时 root 不在本轮读取、复验或删除范围内。

脚本仍保留最小 MV3 service-worker/offscreen/WASM/worker **源码构造纯函数**，用于历史结构说明和纯函数回归。它不会由当前 harness 启动，`staticSourceEvidence.historicalOnly=true`，也不计为当前执行通过。纯测试还验证持久化失败的异步 catch 会被观察和收敛到 terminal failure，不产生未观察 rejection。

## 公开样本与网络 gate 定义

脚本静态声明三类公开样本：普通中文口播、中英术语混合、以及不低于 90 分钟的长视频。第六轮不重新请求这些媒体；以下仅是保留的 machine gate 规则，不是当前网络成功声明：

- API 和媒体 HTTP 状态、标题身份、当前 CID、时长、无字幕、音频 MIME/codec 必须全部匹配；
- Range 必须返回 `206`、非空首块，并让返回 `Content-Range` 起止位置、body 字节数与 `Content-Length` 精确匹配实际请求范围；请求 end 超过已知 total 时只允许匹配到 `total - 1`；
- 长样本必须不低于 90 分钟；若宣称完整流完成，status、非空 body、读取字节与已知 `Content-Length`/total 必须一致；
- metadata JSON、Range 与完整流读取均有 abortable deadline；timeout 会留下明确证据并使对应 gate 和完整模式退出失败；
- 取消成功只接受首个非空块后，由 `abortReason=after-first-chunk` 触发并实际捕获的 `AbortError`。deadline、首块前 safety timeout、`status=null` 或正常 `206` resolve 均不是取消成功。

本地 server tests 覆盖错误页、空 body、截断流、请求 1 MiB 却只返回 4 B 的合法短 `206`、停滞 metadata JSON、停滞 Range body、停滞完整流 body，以及 deadline 与取消语义隔离。

## 固定候选与模型 gate 定义

候选声明保持唯一：

- runtime：`@huggingface/transformers` `4.2.0`，Apache-2.0；
- model：`Xenova/whisper-tiny`；
- exact revision：`5332fcc35e32a33b86612b9a57a89be7906102b1`；
- model license：Apache-2.0。

统一 gate 要求 npm 与模型 metadata 请求成功，runtime id/version/license、model id/exact revision/license 全部匹配，并让选定的 12 个文件、每项 size/hash 元数据和总字节全部满足声明。测试覆盖任一 identity、revision、许可、文件、hash 或总字节不匹配时 `ok=false`。第六轮没有请求 npm/Hugging Face，也没有下载模型文件，因此这些要求不是当前通过项；更没有在 MV3/offscreen 中初始化或运行该候选。

## ASR 产品硬门槛

| 门槛 | 结果 |
| --- | --- |
| 所有 machine evidence gates | 未通过 |
| WebAudio 解封装与 16 kHz 单声道 PCM | 未执行 |
| 候选模型真实浏览器转录 | 未执行 |
| 每支样本 18/20 语句准确度 | 未执行 |
| 每支样本 18/20 时间点在 3 秒内 | 未执行 |
| 无连续超过 10 秒有效语音缺失 | 未执行 |
| 完整转录耗时不超过视频时长 1.5 倍 | 未执行 |
| 峰值新增内存不超过 2 GB | 未执行 |
| ASR 取消后 5 秒内停止并释放 | 未执行 |
| 90 分钟样本完整转录、时间对齐、取消和释放 | 未执行 |
| 不读取敏感本地状态、不持久化音频/模型 | 通过 |

静态 worker 源中清空 `ArrayBuffer`/view 引用的代码不等于垃圾回收、峰值内存或模型资源释放证明，不能用于提升上述门槛。

## 权限、架构与 UI

历史静态容器构造显示，若未来重新设计可证明所有权的 lifecycle，最小实验差异仍可能需要 `offscreen` 权限和扩展页 `wasm-unsafe-eval` CSP。该差异没有进入正式 manifest，本 PR 也没有开放入口。

目标架构仍是：锁定 BVID/CID/分 P身份，offscreen 内流式获取与解码，WASM worker 本地转录，完整结果校验后由用户确认保存。当前没有证明这条链路可安全运行，不能把静态容器或公开媒体探针等同于产品实现。

## 隐私边界

- 未读取 Cookie、任何浏览器 profile、Bilibili login-state、本地 key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。
- 未读取真实完整历史、收藏、关注、反馈或 IndexedDB。
- 未持久化音频、模型或媒体响应。
- 未读取、复验或删除此前运行遗留的临时 root。

## 最终决定

- 0.13 普通 UI 不显示本地转录入口。
- 字幕全文、摘要、亮点、问答等正式能力不得依赖本 spike。
- 不创建 ASR-013-IMPL。
- 只有未来另行批准并解决 handle-bound 浏览器生命周期、真实音频/模型链路及全部产品硬门槛后，才可重新提出 go/no-go 评估。
