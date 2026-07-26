# 架构债务清单 v0

> **状态**：Open Issues
> **最后核对**：2026-07-23
> **适用范围**：packages、Studio Server 与公开平台能力

本文只保留当前代码中仍未解决的结构问题。通用架构规则已经迁入 `docs/guide/architecture-rules.md`，不再在 Issue 中复制一套长期规范。

## 已从旧议题关闭或迁出

- package 引用方向与 Runtime / Server 约束已进入 Guide；
- Studio RPC 已有带 owner、namespace、stability 的 capability 描述；
- Client、Application、Renderer、Logs RPC 已通过 `studio-rpc-router.ts` 统一路由；
- Application Runtime 的大规模拆分已单独进入 `docs/workbench/plans/application-runtime-modularization-plan.md`。

旧版的大段推荐目录、事件命名教程和 Review Checklist 已删除，避免与 Guide 双重维护。

## P1：文件边界过宽

### 1. `packages/kernel/src/index.ts`

当前约 555 行，同时包含：

- public surface 与类型；
- Event Bus；
- RPC Registry；
- Kernel 生命周期与内建 RPC；
- Document / Loom 参数解码和结果摘要。

问题不是单纯行数，而是入口、基础设施和具体 handler 已混在一个文件。后续应优先抽出低耦合的 Event Bus 或参数 decoder；`index.ts` 最终只保留公开导出与组合入口。不要引入 Kernel class hierarchy。

### 2. `packages/extension-sdk/extension-host/src/index.ts`

当前约 360 行，同时包含 host 类型、manifest 读取与校验、模块加载、激活/清理、Context 构造和诊断上报。下一次修改 manifest 或加载生命周期时，应按真实变更点拆出对应模块；不为凑行数预拆空目录。

### 3. `apps/studio-server/src/application-rpc.ts`

当前约 732 行，前半部分是 RPC dispatcher，后半部分是大量 Application DTO decoder，尤其 Prompt Workspace / Projection 输入校验。建议先把 decoder 移到单一相邻文件，dispatcher 保留 method 到 Runtime 调用的显式映射。

### 4. `packages/logging/src/node.ts`

文件实际只实现 JSONL 文件 sink、轮转和清理，`node.ts` 名称过宽。若 Node 端新增第二种能力，应将现有实现改名为 `jsonl-file-sink.ts`，并让 `node.ts` 仅作为入口；在此之前不增加一层转发文件。

## P1：能力发现仍有两个入口

Kernel / Extension 能力通过 `system.introspect` 暴露，Studio Application / Renderer / Logs 能力通过 `studio.rpc.listCapabilities` 暴露。统一路由已经完成，但“单一发现面”尚未完成。

关闭条件：客户端不需要预先知道该查哪个入口，就能发现 Kernel、Extension、Application、Renderer 和 Logs 能力；同时保留明确 owner。

## P2：Event Catalog 仍是字符串集合

Kernel 当前通过 `knownEvents` 收集事件名，但没有统一记录 owner、类型、版本、delivery 和 retention。MVP 阶段不需要先造完整 schema registry；新增跨进程事件或正式订阅协议前，再把现有字符串集合升级为最小 Event Catalog。

## 独立计划

Application Runtime 的 God Object 风险不在本文重复展开，统一跟踪：

- `docs/workbench/plans/application-runtime-modularization-plan.md`

在领域分类与命名确认前，不直接移动 `runtime.ts` 中的大块代码。
