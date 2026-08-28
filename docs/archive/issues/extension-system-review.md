# 扩展系统与插件运行时审查报告 (Extension System & Host Review)

> **状态**：Historical Audit Snapshot / Superseded

## 审查目标

全面排查 Loom Studio 的 **扩展与插件基础设施**（涵盖 `packages/extension-sdk/`、`packages/extension-sdk/extension-host/`、`apps/studio-server/src/extensions/` 及示例插件 `extensions/example-echo/`），重点审查：
1. **沙箱隔离与安全性边界**
2. **生命周期管理与热重载（Reload / Dispose）可靠性**
3. **能力授权（Capabilities / Grants）与命名空间隔离**
4. **包结构物理布局与代码组织冗余**

---

## 1. 核心优势与架构亮点

1. **严格落地 ADR-006 三层模型**：
   - 彻底解耦了 `Package`（分发与静态资源）、`Module`（执行入口与能力声明）、`Instance`（运行时 Scope 与唯一实例 ID `extinst_*`）。
2. **严密的生命周期作用域（`ExtensionScope`）**：
   - 所有注册的 RPC、Event 监听、文档操作、临时 Scratch 文件均挂载在 `ExtensionScope` 上。模块卸载或激活失败时能执行全量自动回滚与物理排空，有效避免孤儿 RPC 泄漏。
3. **声明式权限与命名空间强约束**：
   - 插件 RPC 与 Event 必须严格使用 `packageId.*` 作为前缀，严禁侵入系统保留命名空间（`system.*`、`application.*` 等）。
   - 生产模式下强制校验 Manifest `contributes` 声明，未声明的方法会被拒绝注册。

---

## 2. 核心问题与设计限制清单

### 🔴 [高] 1. 进程内执行（In-Process）带来的安全与隔离边界限制

**文件：** [`packages/extension-sdk/extension-host/src/index.ts` L469-L481](../../../packages/extension-sdk/extension-host/src/index.ts)

**现象分析：**
- 当前 Server 插件通过动态 ESM `import(modulePath)` 直接加载进 **Server 主进程** 运行。
- 虽然 Host 在 API 层（`ctx.rpc`、`ctx.documents`、`ctx.assets`）施加了权限拦截，但由于处于同一 Node.js 运行时：
  - 插件拥有未经受限的 `process`、`fs`、`net` 原生 Node.js 全局访问能力；
  - 插件出现未捕获同步异常或调用 `process.exit()` 会直接导致整个 Studio Server 崩溃；
  - 插件占用的死循环或阻塞计算会直接卡死主事件循环。

**演进建议：**
- 当前模型适合作为“受信任的本地开发者模式”。
- 若未来支持第三方不受信插件市场，需在 ADR 中明确进程外隔离路线（Worker Threads 或独立子进程 IPC）。

---

### 🟡 [中] 2. Node.js ESM 动态重载的内存累积（V8 Module Cache Leak）

**文件：** [`packages/extension-sdk/extension-host/src/index.ts` L477](../../../packages/extension-sdk/extension-host/src/index.ts)

```ts
const loaded = await import(`${pathToFileURL(modulePath).href}?instance=${encodeURIComponent(instanceId)}`)
```

**问题分析：**
- Node.js 官方目前不支持卸载已 import 的 ESM 模块。Host 通过添加 `?instance=...` 查询参数绕过缓存实现重载。
- 每次 `reload` 都会在 V8 堆内存中编译并保留一份新的 Module Record。如果插件在开发期间被频繁热重载数十次，旧模块的闭包若未被完全垃圾回收，会导致 Server 内存持续增长。

**追溯建议：**
- 在 `loadServerModule` 处添加追溯标记：
  ```text
  // ponytail: ESM modules cannot be unimported in Node.js. High-frequency reloads may cause V8 module accumulation.
  ```

---

### 🟡 [中] 3. 包物理结构嵌套导致认知与工程混乱（Ghost Packaging）

**现象分析：**
- `extension-host` 物理目录位于 `packages/extension-sdk/extension-host`（嵌套在 SDK 内部），但在根目录 `pnpm-workspace.yaml` 和 package 声明中又作为 `@loom-studio/extension-host` 独立发包。
- 导致：
  1. 文档和项目地图（`project-structure.md`）多次产生“到底是独立包还是包含在内”的描述冲突；
  2. IDE 文件检索和 Monorepo 根路径认知不直观。

**建议：**
- 将 `packages/extension-sdk/extension-host` 物理平移至顶层 `packages/extension-host`，与其他 17 个包保持一致的扁平化 Monorepo 结构。

---

### 🟢 [低] 4. 工具函数与辅助过滤多处重复声明

**现象分析：**
- `moduleKey(packageId, moduleId)`：在 `extension-host/src/index.ts`、`extension-manager.ts` 和 `extension-sources.ts` 中重复定义了 3 次。
- `serverModules(manifest)`：在 `extension-host` 与 `extension-manager` 中重复定义了 2 次。
- `isRecord(value)`：在 `extension-host` 内部再次独立实现。

**建议：**
- 统一收拢到 `extension-sdk` 或 `shared`。

---

## 3. 审查总结

| 审查维度 | 现状评估 | 风险与建议 |
|---|---|---|
| **架构模型** | Package/Module/Instance 三层设计非常优秀 | 保持并遵循当前 ADR-006 |
| **隔离安全性** | 协作式进程内运行（In-Process） | 明确信任边界，未来演进子进程/Worker |
| **资源释放** | `ExtensionScope` 集中追踪释放，非常严密 | 无孤儿 RPC 或文件泄漏风险 |
| **热重载机制** | URL Query Bypass 缓存 | 留意高频 reload 下的 V8 内存积累 |
| **目录组织** | `extension-host` 嵌套在 `extension-sdk` 内 | 建议扁平化移至 `packages/extension-host` |
