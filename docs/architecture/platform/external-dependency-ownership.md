# External Dependency Ownership

Loom Studio 选择第三方依赖时，不只记录“安装了什么”，还记录它在架构中负责什么。
这份所有权用于避免同一问题同时出现项目依赖、手写实现和另一套状态源。

精确版本以各 Workspace 的 `package.json` 和根 `pnpm-lock.yaml` 为准；本文只记录稳定的能力边界，
不复制容易漂移的补丁版本清单。

## 1. Client 能力所有权

| 问题 | 当前选择 | 所有权边界 |
| --- | --- | --- |
| 组件与渲染生命周期 | React / React DOM | 第一方 Client UI 的渲染基座。普通界面不建立平行的手工 DOM 组件系统；Extension Renderer adapter 除外。 |
| 页面身份与深链接 | React Router | Path、Query、Hash 与 History 的唯一导航所有者。普通工作台选择和拖拽状态不反向制造第二套路由。 |
| 本地应用与布局状态 | Zustand | Panel 尺寸、目录展开、当前本地选择、外观和其他可持久化 UI 偏好。新增启动恢复状态应进入所属 store，而不是由组件平行读写 `localStorage`；它不保存服务端 canonical resource cache。 |
| 缓存型服务端状态 | TanStack Query | Query key、请求去重、缓存、失效和远端错误状态。当前 Prompt Resource、Setting Mount 和 Preset Tool Mount 已迁移；其他领域迁移前仍以当前实现为事实。 |
| 无界集合渲染窗口 | TanStack Virtual | FileTree 等可能随数据增长的可见行窗口。是否虚拟化由集合上界和实际渲染成本决定，不为固定小列表机械接入。 |
| Context Menu / Dropdown | Radix primitives | 键盘导航、焦点、Dismiss 和 Overlay 基础语义。业务层组合项目内容，不重复实现菜单基础设施。 |
| 瞬时通知 | Sonner | 成功、失败和短时反馈。可恢复错误和持久状态仍由对应 feature 或页面拥有。 |
| 长文本与代码编辑 | CodeMirror / Lezer | 需要语法、搜索、历史、差异或结构化高亮的编辑器。普通短字段继续使用原生 input/textarea。 |
| Markdown 展示 | react-markdown + remark-gfm | 第一方 Markdown 到 React 的渲染路径。不得用正则或 `innerHTML` 再建简化 Markdown parser。 |
| YAML 解析与序列化 | `yaml` | State 等 YAML 文本的结构化解析。业务代码不手写缩进、标量和转义规则。 |
| 图标 | Lucide 与既有品牌图标资产 | 通用操作图标优先 Lucide；品牌图标使用已有静态资产，不重复维护手绘通用 SVG。 |
| 样式 | SCSS Modules + `--loom-*` Custom Properties | 局部样式隔离和公共主题 token。当前没有 Tailwind、CSS-in-JS 或重型全局组件库合同。 |

状态所有权可以简化为：

```text
URL / History identity       -> React Router
Remote cached server state   -> TanStack Query
Local application preference -> Zustand
Ephemeral draft / interaction -> React component or feature hook
Streaming domain lifecycle   -> owning Agent / Narrative feature
```

同一事实不得长期由 Query Cache、Zustand 和组件 state 同时作为可写真相源。迁移一个领域时，
读取、Mutation、失效和错误状态应一起迁移；表单草稿、拖拽预览和未保存编辑不进入 Query Cache。

## 2. Server 与跨端能力所有权

| 问题 | 当前选择 | 所有权边界 |
| --- | --- | --- |
| Server HTTP | Node `node:http` | Studio Server 的 HTTP/RPC 入口。当前没有 Express、Fastify 或 Hono 平行层。 |
| SQLite | Node `node:sqlite` + `@loom-studio/data-engine` | Connection、migration 和 transaction 的统一入口。领域 Store 不各自创建数据库基础设施。 |
| Provider HTTP 与代理 | Undici | Application Runtime 的 Provider 请求和 `ProxyAgent`。普通 Server 路由优先使用平台现有 HTTP 能力。 |
| ZIP 编解码 | fflate | Card、Prompt Resource、Extension Package 和官方内容压缩。不得为单个资源格式再写 ZIP parser。 |
| 边界 Schema | Zod | 当前用于 AI Gateway Provider 配置和 Shared Setting Mount RPC Schema。新增跨端结构化边界且没有既有 parser 时优先复用；可信内部纯函数不重复 parse。 |
| 跨端纯契约 | `@loom-studio/shared` | JSON DTO、Schema 和浏览器/Node 都可执行的纯逻辑。不得依赖 React、数据库、Node 专属 API 或 Application Runtime。 |

