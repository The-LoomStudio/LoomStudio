# `@loom-studio/extension-sdk`

> **状态**：Active Package Guide / Current Source Is Authority

Extension SDK 定义 Extension 作者侧的 TypeScript 合同。它描述 Manifest v2、Package/Module/Instance identity、Activation Context 与 Capability facade；它不负责加载、授权或运行 Extension。

Package 可以没有 Module，仅携带声明式 Prompt Resource、工具定义或转换规则。静态贡献经宿主资源导入链才形成 Application 资源；全局安装会在尚无 installation 时调用该导入链，已有 installation 的资源替换仍需显式更新。声明本身不代表已安装、已授权、被某个预设采用或已激活。

Preset contribution 的 `loreMounts` / `textUses` 表达资源使用关系，支持包内 contribution 引用或外部引用；`toolMounts` 配置工具使用。它们不创建预设专属资源 Owner，也不会将外部引用内容自动打包。一个扩展可携带多个预设并共享定义，模块生命周期仍由 Host 管理，不跟随 Session 选择自动启停。

Server Module 可用授权的 `ctx.prompt.build` 构建本安装资源或逐次 Anchor 内容，也可用 `ctx.ai.invokeModel` 显式指定模型进行直接调用；两者不要求 Session，不选择默认预设或绕过安装资源/凭据边界。接口详情见[Provider 与 PromptBuild](../../docs/architecture/application/agent/provider-and-prompt-build.md#extension-直接构建与模型调用)。

Server Module 还可用 `ctx.prompt.registerProcessor` 注册作者正文的候选准备/有序渲染会话，
由资源 `capabilities.processorId` 显式采用；需 `prompt.process`，读取 Timeline 快照另需 `state.read`。
处理器不接管 Session/工具消息；新 Run 构建一次，后续工具 Step 和恢复不重跑已接受模板。

`ctx.state.contribute(contribution, { initialize })` 可在新 Timeline 创建前根据所选开场和关联世界书计算本 Contribution
的模板初值，不覆盖已有 Timeline。`ctx.state.registerContentHandler` 则处理完整无工具助手回复，需
`state.processContent`、`state.read`、`state.write`；声明 Contribution 和非根 JSON Pointer，
只返回数据和诊断，不获取 Store。平台负责采用过滤、取消、CAS、操作检查点和幂等提交。
这些都是可信扩展入口，不是直接执行不可信作者脚本的许可；语言扩展自行提供隔离运行环境。

## 公共入口

唯一入口是 [`src/index.ts`](./src/index.ts)。除 `defineServerExtension(module)`、安装身份与 Renderer 常量等纯 helper 外，也提供 iframe 作者侧连接代理；其余导出以类型合同为主：

- Manifest v2 与 Package/Module/Instance identity；
- RPC、Event、Document、Asset 与 AI Gateway capability；
- `StudioEvent` / `EventMeta` 事件 envelope（源码为 [`src/events.ts`](./src/events.ts)）；原 transport 包已撤去，事件授权、可见性与 wire shape 保持原合同；
- Config/Record Storage 和 Portable Payload；
- Server 的 `ExtensionActivationContext` / `ServerExtensionModule`；
- Client 的 `ClientExtensionActivationContext` / `ClientExtensionModule`；
- [`src/worker-context.ts`](./src/worker-context.ts) 的 `WorkerExtensionActivationContext` / `WorkerExtensionModule`。

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

## Timeline 采用

故事相关扩展在 Manifest 声明 `participation: "timeline"`。安装提供能力，不自动让每个故事采用它；
Card 默认配置只影响新 Timeline，已有故事由平台显式加入、暂停或恢复。同一 Timeline 的 Branch 共用采用关系，
State 仍按 Branch 修订。暂停、卸载不删除已保存的 State。

Studio 的 State“来源”页分别检查当前注册声明、Timeline 接受时的声明、采用资格与当前 Branch 的数据路径。
解除注册不会抹去接受时的声明；查询不调用 `initialize`。来源、版本和采用 metadata 由平台 Runtime Context
保存，不需要扩展在业务 Entity 中创建 metadata 组件。该诊断属于 Studio 查询，不是额外的 SDK 启用表。

旧 checkpoint 缺少已采用扩展的数据时不会自动重建。用户可在 Timeline 采用面板预览并确认
“补齐缺失 State”：平台核对原始声明及安装/采用版本，调用现有初始化器，只写缺失的实体或组件。
已有值、其他 Branch 及采用配置不变；不执行组件内部字段迁移。预览不运行初始化器，
确认期间暂停会取消工作并拒绝提交；恢复采用本身仍不会触发初始化。

Server 自行发起的故事工作使用 `ctx.timeline.run(target, async ({ signal }) => ...)`，
`target` 必须包含 `scope: "timeline"`、`timelineId`、`branchId`。`ctx.timeline.list()` 查询可参与目标，
不能用前台焦点代替后台任务目标。受管工作核对采用、安装版本和执行代次；暂停再恢复也不会复活旧任务。
状态读写、直接模型调用与 Prompt 构建使用这个执行范围，扩展应向自己的异步工作传递取消信号。

`ctx.timeline.subscribe(listener)` 通知可参与目标可能变化；订阅后用 `list()` 对账，回调自身不获得故事权限。
受管范围中的通用持久写入统一在 Data Engine 事务内复核原始凭据，覆盖 documents/storage/portable payload/assets；
结束或暂停后的派生异步任务也不能迟到提交。故事 storage/binding 必须匹配当前 Timeline，列表要求显式 Scope；
全局配置的普通编辑保持可用。原生文件或直接网络副作用不在事务保护内。

工具处理器由 Host 自动绑定可信目标。宏与 Narrative context provider 由宿主按采用关系过滤后，
再进入受管工作；宏上下文新增只读 `timelineTarget`，独立资源或 Card 编辑预览没有此目标，
不会执行 Timeline 宏来源。Narrative 的读取和 Session handoff 均保持实际 Timeline/Branch，
未采用来源不参与候选冲突判断。

State content 回调也按采用关系过滤并进入受管工作，接收只读目标。平台将实际产生修改的来源执行代次随
可恢复操作保存；最终 State 事务统一核对，暂停、重装或暂停后再启用都不能让旧结果重新获得提交资格。
恢复只重放已接受操作，不重跑处理器或模型。

Timeline Prompt processor 从工厂创建到 prepare/render 持有同一受管范围，每次回调前后核对原始凭据，
dispose 释放范围。暂停时拒绝迟到结果；创建失败仍清理已创建的会话。无目标或未采用时不能调用声明为
Timeline 的处理器，模块没有 `state.read` 时仍不会收到 State 快照。

Agent 检查点保存 Prompt 准备和工具间接消费的原始扩展凭据，后续 Step/恢复不重新授予旧 Prompt 新代次资格。
暂停来源的工具被过滤并记录诊断，挂载保留；其他 Card 的私有工具引用仍拒绝。扩展管理页“携带资源”
可查看 Lore、工具、文本规则与脚本的来源资格；资格不等于挂载或授权。

声明 Timeline 参与的 Client Module 只在当前故事已采用且安装/版本匹配时激活，
`ctx.timeline.target` 提供本实例固定的 Timeline/Branch。切换目标、暂停或执行代次变化时，
Host abort 并清理旧实例，再按新目标建立实例；不修改用户的全局模块开关。
`ctx.state.subscribe(target, handler, onError?)` 立即读取权威快照，并复用 SSE 按 revision 更新。
相同 revision 去重，切换后的迟到结果不投递；读失败后再次成功仍可投递相同 revision。
这不是全部历史修订的事件流。未声明 Timeline 参与的共享模块不会因故事切换而重建，目标为空。
扩展异步处理和直接 DOM/定时器必须使用 `ctx.signal` 并在取消或 dispose 时清理。

已接受 Prompt 的后续 Step / 恢复会继续复核原始扩展凭据；受管工作中的通用存储和资产写回已接入同一 Data Engine 的事务守卫，不能以暂停后的新代次重新授权旧结果。具体提交边界见[Timeline 扩展采用](../../docs/architecture/application/extension/timeline-participation.md)。
模块启停仍按 Module 管理；独立的 Package 全局总开关、跨声明迁移与签名系统尚未实现，不能以所有模块关闭推断整个资源包停用。
原生 Node.js 的定时器、网络和文件操作不是安全沙箱内的能力，平台取消不能强杀任意扩展代码。

## 开发与发行

独立扩展在主应用根目录 `extensions/` 安装或就地开发；官方身份不改变安装位置。
`official/extensions/` 只保留随主程序发行的轻量内容。
开发者自行构建并在扩展中心重载，宿主不执行依赖安装、构建或生命周期脚本。
TS、TSX/React、Vue 都可以作为源码语言，发行入口须是可加载的 JS；
同文档 Client Module 的 `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`react/jsx-dev-runtime` 与 `@loom-studio/ui` 使用宿主 import map，构建时标记为 external，复用宿主实例。其他浏览器依赖及扩展自身 CSS 由扩展打包或携带；iframe 是独立文档，不继承此共享合同。详见[宿主共享前端模块](../../docs/architecture/extensions/client-renderer-host.md#宿主共享前端模块)。
Renderer 的 `mount(root, context)` 接收 HTMLElement；扩展自行挂载并返回销毁句柄。

源码分支可以忽略 dist，另行提供 Git 发行分支或 Release 成品 ZIP。
Git 安装使用公开 HTTPS 克隆地址及可选 ref，不限定 GitHub；
Release 附件通过 ZIP 链接安装，当前不自动检测新版。
Manifest 的依赖身份是作者分配的稳定 ID，不是远程 URL 或宿主生成的 UUID：

```json
{
  "dependencies": [
    {
      "id": "example.helper",
      "version": "^1.0.0",
      "source": {
        "kind": "git",
        "url": "https://example.org/team/helper.git",
        "ref": "release"
      }
    }
  ]
}
```

source 也可以声明 `{ "kind": "zip", "url": "https://example.org/helper-1.0.0.zip" }，
或省略 source 并要求依赖已安装。宿主核对实际 ID、版本及循环依赖，
缺失依赖统一确认安装，授权与启用仍分别进行。

SQL 数据使用已有 `ctx.storage.configs` / `ctx.storage.records` 的宿主归属隔离。
Server 文件数据使用 `await ctx.storage.files!.directory()` 获取当前安装的目录，
位于用户数据 `extensions/<packageId>/global` 或按 Card 安装目标隔离的子目录下；不要在代码目录或用户数据根目录随意写入。
此接口不赋予对恶意同进程 Node.js 代码的文件系统沙箱保证。

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

## Worker 与依赖边界

Manifest Module 的 runtime 接受 `server`、`client`、`client-worker`。Worker 合同复用已授权 Client 能力，以 MessagePort 代理 State、配置、History、Records、RPC、Tokens、通知与日志；`timeline.getTarget()`、`assets.url()`、`files.url()` 和订阅注册是异步调用。Worker 不提供 Renderer / DOM API，原生网络与浏览器存储仍可用，线程隔离不等于权限沙箱。实现由 Client 的 [`shared/worker-runtime/`](../../apps/studio-client/src/shared/worker-runtime/) 拥有，不由 SDK 启动 Worker。

SDK 的 Workspace 依赖主要作为作者类型来源：AI Gateway 的模型调用、Document Store 的文档输入输出、Diagnostics 的诊断、Logging 的扩展日志、Tokenizer 的计数合同，以及 Shared 的 JSON/State/Renderer 常量。它不引入 React、SQLite、网络 adapter 或第三方插件框架；只引用合同不等于获得相应能力，实际 gate 仍归 Host。

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


### 提交通知合同

`data.changed`、`docs.changed`、`docs.rollback.completed` 使用 definition version 2。小提交保留单条原形 payload；大提交按 UTF-8 JSON 预算分片，所有分片关联同一 changesetId，携带 `chunk: { index, count }`（从 0 开始），eventId 各自独立。docs operations/documents 成对，rollback completed 另带 targetChangesetId。单项摘要超出预算不在支持范围内；通知失败不撤销已提交数据。

Card 安装收到的事件逐片按权限过滤，空片省略，不携带全局 chunk。它们是独立失效提示；changesetId 只用于关联，不能作为忽略后续通知的去重键，也不能从没有 chunk 推断包含整笔提交。definition version 是事实标记，不会自动迁移消费者。直接 Commit Source 仍交付完整提交；extensions.data.changed 每个原始提交派生一次，不受 SSE 连接数或分片数影响，不承诺与 data 分片的跨订阅者全序。
