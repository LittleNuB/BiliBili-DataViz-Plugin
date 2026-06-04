# 动态账单 API Spike：关注关系

日期：2026-06-04

范围：验证动态账单 v1 是否可以 API-first 获取当前登录用户的关注 UP 列表和已关注时间。本文只记录只读 API spike，不实现正式同步功能，不调用 AI，不上传完整关注列表，不改写 B 站关注关系。

## 结论

关注列表 API-first 可进入正式实现；已关注时间需要谨慎建模。

`/x/relation/followings` 是主候选端点，预计可返回关注 UP 基础信息和 `mtime` 字段。`mtime` 可以作为“已关注时间”的候选字段，但当前环境没有登录态样本，不能把它无条件写成“原始首次关注时间”。正式实现应保存 `followedAt?: number` 和 `followAgeKnown: boolean`，并在字段缺失、为 0 或语义不稳时降级展示“已关注，关注时长未知”。

DOM fallback 不适合作为关注关系列表的常规方案。关注关系应优先 API 同步；若 API 无法确认 `mtime`，仍可用“关注关系存在但关注时长未知”支撑被淹没的关注栏目。

## 候选端点

当前登录用户：

```text
GET https://api.bilibili.com/x/web-interface/nav
```

关注列表：

```text
GET https://api.bilibili.com/x/relation/followings
```

建议参数：

```text
vmid=<当前登录用户 mid>
pn=<页码，从 1 开始>
ps=50
order=desc
order_type=attention
```

说明：

- `vmid` 来自现有 `fetchCurrentUserMid` 使用的 nav 接口。
- 关注列表需要登录 Cookie；无登录时返回 `code=-101`。
- 分页以 `pn/ps` 和返回的 `total/list.length` 判断。
- `ps` 建议先用 50，降低单页失败重试成本。
- 不调用任何 `/x/relation/modify`、取关、批量取关或分组写入接口。

## 本地探测记录

当前命令行环境未读取浏览器 Cookie。只做无登录探测，避免导出用户 Cookie 或关注数据。

探测结果：

| 端点 | 样本参数 | 结果 |
| --- | --- | --- |
| `/x/web-interface/nav` | 无 | `code=-101`, `message=账号未登录`, `data.isLogin=false` |
| `/x/relation/followings` | `vmid=2&pn=1&ps=5&order=desc&order_type=attention` | `code=-101`, `message=账号未登录` |

这确认关注关系不能无登录获取，也说明正式实现要把 `NOT_LOGGED_IN` 作为正常同步状态。当前环境没有做登录账号关注列表采样，因此 `mtime` 的字段单位和语义仍需登录态 smoke test 确认。

## Smoke test 记录（2026-06-04）

本轮 issue #4 开发前尝试做登录态 smoke test。Codex CLI 环境没有可复用的 B 站浏览器登录 Cookie；为避免导出或复制 Cookie，只执行不带 Cookie 的只读请求。

结果：

| 端点 | 参数 | 结果 |
| --- | --- | --- |
| `/x/web-interface/nav` | 无 | `code=-101`, `message=账号未登录`, `data.isLogin=false` |
| `/x/relation/followings` | `vmid=2&pn=1&ps=5&order=desc&order_type=attention` | `code=-101`, `message=账号未登录` |

结论：

- 未登录降级路径已确认，正式实现必须把 `NOT_LOGGED_IN` 显示成可解释状态。
- 当前环境未能确认登录态下关注列表分页、`total/list` 和 `mtime` 的真实字段表现。
- `mtime` 仍只能作为已关注时间候选字段；实现必须在缺失、为 0、未来时间或异常单位时记录 `followAgeKnown=false`。
- 后续在用户已登录 B 站并加载扩展后，需要再次点击动态账单同步按钮，确认 `mtime` 是否为秒级 Unix 时间戳，以及它在互关、特别关注、分组变化后的语义。

## 字段映射

建议字段：

