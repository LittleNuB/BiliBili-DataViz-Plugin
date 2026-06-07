# 动态账单 API Spike：动态 feed

日期：2026-06-04

范围：验证动态账单 v1 是否可以 API-first 获取最近 7 天已关注 UP 的视频投稿动态。本文只记录只读 API spike，不实现正式同步功能，不调用 AI，不上传完整历史或完整关注列表，不改写 B 站关注关系。

## 结论

API-first 可进入正式实现，但需要在后续实现前做一次登录账号 smoke test。当前代码已有 `biliGet`、登录态 Cookie 透传、限流、超时、WBI fallback 和 `-101` 未登录错误处理，适合承接动态 feed 拉取。

DOM fallback 暂不作为首选实现。应保留方案，但只在登录态 API 连续失败、字段结构发生破坏性变化，或 B 站限制扩展 background 请求时启用。

## 候选端点

主端点：

```text
GET https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all
```

建议参数：

```text
type=video
offset=<上一页返回的 offset，第一页为空>
timezone_offset=-480
```

说明：

- 需要登录 Cookie；未登录返回 `code=-101`。
- `type=video` 可作为第一层服务端过滤，但正式实现仍必须在客户端二次识别视频投稿。
- 分页以响应中的 `offset` 和 `has_more` 为准，不依赖 `page`。
- endpoint host 已被 `public/manifest.json` 的 `*://*.bilibili.com/*` 覆盖。
- 现有 `src/background/api/client.ts` 的 `biliGet` 会带 `credentials: 'include'`、`Referer: https://www.bilibili.com/` 和统一限流。

## 本地探测记录

当前命令行环境未读取浏览器 Cookie。只做无登录探测，避免导出用户 Cookie 或关注数据。

探测结果：

| 端点 | 样本参数 | 结果 |
| --- | --- | --- |
| `/x/web-interface/nav` | 无 | `code=-101`, `message=账号未登录`, `data.isLogin=false` |
| `/x/polymer/web-dynamic/v1/feed/all` | `type=video&page=1` | `code=-101`, `message=账号未登录` |

这确认动态 feed 不能无登录获取，也说明后续实现要把 `NOT_LOGGED_IN` 当作正常可解释状态处理。当前环境没有做登录态 7 天覆盖率采样，因此“稳定获取最近 7 天”仍需要在扩展 background 中用真实登录账号完成 smoke test。

## Smoke test 记录（2026-06-04）

本轮 issue #4 开发前尝试做登录态 smoke test。Codex CLI 环境没有可复用的 B 站浏览器登录 Cookie；为避免导出或复制 Cookie，只执行不带 Cookie 的只读请求。

结果：

| 端点 | 参数 | 结果 |
| --- | --- | --- |
| `/x/web-interface/nav` | 无 | `code=-101`, `message=账号未登录`, `data.isLogin=false` |
| `/x/polymer/web-dynamic/v1/feed/all` | `type=video&timezone_offset=-480` | `code=-101`, `message=账号未登录` |

结论：

- 未登录降级路径已确认，正式实现必须把 `NOT_LOGGED_IN` 显示成可解释状态。
- 当前环境未能确认登录态下 `items/offset/has_more` 的真实字段表现。
- 正式实现仍按 API-first 推进，并通过扩展 background 的 `credentials: include` 使用用户现有登录态。
- 后续在用户已登录 B 站并加载扩展后，需要再次点击动态账单同步按钮，确认 `DYNAMIC_TYPE_AV` / `MAJOR_TYPE_ARCHIVE` 过滤命中和最近 7 天覆盖率。

## 视频投稿识别

不要只信任 `type=video`。正式实现应同时满足：

- `item.type === 'DYNAMIC_TYPE_AV'`，或等价的视频动态类型。
- `item.modules.module_dynamic.major.type === 'MAJOR_TYPE_ARCHIVE'`。
- `item.modules.module_dynamic.major.archive.bvid` 存在。

建议字段映射：

