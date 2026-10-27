# Server RPC 边界

从 [Server 组合根](../../README.md)或 [HTTP adapter](../http/README.md)进入本目录。这里把不可信 JSON 输入解析为 Runtime/宿主服务的调用；不拥有领域 Store、Provider 执行流程或扩展实例生命周期。

## 阅读顺序

1. [`trpc/router.ts`](./trpc/router.ts)：`studioTrpcRouter` 组装当前静态 procedure，并导出 `AppRouter` 类型。
2. [`trpc/context.ts`](./trpc/context.ts)：context、公共 middleware、错误形状、`jsonInput` 与 `serviceProcedure`。
3. [`trpc/services-context.ts`](./trpc/services-context.ts) → [`server.ts`](../server.ts)：核对 procedure 所需服务如何装配。
4. 按问题进入 `trpc/application/<领域>.ts`、[`trpc/services.ts`](./trpc/services.ts)或 [`trpc/kernel.ts`](./trpc/kernel.ts)，再沿实际调用进入 Runtime / Kernel / Server 服务。

## 类型、输入与可信上下文

Server package 的 `./trpc` 仅导出 router 声明类型，Client 通过 `import type` 推导输入/输出与 typed client；不能从前端加载 router 或 Node 运行时代码。静态方法签名来自实际 procedure，不在 Shared 或 Client 另建完整方法表。动态扩展的未知 JSON 返回值不因此变成有静态保证的领域 DTO。

HTTP 已完成应用会话认证，`trpc-request.ts` 注入 `runtime`、`request`、可选 `services`、Logger 与导入转换器。`request` 中的 clientId、调用链与 abortSignal 不从业务 JSON 参数读取。公共 middleware 先检查取消，记录安全成功摘要；adapter 记录失败。错误 formatter 保留领域 code 和调用链，不向客户端返回 stack。认证及请求体超限等前置失败仍由 HTTP 响应，不强行包装成领域错误。

输入边界使用 Zod，或通过 `jsonInput()` 先接受合法 JSON 再调用既有 reader；[`rpc-params.ts`](./rpc-params.ts)提供原始字段读取。新增结构有共享 Schema 时复用它，已有 Manifest/Artifact parser 继续由实际所有者维护。类型推导不替代边界校验，也不要求可信内部调用重复 parse。

## Runtime 与宿主服务的交接

| 入口 | 调用目标与必要前提 |
| --- | --- |
| `trpc/application/` | 通常把解析后的 input 与可信 `ctx.request` 交给 `ctx.runtime`；查询不必机械传入写入上下文。领域版本冲突、绑定、采用、恢复和事务由 Runtime / Store 负责。 |
| `trpc/services.ts` / `dashboard.ts` | 使用注入的日志、官方内容、网络、目录、AI Gateway 或统计服务；不在 procedure 内创建第二份服务状态。 |
| `trpc/application/loom-scripts.ts` | Script 文档/Mount 写入交给 Runtime；需要更新 Server 实例时再协调注入的 Script service。保存源码不等于启动实例。 |
| `trpc/kernel.ts` 的平台 procedure | 通过 typed input 转入已有 Kernel `callRpc`，保留 Kernel 的 owner、安装检查与调度。 |

`StudioRpcServices` 的主要装配者是 `server.ts`。`serviceProcedure` 要求 service 容器存在，但具体可选能力仍由对应 handler 检查；测试或其他宿主直接创建 caller 时，必须按当前路径提供 Runtime、request 和所需服务。省略目录、历史日志、AI 等 adapter 不代表存在完整实现。

跨存储写入应沿 Runtime 既有业务流程；Server 的目录、导入或 Script 协调可以调用多个已存在服务，但不能据此把整个请求、Provider 调用或工具外部副作用描述为一个原子事务。领域边界见 [Application](../../../../docs/architecture/application/README.md)、[Data](../../../../docs/architecture/data/README.md)与 [Runtime/Session](../../../../docs/architecture/application/agent/runtime-and-session.md)。

## 静态平台与动态扩展

`kernel.invoke` 只给动态扩展方法使用。它拒绝静态平台保留命名空间，调用者不能借传入 method 绕过具体 typed procedure 的输入合同；实际扩展 owner、权限、安装范围与实例生命周期继续由 Kernel / Host 判断。已指定 Package/安装目标的管理调用沿 `extensions` 的既有入口，不从普通业务 params 猜测安装身份。

新增静态 API：在所属 `trpc/application/` 或平台 router 声明 procedure，并在 `router.ts` 组装；方法返回类型由真实 handler 推导。修改安全摘要定位 [`rpc-summary.ts`](./rpc-summary.ts)，修改参数读取定位 `rpc-params.ts`；修改领域行为则沿调用进入其拥有者。完整动态权限规则见 [Kernel](../../../../docs/architecture/kernel/README.md)和 [Extensions](../../../../docs/architecture/extensions/README.md)，不要在 RPC 层复制授权表。

已有验证定位：[`trpc-envelope.test.ts`](../../../../tests/contract/rpc/trpc-envelope.test.ts)覆盖传输合同；[`mutation-context.test.ts`](../../../../tests/integration/studio-server/mutation-context.test.ts)定位调用上下文；[`trpc-mounts.test.ts`](../../../../tests/integration/studio-server/trpc-mounts.test.ts)定位 Mount 输入；[`loom-script-rpc.test.ts`](../../../../tests/integration/studio-server/loom-script-rpc.test.ts)定位 Script 接线。其他领域沿同目录 `<领域>-rpc.test.ts` 选择，不以本文替代真实路径验收，本次未执行这些检查。