| 本地字段 | API 字段候选 | 备注 |
| --- | --- | --- |
| `mid` | `item.mid` | UP 主 mid，主键。 |
| `name` | `item.uname` | 展示名。 |
| `face` | `item.face` | 头像。 |
| `sign` | `item.sign` | 个性签名，可为空。 |
| `followedAt` | `item.mtime` | 候选已关注时间，预期为秒级 Unix 时间戳。必须实测确认。 |
| `followAgeKnown` | `Boolean(item.mtime)` | `mtime` 缺失、0 或异常时为 false。 |
| `special` | `item.special` | 特别关注标记，只做解释辅助，不决定入选。 |
| `attribute` | `item.attribute` | 关系属性，只做 debug/兼容保留。 |
| `tagId` | `item.tagid` 或 `item.tag` | 分组相关，v1 不依赖。 |
| `syncedAt` | 本地时间 | 本地同步时间。 |

`mtime` 处理规则：

- 若为正整数，先按秒级 Unix 时间戳保存。
- 若明显是毫秒级，转换为秒或统一本地毫秒格式，但必须记录转换逻辑。
- 若缺失、为 0、晚于当前时间，或和响应语义不一致，保存 `followedAt=undefined`、`followAgeKnown=false`。
- 即使可用，也只作为 taste-memory 辅助信号，不单独决定账单项入选。

## 同步策略

建议流程：

1. 调用 `/x/web-interface/nav` 获取当前登录用户 `mid`。
2. 从 `pn=1` 开始拉 `/x/relation/followings`。
3. 每页只映射最小字段，不把完整响应传给 AI 或外部服务。
4. 根据 `total`、`list.length < ps` 或空页停止。
5. 对 `mid` upsert 本地 `followedCreators`。
6. 当前快照中缺失的历史关注对象不要直接删除；可在正式数据模型中增加 `lastSeenAt` 或 `missingInLatestSync`，避免一次失败误判。

建议安全上限：

- `ps=50`。
- `maxPages=200`，覆盖最多 10000 个关注关系。
- 每页复用现有 `biliGet` 限流；关注同步不需要高频运行。

## 失败和降级

| 场景 | 处理 |
| --- | --- |
| 未登录 `-101` | 返回 `NOT_LOGGED_IN`，Dashboard 展示“需要登录 B 站后同步”。 |
| 关注列表为空 | 区分真实 0 关注和 API 失败；只有 `code=0` 且 total/list 为空才展示空状态。 |
| `mtime` 不可用 | `followAgeKnown=false`，解释文案使用“已关注，关注时长未知”。 |
| 分页中断 | 保留上一份本地关注快照，展示本次同步失败和最后成功时间。 |
| 限流或 412 | 复用现有 backoff，降低同步频率。 |
| 关系字段语义变化 | 不影响 v1 最小闭环；被淹没的关注栏目降级为“稳定关注关系 + 近期缺席”。 |

## DOM fallback 评估

关注关系 DOM fallback 不建议进入 v1 主线。

原因：

- 关注页通常需要滚动和分页，完整性比动态 feed 更难保证。
- 页面展示的关注时间未必可见，常见 DOM 信息只能证明“关注关系存在”。
- DOM 采集完整关注列表更容易触碰隐私边界。

若必须 fallback，只允许做非常有限的人工辅助：

- 用户打开自己的关注页后，content script 读取当前可见 UP 的 `mid/name/face`。
- 不推断关注时间。
- 不自动滚完整列表。
- 不做任何取关、分组或关系写入。

关注时间不可用时，优先采用 API 降级语义，而不是 DOM fallback。

## 后续正式实现入口

建议新增：

```text
src/background/api/following.ts
```

核心方法：

```ts
fetchFollowingCreators(options: {
  maxPages: number;
  signal?: AbortSignal;
}): Promise<FollowedCreator[]>
```

实现要求：

