# `@loom-studio/loom-runner`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/loom-runner` 是面向 Kernel RPC 与外部调用的 `@loom/core` 运行适配器。它负责序列化 JSON 输入校验、Pass 工厂注入、诊断（Diagnostics）格式转换与运行轨迹（Trace）的持久化对接。

## 业务使命与适配器定位

`@loom/core` 作为纯粹的同步编译内核，不包含任何外围的 RPC 协议解析、错误聚合或持久化逻辑。
`@loom-studio/loom-runner` 充当两者的安全转接桥：
- **边界输入校验**：严格校验传入的 `fragments` 与 `passes` 的 JSON 形状；
- **PassRegistry 组装**：允许注入扩展提供的自定义 Pass 工厂；
- **平台诊断桥接**：将 Core 输出的诊断信息规范化为平台标准的 `Diagnostic` 实体并分派错误码；
- **Trace 审计转存**：在开启 `trace` 选项时，将 Core 生成的完整 AST/执行快照写入 `@loom-studio/trace-audit`。

---

## 架构规约与隔离红线 (Rules & Boundaries)

1. **充当 Core 与平台的单向防腐层**：
   - 保证 Kernel 和 RPC 层无需直接依赖 `@loom/core` 的内部类型，保持平台协调层与编译内核解耦；
2. **纯适配器定位**：
   - 本包**严禁自行实现业务级提示词编译规则、Card 逻辑或模型调用**；它只忠实地执行传入的 Pass 流水线。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createLoomRunner(options)`：创建 Runner 实例（可注入 `traceAudit` 与 `factories`）；
- `createSamplePassFactories()`：提供基准示例 Pass（`noop`、`uppercase` 等）；
- 核心类型：`LoomRunner`、`LoomRunInput`、`LoomRunResult`、`LoomRunnerOptions`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/loom-runner build

# 运行 Pass 执行与适配单元测试
pnpm exec vitest run tests/unit/loom-runner
```

---

## 正式文档

- [Loom Core 平台集成说明](../../docs/architecture/application/prompt-build/loom-core/studio-integration.md)
- [Kernel 平台架构](../../docs/architecture/kernel/README.md)
