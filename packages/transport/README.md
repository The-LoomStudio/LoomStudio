# `@loom-studio/transport`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/transport` 是 Loom Studio 统一的通信协议与信封契约层。它统一定义跨端网络及进程间通信的 JSON-RPC 2.0 请求、响应、元数据（Meta）与事件（Event）信封格式。

## 业务使命与信封规约

为了保证 Client、Server 以及 Extension 之间的通信具备强类型保障与全链路追踪能力，本包固化了标准的消息通信规范：
- **JSON-RPC 2.0 信封**：
  - `RpcRequest`：包含 `jsonrpc: '2.0'`、递增 `id`、`method`、`params` 以及链路追踪元数据（`correlationId`、`parentCallId`）；
  - `RpcResponse`：包含成功结果（`result`）或标准化序列化错误（`error`），以及响应耗时统计元数据；
- **标准化事件信封 (`StudioEvent`)**：
  - 定义统一的 `name`、`payload`、`eventId`、版本号与发射来源元数据，用于事件总线广播与 SSE 订阅。

---

## 架构规约与环境同构 (Rules & Boundaries)

1. **环境完全同构（Isomorphic & Zero Runtime Dependencies）**：
   - 本包属于纯数据契约层，**严禁引入 `node:http`、`fetch` 或任何特定网络传输实现**；
   - 必须能够在 Node.js、浏览器以及 Web Worker 中安全执行；
2. **错误序列化一致性**：
   - 所有 RPC 错误必须经由 `createErrorResponse()` 标准化格式化为 `{ code, message, details }`，禁止直接抛出包含宿主环境调用栈的裸 `Error` 给对端。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createSuccessResponse(id, result, meta)`：构造标准 RPC 成功响应；
- `createErrorResponse(id, error, code, meta)`：构造标准 RPC 错误响应；
- `parseRpcRequest(value)`：校验并反序列化传入的原始 RPC 请求对象；
- 核心类型：`RpcRequest`、`RpcResponse`、`RpcId`、`RpcRequestMeta`、`RpcResponseMeta`、`StudioEvent`、`EventMeta`、`ServerEventMessage`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/transport build

# 运行信封契约测试
pnpm exec vitest run tests/contract/transport
```

---

## 正式文档

- [Kernel 平台协调与 RPC 机制](../../docs/architecture/kernel/README.md)
