# Extension 生态与开发者体验 (DX) 长期建设方案

> **状态**：Draft / Roadmap
> **目的**：规划 Loom Studio 对于第三方 Extension 开发者的体验与生态支持建设方向。
> **适用范围**：SDK 发布规范、工具链支持、动态能力发现、扩展页面与声明式设置
> **2026-09-12 基线**：Application Runtime 领域模块化与 Server / Client Extension Logger 已有实现，不再作为本路线的前置建设任务。后续只补真实 SDK 文档缺口、能力自省与脚手架；Logger 的存在不代表 `system.introspect` 已提供完整 Schema。当前合同见 [Extension Architecture](../../architecture/extensions/README.md) 与 [Extension SDK](../../../packages/extension-sdk/src/index.ts)。
>
> **相关讨论**：[`../../archive/discussion/extensions/studio-extension-host-capabilities-v0.md`](../../archive/discussion/extensions/studio-extension-host-capabilities-v0.md)
>
> **相关延期计划**：[`extension-package-source-host-runtime-plan.md`](../../archive/plans/extension-package-source-host-runtime-plan.md)

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
2. **Phase 2: 动态能力发现（独立延期切片）**
   不再等待已完成的 Runtime 模块化；按现有 Registry 与 RPC 元数据核对 `system.introspect` 的缺口，再确定 Schema 与 DevTools 联动范围，不因早期 P1/P3 编号直接恢复重构。
3. **Phase 3: 繁荣生态 (内核稳定期)**
   当核心平台的 Extension 机制、依赖隔离与打包规范彻底稳定后，再着手编写并对外发布 `create-loom-extension` 官方脚手架模板。

## 3. 扩展页面、声明式设置与组件使用

> **状态**：首版 Setting 合同与闭环已实现 / 后续公共发布边界待稳定
> **2026-09-12 决策**：从背景讨论稿转入本扩展计划。页面承载与作者使用组件属于 Extension UI 能力；不依赖上述三个 Phase 顺序，也不阻塞已归档的[官方背景与面板材质](../../archive/plans/ui/background-and-panel-materials-plan.md)。本次仅归属整理，不授权代码实现。
> **2026-09-14 补充决策**：Extension UI 采用“声明式 Contribution 优先、自定义 Renderer 兜底”。Action 与 Setting 共用声明、身份、排序、条件和 Host 渲染机制，但保持各自合同：Action 表达瞬时命令入口，Setting 表达需要校验、持久化和回传的配置值。

### 已确认事实与边界

现有 `shell.workspace-panel`、Manifest Action / Command 和 Renderer mount / update / disposer 提供页面接入基础。官方扩展工作台已有 Master–Detail，但内部组件不等于公开组件 SDK。2026-09-14 已增加 Package-level Setting Contribution、Client `configs.list/get/upsert/subscribe`、Host-rendered 表单与现有 `storage.configs` Document 闭环；这不等于 `@loom-studio/ui` 已成为稳定公开包。

Surface 负责展示位置、导航、上下文与生命周期；组件及声明能力降低页面编写成本。优先复用现有 Surface，不因“设置页”而新增 Surface 类型。Registry 保存贡献，Host 管理实例；复杂地图或游戏面板继续由自定义 Renderer 绘制。

### 已确认方向

- Extension UI 对外分为两条主路径：Declarative Contribution 承载 Action、Setting、普通菜单和简单流程；Custom Renderer 承载地图、天气可视化、复杂编辑器等自由 Surface。不要把两者合并成万能 UI DSL。
- 扩展所属工作台就地展示页面与设置，不另建独立表单资源中心；入口引用同一贡献身份，不复制实现。
- 声明式设置由作者描述字段、默认值、选项及约束，Host 使用 `@loom-studio/ui` 提供控件、布局、提交状态、错误反馈、无障碍与移动适配；作者不需要为普通设置编写 React、CSS 或局部持久化状态。
- 首版字段以真实设置需求为界，至少支持布尔值、单行与多行文本、数值、枚举下拉和范围输入，以及 label、description、default、required、只读、分组、排序和 Scope。字段级任意 JSX、自定义 Renderer、递归对象编辑器和动态 UI 表达式不进入声明式合同；超出能力时使用 Custom Renderer。
- 自定义扩展页面应有更方便的组件使用路径，但不将当前内部 React 组件直接承诺为稳定 SDK，也不预设作者必须使用 React。
- 配置复用现有 Extension Config 存储。读取、校验、保存、并发冲突和权限是完整交付范围，不新建表单专用数据库。

