# Extension Data 与 Portable Payload

本文记录 Extension 的持久数据基础设施。它覆盖 Package-owned 持久数据、Timeline / Agent Session Scope、实体引用、Card Portable Payload、Changeset 与生命周期；Client Renderer 只通过受控 API 消费这里的数据，Renderer Surface 合同见 [`../../extensions/client-renderer-host.md`](../../extensions/client-renderer-host.md)。本文仍不定义 Narrative Attachment。

## 1. 稳定边界

Extension 运行时持久化提供四种 Scope：

```ts
type ExtensionStorageScope =
  | { kind: 'global' }
  | { kind: 'card'; cardId: string }
  | { kind: 'timeline'; timelineId: string }
  | { kind: 'agent-session'; agentSessionId: string }
```

Card 既是可移植内容的分发 Carrier，也可作为作者默认配置的持久 Scope；普通私有配置的复制由 Extension 决定，扩展采用与 State 初始化则由平台统一管理，见 [Timeline 扩展采用](timeline-participation.md)。Narrative Node、Agent Message、Asset 和 State Path 是 Record 的绑定目标，不是独立存储桶。State 继续承载跨 Prompt、UI、脚本和回滚共享的角色或世界语义；Extension 私有配置与记录不写入 State。

Secret 不得进入 Extension Config、Record、Portable Payload 或 Card Bundle。这是数据合同与作者责任边界：Core 不尝试从任意字符串中猜测 API Key；SDK 不提供把 Secret Store 内容直接导出为上述数据的能力。

## 2. Server Extension API

Server Module 通过 `ExtensionActivationContext` 获得两类 Application typed capability。

### 2.1 Scoped Storage

```text
ctx.storage.configs.list/get/upsert/delete
ctx.storage.records.list/get/create/update/delete
```

Config 使用当前 Package、安装 Target、Scope 与稳定 key 形成唯一地址。省略 Target 的底层 API 仍表示全局安装；Host 设置表单必须显式传入安装 Target，不能用 card storage scope 替代安装身份。更新存活记录需要 `expectedVersion`。Record 使用独立 ID，可保存 `recordType`、JSON data 和以下 typed bindings：

```ts
type ExtensionEntityRef =
  | { kind: 'narrative-node'; timelineId: string; nodeId: string }
  | { kind: 'agent-message'; agentSessionId: string; messageId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'state-path'; timelineId: string; path: string }
```

Record list 可以按 Scope、Record Type 和 Binding 查询。Host 强制 Package owner，拒绝跨 Package get/update/delete。Studio Server 在写入前验证 Timeline、Agent Session、Node、Message 与 Asset 的真实存在及归属关系；State Path 验证所属 Timeline 与非空路径，但不要求目标字段已经存在，以保留插件声明未来状态字段的能力。

Config 与 Record 分别保存为 `airp.extensionConfig` 和 `airp.extensionRecord` Document。它们使用 Document Revision、Tombstone 与 Changeset，不另建 Extension 数据库或通用 Graph Store。首版按 Package/Document Type 分页读取，再在内存中过滤 Scope、Record Type 与 Binding；出现实际规模压力后再增加窄索引。

声明 Timeline 参与的包访问故事 Scope/Binding 必须位于对应 `ctx.timeline.run`，列表必须提供 Scope；
同一 Data Engine 的受管写入在实际事务内复核原始采用代次。全局配置的非故事编辑不受某条 Timeline 暂停影响。

Studio Client Host 通过 `application.listExtensionConfigs/getExtensionConfig/upsertExtensionConfig` 管理声明式设置，Client Extension 则只获得自动绑定当前 Package 的 `ctx.configs.list/get/upsert/subscribe`。Client 更新同样要求现有 Document Version；`subscribe` 由已提交的 `extensions.data.changed` 触发重新读取并比较版本，不接收 Host 表单 draft。

角色安装的 Config 只允许本角色 scope，或由真实 `Timeline.createdFrom.cardId` 证明属于该角色的 Timeline / Session scope；禁止 global scope 和其他角色的 scope。全局安装可以在现有实体 scope 中使用自己的命名空间，同包全局/角色安装的值与版本互不替代。角色设置控件的 card scope 按安装目标绑定；Timeline / Session 归属不明时不可提交，后端仍进行权威校验。

Host 字段保留本地草稿及首次编辑的版本基线；失败后暂停自动提交，不能因重读到新版就静默覆盖服务端。用户可明确采用服务端值，或在已读取的最新基线上重新应用当前草稿；读取失败保留草稿并提供重读入口，不能盲写。最新记录不存在时允许明确采用默认值或重新创建；这沿用现有 absence / tombstone 写入合同，不增加 create-if-absent 保证。API、Package、安装 Target 或有效 scope 身份切换会重建字段，旧异步结果不进入新身份；成功只确认已提交快照，不清除等待期间继续编辑的草稿。

