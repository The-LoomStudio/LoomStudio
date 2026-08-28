# Card 与 Extension Portable Payload 分发边界 v0

> **状态**：Implemented Foundation / Remaining UI and Binary Design
>
> **日期**：2026-08-27
>
> **目的**：定义角色卡如何携带插件作者提供的配置、初始数据和其他可移植内容，同时避免让 Core 理解插件私有 Schema、建立 Card 运行时存储 Scope，或在导入时执行第三方代码。
>
> **实施进度**：UTF-8 JSON / text Payload 的 Card import、canonical Document、opaque preservation、export、ZIP namespaced entry、CRUD、Card Binding 和 Extension Packaging Capability 已实施。Pending Apply UI、Payload Asset closure 与任意二进制仍待后续阶段。

## 1. 核心判断

Card 是分发 Carrier，不是 Extension 的可变运行时数据库。Loom Studio 负责运输、索引、完整性、安全边界、未知数据保留和 Card Binding；Extension 负责决定导出什么、使用什么格式、如何验证和迁移，以及导入后如何应用。

```text
Extension creates portable payload
  -> Card author explicitly binds payload
  -> Core exports bytes and generic metadata
  -> Core imports and preserves opaque payload
  -> installed Extension validates and applies it explicitly
```

这条能力不引入 `card` Extension Storage Scope。插件应用 Payload 后产生的配置、记录或 State 进入既有 Global、Timeline、Agent Session 或 State Store；已创建 Timeline 不自动追随 Card Payload 的后续变化。

## 2. 与 VS Code / Repository 配置的对应

VS Code 负责 Workspace、`.vscode/settings.json`、Extension Recommendation 和通用配置 UI；Extension 定义具体配置 Schema 与语义。npm、pnpm、ESLint 等工具则自行定义配置文件、校验、迁移和执行，Git 只负责运输文件。

Card Bundle 不像 Repository 一样天然拥有任意目录，因此 Loom Studio 仍需提供受控 Packaging API，但不应接管插件私有配置语义：

| Loom Studio Core | Extension |
|---|---|
| 分配命名空间与稳定 Payload ID | 选择可分发字段 |
| 接受 JSON、文本或二进制内容 | 定义格式和 Schema Version |
| 计算 hash、执行大小与路径限制 | 校验、迁移和解释内容 |
| 将 Payload 绑定进 Card Bundle | 提供“导出到 Card”操作和 UI |
| 缺少插件时保持 Opaque | 导入后决定应用到哪个正式 Scope |
| 重新导出时保留未识别内容 | 排除 Secret、隐私数据和无意义缓存 |

## 3. 最小数据形状

运行时 SQL / Blob Store 中可以保存一个轻量记录：

```ts
type PortableExtensionPayload = {
  id: string
  packageId: string
  format: string
  schemaVersion?: number
  mediaType: string
  blobId: string
  createdAt: string
}
```

`blobId` 只属于本地 canonical storage。导出 Artifact 使用 Bundle Entry、相对逻辑路径、hash、长度和 Media Type 描述内容，不把本机 `blobId` 写成跨安装引用。

Card 只保存或导出 Payload Binding：

```ts
type CardPortablePayloadBinding = {
  payloadId: string
  packageId: string
  requirement?: {
    versionRange?: string
  }
}
```

以上只是讨论形状，不锁定正式 Schema。Core 不需要区分 Payload 是插件配置、初始记录、模板、词表还是其他插件私有资源。

## 4. 导出流程

Core 不扫描或猜测某个 Extension 的全部数据，也不默认调用所有已安装 Extension。

推荐流程：

```text
Extension command / UI
  -> user selects distributable content
  -> Extension serializes and publishes Portable Payload
  -> Card author explicitly attaches Payload
  -> Card exporter collects bound Payloads and referenced portable Assets
  -> write generic Bundle index and bytes
```

Packaging API 至少需要提供：

