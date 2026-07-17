# Bili-Bill 0.13 本地转录技术 Spike

状态：**已执行 / no-go**。执行证据与最终决定见 [`report-local-transcription-0.13.md`](./report-local-transcription-0.13.md)；本文保留技术验收定义，不承诺本地转录进入 0.13 普通 UI。

## 1. 目标

回答一个可执行问题：Bili-Bill 能否在当前 Manifest V3 浏览器扩展架构内，由用户主动触发，对当前分 P 的完整音频执行本地中文及中英混合转录，并同时满足准确度、时间对齐、性能、内存、取消和隐私门槛。

Spike 必须输出“选定一个运行时与模型”或“本版本不开放”的明确结论，不能只证明短音频 demo 能运行。

## 2. 仓库基线

- 当前扩展是 Manifest V3，后台为会休眠的 service worker。
- 当前没有 `offscreen`、`tabCapture` 或 WebAssembly CSP 配置。
- 当前没有 ASR、音频解封装、音频解码或模型运行依赖。
- 当前 IndexedDB 使用 Dexie；manifest 已有 `storage` 和 `unlimitedStorage`。
- 当前视频身份由 BVID、CID 和分 P 共同校验，转录任务必须继续使用同一身份边界。
- 当前 B 站字幕正文已经进入独立的文本来源缓存；本地转录必须作为另一种来源接入，不能建立互不兼容的第二套视频身份。

## 3. 不可绕过的产品边界

- 不读取 Cookie 文件、浏览器 profile、登录状态文件、本地 Key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。
- 不把音频或未授权转录稿发送到远程服务。
- 不依赖播放器从头到尾实时播放。
- 不设置用户侧固定时长上限，也不静默截断长视频。
- 切换视频、切换分 P、离开视频页、关闭页面或主动取消时停止任务并丢弃未完成结果。
- 只保存完整成功的时间对齐转录稿，不保存音频、临时文字或模型中间状态。
- 0.13 只开放一个模型，不提供模型选择器、翻译、说话人分离或远程降级。

## 4. 需要验证的技术链路

```text
用户确认
  -> 锁定当前视频 / CID / 分 P
  -> 获取当前分 P 完整音频数据
  -> 本地解封装与单声道 16 kHz PCM 转换
  -> 分块转录与时间轴合并
  -> 完整结果校验
  -> 用户预览
  -> 用户确认后保存为本地转录来源
```

任一阶段无法满足身份、取消、资源释放或隐私约束时，整条链路判定失败。

## 5. 音频获取验证

按以下优先级验证，不建立自动换路由的生产逻辑：

### A. 当前分 P 媒体资源

- 从当前页面运行态已经解析的视频身份和公开播放信息取得当前分 P 音频资源。
- 网络请求只能通过正常浏览器扩展运行态完成，不读取或导出磁盘 Cookie、profile 或登录状态。
- 验证 DASH 分段、编码格式、Referer/Origin、跨域权限、过期 URL 和多 P 身份。
- 证明可以在不改变播放进度、音量或倍速的前提下取得完整音频，并在用户取消后停止后续下载。

这是唯一有机会满足“快于实时完成”的主路径。

### B. 页面媒体流或 tabCapture

- 只作为否定性对照验证，不作为默认实现。
- `tabCapture` 需要新增权限和明确用户手势，并只能取得实时媒体流；它还可能改变标签页音频路由。
- `HTMLMediaElement.captureStream()` 同样依赖实时播放和页面生命周期。
- 若所有可行路径都只能以视频时长实时录取一遍，则 Spike 结论为“不开放普通 UI”。

### C. 音频临时数据

- 优先边下载边解码、边处理、边释放，不在 IndexedDB 持久保存完整音频。
- 若解封装必须产生临时 Blob，记录峰值大小、取消清理和异常退出清理结果。
- 任务结束后验证无音频 Blob、Object URL、ArrayBuffer 或 worker 引用残留。

## 6. Manifest V3 承载方案

- service worker 只负责权限、任务身份、消息路由和持久状态，不能承载长时间 ASR 计算。
- Spike 验证新增 offscreen document 作为 WebAudio、WebAssembly、worker 和模型运行容器。
- manifest 需要实验性加入 `offscreen` 权限；只有验证 tabCapture 对照时才临时加入 `tabCapture`，生产方案未选择时不得保留多余权限。
- WebAssembly 方案需要验证扩展页 CSP 的 `wasm-unsafe-eval`，所有 JavaScript 和 WASM 运行时代码必须随扩展打包，不加载远程可执行代码。
- 模型按数据文件处理，下载后校验固定版本、准确体积和完整性；运行时脚本不得从模型站点动态执行。
- offscreen document 与 service worker 只通过 `chrome.runtime` 消息通信。任务状态必须能在 service worker 重启后识别为已取消或失败，不能伪装仍在运行。

## 7. 候选运行时

Spike 最多比较以下三条路径，禁止继续无边界扩展候选：

### 7.1 sherpa-onnx WebAssembly

- 验证官方中文/英文 WebAssembly ASR 路径和适合文件转录的非流式或可分块模型。
- 优先考察中文及中英混合、CPU 性能、时间信息、模型体积和 WASM 打包复杂度。
- 不能因为官方 demo 是实时麦克风识别就假设长文件和准确时间轴已经满足要求。

