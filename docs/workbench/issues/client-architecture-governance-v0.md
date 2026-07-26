# Client 架构债务清单 v0

> **状态**：Open Issues
> **最后核对**：2026-07-23
> **适用范围**：`apps/studio-client/src`

本文只记录当前代码中仍存在、且需要先讨论领域归属再修改的问题。已经稳定的工程规则以 `docs/guide/` 为准，不在 Issue 中重复维护。

## 已从旧议题关闭

旧版文档中的以下工作已经完成，因此不再作为待办保留：

- raw `bridge.call()` 已收口到 typed API client；
- `useStudioState` 已拆出 Cards、Session Runtime、Provider Settings、Context Assets、Renderer 等 feature hooks；
- Context Assets 的 tree、normalization、projection order、projection view 等算法已迁出 widget；
- `ApiPanel` 已拆出 Provider Account 与 Model Profile 列表；
- Client 源码文件已统一为 kebab-case；
- 测试目录和对应 Guide 路由已经建立。

上述边界现在由以下文档维护：

- `docs/guide/project-structure.md`
- `docs/guide/code-review.md`
- `docs/guide/code-style.md`
- `docs/guide/ui-design.md`

## P1：领域归属需要先定名

### 1. `context-assets` 已超出 Context Asset CRUD

当前目录同时承载：

- Context Asset 树与持久化编辑；
- Projection Order / Projection View；
- Activation 与 lifecycle capability 编辑；
- Context Workbench 和 Preset Workbench 共用的 prompt composition view-model。

这不一定需要拆成更多目录，但 `context-assets` 已不足以准确描述全部职责。需要先决定这些能力属于：

1. 更上层的 Prompt Workspace / Prompt Composition feature；或
2. Context Asset 的完整编辑能力，继续保留现名；或
3. Context Asset 与 Projection / Activation 两个边界。

在术语确定前，不做批量移动。关闭条件是目录名、公开入口和两个 Workbench 的依赖方向能用一句话解释清楚。

### 2. Provider、Model 与 Agent Runtime Profile 边界混合

当前证据：

- `features/provider-settings/model/use-provider-settings.ts` 同时管理 Provider Account、Model Profile 和 Agent Runtime Profile；
- `entities/provider.ts` 定义了 `AgentRuntimeProfile`；
- `widgets/preset-workbench/agent-runtime-manager.tsx` 管理 Agent Runtime Profile UI。

需要先决定 Agent Runtime Profile 更接近 Provider Settings、Preset，还是独立的 Agent Runtime feature。关闭条件是 entity、state hook 和 UI 三处使用同一领域归属，不再靠跨目录位置暗示不同答案。

## P2：随下一次相关功能收敛

### 3. `app/utils.ts` 混合三个 UI concern

文件同时包含 Composer 提示、Timeline 空状态和 Run Inspection 数据读取。当前只有少量纯函数，不值得立刻增加文件；下一次任一 concern 增长时，应把函数移到对应 feature model，而不是继续向 `app/utils.ts` 追加。

### 4. Renderer PoC 的最终归属未定

当前同时存在 renderer entry、SDK、typed API、feature hook、resource widget 和 rendering lab。PoC 阶段允许这种形态；进入正式 Renderer 产品化前，需要决定哪些是平台 SDK、哪些是 Studio 调试工具、哪些是最终用户功能。

### 5. 交互元素的语义与可访问性未统一

当前仍有 `<header onClick>`、`<div onClick>`、`<span onClick>`。这会缺少键盘操作、焦点语义和默认可访问性。

处理顺序：

1. 新代码优先使用原生 `button`；
2. 修改相关组件时顺手替换现有非语义交互元素；
3. 形成稳定模式后再引入 `jsx-a11y` 门禁，避免一次性噪声改造。

## 本轮明确不做

- 不因文件行数单独拆组件；
- 不创建 Base Hook、通用 Feature Factory 或新的状态框架；
- 不在领域术语未确定时批量重命名目录；
- 不把 widget 的局部 tab、展开状态和轻量渲染映射强行抽离。
