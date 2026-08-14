# CSS and Theming

## 1. 当前技术边界

Studio UI 当前使用：

- SCSS Modules：组件内部结构和局部状态；
- CSS Custom Properties：跨组件的主题和几何语义；
- `data-loom-component`：稳定、可读的公共定制 hook；
- `data-loom-object`：命名迁移期间的新对象 hook；旧 `data-loom-component` 在兼容窗口内保留；
- 全局 CSS：根主题、基础元素和少量共享原语。

CSS Module 生成的类名包含构建细节，不属于公共 API。主题或自定义 CSS 不应依赖这些类名。

## 2. Token 命名与分类

正式主题变量使用 `--loom-*` 前缀。新增变量必须表达语义或稳定角色，不为单个页面的偶然数值制造全局 token。

颜色 Token 统一使用 `--loom-color-*`；Window、Panel、Dialog 等对象名只用于几何或组件名称，不作为基础颜色层级。

当前 Token 大致分为：

```text
Surface color:
  --loom-color-background
  --loom-color-surface-inset
  --loom-color-surface
  --loom-color-surface-subtle
  --loom-color-surface-emphasis
  --loom-color-surface-muted
  --loom-color-surface-raised

Text and boundary color:
  --loom-color-text
  --loom-color-text-muted
  --loom-color-text-subtle
  --loom-color-border
  --loom-color-border-strong
  --loom-color-divider

Interaction and status color:
  --loom-color-accent
  --loom-color-selection-background
  --loom-color-danger
  --loom-color-warning
  --loom-color-info
  --loom-color-success

Geometry:
  --loom-page-header-*
  --loom-divider-*
  --loom-rail-collapsed-width
  --loom-rail-expanded-width
  --loom-window-gap
  --loom-window-min-width
  --loom-window-min-height
  --loom-radius-sm / md / lg / xl / full
  --loom-radius-control / surface / card / panel
  --loom-radius-popover / dialog / window / message

Syntax color:
  --loom-color-syntax-comment
  --loom-color-syntax-heading
  --loom-color-syntax-keyword
  --loom-color-syntax-string
  ...

Typography foundation:
  --loom-font-family-sans / mono
  --loom-font-size-1 ... 8
  --loom-font-size-body
  --loom-font-weight-1 ... 9
  --loom-line-height-compact / title / tight / heading
  --loom-line-height-code / ui / body / reading / relaxed

Motion foundation:
  --loom-motion-duration-fast
  --loom-motion-duration-standard
  --loom-motion-duration-loading
  --loom-motion-easing-standard

Markdown content:
  --loom-markdown-code-block-border
  --loom-markdown-code-block-bg
  --loom-markdown-inline-code-bg
  --loom-markdown-inline-code-size
```

主题提供语义变量，不暴露一份要求所有消费者理解的原始彩色 palette。语法色与产品状态色可以共享色值，但语义变量保持分离。
`--loom-radius-message` 默认保持用户消息原有的 `16px` 气泡圆角，并允许 Custom CSS 独立覆盖；它不必机械映射到基础圆角阶梯。

Typography 使用“基础等级 + 克制语义别名”：字号等级只表达从小到大的客观尺度，组件可直接消费等级；只有 `body` 这类跨组件稳定角色才进入全局语义别名。组件专属标题、Meta 或 Tool 文本不进入 `:root`，需要覆盖时由组件作用域建立局部别名。字重等级暂时保留当前精确值，不在 Token 迁移时同时改变既有视觉。

默认正文使用操作系统 UI 字体 `system-ui`，不加载 Loom 自有字体。代码、日志和结构化数据使用共享的系统等宽字体栈。Markdown 相对标题、错误页 Display 字号和特殊内容行高继续归宿主所有，不为了消灭所有字面量扩大全局合同。

## 3. 表面层级

颜色只表达视觉关系：

```css
background < inset / surface < subtle / emphasis < raised
```

组件根据内容关系选择层级，不根据自己属于 Window、Panel 或 Dialog 选择颜色。Window、Panel、Dialog 可以使用同一个 Surface，也可以根据视觉需要选择 Raised，但不会因此产生 `--loom-color-window` 或 `--loom-color-panel`。

旧 `--loom-bg`、`--loom-surface`、`--loom-panel`、`--loom-window*` 等变量仅作为 Custom CSS 兼容输入，由新的 `--loom-color-*` Token 读取；生产组件不再直接消费旧变量。新主题应只覆盖 `--loom-color-*`。

## 4. 公共定制 hook

需要允许用户或插件主题稳定选择的组件，应提供：

```html
data-loom-component="long-text-editor"
```

规则：

- 值使用稳定的 kebab-case 语义名；
- hook 标记组件边界，不暴露每一层内部 DOM；
- 内部结构变化时尽量保持边界 hook；
- 状态优先使用原生属性、ARIA 或单独的 `data-*`，不要要求匹配生成类名；
- 新 hook 只有在存在明确覆盖需求时才添加。

`data-loom-component` 是 CSS hook，不自动成为 JavaScript、插件 SDK 或 DOM 结构兼容承诺。

当前命名迁移采用增量兼容：旧精确选择器继续保留在原 DOM，新对象使用独立的
`data-loom-object`。例如 Narrative Timeline 仍保留
`data-loom-component="narrative-canvas"`，同时提供
`data-loom-object="narrative-timeline"`。不要把两个值塞入同一属性；这会破坏现有
`[data-loom-component="..."]` 精确选择器。

当前兼容映射：

| 旧 Hook | 新对象 Hook |
| --- | --- |
| `studio-workspace-shell` | `studio-shell` |
| `narrative-canvas` | `narrative-timeline` |
| `overlay-utility-layer` | `inspector-panel` |
| `overlay-${panel}-layer` | `${panel}-panel` |

`--loom-rail-collapsed-width` 默认读取旧 `--loom-rail-width`，因此已有覆盖仍然生效；
`--loom-overlay-width` 当前无生产消费者，等待 Window Architecture 决定后再移除。
扁平视觉不定义 Shadow Token，阴影不是当前主题层级合同。

## 5. Cascade 约定

为了让自定义 CSS 可维护：

- 组件基础样式保持低 specificity；
- 禁止为普通视觉覆盖使用 `!important`；
- 可主题化的颜色和尺寸优先读取 token；
- 避免用内联 style 写颜色，运行时几何值除外；
- 避免用 `::before` / `::after` 构造大块关键表面或不可绕过的装饰；
- 伪元素只用于不改变语义、易于覆盖的小型装饰；
- 不用完整边框和阴影作为所有容器的默认层级手段。

运行时 resize 等动态几何允许通过内联 Custom Property 传入，因为它表达状态而不是主题。

## 6. 新主题的最低合同

一个主题至少应覆盖：

1. 基础与窗口表面；
2. 正文、弱化文字和边界；
3. 强调、选择、危险、警告、信息和成功；
4. 编辑器语法语义色；
5. 可见的键盘焦点；
6. 浏览器原生滚动条和表单控件的暗色适配。

主题必须检查正文、弱化文字、焦点和状态的对比度，不能只按截图近似替换颜色。

## 7. 不属于当前合同的内容

当前没有稳定的运行时主题配置、主题包 manifest、插件 iframe token 注入或 CSS 版本协商。实现这些能力前，不应把现有 DOM 和全部变量视为永久 SDK。
