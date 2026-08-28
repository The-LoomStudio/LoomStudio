# `@loom-studio/kernel`

> **状态**：Active Package Guide / Current Source Is Authority

Kernel 是业务无感知的平台协调层：组装平台服务、维护进程内 RPC Registry 与 Event Bus，并投影数据提交事实。它不理解 Card、Prompt、Agent、Provider 或前端交互。

## 公共入口

当前 Package 只有 [`src/index.ts`](./src/index.ts) 一个源码入口，主要公开：

- `createKernel()`、`Kernel` 与 `CreateKernelOptions`；
- `createEventBus()` 和 Event Definition/emit/subscribe 类型；
- Kernel/Extension RPC context、handler 与 registration handle；
- Extension Management adapter；
- Public Surface 与 Introspection 类型。

具体 RPC 方法和参数以源码及运行时 `system.introspect` 为准，不在 README 维护第二份 schema。

## 生命周期与组成

```text
createKernel(options)
  -> start()
       注册内建 RPC
       订阅 Data Commit
       发布 system.ready
  -> callRpc() / Event Bus
  -> stop()
       发布 system.stopping
       dispose Extension Host
```

`createKernel()` 由 Studio Server 注入 Document Store、Data Commit Source、Diagnostics、Trace Audit、Extension Host、可选 Extension Management Service 与 Loom Runner。

当前保留 RPC namespace：

```text
system / events / docs / extensions / diagnostics / loom / trace / audit
```

Kernel 负责 RPC owner/冲突校验、调用链 ID、Data Commit 事件投影、Document/Revert 薄适配、Extension 管理适配、Diagnostics/Trace/Audit/Loom 调用和动态 Introspection。

Kernel 不拥有 Application Runtime、Provider 选择、Prompt 编译、Narrative/Agent Store、HTTP/WebSocket/SSE Transport 或前端状态。Event Bus 也不是 Application Command Bus、可靠队列或网络 Stream。

## 构建与验证

```bash
pnpm --filter @loom-studio/kernel build
pnpm exec vitest run tests/contract/kernel/kernel-rpc.test.ts
```

Package 自带测试脚本可能因 `--passWithNoTests` 空跑成功；Kernel 合同使用上面的根目录测试验证。

## 正式文档

- [Kernel Architecture](../../docs/architecture/kernel/README.md)
- [Data Architecture](../../docs/architecture/data/README.md)
- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Loom Core Studio Integration](../../docs/architecture/application/prompt-build/loom-core/studio-integration.md)
