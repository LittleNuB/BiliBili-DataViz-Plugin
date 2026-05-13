# BiliBili DataViz Plugin

B站个人消费数据中心 — Chrome 扩展，聚合你的B站观看行为数据，提供可读、可分析、可指导行为的个人消费报告。

## 功能

- **消费总览** — 观看时长、活跃时段热力图、消费效率分
- **内容偏好分析** — 分区分布树图、兴趣漂移追踪、标签词云
- **UP主关系图谱** — TOP 10 排行、深度绑定检测、过度依赖预警
- **行为模式诊断** — 完播率分布、跳片分析、Session 模式
- **实验与建议** — "如果...会怎样"模拟器、每周优化建议、兴趣盲盒

## 技术栈

Preact + TypeScript + ECharts + Dexie.js + Vite

## 开发

```bash
pnpm install
pnpm dev    # watch 模式
pnpm build  # 生产构建
```

## 安装

1. `pnpm build`
2. Chrome → 扩展程序 → 加载已解压的扩展程序 → 选择 `dist/` 目录

## 文档

- [产品需求文档 (PRD)](docs/PRD.md)
