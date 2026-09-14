# 核心依赖、性能与状态治理计划

> **状态**：Implemented / WP0-WP7 已闭环，浏览器性能与视觉手感待人工验收
> **日期**：2026-09-14
> **来源**：[前后端架构与客户端重复逻辑审计](../issues/frontend-backend-architecture-and-client-duplication-audit-2026-09-14.md)
> **本轮授权**：按工作包持续实施；最多使用一个子 Agent 处理可独立并行的调研工作。
> **目标**：用少量经过验证的核心依赖和现有平台能力，减少客户端手工服务端状态、无效渲染、整页静态装载和文本高度测量成本，同时建立可重复的性能与状态正确性验证。

## 1. 当前结论

依赖不是越少越好，也不是装上流行框架就能自动修复架构。当前适合 LoomStudio 的依赖必须至少满足一项：

- 删除现有的大段请求、缓存、竞态或状态同步代码；
- 把当前无法可靠处理的动态布局能力变成稳定基础设施；
- 提供当前测试方式难以覆盖的状态不变量验证；
- 建立可重复的性能基线，阻止优化继续依赖主观感受；
- 属于构建期或开发期能力，不增加不必要的运行时状态和公共概念。

本计划确认的优先方向是：

```text
React / Vite       -> Panel 分包、预取、Compiler 试点
Zustand            -> 只管理本地 UI 和工作区状态
TanStack Query     -> 管理服务端资源状态
React Virtual      -> 管理无界列表渲染窗口
Pretext            -> 预测纯文本可变行高，不替代 CSS 或 Markdown 排版
Shared + Zod       -> 统一跨端契约和边界校验
fast-check/mitata  -> 验证状态不变量和性能事实
```

## 2. 已确认事实

| 当前事实 | 证据与影响 |
| --- | --- |
| 客户端生产主包约 1.35 MB，gzip 约 383 KB | 多个 Panel 仍由注册表静态导入；首次启动承担未访问功能的解析成本 |
| `use-studio-state.ts`、Cards、Prompt Resources 等手工维护请求与刷新 | Mutation 后重复刷新多组资源，并使用 request guard 处理旧请求覆盖，属于服务端状态基础设施重复实现 |
| Zustand 已使用窄 selector，但仍存在对较大布局对象的整体订阅 | 对象局部变化仍可能让无关 Panel 或组合层重新渲染 |
| `@tanstack/react-virtual` 已用于 FileTree | 当前资源树使用固定 `34px` 预计行高并测量真实节点；尚未形成项目级无界列表和可变文本高度策略 |
| Vite 依赖预构建已默认自动执行 | `optimizeDeps` 主要改善开发期依赖发现，不能解决生产运行时 Panel 挂载和文本重排 |
| React Compiler 尚未启用 | 当前仍依赖人工 `useMemo`、selector 和组件边界控制渲染；Compiler 只能作为补充，不能替代这些边界 |
| Zod 已存在但版本不一致 | 根目录与 `ai-gateway` 使用不同 Zod 4 版本，且 Shared RPC 契约尚未以 Schema 为单一来源 |
| 前端全局 sans 字体为 `system-ui, sans-serif` | Pretext 明确说明 macOS 上 `system-ui` / `-apple-system` 可能与 Canvas 测量不一致，不能直接全局接入 |
| TypeScript Project References 和 package watch 已存在 | 当前已经具备增量包构建基础；再引入 Nx、Turbo 或另一套 bundler 不能直接改善用户侧卡顿 |
| Knip 已执行过，但仍是人工审计入口 | 缺少稳定的依赖、导出和包体积回归预算，问题可能在后续迭代中重新增长 |

## 3. 新增依赖决策

### 3.1 立即采用