TypeScript 类型不替代运行时信任边界校验，Zod 也不替代内部类型系统。某个跨端领域采用 Zod 后，
Schema 应成为该字段的类型来源；已有 Manifest 等专用 parser 不因本规则被机械重写。

## 3. 构建与质量依赖

| 能力 | 当前选择 | 使用方式 |
| --- | --- | --- |
| Client 构建 | Vite / Rolldown | Panel 使用动态 import 形成领域 chunk；分析插件只在显式分析构建启用。 |
| 编译期 memoization | React Compiler | 当前为 annotation mode，仅带 `use memo` 的试点组件进入 Compiler，不把它当作宽 selector 或错误状态边界的补丁。 |
| 单元与契约测试 | Vitest | 默认测试入口；按风险运行最小相关集合。 |
| 状态不变量 | fast-check | 树操作、排序和状态转换等操作序列；不为简单映射制造形式主义属性测试。 |
| 纯逻辑基准 | mitata | 可重复的 model/lib 性能基线；不冒充浏览器 DOM、React commit 或交互手感。 |
| 未使用代码审计 | Knip | 报告候选孤儿文件、依赖和导出；动态入口显式登记，结果不自动删除。 |
| 包体积治理 | Size Limit + Rollup Visualizer | Size Limit 保护入口与总量预算；Visualizer 定位 chunk 和重复依赖，只在分析时生成报告。 |
| 静态检查 | TypeScript + ESLint | 类型、导入边界和局部规则。当前不把未安装的格式化工具描述为强制流水线。 |

## 4. 开发时的默认选择

新增实现前，先按问题类型查上面的所有者。现有依赖已经拥有缓存、焦点、路由、解析、虚拟窗口或事务语义时，
默认复用它或项目已有 adapter，而不是只复用其类型、再手写一套生命周期。

这不是永久技术白名单。下列情况可以不使用当前选择：

- 现有依赖不覆盖当前语义，并且差异可以从真实调用链或可复现行为中证明；
- 原生平台能力更小、更清楚，且不会复制已有状态或生命周期；
- 依赖的运行时、包体积、安全或宿主边界与目标 Workspace 不兼容。

例外实现应靠近真实消费者，说明为什么现有所有者不适用，并避免长期保留两套可写路径。
若例外会形成新的跨模块基础设施、公共合同或依赖替换，应先记录到 Workbench Issue/Plan；普通局部实现不需要额外审批。

## 5. 当前明确没有形成的合同

- `dnd-kit` 已不在 Studio Client 依赖中；不要根据旧文档假设拖拽由它负责。
- Pretext 与 `proxy-memoize` 没有安装；只有出现符合边界的真实消费者和性能证据后才重新评估。
- Redux、MobX、Jotai、XState 等没有成为全局状态基座。
- Tailwind、CSS-in-JS、Ant Design、MUI 与 shadcn/ui 没有成为第一方 UI baseline。
- Express、Fastify、Hono、Prisma、TypeORM 与通用 Repository 没有成为 Server baseline。

“没有形成合同”不表示永久禁止，而是当前代码不能依赖这些能力已经存在，也不能绕开现有所有者后静默建立平行体系。

## 6. 当前实现入口

- Client Provider 组装：[`apps/studio-client/src/main.tsx`](../../../apps/studio-client/src/main.tsx)
- Prompt Resource Query 所有者：[`use-prompt-resource-state.ts`](../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.ts)
- Zustand 布局状态：[`studio-layout-store.ts`](../../../apps/studio-client/src/pages/studio/model/studio-layout-store.ts)
- 虚拟 FileTree：[`file-tree.tsx`](../../../apps/studio-client/src/shared/ui/file-tree/file-tree.tsx)
- Shared Setting Mount Schema：[`prompt-resource-contracts.ts`](../../../packages/shared/src/prompt-resource-contracts.ts)
- Client 构建与 Compiler 试点：[`vite.config.ts`](../../../apps/studio-client/vite.config.ts)
- 审计和体积命令：[`package.json`](../../../package.json)
