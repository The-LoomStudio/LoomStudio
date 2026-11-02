# Extension Architecture

Loom Studio 当前采用 **Package / Module / Instance** 三层 Extension 模型。Package 是分发、来源与持久资源归属边界；Module 是入口、runtime、启用状态、权限与贡献合同边界；Instance 是一次实际激活及其临时注册资源的生命周期边界。

Extension Package 允许零 Module，仅携带声明式资源。静态贡献声明不是已导入资源、已授予能力或实际激活实例的证明；资源型 Extension 不要求空脚本或虚构运行实例。

当前已实现 Server Module Host、Package Catalog、Client Module Host、Renderer Surface、Manifest Command / Action Placement 与 Extension Catalog / Data SSE。Client Module 可以被发现、保存 desired state、从同源受控 URL 加载，并通过正式 Context 注册 Renderer Contribution 与 Command Handler。通用跨端 Event Transport 与不可信代码沙箱尚未实现。

本文对应当前实现与可执行验证：

- [`packages/extension-sdk/src/index.ts`](../../../packages/extension-sdk/src/index.ts)
- [`packages/extension-sdk/extension-host/src/index.ts`](../../../packages/extension-sdk/extension-host/src/index.ts)
- [`apps/studio-server/src/extensions/`](../../../apps/studio-server/src/extensions/)
- [`apps/studio-client/src/features/extension-renderers/`](../../../apps/studio-client/src/features/extension-renderers/)
- [`scripts/dev/verify-server-extension.ts`](../../../scripts/dev/verify-server-extension.ts)
- [`tests/integration/studio-server/extension-install.test.ts`](../../../tests/integration/studio-server/extension-install.test.ts)

Client Renderer Host、Surface 与 UI 生命周期见 [`client-renderer-host.md`](client-renderer-host.md)。单文件 Script 的 Metadata、Mount、版本采用、后台执行与 Sandbox 合同见 [`loom-script-runtime.md`](loom-script-runtime.md)。

## 1. 三层身份

```text
Extension Package
  packageId：安装、版本、来源、资源 provenance 与共享持久数据边界

  -> Extension Module
       packageId + moduleId：runtime、entry、enabled、grant 与 contribution 边界

       -> Extension Instance
            instanceId：一次激活及其 Scope、RPC、Event、Logger、Diagnostic 边界
```

