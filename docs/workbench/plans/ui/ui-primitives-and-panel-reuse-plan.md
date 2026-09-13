# UI 基础控件与面板复用收敛计划

> **状态**：Draft / 调研已记录，待实施
> **日期**：2026-09-13
> **本轮授权**：只编写 Plan 和更新索引，不修改 UI、依赖、公共 SDK 或业务行为。
> **目标**：让原生工作台和扩展管理面板复用一套小而明确的控件及组合规则，减少局部重复实现；扩展作者接入方式另行收口，不把内部组件直接升级为公共 SDK。

## 1. 当前判断与依据

问题不是完全没有 UI 底座，而是基础样式、共享组件和业务局部实现之间缺少明确的选择规则。不能把出现原生 HTML 元素、局部 CSS 或不同按钮尺寸直接认定为缺陷。

以下路径相对仓库根目录，记录的是调研时工作区现状，包含尚未提交的其他 UI 修改，不代表均已合入提交。

| 层级 | 已确认事实与证据 | 对实施的约束 |
| --- | --- | --- |
| 全局基础 | `apps/studio-client/src/styles/global.css` 已有原生 button/input/select/textarea/checkbox 样式，以及 `.loom-page-tabs`、`.loom-underlined-fields` | 先核对继承和覆盖关系，不新建第二套主题或重复基础样式 |
| 共享控件 | `apps/studio-client/src/shared/ui/` 已有 Toggle、Dialog、菜单、StatusIndicator、Skeleton、通知、编辑器等；没有独立 Button/Input/Select React 组件 | 优先补真实缺口；原生元素仍是实现基础，不追求全部包装 |
| 浮层 | DropdownMenu/ContextMenu 基于 Radix；Dialog 基于原生 `<dialog>`，已有关闭、焦点恢复与 ARIA 接线 | 不推倒重写；统一触发器、按钮和操作区时保留现有行为 |
| 布局 | MasterDetailWorkbench 复用 WindowColumnLayout，另有 AssetWorkbenchLayout | 不另造分栏、resize 或移动下钻体系；列表内容不同不代表布局重复 |
| 预览 | `apps/studio-client/src/dev/preview/` 已有注册入口及业务样例 | 在现有入口补基础控件状态样例，不引入平行预览宿主 |
| 扩展 | `packages/extension-sdk/src/index.ts` 和 `features/extension-renderers/ui/renderer-surface-host.tsx` 定义 surface、context 和 direct/shadow/sandbox-iframe 挂载 | 挂载协议不等于组件 SDK；同源也不意味着已支持共享 React 运行时 |
| 主题规范 | [CSS 与主题合同](../../../architecture/ui/css-and-theming.md) 已规定 tokens、公共 CSS hook 与隔离边界 | 不能把 CSS Modules 类名作为公共 API；当前没有 iframe token 注入合同 |

此前讨论中的“缺少底层基础”“必须提供 React 共享包”“所有字段都必须包装”等表述不作为已确认事实或实施要求。

## 2. 重复实现与迁移候选

表中是有源码依据的候选，不是无条件批量替换清单。实施前核对同一行为的状态、语义和调用者，记录保留理由。

