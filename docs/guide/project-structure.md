# 仓库目录与职责地图 (Project Structure)

Loom Studio 使用 `pnpm` workspace 构建 Monorepo。核心代码区域是 `packages/`（内核与领域逻辑）、`apps/`（独立应用）、`official/` 与 `tests/fixtures/extensions/`（官方内容与测试扩展）；`scripts/` 提供工程工具。`data/` 是默认开发数据目录，不是正式安装的数据目录，详见[本地存储](../architecture/data/local-storage-and-assets.md)。

本页提供全仓地图。开始具体任务时，先通过 [`workspace-development.md`](workspace-development.md) 进入目标 Workspace，再阅读该目录的本地 `README.md`；局部 README 负责入口和命令，本页不重复维护每个 Package 的完整文件清单。

## Workspace 工具链

- Node.js 固定为 `24.22.0`，pnpm 固定为 `9.15.0`；版本来源分别是 `.node-version` / `.nvmrc` 与根 `package.json`。
- 新依赖默认保存精确版本，所有依赖都禁止使用 `latest` 或 `*`。安装与 CI 使用 `pnpm install --frozen-lockfile`。
- 内部 packages 的运行时入口位于各自 `dist/`。根目录的 `dev:server` 和 `dev:client` 会先构建并持续监听这些 packages，避免 workspace 链接正确但产物过期。
- `pnpm run check:workspace` 会先构建内部 packages，再检查工具链版本、依赖确定性、lockfile 和关键跨包运行时导出。

## 依赖关系方向

> **核心原则：内层不依赖外层。**
> `packages/` 内层包 **绝对不可** import `apps/` 或外部特定实现。
> Application Runtime 编排领域 Store / Gateway，Kernel 提供平台原语；提示词编译直接由 Application 实现。实际允许边界见[架构规则](architecture-rules.md)和[依赖图](../workbench/reference/dependency-graph.md)。

---

## 💻 前端架构: `apps/studio-client/src/`

局部开发入口：[`apps/studio-client/README.md`](../../apps/studio-client/README.md)。FSD 分层、状态所有者、代码放置规则与文件命名只在该 README 和 [UI 开发指南](ui-design.md)维护。

### Client 任务路由表

