# Issue: 前端渲染性能与状态留存专项审查

日期：2026-09-21  
状态：Open Issues  
范围：`apps/studio-client`  
补充审查：2026-09-22，纳入 Agent 面板、对话显示和工具折叠 UI；不进入 Agent 执行器。  
非目标：CodeActor、Agent 执行器、服务端数据层、视觉主观验收

## 结论摘要

本轮集中审查前端作为渲染层和客户端体验状态持有者的两个核心职责：

1. 长列表、长文本和资源树是否限制了 DOM、布局读取和重复计算；
2. 本地布局状态、编辑草稿和远端刷新之间是否保持一致。

首轮记录 3 项；折叠与 CSS 补查增加 6 项；2026-09-22 数据与渲染身份链补查增加 3 项，编辑模式生命周期、引用深链接和搜索摘要补查各增加 1 项，共 15 项。性能成本、源码可确认的行为缺陷与尚待浏览器复现的视觉现象分别记录，不把静态审查当作帧率测试。

## FRONTEND-001：Narrative Timeline 没有对正文做窗口化渲染

优先级：P2

`use-narrative-runtime.ts` 每次读取 100 个节点，并支持通过 `loadOlderNodes()` 持续把更早节点追加到本地数组。`narrative-timeline.tsx` 随后对 `props.timeline` 全量执行 `map`，每条消息都创建 Markdown 渲染节点；存在 Renderer Host 时还会额外挂载 `RendererNodeMountHost`。

滚动时 `scheduleActiveEntryUpdate()` 通过 `requestAnimationFrame` 遍历全部 `props.timeline`，对每个已挂载消息调用 `getBoundingClientRect()`，再选出距离阅读线最近的节点。这会在长时间线中形成：

```text
历史加载 -> timeline 数组无限增长
         -> 全量 Markdown / Renderer DOM 常驻
滚动     -> 每帧线性布局读取所有消息
```

现有导航器只窗口化右侧刻度条，不等于消息正文虚拟化。正文仍会随历史增长而增加 DOM、Markdown 解析结果和 Renderer 实例。

证据：

- `apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts:594-605`
- `apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.tsx:66-71`
- `apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.tsx:264-344`
- `apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.tsx:202-229`

关闭条件：

- 正文使用经过验证的窗口化/虚拟化策略，只保留可见范围和必要缓冲；
- 加载更早节点后保持滚动锚点，不发生跳屏；
- Renderer Mount、编辑、复制、深链定位和 reduced-motion 行为保持正确；
- 用长时间线压力样本验证 DOM 数量、滚动帧耗时和内存趋势。

## FRONTEND-002：Context Asset 未提交草稿会被资源刷新覆盖

优先级：P2

`useContextAssets` 将 `nodesRef` 用作当前草稿，将 `persistedNodesRef` 用作最近一次远端确认状态。输入变更只调用 `applyDraftNodes()`，因此未提交内容只存在于 `nodesRef`。

但根应用在 `promptResources` 查询结果变化时，会重新调用 `contextAssetState.setNodes(...)`。该函数会把规范化后的远端资源同时写入 `persistedNodesRef` 和 `nodesRef`，直接覆盖当前草稿。扩展资源导入/移除、资源列表刷新或其他远端失效都可以触发这条路径。

因此资源刷新会覆盖草稿模型，且没有冲突提示或恢复入口。2026-09-22 补查修正：当前两个工作台的显示投影另有绕过草稿树的问题（FRONTEND-010），不能把模型被覆盖直接等同于所有输入控件的可见内容同步消失。CodeMirror 还有自身文档状态，需要端到端区分显示、草稿模型与落库结果。

证据：

- `apps/studio-client/src/features/context-assets/model/use-context-assets.ts:39-47`
- `apps/studio-client/src/features/context-assets/model/use-context-assets.ts:68-70`
- `apps/studio-client/src/app/use-studio-state.ts:89-91`
- `apps/studio-client/src/app/use-studio-state.ts:135-141`
- `apps/studio-client/src/features/context-assets/ui/context-asset-detail/context-asset-detail.tsx:320-327`

