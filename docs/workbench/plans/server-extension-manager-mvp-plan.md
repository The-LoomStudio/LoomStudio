# Server Extension Manager MVP 实施计划

> **状态**：Complete
> **日期**：2026-08-13
> **范围**：在已经完成的 Server Extension Host 之前增加本地插件发现、启用状态、事件权限 grant 与运行时编排层，消除 Studio Server 对单个示例插件的硬编码加载。
> **非目标**：Client Extension Host、WebSocket Event Transport、Marketplace、正式安装/卸载、签名、自动更新、依赖求解、Worker/子进程安全隔离。

相关文档：

- [`event-system-extension-scope-plan.md`](event-system-extension-scope-plan.md)
- [`../discussion/extensions/studio-extension-lifecycle-v0.md`](../discussion/extensions/studio-extension-lifecycle-v0.md)
- [`../discussion/extensions/studio-extension-host-capabilities-v0.md`](../discussion/extensions/studio-extension-host-capabilities-v0.md)
- [`../discussion/studio-config-and-local-state-v0.md`](../discussion/studio-config-and-local-state-v0.md)

## 1. 当前事实与目标

当前 Server Extension Host 已经负责：

- Manifest 校验与 Server entry 加载；
- `activate(ctx)`、instance identity 与统一 Scope；
- RPC、Event、Document、Logger、Diagnostics capability；
- activation failure cleanup、dispose 与 reload。

但 Studio Server 启动仍然硬编码发现 `extensions/example-echo`。Host 不保存用户本机的安装目录、启用选择和权限 grant，也不负责把多种来源汇总成启动清单。

本阶段增加一层薄的 Server Extension Manager：

```text
Extension Sources
  -> Extension Manager
       source catalog
       enabled state
       granted capabilities
       lifecycle orchestration
  -> Server Extension Host
       instance activation
       scoped capabilities
       cleanup / reload
```

Manager 不成为第二套 Kernel，也不接管 Host 的实例资源。它只管理“哪些插件应当运行”，Host 继续管理“一个插件实例如何运行”。

## 2. 本地来源与状态

沿用既有本地状态目录：

```text
.loomstudio-dev/extensions/
├── installed/
├── dev-links.json
└── state.json
```

首版来源：

1. 仓库开发插件：`./extensions/*`；
2. 外部开发链接：`.loomstudio-dev/extensions/dev-links.json`；
3. 本地已解包目录：`.loomstudio-dev/extensions/installed/*`。

`state.json` 只保存用户选择，不复制 Manifest 或运行时状态：

```json
{
  "version": 1,
  "extensions": {
    "example.echo": {
      "enabled": true,
      "grants": {
        "events.subscribe": ["documents"]
      },
      "updatedAt": "2026-08-13T10:00:00.000Z"
    }
  }
}
```

规则：

- 新发现插件默认禁用；
- `enabled` 表示用户期望，`active/degraded/activation_failed` 表示当前进程事实；
- activation failure 不自动清除 `enabled`；
- grant 只能从 Manifest 已申请的 capability 中取交集；
- 状态文件采用同目录临时文件加原子 rename 写入；
- Manifest、状态文件和 dev links 都作为信任边界输入校验。

## 3. 发现与冲突

`extensionId` 永远以 Manifest 为准，目录名和 dev-link 声明不能替代它。

发现流程：

```text
scan source directories
  -> realpath normalization
  -> parse and validate manifest
  -> validate server entry containment
  -> group by extensionId
  -> reject different directories sharing one extensionId
  -> discover valid unique directories through Host
```

同一真实目录通过多个来源出现时只保留一次；同一 `extensionId` 指向不同目录时不选择“赢家”，而是阻止激活并写入 Diagnostic。

Server entry 的解析结果必须位于插件目录内。该校验同时保留在 Host 加载边界，避免绕过 Manager 后产生路径逃逸。

## 4. 生命周期语义

启动：

```text
Kernel start
  -> Manager initialize
  -> discover all valid extensions
  -> activate enabled extensions independently
  -> one extension failure does not stop Studio Server
```

管理操作：

- `enable`：先持久化 `enabled=true` 与显式 grant，再尝试激活；失败后仍保持期望启用状态；
- `disable`：先持久化 `enabled=false`，再释放当前实例；
- `reload`：不改变 `enabled`，仅对已启用插件执行 Host reload；
- Server stop：仍由 Kernel 调用 Host `disposeAll()`，不复制清理路径。

Manager 在激活、禁用与重载后发布现有 `extensions.changed` 事实事件。事件 payload 只包含 ID、动作、期望启用状态和运行时状态，不广播 Manifest 全文或本地文件内容。

## 5. RPC Surface

首版管理 RPC：

```text
extensions.list
extensions.enable
extensions.disable
extensions.reload
extensions.getDiagnostics
```

`extensions.enable` 接受：

```json
{
  "extensionId": "example.echo",
  "grants": {
    "events.subscribe": ["documents"]
  }
}
```

本阶段不提供名为 `install` / `uninstall` 的 RPC。正式安装会牵涉 artifact、版本、签名、升级、数据保留与来源信任；当前开发目录注册不冒充完整安装语义。

## 6. 实施阶段

### Phase 1：Source 与 State Store

- 扫描 repository、dev-link、installed 三类来源；
- 校验 Manifest、目录 identity、entry containment 和重复 ID；
- 实现版本化 `state.json` 读取与原子写入。

### Phase 2：Manager 编排

- 汇总 source、Manifest、desired state 与 Host runtime summary；
- 实现 initialize、enable、disable、reload；
- 单插件失败隔离到 Diagnostic。

### Phase 3：Server 与 Kernel RPC 接入

- 删除 `example-echo` 硬编码启动路径；
- Manager 为 Host 提供实际事件 capability grant；
- Kernel RPC 委托 Manager；
- 发布 `extensions.changed`。

### Phase 4：最小验证

使用真实 Server Extension 验证：

- 新发现默认禁用；
- enable 后 RPC/Event capability 可用；
- reload 产生新 `instanceId`；
- 重启后 enabled/grant 保持；
- disable 释放 RPC/Event/Scope；
- 重复 ID 和越界 entry 不会执行；
- 单插件激活失败不阻止其他插件和 Server。

## 7. 明确安全边界

Server Extension 当前与宿主运行在同一个 Node.js 进程。Capability grant 只能约束 Host API，不能阻止插件直接调用 Node 文件系统、网络或进程能力。因此本阶段的 Server Extension 必须视为受信任本地代码。

不可信插件执行需要 Worker 或独立进程隔离，是后续独立阶段，不能由 Manifest 权限声明替代。

## 8. 实施结果

Phase 1–4 已于 2026-08-14 完成：

- Studio Server 已删除单个 `example-echo` 硬编码加载；
- 已实现 repository、dev-link、installed 三类 Source 发现；
- 已实现版本化 `state.json` 原子写入；
- 已实现 Manager initialize、list、enable、disable、reload；
- Kernel 已接入五个 Extension 管理 RPC 与 `extensions.changed`；
- Host 加载边界已增加 Server entry containment 校验；
- enable/disable/reload 已串行，避免配置写入与实例生命周期交错。

验证结果：

- Server Extension Manager 真实闭环 15 项通过；
- 原有 Server Extension Host / Event 真实插件验证 51 项通过；
- Kernel、Extension Host、Studio Server 相关 5 个测试文件、26 项测试通过；
- 定向 TypeScript build 只剩既有 Loom Runner `hint` severity 类型冲突。