文件级任务路由与对应测试统一维护在 [Client README：任务到文件与验证入口](../../apps/studio-client/README.md#任务到文件与验证入口)。不再复制第二份路径表，避免重构后导航仍指向旧 Feature 或测试。

### Client 模块索引

| 目录 | 职责 |
|---|---|
| [app/](../../apps/studio-client/src/app/) / [pages/](../../apps/studio-client/src/pages/) | 顶层组装、页面与路由；不实现领域算法 |
| [widgets/](../../apps/studio-client/src/widgets/) | 页面级组合与局部 UI；不编排跨领域 RPC |
| [features/](../../apps/studio-client/src/features/) | 业务状态、RPC、算法与绑定 UI |
| [entities/](../../apps/studio-client/src/entities/) | Client DTO 与领域类型 |
| [shared/](../../apps/studio-client/src/shared/) | typed API、宿主界面状态、通用适配与 i18n；通用 UI 原语归 `@loom-studio/ui` |

---

## 🖥️ 后端架构: `apps/studio-server/src/`

后端是一个组合器，主要将 `packages/` 下的各个基础设施组装为可运行的 Node.js 进程。

局部开发入口：[`apps/studio-server/README.md`](../../apps/studio-server/README.md)。

组装与启动前提、HTTP 面和模块地图统一维护在 Server README。请求认证、文件与 SSE 进入 [HTTP 模块](../../apps/studio-server/src/http/README.md)；procedure、可信 Context、服务注入与领域交接进入 [RPC 模块](../../apps/studio-server/src/rpc/README.md)。整体依赖关系见[系统总览](../architecture/system-overview.md)，不在本页复制另一份 Server 文件清单。

---

## 🧪 实验沙箱: `apps/playground/` 与本地草稿区 `drafts/`

实验与推演逻辑严格划分为两级形态，避免临时试错污染生产代码，也避免有价值的原型资产散失：

1. **`apps/playground/`（受管工程化实验应用）**
   - 具备完整的 `package.json`、TypeScript 配置与模块划分。
   - 专用于承载具有长期工程价值与交互推演的实验，例如当前重点推进的 **CodeAct 安全执行沙箱**（`apps/playground/src/codeact/`）、脱机 Kernel 自测与控制流推演。
   - 局部开发入口：[`apps/playground/README.md`](../../apps/playground/README.md)。

2. **根目录 `drafts/`（本地极速演算草稿区 / Scratchpad）**
   - 完全被 `.gitignore` 忽略，作为开发者的纯本地草稿纸（原 `Playground/`）。
   - 适用于单次脚本验证、快速对比与临时转储分析。
   - **治理生命周期底线**：
     - **及时转正**：原型成熟后须按架构权责归位（交互实验升格入 `apps/playground/`，测试夹具沉淀至对应扩展如 `extensions/st-data-compat/fixtures/`，静态资源进入 `public/`，生产算法合入对应包）。
     - **即时清理**：验证完毕或已转正的测试脚本、动辄数十兆的历史转储目录（如 `storage-*`、`diff-recovery-*`），应及时删除，不作为常态资产滞留工作区。

---

## 📦 核心领域包: `packages/` (7 个 Workspace 包)

这些包大多是独立于运行环境的（Node / Browser 均可或有明确边界），已收敛为 7 个高内聚包：

- 📦 [`packages/application-runtime/`](../../packages/application-runtime/README.md) (`@loom-studio/application-runtime`, AIRP Layer)
  - Studio 的**业务心脏**。编排 Card、Agent、Narrative Timeline、PromptBuild、Run 生命周期与相关领域逻辑；同时内聚原 `application-data`（[`src/data/`](../../packages/application-runtime/src/data/README.md)），在共享 SQLite 中管理 Agent 会话与权威内容历史、Narrative 分支与正文索引、State 状态修订、Timeline Workspace 不可变版本、Prompt Resource 树与 LoreMount 挂载关系，以及 Dashboard 持久化统计（`application.statistics`）。
- 📦 [`packages/kernel/`](../../packages/kernel/README.md) (`@loom-studio/kernel`)
  - Studio 的**Host Kernel 宿主内核与共享物理底座**。管理核心服务（RPC 注册、Event Bus、统一 `ExtensionHost`）并内聚原 `data-engine`、`document-store`、`asset-store`、`secret-store`、`diagnostics`、`extension-host` 及从 `studio-server` 下沉的 `platform/`、`extension-manager/`、`script-runtime/`。**禁止包含任何 AI/业务（Provider/Agent）逻辑。**
  - 正式架构说明：[`architecture/kernel/README.md`](../architecture/kernel/README.md)、[`architecture/data/README.md`](../architecture/data/README.md)。
  - 内部子模块：[`data-engine/`](../../packages/kernel/src/data-engine/README.md)（共享 SQLite connection、FIFO 事务、`VACUUM INTO` 备份与 `data.changed` 提交事实）、[`secret-store/`](../../packages/kernel/src/secret-store/README.md)（凭据元数据与系统后端边界）、[`document-store/`](../../packages/kernel/src/document-store/README.md)（版本化 Document/Revision/Changeset）、[`asset-store/`](../../packages/kernel/src/asset-store/README.md)（Source Artifact / Media Asset 与 SHA-256 Blob）、[`extension-host/`](../../packages/kernel/src/extension-host/README.md)（统一 Extension 与 `.loom.js` Script 宿主）、[`diagnostics/`](../../packages/kernel/src/diagnostics/README.md)（非阻塞系统诊断）。
- 📦 [`packages/ai-gateway/`](../../packages/ai-gateway/README.md) (`@loom-studio/ai-gateway`)
  - 统一的多模型厂商调度网关（基于 Vercel AI SDK），支持单实例流式执行、工具调用、能力画像映射与离线测试 Fake Provider（含 `/contracts` 纯类型子入口）。
- 📦 [`packages/logging/`](../../packages/logging/README.md) (`@loom-studio/logging`)
  - Server/Client 共用的结构化运行日志底座，提供 Root/Child Logger、Memory/Console Sink 与查询类型；Node JSONL 旋转持久化通过 `@loom-studio/logging/node` 子入口提供。
  - 正式架构说明：[`architecture/platform/logging.md`](../architecture/platform/logging.md)。
- 📦 [`packages/loom-ui/`](../../packages/loom-ui/README.md) (`@loom-studio/ui`)
  - 领域无关的原子级 UI 设计系统组件库（Button、TextInput、Field、Radix 菜单原语等），组件内部复用 Lucide 图标。
- 📦 [`packages/extension-sdk/`](../../packages/extension-sdk/README.md) (`@loom-studio/extension-sdk`)
  - 第三方 Extension 作者侧纯契约 SDK（Manifest v2、Activation Context 与 Capability 类型）。
- 📦 [`packages/shared/`](../../packages/shared/README.md) (`@loom-studio/shared`)
  - 通用的环境同构工具函数、类型定义 (`JsonValue`, `createId`, 时间处理)、变量宏渲染引擎、LoreMount 契约与跨端分词估算（[`src/tokenizer/`](../../packages/shared/src/tokenizer/README.md)），零 Node 原生依赖。

Client 的动态 RPC adapter 与 session-fetch 位于 `apps/studio-client/src/shared/api/`；事件 envelope 由 Extension SDK 提供。Core / Runner / TraceAudit 原型已退役。

## 🧩 扩展内容

- `official/extensions/`: 主仓库维护的官方内容与主题示例，源码以这里为基准；“官方”不等于内置。当前发行包只携带 `loom-assistant`，具体以发布清单为准，见[目录约定](../../official/extensions/README.md)。
- `extensions/`: 独立发行扩展的安装和本地开发目录，官方与第三方使用同一位置；主仓库忽略此目录。
- `extensions/st-data-compat/`: 官方 SillyTavern 数据兼容扩展（专属测试夹具位于其 `fixtures/data/` 下）。
- `extensions/the-world/`: 独立发行的官方 The World 扩展。
- `tests/fixtures/extensions/echo/`: 测试扩展，覆盖 RPC、Macro、State、Text Pipeline 与 Renderer 贡献。
- `tests/fixtures/extensions/weather-station/`: Server Extension 生命周期、事件与文档能力测试样本。

STBridge 与 The World 的开发基准分别为各自的独立仓库；用户确认后下载安装，`official/extensions/` 不保留它们的副本。Git 安装不执行构建，因此独立仓库同时交付源码及由其生成的完整 `dist/`，不把构建产物作为第二份可独立编辑的实现。

---

## 🛠️ 工程脚本: `scripts/`

[`scripts/`](../../scripts/) 存放面向全仓的基础设施维护、开发沙箱重置、官方内容打包与架构/文档核查脚本。**严禁将未成形的随手试错代码散落在该目录**。

### 核心脚本分类与常用命令

1. **代码重构与工程治理**
   - `pnpm refactor:migrate-imports` (`scripts/dev/migrate-imports.ts`): 在跨包重构或别名调整时，自动化扫描并迁移源码中的模块导入路径。
   - `pnpm audit:unused` (`knip`): 静态分析未引用的孤儿导出、文件与无用依赖。

2. **开发环境管理**
   - `pnpm data:reset` (`scripts/data/reset-dev-data.ts`): 在本地开发沙箱被脏数据污染时，自动备份现有数据后安全重置 `data/`。

3. **官方内容与范例打包**
   - `pnpm official:pack` (`scripts/pack/pack-official-content.ts`): 旧 catalog 格式打包工具（需显式指定目录，默认无内置 starter 内容，详见 [`official/README.md`](../../official/README.md)）。
   - `pnpm example:character-status` (`scripts/pack/pack-character-status-example.ts`): 角色状态与 Presentation 脚本卡片范例打包脚本（样例定义已收拢至 `official/cards/character-status/`）。

4. **架构合规与健康检查**
   - `pnpm check:workspace` (`scripts/checks/check-workspace.mjs`): 校验跨包依赖确定性、lockfile 与产物导出。
   - `pnpm check:docs` (`scripts/checks/check-docs.mjs`): 校验 Markdown 内部相对路径、锚点与文档生命周期。
   - `pnpm verify:server-extension` (`scripts/dev/verify-server-extension.ts`): 对服务端扩展的生命周期与错误隔离执行冒烟检查。

### 脚本开发规范

- **入口显式化**：通用脚本必须挂载至根 `package.json` 的 `scripts`，并提供清晰的命令行参数与帮助说明。
- **环境自适应**：脚本严禁硬编码本地开发绝对路径，必须通过 `developmentDataEnvironment` 或环境变量（如 `LOOM_STUDIO_DATA_ROOT`）动态感知环境。
- **及时清理孤儿**：阶段性、一次性的迁移脚本在任务彻底验收闭环后，必须连同其 package.json 入口一并移除，禁止长期闲置陈放。

---

## 💾 本地数据与开发沙箱: `data/` 与 `.loomstudio-dev/`

系统遵循“持久业务数据”与“临时易失诊断/缓存”彻底解耦的原则（详见 [`architecture/data/local-storage-and-assets.md`](../architecture/data/local-storage-and-assets.md)）：

1. **`data/`（单一真实数据根目录 / Single Source of Truth）**
   - 承载开发态所有真实的持久化业务资产：SQLite 核心数据库 (`studio.sqlite`)、不可变二进制块 (`blobs/`)、角色工作区 (`characters/`) 以及扩展状态 (`extensions/`)。
   - 受 `.gitignore` 保护。开发启动器（`pnpm dev:server`）通过 `LOOM_STUDIO_DATA_ROOT` 默认指向此目录。
   - 严禁在此目录写入临时测试垃圾或运行日志。

2. **`.loomstudio-dev/`（开发态易失缓存与测试沙箱）**
   - 受 `.gitignore` 保护，由开发启动器通过 `LOOM_STUDIO_HOME` 注入作为辅助根。
   - 仅用于存放本地运行的 JSONL 诊断日志（`.loomstudio-dev/logs/`）以及测试期间动态生成的临时扩展沙箱（如 `test-extensions/`）。
   - **演进边界约束**：早期位于 `.loomstudio-dev/data/` 的历史 SQLite 库与旧版 `document-store.sqlite` 已于 9 月脱机迁移至 `data/` 并彻底下线清空，不得再向 `.loomstudio-dev` 写入任何持久业务数据。

---

## 给 AI 助手的特别提示

1. 当你需要理解 **Application Runtime 公共合同** 时，先看 `packages/application-runtime/README.md`，再按需进入 `src/types.ts`；持久化类型还需查看对应领域 Store。
2. 当你需要修改 **前端 UI 界面** 时，先定位页面级 widget，再把业务状态、RPC 与领域算法放回对应 `features/`。widget 只保留布局、局部交互和 props 传递。
3. 当你需要查看 **RPC 如何分流** 时，先看 `apps/studio-server/src/rpc/trpc/router.ts`；`application.*` 的边界映射再看 `apps/studio-server/src/rpc/trpc/router.ts` 及相邻领域 procedure。
4. **绝对不要** 为了贪图便利在不合适的层级写代码（比如在 `kernel` 里写 `Prompt` 的解析）。