### 7.2 whisper.cpp WebAssembly

- 验证官方浏览器 WebAssembly 转录路径和多语言模型。
- 优先考察长音频分块、时间戳、中文及中英混合稳健性、CPU 性能和峰值内存。
- 不引入本地原生程序、Python 服务或远程 whisper server。

### 7.3 Transformers.js Whisper

- 验证浏览器自动语音识别 pipeline 作为集成成本基线。
- WebGPU 只能作为可选加速，不得成为开放前提；基准设备无独立显卡时仍必须通过 CPU/WASM 门槛。
- 若依赖体积、worker 打包、长音频内存或时间戳能力不满足门槛，应尽早淘汰。

## 8. 模型与许可筛选

每个候选必须记录：

- 运行时仓库、精确版本和许可证。
- 模型仓库、精确 revision、许可证、语言范围和准确下载体积。
- 模型文件 SHA-256 或发布方提供的等价完整性信息。
- 是否允许在浏览器扩展中分发运行时并按需下载模型数据。
- 中文、英文、中英混合和标点能力。
- 是否直接输出可用时间戳；如果需要后处理，说明误差来源。

许可、来源或模型 revision 无法固定时，该候选直接淘汰。

## 9. 存储与生命周期

- 模型不写入普通 Dexie 业务表。Spike 比较 Cache Storage 与 OPFS/浏览器文件存储的可清理性、容量统计和原子替换能力。
- 设备最多保留一个完整校验通过的模型。模型下载中断时删除不完整数据。
- 模型只在任务执行期间载入内存；任务完成、失败或取消后释放运行时、worker 和模型内存。
- 完整转录稿接入现有当前视频身份模型，最多保存 50 个分 P 或 50 MB，按最久未访问顺序清理。
- 重新转录在用户确认前只保存临时预览；确认后原子替换该分 P 的旧本地转录稿。

## 10. 固定验收集

至少使用三支可公开访问、内容和语言不同的视频：

1. 普通中文口播或知识视频。
2. 中文为主、包含英文术语的混合内容。
3. 当前分 P 时长不低于 90 分钟的长视频。

每支视频在测试前人工固定 20 个语句抽检点，不根据模型输出临时调整。不得使用用户私人视频、私人收藏或需要读取登录文件的样本。

## 11. 硬性通过标准

在 Windows x64、4 核 8 线程、16 GB 内存、不依赖独立显卡的统一基准设备上：

- 每支视频至少 18/20 个抽检语句可以独立读懂且不改变原意。
- 每支视频至少 18/20 个抽检时间落在对应语句前后 3 秒内。
- 不出现连续超过 10 秒的有效语音整段缺失。
- 完整转录耗时不超过视频时长的 1.5 倍。
- 转录期间峰值新增内存不超过 2 GB。
- 用户取消后 5 秒内停止计算，并释放本次任务的运行内存和临时音频数据。
- 90 分钟样本完整处理、取消、时间对齐和任务结束释放全部通过。
- 音频未离开设备，未读取或导出 Cookie/profile/login-state/key 文件。

任何一项失败都不能用平均结果抵消。

## 12. 测试顺序

### Phase 0：最小可行性

- 在独立静态 harness 中加载一个短的公开音频 fixture。
- 验证 WASM/CSP、worker、模型下载、取消和内存释放。
- 输出每个候选的准确安装体积和首次运行时间。

### Phase 1：完整音频管线

- 在真实当前视频页由用户主动启动。
- 验证当前分 P 身份、完整音频获取、解封装、PCM 转换和离页取消。
- 只要音频获取只能实时进行，立即记录 no-go，不继续用模型精度掩盖链路失败。

### Phase 2：模型比较

- 对固定中文和中英混合样本运行同一抽检点、设备和测量脚本。
- 淘汰无法满足准确度、时间轴、性能或内存的候选。

### Phase 3：长视频与故障

- 执行 90 分钟完整转录。
- 覆盖取消、模型下载中断、媒体 URL 过期、service worker 重启、页面切换和空间不足。

### Phase 4：集成门槛

- 只为唯一通过的候选编写集成建议、权限差异、存储迁移和普通 UI 开放结论。
- 没有候选通过时输出 no-go，并确认其他 0.13 功能不依赖转录实验。

## 13. Spike 交付物

- `docs/report-local-transcription-0.13.md`：环境、样本、候选版本、模型体积、逐项结果和 go/no-go。
- 可重复运行的 benchmark 命令与非私人测试 fixture 说明。
- 选定运行时和模型的固定版本、许可证与 SHA-256；或明确的 no-go 原因。
- Manifest 权限和 CSP 的最小必要差异。
- 音频获取、任务生命周期、缓存和取消的架构草图。
- 普通 UI 是否开放的结论，不允许“部分通过但先上线再观察”。

## 14. 参考资料

- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome extension CSP and WebAssembly](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Chrome tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [sherpa-onnx WebAssembly documentation](https://k2-fsa.github.io/sherpa/onnx/wasm/build.html)
- [whisper.cpp official repository](https://github.com/ggml-org/whisper.cpp)
- [Transformers.js WebGPU and Whisper example](https://huggingface.co/docs/transformers.js/en/guides/webgpu)
