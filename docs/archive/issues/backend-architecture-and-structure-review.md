# 后端宏观工程结构、包分类与命名审查报告 (Backend Architecture & Structure Review)

> **状态**：Historical Audit Snapshot / Superseded

## 审查目标

全面排查 Loom Studio **后端工程拓扑**（涵盖 `packages/` 18 个包、`apps/studio-server/` 及 `extensions/`），重点审查：
1. **包分层与单向依赖合规性（Layering & Dependency Graph）**
2. **包物理布局与文件夹/文件命名规范（Naming & Layout）**
3. **包粒度失衡与巨型文件膨胀（Package Granularity & File Size）**
4. **服务端职责切分与路由聚合（Server Organization）**

---

## 1. 核心优势与架构亮点

1. **✅ 100% 严谨的 Kebab-case 命名规范**：
   - 全后端 18 个 packages、`studio-server`、`extensions` 下的数百个文件和目录，**100% 严格遵守小写短横线规范**，未出现任何大小写混合或驼峰失误。
2. **✅ 依赖单向性极佳，零循环依赖（Zero Circular Dependencies）**：
   - 经拓扑层级扫描，依赖方向完全单向：
     `studio-server` ➔ `application-runtime` ➔ `kernel` ➔ `domain stores (narrative/agent/asset)` ➔ `infra stores (document/secret/blob)` ➔ `data-engine/core` ➔ `shared/logging/diagnostics`。
   - 没有任何底层包逆向依赖上层，依赖拓扑非常纯净。

---

## 2. 核心问题与设计异味清单

### 🔴 [高] 1. `application-runtime` 内部巨型文件膨胀与平铺混乱

**文件：**
- [`packages/application-runtime/src/workspace.ts`](../../../packages/application-runtime/src/workspace.ts) (**1,391 行**)
- [`packages/application-runtime/src/runtime.ts`](../../../packages/application-runtime/src/runtime.ts) (**1,249 行**)

**现象分析：**
- `application-runtime` 一个包占据了整个后端近 40% 的代码量（5,188 行），其内部 17 个文件全量平铺在 `src/` 顶层。
- `workspace.ts`（1,391 行）高度杂糅了 Prompt Resource 增删改查、资产树递归挪动、批量补丁应用、Card 导入导出、Bundle 打包等全部逻辑。
- `runtime.ts`（1,249 行）承载了 ApplicationRuntime 的全部装配。

**重构建议：**
- 将 `application-runtime/src/` 按业务领域划分子目录（如 `src/prompt/`、`src/workspace/`、`src/cards/`、`src/agent/`），拆分超千行巨型文件。

---

### 🟡 [中] 2. 物理目录嵌套破坏 Monorepo 一致性（`extension-host`）

**文件：** `packages/extension-sdk/extension-host/`

**现象分析：**
- 整个 `packages/` 目录下共 18 个包，其余 17 个包均位于平级的 `packages/<name>` 顶层，唯独 `@loom-studio/extension-host` 嵌套在 `packages/extension-sdk/` 内部。
- 这种嵌套结构破坏了 Monorepo 的直观感知，导致在文档、IDE 以及构建配置中多次产生歧义。

**重构建议：**
- 物理平移为顶层 `packages/extension-host/`，与其余包保持一致。

---

### 🟡 [中] 3. 包粒度失衡：微小包碎片化

**文件：**
- `packages/trace-audit` (仅 52 行)
- `packages/diagnostics` (仅 73 行)
- `packages/client-bridge` (仅 96 行)
- `packages/transport` (仅 112 行)
- `packages/loom-runner` (仅 151 行)

**现象分析：**
- 这些包全文只有单个 50~100 行的 `index.ts`，却各自拥有独立的 `package.json`、`tsconfig.json`、`dist/`。
- 优点是职责单一，但过多微小包拉长了构建管道和 pnpm workspace 链接成本。

---

### 🟡 [中] 4. `studio-server` 顶级平铺与单一聚合路由过大

**文件：** [`apps/studio-server/src/rpc/handlers/application/index.ts`](../../../apps/studio-server/src/rpc/handlers/application/index.ts) (历史原文件：`application-rpc.ts`)

**现象分析：**
- `application-rpc.ts` 用一个庞大的 `switch(method)` 承载了 50 多个 RPC 的参数读取与转发。
- `card-bundle-zip.ts`（165 行）与 `card-png.ts`（143 行）直接散落在 Server 源码根目录下。

**重构建议：**
- 将 `studio-server/src/` 细分为 `rpc/`（按 domain 拆分子路由）、`media/`（PNG/ZIP 编解码）、`auth/` 等子目录。

---

## 3. 审查总结与改进建议

| 治理项 | 现状与问题 | 建议重构方案 |
|---|---|---|
| **超千行文件拆分** | `workspace.ts` (1391行), `runtime.ts` (1249行) 严重膨胀 | 按领域引入子目录（`workspace/`, `prompt/`, `agent/`） |
| **嵌套包平铺** | `extension-host` 嵌套在 `extension-sdk` 内部 | 平移至顶级 `packages/extension-host` |
| **Server 目录分层** | `studio-server/src/` 16 个文件平铺，`application-rpc.ts` 766 行 | 拆分子目录 `rpc/`、`format/` |
| **微小包收敛评估** | 5 个仅 50~100 行的微小包 | 评估是否在未来适度整合至 `@loom-studio/shared` 或 platform 基础包 |
