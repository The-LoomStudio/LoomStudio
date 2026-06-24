# Extension 生态与开发者体验 (DX) 长期建设方案

> **状态**：Draft / Roadmap
> **目的**：规划 Loom Studio 对于第三方 Extension 开发者的体验与生态支持建设方向。
> **适用范围**：SDK 发布规范、工具链支持、动态能力发现

---

## 0. 目标与背景

为了确保 Loom Studio 平台能够以极低的门槛吸引第三方 Extension 开发者，同时恪守我们的 **KISS 原则** 和 **Scenario-Driven Design**，我们决定放弃沉重、复杂的跨语言 Schema-First 生成器（如 Protobuf/OpenAPI）。

取而代之，我们将围绕 TypeScript 原生类型系统、运行时自省机制（Introspection）以及极简轻量级脚手架，构建一套优雅、高效且极具扩展性的开发体系。

---

## 1. 核心策略：三位一体的友好体验

### 1.1 静态类型防线 (Code-First SDK)
我们不使用额外的生成工具向开发者生成 RPC Client 代码或类型。

- **策略**：直接将 `@loom-studio/extension-sdk` 作为类型定义与接口规约的基础。
- **落实方式**：
  - 全面增强 SDK 暴露的接口（如 `ExtensionContext`, `ExtensionRpcContext`, `ExtensionHost`）的 **TSDoc 注释**。
  - 扩展开发者只需 `npm install @loom-studio/extension-sdk`，在自己的项目中编写 TypeScript 就能获得完美的类型补全与限制，实现真正的“代码即契约”。

### 1.2 动态能力发现 (Runtime Introspection)
因为 Extension 是动态启停的，它可能会向平台注册未知的 Provider 或自定义 RPC 能力，因此我们必须依靠运行时动态发现。

- **策略**：落实并强化 P1 架构任务（统一 Capability Registry）。
- **落实方式**：
  - 核心底座通过 `system.introspect` 接口，暴露全系统的可用能力。
  - 改进后的 Introspection不仅返回方法名，还要返回包括入参/出参的 Schema（或类型定义概要）、方法描述（Description）以及接口稳定性（Stability）。
  - 这将使得 DevTools 和其他第三方 Extension 可以安全地调用平台未内置的新能力，彻底摒弃手动配置和源码猜测。

### 1.3 “零阻力”起步脚手架 (CLI Scaffolding Tool)
为了解决第三方开发者在项目初始化阶段面对繁琐的 `manifest.json` 配置、TS 编译设置的试错成本，需要提供标准的初始化工具。

- **策略**：构建纯粹用于脚手架克隆的轻量级工具（不负责生成核心逻辑，仅负责基建）。
- **落实方式**：
  - 提供类似 `npx create-loom-extension` 的命令行指令。
  - 它会在本地克隆一套标准的模板结构，包含：正确的 `tsconfig.json` 配置、`package.json`、符合当前内核版本的 `manifest.json`、以及包含最简单 RPC 注册和文档读写的 `src/index.ts`（Hello World）。
  - 让开发者免受“从零配环境”之苦，实现环境搭建零门槛。

---

## 2. 建议演进路线与优先级

本方案是一项长期演进规划，推荐的建设步骤如下：

1. **Phase 1: 静态打底 (当前期)**
   优先利用 TypeScript 机制，优化并补全 `@loom-studio/extension-sdk` 内的注释、类型导出规范与边界限制。
2. **Phase 2: 动态骨架 (伴随 P1/P3 重构期)**
   在进行 Application Runtime 领域切片重构时，同步完善 `system.introspect`，构建能力发现底座并实现 DevTools 的初步联动。
3. **Phase 3: 繁荣生态 (内核稳定期)**
   当核心平台的 Extension 机制、依赖隔离与打包规范彻底稳定后，再着手编写并对外发布 `create-loom-extension` 官方脚手架模板。
