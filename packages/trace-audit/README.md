# `@loom-studio/trace-audit`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/trace-audit` 是 Loom Studio 的编译执行轨迹（Trace）与安全审计（Audit）存储层。它为编译器管道快照、回溯调试与系统关键操作审计提供不可变的记录能力。

## 业务使命与双轨记录模型

在复杂的提示词编译管线中，为了能够完全可视化展示每一道 Pass 是如何修改 Fragment、注入内容与调整深度的，系统需要保存完整的执行快照。
`@loom-studio/trace-audit` 提供清晰的双轨存储支持：
- **Trace 轨迹记录 (`appendTrace`)**：
  - 接收并持久化 `@loom/core` 运行产出的完整 Trace 对象（包含各 Pass 阶段的 Fragment 树快照与耗时）；
  - 为可视化 Inspector 与调试工作台提供可回溯的数据支撑；
- **Audit 审计日志 (`appendAudit`)**：
  - 记录具有安全与管理意义的关键系统操作（如扩展安装、凭据清理、管理员重置等）；
  - 记录精确时间戳与操作细节，保障审计合规性。

---

## 架构规约与防篡改约束 (Rules & Boundaries)

1. **只追加与防篡改（Append-Only & Immutability）**：
   - 轨迹与审计记录**严格只增不减**，内部查询自动通过深拷贝返回，严禁外部调用直接篡改内部记录状态；
2. **区别于常规运行日志**：
   - 本包存储的是**结构化执行快照与审计事实**；
   - 常规文本运行排查、Debug 信息输出统一走 `@loom-studio/logging`，禁止把临时调试文字写入审计存储。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createInMemoryTraceAuditStore()`：创建内存轨迹与审计存储实例；
- 核心操作方法：`appendTrace()`、`listTraces()`、`appendAudit()`、`listAudit()`；
- 核心类型：`TraceAuditStore`、`TraceRecord`、`AuditRecord`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/trace-audit build

# 运行轨迹与审计集成测试
pnpm exec vitest run tests/integration/platform/document-trace-diagnostics.test.ts
```

---

## 正式文档

- [Kernel 平台架构说明](../../docs/architecture/kernel/README.md)
- [Loom Core 编译轨迹说明](../../docs/architecture/application/prompt-build/loom-core/README.md)
