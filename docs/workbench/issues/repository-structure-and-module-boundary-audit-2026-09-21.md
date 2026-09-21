# LoomStudio 仓库结构与模块边界审计（2026-09-21）

> **状态**：Open
>
> **审计基线**：`main` / `517a05f` + 当前未提交工作树
>
> **范围**：仓库目录、Package 归属与依赖、Client FSD 分层、公共入口、模块与函数调用归属
>
> **明确排除**：Agent、CodeAct 及其直接运行链路；不审 Agent Loop、Transcript、Provider Step、VFS 执行器和相关生命周期行为

## 结论

本轮先做结构级审查，不以文件长度、抽象偏好或静态工具的单项输出作为问题。当前确认 **3 个 P2**：

| 编号 | 级别 | 结论 |
| --- | --- | --- |
| STRUCT-001 | P2 | Client 的布局、外观和 Header 状态所有者位于上层 UI 文件，形成 `features/widgets -> widgets/pages` 反向依赖 |
| STRUCT-002 | P2 | 两个 Feature 直接 deep-import `extension-renderers` 内部模块，违反同层 Feature 的边界合同 |
| STRUCT-003 | P2 | `studio-client` 直接使用 `@loom-studio/extension-sdk`，但 TypeScript project reference 未覆盖该 Package |

Package 依赖图没有发现环；生产源码文件名和目录名没有发现明显的大小写、空格或下划线违规。没有证据表明 Kernel、Application Data、Server Composition Root 的 Package 物理归属需要整体调整。

## 已确认问题

### STRUCT-001 · P2 · Client 状态所有者位于上层 UI，形成反向依赖

正式 Client 合同规定 FSD 下层不能反向 import 上层，Widget 只负责页面级组合，Feature 不能依赖 Widget。当前存在以下调用：

- `widgets/context-workbench/*` 直接读取 `pages/studio/model/studio-layout-store.ts`；
- `widgets/preset-workbench/*` 直接读取同一 Layout Store 和 `studio-panel-presentation.ts`；
- `widgets/play-panel/play-panel.tsx:7` 读取 `pages/studio/studio-window-header-context.tsx`；
- `features/extension-renderers/model/use-client-extension-runtime.ts:2` 读取 `widgets/settings-panel/appearance-store.ts`；
- `app/app.tsx:34` 也直接读取 Widget 内部的 Appearance Store。

对应合同见 `apps/studio-client/README.md:53-68` 与 `docs/guide/code-review.md:26-32`。

这不是单纯目录偏好：页面布局状态和外观状态已经成为多个 Feature、Widget、App 的共享运行时依赖，但它们的模块所有者仍位于某个 Page 或具体 Widget 内。结果是复用方必须反向穿透 UI 层，后续移动面板、替换 Shell 或复用 Extension Runtime 时会扩大迁移范围。

**最小修复方向**：先为 Layout、Appearance、Header Actions 确定唯一的 Shell 状态所有者，再把状态 Store / Context 放入 `app` 或独立的 Shell Feature；Widget 只通过 props 或稳定的 Shell capability 使用它。不要把这些状态直接搬进泛化的 `shared`，除非确认它们已经没有 Studio Shell 语义。

**关闭条件**：

- `features` 不再 import `widgets`；
- `widgets` 不再 import `pages/studio`；
- App、Page、Widget 对 Layout / Appearance / Header Actions 只通过确定的 Shell 边界访问；
- 不改变现有面板行为和持久化键。

### STRUCT-002 · P2 · Feature 直接 deep-import 另一个 Feature 的内部模块

以下 Feature 之间存在同层内部导入：

- `features/loom-scripts/runtime/loom-script-renderer-runtime.ts:9-10`
  直接读取 `features/extension-renderers/model/client-renderer-host.ts` 和
  `renderer-registry.ts`；
- `features/text-transforms/ui/text-transform-panel.tsx:21-22`
  直接读取同一组 `extension-renderers/model` 内部实现。

当前项目合同要求同层 Feature 不进行横向 deep import，非本 Feature 的渲染注册表、Surface Policy 和 Host 类型也不是 Text Transform 或 Loom Script 的私有实现。

实际影响是 `extension-renderers` 的内部文件路径已经成为多个 Feature 的隐式公共 API。后续调整 Renderer Registry、Host 或冲突策略时，无法通过单一边界判断消费者，也容易让 Extension Renderer 领域逻辑继续向其他 Feature 扩散。

