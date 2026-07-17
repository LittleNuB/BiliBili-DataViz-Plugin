# 视频盲盒真实候选源 API Spike

日期：2026-06-19；分区端点复核：2026-07-17

范围：验证视频盲盒 v2 是否可以安全接入真实 B 站公开视频候选源，支撑「随机探索」和「换口味」候选池。本文只记录只读 API/source spike，不实现盲盒候选池业务逻辑，不改 Dashboard 或实验页 UI，不新增 DB schema、message action 或 AI 调用。

## 结论

真实候选池可行，但第一批 MVP 应保守选择来源：

- 「随机探索」建议优先使用相关视频候选：`/x/web-interface/archive/related`。无登录 smoke 成功返回真实公开视频候选，字段包含 `bvid/aid/cid/owner/pic/pubdate/duration/stat` 等可映射字段，可构造 B 站视频页链接。它适合从当前视频或近期看过的视频扩展一个真实候选池，但不应用于证明“换口味”，避免强化近期口味。
- 「跨区漫游」使用分区新视频：`/x/web-interface/newlist`。2026-07-17 无 Cookie smoke 对固定目录 RID 4 和 36 均返回 `code=0`、`data.archives=10`，首项具有 `bvid/title/owner/duration/pubdate/tname`。同日复核确认旧 `/x/web-interface/dynamic/region` 已返回 HTTP 200、`code=-404`、`data=null`，只保留为失效历史记录，不再作为现行来源。
- 搜索结果暂缓进入 MVP。`/x/web-interface/search/type` 在命令行无 Cookie smoke 中返回 HTTP 412，且结果受平台搜索排序影响。它可以作为后续补充来源，但第一版不要把搜索结果包装成 Bili-Bill 自己的排序能力。
- UP 空间投稿暂缓进入 MVP 主路径。旧空间投稿端点在无登录 smoke 中返回 `code=-799`，需要 WBI 或扩展 runtime 登录态进一步验证；同时从已关注 UP 新投稿抽取容易和动态账单边界重叠。后续可作为「来源清楚的随机探索」补充池。

现有视频盲盒不足以满足 v2 的原因是候选只来自本地 `watchHistory`、`favorites` 和智能收藏路径。这样可以解释本地证据，但无法发现用户本地库之外的公开视频；「随机探索」仍像本地库存抽卡，「换口味」也只能在已收藏或已看过的视频里做反差。

## 隐私和运行边界

本 spike 遵守以下边界：

- 未读取、复制或记录 Cookie 文件、浏览器 profile、Bilibili 登录态文件或本地 key 文件。
- 未读取 `C:\Users\LittleNub\Desktop\Key.txt`。
- 未写回 B 站；未调用关注、收藏、评论、点赞、投币等写接口。
- 未上传完整历史、完整收藏、完整关注或 feedback。
- endpoint smoke 只记录聚合字段、响应 shape、状态码、候选数量和是否存在 `bvid`，不记录完整候选列表或账号数据。
- 后续实现应继续复用 `src/background/api/client.ts` 的 `biliGet`、统一限流、超时、`credentials: include` 和 WBI fallback，不新建绕过限流的 fetch client。

## 本地无 Cookie smoke 记录

当前命令行环境没有读取浏览器 Cookie，也没有复用浏览器登录态。只做无 Cookie 的只读请求。

| 来源 | 样本参数 | 结果 | 说明 |
| --- | --- | --- | --- |
| 相关视频 | `/x/web-interface/archive/related?bvid=<公开 BV>` | `code=0`, `items=40`, 首项含 `bvid` | 可作为「随机探索」真实候选源。 |
| 分区新视频（旧端点复核） | `/x/web-interface/dynamic/region?rid=4&pn=1&ps=10` | HTTP 200、`code=-404`、`data=null` | 2026-07-17 已复核失效，不再使用。 |
| 分区新视频（现行端点） | `/x/web-interface/newlist?rid=4&pn=1&ps=10` 与 `/x/web-interface/newlist?rid=36&pn=1&ps=10` | 两个 RID 均为 `code=0`、`data.archives=10`；首项六个必要字段均存在 | 可作为「跨区漫游」真实候选源；smoke 未记录候选身份。 |
| 搜索结果 | `/x/web-interface/search/type?search_type=video&keyword=<词>&page=1&page_size=10&order=pubdate` | HTTP `412` | 命令行无 Cookie 形态不稳定，先暂缓。 |
| UP 空间投稿 | `/x/space/arc/search?mid=2&pn=1&ps=10&order=pubdate` | `code=-799`, `message=请求过于频繁，请稍后再试` | 需要 WBI 或 runtime smoke，先暂缓。 |

