# Prompt Resource 有序文件树与笼中深度 (Ordered File Tree & Caged Slot) 实施计划

> **状态**：Archived / Fully Implemented (已全部落地归档) / Architecture Modernization  
> **日期**：2026-08-30 (归档于 2026-09-03)  
> **前置讨论**：[`docs/workbench/discussion/application/prompt/ordered-file-tree-and-anchor-slot-v0.md`](../../workbench/discussion/application/prompt/ordered-file-tree-and-anchor-slot-v0.md)  
> **取代计划**：[`docs/archive/plans/prompt-resource-projection-workbench-v0.md`](./prompt-resource-projection-workbench-v0.md)  
> **后续计划**：原规划中的 Phase 5（本地文件双向同步）因涉及复杂的元数据组织、Anchor 物理表现形式与冲突仲裁，已拆分至独立提案 [`docs/workbench/plans/workspace-dev-sync-plan.md`](../../workbench/plans/workspace-dev-sync-plan.md)  
> **核心目标**：废除臃肿的 `Zone -> InjectionGroup -> RankKey` 多层间接体系，将 PromptBuild 与资源编排收束为**“预设即有序文件树 + 笼中深度（Caged Depth）”**的极简架构，完成前后端合同闭环。

---

## 1. 架构范式转移 (Paradigm Shift)

### 1.1 核心公理

1. **预设的本质即有序文件树**：预设不是多维空间映射，而是一棵标准的有序树。最终 Prompt 的输出顺序即该树的深度优先遍历（DFS）结果。
2. **强类型节点（一切皆 Node）**：
   - `Folder`（文件夹）：纯分类折叠，无注入与文本语义，排版由 `order_index` 确定；
   - `Entry`（原生条目）：预设作者撰写的固定提示词文本，排版由 `order_index` 确定；
   - `Anchor`（注入锚点，`kind === 'virtual'`）：预设作者留出的语义孔位（如 `@style.card`），在树中拥有固定的 `order_index`，实现对外部内容的精准物理包裹；
   - **剔除历史遗留的 `order` 节点**：彻底废弃早期过渡性的 `kind: 'order'` 实体节点，所有同级节点的物理排序完全由树上同级兄弟节点的 `order_index` 决定，不保留向下兼容包袱。
3. **分级嵌套排序（笼中深度 1~9999）**：
   - 外部来源（角色卡、世界书、插件）注入到指定 `Anchor` 后，在运行时自动聚合为 `Slot`（来源块）；
   - `Slot` 内部的子条目使用 `local_depth: 1~9999` 进行局部排序；
   - 外部条目无论深度如何设置，其影响均被严格限制在目标 `Anchor` 内部，绝对无法越界打乱预设层的原生条目排版。

### 1.2 多根大一统视图与底层解耦边界 (Multi-root Unified UI & Domain Boundary)

1. **底层数据严格分治**：
   - **Prompt Resource**（SQLite `prompt_resource_nodes`）仅且绝对仅用于承载文本类大模型提示词节点。绝不包含任何虚拟的图片链接节点或插件文档代理节点，保持领域模型纯洁。
   - **Assets & Media**（BlobStore `source_artifacts`）和 **Extensions**（本地磁盘 `manifest.json` / `README.md`）保持天然的扁平存储或原生物理目录。
2. **所有权与挂载（Timeline 枢纽）**：
   - 卡片（Card Bundle）导入时解包，提示词部分初始化为全局 `PromptResource`，资产部分初始化为全局 `Asset`；
   - 最终决定谁活在当前上下文的，是会话级枢纽 `Timeline` 及其 State Bindings。
3. **前端大一统视图（Workspace Shell UI）**：
   - 前端左侧资源管理器采用多根目录（Multi-root Workspace）架构；
   - 一个通用的 `Tree UI` 组件向多个不相干的后端 Provider（Prompt Store, Extension API, Asset API）并行拉取数据；
   - 依靠统一定义的纯前端接口（如 `WorkspaceTreeNode`）展示统一视觉，并依靠基于 URI Scheme 的前端路由分发器，在点击时调用不同的右侧阅读器（文本编辑器、图片浏览器、Markdown 渲染器）。
4. **虚拟文件系统 (VFS) 与动态扩展名映射**：
   - **底层纯洁性**：数据库 `label` 字段保持原本名称（不强制存扩展名），依靠 `kind` 字段区分文本和虚拟锚点。
   - **VFS 虚拟映射**：向外部（前端 UI 或 LLM Tools）暴露文件列表时，VFS 层依据 `kind` 动态推导并附加扩展名：
     - `kind: 'entry'` ➔ 统一映射为 `.md`（如 `条目.md`），确保 AI 能够利用通用世界知识进行 Markdown 解析；
     - `kind: 'virtual'`（Anchor 锚点）➔ 统一映射为 `.virtual`（如 `preset.virtual`），**彻底摒弃 `.json`**，消除了误导。
   - **基于 ID 的路径解析**：工具调用层绝不采用“字符串剥离后缀查库”的方案。所有基于路径的工具请求（如 `read_file('/设定/爱丽丝.md')`），必须在内存树中通过层级遍历找到匹配的虚拟名称（Virtual Name），获取其底层的节点 `id`（UUID），最后完全通过 `id` 对数据库进行绝对精准的数据读写。

---

## 2. 工程化调研与修改清单 (Engineering Touchpoints)

### 2.1 数据库与存储层 (`packages/prompt-resource-store`)

- **修改** `src/schema.ts`：
  - `prompt_resource_nodes`：继续复用现有表结构，确认 `kind` 包含 `entry | folder | virtual`（`virtual` 承载 Anchor 语义，通过 `meta` 或 `label` 标明注入别名如 `@style.card`）。
  - `global_setting_mounts` 与 `preset_tool_mounts`：将原有 `content_order_hint` 明确为 `local_depth` (INTEGER / REAL)；`content_rank_key` / `content_slot` 标记废弃。