| 本地字段 | API 字段候选 | 备注 |
| --- | --- | --- |
| `dynamicId` | `item.id_str` | 用字符串，避免大整数精度问题。 |
| `dynamicTime` | `modules.module_author.pub_ts` | 秒级时间戳，用于 7 天窗口。 |
| `authorMid` | `modules.module_author.mid` | 与关注列表 join。 |
| `authorName` | `modules.module_author.name` | 展示用。 |
| `authorFace` | `modules.module_author.face` | 展示用。 |
| `bvid` | `major.archive.bvid` | 必填。 |
| `avid` | `major.archive.aid` | 可选补充。 |
| `title` | `major.archive.title` | 必填。 |
| `intro` | `major.archive.desc` 或详情接口 `desc` | 可能为空。 |
| `cover` | `major.archive.cover` | 展示用。 |
| `duration` | `major.archive.duration_text` 或 `/x/web-interface/view` | 若只有文本，正式入库前转秒或补全。 |
| `pubtime` | `/x/web-interface/view` 的发布时间字段 | feed 中不一定稳定。 |
| `tagName` | `/x/web-interface/view` 的 `tname` | 用于换换口味。 |

建议仍复用 `src/background/api/video-info.ts` 的 `batchFetchVideoInfo` 为候选视频补全详情。补全失败不能阻断动态同步，缺失字段记录为空或 unknown。

## 7 天窗口策略

同步流程建议：

1. 用 `biliGet` 请求第一页 `feed/all?type=video`。
2. 对每条 item 做客户端视频投稿识别。
3. 以 `dynamicTime` 判断是否属于最近 7 天。
4. 写入候选池前生成稳定 key：`${dynamicId}:${bvid}`。
5. 使用响应 `offset` 拉下一页。
6. 当当前页最老 `dynamicTime < now - 7 days` 且后续页只会更旧时停止。
7. 设置安全上限，例如最多 20 页或最多 1000 条原始动态，防止 offset 异常循环。

排序和入选不要使用点击率、推荐理由或互动数。动态 feed 只提供“已关注 UP 最近视频投稿池”，后续账单栏目仍由本地兴趣再平衡规则决定。

## 失败和降级

| 场景 | 处理 |
| --- | --- |
| 未登录 `-101` | 返回 `NOT_LOGGED_IN`，Dashboard 展示可解释状态，不刷红错误。 |
| HTTP 412 或疑似限流 | 复用现有 60 秒 backoff；动态同步建议低频、用户触发优先。 |
| 请求超时 | 保留旧账单或旧同步时间，提示本次动态同步失败。 |
| `type=video` 返回非视频 | 客户端二次过滤，丢弃非 `MAJOR_TYPE_ARCHIVE`。 |
| 字段缺失 | 记录 raw 关键片段到本地 debug 日志或返回 warning，不让单条异常中断整页。 |
| 详情补全失败 | 保留 feed 原始标题、封面、bvid；`tagName/tags/duration/pubtime` 降级为空。 |

## DOM fallback 方案

只在 API-first 失败后启用。

候选页面：`https://t.bilibili.com/` 或 B 站当前动态页。

原则：

- 只在用户明确打开动态页或手动触发同步后采集。
- 只采集可见或有限滚动后的最近 7 天视频投稿卡片。
- 只提取动态 ID、UP、bvid、标题、封面、发布时间等最小字段。
- 不读取评论、弹幕、推荐卡、广告卡或非关注内容。
- 不使用 DOM fallback 改写页面排序。

风险：

- DOM class 和嵌套结构更容易变化。
- 滚动加载会增加用户可见页面扰动。
- 时间文案可能是相对时间，需要额外转换。

因此 DOM fallback 是兜底，不应阻塞 API-first 正式实现。

## 后续正式实现入口

建议新增：

```text
src/background/api/dynamic.ts
```

核心方法：

```ts
fetchFollowedVideoDynamics(options: {
  windowDays: number;
  maxPages: number;
  signal?: AbortSignal;
}): Promise<FollowedVideoUpdate[]>
```

实现要求：

- 复用 `biliGet`，不新建独立 fetch client。
- 只读 B 站 API。
- 不调用 AI。
- 不上传 feed 原始列表。
- 对每次同步记录 `syncedAt`、页数、候选数、过滤数、失败原因。

## 仍需人工验证

后续 issue #4 开始前，需要在登录 B 站的扩展环境完成：

- `type=video` 是否稳定返回已关注账号的视频投稿动态。
- `offset` 是否能覆盖最近 7 天，尤其是高关注量账号。
- `module_author.pub_ts` 是否可作为动态发布时间。
- `major.archive` 字段是否覆盖 `bvid/aid/title/cover/desc/duration`。
- 非视频动态是否会混入，以及客户端过滤命中率。

## 真实扩展 smoke attempt（2026-06-04）

已执行：

