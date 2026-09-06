# B1 历史基线验证

关联任务：[#275](https://github.com/LittleNuB/BiliBili-DataViz-Plugin/issues/275)。

## 裁决与边界

经用户确认，CI 将历史 B1 收据验证与当前代码验证分开。历史收据证明其记录的提交及构建产物，不证明后续 UI 或其他代码改动的性能。此次调整不替换四份收据，不修改性能阈值，不重跑 360-run 矩阵，也不改变 A2 或其他产品门禁结论。

`npm run gate014:b1:verify` 保持原有严格语义：当前源码、lockfile、构建产物必须与收据绑定一致。在 UI 已变更的 checkout 中，该命令仍可能正确拒绝旧收据。不得将这种拒绝改写为当前性能通过。

## 验证流程

```sh
node scripts/verify-gate-014-b1-history.mjs
```

1. 读取当前 HEAD 提交的环境、原始操作、报告、摘要四份收据，并要求工作区字节与提交完全一致。
2. 要求环境收据中的提交是完整 Git SHA，存在于本地且是当前 HEAD 的祖先。CI 保留完整历史获取。
3. 在当前 checkout 的忽略目录 `release-artifacts/b1-history-*/checkout` 创建本地临时克隆，检出该历史提交。不切换调用方 HEAD、不改调用方索引或其他 worktree。
4. 将当前 PR 的四份收据原样放入历史 checkout。测量提交可能早于报告发布，不能退回验证历史 checkout 自带的旧报告。
5. 依照历史 lockfile 执行 `npm ci` 与构建，再调用该提交的原始严格验证器，检查源码、构建、fixture 绑定和所有操作收据。
6. 再次检查调用方 HEAD、四份收据及临时副本未改变。仅删除经过绝对路径与所属目录检查的自有临时目录。清理失败同样不得返回通过。

安装、构建、绑定校验、收据校验任一失败均使命令失败。该流程只处理仓库与合成证据，不采集浏览器或个人数据；不读取 npm debug logs。历史安装依赖可用的 npm registry，网络失败需明确报告，不能跳过构建。

## 结果语义

- `status=pass`：历史产物核验完成。
- `verificationScope=historical_snapshot`：核验对象是记录的历史提交。
- `historicalGateStatus`：原始验证器计算出的历史性能结论，保留 `pass`、`fail` 或 `insufficient_evidence`，不强制转为通过。
- `historicalArtifactBindingsVerified=true`：绑定只针对历史 checkout。
- `currentPerformanceGateStatus=not_evaluated`：没有测量当前代码性能。
- 提交 SHA、环境收据哈希与四文件 bundle 哈希用于识别本次验证对象。

当前 PR 的测试、类型检查、构建、打包与其他既有验证继续由 CI 的 `validate` 和 fixture job 执行。历史 B1 job 不取代它们。涉及实际性能行为的后续改动仍需按对应产品门禁补充当前测量证据，不能引用历史通过自动放行。

## 维护检查

```sh
node --test tests/gate-014-b1-history.test.ts tests/gate-014-b1-matrix-runner.test.ts
npm run typecheck
npm run build
git diff --check
```

新增测试覆盖历史祖先约束、未提交收据拒绝、原始失败结论保留、当前收据覆盖历史报告、无关 UI 变更、各阶段失败、核验期间变动与临时目录清理边界。合并或正式发布仍需单独授权。