- **修改** `src/mounts.ts`、`src/types.ts`、`src/mutations.ts`：
  - 收敛 Mount 结构中的字段，移除复杂的 `slotKey` / `rankKey` 拼接逻辑，直接绑定 `targetAnchor` 与 `localDepth`。

### 2.2 Application Runtime 编译管线 (`packages/application-runtime`)

- **修改** `src/prompt/prompt-builder.ts`：
  - 数据模型中移除 `ProjectionOrderProfile` 和 `slotRanks`；
  - 引入简洁的 `AnchorNode` 与运行时聚合的 `SlotBlock` 表达；
  - 废弃 `materializeSlotKey` 等旧投影辅助函数。
- **重构** `src/prompt/prompt-build-pipeline.ts`：
  - 简化 `materializePass` 与 `orderPass`：
    1. 收集 Preset 树节点；
    2. 读取激活的 Mounts，按目标 Anchor 聚合并按 `local_depth` 进行局部排序；
    3. 单次线性 DFS 遍历产出最终的有序 `PromptFragment[]`；
    4. 生成 Trace 审计记录。
- **修改** `src/runtime/prompt-runtime.ts` & `src/cards/workspace.ts`：
  - 清理 `slotRanks`、`orderProfile` 校验与更新逻辑，简化节点移动与排序 Mutation。

### 2.3 Studio Server RPC (`apps/studio-server`)

- **修改** `src/rpc/handlers/application/workspaces.ts`：
  - 移除对 `slotRanks` 的序列化与反序列化校验。

### 2.4 Studio Client 前端与 UI (`apps/studio-client`)

- **保留与归档现有 ProjectionRunlist**：
  - 现有 `apps/studio-client/src/features/context-assets/ui/projection-runlist/` 作为历史复杂视图代码予以保留，不直接物理删除，但解除其作为主视图的强耦合。
- **统一 Workbench 视图至 FileTree**：
  - `context-asset-workbench.tsx`：全面切换为基于 `FileTree` 的树状视图；
  - 规范 `FileTree` 节点图标表达：
    - `Anchor`（`kind === 'virtual'`）：显示专属锚点图标（`Anchor`）；
    - `Slot`（运行时挂载来源块）：**不渲染任何图标**（返回 `null`），保持出处包裹层的视觉纯粹度；
    - `Timeline` 基础图标统一为 `git-commit-horizontal`，侧边栏导航为 `folder-git-2`，单条时间线记录为 `rotate-ccw-clock`；
  - **弹性自适应容器（Flexbox）**：将 `FileTree` 行容器从硬编码的 16px 网格升级为弹性 Flexbox 布局，确保无图标节点（如 Slot）标题文字拥有完整展示空间，绝不被固定网格截断；
  - 简化 `context-assets/model/`：移除 `projection-order.ts` 中的复杂多层排序逻辑（`zoneOrder` / `slotOrder` / `rankKey` 矩阵），改为简单的树形状态派生。

---

## 3. 分阶段实施路线 (Implementation Phases)

```text
[x] Phase 1: Schema & Mount 模型清理与 order 节点剔除
  -> 移除冗余的 slotRanks、RankKey，明确 Anchor 语义与 local_depth。
  -> 彻底清理早期残留的 kind: 'order' 节点，兄弟节点顺序完全由 order_index 决定。
  -> 完成 packages/prompt-resource-store 的数据库和类型改造。

[x] Phase 2: PromptBuild 编译管线重构
  -> 废除矩阵投影逻辑，改为“基于有序树的 DFS 遍历 + 笼中深度局部聚合”。
  -> 重写 packages/application-runtime 下的 Pipeline 与 Runtime。

[x] Phase 3: 虚拟文件系统 (VFS) 网关建设
  -> 在核心接口层实现基于 kind 的动态扩展名映射（entry ➔ .md，anchor ➔ .virtual，废除 .json）。
  -> 实现工具调用层严格依赖 ID 进行的 Virtual Name 路径解析机制。

[x] Phase 4: Studio Client 多根大一统视图 (Multi-root Shell) 与体验闭环
  -> 废弃旧的 ProjectionRunlist 面板（仅作历史归档保留）。
  -> 彻底将工作台升级为多根目录的 Tree UI，实现基于 URI Scheme 的前端资源路由分发。
  -> 落地无图标 Slot、锚点专属图标、Timeline 基础图标收敛与自适应弹性树节点排版。
```

> **注**：原规划中的 Phase 5（本地开发化同步 Workspace Dev Sync）已独立拆分为 [`docs/workbench/plans/workspace-dev-sync-plan.md`](../../workbench/plans/workspace-dev-sync-plan.md)，作为后续专属方案推进。

---

## 4. 验证计划 (Verification Plan)

### 4.1 Automated Tests
- `tests/unit/prompt-builder/compiler.test.ts`：测试包含 Anchor 的预设树与多个不同 `local_depth` 的外部挂载，验证 DFS 编译结果顺序完全符合预期；
- `tests/integration/application-runtime/prompt-resource-runtime.test.ts`：验证完整 Agent Turn 中的提示词组装与 Trace 记录；
- `pnpm run test:unit` 与 `pnpm run check:docs` 保持 100% 通过。

### 4.2 Manual Verification
- 在 Studio Client 中打开一个 Preset 资源，添加“`文风(头)` -> `Anchor(@style.card)` -> `文风(尾)`”；
- 挂载包含不同 Depth 的两张角色卡，展开 Anchor 确认预览效果正常，点击编译验证生成的 Prompt 文本包裹完好。