打开链接可用性记录：

- 两个成功来源都返回 `bvid`，可构造现有代码已使用的规范播放页：`https://www.bilibili.com/video/{bvid}`。
- smoke 未保存具体候选 `bvid` 或标题。后续 #138/#139 实现前，应在扩展 runtime 中对抽样候选做一次浏览器打开 smoke，只记录打开成功数、失败数和失败原因，不记录完整候选列表。

## 来源一：相关视频

候选端点：

```text
GET https://api.bilibili.com/x/web-interface/archive/related
```

建议参数：

```text
bvid=<当前视频或近期观看视频的 BV 号>
```

适用判断：

- 进入 MVP：是，优先用于「随机探索」。
- 不建议作为「换口味」默认来源，因为种子视频通常来自当前或近期观看，容易把候选带回近期高频口味。
- 可作为「换口味」的补充来源，仅当种子视频来自长期兴趣且近期冷却方向时使用。

字段记录：

| 本地候选字段 | API 字段候选 | 备注 |
| --- | --- | --- |
| `bvid` | `item.bvid` | 必填，用于打开播放页和去重。 |
| `avid` | `item.aid` | 可选补充。 |
| `cid` | `item.cid` | 可选补充。 |
| `title` | `item.title` | 展示用，必须清洗空值。 |
| `authorMid` | `item.owner.mid` | 只做候选来源说明和去重，不上传。 |
| `authorName` | `item.owner.name` | 展示用。 |
| `cover` | `item.pic` 或 `item.cover43` | 展示用。 |
| `duration` | `item.duration` | 秒级时长候选。 |
| `pubtime` | `item.pubdate` 或 `item.ctime` | 秒级时间戳。 |
| `tagName` | `item.tname`、`pid_name_v2` 或详情补全 | 可能缺失；换口味需要补全时用 `/x/web-interface/view`。 |
| `sourceLabel` | 固定为相关视频候选 | 用户可见来源应写清楚，不写成平台推荐。 |

分页：

- 该端点本轮返回固定数组形态，没有分页参数。
- MVP 应把单个种子的视频候选视为一页，最多选取前 N 条结构完整候选，再随机抽取。
- 为扩大候选池，可使用少量种子视频，例如当前视频、最近本地历史里 3 到 5 条公开 BV；不要上传完整历史，只在本地逐个请求。

登录态：

- 无 Cookie smoke 成功，适合未登录或 clean-profile 降级。
- 扩展 runtime 可继续通过 `biliGet` 发送 `credentials: include`，但不依赖登录态。

失败状态：

| 场景 | 处理 |
| --- | --- |
| `bvid` 缺失或种子视频不可用 | 跳过该种子，尝试下一个有限种子；全部失败时显示候选源暂不可用。 |
| `code` 非 0 | 记录来源失败原因，不阻断其他来源。 |
| 返回空数组 | 候选池为空，降级到其他已验证来源或本地盲盒说明。 |
| 字段缺失 | 丢弃缺少 `bvid` 的候选；标题、封面、分区可 best-effort 补全。 |

限流风险：

- 风险中等。若对多个种子并发请求，容易放大请求量。
- MVP 建议低频、用户触发、串行或小并发，复用现有 `apiRateLimiter`。
- 每次开盒不应扫描大量历史；建议最多 3 到 5 个种子、每个种子最多保留 20 到 40 条候选。

打开链接可用性：

- 成功返回 `bvid`，可构造 `https://www.bilibili.com/video/{bvid}`。
- 候选入池前应验证 `bvid` 非空且符合 BV 格式；不需要保存 raw URL。

## 来源二：UP 空间投稿

候选端点：

```text
GET https://api.bilibili.com/x/space/wbi/arc/search
```

旧端点 smoke：

```text
GET https://api.bilibili.com/x/space/arc/search
```