| 候选 | 主要证据路径（均位于 `apps/studio-client/src/`） | 建议处理 |
| --- | --- | --- |
| 普通与图标按钮 | `features/text-transforms/ui/text-transform-panel.module.scss` 的 primary/secondary/dangerButton；`features/state-variables/ui/state-variables-panel.module.scss` 的 iconButton/primaryActionBtn；`widgets/model-panel/model-panel.module.scss`；`widgets/character-panel/card-resource-overview.module.scss` | 优先统一按钮语义、尺寸、焦点、禁用态；局部 CSS 只保留布局职责 |
| 共享组件内部的按钮 | `shared/ui/media-viewer/image-viewer.module.scss` 的 toolbar button；`shared/ui/dialog/dialog.module.scss` 的 actions；`shared/ui/master-detail-workbench/master-detail-workbench.tsx` 的返回按钮 | 基础组件稳定后再迁移，不只治理业务面板 |
| 字段与表单控件 | `features/state-variables/ui/state-authoring-panel.tsx` 的 TextField/SelectField/NumberField/YamlField/CheckboxField；`widgets/model-panel/`、`widgets/agent-panel/` 的表单 | 提取通用视觉和 label/error 关联；保留领域解析、数值提交和 Schema 逻辑 |
| 搜索框 | `features/context-assets/ui/context-asset-search/`；`features/text-transforms/ui/pipeline-workbench-view.tsx`；`widgets/preset-workbench/`；`widgets/log-viewer/` | 对比搜索图标、清除和标签行为，按相同契约提取 SearchField；过滤算法归原模块 |
| 选项切换 | `widgets/log-viewer/log-viewer.tsx` 的 sourceControl；`widgets/character-panel/character-panel.module.scss` 的页签；`dev/preview/component-preview-app.tsx` 和背景样例 | 先区分页面导航、Tabs、单选分段控件和独立 toggle，再统一同类行为 |
| 开关 | `shared/ui/toggle/toggle.tsx` 已是 role=switch；`dev/preview/background-materials-preview.tsx` 自绘 switch；多处使用原生 checkbox | “即时开关”与“表单多选”分别处理；不能把全部 checkbox 换成 Toggle |
| 状态与错误 | `features/state-variables/ui/` 与 `features/text-transforms/ui/` 的 emptyState/errorBanner/badge；`features/extension-renderers/ui/renderer-surface-host.tsx` 的失败文案 | 区分空结果、加载、字段错误、操作失败、运行状态；不合成万能状态组件 |
| Dialog 编排 | `widgets/character-panel/card-resource-overview.tsx`、`shared/ui/media-viewer/image-viewer.tsx` 的 headerActions；其他调用方的 actions | 复用按钮，明确关闭入口和忙碌状态；不擅自改变取消、删除确认或关闭语义 |
| 导航列表与详情头 | `features/state-variables/ui/state-authoring-panel.tsx` 的 NavItem；`features/text-transforms/ui/text-transform-panel.tsx` 的 navItem；`features/extension-renderers/ui/renderer-workspace-panel.tsx` 的 treeItem | 只有相同布局和交互确有重复才提取小模式，领域树、分组和选择状态保留 |
| 结构化文本输入 | `features/text-transforms/ui/text-transform-panel.tsx` 的 rawJsonTextarea；`features/state-variables/ui/state-authoring-panel.tsx` 的 YAML 输入；已有 LongTextEditor | 核对编辑器能力和提交契约；不为统一外观强制加载复杂编辑器 |

尚未完成官方扩展内部所有 DOM/CSS 实现的逐文件盘点；本表的 extension-renderers 主要是宿主侧管理和挂载 UI，不能描述成已审计全部扩展页面。

## 3. 范围与非目标

本计划承接内部小控件、必要组合模式、代表性面板迁移、使用规范和预览样例。概念上区分基础控件与组合模式，但沿用 `shared/ui/<component>/` 目录，不为层级命名先移动全部现有文件。

- 保留 React、SCSS Modules、CSS Custom Properties、Lucide 和已有 Radix 菜单；不默认引入 Tailwind、Shadcn 安装器、Storybook 或新组件框架。
- 保留现有视觉合同，包括透明图标按钮、短字段下划线、长文本浅表面、主题与界面缩放；不套用外部组件库的默认外观。
- 不新增万能表单、UI DSL、配置数据库、状态管理器或 Schema 渲染体系。
- 不修改 RPC、业务持久化、权限、渲染器隔离和 Surface 身份；不重构业务 hook。
- 不全面迁移 Shell、消息、文件树、日历、游戏或地图。媒体、复杂编辑器和领域控件不能仅因使用原生元素被替换。
- 不预建完整 Card、ScrollArea、Popover、Slider 等目录。只在现有调用者证明收益时增加；原生滚动、范围输入和 details 可满足需求时继续使用。