- 使用 `dist` 装载本地扩展，并打开 `chrome-extension://.../dashboard/index.html#dynamic-bill`。
- 在同一浏览器会话中打开 `https://www.bilibili.com/`。
- 在 Dashboard 点击“同步关注动态”。
- 仅通过页面上下文请求 `/x/web-interface/nav` 判断登录态；未读取、复制或导出 Cookie。

结果：

- `/x/web-interface/nav` 返回 `code=-101`，`isLogin=false`。
- Dashboard 最终显示“未登录”和“同步未完成：当前没有可用的 B 站登录态。”，页面未崩溃。
- 因当前会话未登录，未能完成登录态下的 `/x/polymer/web-dynamic/v1/feed/all?type=video` 验证。
- 因未进入登录态，本次无法确认 `DYNAMIC_TYPE_AV` / `MAJOR_TYPE_ARCHIVE` 的真实返回覆盖，也无法确认最近 7 天动态覆盖情况。

结论：

- 扩展装载与页面入口可用，但真实登录态 dynamic feed smoke test 仍阻塞在用户登录。
- 后续复跑时仍只记录汇总字段：接口 code、首屏 item 数、动态 type/major type 计数、最近 7 天 archive 数、最早/最新 archive 时间；不记录完整动态列表。

## 真实扩展登录态 smoke test（2026-06-04）

测试边界：

- 使用已装载的 `dist` 扩展，在 Dashboard 动态账单页点击“同步关注动态”。
- 只记录 API 和本地同步汇总字段。
- 未读取、复制或导出 Cookie。
- 未记录完整动态列表，未调用 AI，未上传观看历史或关注列表，未写回 B 站关注关系。

登录态 API 汇总：

| 字段 | 结果 |
| --- | --- |
| nav code / isLogin | `0 / true` |
| dynamic feed 首页 code | `0` |
| dynamic feed 首页 items | `20` |
| 首页 `DYNAMIC_TYPE_AV` 命中数 | `20` |
| 首页 `MAJOR_TYPE_ARCHIVE` 命中数 | `20` |
| 首页严格视频投稿命中数 | `20` |
| 首页最近 7 天严格视频投稿数 | `20` |

分页覆盖汇总：

| 字段 | 结果 |
| --- | --- |
| 探测页数 | `49` |
| 扫描 items | `980` |
| `DYNAMIC_TYPE_AV` 命中数 | `980` |
| `MAJOR_TYPE_ARCHIVE` 命中数 | `980` |
| 严格视频投稿命中数 | `980` |
| 最近 7 天严格视频投稿数 | `976` |
| 是否到达 7 天边界 | `true` |
| 最早严格视频投稿时间 | `2026-05-28 17:07:38 +08:00` |
| 最新严格视频投稿时间 | `2026-06-04 17:02:22 +08:00` |

实现修正：

- smoke 发现原 `DYNAMIC_FEED_MAX_PAGES=20` 只能同步到 `400` 条，未覆盖完整 7 天窗口。
- 已将 `DYNAMIC_FEED_MAX_PAGES` 调整为 `80`，保留安全上限；真实登录态复跑后同步池覆盖到 7 天边界。
- 详情补全改为先写入动态池，再限量、限时 best-effort 补全，避免 `/x/web-interface/view` 慢请求阻断同步完成。

Dashboard 同步结果：

| 字段 | 结果 |
| --- | --- |
| 同步状态 | `success / complete` |
| 最后成功同步时间 | `2026-06-04 17:24:34 +08:00` |
| 关注 UP 数 | `533` |
| 最近视频投稿数 | `976` |
| 本地投稿池最近 7 天覆盖 | `976 / 976` |
| 本地最早投稿时间 | `2026-05-28 17:29:53 +08:00` |
| 本地最新投稿时间 | `2026-06-04 17:20:01 +08:00` |
| 未登录状态 | 本轮登录态下未触发；前置未登录 smoke 已确认页面不崩溃并显示可解释状态。 |
| 失败状态 | 旧同步超时会被 stale recovery 转为失败并保留本地数据；本轮最终同步未失败。 |
| 空状态 | 同步池非空；三栏规则项仍为空，页面正确说明后续规则引擎生成。 |

结论：

- dynamic feed API-first 可用于 #4 正式同步。
- 客户端仍必须二次过滤 `DYNAMIC_TYPE_AV` / `MAJOR_TYPE_ARCHIVE` / `bvid`。
- 当前账号高动态量场景下，7 天窗口需要超过 20 页；正式实现使用 `80` 页安全上限。
- DOM fallback 本轮不需要。
