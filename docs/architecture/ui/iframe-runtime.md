# iframe 基础设施与 ctx 桥

状态：已实现，2026-09-24。

## 所有权

```text
studio-client/src/
  shared/iframe-runtime/
    frame-lifecycle.ts       创建、来源窗口校验、超时、导航失效、卸载
    frame-channel.ts         专用 MessagePort 请求／响应、校验和请求预算
    frame-size.ts            有界高度、body 替换后的重新观测
  features/message-content/  正文／Display HTML 编排，不获得业务 ctx
  features/extension-renderers/
    model/iframe-ctx-bridge.ts  把已授权的扩展能力接入通道
  features/loom-scripts/runtime/ 脚本导出、输入、Scope 和 Mount 授权
packages/extension-sdk/src/iframe-context.ts  作者侧异步代理和通知类型
```

共享层不认识 Extension、State Store、Sonner 或 ST。业务能力只能由对应 Feature 用明确的方法映射接入，不能反射整个 ctx 或传递宿主函数。

## 三种消费者

| 消费者 | 通道和能力 | 尺寸 |
|---|---|---|
| 消息 HTML | 只有来源窗口和实例 token 校验的高度消息，无业务端口 | 自动观测 |
| Loom Script | 每实例专用 MessageChannel；现有 `state.read` 与已授权 `ui.notify` | 自动观测 |
| Extension iframe | 保留旧 context/theme/close 消息；额外提供 SDK 通知请求端口 | 保留 Surface 的 iframe 布局，不注入第三方文档尺寸脚本 |

iframe 仅授予 `allow-scripts`，不授予 `allow-same-origin`。消息和 Loom Script 自己构造的文档使用限制性 CSP；普通 Extension `frame.src` 仍由受信任 Client Module 提供，不把它等同于宿主生成的断网文档。

监听在插入 iframe 前建立；加载／Loom 模块连接超时为 10 秒。后续 load 被视为导航，移除 iframe 并撤销通道，不向新文档重发上下文。初始 URL、初始重定向和外部域名白名单不是本轮新增的安全保证。

普通消息的加载确认不依赖高度消息，避免后台标签页暂停动画帧测量时误判失败。共享尺寸工具默认范围为 32–6000px，重新绑定被替换的 body；消息 HTML 明确传入无限上界，允许长文档自然展开，仍拒绝非有限数值。其他 iframe 调用方保留默认限制。第三方 `100vh` 加额外内容等依赖 iframe 视口的布局可能反馈增长，不承诺任意网页的内在高度求解；作者应避免让文档总高度反过来依赖外层自适应 iframe 高度。

消息展示按用户最新决定取消高度上限，跟随文档测量高度，不提供展开按钮，也不注入根滚动条样式；作者自行设置的滚动容器保持原样。宿主在独立 HTML 块之间保留 12px 间距，不改写作者文档内部的布局。首次加载复用 SkeletonText，加载／尺寸就绪后淡入；等待期间 frame 为 inert，reduced-motion 下关闭淡入。最近高度按完整内容、宽度和主题签名缓存在内存中，最多 32 项且键总长不超过 100 万字符，不持久化 HTML。

未进入 Timeline 的角色卡开场白通过只读 `application.previewCardOpeningDisplay` 使用同一规则引擎。它按当前卡片、显式预设与公共规则执行 Narrative/Display、深度 0 的单条投影，不创建历史、不应用不存在的 Timeline Override；正式会话仍消费冻结的规则。客户端以 endpoint、角色、预设、正文和刷新版本隔离请求。

## 通知授权

扩展 Client Module 在 Manifest 的 `capabilities` 中声明 `"ui.notify": true`，用户在扩展工作台授予通知权限。现有 `extensions.enableModule` 接受 `grants.ui: ["ui.notify"]`；空数组撤销，省略保留已有授权，旧数据缺失时默认无授权。Catalog 同时返回 `requestedUiCapabilities` 与 `desired.grants.ui`。

Loom Script 使用 Metadata 的 `@capability ui.notify` 和已有 Mount Grant。导入内容不会自动授予权限；有效能力是声明与授权的交集。

作者使用：

```ts
// Client Module 和 Loom Script 的 context：
await ctx.notifications.show({ message: '更新完成', level: 'success' })

// Extension iframe 自己的入口：
import { connectIframeContext } from '@loom-studio/extension-sdk'
const ctx = await connectIframeContext()
await ctx.notifications.show({ message: '更新完成' })
```

iframe 应在入口加载时调用连接函数；SDK 是作者打包依赖，不要求宿主自动注入全局变量。连接本身不授予权限，也不会暴露 Client Module 的 records/configs/state/rpc 等完整对象。

通知只接受 `message`（非空、至多 1000 个字符）和可选 `level`（info/success/warning/error）。宿主使用 Sonner 显示纯文本和宿主确定的 owner，不接受 HTML、动作回调、系统通知或网络权限。每个扩展 Module／Script Document 在同一客户端通知接收器中最多 3 次／10 秒，不按 iframe 数量重置预算。

授权变化会先 abort／销毁旧实例再重建；旧 ctx 的调用失败。限制针对平台通知合同，不能把它描述成对受信任主页面 JavaScript 的全面约束。

## 请求与生命周期

SDK 代理发送 `loom:ctx.request`，宿主按固定方法分派并返回 `loom:ctx.result`。每端最多 32 个未完成请求；宿主等待上限 10 秒，作者侧请求兜底超时 15 秒。请求 ID、方法和输入校验失败不能调用业务接收器。卸载时取消接收、清理计时器，过期结果不能发送给新实例。

Loom Script 的 mount/update 串行执行；能力响应不进入这条队列，避免 mount 等待 state.read 时死锁。输入投影采用实例级版本号，只应用最新结果。Module 撤销和 Script Mount 变更直接回收活动 iframe，不等待下一次 React 渲染。

宿主卸载同步撤销资源和权限；guest `dispose()` 是尽力通知，不能保证异步清理完成。需可靠提交的业务操作不应放在 iframe 卸载回调中。sandbox 不是独立进程，不能保证防止无限循环、所有自身导航出网或虚拟列表卸载后的 UI 状态丢失。

## 验证入口

- `tests/unit/client/iframe-channel.test.ts`：超时、隔离端口、卸载和通知预算。
- `tests/unit/client/loom-script-renderer-runtime.test.ts`：并发投影、实例更新和回收。
- `tests/unit/client/client-extension-host.test.ts`：声明／授权与旧 ctx 撤销。
- `tests/integration/studio-server/extension-ui-grants.test.ts`：RPC 校验、默认拒绝、重启持久化和撤销。
- [浏览器探针](../../../tests/probes/client/iframe-runtime.md)：真实 iframe、SDK、异步 mount、导航和尺寸；不读取真实业务数据。
