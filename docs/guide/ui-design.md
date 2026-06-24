# UI 设计与架构准则 (UI Design & CSS Architecture)

Loom Studio Client 是一个高信息密度的专业桌面级 Web 应用。

## 1. 核心设计原则

- **桌面专业工具优先**: 我们不是移动端 App。不需为了移动端牺牲桌面端的屏幕利用率。面板要支持调整大小，快捷键要有。
- **高信息密度**: 减少多余的留白。在不显得杂乱的前提下，同屏显示尽可能多的关联信息。
- **暗黑主题优先 (但保留主题切换能力)**: 专业工具通常使用暗黑模式，但 CSS 的基础架构必须建立在 CSS Variables (Custom Properties) 之上，以允许未来实现亮色模式或其他皮肤。

## 2. CSS 架构

我们没有使用 Tailwind 或大型 UI 组件库。我们使用 **原生 CSS Modules + CSS Custom Properties**。

- **全局变量**: 所有颜色、间距、排版相关的 token 定义在全局作用域的 `:root` 下。
- **CSS Modules**: 所有的组件内部样式，必须使用 `.module.css` 以防止全局污染。
- **BEM 命名**: 虽然有 Modules 隔离，但类名依然建议采用简化版的 BEM (`.block-name__element--modifier`) 以增加可读性。

## 3. 组件划分

在 `apps/studio-client/src/` 中，组件被划分为三个层级：

1. **`shared/ui/`**: 绝对纯粹的无状态组件（如自定义的按钮、文件树树形控件）。它们不认识系统的任何业务模型。
2. **`features/` & `entities/` 下的局部 UI**: 与特定领域模型紧密绑定的展示逻辑。
3. **`widgets/`**: 页面级业务板块，负责组合 feature/entity UI、承载局部交互和布局。它们不应拥有 RPC 流程、跨领域状态或复杂领域算法；这些应放入 `features/*/model` 或 app facade。例如 `context-workbench` 导出 `ContextWorkbench`，文件名保持 kebab-case，组件标识保持 PascalCase。

### Widget 边界

widget 可以做：

- 布局、分栏、tab、折叠、选中态等局部 UI 状态。
- 把 app facade 或 feature hook 提供的数据传给子组件。
- 轻量格式化和事件转发。

widget 不应做：

- 直接发 RPC 或引用 transport bridge。
- 持有跨领域 server state。
- 实现 tree mutation、projection 排序、provider config 映射等领域算法。
- 为了减少 props 临时创建一个“万能面板状态”。

如果 widget 里出现可单独测试的非渲染逻辑，优先把它移动到对应 `features/*/model`，并补一个最小单元测试。