## 4. 工作包与实施顺序

### WP1：基础控件及现有样式收敛

**状态：待实施。** 首批候选为 Button/IconButton、Input/Textarea/NativeSelect、Field；其余按 WP2 的真实消费者补齐。

写集：`apps/studio-client/src/shared/ui/` 中本次明确新增的控件目录、`styles/global.css` 中与这些控件直接相关的规则，以及现有 `dev/preview/` 注册表和新增基础控件样例。不重排无关 CSS。

要求：

- 原生属性、ref、事件和表单语义可以正确透传；通用按钮默认不意外提交表单，显式 submit 仍可用。
- variant/size 只覆盖已有需求，不预先固定三档尺寸和完整状态枚举；hover/focus/disabled 优先用原生状态。
- IconButton 必须有可访问名称；tooltip 的键盘/悬停行为先核对原生能力和现有依赖，复杂浮层不手写新的定位和焦点系统。
- Field 处理标签、说明及错误的关联，不拥有业务校验、默认值、保存或重试；支持现有嵌套 label，不强迫所有简单字段改写。
- 保留全局基础对尚未迁移页面的支持，防止局部组件化反向改变全站样式。

完成条件：预览直接复用生产控件，覆盖适用的禁用、焦点、错误、选中和长标签状态；至少两个真实消费者能复用同一接口，不通过逐页新增 variant 模拟旧 CSS。

### WP2：代表性面板迁移与必要小模式

**状态：待实施，依赖 WP1。**

首轮写集：`features/text-transforms/ui/` 与 `features/extension-renderers/ui/renderer-workspace-panel.tsx`、对应 SCSS、`official-content-detail.tsx`。第二轮再进入 `features/state-variables/ui/`、`widgets/model-panel/`、`widgets/log-viewer/`。所有路径均位于 `apps/studio-client/src/`。

按每轮实际重复提取 SearchField、状态展示、Tabs/SegmentedControl 或详情头；不要为了满足清单机械创建 FilterBar、InspectorSection 等包装。新增国际化键仅修改 `shared/i18n/zh-cn.ts`、`en-us.ts` 的相关内容。

每个迁移项记录旧实现、共享入口、保留的领域行为和删除的局部样式。尤其保留 dirty/busy、onBlur/onChange、数值空值、键盘导航及原生 select 行为。Tabs 的 ARIA、焦点移动和面板关联应整体实现，不能只替换样式。

完成条件：代表性面板使用共享控件；确认失去引用的旧样式被删除；业务保存、选择、刷新、删除确认和未保存草稿语义不变。`character-panel`、`preset-workbench`、共享编辑器及其他面板列为后续候选，不自动加入本轮写集。

### WP3：规范与预览成为复用入口

**状态：待实施，随 WP1/WP2 更新。**

写集：`docs/guide/ui-design.md`、`apps/studio-client/README.md`、`apps/studio-client/src/dev/preview/`、本 Plan 与索引。仅在已有合同真实变化时更新对应 UI Architecture 文档。

- 文档提供组件名称、真实 import、适用语义、状态样例及允许保留原生实现的例外，不只描述审美原则。
- 将 shared/ui “绝对无状态”澄清为“不拥有领域数据与业务流程”；焦点、展开等控件交互状态可以由组件拥有。
- 原生控件可在 primitive 内部、特殊领域控件和没有相应共享能力时使用；不新增禁止所有原生标签的粗暴 lint 规则。
- 在现有开发预览中注册基础控件目录，支持窄容器、长文案及适用状态；保留内存数据和生产隔离，不另建宿主。
- 示例必须复用同一实现，不能把预览中的自绘控件当作新的推荐模板。

完成条件：后续开发者可通过一个明确入口选择控件，规范与实际 API 一致；已迁移与尚未迁移区域可识别。

### WP4：扩展作者复用合同收口

**状态：只读合同设计待办，未授权公共 API 实施。**