### Setting 提交与回传语义

普通设置默认不显示页面级“保存”按钮，而采用字段级自动提交：

- boolean 与 enum/select 在选择改变后立即校验并提交；
- 单行文本、数值和多行文本在编辑期间保留 Host 本地 draft，短暂停顿后自动提交，blur 时立即 flush；单行文本可用 Enter 提交，多行文本的 Enter 保留换行语义；
- range/slider 拖动时只更新本地预览，交互结束后提交最终值，避免每个 pointer move 都触发持久化和运行时更新；
- 只有多字段必须原子提交、提交会触发危险或昂贵副作用，或系统无法提供正确自动恢复语义时，才使用明确的 Apply/Confirm 操作。

回传链路固定为：

```text
用户输入
  -> Host draft
  -> Schema 校验
  -> namespaced Extension Config 持久化
  -> 返回权威 snapshot / revision
  -> Host 发布 config.changed
  -> Extension Runtime 收到已提交值
```

持久化失败时保留当前 draft，并在对应字段显示错误和重试状态；不静默替换成默认值，不把失败值发布给 Extension Runtime。Extension 消费的是已提交配置快照或 change subscription，不通过每个字段绑定私有回调。实时预览属于独立、可选的 transient preview 合同，不能冒充已经保存的配置。

### 工作包、验收与开放问题

1. **合同收口**：从 `packages/extension-sdk/src/index.ts`、`apps/studio-client/src/features/extension-renderers/` 及 Server Config Host 实现核对入口。确定 Setting 声明归属、Scope、Config namespace、默认值、draft 与 committed snapshot、读写权限、revision 冲突和 change subscription；组件发布与 Adapter 样式边界由关联 UI Plan 管理。
2. **代表性作者样板**：以 The World 的普通开关、下拉、文本/数值和滑块设置作为声明式样板，以地图或天气面板作为 Custom Renderer 样板；两者复用同一 Surface 身份，不复制入口和配置来源。
3. **最小闭环**：按冻结合同接通声明、Host 渲染、字段级自动提交、持久化、权威快照和运行时回传。定向验证 reload、非法输入、提交失败、revision 冲突、快速连续编辑及模块停用；确认失败值不会进入 Runtime，自定义 Renderer 生命周期不被设置页改写。
4. **流程型表单延期切片**：SillyTavern 整体迁移已证明多步骤、进度和确认流程存在真实需求，但不塞入首版 Setting Schema。普通设置闭环稳定后，再判断是否增加 Host-rendered Flow，或继续使用 Custom Renderer。

不建设通用 UI DSL、任意模板引擎或未经需求证明的全量组件库。需要新增依赖、扩大权限或改动持久化归属时停止并收口，不借本切片恢复整个 DX 路线。实现前由主 Agent 补齐精确写集、验收负责人及最小验证命令。

**当前结果**：首版字段合同、Manifest 校验、Host-rendered 控件、字段级自动提交、Document Version 冲突保护、Client Runtime 权威快照订阅，以及 IFrame 公共 Theme Token Snapshot 已实现。仓库内可追踪的 Example Echo 已作为 text Setting 代表消费者，boolean、select 与 range 由 Host 表单测试覆盖；The World 的正式迁移仍需在其独立源码仓库落盘。尚未完成 `@loom-studio/ui` 的公开发布、第三方 Extension 兼容承诺、多步骤 Flow、浏览器交互验收和长期 Schema 迁移策略。