关闭条件：

- 远端刷新不会静默覆盖未提交草稿；
- 已提交的远端结果仍能正确替换对应资源；
- 发生外部版本变化时，界面明确选择保留草稿、放弃草稿或展示冲突；
- 对输入中刷新、提交中刷新和 mutation 失败分别有回归测试。

## FRONTEND-003：Composer Pin 状态没有实际持久化

优先级：P2

`StudioLayoutData`、默认值、读取清洗和 `toggleComposerPinned()` 都包含 `composerPinned`。但 Zustand persist 的 `partialize` 没有写入该字段，因此每次页面刷新或重新加载后，状态都会从 `createDefaultStudioLayout()` 恢复为 `false`。

这不是浏览器存储不可用时的降级，而是正常存储路径漏掉了一个已经对外提供切换操作的字段。

证据：

- `apps/studio-client/src/shared/studio-shell/studio-layout-store.ts:37`
- `apps/studio-client/src/shared/studio-shell/studio-layout-store.ts:127`
- `apps/studio-client/src/shared/studio-shell/studio-layout-store.ts:158`
- `apps/studio-client/src/shared/studio-shell/studio-layout-store.ts:285`
- `apps/studio-client/src/shared/studio-shell/studio-layout-store.ts:305-318`

关闭条件：

- `composerPinned` 写入并从现有布局数据恢复；
- 旧版本布局数据仍能安全清洗；
- 增加一次 store 持久化回归测试，覆盖切换、序列化、重载恢复。

## FRONTEND-004：工具折叠的两个 Effect 相互取消动画

优先级：P2；源码时序缺陷，用户报告的闪烁尚未完成浏览器复现。

`agent-chat-panel.tsx:864-947` 的 `FlipCollapse` 在 `useLayoutEffect` 中创建展开动画，并写入 `animationRef`；同一次 open 更新的 `useEffect` 随后调用 `animationRef.current?.cancel()`，取消的正是刚创建的动画。

从完全关闭展开时，`setRendered(true)` 还会引起后续 layout effect 再启动动画；关闭尚未完成就再次展开时，rendered 已经为 true，则不会依赖这一更新重新启动。两个方向因此不具备一致的中断语义。组件也没有在卸载时取消动画。详情卡另有独立 CSS 入场动画（`agent-chat-panel.module.scss:425-443`），不能仅靠调整一个 duration 解决所有时序问题。

关闭条件：一个生命周期所有者管理动画；快速开关从当前可见高度连续衔接；卸载清理；正常、快速反向切换及嵌套折叠用浏览器逐帧高度/动画状态验证。是否正是用户观察到的全部闪烁原因仍需复现。

## FRONTEND-005：折叠工具组会丢失子项展开状态

优先级：P2

`FlipCollapse` 收起完成后返回 null，卸载工具组内部的 `AgentToolActionItem`。子项开关仅存于组件 `useState(defaultOpen)`，再次展开外层工具组时会重新初始化，之前手动打开的详情和内部滚动位置无法留存。

证据：`agent-chat-panel.tsx:941-947,1012-1013,1114-1124`。另外，单工具变成多工具时的不同组件层级（1087-1124）也会重建原子项。这是组件身份和状态所有权问题，不只是动画问题。

关闭条件：同一会话内，外层折叠/展开及工具追加不丢失既有子项选择；状态按工具稳定 ID 归属，不要求跨浏览器重载持久化。

## FRONTEND-006：Mock 对话与模拟计时器放进生产聊天组件

优先级：P2

`agent-chat-panel.tsx:55` 起直接包含示例数据；503 行以 `props.messages.length === 0` 作为模拟开关，没有开发预览入口限制。506-616 行播放模拟工具和思考过程，618-638 行用 Mock 替换空会话显示。