| 依赖 | 类型 | 当前用途 | 采用边界 |
| --- | --- | --- | --- |
| `@tanstack/react-query` | 客户端运行时 | 服务端资源缓存、请求去重、失效、取消、并发与 Mutation 后同步 | 首批只迁移 Prompt Resource 与 Mount；Zustand 保留 UI、布局、选择和草稿状态 |
| `fast-check` | 开发依赖 | 为资源树、Projection、Mount 和状态转换生成操作序列并验证不变量 | 不为简单映射制造属性测试；优先覆盖 add/move/delete/clone/reorder |
| `mitata` | 开发依赖 | 建立 500、5,000、50,000 条数据的纯逻辑基准 | 只测可重复的 model/lib 函数；DOM 和浏览器回流使用浏览器性能工具验证 |
| `rollup-plugin-visualizer` | 开发依赖 | 查看主包、Panel chunk 和重复依赖组成 | 只在分析构建中启用，不影响默认生产行为 |
| `size-limit` 与必要插件 | 开发依赖 | 为客户端入口和关键异步 chunk 建立大小预算 | 预算基于拆包后的真实基线，不用当前大包数值永久合理化现状 |

`@tanstack/react-query` 是本计划唯一立即新增的通用运行时依赖。其他立即项只进入开发和验证链路。

### 3.2 受控试点

| 依赖 | 试点目标 | 继续采用条件 | 停止条件 |
| --- | --- | --- | --- |
| `proxy-memoize` | 缓存 Context Asset 搜索索引、Projection Workbench 等共享派生模型 | 上层对象引用变化但实际读取字段未变时，基准和 Profiler 显示重复计算明显下降 | 当前 `useMemo` 已足够，或不可变更新无法保持相关子树引用 |
| `@chenglou/pretext` | 为纯文本可变高度虚拟列表预计算行数和高度 | 指定字体、语言和 UI Scale 下与 DOM 行数一致，Panel 改宽时明显减少测量与滚动跳动 | 需要替换全局字体才能准确，或中文/Emoji/缩放下持续出现高度误差 |
| `babel-plugin-react-compiler` + `@rolldown/plugin-babel` | 在 React 19.3 后试点构建期自动 memoization | 代表性 Panel 的 commit 次数下降，构建、行为和开发诊断稳定 | Compiler 跳过关键组件、增加不可解释行为或收益低于手工边界治理 |

Pretext 只用于纯文本或受控 rich-inline。它不负责完整 Markdown、CodeMirror、浏览器原生文本选择或普通 CSS 换行，也不解决固定高度 FileTree 的首次挂载问题。

### 3.3 仅在证据出现后采用

以下依赖不进入首轮安装清单：

| 候选 | 触发条件 | 当前不直接采用的原因 |
| --- | --- | --- |
| `p-limit` | 后端无界 `Promise.all` 已证明造成文件、Provider 或扩展加载峰值 | 限流会改变吞吐与完成顺序，不能只因存在批量 Promise 就加入 |
| `Comlink` | 可序列化的纯 CPU 工作持续阻塞主线程超过一帧 | Worker 不能修复 React 挂载和 DOM 回流，还会引入数据复制与生命周期边界 |
| `Mutative` | 树更新的对象分配或递归复制被基准确认是主要热点 | 当前手写结构共享可能更简单、更快，不能用 draft 写法替代测量 |
| `XState` | Agent/Session 出现可复现的非法状态组合，普通 reducer 难以表达 | 它是局部状态机，不是全局状态管理或性能工具 |
| `quick-lru` | 相同纯输入的解析、编译或测量跨组件重复发生且有明确失效键 | 缓存可变业务对象会制造更复杂的失效问题 |

不引入 Redux Toolkit、Jotai、MobX、Valtio、Immer、mitt、nanoevents、MiniSearch、通用 deep-equal 或 deep-diff 作为本轮解决方案。它们要么与现有状态边界重叠，要么会隐藏耦合、把重渲染成本换成深遍历，或对 500 条资源规模过早建设索引。

## 4. 现有依赖的使用缺陷

