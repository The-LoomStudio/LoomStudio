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

当前只接受 `format: 1`、`runtime: client-sandbox`、一个或多个 Renderer Contribution、`match:<ruleId>` / `artifact:<artifactType>` 输入，以及可选的 `state.read` capability request。同一 Owner 内 Metadata ID 唯一。

持久化 Script 身份是 Document ID 与 Document Version。注册进 Renderer Host 后，稳定 Contribution Key 为 `script:<scriptDocumentId>@<documentVersion>/<contributionId>`。Extension Renderer 继续使用 `extension:<packageId>/<moduleId>/<contributionId>`；两者共享 Registry，不共享分发或生命周期身份。

## 持久化与 Mount

`airp.loomScript` 保存 Owner、解析后的 Metadata、源码 Blob 引用、文件名与 SHA-256 digest。源码以 UTF-8 字节进入 Blob Store，导出和 Runtime 解析读取相同 Document Revision 的 byte-exact 内容。

`airp.loomScriptMount` 保存目标 Owner、Script Document ID、顺序、可选固定版本、启用状态和用户授予的 capability。新 Mount 固定为禁用且无 Grant；请求 capability 不等于获得 capability。

- User、Workspace 与当前 Preset 在解析时读取当前 Mount；
- Card Mount 在创建 Narrative Timeline 时冻结到 Timeline Runtime Context；
- 已冻结 Timeline 继续解析被固定的 Script Revision、digest、Contribution IDs 与 Grant，不被作者后续编辑反向改写。

Card v3 与 Preset v2 Artifact 可以携带 `.loom.js` Attachment。导入会建立 Script 与 Mount；导出不携带本机启用状态或 Grant。

## Client Sandbox

启用的 Mount 由 Studio Client Runtime 注册到现有 Renderer Host。每个可见 Renderer Instance 使用 Blob module 与 `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`。Frame CSP 默认拒绝网络连接和其他资源，只允许内联 bootstrap 与 Blob script。

Host 与 Frame 使用专用 `MessageChannel` 交换 bootstrap、update、dispose、diagnostic 和 capability request。脚本必须导出一个 `renderers` 对象，且导出的 key 必须与 Metadata Contribution ID 完全一致；不一致时不执行 Renderer，并报告 Diagnostic。

`state.read` 同时受 Metadata 请求、Mount Grant 与 Runtime Policy 约束。Timeline 或 Narrative Node Renderer 只能读取对应 Timeline State；Global State 可以读取。脚本不能直接访问 Host DOM、Storage、任意 Application RPC 或网络。

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
- capability 只有 `state.read`；
- Sandbox 安全属性由代码与协议测试覆盖，真实 Blob iframe、CSP、DOM 清理和视觉结果仍需要浏览器验收；
- Marker selector 尚无正式数据源；Standalone Script inline Renderer 使用 Text Pipeline 的稳定 Match 数据源。

实现入口：

- [`packages/application-runtime/src/scripts/`](../../../packages/application-runtime/src/scripts/)
- [`apps/studio-client/src/features/loom-scripts/runtime/`](../../../apps/studio-client/src/features/loom-scripts/runtime/)
- [`client-renderer-host.md`](client-renderer-host.md)
- [`../application/history-text-pipeline.md`](../application/history-text-pipeline.md)

