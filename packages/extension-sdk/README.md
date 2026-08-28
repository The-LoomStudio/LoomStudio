# `@loom-studio/extension-sdk`

> **状态**：Active Package Guide / Current Source Is Authority

Extension SDK 定义 Extension 作者侧的 TypeScript 合同。它描述 Manifest v2、Package/Module/Instance identity、Activation Context 与 Capability facade；它不负责加载、授权或运行 Extension。

## 公共入口

唯一入口是 [`src/index.ts`](./src/index.ts)。当前运行时代码主要只有 `defineServerExtension(module)` identity helper，其余导出以类型合同为主：

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

SDK 当前没有独立的有效运行时测试入口；真实合同主要由示例 Extension 构建和 Extension Host contract tests 覆盖。

## 正式文档

- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Extension Data and Portable Payload](../../docs/architecture/application/extension/data-and-portable-payload.md)
- [Extension Host Package Guide](./extension-host/README.md)