| 现有能力 | 当前缺陷 | 目标用法 |
| --- | --- | --- |
| React | Panel 静态导入；部分大组件同时承担数据投影、命令和渲染；人工 memo 分散 | Panel 使用 `React.lazy` 动态 chunk；在侧栏 hover/idle 时预取；先缩小组件与状态边界，再试点 Compiler |
| Zustand | 同时承接部分服务端资源状态；较大对象订阅扩大重渲染面 | 只保留工作区、布局、选择、瞬时 UI 和草稿；使用窄 selector、`useShallow`、`subscribeWithSelector` |
| React Virtual | 目前主要用于 FileTree，项目没有统一的列表规模和可变行高策略 | 所有无界列表先扁平化再虚拟化；固定行高直接估计，可变纯文本行高再评估 Pretext |
| Vite | 主 chunk 过大；缺少可视化分析和大小预算 | 通过动态 import 形成领域 chunk；分析构建查看重复依赖；CI 只检查关键预算 |
| Zod | 版本漂移，主要局限于 AI Gateway；RPC 参数和客户端 DTO 仍大量手写 | 统一 Zod 4 版本；在 `packages/shared` 为一个 RPC 领域建立 Schema、推导类型和边界解析 |
| Knip | 作为阶段性人工命令使用，动态入口误报和公共导出治理没有稳定规则 | 保留动态入口配置和例外依据；在架构收敛阶段定期运行，不对结果自动删除 |
| CodeMirror | 已经按需动态加载，这是正确用法 | 保持懒加载；只在用户即将进入长文本编辑时预取，不将其拉回主入口 |
| TypeScript Project References | 已用于包增量构建，但版本和跨包入口仍可能漂移 | 保留现有 `tsc -b`；优先治理正式导出和版本统一，不新增平行构建系统 |
| React Router | 负责导航，但 Panel 访问和 URL 同步不应导致高频状态写入 | 保留深链；普通 Panel 内部选择、拖拽和编辑状态不持续写 URL |

## 5. 版本治理

首轮只处理与本计划直接相关、风险较低的版本统一：

- `react`、`react-dom`、`@types/react`、`@types/react-dom` 必须同批升级；React 19.3 与 Compiler 试点独立成一个工作包。
- 对齐根目录与 `ai-gateway` 的 Zod 4 版本，再迁移 Shared Schema。
- 对齐根目录和客户端的 `@codemirror/state`，避免同一核心包声明漂移。
- Zustand、React Router、React Virtual、Vite 的同主版本补丁升级可以作为独立小批次执行。
- AI SDK 与 Provider 适配器补丁升级单独验证，不与状态重构混在同一 Diff。

TypeScript 7、Vitest 5、Undici 8、Keyring 2 和其他主版本升级不属于本计划首轮。它们需要独立迁移和契约验证，不能包装成性能修复。

版本来源应集中管理，避免 root、app 和 package 各自声明不同补丁版本。实施时在 pnpm workspace 的现有能力中选择一种最小机制，并同步 lockfile；不新增自制版本同步脚本。

## 6. 最小状态架构

```text
Remote server state
  -> TanStack Query cache
  -> query keys / invalidation / cancellation
  -> Feature commands
  -> Widget rendering

Local application state
  -> Zustand
  -> layout / active panel / selection / UI preference

Ephemeral interaction state
  -> component or feature hook
  -> form draft / drag preview / expanded node / dialog

Streaming domain state
  -> narrative or agent feature owner
  -> no initial migration into Query
```

同一份服务端资源不能同时由 Query Cache 和 Zustand 作为可写真相源。迁移一个领域时必须完整迁移其读取、Mutation、失效和错误状态，不能长期双写。

## 7. 工作包与执行顺序

### WP0：建立性能与包体积基线

**状态：已完成。**

写集：根 `package.json`、`pnpm-lock.yaml`、必要的性能脚本、客户端 Vite 分析配置，以及本 Plan 的验证记录。