- 复用 `fetchCurrentUserMid` 或抽出共享 nav helper。
- 复用 `biliGet`，不新建独立 fetch client。
- 只读 B 站 API。
- 不调用关注关系写接口。
- 不调用 AI。
- 不上传完整关注列表。
- 返回同步摘要：页数、关注数、`followAgeKnown` 数量、缺失 `mtime` 数量、失败原因。

## 仍需人工验证

后续 issue #4 开始前，需要在登录 B 站的扩展环境完成：

- `/x/relation/followings` 是否能返回当前登录用户完整关注列表。
- `total`、`pn/ps` 分页是否稳定。
- `mtime` 是否存在、是否为秒级 Unix 时间戳。
- `mtime` 在互关、特别关注、关注分组变化后是否仍代表首次关注时间。
- 隐藏关注列表或隐私设置是否影响“当前用户读取自己的关注列表”。
- 特别关注、分组字段是否会影响普通关注列表覆盖范围。

## 真实扩展 smoke attempt（2026-06-04）

已执行：

- 使用 `dist` 装载本地扩展，并打开 `chrome-extension://.../dashboard/index.html#dynamic-bill`。
- 在同一浏览器会话中打开 `https://www.bilibili.com/`。
- 在 Dashboard 点击“同步关注动态”。
- 仅通过页面上下文请求 `/x/web-interface/nav` 判断登录态；未读取、复制或导出 Cookie。

结果：

- `/x/web-interface/nav` 返回 `code=-101`，`isLogin=false`。
- Dashboard 最终显示“未登录”和“同步未完成：当前没有可用的 B 站登录态。”，页面未崩溃。
- 因当前会话未登录，未能完成登录态下的 `/x/relation/followings` 验证。
- 因未进入登录态，本次无法确认关注列表返回、`mtime` 是否存在、以及 `mtime` 是否为秒级 Unix 时间戳。

结论：

- 扩展装载与页面入口可用，但真实登录态 following smoke test 仍阻塞在用户登录。
- 后续复跑时仍只记录汇总字段：接口 code、total、首屏数量、`mtime` 存在性、字段类型、位数、是否落在合理秒级 Unix 时间范围；不记录完整关注列表。

## 真实扩展登录态 smoke test（2026-06-04）

测试边界：

- 使用已装载的 `dist` 扩展，在 Dashboard 动态账单页点击“同步关注动态”。
- 只记录 API 和本地同步汇总字段。
- 未读取、复制或导出 Cookie。
- 未记录完整关注列表，未调用 AI，未上传观看历史或关注列表，未写回 B 站关注关系。

登录态 API 汇总：

| 字段 | 结果 |
| --- | --- |
| nav code / isLogin | `0 / true` |
| `/x/relation/followings` code | `0` |
| reported total | `533` |
| 首页 list length | `20` |
| 首页 `mtime` 是否存在 | `20 / 20` 存在 |
| 首页 `mtime` 类型 | `number` |
| 首页 `mtime` 位数 | `10` |
| 首页 `mtime` 是否落在合理 Unix 秒级范围 | `20 / 20` 是 |

本地同步结果：

| 字段 | 结果 |
| --- | --- |
| 同步状态 | `success / complete` |
| 最后成功同步时间 | `2026-06-04 17:24:34 +08:00` |
| 关注快照总数 | `533` |
| active 关注 UP 数 | `533` |
| followAgeKnown / followAgeUnknown | `533 / 0` |

`mtime` 结论：

- 本轮真实登录态下，`mtime` 存在、类型为 `number`、10 位，落在合理 Unix 秒级时间范围。
- 本轮可将 `mtime` 作为“已关注时间候选字段”写入本地，`followAgeKnown=true`。
- 仍不把 `mtime` 语义写死为绝对可靠的首次关注时间；字段缺失、异常、未来时间或非正值时继续降级为 `followAgeKnown=false`，不展示虚假时长。

结论：

- 关注关系 API-first 可用于 #4 正式同步。
- DOM fallback 本轮不需要。
