# Loom Script Runtime

> 状态：已实现（2026-09-11）

Loom Script 是面向轻量 Renderer 的单文件分发格式。它与 Extension Client Module 共用 Client Renderer Host、Surface、Scope、冲突仲裁和诊断，但不使用 Extension Package Manifest、Module 或 Instance 身份。

```text
.loom.js source
  -> static Metadata parse
  -> airp.loomScript + Blob source
  -> airp.loomScriptMount
  -> Runtime mount resolution
  -> sandboxed Renderer registration
  -> Client Renderer Host
```

## Metadata 与身份

Metadata 必须从文件首行开始，并由 `// ==LoomScript==` 与 `// ==/LoomScript==` 包围。Host 静态解析 `format`、`id`、`name`、`version`、`runtime`、可重复的 `capability` 与 `contribution`，不会为了建立索引而执行脚本。

当前只接受 `format: 1`、`runtime: client-sandbox`、一个或多个 Renderer Contribution、`match:<ruleId>` / `artifact:<artifactType>` 输入，以及可选的 `state.read`、`ui.notify` capability request。同一 Owner 内 Metadata ID 唯一。

持久化 Script 身份是 Document ID 与 Document Version。注册进 Renderer Host 后，稳定 Contribution Key 为 `script:<scriptDocumentId>@<documentVersion>/<contributionId>`。Extension Renderer 继续使用 `extension:<packageId>/<moduleId>/<contributionId>`；两者共享 Registry，不共享分发或生命周期身份。

## 持久化与 Mount

`airp.loomScript` 保存 Owner、解析后的 Metadata、源码 Blob 引用、文件名与 SHA-256 digest。源码以 UTF-8 字节进入 Blob Store，导出和 Runtime 解析读取相同 Document Revision 的 byte-exact 内容。

`airp.loomScriptMount` 保存目标 Owner、Script Document ID、顺序、可选固定版本、启用状态和用户授予的 capability。新 Mount 固定为禁用且无 Grant；请求 capability 不等于获得 capability。

- User、Workspace 与当前 Preset 在解析时读取当前 Mount；
- 已有 Narrative Timeline 通过来源 Card 读取当前 Mount 和 Script；角色更新后，下次解析使用新内容，移除的 Mount 不从旧 Timeline 快照恢复；
- Mount 显式固定版本仍表示作者/用户当前选择；Timeline 本身不另加版本锁。Grant 仍取当前 Mount 的显式授权，代码更新不自动增加权限。旧 Runtime Context 中的 Script 快照不再参与运行解析。

Card v3 与 Preset v2 Artifact 可以携带 `.loom.js` Attachment。导入会建立 Script 与 Mount；导出不携带本机启用状态或 Grant。

## Client Sandbox

启用的 Mount 由 Studio Client Runtime 注册到现有 Renderer Host。每个可见 Renderer Instance 使用 Blob module 与 `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`。Frame CSP 默认拒绝网络连接和其他资源，只允许内联 bootstrap 与 Blob script。

Host 与 Frame 使用专用 `MessageChannel` 交换 bootstrap、update、dispose、diagnostic 和 capability request。脚本必须导出一个 `renderers` 对象，且导出的 key 必须与 Metadata Contribution ID 完全一致；不一致时不执行 Renderer，并报告 Diagnostic。

2026-09-24 起复用 [iframe 基建](../ui/iframe-runtime.md)。源码在隔离文档内部创建 Blob module；输入投影只接受当前实例的最新结果，mount/update 串行执行，能力应答独立处理。撤销 Mount 后同步回收 iframe 和宿主端口；guest dispose 只做尽力通知，不保证异步回调完成。

`state.read` 同时受 Metadata 请求、Mount Grant 与 Runtime Policy 约束。Timeline 或 Narrative Node Renderer 只能读取对应 Timeline State；Global State 可以读取。`ctx.notifications.show()` 同样需要声明与 Grant，且受按 Script Document 共享的通知预算限制。脚本不能直接访问 Host DOM、Storage 或任意 Application RPC；CSP 限制子资源和连接，但不能据此承诺阻止所有自身导航出网。

## Text Pipeline 输入

Renderer 输入来自正式 `inspectTextPipeline` 结果，不重新扫描 Raw Text：

- `match` 只传递具有 `displayRange` 的稳定 Match Record；
- `artifact` 保留 `artifactType` 与 `sourceEntryId`；
- Inline Renderer 使用官方 Match Range 生成 `match-ref` Node Mount；
- 无法映射到当前渲染文本的范围不会猜测位置，并产生 Anchor Diagnostic；
- Timeline / Session collection Renderer 获得当前 Scope 的全部声明输入。

Inline Mount 只替换渲染投影中的目标范围，不修改 Canonical Narrative 或 Agent Message。

## API 与界面

- Script：`importLoomScript`、`updateLoomScript`、`getLoomScript`、`listLoomScripts`、`exportLoomScript`
- Mount：`createLoomScriptMount`、`updateLoomScriptMount`、`listLoomScriptMounts`
- Runtime：`resolveLoomScriptRendererMounts`

资源工作台按 Card / Preset Owner 编辑 Script 与 Mount。Text Pipeline 专门面板只展示当前 Runtime Context 解析出的启用 Mount，以及 Client Renderer Host 中实际注册的 Extension / Loom Script Renderer。

## 当前边界

- 当前只支持 Renderer Contribution，不提供任意后台任务、Server Runtime 或通用脚本分类；
- capability 只有 `state.read` 与 `ui.notify`；
- 协议／授权测试及真实 iframe 探针已验证加载、异步 mount/update、通知、导航撤销、body 尺寸更新和实例卸载；完整角色卡、移动端、视觉结果与任意第三方脚本仍未验收；
- Marker selector 尚无正式数据源；Standalone Script inline Renderer 使用 Text Pipeline 的稳定 Match 数据源。

实现入口：

- [`packages/application-runtime/src/scripts/`](../../../packages/application-runtime/src/scripts/)
- [`apps/studio-client/src/features/loom-scripts/runtime/`](../../../apps/studio-client/src/features/loom-scripts/runtime/)
- [`client-renderer-host.md`](client-renderer-host.md)
- [`../application/history-text-pipeline.md`](../application/history-text-pipeline.md)
