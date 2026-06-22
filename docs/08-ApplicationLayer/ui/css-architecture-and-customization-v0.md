# CSS Architecture and Customization v0

> **状态**: Open Design
> **主题**: Studio Application UI 的 CSS 架构、主题 token、用户 Custom CSS 与插件样式边界。

---

## 1. 问题

Studio Application UI 需要同时服务两类人：

```text
官方开发者:
  需要可维护、可重构、不会全局污染的组件样式。

美化作者 / 主题作者:
  需要稳定、可读、跨版本尽量不失效的 Custom CSS 接口。

插件作者:
  需要给自己的按钮、图标、面板和 sidecar 编写样式，但不应污染官方 UI 或其他插件。
```

如果只追求官方开发效率，用户会被迫依赖脆弱的 DOM 层级选择器。

如果把所有内部类名都承诺给用户，官方后续重构会被 CSS 兼容性绑死。

本文目标是把内部样式和公开定制接口分开。

---

## 2. 结论摘要

默认方向：

```text
CSS Modules:
  官方组件内部样式隔离。内部 class 默认私有，不作为 Custom CSS API。

CSS Variables / Design Tokens:
  主题、颜色、尺寸、密度、阅读宽度等宏观皮肤接口。

data-airp-* hooks:
  暴露给 Custom CSS 的稳定 DOM 锚点。

Contribution slots:
  插件按钮、图标、面板、sidecar 的正式注入入口。

Scoped plugin root:
  插件 CSS 默认只作用在自己的 panel / command root 内。
```

一句话：

```text
Internal CSS is private. Tokens and data-airp hooks are public.
Theme authors style public hooks. Plugin authors occupy public slots.
```

---

## 3. Tailwind 的定位

Tailwind 可以提供很高的源码开发效率，但它天然不适合作为 Custom CSS 生态的唯一接口：

- 原子类缺少语义化抓手；
- 用户容易依赖脆弱的 DOM 层级；
- 官方微调 utility class 可能破坏外部覆盖；
- 用户很难理解哪些样式是稳定 API。

Tailwind v4 的 CSS-first config、theme variables、`@theme static` 等能力可以借鉴，尤其是“完整暴露 token surface”的思路。

但默认 AIRP UI 不应把 Tailwind utility class 作为用户 Custom CSS API。

待决：

- 是否在局部开发中允许 Tailwind；
- 如果使用 Tailwind，是否必须同时输出 `data-airp-*` hooks 和 tokens；
- Tailwind 是否只用于原型阶段，而正式组件使用 CSS Modules。

---

## 4. CSS Modules

官方组件样式默认使用 CSS Modules。

示例：

```tsx
import styles from './DefaultAirpLayout.module.css'

export function DefaultAirpLayout() {
  return (
    <section
      className={styles.root}
      data-airp-component="default-airp-layout"
    >
      <main
        className={styles.chatCanvas}
        data-airp-component="base-chat-canvas"
      />
    </section>
  )
}
```

原则：

- `styles.root` / `styles.chatCanvas` 是内部实现；
- 用户 Custom CSS 不应依赖 CSS Modules 生成类名；
- 是否 hash、是否 readable scoped name 是构建细节，不是用户 API；
- 不建议通过去 hash 的方式把所有内部 class 暴露给用户。

可例外：

```css
:global(.airp-chat-canvas) {
  /* 少量需要传统 class selector 的公开入口 */
}
```

但 `:global(.airp-*)` 应该少用，并进入公开 hook 清单。

---

## 5. Design Tokens

Design Tokens 是主题作者最稳定的入口。

候选 token 分类：

```css
:root {
  --airp-color-bg: #111315;
  --airp-color-surface: #181b1f;
  --airp-color-panel: rgba(24, 27, 31, 0.82);
  --airp-color-border: rgba(255, 255, 255, 0.12);
  --airp-color-text: #f2f4f6;
  --airp-color-muted: #9ca3af;
  --airp-color-accent: #7cc7ff;

  --airp-chat-width: 700px;
  --airp-overlay-width: 320px;
  --airp-input-height: 132px;

  --airp-radius-panel: 10px;
  --airp-radius-message: 12px;

  --airp-z-overlay: 20;
  --airp-z-input-dashboard: 30;
}
```

规则：

- token 名称表达用途，不表达当前颜色；
- token 是公开接口，需要版本兼容策略；
- 不删除 token；废弃 token 先保留并标记 deprecated；
- 不把所有 CSS 属性都 token 化，只暴露主题和布局关键点；
- 用户主题优先覆盖 token，而不是覆盖深层 DOM。

---

## 6. Public Styling Hooks

官方 UI 在关键节点上暴露 `data-airp-*`。

推荐命名：

```text
data-airp-component:
  组件级稳定锚点，例如 base-chat-canvas / chat-message / input-dashboard。

data-airp-slot:
  组件内部公开 slot，例如 message-body / input-toolbar / overlay-content。

data-airp-role:
  领域角色，例如 user / assistant / system / tool。

data-airp-state:
  UI 状态，例如 streaming / pending / active / disabled / error。

data-airp-plugin-id:
  插件边界。

data-airp-panel-id:
  插件 panel 边界。

data-airp-command-id:
  插件 command 边界。
```

示例：

```tsx
<article
  className={styles.message}
  data-airp-component="chat-message"
  data-airp-role={message.role}
  data-airp-state={message.streaming ? 'streaming' : 'settled'}
>
  <div
    className={styles.messageBody}
    data-airp-slot="message-body"
  >
    {message.content}
  </div>
</article>
```

用户 Custom CSS：