一个 Package 可以包含零个或多个 `server` / `client` / `client-worker` Module。没有 Module 的纯资源 Package 合法；一个 Package 也可以同时携带声明式资源和可执行 Module。这些值表示 Module runtime，不表示“同一个插件的两半”。`client-worker` 使用 Dedicated module Worker 与宿主能力桥，不接受 DOM 或 Server Contribution；线程隔离不等于权限沙箱，生命周期和能力差异见 [Worker 合同](loom-script-runtime.md#原生-worker-后台入口)。

Module ID 只需在 Package 内唯一。内部使用结构化 `packageId`、`moduleId`；日志和 Registry owner 可显示为 `<packageId>/<moduleId>`，公开 RPC/Event 名称仍使用 Package namespace。

Package 内的 Module 不继承 sibling grant。当前 Server Module 与宿主同进程运行，因此这种边界是 Host capability、审计和产品授权边界，不是强安全沙箱。

Card Package 可携带 Extension Package 实际归档。安装身份由 `packageId` 与 Global/Card target 确定，各安装的启用状态和能力授权独立保存；Card 私有包文件使用归档摘要校验的 URL。该身份隔离约束正式 Host API，不是对任意同进程代码的安全隔离保证。

## 2. Package Catalog 与 Server Manager

Server Extension Manager 负责：

- 默认从 `<installationRoot>/official/extensions/*` 发现官方包，从 `<installationRoot>/extensions/<packageId>` 发现安装包；安装目录按 Package ID 平铺，不含版本子目录。开发链接默认读取 `<dataRoot>/config/extensions-dev-links.json`，模块状态保存在 `<dataRoot>/config/extensions-state.json`，与包代码目录分开；Server 配置可覆盖发现目录、安装根和状态目录。测试扩展位于 `tests/fixtures/extensions/*`，仅通过显式开发配置加载；
- 按 `packageId` 建立 Catalog 并处理来源冲突；
- 校验 Manifest v2、Module ID、runtime 与 entry 路径边界；
- 发现 Client-only 和纯资源 Package，但只编排 Server Module；
- 按 `packageId + moduleId` 持久化 enabled、事件与 Asset capability grant；
- 从本地目录或 ZIP 安装 Package，并提供公开 HTTPS Git / ZIP 来源的安装预览，递归检查依赖版本、来源与循环，确认后安装；卸载 installed 时删除复制目录，卸载 dev-link 时只移除链接，默认保留已导入资源与 Package-owned 数据；显式 `deleteData` 的全局数据清理范围见[本地存储边界](../data/local-storage-and-assets.md#5-extension-文件边界)；
- 串行执行 Module enable、disable 与 reload；
- 汇总 Package 来源、资源、Module desired state 与真实 Server runtime。

新 Module 默认禁用。同一 `packageId` 来自多个目录时，整个 Package 标记 unavailable，不选择隐式赢家。一个 Server Module 的激活失败不会阻止 sibling 或 Studio Server 启动。

`client` 与 `client-worker` Module 由 Studio Client 根据 Catalog 与 desired state 独立编排。Server Manager 不伪造 Client Instance；Client Host 在 enabled、disabled、reloaded、版本或 Entry 变化后 reconcile 当前 Module，并负责 abort、dispose 与重新加载。

### 生命周期与异常恢复保证

- **卸载容错与重试（Uninstallation Resilience）**：Server 卸载扩展时，先持久化将其标记为禁用，再尽力 `dispose()` 所有关联模块。若过程中发生异常，保留包来源记录、授权声明与 Catalog 状态，明确未完成状态并通过平台诊断暴露，允许调用方重试卸载或重建恢复，绝不损坏全局状态一致性。
- **状态订阅安全（State Subscription Safety）**：`packages/extension-sdk/extension-host` 保证预先已处于 Abort 状态的 Signal 绝不会创建有效订阅；正常取消订阅与重复调用 `dispose()` 完全幂等。
- **客户端实例隔离与清理**：Client Extension Host 在模块卸载或清理发生异常时，严格隔离故障，绝不影响其他正常注册的扩展；失效实例立即失去资源访问权，且旧 Catalog 异步回调绝不会复活已卸载的实例。

## 用户发起的原生数据批量导入

Client Extension 在用户确认迁移后调用 `context.imports.commit(sessionId)`。Client Host 固定当前 Package 与安装目标，转交 `extensions.importConvertedBatch`；Server Host 通过已有安装隔离的 RPC 通路调用该包的 `<packageId>.migration.prepare({ sessionId, index })`。Server Extension 的 `ctx.rpc` 仍不可调用 `application.*`。

`prepare` 按索引返回一个原生条目，结束返回 `null`。条目使用同批唯一的 `key`：

- `prompt-resource`：`artifact` 为 Loom Prompt Resource Artifact；
- `card`：`artifact` 为 Loom CardBundleArtifact，可带 PNG 的 `avatarBase64`，以及引用前序资源的 `promptResourceKeys`；
- `history`：`cardKey` 引用前序 Card，携带 `title` 与 `messages: [{ content, createdAt? }]`；
- `skipped`：携带可展示给用户的 `reason`。

宿主只校验原生 Artifact 并调用现有 Runtime、Asset 与目录保存能力，不解析外部格式。每项成功写入立即生效；批次不伪装成跨资源原子事务。结果包含已导入项数和跳过原因；中途失败明确报告已有写入，不自动重试。结束时调用同包 `migration.cancel` 消耗 staging session，避免同一失败批次重复提交；重新扫描仍是新批次，不能当作全局幂等导入。

## 3. Manifest v2

```json
{
  "manifestVersion": 2,
  "id": "author.example",
  "version": "1.0.0",
  "displayName": "Example Package",
  "description": "Example package description.",
  "icon": "./icon.png",
  "author": "Example Author",
  "homepage": "https://example.com/author.example",
  "repository": "https://github.com/example/author.example",
  "tags": ["prompt", "developer-tool"],
  "engines": { "studio": "^0.1.0" },
  "modules": [
    {
      "id": "server",
      "runtime": "server",
      "entry": "./dist/server.js",
      "capabilities": {
        "events.subscribe": ["documents"],
        "assets.publish": true,
        "assets.read": true
      },
      "contributes": {
        "rpc": [{ "name": "author.example.status" }],
        "agentToolHandlers": [
          { "toolId": "author.example/lookup" }
        ]
      }
    },
    {
      "id": "panel",
      "runtime": "client",
      "entry": "./dist/panel.js",
      "contributes": {
        "renderers": [
          {
            "id": "workspace",
            "name": "Example Workspace",
            "surface": "shell.workspace-panel",
            "instanceScope": "workspace"
          }
        ]
      }
    }
  ],
  "contributes": {
    "transformRules": [
      { "source": "./resources/clean-output.rule.json" }
    ],
    "promptResources": [
      {
        "id": "assistant-preset",
        "resourceKind": "preset",
        "source": "./resources/assistant-preset.json",
        "toolMounts": [
          { "toolId": "author.example/lookup", "defaultEnabled": false }
        ]
      }
    ],
    "agentTools": [
      { "id": "author.example/lookup", "source": "./resources/lookup.tool.json" }
    ]
  }
}
```

顶层 `contributes` 是 Package 携带的声明式资源索引；`modules[*].contributes` 是对应 Module 的 runtime contribution contract。capability request 必须属于具体 Module。

Manifest declaration 是静态合同，Runtime registration 是当前事实。开发/测试模式下，未声明的 RPC/Event 产生 warning 并使实例 degraded；生产模式拒绝未声明注册。声明但未注册也会产生 Diagnostic。

全局包替换不是文件、状态和 Host 的跨系统原子事务。停用旧模块前，Manager 在 `.history` 保存本次 `*.recovery.json`，记录原模块 desired/grants、版本及旧包位置。新代码与 catalog 提交后，先保存规范历史，再恢复未变更 runtime/capabilities 的模块状态；能力变化维持禁用并走既有启用授权入口，不自动扩大授权。

代码提交后的失败同时返回 `installed` 与 `failed`，后者包含 `stage`、`codeCommitted` 和 `recovery` 路径。正常完成删除本次恢复记录；失败保留记录，不在启动时自动重放。恢复时先处理文件系统/状态存储故障并核对当前包版本，再按记录通过已有 enable/disable 接口恢复仍适用的授权和启用选择。若 `save-history` 失败，旧包仍在记录中的随机 `backupDirectory`，应先恢复到 `historyDirectory`；Git 包随后可走既有 rollback 预览，ZIP 包用旧包重新显式预览安装。修复并确认后才移除遗留恢复记录，不能盲目整份覆盖现有 State 文件。

### 3.1 Package Prompt Resource 与 Agent Tool

Preset 工具挂载现支持宿主、本包、依赖扩展三类可移植引用；旧 toolId 保留本包语义。声明、解析、依赖与授权边界见 [Tool System](../application/agent/tool-system.md#扩展预设中的可移植工具引用)。

`contributes.promptResources` 和 `contributes.agentTools` 声明 Package 携带的静态资源。全局 Git / ZIP / 目录安装完成后，若该包尚无全局资源 installation，宿主自动调用现有资源导入链；仅预览下载、目录发现或启用代码模块不导入。自动导入不会为用户已有 Preset 采用 Lore 或启用工具，也不代表模块已获授权。

已有资源 installation 在代码更新、回退或重装时保留，不自动覆盖用户编辑；资源替换仍需显式更新。历史安装、开发目录或自动导入失败时，可通过 `extensions.importPackageResources` / “导入资源”补入。文件安装与数据库导入不是跨系统原子事务：导入失败会明确报告包文件已安装，保留包以便修复并重试；批量远程安装同时返回已安装项与失败原因。导入后：

- Prompt Resource 进入现有 Prompt Resource Store，保留 `packageId + version + contributionId` provenance；
- Preset 声明的 Lore Mount 与 Tool Mount 进入现有 Mount 表；
- Preset contribution 的 `textUses` 进入 Preset metadata；包内 Lore / Rule / Extractor contribution 引用映射为安装内本地 ID，外部引用保留身份与 provenance，不复制目标或按名称替代；
- Agent Tool Definition 保存为可编辑的 `airp.agentTool` Document，并进入现有 Tool Prompt Build；
- 普通重复导入同一 Package 版本保持幂等，不覆盖用户编辑；显式更新通过当前 installation 版本校验，可替换包贡献及移除旧贡献，不是普通导入的静默覆盖；
- Package 文件卸载不自动删除已实例化资源；`extensions.removePackageResources` 可按 provenance 显式移除该 Package 的 Prompt Resource、Tool Definition 与关联 Mount；
- 资源移除保留外部 Card、Timeline、Session 与其他预设的引用，只清理被删资源自身拥有的挂载；缺失必要资源时执行明确失败。Agent Preset 直接承载配置，不再存在 Profile Tool Override 或阻止删除的 Profile 引用。
- 资源移除使用墓碑，不删除 Package 源文件。来源仍声明该贡献时，显式重新导入可恢复原资源 ID 和预设声明的挂载；不把重复导入当成重新授权或自动启用模块。来源文件被删不触发数据库自动清理，普通重启也不新增隐式恢复流程。

官方 starter 的显式安装采用同样的可恢复资源原则：恢复墓碑资源的原 ID，补回缺失工具挂载且默认不启用工具；同版本、同内容来源不覆盖本地编辑。既有活跃预设的 Lore 挂载选择保持不变，恢复被删除的预设时重建其来源声明的 Lore 挂载。来源版本或内容变化仍走既有资源更新语义。

Tool Definition 与执行器分离。Server Module 在 `modules[*].contributes.agentToolHandlers` 声明 Handler，并通过 `ctx.agentTools.register(toolId, handler)` 注册执行逻辑。Module disable/reload 会释放旧 Handler，但不会删除 Definition 或 Preset Mount；Handler 缺失时 Agent Tool Loop 返回明确的未注册执行器错误。

Handler 的第二参数包含 `signal`、宿主生成的 `invocationId`，以及可选的只读 `narrativeTarget: { scope: 'timeline', timelineId, branchId }`。后者仅在当前 Tool Execution Scope 的默认 State target 为已授权 Timeline 目标时提供，不从模型参数或全局当前聊天推导。需要 Narrative 的工具必须自行拒绝未绑定调用；通用工具可以不使用该字段。Host 保留调用身份与目标，并将调用取消信号和实例生命周期信号合并。State 权限仍由安装范围与 State API 检查，提供 target 不绕过权限。

预设是能力与消费配置，不是第三种包或独立代码实例。扩展可无 Module，仅分发资源；也可由同一模块编排多个预设。引用不改变归属，单独导出预设不递归携带资源内容，切换 Session 不停用扩展。Lore、正则默认参与与显式采用的差异见[资源归属与使用配置](../application/prompt-build/README.md#资源归属与使用配置)。

Package 展示元数据保持为一组轻量可选字段：`description`、`icon`、`author`、`homepage`、`repository` 与 `tags`。`tags` 只用于搜索、分类和展示，不参与权限、加载顺序或 capability 判定；旧 `roles` 字段不再接受。`homepage` / `repository` 必须是 HTTP(S) 绝对 URL，`icon` 必须是 Package 内的 PNG、JPEG、WebP 或 GIF 相对路径。

预设展示图标使用可选 `metadata.icon = { kind: 'package', packageId, path, target? }`，与来源 provenance 分开。资源存储映射及包资源安装保留该字段；Card 安装补充当前 target。Client 复用已发现 Package 的版本与受控文件 URL 解析图标，不为每个视图追加查询。复制预设保留包引用，不复制图标字节；Package 不可用时显示既有备用图标。实现见 [`prompt-resource-contracts.ts`](../../../packages/shared/src/prompt-resource-contracts.ts)、[`prompt-resource-mapper.ts`](../../../packages/application-runtime/src/prompt/prompt-resource-mapper.ts)与 [`extension-icon.tsx`](../../../apps/studio-client/src/shared/ui/extension-icon/extension-icon.tsx)。

## 4. Server Module Host 与 Scope

每个 Server Module 独立 discover、load、activate、reload、dispose 与 forget，当前最多一个活动实例。重复 activation 被拒绝；reload 先释放旧实例，再加载并激活新实例，生成新的 `instanceId`；forget 在释放实例后移除 Host discovery record，供 Package 卸载后安全重发现同 ID Module。

Server Module 通过 `activate(ctx)` 获得当前实例绑定的 capability facade：

`ctx.prompt.build` 是只读的独立 Prompt 编译入口，可传本安装拥有的 Preset/Lore 引用或逐次 Anchor 内容；`ctx.ai.invokeModel` 在 `ai.invoke` 权限下以显式 Provider Profile/Model 引用调用普通模型，支持真实流事件与实例取消。两者不要求 Agent Session，不改变全局 Lore Mount；原有 `ctx.ai.invoke` capability-profile 路径保持不变。无独立 Prompt Resource 读取授权时，不可通过 build 按 ID 读取其他来源资源。

- `ctx.extension.packageId/moduleId/runtime/instanceId`；
- scoped Logger 和 Diagnostics；
- 当前 Module 的事件 grant snapshot；
- 当前 Module 的 Asset grant snapshot；
- RPC register/call；
- Event define/emit/subscribe；
- Package-owned Document get/list/write/delete；
- Application-owned Scoped Config / Record typed storage；
- Package-owned Card Portable Payload publish/read/update/delete/binding；
- Agent Tool Handler register；
- Media Asset publish/read 与 Instance scratch materialize；
- `AbortSignal` 与 dispose callback。

Host 不暴露 Kernel、SQL connection 或内部 Registry，也不保存插件业务状态。

Client Module 通过 `activate(ctx)` 获得 Renderer 注册与打开、Manifest Command Handler 注册、Package-owned Record 读取、Config 读写与订阅、Style 工厂注册、State / History 读取、Package namespace RPC、Asset / Package File URL、Logger、Identity 与 `AbortSignal`。Action Placement 由 Manifest 静态声明并由 Host 投影；Client Host 同样不暴露 Kernel、SQL、Application Store 或全局 Registry。完整合同见 [`client-renderer-host.md`](client-renderer-host.md)。

`ctx.rpc.call()` 只用于调用 Extension RPC。它拒绝 `system.*`、`docs.*`、`extensions.*`、`application.*` 等 Studio 保留 namespace，插件不能借通用 RPC 绕过 Host capability。Application 领域能力通过明确的 typed capability 开放；当前包括 Scoped Storage 与 Portable Payload，不把全部 Studio RPC 默认交给插件。

Server RPC 默认在当前安装目标内解析：`ctx.rpc.call(method, params)` 不会在角色安装缺失方法时自动回退全局。同名方法可以分别注册在全局与不同 Card；调用已启用的全局扩展服务使用 `ctx.rpc.call(method, params, { scope: 'global' })`。模块不能通过此选项指定另一 Card。安装目标来自 Host，不从业务 params 推断；无目标的普通 Kernel 调用和公开 introspect 仍只访问全局方法。

Card 包的安装、更新、卸载及模块启用已通过管理 API 与扩展工作台公开。安装不自动启用代码，安装范围与授权分别管理；安装级 RPC 路由和工具执行器 ID 映射也已接入 Host。具体能力仍按各自目标与归属合同校验，不能将这些能力边界描述为任意角色代码的强安全隔离。

实例 Scope 的清理顺序是：停止接收新调用并 abort、等待已进入 callback、按注册反序执行 disposer、汇总清理错误。旧实例 handle 只能删除自己注册的资源，因此 reload 一个 Module 不会误删 sibling 或新实例的 RPC/Event。

## 5. 归属与公开能力

| 对象 | 当前归属 |
|---|---|
| Package source、version、声明式资源 | `packageId` |
| Module desired state、grant、runtime contribution | `packageId + moduleId` |
| RPC/Event 注册、订阅、Logger、Diagnostic | `packageId + moduleId + instanceId` |
| Extension-owned Document | Package 级；现有字段名仍为 `ownerExtensionId` |

公开 RPC/Event 继续使用 `<packageId>.*` namespace，不强制重复 Module ID。Kernel Registry 与 `system.introspect` 记录实际 owner 为 `extension:<packageId>/<moduleId>`；同包 Module 注册同名能力时按普通冲突拒绝。

Extension Event 的 definition、publisher 与 subscriber 都携带 Package、Module、Instance identity。Module 自己的 protected event 使用 `extension:<packageId>` capability；跨 Module 协作应走 Host RPC/Event，而不是获取 sibling 实例对象。

Server 自定义事件还携带 Host 提供的安装目标：同名定义按 Global/Card 分开注册，发布与扩展订阅只在相同安装目标内匹配，权限检查不因目标隔离而省略。Card 自定义事件的 `meta.installationId` 标识来源；平台观察者仍可跨安装观察。此处不代表平台事件已按 Card 完整过滤，平台事件需要由其具体事实来源解析目标，相关迁移仍在进行。

Server Card 安装的 State read/write 只允许所属 Card 的现存 Timeline，不允许 Global State、其他 Card 或未知 Timeline；归属由 Server 查询 Narrative Store，不能从调用参数声明中采信。`ctx.state.subscribe` 和通用 `ctx.events.subscribe(['state.changed'])` 共用同一检查，模块或订阅已停止时不交付迟到的归属查询结果。State 读写请求在异步校验前复制，事件订阅者各自获得副本。全局安装保留已有的 State 能力范围，Manifest/Grant 检查仍适用。

State 贡献与 Macro Provider 使用安装级本地 ID，作者声明的 ID 仍保留。角色选择私有 State 贡献后，创建 Timeline 必须验证所属 Card；移除贡献不重置已有实际 State。私有 Macro Provider 只在所属 Card 上下文参与解析，其 `context.global` 为空对象，不能借 Provider 上下文绕过 Global State 访问限制；全局 Provider 的上下文不变。显式选择的宏来源失效时报告错误，不替换为同名全局来源。

Event 只广播已经发生的事实，不提供返回值，也不改变发布者业务结果。完整数据通过 ID 和 typed RPC 查询，不通过 event payload 广播正文、Prompt 或 Secret。

### 5.1 Document 权限门

Server Module 的 `ctx.documents` 当前执行以下默认拒绝规则：

- Module 只能创建、读取、列举、修改和删除自己 Manifest `contributes.documentTypes` 声明的类型；
- Document type 必须位于 `<packageId>.*` namespace；
- 创建时 Host 强制写入 Package owner 和 Extension actor；插件提供的 owner/actor metadata 不进入 SDK contract；
- `get/write/delete` 会检查现有 Document 的 `ownerExtensionId`，不能读取、夺取或删除官方及其他 Package 的 Document；
- `list` 必须提供已声明 type，Host 强制附加当前 Package owner filter，调用方不能伪造 owner；
- Package 内 sibling Module 如需共享同一 Document type，必须分别声明该 type。

当前没有 `documents.read:any`、跨 Package grant 或可信插件豁免。出现明确用例后应增加窄 capability，而不是开放通用 Store。Application-owned Config / Record 不要求插件声明 Core Document Type，而由 `ctx.storage` 强制 Package owner、Scope、optimistic version 和 typed binding；完整协议见 [`../application/extension/data-and-portable-payload.md`](../application/extension/data-and-portable-payload.md)。

### 5.2 Media Asset 权限门

`ctx.assets.publish` 需要 Module Manifest 请求并由用户授予 `assets.publish`。Host 强制写入当前 Package owner，插件不能伪造。Package 可直接读取自己的 Asset；读取其他 Package 或用户 Asset 需要 `assets.read`。Host 不暴露 Blob root、全局 Asset list 或任意文件系统目录。

`ctx.assets.materialize` 复用相同读取判定，只把字节写入 `cache/extensions/<package-id>/<instance-id>`。该路径用于需要实体文件的外部工具，属于 Instance scratch，reload / dispose 后删除；正式 Asset 仍由 Blob Store 持有。

## 6. 管理 RPC

Kernel 当前提供：

```text
extensions.listPackages
extensions.installPackage
extensions.installPackageZip
extensions.uninstallPackage
extensions.importPackageResources
extensions.removePackageResources
extensions.enableModule
extensions.disableModule
extensions.reloadModule
extensions.getDiagnostics
```

`installPackage` 当前接收本地 `sourceDirectory`，安全复制并原子安装到用户数据目录；不处理 Archive 或网络下载。`uninstallPackage` 接受 installed 或单一 dev-link 来源：installed 删除复制后的版本目录，dev-link 只从开发链接清单解绑而不删除源码。两者都会释放并 forget Module、清除该 Package 的 enabled/grant 状态；仓库内置 Package 不可卸载。定位字段使用独立 `packageId` 与 `moduleId`。

`extensions.listPackages` 是插件管理界面的初始快照入口。Package 项返回上述静态元数据、受控 `iconUrl`、不含绝对目录的 `sourceKinds`，以及 `available`、Module desired/runtime state 和声明式资源。图标通过 `GET /extensions/:packageId/:version/icon` 读取，浏览器不会获得 Package 的物理目录。

动态变化通过 `GET /extensions/events` 的 SSE 连接推送。`extensions.changed` 覆盖 installed、uninstalled、enabled、disabled 与 reloaded；事件只携带 `packageId`、可选 `moduleId/version` 和 action。客户端收到事件后重新调用 `extensions.listPackages` 获取权威快照，不把 SSE payload 当作完整状态或新的 CRUD 通道。Data commit 还会投影为 `extensions.data.changed`，用于使 Client Renderer Projection 失效重建。

Client Entry、iframe source 与 Package 静态资源通过 `GET /extensions/:packageId/:version/files/*` 的同源路由读取。Server 校验 Package、版本和路径边界，浏览器不获得物理目录。

## 7. 当前明确未实现

- 不可信 Client JavaScript 的强权限隔离；现有 Dedicated Worker 只提供线程隔离；
- 通用跨端 Event Transport 与 Client Event Subscription；
- 第三方网络权限合同；Client Config 读写与订阅已实现，主题 / 样式贡献见 [Extension 主题与样式增强](../ui/extension-themes.md)；
- Package 资源更新的逐字段差异合并与自定义迁移 UI；现有显式更新已支持 installation 版本校验和贡献替换；
- Client HMR；当前只提供显式 reload；
- Module dependency graph、加载顺序和通用 DI Container；
- Marketplace、签名与自动更新检测；目录 / ZIP / Git 安装和依赖版本、来源、循环检查已实现，不包含通用包管理器式版本求解；
- Hook Registry、durable Trigger / Job Queue；
- 不可信 Server 代码的 Worker/进程沙箱。

Server Module 当前仍是受信任本地 Node.js 代码。Host capability 不能阻止代码直接调用文件系统、网络或进程 API；强权限隔离还需要受限运行环境与明确的系统权限边界，创建 Worker 本身不能提供这项保证。

### 跨包图标与 Media Asset

预设图标使用 `{kind: "package", packageId, path, scope?}`。`path` 始终相对目标扩展包根目录；同包图标省略 scope 时跟随消费者安装，跨包图标必须显式选择 `global` 或 `card` 并在 manifest.dependencies 声明目标包及版本。card 只表示当前 Card，不允许指定另一个 Card。宿主安装解析后补入 target；作者目录导出只保留可移植 scope，不写入 Card ID。

作者构建离线检查引用格式、依赖声明与本包文件；不能声称已验证另一安装中的文件。在线导入和作者 Apply 使用统一包依赖解析器校验目标安装及版本，再通过 Server 读取目标版本文件验证存在与路径边界。纯图片包也建立 installation 身份。显式图标不存在时 UI 不回退到其他安装的图标；旧版无 scope/target 的全局引用仍可读。

`ctx.assets.read/materialize(assetId)` 是运行时 Media Asset API，不是包文件路径接口。跨包 owned asset 必须同时满足 assets.read 授权、manifest dependency 与版本、目标安装范围；全局扩展不能读取 Card 私有资产，Card 只能读取同 Card 或全局资产。同包同安装的自有历史资产保持既有访问方式，无 ownerPackageId 的用户资产仍按既有授权处理。声明依赖不等于授予资产读取权限。

其他扩展可读的 Media Asset 没有被复制到消费者包；assetId 仍是本机运行时身份，不能作为可移植包内资源路径分发。卸载不自动回收媒体字节，历史引用的清理仍由独立生命周期规则决定。已安装扩展中的工具与图标消费者会阻止破坏依赖的卸载和不兼容更新；兼容更新也检查被引用图标文件是否仍存在。直接删除用户资源维持既有显式操作语义。

个人预设不需要伪造扩展 manifest 来引用全局已安装包图标；已有精确 Card 图标复制保留安装 target。个人引用不会自动建立包依赖或复制图片，不阻止提供方卸载，卸载后图标可以不可用但不会回退到错误来源。作者新建 Card 引用仍需要明确的消费者安装上下文。

## 扩展提供角色目录

`contributes.characters` 是随包 Card Bundle 目录，条目为 `{id, name, description?, preview?, source}`；source 指向包内 ZIP，preview 可指向包内图片。宿主只在用户确认预检摘要后创建 Card；安装扩展和浏览目录均不会导入角色。角色归档复用原生 Card 编解码，不自动安装或启用归档内扩展。远程目录下载尚未接入。

扩展 `dependencies` 可显式声明 `target: "global" | "card"`。Card 指当前安装所属角色，禁止全局消费者引用 Card 安装；显式目标在资源导入、模块启用及恢复时检查。旧省略字段保留现有具体资源范围和模块启用规则，不增加隐式跨范围 fallback。安装、版本依赖不代表 RPC 权限或脚本依赖已打通。

Card 的全局依赖及默认预设引用见[文件化角色包](../application/card-bundle-files.md)。诺姆是首个随包角色示例；作者构建使用 `build-extension-authoring --character ID=DIRECTORY`，详细命令见官方扩展的 `NOM-ASSISTANT.md`。

### Client Renderer 的精确内联锚点

Client Renderer 可提供 `projectNodeWithAnchors(context)`，返回 `{mounts, matches}`；matches 的范围以 `context.displayText` 的字符偏移为准，mount 使用 `match-ref` 指向本次投影的 ID。同文案多次出现时分别分配 ID，避免 literal selector 歧义。该接口复用宿主现有的范围、挂载数和重叠检查；注册和生命周期仍归 Client Module 管理，不改变 HTML iframe 权限。`projectNode` 继续兼容。
