# UI Preflight Decisions v0

> **状态**: Open Design / Initial Decisions
> **主题**: Studio Application UI 动工前必须先定的基础约束。

---

## 1. 定位

本文记录 UI 正式动工前已经收束的基础决策。

这些决策不定义最终视觉风格，也不要求后端已经支持所有能力。它们只约束第一版 UI 的写法，避免后续出现大面积返工。

---

## 2. I18N

当前决定：

```text
UI 可见文案:
  一律不直接硬编码在组件中。

Locale resources:
  放在专门的 i18n/ 文件夹。

Plugin / Custom Renderer:
  允许自带翻译资源。
```

第一版实现可以很轻量，不必立即引入完整 i18n 库。

但组件代码应从一开始通过稳定 key 读取文案：

```ts
t('chat.send')
```

而不是：

```tsx
<button>发送</button>
```

---

## 3. 滚动所有权

当前决定：

```text
Body:
  不作为主滚动容器。

Canvas:
  自己管理滚动。

Timeline:
  自己管理滚动。

Overlay:
  自己管理滚动。

Agent Panel / Drawer:
  自己管理滚动。
```

各区域默认独立滚动。streaming 时的自动锚底也按 surface 独立处理，具体锚底策略后续随真实 UI 调整。

---

## 4. 焦点与弹层

当前决定：

```text
Dialog / Drawer / Popover:
  各自独立处理焦点进入、返回、Esc 关闭等行为。
```

细节可以后续在具体组件实现中继续收束。

第一版约束：

- 能用原生语义元素就用原生语义元素；
- 图标按钮需要 accessible name；
- 可点击控件必须可键盘聚焦；
- 不把焦点管理散落到业务组件中。

---

## 5. 渲染与安全

当前决定：

```text
普通消息 HTML / JS:
  不一刀切禁止。
  但首次使用需要明确警告。

Artifact render mode:
  inline / iframe / new tab 由作者自己决定。

Agent 面板行为卡:
  不强制必须走 ToolCall / Action。
  作者也可以选择 iframe。
```

护栏：

- 系统应提供 first-run warning；
- 用户应能禁用某个卡、插件或 renderer 的高风险渲染；
- 写入 canonical data 的行为仍应通过受控 API；
- iframe 或 Custom Renderer 可以负责 UI，但不应直接绕过权限、审计和回滚边界。

---

## 6. 插件 Slot

当前决定：

```text
插件能挂哪些 UI slot:
  初版做出来后再根据真实界面收敛。
```

第一版不急于完整开放 slot 清单。

但官方 UI 从一开始应使用 `data-airp-*` hooks 和清晰的布局区域，方便未来把真实 slot 接进来。

---

## 7. 首版 UI 实现策略

第一版可以先造 UI，不等待后端能力全部完成。

推荐顺序：

```text
1. 搭默认 AIRP Shell / Canvas / Overlay / Input Dashboard。
2. 用现有 RPC 和本地 mock projection 填充界面。
3. 保持 i18n、scroll、data-airp hooks 和 CSS token 规则。
4. 后端能力补齐后逐步替换 mock / placeholder。
```

原则：

```text
先建立正确的 UI 骨架和交互边界，再逐步接入完整业务能力。
```

---

## 8. 待后续收束

1. streaming 独立锚底的具体规则；
2. Dialog / Drawer / Popover 的统一 focus contract；
3. HTML / JS first-run warning 的权限记录粒度；
4. inline / iframe / new tab 的推荐提示文案；
5. 插件 slot 首版开放清单；
6. Agent 面板 iframe 与 ToolCall / Action Card 的协作规则。
