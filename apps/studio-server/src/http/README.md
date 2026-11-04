# Server HTTP 边界

从 [Server 组合根](../../README.md)进入本目录。这里拥有 Node HTTP 接纳、应用会话认证、文件/流投递，以及把 RPC 请求交给官方 tRPC adapter；领域写入归 Runtime，扩展文件归属与媒体权限由组合根注入的服务判断。

## 阅读顺序

1. [`http-server.ts`](./http-server.ts)：`createStudioHttpServer(options)` 的依赖、路由顺序与 `shutdown()`。
2. [`application-session-auth.ts`](./application-session-auth.ts)：启动时生成的会话、Cookie 与 loopback Origin 检查。
3. [`trpc-request.ts`](./trpc-request.ts) → [`RPC 边界`](../rpc/README.md)：可信身份、取消与调用链如何进入 procedure。
4. 按需读 [`rpc-request-body.ts`](./rpc-request-body.ts) 或 [`client-files.ts`](./client-files.ts)，定位请求预算或发行前端文件问题。

## 输入、认证与注入

`GET /health` 与 `POST /auth/session` 在普通 API 认证前处理；配置 `clientDirectory` 时，前端静态文件也在业务认证前由 `client-files.ts` 投递。其余路由先验证应用会话 Cookie，显式 Origin 还必须通过允许来源检查。会话 bootstrap 要求精确的 loopback HTTP(S) Origin；这不是多用户登录或公网认证系统。生产与开发允许来源由 [`server.ts`](../server.ts)注入，不在 procedure 中重新推断。

认证服务在当前进程绑定 token、sessionId 与 clientId；RPC 使用认证结果中的 clientId，不接受 JSON 参数冒充调用身份。浏览器 Cookie 为 HttpOnly / SameSite=Strict，HTTPS bootstrap 追加 Secure。资源本身的 owner、安装范围和 grant 仍由下游服务校验；有应用会话不等于获得任意扩展数据能力。

HTTP options 注入 Runtime、`StudioRpcServices`、Asset Store、Card transfer、扩展图标/文件读取与事件订阅。可选能力未装配时不建立对应完整业务入口；不要在路由里新建 Store、Kernel、安装器或目录状态。

## 文件、SSE 与 RPC 的交接

| 路径类别 | HTTP 拥有的部分 | 交给谁 |
| --- | --- | --- |
| 前端文件 | GET/HEAD、realpath 根边界、MIME/cache、受限 `/studio` 页面 fallback | `client-files.ts`；API 前缀不进入 SPA fallback |
| Asset / Card 媒体与导入导出 | raw body、响应头、长度/流和路径解析 | 注入的 Asset Store / Card transfer；格式与容器合同见[Card 文件](../../../../docs/architecture/application/card-bundle-files.md) |
| 扩展图标/文件与 Card 扩展资产 | URL 解码、响应投递；Card 资产入口调用安装范围读取判定 | Extension Manager / 组合根提供的权限回调，不把 URL 当物理文件路径 |
| `/extensions/events` | SSE 编码、心跳、背压预算、连接关闭后的订阅释放 | 组合根选择的失效事件；断线后重读权威数据，不提供可靠事件重放 |
| `/trpc/*` | POST、JSON Content-Type、认证、请求体预算、取消信号 | `trpc-request.ts` 的官方 Fetch adapter → `rpc/trpc/router.ts` |

JSON RPC 先按实际传输字节有界读取，再交 adapter 解析；声明或实际大小超限返回 413 并关闭连接。预算常量只在 `rpc-request-body.ts` 维护，媒体入口保留各自预算；不要将其复制为一套全局业务文件限额。tRPC batching 关闭，Query 同样通过 POST；旧 `/rpc` 不作兼容网关。

`trpc-request.ts` 从认证会话建立 clientId，生成 callId，读取有长度边界的 correlation / parent-call headers，返回调用链响应头；它把这些字段、当前 AbortSignal、Runtime 和服务引用作为 context 注入，业务参数不承担这些职责。

## 取消、关闭与修改入口

每个请求登记自己的 AbortController 与工作 Promise；响应在完成前断开会取消请求。`shutdown()` 停止接纳、取消已登记请求、关闭连接并等待工作收敛；SSE 在 close 时释放订阅。组合根在排空后才关闭 Script、Kernel 和持久化依赖，不能用强制超时跨过仍在使用 Store 的工作。

修改认证或 Origin 看 `application-session-auth.ts`；修改文件投递/HTTP 路由看 `http-server.ts` / `client-files.ts`；修改 RPC body 或 adapter 看 `rpc-request-body.ts` / `trpc-request.ts`。新 procedure 应进入 [RPC 层](../rpc/README.md)，不在此增加平行 JSON 分发器。

已有验证定位：[`application-session-auth.test.ts`](../../../../tests/integration/studio-server/application-session-auth.test.ts)、[`origin-protection.test.ts`](../../../../tests/integration/studio-server/origin-protection.test.ts)、[`rpc-request-body.test.ts`](../../../../tests/integration/studio-server/rpc-request-body.test.ts)、[`trpc-cancellation.test.ts`](../../../../tests/integration/studio-server/trpc-cancellation.test.ts)、[`shutdown.test.ts`](../../../../tests/integration/studio-server/shutdown.test.ts)、[`assets-http.test.ts`](../../../../tests/integration/studio-server/assets-http.test.ts)与 [`client-files.test.ts`](../../../../tests/unit/studio-server/client-files.test.ts)。这些是按问题选用的入口，不代表本次已执行。

Card 扩展资产的用户 HTTP 授权策略位于 `../extensions/extension-asset-access.ts` 的 `canReadCardExtensionAsset`；Server 组合根只注入 Store 与 capability 查询。该策略与扩展代码消费资源时的声明依赖检查保持分离。