建议参数：

```text
mid=<UP mid>
pn=<页码，从 1 开始>
ps=30
order=pubdate
tid=0
```

适用判断：

- 进入 MVP：暂缓。
- 原因：无 Cookie 旧端点 smoke 返回 `-799`，需要 WBI 或扩展 runtime 再验证；从已关注 UP 新投稿抽取也容易和动态账单的「已关注新投稿」边界重叠。
- 后续可作为「随机探索」补充池，尤其适合从一个已确认公开 UP 的空间投稿中随机抽取。

字段记录：

| 本地候选字段 | API 字段候选 | 备注 |
| --- | --- | --- |
| `bvid` | `item.bvid` | 必填。 |
| `avid` | `item.aid` | 可选。 |
| `title` | `item.title` | 展示用。 |
| `authorMid` | 请求参数 `mid` 或返回字段 | 来源说明用。 |
| `authorName` | 返回 `author`、`owner.name` 或本地 UP 快照 | 可能需要从已同步关注快照补全。 |
| `cover` | `item.pic` | 展示用。 |
| `duration` | `item.length` | 可能是文本，需要转换。 |
| `pubtime` | `item.created` | 秒级时间戳候选。 |
| `playCount` | `item.play` | 只可作为 debug，不参与 Bili-Bill 候选排序。 |

分页：

- 预期 `pn/ps` 分页，响应里通常有 `page.count` 或列表长度。
- MVP 若启用，建议每个 UP 最多 1 到 2 页，避免把空间归档扫描变成完整投稿抓取。
- 不要自动遍历用户完整关注列表；只允许从本地规则选出的少量 UP 种子请求。

登录态：

- 公开空间理论上可无登录读取公开视频，但本轮旧端点无登录命令行 smoke 被 `-799` 限制。
- 建议正式实现优先走 WBI 签名端点，并复用 `biliGet(..., withWbi=true)` 或现有 WBI fallback。

失败状态：

| 场景 | 处理 |
| --- | --- |
| `-799` 或请求过于频繁 | 降级，不进入当前候选池；提示来源暂不可用。 |
| `-352/-403/-400` 等签名或风控错误 | 走 WBI fallback；仍失败则记录来源失败。 |
| UP 空间隐藏或无公开投稿 | 返回空候选，不当作用户错误。 |
| 字段不完整 | 缺 `bvid` 丢弃；缺作者名用本地 UP 快照补全。 |

限流风险：

- 风险较高。空间投稿端点容易触发频率限制或 WBI 要求。
- 若后续启用，必须严格限制 UP 种子数量、页数和触发频率。

打开链接可用性：

- 只要候选有 `bvid`，仍使用规范播放页。
- 因本轮未成功拿到候选，MVP 前必须补一个 runtime smoke。

## 来源三：搜索结果

候选端点：

```text
GET https://api.bilibili.com/x/web-interface/search/type
```

建议参数：

```text
search_type=video
keyword=<长期兴趣关键词、标签或分区词>
page=<页码，从 1 开始>
page_size=20
order=pubdate
```

适用判断：

- 进入 MVP：暂缓。
- 搜索适合「换口味」外延，但本轮无 Cookie smoke 返回 HTTP 412，且搜索结果天然受平台搜索排序影响。
- 后续可以作为分区新视频不足时的补充来源，用户可见文案必须写成“来自 B 站搜索结果候选”，不能写成 Bili-Bill 排序。

字段记录：

| 本地候选字段 | API 字段候选 | 备注 |
| --- | --- | --- |
| `bvid` | `item.bvid` 或 `item.param` | 必填；部分字段可能需要格式清洗。 |
| `avid` | `item.aid` | 可选。 |
| `title` | `item.title` | 可能含高亮 HTML，必须清洗。 |
| `authorName` | `item.author` | 展示用。 |
| `authorMid` | `item.mid` | 可选。 |
| `cover` | `item.pic` | 可能是 protocol-relative URL。 |
| `duration` | `item.duration` | 常见为文本，需要转换。 |
| `pubtime` | `item.pubdate` | 秒级时间戳候选。 |
| `tagName` | 查询词或详情补全 | 不能把查询词当作视频真实分区。 |

分页：