**最小修复方向**：先确认 Renderer Host / Registry 是共享的 Studio Extension Runtime 能力，还是一个具有明确公开入口的 Feature。随后只暴露稳定的最小 facade 或将该能力下沉到合适的共享边界；不要仅新增一个 `index.ts` 继续转发全部内部实现。

**关闭条件**：

- Loom Script 和 Text Transform 不再依赖 `extension-renderers/model/*` 的内部文件；
- Renderer Registry、Host 和 Surface Policy 只有一个明确所有者；
- 公开 facade 不暴露无真实消费者的实现细节；
- 相关 Client 定向类型检查和测试覆盖真实注册/查询行为。

### STRUCT-003 · P2 · `studio-client` 的直接 Package 依赖未进入 TypeScript project reference 图

`apps/studio-client/package.json` 直接声明并在生产源码中使用 `@loom-studio/extension-sdk`，例如：

- `apps/studio-client/src/entities/extension.ts:11`
- `apps/studio-client/src/shared/api/studio-api.ts:25`
- `apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts`

但 `apps/studio-client/tsconfig.json` 的 `references` 只包含 `ai-gateway`、`client-bridge`、`logging`、`loom-ui` 和 `shared`，没有 `../../packages/extension-sdk`。只运行 `pnpm exec tsc -b apps/studio-client --dry --verbose` 时，TypeScript 列出的项目图也没有 `packages/extension-sdk`。

这会使单独构建 Client 时依赖已存在的 `extension-sdk/dist`，而不是由 project reference 表达源码构建顺序。根目录的 `build:packages` 会部分掩盖这个问题，但不能替代 Package 自身的增量构建合同；源码与旧 `dist` 不一致时，Client 可能继续读取旧声明或旧运行时产物。

**最小修复方向**：将直接使用的 `../../packages/extension-sdk` 加入 Client project references，并核对所有直接 workspace import 与 manifest/reference 三者一致。不要为间接依赖批量补 reference。

**关闭条件**：

- Client 的直接 workspace import 都有对应 project reference；
- 单独执行 Client 增量构建时能按源码依赖顺序识别 SDK 变更；
- 不依赖删除 `dist` 或手工预构建来证明该关系。

## 已核对但不登记为问题

- Workspace Package 依赖图没有发现循环依赖。
- `packages/extension-sdk/extension-host` 虽然物理嵌套在 SDK 目录内，但拥有独立 `package.json`、Package name、入口和 README；这是明确记录的 Package 归属，不是误放。
- `@loom-studio/ui` 对应 `packages/loom-ui`，属于已有命名映射，当前没有证据说明它造成调用错误。
- `apps/studio-server/src/main.ts` 文件较大，但其组合根职责与 Server README 一致；本轮不因行数单独要求拆分。
- `apps/studio-server` 对 `@loom-studio/secret-store` 缺少直接 reference 的观察未升级为问题，因为它可以通过 `application-runtime` 的 project reference 传递到达，当前证据不足以证明构建遗漏。
- `scripts/` 中若干工具直接读取 Package `src/index.ts`，属于内部工具入口边界观察项；本轮没有证明它会影响生产构建或公共运行时合同。
- Knip 报告的未使用导出、类型和动态注册入口没有批量登记；其中包含 SDK 公共合同、测试入口和动态 Extension / UI 注册，必须逐项确认真实消费者。

## 验证记录

- 阅读 `docs/guide/`、`docs/architecture/`、各 Workspace README，以及现有前后端架构审计。
- 静态扫描 Package manifest、TypeScript references、workspace import、Client 层级 import、源码命名和 Package 依赖图。
- `pnpm exec tsc -b apps/studio-client --dry --verbose`：完成只读构建计划；确认 Client 项目图未列出 `packages/extension-sdk`。
- `pnpm exec knip --reporter compact`：发现若干未使用文件/导出候选；未将 Agent、CodeAct、SDK 动态入口和测试入口直接视为缺陷。
- 未运行全仓 build、lint 或 test；本 Issue 不把未执行的检查描述为通过。
- 当前工作区存在大量哥哥未提交的改动；本轮没有覆盖、回滚或格式化业务代码。

## 不纳入本轮

- Agent、CodeAct、Agent Runtime、Provider Step、Transcript、Narrative Projection 和 VFS 行为；
- 仅凭文件长度、`utils`/`types` 文件名或导出数量提出重构；
- 尚无实际调用者的未来 Package 拆分方案；
- 浏览器视觉验收、运行时性能和真实 Extension 加载行为。