- 发布 Extension 自己命名空间下的 JSON、文本或二进制 Payload；
- 读取和更新 Extension 自己创建的 Payload；
- 将 Payload 绑定到 Card，或由 Card 作者在通用 UI 中选择绑定；
- 声明 Payload 引用的可移植 Asset，使 Exporter 能计算闭包；
- 预览最终将被导出的 Extension、Media Type、大小和 Requirement。

插件不能提供任意 Bundle 物理路径。Core 决定实际 Entry Path，并拒绝路径穿越、重名、特殊文件、超限内容和无效 metadata。

## 5. 导入与应用流程

导入阶段不执行 Extension 代码：

```text
Core reads Bundle
  -> validate generic envelope, hash and budgets
  -> store Payload bytes as opaque canonical record
  -> restore Card Binding and Extension Requirement
  -> expose pending Payload to installed Extension
  -> Extension validates, migrates and explicitly applies
```

Extension 缺失、禁用或版本不兼容时，Payload 仍然保留，并可随 Card 再次导出。Event 只能通知“有新的 Payload 可处理”；持久化 Payload 查询才是恢复、补处理和重试的依据。

插件应用 Payload 时必须走已有受控写入路径：

- 配置写入 Extension-owned Config；
- 普通业务数据写入 Extension-owned Record；
- 角色或世界共享语义通过正式 State Template / State Mutation 进入 State；
- 媒体进入 Asset Store；
- 用户可见的 canonical mutation 产生 Changeset；
- 缓存、索引和临时 Job 状态不伪装成可撤销业务事实。

导入 Payload 不等于自动修改 Global 或 Timeline。应用目标、覆盖策略和迁移行为由 Extension 声明并向用户展示，Core 只提供受控 API、权限和 Changeset 边界。

## 6. 与变量、Asset 和 Secret 的边界

Portable Payload 不是变量的替代品：

- 会被 Prompt、多个脚本、UI 和分支回滚共同消费的角色语义，使用 Card State Template 初始化 Timeline State；
- 只被单一 Extension 消费的画师串、模型参数、词表和私有初始记录，使用 Portable Payload；
- 图片、音频和其他大型媒体使用 Asset / Blob，Payload 只携带或声明可移植引用；
- Provider API Key、Token、Cookie 和私有 Endpoint Credential 永远不进入 Card Bundle；
- 用户私有历史、全部生成记录、缓存和索引不得因为“当前由这张 Card 使用”就默认导出。

## 7. 生命周期与删除

Payload Binding、插件应用后的运行数据和媒体引用是不同事实：

- 删除 Card 上的 Payload Binding，只影响后续导出和初始化建议；
- 删除原始 Payload，不自动删除已经物化到 Timeline 的配置或记录；
- 撤销插件的“应用 Payload”操作，通过对应 canonical Changeset 恢复；
- 取消 Narrative Attachment 只移除展示关系，不直接删除可能共享的 Asset；
- 未引用 Blob / Asset 的清理由独立 GC 处理。

## 8. 非目标

第一阶段不建设：

- Card-owned Extension database；
- Core-owned 文生图、记忆或其他插件配置 Schema；
- 导入时自动执行第三方代码；
- 扫描 Extension 全部数据库并猜测导出闭包；
- 自动把 Payload 合并进 Global / Timeline；
- 通用配置脚本语言或万能 Resource Binding Graph。

## 9. 尚待决策

1. Payload 引用 Asset 时如何表达可移植闭包与去重；
2. Card 作者绑定、替换和移除 Payload 的最小 UI；
3. Extension Requirement 是否从 `packageId` 自动生成，以及版本不兼容时的提示；
4. Imported Pending Payload 的发现、预览、授权、应用和失败重试体验；
5. 原样再导出与 Extension 重新序列化之间的选择规则；
6. 任意 bytes 何时替代首版 UTF-8 JSON / text 限制。