- 安装 `mitata`、`fast-check`、`rollup-plugin-visualizer`、`size-limit` 及最小必要插件。
- 为 Context Asset flatten/search/projection/tree mutation 建立 500、5,000、50,000 条基准。
- 记录客户端入口、CodeMirror、资源工作台及主要 Panel chunk 基线。
- 不把 microbenchmark 数值当作浏览器交互结论；Panel 切换仍使用 Performance/Profiler 观察长任务和 commit。

完成条件：基准可重复执行；输出包含数据规模、操作名称和耗时；包体积分析不进入默认运行时代码。

### WP1：先修正现有 React、Zustand 与 Vite 用法

**状态：已完成。**

写集：`apps/studio-client/src/app/studio-panel-registry.tsx`、`studio-resource-panels.tsx`、Panel Host/侧栏预取入口、相关 Zustand selector 及 Vite 配置。

- 将重型 Panel 改为动态 import，保留错误边界和加载状态。
- 只对高概率访问的 Panel 使用 hover 或 idle 预取，避免启动时重新下载全部 chunk。
- 收窄 `assetLayouts`、`panelWindowSizes` 等对象订阅；组合 selector 返回对象时使用 `useShallow`。
- 不通过增加全局 Context 或新的 Loading Store 管理 lazy 状态。

完成条件：主入口不再静态包含所有 Panel；普通布局局部变化不让无关 Panel commit；深链仍能直接打开目标 Panel。

### WP2：TanStack Query 服务端状态试点

**状态：已完成。**

首批范围：Prompt Resource library、Setting Mounts、Preset Tool Mounts 及其 Feature commands。

- 在客户端应用入口提供一个 QueryClient；query key 由领域 Feature 定义，不建立万能 key 工厂。
- 读取、Mutation、失效、错误和取消全部收进 Prompt Resource Feature。
- 删除迁移范围内的 request guard、重复 loading/error 和手工多组 refresh 编排。
- 选择项、未保存草稿、树展开和拖拽预览继续留在本地状态。
- Agent streaming、Timeline 写入和全局 `useStudioState` 其他领域不在首批迁移范围。

完成条件：Prompt Resource Mutation 后不再手工 `Promise.all` 刷新同一组数据；同 key 并发读取被去重；失败不会留下 Query/Zustand 双写真相源。

### WP3：状态不变量与性能回归验证

**状态：已完成。**

- 使用 `fast-check` 覆盖资源树 add/move/delete/clone/reorder 操作序列。
- 验证 ID 唯一、无循环、节点不丢失、Order 引用有效、选择项清理等真实不变量。
- 把 WP0 的关键基准作为人工/定向回归入口；不为不稳定时间阈值制造易抖动 CI。

完成条件：属性测试能够复现 seed；失败报告可以定位到最小操作序列；没有为不可达状态增加防御代码。

### WP4：派生模型缓存试点

**状态：经基线验证后停止，不引入 `proxy-memoize`。**

- 只选择一个重复成本最高的纯派生函数试点 `proxy-memoize`。
- 比较当前 `useMemo`、共享 memoized selector 和无缓存版本。
- 缓存不得持有可变运行时对象、API Client、React Node 或无限增长的文本版本。

完成条件：相同交互下派生调用和耗时明显下降；没有增加手工失效逻辑。收益不明确则移除依赖，不扩大使用。

当前 500 条数据的搜索、Projection 与树更新均远低于单帧预算；主要成本来自 Panel 装载、React 挂载与全树规范化。`proxy-memoize` 无法修复当前结构共享边界，因此没有安装。

### WP5：Pretext 可变文本高度试点

**状态：按停止条件暂缓，不引入 Pretext。**

首选消费者为 Log Viewer 或纯文本 Session 列表，不选择固定 `34px` 的 FileTree，也不选择完整 Markdown。

