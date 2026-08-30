# I18N and Accessibility v0

> **状态**: Archived / Fully Promoted to Architecture（已由 docs/architecture/ui/localization-and-accessibility.md 替代）
> **主题**: Studio Application UI 的国际化、键盘导航、焦点管理和无障碍基础约束。
> **晋升说明**: 当前 TypeScript 字典实现和已落地的基础无障碍约定已整理至 [`../../../architecture/ui/localization-and-accessibility.md`](../../../architecture/ui/localization-and-accessibility.md)。本文继续保留插件 locale、完整焦点模型等未实施设计；两者冲突时以 Architecture 文档和当前实现为准。

---

## 1. 问题

I18N 和无障碍不能等正式 UI 完成后再补。Studio Application UI 会包含长文本、复杂面板、编辑器、菜单、快捷键、streaming 输出和大量状态变化；这些都会影响翻译、焦点和屏幕阅读器体验。

本文先定义基础约束，不选择具体 i18n 库。

---

## 2. 方案摘要

默认方向：

```text
Accessibility:
  原生语义 HTML 优先，ARIA 只补复杂组件。

Keyboard:
  所有核心工作流必须可键盘完成。

Focus:
  Modal / popover / panel 切换需要明确焦点进入、陷阱和恢复规则。

I18N:
  UI 可见文案不硬编码。组件使用稳定 message key，翻译资源放在专门的 i18n/ 文件夹。

Extension:
  插件和 Custom Renderer 允许自带 locale resources，Host 提供当前 locale 和 fallback 规则。
```

一句话：

```text
Use native semantics first. Use ARIA only when semantics are missing.
UI code references message keys. Locale resources live outside components.
```

---

## 3. I18N 初始原则

1. UI 文案不硬编码在领域数据中。
2. Button / menu / command title 使用可翻译 key。
3. 不通过字符串拼接生成句子。
4. 支持复数、日期、时间、数字和相对时间格式化。
5. 错误码和用户可读文案分离。
6. 领域内容不默认翻译，例如 Card 正文、Narrative Timeline、Setting Layer content。
7. Provider / model / extension id 不翻译；display name 可翻译或由贡献方提供 localized labels。

---

## 4. Locale Resources

第一版采用外部资源文件，而不是把文案写死在组件里。

候选目录：

```text
apps/studio-client/src/locales/
  zh-CN.json
  en-US.json
```

示例：

```json
{
  "chat.send": "发送",
  "chat.stop": "停止",
  "session.new": "新建会话",
  "provider.status.connected": "已连接",
  "error.providerUnavailable": "模型服务不可用"
}
```

组件只引用 key：

```tsx
<button>{t('chat.send')}</button>
```

不直接写：

```tsx
<button>发送</button>
```

资源文件规则：

- key 使用稳定命名，不和显示文案绑定；
- 支持 fallback locale；
- missing key 在开发环境警告；
- 日期、数字、相对时间使用 locale-aware formatter；
- 变量插值使用命名参数，不拼接字符串；
- 错误码和用户可读文案分离。

候选库：

```text
i18next
FormatJS / react-intl
Lingui
```

当前倾向：

```text
先使用轻量 i18n/ 资源目录；正式库候选为 i18next + JSON resource files
```

原因是足够通用、生态成熟、插件扩展接入成本低。

动工前已定：

- UI 可见文案一律不硬编码；
- locale 资源放在专门的 `i18n/` 文件夹；
- 插件和 Custom Renderer 允许自带翻译资源。

---

## 5. 插件本地化

插件应自带 locale resources。

候选目录：

```text
extensions/example/locales/
  zh-CN.json
  en-US.json
```

候选 manifest：

```json
{
  "contributes": {
    "locales": {
      "zh-CN": "./locales/zh-CN.json",
      "en-US": "./locales/en-US.json"
    }
  }
}
```

插件贡献 command / panel 时，title 可以先保留字符串；稳定后支持 localized label。

候选形态：

```json
{
  "id": "memory.openPanel",
  "title": {
    "key": "memory.openPanel.title",
    "default": "Memory"
  }
}
```

规则：

- Host 提供当前 locale；
- 插件负责自己的文案包；
- 插件缺少当前 locale 时 fallback 到默认 locale；
- 插件 id、provider id、model id 不翻译；
- display name 可以由插件提供 localized labels。

---

## 6. 文案分层

