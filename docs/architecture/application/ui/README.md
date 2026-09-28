# Studio Application UI Architecture

本分类收录第一方 AIRP Application 如何使用 Studio Shell 容器和通用 UI 原语，呈现 Card、Session、PromptBuild、Agent 等领域体验。

它与顶层 [`../../ui/`](../../ui/) 的区别是：

```text
Architecture / UI:
  Shell、容器、全局功能和领域无关原语。

Application / UI:
  第一方 AIRP 领域体验与交互。
```

以下是当前已落地的编辑、提交与渲染合同；尚未实现的页面设计继续留在 [`../../../workbench/discussion/application/ui/`](../../../workbench/discussion/application/ui/)。

## 位置、缓存与草稿

- 面板、Timeline/Branch 和明确的资源目标由 Shell 的[导航合同](../../ui/navigation-and-routing.md)持有；关闭面板不等于销毁已访问宿主。导航只保存位置，不保存业务正文或未提交草稿。
- Prompt Resource、Setting Mount 与 Preset Tool Mount 的正式远端状态由 TanStack Query 管理。资源工作台的输入通过 feature 草稿投影显示，不把未保存文本写进 Query Cache。
- Context Asset 草稿按 endpoint scope 和 resource ID 隔离，记录首次编辑时实际显示的资源版本与节点字段修改。同一页面内切换资源不静默丢弃失败草稿；浏览器刷新后的草稿恢复没有持久化合同。
- 远端刷新仍能接收 Agent 的提交，但不覆盖已有草稿。普通失焦保存使用编辑基线版本；过期版本拒绝提交并保留输入，不自动改用最新版本覆盖远端。
- 用户明确选择重新应用时，先读取最新资源，只合并本次提交的已编辑字段，再做版本检查。未编辑字段沿用最新值，读取/保存期间的新输入继续保留；远端节点已删除时失败，不复活节点。用户也可明确放弃本地修改。

`useAsyncOperations.run()` 记录错误并继续抛出，依赖成功/失败的保存调用必须保留这一语义。`runReported()` 只用于报告型边界，不能把其正常返回当作 mutation 成功。远端写入成功后的列表刷新失败不撤销真实提交，也不能丢失已创建对象的身份或诱导重复创建。

## Timeline 提交与编辑

游玩输入按顺序执行：

```text
appendNarrativeInput -> 发布真实用户节点 -> 创建或选择 Session -> createRun(inputNodeId)
```

用户节点写入失败时不向 Session 投递；投递失败仍保留已提交节点。当前页面的显式重投递复用原节点 ID，可投递到新选定的 Session，不重复追加用户正文。Agent 的最终回复不自动成为 Timeline 正文，正文只能经授权工具写入；工具失败通过 Tool Result 表达。Run 已结束但后续读取失败时只重读，不自动重跑。跨刷新重试树不是当前能力。

已有正文的编辑使用开始编辑时的 Branch Head 和原正文作并发基线，等待后端持久化成功才退出编辑；失败保留输入。后端按分支复制路径并返回新节点身份，UI 不把修改当成只改内存，也不自行覆盖其他分支。持久化语义见[数据生命周期](../data-capabilities-and-lifecycle.md)与[Agent/Narrative 边界](../agent/runtime-and-session.md#6-narrative-边界)。

## 正文窗口与 Renderer 生命周期

NarrativeTimeline 使用 TanStack Virtual 动态测量消息高度，消息以节点 ID 标识。只挂载可见窗口、上下缓冲与正在编辑的节点；滚动定位扫描挂载窗口，而不是每帧扫描全部已加载正文。插入旧页按稳定 ID 保持锚点，显式旧节点定位可先补读分页再定位。

上下各自使用同一个缓冲数，默认5条，可在外观设置调整为0～50并持久化。它控制 UI 挂载窗口，不控制扩展自主选择的业务渲染深度。数据页仍可留在 feature 内存中，DOM窗口化不等于数据缓存有界。

消息内 Renderer、DOM 和 iframe 与消息组件同生共灭，离屏卸载后局部表单、播放进度等不保证恢复。它们面向轻量消息增强；复杂持久界面应使用独立 Surface。Timeline 的 tail 在消息窗口之外，不因普通消息离屏而卸载；这不承诺切换整个 Timeline/Card 后仍保留所有界面状态。

消息正文由 `features/message-content` 消费，Markdown、安全HTML片段和隔离文档使用各自现有渲染路径；Display 投影不改变编辑/复制的权威原文。HTML与iframe边界见[共享iframe运行时](../../ui/iframe-runtime.md)。Agent 工具组折叠与 Narrative 离屏卸载是不同机制：折叠保留工具详情子树并隔离隐藏交互，不等于建立全局消息缓存。

## 实现与验证入口

- [草稿与重新应用](../../../../apps/studio-client/src/features/context-assets/model/use-context-assets.ts)，[交错与失败测试](../../../../tests/unit/client/context-asset-drafts.test.ts)
- [异步操作边界](../../../../apps/studio-client/src/shared/hooks/use-async-operations.ts)
- [Narrative提交与恢复](../../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts)，[失败与重投递测试](../../../../tests/unit/client/narrative-submit-failure.test.ts)
- [正文窗口与编辑](../../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.tsx)，[缓冲偏好](../../../../apps/studio-client/src/shared/studio-shell/appearance-store.ts)
- [独立千条消息预览](../../../../apps/studio-client/src/dev/preview/narrative-timeline-preview.tsx)