- 使用明确命名、已经加载完成的字体；不得直接用当前 `system-ui` 作为准确性基线。
- `prepare()` 只在文本、字体、locale 或 letter spacing 改变时运行；Panel resize 只运行 `layout()`。
- 与 React Virtual 的 estimate/measure 流程结合，验证滚动锚点和宽度变化。
- 覆盖中英文、Emoji、长单词、换行、`pre-wrap` 和 UI Scale。
- 如果试点要求改变全局字体或视觉合同，停止实现并单独提交产品/UI 决策，不在性能任务中暗改。

完成条件：支持数据集的预测行数与 DOM 一致；连续 resize 不产生明显滚动跳动；实际长任务和回流次数相对基线下降。

当前 Log Viewer 折叠行固定为 `32px` 且正文不换行，展开内容是交互式 JSON；Session 列表同样以单行和截断为主。仓库尚无符合试点边界的纯文本可变高度虚拟列表，提前接入只会增加字体测量与缓存状态。

### WP6：React Compiler 试点

**状态：已完成注解模式试点；实际 commit 收益待浏览器 Profiler 验收。**

- 按官方 Vite 接入方式添加 Compiler 构建插件，并确保 Compiler 先于其他 Babel 转换。
- 选择一个已经完成状态边界治理的 Panel 试点，不以 Compiler 掩盖宽 selector 或不稳定 props。
- 使用 Compiler ESLint 诊断和 React Profiler 确认跳过原因与收益。

完成条件：生产构建、定向行为验证通过；代表性操作 commit 数下降；没有为了取悦 Compiler 扩大业务重构。

### WP7：Shared Schema 与版本统一

**状态：已完成 Setting Mount 窄领域试点。**

- 对齐 Zod 4 版本。
- 选择 Prompt Resource 或 Card 的一个窄 RPC 领域，将请求、响应和错误 Schema 放入 `packages/shared`。
- Server 在信任边界解析，Client 从同一 Schema 推导类型；删除对应的重复 DTO 和字段校验。
- 先用确定性的仓库内脚本或类型推导减少机械代码，不引入 tRPC/ts-rest 全面替换现有 RPC。

完成条件：同一字段只保留一个跨端契约来源；Shared 不依赖 React、Node 专属 API、数据库或 Application Runtime。

## 8. 验收与验证预算

| 风险 | 最小验证 |
| --- | --- |
| 新依赖进入错误 bundle | 分析构建与关键 chunk 大小检查 |
| Panel lazy 后深链或加载失败 | 客户端定向构建，加目标 Panel 的最小导航检查 |
| Query 迁移形成双写真相源 | Prompt Resource 定向测试与 mutation 后状态检查 |
| Zustand selector 收窄导致状态遗漏 | 代表性布局、选择和恢复行为测试；Profiler 只作为性能证据 |
| 资源树操作破坏不变量 | fast-check 属性测试及固定 seed 回归 |
| Pretext 与 DOM 高度不一致 | Chrome/Safari 浏览器夹具，覆盖字体、locale、Emoji 和 UI Scale |
| Compiler 改变行为或构建 | 试点 Panel 定向测试、客户端 build 和 Profiler 对比 |
| Shared Schema 改变 RPC 契约 | Client/Server contract test，不默认执行全仓测试 |

每个工作包只运行能够覆盖其主要风险的检查。只有跨包契约、构建入口或公共基础设施变化时，才扩大到相关 package 的类型检查或 build。

## 9. 停止条件与边界

- 不因为某依赖在基准中更快，就绕过现有数据所有权或可访问性语义。
- 不长期保留同一领域的旧状态路径和新状态路径。
- 不把 Pretext 包装成全局 Typography 框架，不手工重绘普通 DOM 文本。
- 不用 deep-equal、全局 memo cache 或无限 LRU 掩盖不稳定对象和错误状态边界。
- 不在本计划中迁移 Agent Streaming、权限、持久化、事务或 Extension 公共 SDK。
- 不在没有真实消费者时创建通用 Query、Worker、State Machine 或 Text Layout 抽象。
- 如果试点不能删除代码、降低可测成本或改善可观测性能，则回退试点依赖并保留基准结论。

