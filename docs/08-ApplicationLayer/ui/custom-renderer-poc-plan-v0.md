# Custom Renderer Multi-Tab PoC Plan v0

> **状态**: PoC Plan
> **主题**: 用最小多标签页实验验证重型自定义前端渲染的隔离、状态同步、轻量 SDK 和 CSS / A11Y / I18N 基础方案。

---

## 1. 目标

本 PoC 不验证完整产品 UI，也不验证视觉风格。

它只验证一句话：

```text
Host 和 Custom Renderer 能通过 renderer session 共享后端状态，同时保持视觉和运行隔离。
```

需要证明：

- Host React SPA 可以打开独立 Custom Renderer tab / window；
- Renderer 的 CSS / JS 不影响 Host；
- Host 和 Renderer 都只通过后端读写 canonical state；
- Renderer 使用轻量 SDK，不直接处理底层 fetch / WebSocket 细节；
- Host 侧 CSS tokens / data-airp hooks / Custom CSS 可以工作；
- 最小 a11y / i18n 方案不会阻塞该架构。

---

## 2. 非目标

PoC 阶段不做：

- 完整 AIRP UI；
- Live2D；
- 游戏式 renderer；
- 完整插件系统；
- 完整权限模型；
- 正式 SDK package；
- 虚拟列表 / Web Component；
- 完整 custom renderer 安全沙箱；
- 完整主题编辑器；
- 正式桌面窗口管理；
- 真实模型调用。

---

## 3. 最小拓扑

候选拓扑：

```text
apps/studio-server
  /rpc
  /renderer/session/create
  /renderer/events or WebSocket endpoint

apps/studio-client
  Host page:
    React SPA
    Default AIRP layout smoke
    open renderer button
    state inspector
    custom CSS textarea

  Renderer page:
    separate route or renderer.html
    custom renderer sandbox smoke
    uses renderer-sdk
```

如果不新建 app，先在 `apps/studio-client` 内做两个 entry 即可：

```text
/index.html
  Host

/renderer.html
  Custom Renderer PoC
```

---

## 4. PoC 数据模型

只需要极小状态：

```ts
type PocState = {
  loveLevel: number
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    createdAt: string
  }>
}
```

后端是唯一 Single Source of Truth。

Host 和 Renderer 都不能持有 canonical state，只能持有 UI cache / projection。

---

## 5. Renderer Session

PoC 不使用长期 token 放 URL。

候选流程：

```text
1. Host 调用 backend 创建 renderer session。
2. Backend 返回短期 rendererSessionId / nonce。
3. Host window.open('/renderer.html#session=<id>')。
4. Renderer 启动后用 session id 与 backend 握手。
5. Backend 绑定 renderer connection。
6. Renderer 订阅 state / message events。
```

PoC 只验证生命周期，不定义最终安全模型。

需要覆盖：

- session 创建；
- renderer 首次连接；
- renderer 刷新后重连；
- host 手动关闭 / revoke session；
- session 无效时 renderer 显示拒绝状态；
- session 过期时 renderer 断开并提示。

待决：

- PoC 使用 URL hash 还是 postMessage handshake；
- PoC 事件流使用 WebSocket、SSE，还是先用 polling；
- renderer session 是否绑定 Host tab id。

---

## 6. 最小 Renderer SDK

PoC SDK 只需要验证使用体验，不作为正式 API。

候选形态：

```ts
const love = await airp.state.get('loveLevel')
await airp.state.set('loveLevel', love + 1)

const messages = await airp.messages.list()
await airp.messages.append({
  role: 'user',
  content: 'hello',
})

airp.on('stateChange:loveLevel', value => {
  renderLove(value)
})

airp.on('message:new', message => {
  renderMessage(message)
})
```

最小能力：

```text
state.get
state.set
messages.list
messages.append
events.subscribe
events.unsubscribe
connection.status
```

SDK 目标：

- 创作者不直接处理底层 transport；
- 网络调用看起来像本地函数调用；
- event handler 有 dispose；
- 连接失败有明确状态；
- SDK 不暴露 backend secrets。

---

## 7. Host Page 验证项

Host 最小 UI：

```text
Default AIRP layout smoke:
  Base Chat Canvas
  Overlay Utility Layer
  Integrated Input Dashboard

Controls:
  Open Custom Renderer
  Increment loveLevel
  Append message
  Inject Custom CSS
  Revoke renderer session

Inspector:
  current state
  renderer connection status
  event log
```

Host CSS 验证：