用户新建空会话时会看到并不存在的对话与工具执行结果，还会启动模拟计时器。这与 `docs/architecture/ui/workspace-shell.md` 的真实数据/空状态合同冲突，也是具体的文件归属错误。

建议把数据和模拟调度放入已有 `src/dev/preview/`，通过 props 驱动正式显示组件；生产 Widget 仅接收真实消息。关闭条件：空会话显示真实空状态，不启动模拟；开发预览仍可显式运行样例。

## FRONTEND-007：Agent 创建失败后表单草稿已经清空

优先级：P2

`widgets/agent-panel/agent-panel.tsx:77-95` 的 `handleCreateSubmit` 调用 `props.onCreate()` 后立即清空名字、预设、模型选择并关闭创建表单。该回调被声明为 void，但 `app/studio-panel-registry.tsx:80` 实际传入异步 `state.createAgentProfile`。

网络或服务端创建失败时，错误虽可由全局操作状态展示，原表单仍已被清空，用户必须重新填写。不是服务器失败本身有问题，而是 UI 在确认成功前丢弃草稿。

关闭条件：明确回调成功/失败结果，仅成功时清空和切换页面；失败保留输入，等待期间防止重复提交。不修改 Agent 执行或模型选择语义。

## FRONTEND-008：消息树行取消了键盘焦点标识

优先级：P2

`shared/ui/file-tree/file-tree.tsx:376-420` 将消息节点作为可通过 roving tabIndex 聚焦的 div treeitem，并应用 `messageBlockRow`。对应 SCSS 368-383 行同时强制去掉 outline 和 box-shadow，没有替代的 focus-visible 样式。全局焦点样式只覆盖 button/input/select/textarea，不覆盖该 div。

因此键盘移动到未选中的消息节点时，焦点与选中状态不一致，用户无法从该行视觉状态定位键盘位置。关闭条件：为 treeitem 提供独立且可见的焦点状态，保留 selected 与 focused 的区别，普通和虚拟树都验证。

## FRONTEND-009：Agent CSS 动画未遵循减少动态效果偏好

优先级：P2

`FlipCollapse` 读取 `useEffectiveMotion()`，但同一模块的块入场、句子入场、工具卡片和持续 shimmer 使用固定 CSS animation（`agent-chat-panel.module.scss:157,216,271,281,437`），没有 reduced-motion 覆盖。

全局 `html[data-loom-motion='reduce']` 仅设置 Shell 的两项时长变量（`styles/global.css:176-179`）；它不能停掉这些固定时长动画。用户在应用中选择减少动态效果后，Agent 内容仍会移动和持续闪动。

关闭条件：这些 CSS 动画和折叠共用有效 motion 偏好；分别验证应用 reduce、跟随系统 reduce，以及运行中切换偏好。

## 文件与样式归属建议

这些是有源码依据的整理建议，不冒充已经造成运行故障：

- Agent Chat 文件同时容纳 Mock 调度、消息分组、Markdown 补全、折叠动画、工具详情和 Profile Picker。优先移出 Mock（FRONTEND-006）；纯显示投影归本 Widget 的 model，独立 UI 归相邻文件。折叠只有一个消费者时留在 Widget 内，不急于扩大 Shared API。
- `features/extension-renderers/ui/official-content-detail.tsx` 及相邻资源命令仍负责默认 Preset/Setting 的安装界面，并复用 Renderer 工作区样式。按用户已确认的“默认内容不是插件”边界，启动自动安装后，前端分类仍未同步。应先决定默认内容的查看/导出入口，再移除扩展页对这份业务的所有权，不只搬文件。
- FileTree 的消息块外观在 Shared 内识别 `kind === 'message'`，且容器 `.row` 后代规则用 important 影响整个子树。应明确这是宿主树的正式变体，还是 Preset 的领域展示；若属于后者，用现有渲染插槽收回领域样式。不是给每个目录机械补 index 文件。
- State/Macro 五个 UI 文件共用名为 `state-variables-panel.module.scss` 的样式。这可以是合法共享，但应区分工作台布局与各面板局部规则，避免改一个面板时无意影响其他消费者；未找到具体冲突前不单列缺陷。

