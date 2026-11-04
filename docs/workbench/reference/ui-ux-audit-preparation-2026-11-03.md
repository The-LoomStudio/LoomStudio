# UI / UX 审查准备：范围、状态地图与建议顺序

日期：2026-11-03。

状态：**准备调研完成；A 包于 11-04 实施并完成定向本地验证**。

后续进展：A 包已完成[Shell 导航、对象身份与布局审查及实施](../../archive/issues/shell-navigation-layout-audit-2026-11-03.md)；B 包已完成[资源工作台、草稿与保存反馈审查及实施](../../archive/issues/resource-workbench-draft-feedback-audit-2026-11-04.md)。真实交互验收与既有剩余问题见各自报告；C 包已完成[叙事、滚动、iframe 与内存/Network 修复](../../archive/issues/narrative-scroll-iframe-audit-2026-11-04.md)及[元数据消费者与扩展摘要/详情专项](../../archive/issues/resource-catalog-payload-audit-2026-11-04.md)，均已归档；剩余候选与验收见[C 包后续](../issues/audit-follow-ups.md#c-package-follow-ups-2026-11-04)；原 D 包已完成并归档为[公共控件、键盘与焦点 CDP 审计](../../archive/issues/public-controls-cdp-audit-2026-11-04.md)，生产页两轮确认的 5 项已修复；当前源码浏览器复查与生产重建的验收边界见该报告。以下保留准备阶段的范围和建议。

本轮仅了解项目、Git、历史审查方式，以及 UI、CSS、React 状态流的代表入口。主 Agent 与三个只读子代理分别完成流程整合、UI/CSS 地图、状态与跨端链路、历史去重；没有逐文件审查，没有确认新的缺陷或可删除项。

## 1. 本轮边界与基线

- 范围为 `apps/studio-client`、`packages/loom-ui`，以及解释实际界面行为所需的后端返回值、版本、错误、事件与 Run 状态契约。
- 不扩展为后端架构、数据库、Prompt、工具执行、扩展权限或安全专项。只有具体 UI 因果链需要时，才继续追到对应实现。
- 当前分支 `main`，HEAD `12534ce6128eddee5f932835d3cc5309f3f7afff`；本地相对 `origin/main` 领先 4 个提交。未 fetch，不能推断远端最新状态。
- 调研期间一次 porcelain 快照为 287 个修改、11 个删除、30 个未跟踪项，且包括前端源码和既有审查文档。数字仅标识当时背景，不是本轮成果；本轮新增文件不在该快照内。
- 当前事实以工作区源码为准。后续每个审查包记录读取时点、HEAD 与相关工作区变化；出现并发改动时只复核受影响证据，不要求清空工作区。
- 本文补充此前的[全栈精简准备](code-simplification-audit-preparation-2026-11-03.md)，不覆盖它，也不继承其全栈施工范围。

## 2. 项目地图：按职责理解文件

以下为正式约定和代表源码的抽样核对，不证明全仓已遵守分层。路径均相对仓库根，行号为本轮读取位置，后续可能变化。

| 所有者 | 负责什么 | 代表证据 |
| --- | --- | --- |
| `app` | 组合 feature hooks、命令、面板和页面 | `apps/studio-client/src/app/use-studio-state.ts:56`、`app.tsx:509` |
| `pages` | Shell、窗口、侧栏、移动导航与工具浮层 | `apps/studio-client/src/pages/studio/studio-page.tsx:538`、`:703`、`:713` |
| `widgets` | 业务板块组合、布局和局部交互 | `apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx:210`、`:447`、`:559` |
| `features/*/model` | 领域请求编排、草稿、状态与展示投影 | `apps/studio-client/src/features/prompt-resources/model/use-context-assets.ts:35` |
| `features/*/ui` | 与领域紧密关联的展示 | `apps/studio-client/src/features/message-content/ui/message-content.tsx:20` |
| `shared` | Studio 宿主适配、导航、重型编辑/列表/阅读组件 | `apps/studio-client/src/shared/ui/file-tree/file-tree.tsx:156` |
| `packages/loom-ui` | 领域无关基础控件与交互机制 | `packages/loom-ui/src/component/dialog.tsx:133`、`:158`、`:167` |

文件分类的目标是减少跨层往返与重复职责，不是为了目录整齐搬文件。领域草稿不能因多个面板共用就搬入通用 UI；组件相似也不等于应该合并。

样式由 Client `src/styles/global.css:1` 引入 UI package 样式与根 token；业务局部采用 SCSS Modules，loom-ui 使用原生 CSS。`app.tsx:110` 接入主题运行时，`:220` 写入外观 CSS，所以审查局部样式必须考虑主题覆盖、祖先布局与容器尺寸。正式约定见 [UI 设计](../../guide/ui-design.md)和 [UI Architecture](../../architecture/ui/README.md)。桌面高信息密度优先，同时保留并检查已有移动行为。

## 3. React 状态地图

| 状态种类 | 当前所有者与入口 | 精简前必须区分 |
| --- | --- | --- |
| 服务端资源缓存 | `features/prompt-resources/model/use-prompt-resource-state.ts:16`，Query key 含 endpoint，`:80` 按 ID/version 回写 | 缓存失效与未提交编辑不是同一责任 |
| 编辑草稿 | `features/prompt-resources/model/use-context-assets.ts:35` 的 base/edits/failure，`:48` 按 scope 隔离，`:133` 串行提交 | 基线、当前输入、在途提交和失败恢复不能盲目合并 |
| 布局偏好 | `shared/studio-shell/studio-layout-store.ts:181`，Zustand persist | 持久偏好与临时开关、可用性 fallback 不等价 |
| 导航恢复 | `shared/studio-shell/studio-workspace.ts:17` 的 endpoint 键，`:90` 的 History state | 路由、对象身份与面板显隐分别认责 |
| Narrative 目录 | `features/narrative-runtime/model/use-narrative-collections.ts:6`，React 缓存与请求序号 | 当前并非所有远端状态都在 Query，不以迁移 Query 为先验目标 |
| 运行展示 | `features/narrative-runtime/model/use-narrative-runtime.ts:81`、`:125`、`:164` | 持久历史、流式增量、composer 与展示投影有不同生命周期 |
| 操作反馈 | `shared/hooks/use-async-operations.ts:24`、`:39`、`:47` | `run` 抛错、`runReported` 返回 undefined、`runLatest` 限定发布；调用方如何判定完成需要一起看 |

本表 Client 相对路径均以 `apps/studio-client/src/` 为前缀。全局 Query 默认配置见 `apps/studio-client/src/main.tsx:26`；不能把框架一般默认行为当作项目实际行为。

代表链 A：资源编辑 → 草稿 `commitEdits` → `StudioApi.promptResources.updateAsset(s)` → tRPC → Runtime → 返回 resource/changesetId → 草稿与 Query 回写。

- `use-context-assets.ts:179` 起检查失败与版本，`:189` 发送 expectedVersion，`:201` 仅清除本次提交且未继续修改的字段，`:206` 保留失败。
- 跨端入口：`apps/studio-client/src/shared/api/studio-api.ts:404` → `apps/studio-server/src/rpc/trpc/application/workspaces.ts:122` → `packages/application-runtime/src/runtime/prompt-runtime.ts:714`、`:748`、`:755`。
- 后续要核对的是用户输入、提交结果、失败提示是否一致；本轮未验证并发与真实失败。

代表链 B：Server 事件 → `/extensions/events` → `data.changed` → 当前 Timeline 命中 → Transcript 刷新 → 与 Run 观察投影交接。

- `apps/studio-server/src/server.ts:436` 接入事件；Client `shared/api/extension-events.ts:10` 共享 EventSource，`:29` 释放订阅；`shared/api/data-commit-events.ts:12` 适配 operation 身份和 scope。
- `features/narrative-runtime/model/use-timeline-session.ts:43` 读取，`:48` 检查请求来源，`:51` 区分在途 Run 增量，`:64` 处理来源切换，`:82` 按 timelineId 刷新。
- 后端纳入范围止于足够解释 UI 的事实；若需要证明提交时机才追事务，不能从事件名直接推断成功语义。

## 4. 以前怎么审：继承经验，避免重报

现有[审计流程](../../guide/audit-workflow.md)、[前端方向](../../guide/audit-frontend.md)、[审查工作指南](audit-playbook.md)已经提供适用方法，无需再创建平行规范。

| 历史记录 | 对本次的意义 |
| --- | --- |
| 10-02 精简最终记录 27 项实施、5 项保留；一次 UI 抽取撤回 | 不以抽象数量、拆分文件或删行数量衡量收益；见既有准备报告第 3 节 |
| Git `6440e4e6` 的 Provider 改动以 `useExplicitCatalog` 接管重复请求状态，保留草稿与派生 profiles | 可借鉴减少重复权威的方法，不能据此认定当前其他状态也冗余 |
| 10-07 前端 38 项已有实施及定向证据 | 先对照 [audit-follow-ups.md](../issues/audit-follow-ups.md) 去重，历史问题必须复核 |
| FE-028 源到 DOM 映射、FE-031 导航消费与失败反馈、FE-035 真机长休眠恢复；OPT-001/002 要求真实 trace | 历史残余线索，不是本轮新确认缺陷；当前是否成立仍待专项核查 |
| 10-26 计划含安装恢复、草稿生命周期、跨 Timeline 晚到结果及多语言反馈 | 触及对应链路时核对[原计划](../plans/full-stack-audit-remediation-2026-10-26.md)，不要复制成新待办 |

历史来源的主要定位：`audit-follow-ups.md:32`、`:43`、`:47`、`:52`，综合计划 `:84`、`:88`。生态审计里的 Focus Mode 等仍是建议，不能转为此次必修项。旧记录中的“双流”等名称也必须映射到当前消费者，不能恢复过期模型。

旧 `code-review.md` 中较机械的测试/build 清单，不作为本轮全量验证要求；按用户约定与当前审计流程，围绕实际风险选最小验证。

## 5. 建议流程：先宏观，后微观

1. **画交互链与责任地图。** 从实际用户动作出发，确认挂载入口、对象身份、谁写状态、谁解释完成/失败、谁恢复与释放。
2. **寻找整条链的精简机会。** 检查重复入口、双重状态权威、重复调度/回写、退役路径；同时排除草稿、缓存、快照和展示缓冲的合理区别。
3. **再看模块与文件归属。** 判断 app/widget 是否承载本应属于 feature 的流程，以及 shared 是否夹带业务；只有减少维护入口才提出移动或提取。
4. **最后看 React 与 CSS 细节。** 派生状态、Effect、闭包、选择器、主题值、容器尺寸与公共控件复用。长度、数量、零静态引用都不能单独证明可删。
5. **记录候选并找反证。** 精简须交代删除什么、由谁接管、哪些行为保持；缺陷须有触发条件、可达链、错误结果与用户影响。产品取舍单列，不能伪装成 Bug。
6. **后续再做确定逻辑的专项。** 针对已选链路验证切换、并发、失败、取消、恢复、焦点或测量，不在准备阶段宣布覆盖完成。

“精简优先”不意味着先删除再验证合同，也不意味着必须把所有精简做完才能处理明确问题。本轮没有业务代码实施授权。

## 6. 后续审查包建议

| 顺序与包 | 真实入口 | UI 问题与停止边界 |
| --- | --- | --- |
| A：Shell 导航与布局 | `app.tsx → StudioPage → PanelHost/PanelRight/ToolDialog`；studio-shell | 导航/选中/显隐是否重复拥有状态；窗口、移动返回、手势和滚动归属。先建立其他面板共用的身份边界 |
| B：资源工作台编辑 | `studio-resource-panels.tsx → PresetWorkbench → AssetWorkbenchLayout → MasterDetailWorkbench/FileTree` | 列表选择、展开、宽窄下钻、草稿保存反馈与 Query 回写。后端只追版本和提交结果 |
| C：叙事阅读与运行展示 | `NarrativeTimeline → ConversationViewport → MessageContent → HtmlPreview` | 历史与增量交接、滚动所有者、虚拟行身份、编辑保活、iframe 高度及切换恢复。后端只追 Run/事件契约 |
| D：公共控件与样式 | `loom-ui Dialog/Menu/Field`，shared 宿主适配，global.css 与局部 Modules | 焦点、Esc、portal、错误可达性、主题与容器布局。对 A/B/C 的实际消费者交叉检查，避免只审孤立控件 |

后续并行按包分配，不按 `.tsx`/`.scss` 后缀切开同一交互。主 Agent 负责跨包共享所有者、反证冲突、历史去重和最终结论；每个子代理只读其包，回传证据与缺口，不自行扩展产品或架构。D 的公共基础结论由一个所有者维护，其他包引用，避免重复审查。

建议先从 A 开始，边界清楚后 B/C 可并行；D 根据实际依赖配合，不先启动全站 CSS 清扫。这是建议顺序，尚非已执行审查清单。

2026-11-04 范围补充：用户将 tokenizer Worker、前端内存、空闲后台活动和相关性能优化纳入 C 包，并授权现有浏览器现场诊断。占用口径、实测结果与待测优化统一记录在 C 包报告第七节，不另建平行性能台账。

## 7. 证据、验证与持久化

正式审查结果使用现有流程字段，并分为：已确认缺陷、可证明精简、待核实候选、需要产品决定。覆盖范围逐包标记，入口抽样不能表述为全量审查。

- DOM 测量、虚拟滚动、焦点、IME、触摸和性能需要对应现场证据；有明确假设再定向诊断，静态源码、SSR 或 mock 不证明这些体验。
- 主观视觉与手感由用户验收；本轮不自动打开浏览器、不跑测试/build、不调用真实服务。
- 开发预览不能一概认为纯内存只读：`src/dev-preview/README.md` 明确 regex 预览有独立 SQLite 写入实验。后续选验证入口时先查副作用。
- 新的实际发现写入对应审查报告，关联已有 Issue；已有问题更新原跟踪处，不在本文复制平行待办。

本轮实际完成：读取项目指南与代表源码、检查本地 Git 历史和工作区状态、整合三个只读子代理结果、持久化本准备文档。仅对文档改动进行核对；没有运行测试、构建、浏览器或真实并发验证。未知的是具体路径是否存在 UX 缺陷、哪些状态或样式确可删除，以及实际窄窗、主题、键盘和流式体验，均留待后续专项。
