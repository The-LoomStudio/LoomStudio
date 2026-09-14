# 技术栈与外部依赖选型

这是一份开发时的快速入口。正式能力所有权、当前例外和实现入口见
[`Architecture / External Dependency Ownership`](../architecture/platform/external-dependency-ownership.md)。
精确版本以消费它的 Workspace `package.json` 和根 `pnpm-lock.yaml` 为准，不在指南重复补丁版本。

## 1. Client 默认能力

| 任务 | 默认选择 | 不应默认做的事 |
| --- | --- | --- |
| 页面、深链接、History | React Router | 再建一套路由 store，或把普通选择持续写回 URL |
| 本地布局、偏好、工作台选择 | Zustand | 把服务端资源缓存或表单正文塞入全局 store |
| 需要缓存和失效的服务端状态 | TanStack Query | 手写 request guard、全局 loading 和多组 refresh choreography |
| 无界列表或树 | TanStack Virtual | 数据规模可增长时一次挂载全部可见组件 |
| Context Menu / Dropdown | Radix primitives | 重写键盘焦点、Dismiss 和 Overlay 基础行为 |
| 瞬时通知 | Sonner | 用 toast 代替可恢复错误状态 |
| 长文本和代码编辑 | CodeMirror | 为语法、历史、搜索和 diff 自建编辑器 |
| Markdown / YAML | react-markdown、remark-gfm、`yaml` | 使用正则实现简化 parser |
| 图标 | Lucide 与既有品牌资产 | 为通用操作重复维护手绘 SVG |
| 样式 | SCSS Modules + `--loom-*` | 为局部功能引入第二套主题或全局 CSS 框架 |

React 负责局部组件状态。TanStack Query 负责缓存型远端状态，Zustand 负责本地应用状态，
输入草稿和拖拽预览通常留在组件或 feature hook。不要让同一份事实长期在三处双写。

当前 Client 没有 `dnd-kit`、Pretext 或 `proxy-memoize`。旧文档、旧 Diff 或依赖印象不能证明它们仍是项目能力。

## 2. Server 与跨端默认能力

- HTTP/RPC 使用 Node `node:http` 与现有 Transport，不为普通路由增加 Express/Fastify/Hono。
- SQLite 使用 `node:sqlite` 和 `@loom-studio/data-engine`，领域 Store 不各自管理 connection、migration 或 transaction。
- Provider HTTP 与代理复用 Undici；ZIP 编解码复用 fflate。
- Zod 当前用于 AI Gateway 配置和 Shared Setting Mount RPC；新增跨端结构化边界且没有既有 parser 时优先评估，可信内部纯函数继续使用 TypeScript 类型。
- 跨端 JSON DTO、Schema 和纯逻辑进入 `@loom-studio/shared`；Shared 不依赖 React、数据库、Node 专属 API 或 Application Runtime。

## 3. 开发与审计工具

- TypeScript 与 ESLint：类型、导入方向和静态规则。
- Vitest：单元、契约与集成测试。
- fast-check：树操作和状态转换等真实不变量。
- mitata：纯 model/lib 基准，不替代浏览器性能诊断。
- Knip：未使用文件、依赖和导出的候选清单，不自动删除。
- Size Limit 与 Rollup Visualizer：客户端体积预算和按需分析。
- React Compiler：当前仅使用 annotation mode 试点，不替代 selector、状态所有权和组件边界治理。

## 4. 新增实现前的轻量检查

1. 先判断问题是否已经有上表中的能力所有者。
2. 标准库、浏览器/Node 原生能力或现有依赖能完整覆盖时，直接复用。
3. 现有选择不适用时，可以写更小的局部实现，但要能指出真实语义差异，不能并行建立第二套真相源。
4. 新依赖添加到实际消费它的 Workspace，并使用显式版本；Client 运行时依赖应检查是否进入错误的首屏 chunk。

只有当例外会形成跨模块基础设施、公共合同或替换现有所有者时，才需要写入 Workbench Issue/Plan。
普通局部实现不需要为了遵守文档制造包装层或审批流程。