## FRONTEND-010：工作台接收草稿树但不用于详情显示

优先级：P2  
证据等级：当前源码端到端数据流；尚未做浏览器输入复现。

`app/studio-resource-panels.tsx:17-21` 同时把 `state.contextAssets` 作为 nodes、远端 `state.promptResources` 作为 resources 传给两个工作台。`onChangeNode` 只更新前者。

但 `widgets/context-workbench/context-workbench.tsx:117-125` 从 resources 构建 workbenchNodes；`widgets/preset-workbench/preset-workbench.tsx:123-131` 同样从 selectedResource 构建详情树，两者没有消费传入的草稿 nodes。`readPromptResourceWorkbenchRoot()` 也只规范化传入的远端 rootNode，没有读取草稿。

标题 input 的 value 是 `props.node.label`（`context-asset-detail-header.tsx:75-82`），onChange 写草稿，下一次渲染仍得到旧远端 label；元数据 input 同样如此。这使正常的受控输入链无法保留刚键入的值，blur 提交也不能弥补显示源错误。CodeMirror 的内部文档可能仍能输入，不应据此笼统断言整个编辑器无法输入。

最小方向：明确远端基线与编辑草稿唯一的投影合并点，工作台详情必须消费编辑中的节点。不要在每个输入框再建一套重复状态。

关闭条件：标题、元数据和正文在提交前保持输入，提交成功同步远端；切换条目与刷新时遵守草稿策略。与 FRONTEND-002 联合验证，但二者分别是“没有消费草稿”和“刷新覆盖草稿”。

## FRONTEND-011：在途旧查询可以覆盖已经保存的新资源缓存

优先级：P2  
证据等级：当前安装的 QueryClient 纯内存交错探针，加调用链核对。

`features/prompt-resources/model/use-prompt-resource-state.ts:19-29,54-61` 的 queryFn 直接返回列表，mutation 后通过 setQueryData 更新相同 key，未取消在途读或在查询提交时比较资源版本。

可达场景：已有资源可编辑时发生资源库刷新，例如导入后的失效刷新；列表请求读取了旧快照但尚未返回，用户保存节点或宏，mutation 回应先把缓存更新到新版本，旧列表随后覆盖该缓存。版本比较只存在于部分 mutation 的 setQueryData 更新器中，不能约束之后的 queryFn 结果。

探针使用生产采用的 key 形状，先缓存 v1，启动受控 fetchQuery，写入 v2，再 resolve 旧读取 v1，实际结果：

```text
afterSave: [{ id: resource-1, version: 2 }]
afterOldRead: [{ id: resource-1, version: 1 }]
```

此探针证明缓存原语在该交错下的行为；未模拟 HTTP 时序或真实服务端。后果首先是客户端退回旧内容，不应直接声称服务器数据已经丢失。

最小方向：协调 mutation 与相关查询的提交顺序，取消过期读或采用经过验证的版本合并策略。资源集合还包含新增/删除，不能只按版本取最大值而复活已删除项。

关闭条件：旧读取晚到不会覆盖已确认的保存；新增、删除和挂载变更也有一致缓存结果。

## FRONTEND-012：Markdown 重渲染会改变代码块组件身份

优先级：P2  
证据等级：当前 TSX 转译与实际 react-markdown 输出树的结构探针；未执行浏览器 DOM 验证。

`shared/ui/markdown-content/markdown-content.tsx:16-60` 在函数体内重新创建 components.code 和 components.pre。react-markdown 将它们直接作为 React element type 使用，不是普通格式化回调。

相同 value 和 props 连续执行当前 MarkdownContent，探针确认两个 function type 不相等，实际 react-markdown 输出树也包含这两个不同类型。探针对样式、语义插件和代码高亮使用替身，验证范围仅限组件身份，不证明完整 Markdown 渲染效果。

