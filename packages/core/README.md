# `@loom/core`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom/core` 是 Loom Studio 的核心编译内核管道。它负责纯同步、确定性的 `Fragment`、`Pass`、`Pipeline` 与 `Trace` 执行流程，为 PromptBuild 与文本转换提供工业级的流水线处理能力。

## 业务使命与心智模型

在复杂的 AI Native 交互叙事中，提示词装配不是简单的字符串拼接，而是需要经过有序树展开、深度隔离（Caged Slot）、宏展开、裁剪预算与格式投影等多道工序。
`@loom/core` 将这一过程建模为标准的编译器 Pipeline：
- **`Fragment`**：不可变的文本片段单元，携带元数据、局部作用域与深度标记；
- **`Pass`**：无副作用或受控转换的流水线中间件，按需对 Fragment 序列进行重排、变换或注入；
- **`Trace`**：单次编译的全程轨迹与时间戳审计，用于可视化调试与诊断。

---

## 架构规约与红线约束 (Rules & Boundaries)

1. **绝对纯净与无外部依赖**：
   - 本包属于核心私有底层，**严禁依赖任何 `@loom-studio/*` 业务或基础设施包**；
   - **严禁引入任何异步 I/O、Promise、文件系统、网络请求或持久化逻辑**，全部计算必须是同步且确定性的（Deterministic）。
2. **消费权限限制**：
   - 整个工作区中，**仅允许 `packages/loom-runner` 和 `packages/application-runtime` 声明依赖 `@loom/core`**；
   - `kernel`、`document-store`、`extension-host`、`studio-client` 以及第三方 Extension **严禁直接 import `@loom/core`**。

---

## 公共入口

Package 入口为 [`src/index.ts`](./src/index.ts)，构建产物为 `dist/index.js` 与 `dist/index.d.ts`：

- **执行器**：`run()`、`runPasses()`；
- **注册表**：`PassRegistry`；
- **核心类型**：`Fragment`、`Pass`、`PassConfig`、`PassFactory`、`Diagnostic`、`Trace`。

完整类型直接查看源码，不在 README 维护第二份类型字典。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom/core build

# 运行核心编译测试套件
pnpm exec vitest run tests/unit/core
```

---

## 正式文档

- [Loom Core 体系设计说明](../../docs/architecture/application/prompt-build/loom-core/README.md)
- [Studio 平台集成与 Pass 适配](../../docs/architecture/application/prompt-build/loom-core/studio-integration.md)
- [PromptBuild 架构总览](../../docs/architecture/application/prompt-build/README.md)
