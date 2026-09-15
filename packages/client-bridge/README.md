# `@loom-studio/client-bridge`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/client-bridge` 是供前端 Web Client 消费 Studio Server 服务的 RPC 调用桥梁。它封装基于 HTTP `fetch` 的 JSON-RPC 2.0 传输细节，并提供会话凭证自动重连能力。

## 业务使命与自动会话刷新

在浏览器端，前端组件与 Feature 逻辑需要调用后端的大量 RPC 方法（如 `application.*`、`docs.*`、`system.*`）。
`@loom-studio/client-bridge` 解决底层传输与鉴权痛点：
- **自动封装 JSON-RPC 2.0**：自动分配客户端调用 ID，统一序列化请求体与反序列化响应；
- **401 无感静默重连**：当检测到 HTTP 401 认证失败时，自动尝试调用 `/auth/session` 重新握手并重试当前请求，避免因会话过期造成页面闪退或数据提交丢失；
- **环境适配**：默认使用宿主 `globalThis.fetch`，同时也支持在测试中显式注入自定义 Mock `fetch`。

---

## 架构规约与职责边界 (Rules & Boundaries)

1. **纯传输适配器定位（Pure Transport Bridge）**：
   - 本包**只负责底层 RPC 字符串方法调用与网络错误映射**；
   - **严禁在本包定义具体的业务 API 方法签名或前端状态**；具体的强类型映射由 Client 内部的 `apps/studio-client/src/shared/api/studio-api.ts` 承担。
2. **禁止侵入 UI 与状态**：
   - 严禁引入 React、Zustand、TanStack Query 或页面状态逻辑。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createClientBridge(options)`：创建客户端调用桥实例；
- 核心方法：`bridge.call<T>(method, params)`；
- 核心类型：`ClientBridge`、`ClientBridgeOptions`、`ClientJsonValue`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/client-bridge build

# 运行 ClientBridge 契约与自动重试测试
pnpm exec vitest run tests/contract/client-bridge
```

---

## 正式文档

- [Kernel RPC 机制说明](../../docs/architecture/kernel/README.md)
- [Client 架构与 typed API Client](../../apps/studio-client/README.md)
