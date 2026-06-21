# Bili-Bill 0.12 内容助手集成 QA 与发布准备

Issue: [#141](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/141)

日期：2026-06-21

## 基线

- 分支：`codex/release-0.12-integration-qa`
- Worktree：`C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-release-0.12-integration-qa`
- 基线 commit：`fd174eaafa6b906ffb7c9bf31abfb31919cc9344`
- 来源：刷新后的 `origin/main`，该 commit 是 PR #152 / Issue #140 merge commit。

## 范围

本轮是 QA/report slice，覆盖 0.12 内容助手主线：

- 设置页：AI 配置、功能开关、隐私说明、本地数据入口。
- 当前视频 Agent：字幕正文状态、问答、引用片段、预览/确认跳转、返回原位置。
- 智能收藏联动：当前视频助手内的相关收藏分区、当前已同步收藏边界、同步不完整提示。
- 视频盲盒：随机探索、换口味、冷门收藏、本地兴趣回顾，以及无候选降级状态。
- 隐私、copy 和 raw 字段可见性边界。

本 PR 不修改产品功能、版本号、manifest 版本、tag、包产物或 GitHub Release。

## 合并背景

本轮基于已合并的 0.12 相关 PR：

- #142 设置页 AI 配置 MVP。
- #143 视频盲盒真实候选源 spike。
- #144 当前视频查询改写。
- #145 智能收藏知识库 PRD。
- #146 设置页本地数据与隐私控制。
- #147 当前视频问答与引用片段。
- #148 当前视频助手 UX polish。
- #149 当前视频相关收藏。
- #150 随机探索真实候选。
- #151 换口味真实候选。
- #152 盲盒来源边界整合。

## 命令与结果

| Command | Result |
| --- | --- |
| `npm ci` | Pass. 安装 28 packages；`npm audit` 报 1 个 high severity dependency audit 提示，本轮未改依赖。 |
| `node --test tests/ai-connection.test.ts tests/settings-local-data-privacy.test.ts` | Pass. 6 passed。覆盖 AI 连接最小 payload、设置本地数据摘要和危险清理确认。 |
| `npm run test:current-video-transcript` | Pass. 18 passed。覆盖字幕诊断、字幕 body cache、身份匹配和 payload audit。 |
| `node --test tests/current-video-qa.test.ts tests/current-video-segment-retrieval.test.ts tests/current-video-timestamp-jump.test.ts tests/current-video-segment-rerank.test.ts tests/current-video-summary.test.ts tests/video-knowledge.test.ts` | Pass. 67 passed。覆盖当前视频问答、引用片段、查询改写、AI guard、预览/确认/返回跳转、摘要和知识节点。 |
| `npm run test:favorites` | Pass. 29 passed。覆盖收藏同步诊断、智能索引、Smart Favorites Q&A、当前视频相关收藏和 payload audit。 |
| `npm run test:experiments` | Pass. 5 passed。覆盖视频盲盒真实候选、换口味冷却方向、候选失败降级和空状态。 |
| `npm run typecheck` | Pass. `tsc --noEmit` completed。 |
| `npm run build` | Pass. Vite build 和 `vite.player-monitor.config.ts` build completed；仍有既有 dynamic-import/chunk-size warnings。 |
| 禁用状态词和禁用推荐定位词扫描 | Completed. 命中仅在既有 Dynamic Bill 规划/PRD/QA 文档中作为禁用示例或历史说明；本报告不复写禁用短语。runtime/source、README 和 tests 主路径未发现普通 UI 泄漏。 |
| `rg -n "fallback|transcript|confidence|sourceHash|segmentId|subtitle_url|candidateId|nodeId|token|Cookie|profile|Key\.txt" dashboard popup public src README.md tests docs` | Completed. 命中已分类：类型定义、payload audit guard、测试断言、隐私文档和样式类名；Browser/mock 可见文本扫描未发现普通 UI 暴露 raw ids、hash、URL、token、Cookie/profile/key 文案。 |

## Browser / Mock QA

### 设置页

环境：

- Browser：Playwright Chromium headless。
- Mock：`tests/settings-mvp.mock.html`、`tests/settings-local-data-privacy.mock.html`。

结果：

- AI 服务地址、模型名、API Key 输入、测试连接、保存状态通过。
- 当前视频、智能收藏、动态账单功能开关可切换。
- 智能收藏页能返回设置入口。
- AI 未配置提示指向设置页。
- 隐私说明显示 API Key 本地保存、不上传完整历史/收藏/关注/反馈、不读取 Cookie/profile/login-state/key 文件。
- 本地数据入口通过：刷新状态、清理字幕缓存、重建智能收藏索引、清理本地数据二次确认。
- 保存后的完整测试 key 未出现在可见文本中。

### 当前视频 Agent mock

环境：

- Browser：Playwright Chromium headless。
- URL：`http://127.0.0.1:5199/video/BV1ShellMock9`
- Server：临时本地 HTTP handler，把 `/video/BV1ShellMock9` 映射到 committed mock HTML。
- Bundle：本 worktree 的 `dist/content/player-monitor.js`。

结果：

- 页内助手注入、展开通过。
- 点击“重新检测字幕”后 mock runtime 显示字幕缓存为“是”。
- 输入 `subagent` 后显示回答优先结果和引用片段。
- 预览跳转不改变播放位置：`12 -> 12`。
- 确认跳转到 `42s`。
- 返回原位置回到 `12s`。
- 可见文本扫描未发现 `fallback`、`transcript`、`confidence`、`sourceHash`、`segmentId`、`subtitle_url`、`candidateId`、`nodeId`、`token`、`Cookie`、`profile`、`Key.txt`、禁用 Dynamic Bill 文案。

### 相关收藏

环境：

- Browser：Playwright Chromium headless。
- Mock：`tests/current-video-related-favorites.mock.html`，390x844 viewport。

结果：

- 当前视频回答和相关收藏分区分开显示。
- 相关收藏明确标注“来自当前已同步收藏”。
- 同步不完整提示可见：结果只覆盖当前已同步收藏。
- 2 条引用收藏卡片和 B 站视频链接可见。
- 可见文本未暴露 raw ids、hash、token、Cookie/profile/key 文案。

### 视频盲盒

环境：

- Browser：Playwright Chromium headless。
- URL：`http://127.0.0.1:5173/dashboard/index.html#experiments`
- Server：`npx vite --host 127.0.0.1 --port 5173`
- Runtime：注入 mock `chrome.runtime.sendMessage`，覆盖 ready 和 degraded 两套 `GET_EXPERIMENT_DATA`。

结果：

- Ready scenario 通过：随机探索、换口味、冷门收藏、本地兴趣回顾四类卡片均渲染；揭晓后显示候选来源、真实 B 站候选状态、理由、证据和 B 站视频链接。
- Degraded scenario 通过：四类卡片均显示原因；无候选时没有空卡、没有打开视频链接，并提供重新生成动作。
- Copy 边界通过：页面继续把 Dynamic Bill 定位为“兴趣再平衡”，盲盒不写成推荐排序。
- 可见文本未发现 raw/internal 或敏感字段泄漏。

## 真实 B 站页面 Smoke

环境：

- Browser：Microsoft Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- Profile：临时 profile under `%TEMP%`，脚本结束后删除。
- Extension：unpacked `dist/`，通过 `--disable-extensions-except=<dist>` 和 `--load-extension=<dist>` 加载。
- URL：`https://www.bilibili.com/video/BV1uVLX6uEYC/`
- 视频标题：`【闪客】1M 上下文很难吗？深入解读 GLM5.2 上下文背后的技术`

结果：

- 页内助手成功注入真实 B 站页面。
- 展开助手成功。
- 点击“重新检测字幕”成功触发检测。
- 实时字幕正文缓存被 B 站页面状态挡住：助手显示“字幕轨道没有正文地址”“B 站播放器接口没有返回可用字幕轨道”，并提示需要在播放器里重新选择中文 AI 字幕；摘要同时说明可能需要登录或访问权限。
- 在无字幕正文缓存状态下输入 `100万上下文`，当前视频问答成功提交，显示本地证据回答和 1 个当前视频本地弱节点候选。
- 预览/确认/返回闭环可操作：预览不 seek，确认跳转，返回原位置。
- 未发现 console error。

限制：

- 本轮真实页 smoke 使用临时未登录 profile，未读取或复用本地 Cookie、浏览器 profile、Bilibili 登录态文件。
- 因 B 站未向该临时会话返回可用字幕正文地址，真实页未覆盖“字幕 body 已缓存后的字幕引用片段”。该部分已由 committed current-video shell mock、focused tests 和 payload audit 作为 fallback 覆盖。
- 若 release owner 要求真实账号字幕正文覆盖，需用明确批准的登录会话手动开启中文 AI 字幕后重跑；仍不得读取 profile/Cookie/login-state 文件。

## Copy / Raw Field Scan 分类

禁用 Dynamic Bill 文案扫描：

- `dashboard`、`popup`、`public`、`src`、`README.md`、`tests` 未发现普通 runtime/UI 命中。
- `docs/backlog-dynamic-bill.md`、`docs/PRD-dynamic-bill.md`、`docs/development-plan-dynamic-bill.md`、`docs/qa-dynamic-bill-alpha.md` 中存在既有规划、PRD 或 QA 说明命中，语境是禁用示例或历史验证说明。
- 本报告刻意不复写禁用短语，避免新增 release 文档扫描噪声。

Raw/internal 字段扫描：

- `src/shared/types/*`、`src/shared/*`、`src/background/*`、`src/content/player-monitor/assistant-status.ts` 命中为类型字段、状态码、payload guard、内部变量或安全映射。
- `tests/*` 命中为 payload audit、敏感字段拒绝用例、mock runtime 字段或断言。
- `README.md`、PRD/docs 和本报告命中为隐私边界说明、扫描命令或扫描分类说明。
- `dashboard/styles/dashboard.css` 的 `.is-fallback` 是样式类名，不是可见文案。
- Browser/mock 可见文本扫描未发现普通用户 UI 暴露 `sourceHash`、`segmentId`、`subtitle_url`、`candidateId`、`nodeId`、`token`、Cookie/profile/key 路径或禁用 Dynamic Bill 文案。

## #82 / #83 状态建议

- #82 `Build transcript-grounded current video summary pipeline`：当前 main 已具备字幕正文 cache、当前视频身份匹配、transcript summary、本地 fallback、payload audit 和相关 focused tests。建议保持 issue open 给 main agent 做最终 triage；从本轮 QA 看它更像已被 current-video transcript/summary 系列工作功能性覆盖，不是 0.12 release blocker。
- #83 `Video knowledge: fuzzy timestamp search and one-click jump`：当前 main 已具备 fuzzy segment retrieval、query rewrite、AI rerank guard、引用片段、预览/确认跳转和返回原位置。安全实现是手动预览/确认，而不是无确认 one-click auto seek。建议保持 issue open 给 main agent 判断是否改为 superseded/closed-by 当前视频 Agent 工作，或保留为后续语义召回增强；不是 0.12 release blocker。

本轮未关闭、未修改 #82 / #83。

## 隐私与安全确认

Confirmed:

- Privacy-sensitive files read: false。
- Full local datasets read/exported: false。
- 未读取 `C:\Users\LittleNub\Desktop\Key.txt`。
- 未读取 Cookie 文件。
- 未读取或复用本地浏览器 profile 文件。
- 未读取 Bilibili 登录态文件。
- 未导出或上传完整历史、完整收藏、完整关注、feedback 原始记录或 IndexedDB dump。
- 未写回 B 站；没有关注、取关、收藏夹、评论、点赞、投币或播放状态写回。
- 真实页 smoke 只使用临时浏览器 profile 和当前页面 runtime 状态。

## Findings

### Blockers

None found in implementation or release-readiness checks.

### Must-Fix Before Release Prep

None found in this pass.

### Follow-Up

- 如需真实字幕正文端到端信心，使用明确批准的登录会话手动开启中文 AI 字幕后重跑真实页 current-video smoke；不要读取 Cookie/profile/login-state 文件。
- `npm ci` 仍报告 1 个 high severity dependency audit 提示；本轮未改依赖，建议 release owner 单独决定是否进入 release gate。
- Build 仍有既有 Vite dynamic-import/chunk-size warnings，当前不阻断。
- #82/#83 保持打开，建议 main agent 做 issue hygiene：标记 superseded/covered，或拆成后续语义召回增强。

## Readiness 结论

建议 #141 进入主 Agent review。当前未发现 blocker 或 must-fix；0.12 内容助手主线的设置、当前视频 Agent、相关收藏、视频盲盒、copy 和隐私边界已有 focused tests、typecheck、build、真实页部分 smoke 和 committed mock QA 覆盖。