- 预期 `page/page_size` 分页。
- 搜索结果可能有 `numPages` 或 total 相关字段，但 MVP 前需要 runtime smoke 确认。
- 即使后续启用，也应只取前 1 到 3 页作为候选池，然后在 Bili-Bill 侧随机抽取，不保留平台排序语义。

登录态：

- 不应依赖登录态，但命令行无 Cookie 形态本轮返回 412。
- 扩展 runtime 可能因 referer、WBI 或 Cookie 状态不同而成功；需要后续验证。

失败状态：

| 场景 | 处理 |
| --- | --- |
| HTTP 412 | 视为限流或访问受限，降级到分区新视频。 |
| 返回空结果 | 换一个长期兴趣词或回退分区新视频。 |
| 标题含 HTML 高亮 | 清洗后展示，禁止把 raw HTML 暴露到 UI。 |
| 候选质量差 | 不做自动质量承诺；只说明来源和查询词。 |

限流风险：

- 风险中高。搜索端点比分区和相关视频更容易触发访问限制。
- 不建议作为第一批主来源。

打开链接可用性：

- 理论上可由 `bvid` 或 `arcurl` 打开。
- 因本轮 smoke 未成功返回候选，MVP 前必须补 runtime smoke。

## 来源四：分区新视频

候选端点：

```text
GET https://api.bilibili.com/x/web-interface/newlist
```

旧 `/x/web-interface/dynamic/region` 仅作为历史失效记录：2026-07-17 对 `rid=4&pn=1&ps=10` 复核时为 HTTP 200、`code=-404`、`data=null`，不得再接入运行时。

建议参数：

```text
rid=<B 站分区 tid>
pn=<页码，从 1 开始>
ps=20
```

适用判断：

- 进入 0.13：是，用于「跨区漫游」。
- 使用方式：按最近最多 7 天有效观看排除 top-3 高频分区；没有近期分区证据时从固定目录等概率选一个 `rid`，再从该分区新视频中抽取真实候选。
- 来源边界：只服务「跨区漫游」，不作为「随机探索」或其它盲盒的补位来源。

字段记录：

| 本地候选字段 | API 字段候选 | 备注 |
| --- | --- | --- |
| `bvid` | `item.bvid` | 必填。 |
| `avid` | `item.aid` | 可选。 |
| `cid` | `item.cid` | 可选。 |
| `title` | `item.title` | 必填；清洗后为空便丢弃，不用视频身份补标题。 |
| `authorMid` | `item.owner.mid` | 来源说明和去重用。 |
| `authorName` | `item.owner.name` | 展示用。 |
| `cover` | `item.pic` 或 `item.first_frame` | 展示用。 |
| `duration` | `item.duration` | 秒级时长候选。 |
| `pubtime` | `item.pubdate` 或 `item.ctime` | 秒级时间戳。 |
| `tagName` | `item.tname` 或固定 `rid` 映射名 | 用于说明本轮公开分区。 |
| `sourceLabel` | `分区新视频 / <分区名>` | 用户可见来源。 |

分页：

- `pn/ps` 分页；2026-07-17 对 RID 4 和 36 的 `pn=1&ps=10` 无 Cookie smoke 均成功。
- 0.13 每次只请求已选分区的有限分页，优先用户触发时刷新。
- 不扫描全部分区，也不因当前分区空池而请求其它盲盒来源。

登录态：

- 2026-07-17 无 Cookie smoke 成功，不依赖登录态；扩展 runtime 仍复用 `biliGet`。

失败状态：

| 场景 | 处理 |
| --- | --- |
| `rid` 不在固定目录 | 不发出分区候选请求，显示本轮没有可用公开分区。 |
| `code` 非 0 或 HTTP 失败 | 显示本轮分区候选空态，不改用历史、收藏、相关视频或其它盲盒来源。 |
| 返回空 `data.archives` | 显示本轮分区候选空态，保留已选分区说明，不自动换来源。 |
| 字段缺失 | 缺 `bvid` 或清洗后的非空 `title` 便丢弃；禁止把视频身份当作标题。分区名可使用固定 RID 映射说明。 |

限流风险：

- 风险低到中；2026-07-17 两个固定 RID 的无 Cookie smoke 成功，但端点仍按可漂移的公开依赖处理。
- 仍应复用全局限流，限制分区数量和页数，避免每次开盒扫描全部分区。