### 2.2 Portable Payload

```text
ctx.portablePayloads.publish
ctx.portablePayloads.listOwn
ctx.portablePayloads.readOwn
ctx.portablePayloads.updateOwn
ctx.portablePayloads.deleteOwn
ctx.portablePayloads.replaceOwnCardBindings
```

Host 始终使用当前 `packageId`，Extension 不能伪造 owner、读取其他 Package Payload 或选择 Bundle 物理路径。Card Binding 更新只替换当前 Package 的绑定，并保留同一 Card 上其他 Package 的 Payload。

当前 Payload 只支持 UTF-8 JSON / text：单个 1 MiB、每 Card 64 个、合计 8 MiB。Canonical 数据保存为 `airp.portableExtensionPayload` Document；Card 保存本地 Document ID。导出时恢复 Artifact Payload ID，并由 ZIP Writer 写入 Core 生成的 `extensions/<packageId>/<payloadId>/<fileName>` Entry。未安装 Extension 时，Payload 保持 Opaque 并可再次导出。

## 3. Changeset 与生命周期

- Config、Record、Binding 和 Portable Payload mutation 都进入 canonical Changeset；
- Extension actor 会写入 Data / Document commit provenance；
- Config / Record 的更新可以通过 Document Changeset revert；
- Extension disable / reload 不删除 Package 数据，重新激活后可通过持久查询对账；
- 删除 Narrative Timeline 时，同一 Data Engine transaction 会 tombstone 该 Timeline Scope 的 Config / Record，并同时 tombstone Timeline State Scope；
- 删除 Card 时，同一 transaction 会 tombstone Card Scope Config / Record 与 Card-owned Text Transform Rule；默认保留已创建 Timeline，显式选择删除游玩数据时再级联 Timeline、Timeline State、Timeline Runtime Context 与 Timeline Scope Config / Record；
- 删除 Agent Session 时，同一 transaction 会 tombstone 该 Session Scope 的 Config / Record；
- Global 和其他 Scope 不受上述删除影响；
- Node / Message Event 只负责触发处理，持久 Binding 才是可恢复事实；
- Data commit 会经 `extensions.data.changed` 通知 Client Renderer 使 Projection 失效，但 SSE 不是持久事实或增量数据载荷；
- Card 删除提交后会广播 `entity.lifecycle.changed`；Event 只用于扩展对账，不参与删除事务的正确性；
- 删除或回滚 Record 只改变 Asset 引用，未引用 Asset / Blob 的回收留给独立 GC。

Document Store 的 SQLite transaction participant 允许在组合事务中显式接受空 Document 变更，以便“删除无 Extension 数据的 Timeline / Session”仍保持单一业务事务，而不制造占位 Document。

## 4. Card 导入与导出

```text
Extension publishes Payload
  -> author binds Payload to Card
  -> Core exports generic metadata and UTF-8 content
  -> Core imports as opaque canonical Document
  -> installed Extension discovers and applies it explicitly
```

导入阶段不执行插件代码。Core 只校验通用 metadata、路径 token、版本与大小预算；Extension 负责私有 Schema、迁移和应用目标。Payload 应用到 Global、Timeline、Agent Session、State 或 Asset 时，必须再走相应受控写入路径。

## 5. 当前未实现

- 任意二进制 Portable Payload 与 Payload Asset closure；
- Pending Payload 的作者 UI、授权、迁移和失败重试界面；
- Node Extension Storage Scope；
- Branch lineage 驱动的 Renderer 可见性；
- Narrative Attachment 与 Asset / placement 的正式关系模型；
- Host Appearance / Style Contribution 与第三方网络权限；
- Derived memory、embedding、Job queue 与 Asset GC。

这些内容不得被当前文档描述为已实现能力。当前 Renderer 可以读取 Package Record、State 与 History，并把 Node-bound Record 投影为瞬时 Render Mount，但不会把 DisplayPart 或 Renderer DOM 持久化为数据。

## 6. 实现位置

- [`packages/extension-sdk/src/index.ts`](../../../../packages/extension-sdk/src/index.ts)
- [`packages/extension-sdk/extension-host/src/index.ts`](../../../../packages/extension-sdk/extension-host/src/index.ts)
- [`packages/application-runtime/src/runtime/extensions-runtime.ts`](../../../../packages/application-runtime/src/runtime/extensions-runtime.ts)
- [`packages/application-runtime/src/cards/card-bundle.ts`](../../../../packages/application-runtime/src/cards/card-bundle.ts)
- [`apps/studio-server/src/main.ts`](../../../../apps/studio-server/src/main.ts)
- [`apps/studio-server/src/codecs/card-bundle-zip.ts`](../../../../apps/studio-server/src/codecs/card-bundle-zip.ts)
