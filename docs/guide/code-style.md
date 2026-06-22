# 编码规范 (Code Style)

Loom Studio 使用 `eslint` 和 `prettier` 强制执行绝大多数风格。
但是，工具无法替代良好的命名和架构直觉，以下是我们约定俗成的规则。

## 1. 命名规范

- **Types, Interfaces, Classes, React Components**: 采用 `PascalCase`
  - `DocumentRecord`, `StudioServer`, `InputDashboard`
- **Functions, Variables, Methods**: 采用 `camelCase`
  - `submitTurn()`, `isActive`, `handleMessage`
- **Files**: 
  - 非组件的 TS/JS 文件采用 `kebab-case.ts`
  - React 组件的文件采用 `PascalCase.tsx`（与其导出的主组件同名，如 `FileTree.tsx`）
  - CSS 模块采用 `PascalCase.module.css` (与对应的组件一致)

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
4. 样式文件 (如 `./style.module.css`)