父级 Narrative 复制反馈、活动楼层等状态更新会重渲染 Markdown，旧代码块子树因类型变化失去组件身份。`markdown-code-block.tsx:20-23` 的 wrapped、copyState 和高亮缓存随之重新初始化；这既是状态留存问题，也使原本未变化的代码块重复挂载/计算。

反证：React Compiler 配置是 annotation 模式，此组件没有 use memo 标注，不能假设编译器替它稳定类型。仅稳定 value 也不能修复内联组件类型。

最小方向：让 Markdown renderer 的组件类型稳定，并通过稳定数据传递所需 labels，不把组件函数每次重新定义。

关闭条件：相同正文的父级更新不重挂载代码块，换行开关和复制反馈保持；正文实际变化时高亮仍正确更新。

## FRONTEND-013：正文切换预览后丢失编辑撤销历史

优先级：P2  
证据等级：当前组件生命周期调用链及已安装 CodeMirror 的内存状态探针；未执行浏览器模式切换。

位置：

- `shared/ui/long-text-editor/long-text-editor.tsx:218`：source 模式挂载 CodeMirrorEditor，preview 模式改为 MarkdownPreview；
- `shared/ui/long-text-editor/code-mirror-editor.tsx:324`：挂载时从正文创建新的 EditorState 和 history；
- 同文件 `:386` 附近：卸载时销毁 EditorView 并清空 ref。

用户编辑正文后切到预览，再切回源码，CodeMirrorEditor 会重新挂载。父组件只传回当前字符串，没有持有或恢复 EditorState/history，因此先前的逐步撤销记录丢失。此时正文仍保留，不能把本项描述为所有编辑内容丢失。

反证核查：LongTextEditor 的 initialValueRef 用于恢复整个初始正文，reducer 的 undoValue 用于撤销清空；两者都不是 CodeMirror 的逐步编辑历史。ContextAssetDetail 给编辑器按 node.id 设置 key，能区分不同文档，但不能避免同一文档内部切换模式时子组件被卸载。

内存探针使用当前已安装的 `@codemirror/state` 与 `@codemirror/commands`：创建带 history 的 EditorState，插入一次文本，再按当前挂载方式仅用最新正文创建新状态：

```json
{"beforeRemountUndoDepth":1,"afterRemountUndoDepth":0,"text":"original edited","undoReturned":false}
```

断言通过，退出码为 0。探针验证历史未包含在正文字符串中及重建后的行为，React 条件卸载来自源码判断；未创建真实 EditorView 或模拟浏览器快捷键。

最小方向：预览切换不应结束同一文档的编辑会话。保留该文档的 EditorState，或在适当生命周期保持编辑实例；选择时同时考虑不可见实例的资源成本，不在持久化布局 Store 中复制整个编辑器状态。

关闭条件：编辑多步后往返预览仍可逐步撤销和重做；切换到另一文档不继承前一文档的历史；关闭编辑会话后相关实例正常释放。

## FRONTEND-014：Preset 编辑器深链接丢失资源身份

优先级：P2  
证据等级：当前路由函数探针及应用选择状态调用链；未执行浏览器刷新。

位置：

- `shared/studio-shell/studio-route.ts:29`：匹配 reference 路径后只返回 panel 和 nodeId 对应的 assetId，丢弃 resourceId；
- `app/app.tsx:401`：引用弹窗打开编辑器时临时设置 selectedPresetId；
- `app/use-studio-ui-state.ts:7`：selectedPresetId 是初值为空的 React state；
- `widgets/preset-workbench/preset-workbench.tsx:85`：内部选择同样初值为空，`:93` 查不到选择时回退到首个预设。

打开非首个预设的资源引用，再进入编辑器，当前会话因 onOpenEditor 显式设置选择而可能正常。但刷新或直接访问生成的 `/studio/presets/reference/:resourceId/node/:nodeId` 时，临时选择不再存在，路由又没有保留目标 resourceId；工作台于是选择第一个预设，仅把目标节点 ID 用于 detail 状态，不能保证打开引用所属预设。

