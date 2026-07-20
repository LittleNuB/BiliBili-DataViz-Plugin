# Bili-Bill 0.13 集成 QA 报告

Issue：[#181](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/181)

日期：2026-07-19

## 结论

0.13 已合并功能在 clean integration worktree 中通过全量测试、focused tests、生产构建 mock QA、类型检查、构建、迁移、AI payload、时间边界、文案和隐私检查。ASR spike 结论为 no-go，普通 UI 未接入本地转录入口，正式实现专属场景不适用。

真实 B 站公开页 smoke 只完成了扩展 MV3 service worker 加载检查。空白临时 Edge profile 访问公开单 P 和多 P 页面时被 `net::ERR_CONNECTION_CLOSED` 中断；相同 URL 的 B 站公开接口和 `curl` 返回 200。该限制不等同于产品失败，但真实页的注入、当前分 P 身份、字幕和跳转仍需在可访问环境中补跑。确定性生产构建 mock 已覆盖这些交互。

本轮没有修改产品实现、版本号、release、tag、package 或发布资产。QA 过程中发现并修正两处测试夹具漂移：动态账单真实构建 mock 缺少 0.13 设置快照字段，盲盒失败夹具的四类顺序仍是旧顺序；均未改变产品代码。

## 基线

- Worktree：`C:\Users\LittleNub\Documents\New project 4\BiliBili-DataViz-Plugin-0.13-integration-qa`
- Branch：`codex/0.13-integration-qa`
- Base / initial HEAD：`beeff58747ec3595df08c4bbd2250d913ba9c18e`
- Base source：刷新后的 `origin/main`，PR #193 merge commit。
- Node.js：`v24.14.1`
- npm：`11.11.0`
- Microsoft Edge：`150.0.4078.65`
- Extension：本 worktree `npm run build` 生成的 unpacked `dist/`。

## 命令与结果

| 检查 | 结果 |
| --- | --- |
| `npm ci` | Pass；安装 29 packages。npm audit 报 2 个 moderate、1 个 high 既有依赖提示，本轮未改依赖。 |
| `node --test tests/*.test.ts` | Pass，466/466。 |
| 配置、字幕缓存和动态账单迁移 focused tests | Pass，110/110。 |
| 当前视频完整文本、摘要亮点、问答、智能收藏和动态账单 AI payload focused tests | Pass，135/135。 |
| 检索、字幕查看、时间点预览/确认/返回和一次性授权 focused tests | Pass，36/36。 |
| `node --test scripts/asr-local-transcription-spike.test.mjs` | Pass，19/19。 |
| `node scripts/asr-local-transcription-spike.mjs --mv3-only` | 预期 no-go，exit 1；未启动浏览器、未创建临时目录、未执行音频或模型流程。 |
| `npm run typecheck` | Pass。 |
| `npm run build` | Pass；保留既有 dynamic-import 和 chunk-size warning。 |
| `git diff --check` | Pass；只有工作区 LF/CRLF 提示。 |
| `tests/current-video-page.mock-qa.py` | Pass。 |
| `tests/current-video-popup.mock-qa.py` | Pass。 |
| `tests/current-video-primary-text.mock-qa.py` | Pass。 |
| `tests/current-video-qa-sessions.mock-qa.py` | Pass。 |
| `tests/settings-local-data-privacy.mock-qa.py` | Pass。 |
| `tests/settings-local-data-privacy.real-mock-qa.py` | Pass，使用生产构建。 |
| `tests/dynamic-bill-feedback-state.real-qa.mjs` | Pass，使用生产构建。 |
| `tests/experiment-blind-boxes.mock-qa.py` | Pass，覆盖 ready/failure、四类顺序、来源、链接、窄屏和 raw 文案。 |
| `tests/qa-0.13-public-page-smoke.py` | Partial；MV3 service worker 加载通过，页面导航被外部连接关闭。 |

## 证据索引

- 当前视频基础与完整文本：`tests/current-video-primary-text*.test.ts`、`tests/current-video-transcript-cache.test.ts`、`tests/current-video-subtitle-probe.test.ts`、`tests/current-video-summary-highlights.test.ts`、`tests/current-video-full-text-qa.test.ts`。
- 当前视频生产 UI：`tests/current-video-page.mock-qa.py`、`tests/current-video-popup.mock-qa.py`、`tests/current-video-primary-text.mock-qa.py`。
- 会话：`tests/current-video-qa-sessions.test.ts`、`tests/current-video-qa-sessions.mock-qa.py`、`tests/current-video-full-text-qa.test.ts`。
- 字幕与跳转：`tests/current-video-subtitle-view.test.ts`、`tests/current-video-timestamp-jump.test.ts`、`tests/current-video-timestamp-operation-lease.test.ts`、`tests/current-video-primary-text.mock-qa.py`。
- 动态账单：`tests/dynamic-bill-013.test.ts`、`tests/dynamic-bill-migration.test.ts`、`tests/dynamic-bill-feedback-state.test.ts`、`tests/dynamic-bill-layout*.test.ts`、`tests/dynamic-bill-feedback-state.real-qa.mjs`。
- 视频盲盒：`tests/experiment-blind-boxes.test.ts`、`tests/experiment-blind-boxes.mock-qa.py`。
- 设置与隐私：`tests/settings-config-migration.test.ts`、`tests/ai-connection.test.ts`、`tests/settings-local-data-privacy.test.ts`、`tests/settings-diagnostic-download.test.ts`、`tests/settings-local-data-privacy*.mock-qa.py`。

以下矩阵中的“Pass”均指上方确定性自动化或生产构建 mock 已覆盖；真实页限制单独记录，不把未执行的真实页面动作算作通过。

## 当前视频助手矩阵

| ID | 状态 | 证据 |
| --- | --- | --- |
| CV-01 | Pass | `settings-config-migration.test.ts`、`current-video-primary-text-authorization.test.ts` |
| CV-01A | Pass | `current-video-primary-text.mock-qa.py`、`current-video-page.mock-qa.py` |
| CV-02 | Pass | `current-video-primary-text.test.ts`、`current-video-primary-text-selection-store.test.ts` |
| CV-02A | Pass | `current-video-transcript-cache.test.ts`、`current-video-message-handlers.test.ts` |
| CV-03 | Pass | `current-video-subtitle-probe.test.ts`、`current-video-primary-text.mock-qa.py` |
| CV-04 | Pass | `current-video-primary-text.test.ts`、`current-video-primary-text.mock-qa.py` |
| CV-05 | Pass | `current-video-summary-highlights.test.ts`、`current-video-popup.mock-qa.py` |
| CV-06 | Pass | `current-video-summary-highlights.test.ts` |
| CV-06A | Pass | `current-video-summary-highlights.test.ts` |
| CV-06B | Pass | `current-video-summary-highlights.test.ts` |
| CV-06C | Pass | `current-video-summary-highlights.test.ts`、`current-video-primary-text.mock-qa.py` |
| CV-06D | Pass | `current-video-primary-text.test.ts`、`current-video-transcript-cache.test.ts` |
| CV-07 | Pass | `current-video-summary-highlights.test.ts`、`current-video-primary-text.mock-qa.py` |
| CV-07A | Pass | `current-video-transcript-cache.test.ts`、`settings-local-data-privacy.test.ts` |
| CV-08 | Pass | `current-video-summary-highlights.test.ts`、`current-video-primary-text.mock-qa.py` |
| CV-09 | Pass | `current-video-timestamp-jump.test.ts`、`current-video-popup.mock-qa.py` |
| CV-09A | Pass | `current-video-timestamp-operation-lease.test.ts` |
| CV-09B | Pass | `current-video-timestamp-operation-lease.test.ts`、`current-video-context.test.ts` |
| CV-10 | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.mock-qa.py` |
| CV-11 | Pass | `current-video-full-text-qa.test.ts` |
| CV-12 | Pass | `current-video-full-text-qa.test.ts` |
| CV-12A | Pass | `current-video-full-text-qa.test.ts` |
| CV-12B | Pass | `current-video-full-text-qa.test.ts`、`current-video-primary-text.mock-qa.py` |
| CV-12C | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.test.ts` |
| CV-12D | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.test.ts` |
| CV-12E | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.test.ts` |
| CV-13 | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.mock-qa.py` |
| CV-14 | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.test.ts` |
| CV-14A | Pass | `current-video-message-handlers.test.ts`、`current-video-full-text-qa.test.ts` |

## 问答会话矩阵

| ID | 状态 | 证据 |
| --- | --- | --- |
| QS-01 | Pass | `current-video-qa-sessions.test.ts` |
| QS-02 | Pass | `current-video-qa-sessions.test.ts`、`current-video-qa-sessions.mock-qa.py` |
| QS-03 | Pass | `current-video-full-text-qa.test.ts` |
| QS-04 | Pass | `current-video-qa-sessions.test.ts`、`current-video-qa-sessions.mock-qa.py` |
| QS-05 | Pass | `current-video-full-text-qa.test.ts` |
| QS-05A | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.mock-qa.py` |
| QS-06 | Pass | `current-video-qa-sessions.mock-qa.py` |
| QS-07 | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.test.ts` |
| QS-08 | Pass | `current-video-qa-sessions.mock-qa.py` |
| QS-09 | Pass | `current-video-qa-sessions.mock-qa.py`、`current-video-timestamp-operation-lease.test.ts` |
| QS-10 | Pass | `current-video-qa-sessions.test.ts`、`current-video-transcript-cache.test.ts` |
| QS-11 | Pass | `current-video-full-text-qa.test.ts`、`current-video-qa-sessions.mock-qa.py` |
| QS-12 | Pass | `current-video-qa-sessions.test.ts` |
| QS-13 | Pass | `current-video-qa-sessions.test.ts` |
| QS-13A | Pass | `current-video-qa-sessions.test.ts` |
| QS-14 | Pass | `current-video-qa-sessions.test.ts`、`settings-local-data-privacy.test.ts` |
| QS-14A | Pass | `current-video-qa-sessions.test.ts`、`settings-local-data-privacy.test.ts` |

## 字幕与 ASR 矩阵

| ID | 状态 | 证据 |
| --- | --- | --- |
| TX-01 | Pass | `current-video-subtitle-view.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-02 | Pass（条件 mock） | `current-video-primary-text.mock-qa.py`；不宣称生产可达 |
| TX-03 | Pass | `current-video-subtitle-view.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-04 | Pass | `current-video-subtitle-view.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-04A | Pass | `current-video-primary-text.mock-qa.py` |
| TX-05 | Pass | `current-video-subtitle-view.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-05A | Pass | `current-video-subtitle-view.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-05B | Pass | `current-video-message-handlers.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-05C | Pass | `current-video-timestamp-operation-lease.test.ts` |
| TX-05D | Pass | `current-video-timestamp-operation-lease.test.ts`、`current-video-primary-text.mock-qa.py` |
| TX-06 | Pass | `current-video-transcript-cache.test.ts`、`settings-local-data-privacy.test.ts` |
| TX-07 | N/A（ASR no-go） | 没有本地转录稿生产者或普通 UI 清理入口 |
| TX-07A | Pass | `current-video-transcript-cache.test.ts`、`settings-local-data-privacy.test.ts` |
| TX-07B | Pass | `current-video-transcript-cache.test.ts`、`dynamic-bill-migration.test.ts` |
| TX-07C | Pass | `current-video-transcript-cache.test.ts`、`current-video-primary-text.mock-qa.py` |
| ASR-01 | Pass | `report-local-transcription-0.13.md`、`current-video-primary-text.mock-qa.py` |
| ASR-01A | Pass | `current-video-primary-text.mock-qa.py`、`settings-local-data-privacy.test.ts` |
| ASR-02 | N/A（ASR no-go） | 正式实现未进入主线 |
| ASR-03 | N/A（ASR no-go） | 正式实现未进入主线 |
| ASR-04 | N/A（ASR no-go） | 正式实现未进入主线 |
| ASR-05 | N/A（ASR no-go） | 正式实现未进入主线 |

## 动态账单矩阵

| ID | 状态 | 证据 |
| --- | --- | --- |
| DB-01 | Pass | `dynamic-bill-013.test.ts`、`dynamic-bill-layout-state.test.ts` |
| DB-01A | Pass | `dynamic-bill-migration.test.ts` |
| DB-01B | Pass | `dynamic-bill-migration.test.ts` |
| DB-01C | Pass | `dynamic-bill-migration.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-01D | Pass | `dynamic-bill-migration.test.ts` |
| DB-01E | Pass | `dynamic-bill-migration.test.ts`、`current-video-transcript-cache.test.ts` |
| DB-02 | Pass | `dynamic-bill-013.test.ts` |
| DB-03 | Pass | `dynamic-bill-013.test.ts` |
| DB-04 | Pass | `dynamic-bill-013.test.ts` |
| DB-05 | Pass | `dynamic-bill-layout-state.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-06 | Pass | `dynamic-bill-layout-state.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-07 | Pass | `dynamic-bill-visible-copy.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-08 | Pass | `dynamic-bill-feedback-state.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-09 | Pass | `dynamic-bill-feedback-state.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| DB-10 | Pass | `dynamic-bill-feedback-state.test.ts` |
| DB-11 | Pass | `dynamic-bill-feedback-state.test.ts` |
| DB-12 | Pass | `dynamic-bill-feedback-state.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-13 | Pass | `dynamic-bill-feedback-state.test.ts`、`dynamic-bill-feedback-state.real-qa.mjs` |
| DB-14 | Pass | `dynamic-bill-feedback-state.test.ts` |

## 视频盲盒矩阵

| ID | 状态 | 证据 |
| --- | --- | --- |
| BB-01 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-02 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-03 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-04 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-05 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-06 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-06A | Pass | `experiment-blind-boxes.test.ts` |
| BB-06B | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-06C | Pass | `experiment-blind-boxes.test.ts` |
| BB-06D | Pass | `experiment-blind-boxes.test.ts` |
| BB-06E | Pass | `experiment-blind-boxes.test.ts` |
| BB-06F | Pass | `experiment-blind-boxes.test.ts` |
| BB-07 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-08 | Pass | `experiment-blind-boxes.test.ts`、`experiment-blind-boxes.mock-qa.py` |
| BB-09 | Pass | `experiment-blind-boxes.test.ts` |
| BB-10 | Pass | `experiment-blind-boxes.test.ts` |
| BB-11 | Pass | `experiment-blind-boxes.mock-qa.py`、生产 `dist/dashboard.js` |

## 设置与本地数据矩阵

| ID | 状态 | 证据 |
| --- | --- | --- |
| ST-01 | Pass | `settings-config-migration.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-02 | Pass | `settings-config-migration.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-03 | Pass | `ai-connection.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-04 | Pass | `settings-local-data-privacy.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-04A | Pass | `settings-local-data-privacy.test.ts`、`dynamic-bill-migration.test.ts` |
| ST-04B | Pass | `settings-local-data-privacy.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-05 | Pass | `settings-local-data-privacy.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-06 | Pass | `settings-local-data-privacy.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-07 | Pass | `settings-local-data-privacy.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |
| ST-08 | N/A（ASR no-go） | 设置页不展示不存在的模型或转录稿类别 |
| ST-09 | Pass | `settings-diagnostic-download.test.ts`、`settings-local-data-privacy.real-mock-qa.py` |

## AI payload 审计

- 当前视频摘要/亮点和问答仅在完整文本授权开启、用户主动触发且当前分 P 完整身份匹配时发送正文。
- 摘要/亮点请求只发送一次当前分 P 完整主要文本；结果必须逐句/逐要点/逐亮点绑定同一文本快照。
- 问答发送当前问题、当前分 P 完整主要文本和同身份滚动脉络；切换视频后不发送旧视频正文、回答或引用。
- 拒绝自动上传完整历史、完整收藏、完整关注、反馈记录、Cookie、登录态或本地路径。
- 智能收藏和动态账单继续使用各自最小意图 payload；未因当前视频完整文本授权扩大范围。
- 证据：`current-video-full-text-qa.test.ts`、`current-video-summary-highlights.test.ts`、`current-video-message-handlers.test.ts`、`smart-favorites-qa.test.ts`、`dynamic-bill-migration.test.ts`。

## 文案与 raw 字段扫描

- `未消费|猜你喜欢`：`src` 普通 UI 无命中；测试和文档中的命中均为否定样例或合同说明。
- `document is not defined|ReferenceError`：源码命中只在 `assistant-status.ts` 和 `video-blind-box-candidates.ts` 的运行时错误清洗逻辑；盲盒生产构建 mock 未显示原始异常。
- `fallback|transcript|confidence|sourceHash|segmentId|subtitle_url|BVID|CID`：源码和构建产物命中为内部类型、身份守卫、payload 校验、缓存键、样式类或安全清洗；浏览器 QA 对实际可见文本逐项扫描，无用户可见泄漏。
- 设置诊断导出只含宽泛状态、数量和兼容信息；不含 API Key、视频标识、字幕正文、会话正文或敏感本地数据。

## 真实页面与 mock 双轨

### 生产构建 mock

- 当前视频：桌面/窄屏、四标签、完整文本授权、摘要亮点、问答会话、字幕搜索/导出、失败、取消、迟到响应、来源变化、预览/确认/返回均通过。
- 动态账单：固定三栏、紧凑/全空状态、30 天暂停、撤销、一次性取关提示、恢复提醒和刷新回读通过。
- 视频盲盒：固定四类、候选来源、真实 B 站候选说明、无种子、接口失败、不可打开、重试和最近抽取去重通过。
- 设置：三个 AI 开关持久化、Key 不回显、最小连接测试、分类清理、全部清理、部分失败、暂停恢复和诊断导出通过。

### 真实 B 站公开页

- 使用系统 Edge 和本轮新建的空白临时 profile；未复用任何本地浏览器 profile、Cookie 或登录态。
- `dist/background.js` MV3 service worker 成功加载。
- 单 P 样本 `BV1uVLX6uEYC` 的公开接口与 `curl` 返回 200；Edge 曾有一次无扩展访问成功，之后 Playwright 启动和独立 CDP 启动均在导航时收到连接关闭。
- 两个多 P 样本的公开接口确认分别有 8 P 和 2 P，`curl` 返回 200；空白 Edge 导航同样被连接关闭。
- 因页面 DOM 未稳定载入，本轮不宣称真实页助手注入、真实字幕正文、分 P 切换或真实播放器 seek 已通过。相关确定性交互由生产构建 mock 覆盖。
- 后续人工 smoke 只需在可访问的公开页中加载本 PR 构建，确认助手注入、当前分 P、字幕重新检测和预览/确认/返回；若需 AI 字幕，由用户在页面手动开启，不读取凭据文件。

## #82 / #83 审计

- #82 当前状态已是 closed。0.13 已以完整主要文本授权、摘要与亮点合并生成、逐句证据校验、缓存身份和无正文拒绝覆盖并强化其字幕证据摘要目标；证据为 `current-video-summary-highlights.test.ts`、`current-video-primary-text.mock-qa.py`。
- #83 当前状态已是 closed。0.13 保留模糊检索，并将时间点操作统一为预览、确认、返回和一次性身份授权；证据为 `current-video-segment-retrieval.test.ts`、`current-video-timestamp-jump.test.ts`、`current-video-timestamp-operation-lease.test.ts`。
- 本轮未评论、关闭、重开或修改 #82/#83。

## 隐私与变更边界确认

- 未读取 Cookie 文件、浏览器 profile、login-state、key 文件或 `C:\Users\LittleNub\Desktop\Key.txt`。
- 未读取真实 IndexedDB、完整历史、收藏、关注、反馈或会话正文。
- 未向任何 AI 服务发送真实本地数据；真实页 smoke 未发起 AI 请求。
- 未修改 B 站数据或执行关注、取关、收藏、评论、点赞、投币等写操作。
- 未修改 `package.json`、`package-lock.json`、manifest 版本、release、tag 或发布资产。

## Blocker 与剩余风险

- 产品/自动化 blocker：无。
- 外部 smoke 限制：当前机器的空白 Edge 到 B 站公开视频页面连接被关闭，真实页 DOM 交互未完成。正式发布前建议补一轮人工真实页 smoke；不需要提供或读取 Cookie/profile/login-state/key 文件。
- 依赖风险：`npm ci` 报 2 个 moderate、1 个 high 既有 audit 提示，本轮未修改依赖；由 release owner 单独评估。
- 构建风险：Vite 仍有既有 dynamic-import 和 chunk-size warning，本轮未观察到对应运行时失败。

## Readiness

#181 的工程 QA 和可追溯报告已完成，可进入中立 reviewer 复核。真实页人工 smoke 仍是发布前验证项，不在本 PR 中伪造为通过；本报告不授权发布、改版本、打 tag 或创建 release。