- 使用 CSS Modules 内部 class；
- 暴露 `data-airp-component`；
- 暴露 `--airp-*` token；
- Custom CSS textarea 能覆盖 tokens；
- Custom CSS 能通过 `data-airp-*` 改消息样式；
- Custom CSS 不依赖 CSS Modules class。

---

## 8. Renderer Page 验证项

Renderer 最小 UI：

```text
Connection status
loveLevel display
message list
Append message button
Increment loveLevel button
Break my CSS button
Throw error button
```

隔离验证：

- Renderer 执行 `document.body.style.background = 'hotpink'`，Host 不受影响；
- Renderer 添加全局 CSS reset，Host 不受影响；
- Renderer 抛运行时异常，Host 仍可操作；
- Renderer 页面刷新后重新连接并恢复 state；
- Renderer 断线时 Host 显示状态变化。

---

## 9. 后端状态同步验收

验收路径：

```text
Host increments loveLevel
  -> backend updates state
  -> Renderer receives stateChange
  -> Renderer UI updates

Renderer increments loveLevel
  -> backend updates state
  -> Host receives stateChange
  -> Host UI updates

Host appends message
  -> backend stores message
  -> Renderer receives message:new

Renderer appends message
  -> backend stores message
  -> Host receives message:new
```

通过标准：

- 双端最终展示同一份 state；
- 刷新 Renderer 不丢 canonical state；
- Host 不依赖 Renderer 存在；
- Renderer 不依赖 Host DOM。

---

## 10. CSS / A11Y / I18N Smoke

### 10.1 CSS Smoke

验证：

- Host 使用 `--airp-*` tokens；
- Host 暴露 `data-airp-*` hooks；
- 用户 Custom CSS 可以改变 Host 皮肤；
- Renderer 可以使用完全不同 CSS；
- Renderer CSS 不影响 Host。

### 10.2 A11Y Smoke

验证：

- `Open Custom Renderer` 是 `<button>`；
- icon-only control 有 `aria-label`；
- connection status 有可读文本；
- renderer session invalid 时焦点落到可理解的错误区域；
- `aria-live` 只播报关键状态，不播报每个 token / message 字符。

### 10.3 I18N Smoke

验证：

- Host UI 文案使用 `t(key)`；
- 至少有 `zh-CN.json` 和 `en-US.json`；
- Renderer 使用同一 locale 或 backend 提供的 locale；
- missing key 在开发环境可见；
- 用户消息内容不自动翻译。

---

## 11. 最小测试清单

自动测试候选：

```text
renderer session create / revoke
invalid session rejected
state.get / state.set roundtrip
messages.list / messages.append roundtrip
event fanout to Host and Renderer
```

手动验证候选：

```text
Open Renderer
Host -> Renderer state sync
Renderer -> Host state sync
Renderer refresh reconnect
Renderer CSS break does not affect Host
Renderer runtime error does not affect Host
Custom CSS changes Host through tokens/hooks
```

如果引入浏览器 E2E，优先使用 Playwright；但 PoC 第一轮可以先手动验证 + 单元测试。

---

## 12. 实施步骤建议

```text
Step 1:
  Server 增加内存 PocState、renderer session store、最小 RPC。
  验证: 单元测试 state / message / session。

Step 2:
  Host 增加 PoC panel 和 open renderer button。
  验证: Host 能读写 PocState。

Step 3:
  Renderer page + renderer-sdk。
  验证: Renderer 能握手、读写 state、订阅事件。

Step 4:
  CSS / Custom CSS smoke。
  验证: tokens/hooks 生效，Renderer CSS 隔离。

Step 5:
  A11Y / I18N smoke。
  验证: 关键按钮、状态、locale resource 方案可用。
```

---

## 13. 成功标准

PoC 通过需要满足：

1. Host 可以打开 Renderer tab / window。
2. Host 和 Renderer 双向同步 `loveLevel`。
3. Host 和 Renderer 双向同步 messages。
4. Renderer 刷新后能重新连接。
5. Renderer CSS 污染不影响 Host。
6. Renderer runtime error 不影响 Host。
7. Host Custom CSS 通过 tokens / `data-airp-*` 生效。
8. 基础按钮和状态满足 a11y smoke。
9. Host 至少通过 locale JSON 渲染一组 UI 文案。

---

## 14. 后续分叉

如果 PoC 通过，后续可以拆出：

```text
renderer-architecture-v0.md:
  正式 custom renderer 拓扑、session、安全边界。

renderer-sdk-v0.md:
  SDK API、事件、错误、连接生命周期。

render-decoration-v0.md:
  轻量消息装饰、正则/Transform Rule 与官方 UI 的边界。

styling-hooks-reference-v0.md:
  public `data-airp-*` hooks 和 token 清单。
```

