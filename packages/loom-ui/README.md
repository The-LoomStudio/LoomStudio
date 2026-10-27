# `@loom-studio/ui`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/ui` 是 Loom Studio 的领域无关通用 UI 原语与设计系统组件库。由 Studio Client 直接消费；同文档 Client Extension 可通过宿主 import map 复用此包与宿主 React 实例，iframe 不继承该共享合同。

## 业务使命与设计系统定位

为了避免在前端各个 Widget 与 Feature 中出现重复实现、视觉不统一的按钮、输入框、弹出层或内联 SVG 图标，本包建立了全仓共享的设计系统基础：
- **通用 UI 原语**：
  - 表单控件：`Button`、`IconButton`、`TextInput`、`Field`、`Checkbox`、`SearchField`、`Toggle`、`Radio` / `RadioGroup`、`Textarea`、`Slider` / `ElasticSlider`；
  - 结构与反馈原语：`Dialog`、`SkeletonText`、`StatusIndicator`，`Tabs` / `UnderlineTabs`、`CommandMenu`，以及基于 Radix primitives 的上下文菜单与下拉菜单；
- **通用操作图标**：组件内部复用 Lucide；应用 Logo 与品牌资产由实际消费者管理；
- **设计 Token 驱动**：组件样式严格消费全局 `--loom-*` CSS 变量（颜色、圆角、阴影、层级）。

普通 `Dialog` 默认使用 `--loom-color-surface`，与工作台共用基础表面；backdrop 与阴影保持弹层区分，不改变菜单或 Toast 的 Raised 表面。`layout: media` 继续使用独立全屏媒体底色。

---

## 架构规约与红线约束 (Rules & Boundaries)

1. **绝对剥离业务领域语义（Zero Domain Semantics）**：
   - 本包**严禁包含任何 Card、Agent、Narrative、Prompt 或 Session 业务概念**；
   - 它只处理纯粹的 DOM 表现、无障碍语义（A11y）与基础交互事件；
2. **样式隔离与无第三方大包污染**：
   - 组件使用原生 CSS 与公共 CSS 变量，**严禁引入 Tailwind、CSS-in-JS 或重量级组件库（如 AntD/MUI）**；
3. **环境隔离**：
   - 本包属于前端 UI 组件层，运行于浏览器端 React 19 环境，**严禁被 Node.js 后端服务直接依赖**。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- 基础组件导出：`Button`、`IconButton`、`TextInput`、`Checkbox`、`Field`、`SearchField`、`Toggle`、`Radio` / `RadioGroup`、`Textarea`、`Slider` / `ElasticSlider`、`Dialog`、Menu、Skeleton、`LoadingText`、状态指示器及上述列表/表单组件；
- 样式入口：`@loom-studio/ui/styles.css`；
- 核心类型：各组件对应的 `*Props` 类型契约。

---

## 外部依赖职责

| 依赖 | 当前能力与入口 |
| --- | --- |
| `react` | 所有组件的渲染、受控状态与生命周期；不建立平行手工 DOM 组件系统。 |
| `@radix-ui/react-context-menu` / `@radix-ui/react-dropdown-menu` | [`context-menu.tsx`](./src/component/context-menu.tsx) 与 [`dropdown-menu.tsx`](./src/component/dropdown-menu.tsx) 的键盘、焦点和菜单基础语义；业务只组合选项。 |
| `cmdk` | [`src/index.ts`](./src/index.ts) 直接导出 `Command` 为 `CommandMenu`；Client 全局搜索复用其列表选择与键盘能力，远端搜索结果由业务提供，不复制通用命令列表。 |
| `lucide-react` | Dialog 关闭、Checkbox 等通用操作图标，避免另绘一套通用 SVG。 |

`Dialog` 自己使用原生 `<dialog>` / Top Layer，不能把其关闭与层级能力归给 Radix。样式由 [`src/styles.css`](./src/styles.css) 与公共 token 拥有，构建复制同一份 CSS；本包没有 SCSS 编译依赖。

## 正式文档

- [Studio UI Architecture 设计规范](../../docs/architecture/ui/README.md)
- [External Dependency Ownership 外部依赖所有权](../../docs/architecture/platform/external-dependency-ownership.md)
- [Client FSD 规范与组件组合](../../apps/studio-client/README.md)

## Dialog 关闭约定

普通 `Dialog` 默认提供右上角关闭按钮、Esc 与遮罩点击关闭，统一调用 `onClose`；内容区点击及从内容拖到外部不会关闭。`closeOnBackdrop={false}` 可禁用遮罩关闭；`dismissible={false}` 同时禁止按钮、Esc 和遮罩退出，用于正在提交或必须明确作答的弹窗。`closeLabel` 可提供本地化的关闭文案。已有自定义关闭工具栏时设置 `showCloseButton={false}`，避免重复出口。


## 工具工作台 Dialog

`layout="workbench"` 提供固定标题栏、视口内约 960 × 680px 的居中容器和无外部滚动的填充内容区。调用方负责内部布局与滚动；标题栏支持 `titleIcon`，底部有内收分割线；遮罩点击、Esc 与关闭按钮沿用普通 Dialog，可显式禁用遮罩关闭。`id` 可连接入口的 `aria-controls`。

可在内部使用普通 Dialog 确认操作。各层使用原生 Top Layer，cancel/close 事件在所属层终止；父层因导航关闭时同时关闭其 DOM 内的子 Dialog。业务请求是否可中断、失败反馈和草稿继续由调用方负责。

Dialog 内的 ContextMenu / DropdownMenu 自动挂载到最近的所属 Dialog，并以其为碰撞边界；普通页面保持默认 Portal，无需业务方传入宿主 DOM。