这不是 URL 缺少信息，而是消费端丢弃已有信息。用户分享链接或恢复页面时会看到错误预设或无法定位目标节点。

当前路由函数探针输出：

```json
{"url":"/studio/presets/reference/second-preset/node/second-node","parsed":{"panel":"preset","assetId":"second-node"},"resourceIdPreserved":false}
```

探针退出码为 0，只验证路由数据损失；刷新后回退来自当前状态初始化及选择代码，未跑真实 React/浏览器流程。

反证核查：布局 Store 保留 selectedId 不能替代资源选择；Preset 工作台先选 resource，再构建该 resource 的节点集合。现有 `resource-reference.test.ts` 的路由断言仅期望 panel/assetId，六项测试通过不覆盖直接进入或刷新后恢复目标预设。

最小方向：路由模型保留资源 ID，工作台按该权威目标初始化选择，随后定位节点；缺失目标应明确报告，不按首个预设静默替代。保留现有“不因资源引用切换 Card”的边界。

关闭条件：至少两个预设时，直接进入、刷新及前进后退均保持 URL 指定的预设和节点；目标删除后不显示为另一个预设；从弹窗进入的现有路径仍工作。

## FRONTEND-015：搜索摘要使用了归一化前后不同的字符偏移

优先级：P3  
证据等级：当前搜索函数的纯内存探针。

`features/context-assets/model/context-asset-search.ts:74` 使用 normalizeSearchText(body) 定位关键词；该 helper 会 trim 正文。`:83` 却使用得到的位置直接切片原始 body，未补回被删去的前导空白长度。

因此搜索匹配成功时，摘要仍可能落在错误位置。对于较长前导空白，截取到的内容全部是空白，最终结果只显示省略号，无法解释命中原因。

探针调用当前 buildContextAssetSearchIndex 和 searchContextAssets，输入为 100 个前导换行后接 `needle: important content`，查询 needle：

```json
{"matched":true,"selectedId":"probe","excerpt":"…","excerptContainsQuery":false,"bodyUnchanged":true}
```

断言通过、退出码为 0。使用较长空白是为了确定性暴露坐标差异，不声称普通正文都受同等影响；没有浏览器验证。匹配结果和节点身份正常，原正文没有丢失，故按 P3 展示问题记录。

最小方向：正文匹配定位与截取使用一致的字符坐标；查询字符串的 trim 可以保留，不能把归一化文本的索引无条件视为原文索引。字符大小写转换也可能改变长度，实施时需明确支持范围，不直接把这一处改成另一个不保留偏移的转换。

关闭条件：包含前导空白的正文命中后，摘要包含命中内容；空白正文仍不产生伪结果；当前节点 ID、排序和原文不受摘要修复影响。

## 证据边界与待核对项

- 修正首轮描述：FileTree 已接入 `useVirtualizer`，由 `virtualized` prop 控制；ContextWorkbench 的 Setting explorer 已传 virtualized，PresetWorkbench 的 explorer 未传。不能仅因 SCSS 存在 content-visibility 就断定资源树没有虚拟化；未在没有压力样本的情况下另列缺陷。
- Agent Chat UI 已纳入本次补查；完整 Transcript 加载、流式执行不在本轮执行器审查范围，不作为新增性能结论。
- CSS 中的 `backdrop-filter`、Markdown 解析和扩展 Renderer 的实际帧耗时需要浏览器性能采样，静态代码不能替代该证据。
- 本轮是源码审查，没有执行浏览器动画复现、性能采样或人工视觉验收，没有修改生产实现。后续应优先验证折叠时序和草稿丢失，而不是先全量运行构建。
- 数据链补查运行了 QueryClient 缓存交错、异步操作 reducer 顺序和 Markdown 类型身份三个内存探针。reducer 旧失败晚于新成功会保留旧错误，但普通 run 也可能有意保留独立操作失败，本轮未把该现象直接判为新缺陷。既有 FR-001 的吞错行为不重复登记。
- 编辑模式补查执行 CodeMirror history 内存探针；下载 helper 已安排 Blob URL 回收，剪贴板 helper 返回布尔成功结果，未仅凭缺少额外包装或重试将它们登记成新问题。真实下载完成、剪贴板权限交互仍未做浏览器验收。