打开链接可用性：

- 成功返回 `bvid`，可构造 `https://www.bilibili.com/video/{bvid}`。
- 候选入池前同时校验 BV 格式和非空标题。

## MVP 候选策略建议

### #138 随机探索真实候选池

第一版建议：

1. 从当前视频或近期少量本地历史视频取公开 `bvid` 作为种子。
2. 请求相关视频候选。
3. 过滤缺 `bvid`、近期已打开、已在本页其他盲盒使用过的候选。
4. 从剩余透明候选池中随机抽取。
5. UI 来源写成“相关视频候选”或“来自公开相关视频池”，并明确 Bili-Bill 只是随机抽取。

暂不建议第一版接入：

- 搜索结果：本轮 412，且平台搜索排序语义更强。
- UP 空间投稿：本轮 `-799`，需要 WBI/runtime smoke。

### #139 换口味真实候选池

第一版建议：

1. 复用本地长期观看窗口和近期观看窗口，找长期高、近期低的分区或标签。
2. 建立保守的本地标签到 B 站 `rid` 映射；无法映射时不硬生成。
3. 请求分区新视频候选。
4. 排除近期高频分区、近期看过的同视频、缺 `bvid` 的候选。
5. 在候选池内随机抽取，并展示“长期兴趣冷却 + 真实分区新视频”的解释。

暂不建议第一版接入：

- 相关视频作为默认来源：容易跟随近期种子，削弱「换口味」解释。
- 搜索结果：需要 runtime smoke 后再作为补充来源。
- UP 空间投稿：更像动态账单或关注关系探索，边界需再拆。

## 不进入 MVP 的来源和原因

| 来源 | 暂缓原因 | 后续进入条件 |
| --- | --- | --- |
| 搜索结果 | 本轮无 Cookie smoke 返回 412；结果受平台搜索排序影响，产品解释风险高。 | 扩展 runtime smoke 成功；只把它写成搜索候选池；不保留平台排序语义。 |
| UP 空间投稿 | 旧端点返回 `-799`；可能需要 WBI；从已关注 UP 新投稿抽取会和动态账单重叠。 | WBI/runtime smoke 成功；只选少量 UP 种子；明确和动态账单边界。 |
| 完整关注动态 feed | 已属于动态账单的数据源，不适合作为视频盲盒主来源。 | 仅作为“已关注新投稿”的账单入口，不并入盲盒 v2 MVP。 |
| 本地收藏/历史单独抽取 | 已是 v1 能力，不能解决真实探索问题。 | 继续保留为冷门收藏或本地 fallback，不冒充真实候选源。 |

## 后续正式实现入口

建议后续开发新增独立候选源模块，例如：

```text
src/background/api/video-blind-box-candidates.ts
```

候选函数可以按来源拆开：

```ts
fetchRelatedVideoCandidates(seedBvids, options)
fetchRegionVideoCandidates(regionIds, options)
fetchSearchVideoCandidates(keywords, options)
fetchUpSpaceVideoCandidates(authorMids, options)
```

实现要求：

- 复用 `biliGet`、`apiRateLimiter` 和现有 `batchFetchVideoInfo` 补全策略。
- 返回候选摘要和 source summary，不返回完整 raw response 给 UI。
- 不新增 AI 调用。
- 不上传完整历史、完整收藏、完整关注或 feedback。
- 候选入池只保留公开视频必要字段：`bvid/title/authorName/cover/duration/pubtime/tagName/sourceLabel`。
- 所有候选来源都要有 `sourceKind` 和 `sourceLabel`，用于用户理解候选池来源。
- 候选失败时返回可解释状态，不显示空卡。

## 仍需人工或 runtime 验证

- 扩展 runtime 中相关视频和分区新视频是否在已登录、未登录、clean-profile 三种状态都稳定。
- 抽样候选的播放页打开成功数和失败数。
- 分区 `rid` 映射是否覆盖当前本地长期兴趣标签。
- 搜索端点在扩展 runtime 是否仍返回 412。
- UP 空间 WBI 端点是否可稳定读取公开视频投稿。
- 是否需要盲盒历史，避免短时间重复抽到同一视频。
