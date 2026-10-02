# `@loom-studio/extension-sdk`

> **状态**：Active Package Guide / Current Source Is Authority

Extension SDK 定义 Extension 作者侧的 TypeScript 合同。它描述 Manifest v2、Package/Module/Instance identity、Activation Context 与 Capability facade；它不负责加载、授权或运行 Extension。

Package 可以没有 Module，仅携带声明式 Prompt Resource、工具定义或转换规则。静态贡献只有经 Studio 显式导入后才形成 Application 资源；声明本身不代表已安装、已授权或已激活。

Preset contribution 的 `settingMounts` / `textUses` 表达资源使用关系，支持包内 contribution 引用或外部引用；`toolMounts` 配置工具使用。它们不创建预设专属资源 Owner，也不会将外部引用内容自动打包。一个扩展可携带多个预设并共享定义，模块生命周期仍由 Host 管理，不跟随 Session 选择自动启停。

Server Module 可用授权的 `ctx.prompt.build` 构建本安装资源或逐次 Anchor 内容，也可用 `ctx.ai.invokeModel` 显式指定模型进行直接调用；两者不要求 Session，不选择默认预设或绕过安装资源/凭据边界。接口详情见[Provider 与 PromptBuild](../../docs/architecture/application/agent/provider-and-prompt-build.md#extension-直接构建与模型调用)。

## 公共入口

唯一入口是 [`src/index.ts`](./src/index.ts)。除 `defineServerExtension(module)` identity helper 外，也提供 iframe 作者侧连接代理；其余导出以类型合同为主：

- Manifest v2 与 Package/Module/Instance identity；
- RPC、Event、Document、Asset 与 AI Gateway capability；
- Config/Record Storage 和 Portable Payload；
- `ExtensionActivationContext`；
- `ServerExtensionModule`。

典型入口：

```ts
import { defineServerExtension } from '@loom-studio/extension-sdk'

export default defineServerExtension({
  activate(context) {
    // 只使用 context 暴露并授权的 capability。
  },
})
```

SDK 不读取 Manifest 文件、不动态导入模块、不创建 Host、不执行 grant/lifecycle，也不暴露 Kernel、SQL connection 或内部 Registry。Server Module 当前仍是受信任的同进程 Node.js 代码；Capability contract 不等于恶意代码安全沙箱。

### Client iframe 通知

```ts
import { connectIframeContext } from '@loom-studio/extension-sdk'

const ctx = await connectIframeContext()
await ctx.notifications.show({ message: '完成', level: 'success' })
// 自己的页面不再使用连接时：
ctx.dispose()
```

Client Module 必须声明 `capabilities: { "ui.notify": true }` 并获得用户授权；Loom Script 使用 Metadata 请求与 Mount Grant。Client Module／Loom Script 原生 ctx 也提供 `notifications.show()`。连接代理只开放已实现的固定方法，不复制整个宿主 ctx；普通消息 HTML 没有业务桥。通知只接受有限流的站内纯文本，详见 [iframe 基础设施](../../docs/architecture/ui/iframe-runtime.md)。

日志与查询使用受 Host 控制的接口：

```ts
ctx.logger.info('legacy message', { phase: 'active' })
ctx.logger.child('sync').log('info', 'Sync completed', {
  event: 'sync.completed',
  data: { count: 12 },
})
const page = await ctx.logs.query({ limit: 50, source: 'current' })
```

旧的 `info(message, data)` 仍把第二参数作为 data；结构化 event 使用 `log`。`ctx.logs.query` 只查询当前 Host 固定归属的扩展日志，不能读取任意 package、文件路径或保留的 `logs.*` RPC。

### 状态订阅与清理保证

- 订阅安全：`ctx.state.subscribe` 等事件与状态监听通过受控 `AbortSignal` 协调；预取消的 Signal 绝不会创建有效订阅，正常取消与重复 `dispose()` 保持完全幂等；
- 资源释放：扩展在收到 `dispose` 通知时必须清理自身句柄；Host 保证单模块清理异常被隔离并记录，不会造成 sibling 模块或宿主环境级联崩溃。

## SDK 与 Host

```text
@loom-studio/extension-sdk
  Extension 作者编译时和激活时看到的合同。

@loom-studio/extension-host
  Studio 侧读取 Manifest、加载模块并执行 capability gate 的实现。
```

Host 的物理目录位于 [`extension-host/`](./extension-host/)，但它拥有独立 Package identity，不是 SDK 的 export subpath。

## 构建与验证

```bash
pnpm --filter @loom-studio/extension-sdk build
pnpm exec vitest run tests/contract/extension-host
```

Server 合同主要由示例 Extension 构建和 Extension Host contract tests 覆盖。iframe 代理与通知的可执行验证见 `tests/unit/client/iframe-channel.test.ts` 和 `tests/probes/client/iframe-runtime.md`。

## 正式文档

- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Extension Data and Portable Payload](../../docs/architecture/application/extension/data-and-portable-payload.md)
- [Extension Host Package Guide](./extension-host/README.md)