```text
Application chrome:
  导航、菜单、按钮、状态标签，需要翻译。

Domain labels:
  Card、Session、Opening、Setting Layer 等术语，需要术语表稳定后翻译。

User content:
  用户写入的正文，不由 UI 自动翻译。

Diagnostics:
  error code 稳定，message 可翻译，debug detail 可保留原文。

Extension UI:
  Extension 自己负责文案包，但 Shell/Application 提供 locale 信息。
```

---

## 7. 无障碍基础原则

默认规则：

1. 原生语义 HTML 优先。
2. 能用 `<button>` 就不用 `div role="button"`。
3. 表单使用 `<label>` 关联输入控件。
4. 导航、列表、标题、区域使用语义元素表达结构。
5. ARIA 只在原生语义不足时使用。
6. ARIA 不改变行为；需要配合键盘和焦点逻辑。
7. 不只依赖颜色表达状态。
8. 动画遵守 `prefers-reduced-motion`。

常见组件：

| 组件 | 推荐基础 |
|---|---|
| Button | `<button>` + visible label 或 `aria-label` |
| Dialog | `role="dialog"` / `aria-modal` / focus trap |
| Tabs | `role="tablist"` / `role="tab"` / `role="tabpanel"` |
| Menu | keyboard navigation + active item |
| Tree / Listbox | roving tabindex + selected / expanded state |
| Toast | 不承载必须处理的错误 |

---

## 8. 键盘导航

默认 AIRP UI 应支持不用鼠标完成核心工作流：

- 打开 command palette；
- 切换主区域；
- 在 resource list / session list 中移动；
- 进入当前 Canvas；
- 聚焦输入框；
- 发送 / 中止 / 重试；
- 打开 diagnostics / trace；
- 在 modal / popover 内完成选择并返回原焦点。

初始规则：

- 所有可点击控件必须可键盘聚焦；
- 焦点顺序应符合视觉顺序；
- modal 打开时 focus trap，关闭后恢复触发点；
- panel / tab 切换不应丢失合理焦点；
- roving tabindex 可用于 tree / list / toolbar，但需要一致实现。

---

## 9. ARIA 与动态内容

候选规则：

- icon-only button 必须有 accessible name；
- loading / pending / streaming 状态需要可读状态文本；
- diagnostics count / error badge 不只依赖颜色；
- destructive action 需要明确名称和确认；
- live region 只用于关键状态，不用于每个 streaming token；
- Chat timeline 中的新消息通知应避免刷屏；
- Code / prompt / trace 内容应可复制，并保留语义标签。

关键边界：

```text
aria-live:
  只播报关键状态，例如 Run started / failed / completed。
  不逐 token 播报 streaming 输出。

aria-label:
  用于 icon-only button。
  不替代可见文本。

aria-expanded / aria-selected:
  必须和真实 UI 状态同步。

role:
  只在原生元素不能表达语义时使用。
```

---

## 10. 可缩放文本与对比度

要求：

- 文本不能依赖固定像素容器导致截断；
- 按钮和列表项要能容纳较长翻译；
- 不使用负 letter-spacing；
- 不用颜色作为唯一状态表达；
- reduced motion 下关闭非必要动画；
- high contrast theme 需要保留状态区分。

---

## 11. 快捷键

快捷键需要分层：

```text
Shell global:
  Command Palette、Quick Open、Preferences、panel toggle。

Application global:
  New Session、Send、Stop、Open Trace、Open Prompt Preview。

Canvas local:
  编辑器、Chat input、列表、tree 内部导航。

Extension local:
  只能在 extension panel 焦点范围内生效，除非声明 command。
```

待决：

- 是否采用 VSCode 风格 when-clause；
- 快捷键冲突由 Shell 统一解决，还是 Application 先做局部映射；
- Chat input 中 Enter / Shift+Enter / Cmd+Enter 的默认行为。

---

## 12. 待决问题

1. 第一版是否只支持中文 UI 文案，还是从一开始提供英文 resource file？
2. 术语表应放在 `ui/`，还是放在 Application 总览/Glossary？
3. 是否需要内建 locale detection 和手动 override？
4. Extension localized labels 的 manifest 形状如何设计？
5. Trace / Prompt Preview 中被 redacted 的内容如何向屏幕阅读器说明？
6. I18N 库最终采用 i18next、FormatJS 还是 Lingui？
7. 复杂组件是否直接采用成熟 headless a11y primitives，还是先手写最小实现？
