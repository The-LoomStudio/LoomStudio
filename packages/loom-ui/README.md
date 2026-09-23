# `@loom-studio/ui`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/ui` 是 Loom Studio 的领域无关通用 UI 原语与设计系统组件库。当前由 Studio Client 直接消费；对外 Extension 合同仍由 Extension DX Plan 管理。

## 业务使命与设计系统定位

为了避免在前端各个 Widget 与 Feature 中出现重复实现、视觉不统一的按钮、输入框、弹出层或内联 SVG 图标，本包建立了全仓共享的设计系统基础：
- **通用 UI 原语**：
  - 表单控件：`Button`、`IconButton`、`TextInput`、`Field`、`Checkbox`、`SearchField`、`Toggle`、`LongTextSurface`；
  - 结构与反馈原语：`Dialog`、`SkeletonText`、`StatusIndicator`，以及基于 Radix primitives 的上下文菜单与下拉菜单；
- **图标原语（`src/icon`）**：合并了原 `loom-icons` 基础图标原语（如应用 Logo、工作区图标等），组件内部通用操作图标结合 Lucide；
- **设计 Token 驱动**：组件样式严格消费全局 `--loom-*` CSS 变量（颜色、圆角、阴影、层级）。

---

## 架构规约与红线约束 (Rules & Boundaries)

1. **绝对剥离业务领域语义（Zero Domain Semantics）**：
   - 本包**严禁包含任何 Card、Agent、Narrative、Prompt 或 Session 业务概念**；
   - 它只处理纯粹的 DOM 表现、无障碍语义（A11y）与基础交互事件；
2. **样式隔离与无第三方大包污染**：
   - 依赖 SCSS / 原生 CSS 变量，**严禁引入 Tailwind、CSS-in-JS 或重量级组件库（如 AntD/MUI）**；
3. **环境隔离**：
   - 本包属于前端 UI 组件层，运行于浏览器端 React 19 环境，**严禁被 Node.js 后端服务直接依赖**。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- 基础组件导出：`Button`、`IconButton`、`TextInput`、`Checkbox`、`Field`、`SearchField`、`Toggle`、`LongTextSurface`、`Dialog`、Menu、Skeleton、状态指示器及基础图标原语；
- 样式入口：`@loom-studio/ui/styles.css`；
- 核心类型：各组件对应的 `*Props` 类型契约。

---

## 正式文档

- [Studio UI Architecture 设计规范](../../docs/architecture/ui/README.md)
- [External Dependency Ownership 外部依赖所有权](../../docs/architecture/platform/external-dependency-ownership.md)
- [Client FSD 规范与组件组合](../../apps/studio-client/README.md)
