# Shared API

Client 第一方业务 API 入口。先看 [`studio-api.ts`](./studio-api.ts) 的领域方法适配，再看 [`trpc-client.ts`](./trpc-client.ts) 的类型推导与传输，最后看 [`session-fetch.ts`](./session-fetch.ts) 的浏览器会话行为。

`StudioRpcInputs` / `StudioRpcOutputs` 从 Server `AppRouter` 推导，`StudioApi` 是 `createStudioApi` 的返回类型。Feature 通过 App 注入 `StudioApi`，不应自行复制 DTO 或创建平行 RPC client。新增/调整第一方 procedure 时，沿 Server Router 类型修正 API 映射和 Feature 调用；具体服务端合同由 Server 文档与实现负责。

`trpc-client` 默认以 `/trpc` 为基地址，向 `/trpc/<procedure>` 发送同源 POST，并使用 `createSessionFetch`。fetch 会带同源凭证；浏览器遇到 401 时尝试 `POST /auth/session`，仅在认证成功后重试原请求一次。这不是通用网络重试策略。RPC 失败日志由注入 Logger 记录，不在 API 层承担领域状态缓存。

动态 Extension/SDK 的 [`client-bridge.ts`](./client-bridge.ts) 是单独的桥接边界，不作为第一方 Feature API 的快捷入口。[`data-commit-events.ts`](./data-commit-events.ts) 与 [`extension-events.ts`](./extension-events.ts) 适配 SSE 提交通知，也不替代 tRPC 查询；分页 API 的游标收集可复用 [`collect-pages.ts`](./collect-pages.ts)。

改动入口：Router 类型消费或 transport 改 `trpc-client.ts`；认证失败重试边界改 `session-fetch.ts`；领域调用名与参数映射改 `studio-api.ts`；SSE 订阅改对应 event adapter。跨层状态仍归 Feature。相关验证入口：[API 映射](../../../../../tests/unit/client/studio-api.test.ts)、[启动与认证接线](../../../../../tests/unit/client/studio-startup.test.ts)。
