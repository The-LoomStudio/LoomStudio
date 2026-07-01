# 编码规范 (Code Style)

Loom Studio 使用 `eslint` 和 `prettier` 强制执行绝大多数风格。
但是，工具无法替代良好的命名和架构直觉，以下是我们约定俗成的规则。

## 1. 命名规范

- **Types, Interfaces, Classes, React Components**: 采用 `PascalCase`
  - `DocumentRecord`, `StudioServer`, `InputDashboard`
- **Functions, Variables, Methods**: 采用 `camelCase`
  - `submitTurn()`, `isActive`, `handleMessage`
- **Files**:
  - 所有源码文件采用 `kebab-case`，包括 React 组件文件与 CSS Modules。
  - ✅ `file-tree.tsx`, `input-dashboard.tsx`, `app.module.scss`
  - ❌ `FileTree.tsx`, `InputDashboard.tsx`, `App.module.scss`
  - React 组件内部标识仍采用 `PascalCase`，例如 `export function FileTree() {}`。
- **Wire / Schema Fields**:
  - 外部协议、第三方 API、数据库字段、JSON schema 字段保留原始命名。
  - 例如 OpenAI 的 `max_tokens`、`finish_reason` 不为了统一风格强行改成 camelCase。
  - 内部 TypeScript 变量和函数仍使用 `camelCase`，只在边界映射处保留 `snake_case`。

命名形态边界：

| 对象                      | 规则                    | 示例                                           |
| ------------------------- | ----------------------- | ---------------------------------------------- |
| 源码目录                  | `kebab-case`            | `context-assets/`, `studio-client/`            |
| 源码文件                  | `kebab-case`            | `use-studio-state.ts`, `context-workbench.tsx` |
| SCSS Modules 文件          | `kebab-case.module.scss` | `file-tree.module.scss`                         |
| React 组件 / 类型 / class | `PascalCase`            | `ContextWorkbench`, `CreateCardInput`          |
| hook / 函数 / 变量        | `camelCase`             | `useStudioState`, `createStudioApi`            |
| 外部协议字段              | 保留协议原样            | `max_tokens`, `finish_reason`                  |

新增文件时不要复制 React 生态常见的 `PascalCase.tsx` 文件名习惯。本仓库的规则是：文件名描述模块，组件名描述导出标识。

## 2. 导出与入口

- 所有的 Package (`packages/`) 必须使用统一的入口点 `src/index.ts` 向外暴露它允许外部使用的类型和函数。
- **绝对禁止 Deep Import**:
  - ❌ `import { foo } from '@loom-studio/kernel/src/internals'`
  - ✅ `import { foo } from '@loom-studio/kernel'`

## 3. TypeScript 准则

- 避免使用 `any`，如果不得不规避类型检查，请使用 `unknown` 并辅以类型守卫 (`type guards`)。
- 当声明一个具有明确业务边界的对象格式时，优先使用 `type`，对类的声明使用 `interface`。

## 4. 依赖引入的顺序

我们建议按照如下顺序分组你的 `import`：

1. 第三方 Node / Npm 包 (如 `react`, `lodash`)
2. 绝对路径的 Monorepo 包 (如 `@loom-studio/shared`)
3. 相对路径导入的本包其他模块 (如 `./utils`, `../types`)
4. 样式文件 (如 `./style.module.scss`)
