# 当前视频页内助手真实 B 站集成 Smoke

Issue: [#127](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/127)

日期：2026-06-18

## 环境

- 分支：`codex/current-video-real-smoke`
- 基线 commit：`d9139a6cf36e066819248fcd1588506b4b08d515`
- 扩展来源：`C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-current-video-real-smoke\dist`
- 浏览器：Microsoft Edge `149.0.4022.69`
- 有效 smoke profile：`C:\tmp\bb127-edge-profile-9228`
- 扩展加载方式：`--disable-extensions-except=<dist>` + `--load-extension=<dist>`，临时 profile，远程调试端口 `9228`
- 说明：一次早期 `9227` 试启动因带空格路径参数未正确引用而弃用；正式记录只采用 `9228` 临时 profile 结果。

隐私边界：

- 未读取 `C:\Users\LittleNub\Desktop\Key.txt`。
- 未读取、复制或记录 Cookie 文件、浏览器 profile 文件、Bilibili 登录态文件。
- 未上传完整历史、收藏、关注或 feedback 记录。
- 未写回 B 站；仅在当前运行视频页内进行播放暂停、预览、确认跳转和返回原位置 smoke。
- 报告中的 URL 去除了 `vd_source`、`spm_id_from`、`trackid`、登录验证 token 等查询参数。

## 验证命令

已通过：

- `npm run test:current-video-transcript`
- `npm run test:current-video-summary`
- `npm run test:video-knowledge`
- `node --test tests/current-video-segment-retrieval.test.ts tests/current-video-timestamp-jump.test.ts`
- `npm run typecheck`
- `npm run build`

构建备注：

- `npm ci` 成功；`npm audit` 报 1 个 high severity dependency audit 提示，本 smoke 未改依赖。
- `npm run build` 成功；Vite 输出已有 chunk size/dynamic import warning，未阻断 dist 加载。

## 真实页面覆盖

### 1. 中文 AI 字幕视频

视频：

- URL：`https://www.bilibili.com/video/BV1uVLX6uEYC/`
- 标题：`【闪客】1M 上下文很难吗？深入解读 GLM5.2 上下文背后的技术`
- 类型：中文 AI 字幕、单 P、6:19

结果：

- 页内助手出现在真实 B 站视频页，折叠态显示“Bili-Bill 当前视频助手”。
- 展开/收起正常，不打开 Dashboard 或新 tab 作为单视频主路径。
- 登录/字幕正文不可用前，助手显示“请先开启中文 AI 字幕”和登录/访问权限提示，不伪造字幕摘要。
- 登录完成并点击“重新检测字幕”后，字幕正文升级为“已缓存 187 条”，覆盖 `0:00-6:17`。
- 当前视频摘要从简介/元数据兜底升级为“字幕正文摘要”，证据强度高，并展示字幕证据时间范围。
- 知识节点显示 6 个字幕证据节点，时间范围来自字幕片段；知识节点只说明可在提问定位中使用，不直接 seek。
- 可见 UI raw 字段扫描未命中 `subtitle_url/sourceHash/segmentId/nodeId/candidateId/token/endpoint path/Cookie/profile/Key.txt`。

截图：

- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-02-expanded-initial.png`
- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-01-expanded-transcript.png`
- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-02-collapsed.png`
- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-09-redetect-after-login.png`

### 2. 提问定位与跳转闭环

视频：同 `BV1uVLX6uEYC`

查询：`100万上下文`

结果：

- 检索返回 5 个候选片段，全部来自当前视频字幕正文或当前视频本地节点。
- 候选展示时间范围、证据文本、证据强度和命中原因。
- 示例候选：
  - `0:00-0:02`，证据文本：`遗照上下文曾经是个很新鲜的东西`，证据强度 `70%`
  - `0:08-0:11`，证据文本：`以及最新的GLM都标配支持了一兆上下文`，证据强度 `67%`
  - `0:57-0:59`，证据文本：`简单点说就是上下文中的每个内部字段`，证据强度 `67%`
- 预览跳转前播放位置：`165.513991s`。
- 点击“预览跳转”后播放位置仍为 `165.513991s`，没有 seek。
- 点击“确认跳转”后跳到 `0.04s`，助手显示“已跳到 0:00，可返回 2:45”。
- 点击“返回原位置”后回到 `165.513991s`，播放器保持暂停。
- 全流程未打开 Dashboard、新 tab 或跨视频页。

截图：

- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-03-search-100w.png`
- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-04-preview-no-seek.png`
- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-05-confirm-jump.png`
- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-06-return.png`

### 3. 无字幕正文 / 未缓存字幕正文状态

视频：

- URL：`https://www.bilibili.com/video/BV1NCgVzoEG9/?p=2`
- 标题：`02 计算神经网络的参数`
- 类型：多 P 视频，第 `2 / 8` P，当前分 P 时长约 `11:09`

结果：

- 页内助手识别 BVID/CID，显示“当前分 P 第 2 / 8 P”。
- 字幕正文未缓存时，摘要使用简介/元数据兜底，并明确“不是完整视频总结”。
- 知识节点展示元数据、简介和分 P 弱证据；元数据/简介节点无时间点，分 P 节点只作为结构化辅助提示。
- 未出现自动跳转按钮；节点文案继续要求通过提问定位的预览/确认流程。
- 可见 UI raw 字段扫描未命中敏感或内部字段。

截图：

- `C:\Users\LITTLE~1\AppData\Local\Temp\bili-bill-issue127-real-08-multip-p2.png`

### 4. 长视频 / 多 P 视频

视频：

- URL：`https://www.bilibili.com/video/BV1NCgVzoEG9/`
- 标题：`【闪客】一小时从函数到 Transformer`
- 类型：8 个分 P 的长视频合集

结果：

- 页内助手在 P1 正常注入，折叠态显示当前视频标题。
- `videoData.pages.length = 8`，切到 `p=2` 后助手展示第 `2 / 8` P。