## 2026-09-22 补查：资源引用解析与读取

本次补查没有新增确认缺陷。读取当前 `packages/shared/src/resource-reference.ts` 和 `features/resource-references/reference-model.ts`，随后定向运行已有 `tests/unit/client/resource-reference.test.ts`，结果为 1 个文件、6 项测试通过。

该测试文件实际覆盖：引用 ID 精确读取、版本不匹配时不提供行高亮、越界行号不高亮、缺失节点不按同名替代、按指定 State 分支读取、脚本版本变化不冒充旧版本、非法链接在请求前失败以及读取错误传播。API 为测试替身，不代表真实后端与浏览器导航已验证。

另用当前共享解析器执行无文件写入的内存探针：

```json
{"specialCharacterRoundtrips":8,"timelinePointerRoundtrip":true,"duplicateParameterRejected":true,"invalidPointerEscapeRejected":true}
```

八种 ID 样本分别包含中文、空格、`+`、`/`、`?`、`#`、`&`、`%`；格式化后再解析均保留原值。Timeline 引用同时检查中文目标 ID 及 JSON Pointer 的 `~1`、`~0`；重复 query 参数和非法 `~2` 转义被拒绝。探针退出码为 0。

没有执行浏览器点击、滚动定位、焦点管理或真实 State/Script 读取，不把模型测试通过扩展为完整引用导航验收。本轮未新增测试文件或修改实现。

后续补查 Markdown 渲染入口：`shared/ui/markdown-content/markdown-content.tsx` 显式保留 Loom 协议，并在 anchor renderer 中解析资源引用。将当前 TSX 转译后，使用实际 react-markdown、GFM、对话插件和 React 静态渲染执行三种输入；只替换 SCSS 与此次未使用的代码块高亮模块：

```json
{"validReferenceRenderedAsButton":true,"invalidReferenceRenderedInert":true,"javascriptHrefNotEmitted":true,"renderMode":"server static markup"}
```

断言通过、退出码为 0。此项补足“Markdown 字符串保留不等于渲染后链接可用”的证据缺口：合法资源 URI 确实进入按钮分支，无效 URI 进入无效引用文本分支；另一个测试样本没有输出 javascript href。它不证明按钮的浏览器事件派发、弹窗加载及所有 URL 输入的安全性，也未验证高亮视觉效果。没有新增确认缺陷。

## 2026-09-22 补查：正文取消与失焦提交

本次静态调用链检查没有新增确认缺陷：

- `widgets/narrative-timeline/narrative-timeline.tsx:304` 将 onCancel 绑定取消编辑，onCommit 绑定 setDraft；CodeMirror 的 blur 回调只更新本地草稿，不直接调用 onEditNode。因此未发现“Escape 取消后因失焦向后端保存”的源码链，不能仅因编辑器有 blur handler 就登记该问题。
- `features/context-assets/model/use-context-assets.ts:72` 的 updateContextAsset 在持久化调用前比较 previousNode/nextNode，samePromptAssetPatch 相等就返回；没有编辑的普通失焦不会仅因触发 onCommit 就必然产生更新请求。
- Narrative 的 saveValue 调用 onEditNode 后立即退出编辑，其异步失败风险与既有 [FR-001](./full-repo-code-review-2026-08-27.md) 的调用方成功/失败语义问题相关，本次没有独立验证出新的根因，不重复计数。

未运行浏览器键盘、IME、真实焦点顺序或网络失败复现；本节仅记录已排除的静态假设，不等于完整编辑取消验收。没有修改实现或新增形式主义测试。
