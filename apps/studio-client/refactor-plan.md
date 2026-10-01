# 资源面板重构计划 (Macro & State)

## 背景问题
目前 `MacroAuthoringWorkbench` 和 `StateAuthoringPanel` 被设计为只能传入单个 `Card`，无法读取和编辑当前上下文中来自 Preset（预设）、Workspace（全局）和 Extension（扩展）的定义。这导致如果卡片上没有特地写这些配置，面板就显示为空，违背了“上下文资源导航”的直觉。
此外，Settings（原 Context Workbench）因为历史原因保留了“全部资源”视图，作为侧边栏的上下文面板显得不合适。

## 重构目标
1. 统一多数据源接入：使 Macro 和 State 面板能够聚合和展示当前生效的所有上下文源（Card, Preset, Workspace, Extension）。
2. 树状视图分组（UI 改造）：在左侧导航树中按来源进行分组，让用户可以清晰地看到某个宏或状态定义是从哪里来的，并且可以直接选中不同来源的节点进行编辑。
3. 修正 Settings 面板：移除 Settings 面板的 `all`（全部）选项，专注于 `current`（当前生效）与 `global`（全局默认）。

## 实施步骤

### 步骤一：修正 Settings (Context Workbench) 视图范围
1. 修改 `apps/studio-client/src/widgets/context-workbench/context-workbench.tsx`。
2. 在 `<PanelTabs>` 中移除 `all` (全部) 选项卡。
3. 清理掉与之相关的无效资源列表展示逻辑。

### 步骤二：重构 Macro (宏) 面板
1. **抽象数据源结构**：在 `MacroAuthoringPanelProps` 中，不再只接收 `card`，而是接收一个数组形式的数据源 `sources`。
   ```typescript
   export type AuthoringSource = {
     id: string;
     kind: 'card' | 'preset' | 'workspace' | 'extension';
     label: string;
     macros: Record<string, string>;
     macroOptions?: MacroOptions;
     readonly?: boolean;
   }
   ```
2. **改写 MacroAuthoringExplorer**：按来源建立一级目录节点，在每个来源下展开对应的宏列表。
3. **适配保存回调**：改造 `onSave` 方法，根据当前选中的节点所属的 `ownerId`，分发到不同的更新 API 上（比如更新 Card 或是更新 Preset/Workspace）。
4. **修改顶层调用处**：在 `StudioMacroPanel` 或更高层的 Controller 中，注入当前的 Card, Active Preset 和 Workspace 资源作为 `sources`。

### 步骤三：重构 State (状态) 面板
1. **抽象数据源结构**：类似于 Macro，在 `StateAuthoringPanelProps` 中引入 `sources`。
   ```typescript
   export type StateAuthoringSource = {
     id: string;
     kind: 'card' | 'preset' | 'workspace' | 'extension';
     label: string;
     config: CardStateConfig; // 提取出来的状态配置类型
     readonly?: boolean;
   }
   ```
2. **改写 AuthoringMaster (FileTree)**：在最顶层按照来源（卡片、预设、全局）建树，每个来源内保留原有的分组（Entity Types, Entities, Templates 等）。
3. **适配 YAML 源码与编辑逻辑**：当选中某个来源的子节点（如“预设”下的 Entity Type）时，右侧详情和 YAML 源码编辑器只针对该来源的 `config` 产生作用。保存时根据来源分发更新。
4. **修改顶层调用处**：在 `StudioStatePanel` 注入当前生效的卡片、预设和全局资源。
