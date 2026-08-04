# CSS and Theming

## 1. 当前技术边界

Studio UI 当前使用：

- SCSS Modules：组件内部结构和局部状态；
- CSS Custom Properties：跨组件的主题和几何语义；
- `data-loom-component`：稳定、可读的公共定制 hook；
- 全局 CSS：根主题、基础元素和少量共享原语。

CSS Module 生成的类名包含构建细节，不属于公共 API。主题或自定义 CSS 不应依赖这些类名。

## 2. Token 命名与分类

正式主题变量使用 `--loom-*` 前缀。新增变量必须表达语义或稳定角色，不为单个页面的偶然数值制造全局 token。

当前 token 大致分为：

```text
Surface:
  --loom-bg
  --loom-surface
  --loom-surface-deep
  --loom-panel
  --loom-window
  --loom-window-surface
  --loom-window-raised

Text and boundary:
  --loom-text
  --loom-text-muted
  --loom-text-subtle
  --loom-border
  --loom-divider-color

Interaction and status:
  --loom-accent
  --loom-selection-bg
  --loom-danger
  --loom-warning
  --loom-info
  --loom-success

Geometry:
  --loom-page-header-*
  --loom-divider-*
  --loom-*-width
  --loom-*-height
  --loom-radius-*

Syntax semantics:
  --loom-syntax-comment
  --loom-syntax-heading
  --loom-syntax-keyword
  --loom-syntax-string
  ...
```

主题提供语义变量，不暴露一份要求所有消费者理解的原始彩色 palette。语法色与产品状态色可以共享色值，但语义变量保持分离。

## 3. 局部表面重映射

浮动窗口内部会重映射基础表面：

```css
--loom-bg: var(--loom-window);
--loom-surface: var(--loom-window-surface);
--loom-panel: var(--loom-window-raised);
```

因此共享组件只消费 `--loom-bg`、`--loom-surface`、`--loom-panel` 等局部语义，不需要知道自己位于 Base Canvas 还是 Window。这是当前的主题层级机制，不应在组件内硬编码父页面色值。

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

