# `@loom-studio/diagnostics`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/diagnostics` 是 Loom Studio 平台级的运行时诊断与错误收集注册表。它为内核管道、扩展系统、文档校验与运行时环境提供统一的非阻塞告警与诊断跟踪能力。

## 业务使命与多维过滤

在复杂系统的运行过程中，除了致命异常会中断流程外，还存在大量非致命的编译警告、类型提示、扩展兼容性降级以及废弃字段提示。
`@loom-studio/diagnostics` 提供集中式的诊断聚合中心：
- **统一诊断结构 (`Diagnostic`)**：包含唯一 ID、级别（`error` / `warning` / `info`）、标准化错误码（Code）、消息描述、发生来源（Source）、关联调用链路（`correlationId` / `callId`）以及上下文详情；
- **多维归属过滤**：支持按 `severity`、`source`、`packageId`、`moduleId`、`extensionId` 与 `instanceId` 进行精准结构化过滤；
- **Kernel 集成**：由 Kernel 平台在启动时注入，向外暴露 `diagnostics.list` RPC 接口供前端监控与排查。
- **有界聚合**：最多保留 1,000 条，同一 `source + packageId + extensionId` 最多 100 条，超出时移除该范围内最久未更新的一条；列表按最后记录顺序返回。
- 同一来源、模块、实例、文档、级别、错误码及显式 ID 聚合。`createdAt`/`id` 保留首次身份，`occurrences` 记录当前保留周期内次数，`lastSeenAt` 和正文、关联 ID、details 更新到最近一次。动态消息不建立新的故障身份；调用方需要区分同类故障时提供稳定 ID，Kernel 订阅错误使用订阅与事件身份。
- 未进入 Registry 的普通 `Diagnostic` 可以没有聚合统计；`clear()` 同时清空记录与统计。计数上限不是 payload 字节预算，不用于保存任意体积的完整历史。

---

## 架构规约与非阻塞红线 (Rules & Boundaries)

1. **绝对非阻塞（Non-Blocking Observation）**：
   - 记录诊断信息**严禁抛出未捕获异常或阻塞主执行流**；
   - 诊断收集器是纯内存结构，不直接进行同步磁盘 I/O。
2. **职责清晰划分**：
   - 本包只负责当前的诊断状态收集；
   - 编译轨迹的完整回放归 `@loom-studio/trace-audit`；持久化文本日志归 `@loom-studio/logging`。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createInMemoryDiagnosticsRegistry()`：创建内存诊断注册表实例；
- 核心操作方法：`list(filter)`、`add(diagnostic)`、`clear()`；
- 核心类型：`DiagnosticsRegistry`、`Diagnostic`、`DiagnosticSeverity`、`DiagnosticFilter`、`DiagnosticInput`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/diagnostics build

# 运行平台级诊断单元测试与集成测试
pnpm exec vitest run tests/unit/diagnostics/diagnostics.test.ts tests/integration/platform/document-trace-diagnostics.test.ts
```

---

## 正式文档

- [Kernel 平台架构说明](../../docs/architecture/kernel/README.md)