```css
[data-airp-component="chat-message"][data-airp-role="assistant"]
  [data-airp-slot="message-body"] {
  background: linear-gradient(135deg, #2a1731, #1a1f35);
  border-color: var(--airp-color-accent);
}
```

---

## 7. 美化作者的使用方式

美化作者可以大改默认 AIRP UI 的皮肤，但应只依赖公开接口。

示例：粉色日记本主题。

```css
:root {
  --airp-color-bg: #fff4f8;
  --airp-color-surface: #fffafc;
  --airp-color-panel: rgba(255, 247, 251, 0.86);
  --airp-color-text: #3d2731;
  --airp-color-muted: #9b6d80;
  --airp-color-accent: #ff77aa;

  --airp-chat-width: 760px;
  --airp-radius-message: 22px;
  --airp-radius-panel: 18px;
}

[data-airp-component="base-chat-canvas"] {
  background:
    linear-gradient(#ffd7e8 1px, transparent 1px),
    var(--airp-color-bg);
  background-size: 100% 32px;
}

[data-airp-component="chat-message"][data-airp-role="assistant"]
  [data-airp-slot="message-body"] {
  background: #fff;
  border: 1px solid #ffb6cf;
  box-shadow: 0 8px 24px rgba(255, 119, 170, 0.16);
}

[data-airp-component="input-dashboard"] {
  border-color: #ffb6cf;
  box-shadow: 0 18px 60px rgba(255, 119, 170, 0.22);
}
```

不推荐：

```css
/* 内部 class，不稳定 */
.DefaultAirpLayout_chatCanvas__abc123 {}

/* DOM 层级脆弱 */
div > div:nth-child(2) > span {}
```

---

## 8. 插件作者的使用方式

插件作者不应直接查找 DOM 并插入节点。插件 UI 入口应通过 contribution API 声明。

### 8.1 Command / Button

示例 manifest：

```json
{
  "contributes": {
    "commands": [
      {
        "id": "memory.openPanel",
        "title": "Open Memory Panel",
        "icon": "brain",
        "slot": "input-dashboard.trailing"
      }
    ]
  }
}
```

Host 渲染候选：

```html
<button
  data-airp-component="plugin-command-button"
  data-airp-plugin-id="memory"
  data-airp-command-id="memory.openPanel"
  data-airp-slot="input-dashboard.trailing"
>
</button>
```

插件 CSS：

```css
[data-airp-plugin-id="memory"][data-airp-command-id="memory.openPanel"] {
  color: var(--airp-color-accent);
}
```

原则：

- 按钮结构和基础状态由 Host 负责；
- 插件可以提供 icon、label、badge、status；
- 插件不应重写所有 Host button 样式。

### 8.2 Panel

示例 manifest：

```json
{
  "contributes": {
    "panels": [
      {
        "id": "memory.panel",
        "title": "Memory",
        "icon": "brain",
        "preferredSlot": "overlay.utility"
      }
    ]
  }
}
```

Host 渲染候选：

```html
<section
  data-airp-component="plugin-panel"
  data-airp-plugin-id="memory"
  data-airp-panel-id="memory.panel"
  data-airp-slot="overlay.utility"
>
</section>
```

插件 CSS 应限制在自己的 panel root 内：

```css
[data-airp-plugin-id="memory"][data-airp-panel-id="memory.panel"] {
  --memory-accent: #8fd6ff;
}

[data-airp-plugin-id="memory"][data-airp-panel-id="memory.panel"] .memory-row {
  border-bottom: 1px solid var(--airp-color-border);
}
```

### 8.3 Sidecar

消息旁边的插件面板需要显式 slot，不应随意插入 message DOM。

候选 slot：

```text
chat.sidecar
message.sidecar
message.inlineAction
timeline.overlay
```

原则：

- `message.sidecar` 会影响 message row 布局，默认谨慎开放；
- 更安全的默认入口是 `overlay.utility`，根据当前选中 message 展示上下文面板；
- sidecar 必须有宽度、折叠、键盘导航和滚动规则。

---

## 9. 兼容性规则

公开接口包括：

```text
--airp-* tokens
data-airp-* hooks
:global(.airp-*) hooks
contribution slot ids
```

兼容策略：

- public hook 一旦发布，不能随意改名；
- 删除 public hook 前需要 deprecation 期；
- 内部 CSS Modules class 不进入兼容承诺；
- DOM 结构可以重构，但应尽量保持公开 hook 语义；
- Custom CSS 失败不应破坏数据或运行时状态；
- 用户 Custom CSS 可禁用，方便排查问题。

---

## 10. 非目标

本文不定义：

- 完整主题 marketplace；
- custom renderer / independent tab；
- Web Component 虚拟列表实现；
- Tailwind 是否作为局部工具的最终决定；
- 插件 sandbox 运行时；
- CSS 安全审计的完整规则。

---

## 11. 待决问题

1. 是否允许官方代码局部使用 Tailwind，但要求所有开放节点必须有 `data-airp-*`？
2. CSS Modules 是否保留 hash，还是开发环境使用 readable name、生产环境 hash？
3. public hook 清单放在本文，还是单独生成 `styling-hooks-reference-v0.md`？
4. 用户 Custom CSS 的加载顺序如何定义？
5. 用户 Custom CSS 是否允许 `!important`，还是通过 cascade layer 提供覆盖层？
6. 插件 CSS 是否使用 Shadow DOM、CSS Modules、iframe sandbox，还是普通 scoped root？
7. Sidecar slot 首版是否开放，还是先只开放 Overlay / Drawer panel？