与 [Extension DX 计划](../extension-developer-experience.md) 第 3 节共同管理：本计划负责内部控件基础与复用样例，DX 计划负责页面贡献、声明式设置、Config 权限和保存闭环。不得建设两套作者表单协议。

调研入口：`packages/extension-sdk/src/index.ts`、`apps/studio-client/src/features/extension-renderers/`、官方扩展的实际 client 入口，以及 [Client Renderer Host](../../../architecture/extensions/client-renderer-host.md)。

交付：选择一个真实扩展，记录 adapter、依赖加载、样式继承、生命周期和现有重复控件；比较按需发布组件、CSS/DOM 样板或宿主提供控件等最小路径，提交一个有证据的推荐方案。

必须区分 direct、shadow 与 iframe：shadow 不继承普通全局选择器；iframe 不能直接取得宿主样式或 React 组件。是否同步 tokens、分发组件、共享 React、提供声明式控件，均为待确认公共合同，不在此预设答案。不改变 sandbox 权限以便利 UI 复用。

完成条件：公共组件的消费者、加载方式、样式边界和维护承诺明确，并由哥哥确认后才冻结精确写集及实施验收。当前内部迁移不依赖此决策。

## 5. 验证预算与完成条件

本轮文档只检查相关 Diff、证据路径、相对链接与状态一致性，不运行 UI 测试或构建。

实施时每个工作包先指定一项主要风险和最小验证：

| 改动 | 主要风险 | 最小证据 |
| --- | --- | --- |
| 控件事件和表单语义 | 意外提交、disabled 仍触发、事件/ref 丢失、标签未关联 | 使用现有测试能力的定向 runnable check，验证真实事件与 DOM 关系 |
| Tabs/浮层交互 | 键盘与焦点退化 | 定向键盘/焦点诊断；没有适用 DOM 环境时使用客观浏览器诊断，不以静态类型替代 |
| 面板迁移 | 保存触发时机、dirty/busy 或选择行为改变 | 对该面板一次真实交互的聚焦验证；纯样式替换只核对 Diff 和相关选择器 |
| 共享 TS 接口 | 消费者类型不兼容 | Client 定向类型检查，不默认跑整个仓库 |
| 预览入口/导出变更 | 开发样例进入生产、误触业务启动 | 仅在这些边界变化时检查相关产物和副作用，复用已有可信证据 |
| 视觉与布局 | 长文案、窄面板、缩放或主题下难用 | 哥哥人工验收；自动化与客观浏览器诊断单独记录 |

不默认串行执行 lint、test、typecheck、build。已有可信结果不重复执行；未覆盖的业务流程、扩展 adapter 和主题必须写明未验证。

## 6. 开放问题与停止条件

- 内部控件可在既定视觉和业务合同内自行确定最小 Props；若必须改变全局视觉、交互语义或新增依赖，先向哥哥说明具体证据与影响。
- 外部组件包、React 运行时共享、iframe token 协议和声明式设置仍由哥哥确认，不因内部组件可用而自动发布。
- 当前多个候选文件存在其他任务修改。实施前读取最新内容，只增量协作；发现并行修改并不构成回滚或覆盖授权。
- 规范更新不是要求重写所有 UI；首轮收益不足的候选可以保留，记录事实理由，不制造无收益包装。

## 7. 进度与交付记录

- [x] 记录内部组件与局部实现的调研证据，并修正“没有全局基础”和“已具备 React 扩展复用路径”的过度结论。
- [x] 写入本 Plan，并加入施工索引。
- [ ] WP1 基础控件与状态样例。
- [ ] WP2 代表性面板迁移。
- [ ] WP3 使用规范与实际预览入口同步。
- [ ] WP4 扩展公共合同调研与决策。

当前没有 UI 实施、运行测试、浏览器诊断或人工视觉验收结果。剩余风险是全局 CSS 与局部覆盖的迁移影响、不同控件语义误合并，以及扩展作者公共合同尚未冻结。后续交付在本节补实际偏差、验证结果及保留项。
