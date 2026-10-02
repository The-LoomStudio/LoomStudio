# `@loom-studio/shared`

本包共享无业务所有权的结构化身份、引用和挂载合同；Card/Extension 安装身份及 Agent Preset 生命周期由 Application 与 Extension Host 各自负责，不在 `shared` 建立通用资源注册表。

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/shared` 是 Loom Studio 最底层的跨端通用工具库与共享数据契约层。它提供严格环境同构的 JSON 原语、唯一 ID 生成器、错误序列化工具、变量宏（Macro）渲染引擎与核心 Schema 契约。

## 业务使命与同构基座

为了确保业务类型与算法在 Node.js 服务端与浏览器 Web 端之间能够无缝复用与序列化，本包承担全仓公共基础契约：
- **基础原语**：严格定义 `JsonValue`、`JsonObject`、`createId()`、`nowIso()` 与跨端标准化的 `serializeError()`；
- **变量宏渲染引擎 (`src/macros.ts`)**：提供模板中的只读变量替换、宏别名解析与渲染追踪；
- **资源引用解析 (`src/resource-reference.ts`)**：提供带版本/行范围的 `ResourceReference` 与实体导航 `EntityReference` 的 URI 编解码；只校验引用形状，不查询目标是否存在，也不拥有 UI 展示模型；
- **Prompt Resource 挂载契约 (`src/prompt-resource-contracts.ts`)**：提供 `SettingMount` 及其列表/替换 Zod Schema；`source` 支持 `manual/global` 和预设消费者，引用保留包内或外部 identity，解析结果允许为 `null`。替换输入在 `settingResourceIds` 与 `mounts` 中严格二选一，后者支持按 Mount ID 保留失效引用；Schema 不决定目标可用性或运行时是否注入；
- **状态与资源目录类型**：定义卡片目录格式（`resource-directories.ts`）与状态贡献契约（`state-contribution.ts`）。

---

## 架构规约与同构红线 (Rules & Boundaries)

1. **环境绝对同构（Isomorphic Purity）**：
   - 本包**必须能够在 Node.js、现代浏览器与 Web Worker 中完全无阻碍运行**；
   - **严禁依赖 React、DOM API、`node:fs`、`node:sqlite` 或任何特定运行时的私有模块**；
2. **内层不依赖外层**：
   - 本包处于基础设施最底端，**严禁依赖任何其他 `@loom-studio/*` 包或上层应用**。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- 原语工具：`createId()`、`nowIso()`、`serializeError()`、`isRecord()`、`isJsonObject()`；
- 宏工具：`renderVariableMacros()`、`createVariableRenderContext()`、`canonicalMacroName()`；
- 资源引用：`parseResourceReference()`、`formatResourceReference()`、`parseEntityReference()`、`formatEntityReference()`、`parseResourceLink()`；
- 挂载 Schema：`settingMountSchema`、`listSettingMountsInputSchema`、`replaceSettingMountsInputSchema`；
- 核心类型：`JsonValue`、`SerializedError`、`ChatMessage`、`ResourceReference`、`SettingMount`、`CardDirectoryCatalog` 等。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/shared build

# 运行跨端基础单元测试
pnpm exec vitest run tests/unit/shared
```

---

## 正式文档

- [External Dependency Ownership 跨端纯契约约定](../../docs/architecture/platform/external-dependency-ownership.md)
