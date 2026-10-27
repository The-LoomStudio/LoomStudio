# App 装配

Client 的跨 Feature 入口。先看 [Workspace README 的 FSD 与状态归属](../../README.md#源码导航与-fsd-架构规范)，再按任务阅读：

1. [`main.tsx`](../main.tsx)：浏览器启动、开发预览分流、认证会话、QueryClient 与 Router。
2. [`app.tsx`](./app.tsx)：页面与 Widget 组合、跨 Feature 回调和宿主级事件接线。
3. [`use-studio-state.ts`](./use-studio-state.ts)：创建 typed API、组合 Feature hooks，并向 App 提供 facade。
4. [`use-studio-derived-state.ts`](./use-studio-derived-state.ts)：仅在派生的展示状态或选择关系有问题时继续读。

`main.tsx` 在正式入口先 `POST /auth/session`，再挂载 `BrowserRouter`、`QueryClientProvider` 和 `AppErrorBoundary`。因此依赖 Query 的 Feature hook 必须在应用树下运行；API endpoint、Logger、翻译函数及操作执行器由 App/facade 注入。开发预览在 `import.meta.env.DEV` 下提前分流，不经过正式认证与业务初始化。

`useStudioState` 用 `/trpc` 作为实际 RPC transport；派生的 `/rpc` endpoint 只作为 workspace/draft 本机键的兼容 scope，不代表网络路由。调整二者时要分别核对调用地址与既有本地状态键。

`useStudioState` 持有 App 级组合职责，`App` 负责跨领域的展示接线。具体领域查询、命令、运行生命周期仍由对应 Feature 所有；不要把它们移入 App，也不要让 Widget 直接调用 RPC。状态分类与 FSD 规则沿用 Workspace README，不在此重复定义。

改动入口：启动、Provider 或路由前置条件改 `main.tsx`；跨 Feature 组合、导航和面板接线改 `app.tsx` / `use-studio-state.ts`；领域行为回到对应 Feature；展示布局留在 Page/Widget。跨层合同见[系统总览](../../../../docs/architecture/system-overview.md)。

相关验证入口：[启动装配](../../../../tests/unit/client/studio-startup.test.ts)、[useStudioState](../../../../tests/unit/client/use-studio-state.test.ts)、[工作区导航](../../../../tests/unit/client/studio-workspace-navigation.test.ts)。按实际改动选择；这些路径只是定位入口。