## 10. 外部依据

- [TanStack Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- [Zustand useShallow](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow)
- [Vite Dependency Pre-Bundling](https://vite.dev/guide/dep-pre-bundling)
- [React Compiler Installation](https://react.dev/learn/react-compiler/installation)
- [Pretext](https://github.com/chenglou/pretext)
- [fast-check](https://fast-check.dev/)
- [proxy-memoize](https://github.com/dai-shi/proxy-memoize)
- [mitata](https://github.com/evanwashere/mitata)

## 11. 验证记录

- 2026-09-14：根据当前 package manifests、客户端状态与 Panel 注册路径、Vite 构建结果、资源树虚拟化实现和外部项目文档形成计划。
- 2026-09-14：WP0 安装 `fast-check`、`mitata`、`rollup-plugin-visualizer`、`size-limit` 与文件插件；新增 Context Asset 500、5,000、50,000 条基准、分析构建和客户端体积预算。
- 2026-09-14：500 条基准中搜索索引约 `216 us`、搜索约 `35 us`、Projection model 约 `159 us`，说明可见卡顿并非纯数据算法；50,000 条更新与移动约 `29-41 ms`，已跨过单帧预算。
- 2026-09-14：WP1 将 13 个 Panel 改为 lazy chunk，并在 Rail 与角色入口 hover/focus/pointer-down 时预取；保留访问后挂载语义和 Suspense 加载态。
- 2026-09-14：客户端主入口 gzip 从约 `379 kB` 降至约 `169 kB`；总 JavaScript `618.32 kB`、总 CSS `50.18 kB`，均通过预算。`tsc -b apps/studio-client`、聚焦 ESLint、`git diff --check` 与生产构建通过。
- 2026-09-14：未执行主观视觉验收；Panel 深链由 lazy render 路径与生产构建覆盖，仍需实际浏览器交互确认加载手感。
- 2026-09-14：WP2 引入 TanStack Query，Prompt Resource、Setting Mount 与 Preset Tool Mount 由 Query Cache 作为唯一远端真相源；Mutation 通过领域失效或直接缓存更新同步，不再手工编排三组 `Promise.all` 刷新。
- 2026-09-14：WP3 的 `fast-check` 属性测试在 200 轮操作序列中发现并修复了“把目录移动到自身后代会丢失整个子树”的真实缺陷；新增节点唯一性、根节点保留、顺序引用和节点数量不变量。
- 2026-09-14：WP4 基准显示 500 条纯派生成本远低于单帧预算，未安装 `proxy-memoize`；WP5 没有符合边界的可变高度纯文本消费者，未安装 Pretext。
- 2026-09-14：WP6 同批升级 React、React DOM 与类型到 `19.3.0`，使用 Compiler annotation mode 只编译 Context Asset Search；生产输出包含 Compiler memo cache，构建和定向行为测试通过，尚未执行浏览器 Profiler 对比。
- 2026-09-14：WP7 在 `packages/shared` 建立 Setting Mount 的 Zod Schema 和推导类型，Client、Server、Application Data 与 Application Runtime 删除对应重复 DTO；Server 在 RPC 信任边界解析请求。
- 2026-09-14：新增 `knip.json` 和 `audit:unused`。登记动态入口及配置依赖后，审计仍报告 1 个孤儿脚本、27 组未使用导出、34 组未使用类型和 1 个重复导出，保留为后续可核查的减法清单，不自动删除公共表面。
- 2026-09-14：最终客户端预算为主入口 `190 kB` gzip、全部 JavaScript `652 kB` gzip、CSS `52 kB` gzip；当前实测约为 `188.06 kB`、`650.78 kB`、`50.18 kB`。总量主要由按需加载的 `yaml-scalar-highlight`（约 `146.36 kB` gzip）和 CodeMirror（约 `57.98 kB` gzip）组成，后续减包应优先审查这两个异步能力，而不是放宽首屏预算。
