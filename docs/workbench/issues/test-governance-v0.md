# 测试与静态检查债务清单 v0

> **状态**：Open Issues
> **最后核对**：2026-07-23
> **适用范围**：测试、ESLint、TypeScript 与配置文件门禁

本文只记录当前仍存在的检查缺口。测试分类和日常规则以 `docs/guide/testing.md` 为准。

## 已从旧议题关闭

旧版测试治理文档中的主要迁移工作已经完成：

- 测试已按 `unit`、`contract`、`integration`、`regression`、`archive`、`probes` 分类；
- 默认 `pnpm test` 排除 archive 与 probes；
- archive 与 probes 有独立脚本；
- 历史 stage / whitepaper / design spike 已退出默认回归；
- 当前核心 Client、Runtime、Server、Logging 流程已有对应测试目录。

旧版的迁移路径、示例和长篇测试教程已删除，避免把已完成计划继续显示为 Open Issue。

## P0：当前门禁存在盲区

### 1. 根 `tests/` 完全被 ESLint 忽略

`eslint.config.js` 的全局 ignores 包含 `tests/**`。测试中的未使用变量、错误 Promise 处理和类型不安全写法不会进入 `pnpm lint`。

建议先让 ESLint 覆盖 `tests/**/*.ts`，沿用基础规则；不要同时开启大量类型感知规则。

### 2. 根测试没有独立 TypeScript typecheck

根 `tsconfig.json` 只有 project references，各 app / package 的 `tsconfig` 又只 include 自身 `src`。因此 `pnpm build` 不会完整 typecheck 根 `tests/`。

建议增加一个仅包含当前默认测试的 `tsconfig.tests.json`，并提供独立脚本。Archive / probes 是否纳入应单独决定。

### 3. `projectService` 已开启但未使用类型感知规则

ESLint parser 已启用 `projectService: true`，规则集却仍是 `tseslint.configs.recommended`。当前承担了类型项目解析成本，却没有获得 Promise、await 和类型收窄相关检查收益。

处理时二选一：

1. 暂时关闭 `projectService`，保持快速基础 lint；或
2. 为生产源码分阶段启用 `recommendedTypeChecked`，先处理真实报错再扩展到测试。

不要在同一次提交里顺便格式化或重写业务代码。

### 4. 所有 `*.config.*` 都被忽略

ESLint、Vitest、Vite 等配置文件不受 lint。配置数量尚少，可以先改为只忽略生成物，而不是忽略全部配置文件。

## P1：React 专项门禁缺失

当前没有启用：

- `eslint-plugin-react-hooks`；
- `eslint-plugin-jsx-a11y`。

建议分两步引入：

1. 先启用 `react-hooks`，保护 effect dependency 与 hook 调用规则；
2. 修复现有非语义交互元素后，再启用 `jsx-a11y`。

这两项需要新增依赖，不能仅为“规则更全”一次性加入；应各自形成可验证的小提交。

## 本轮明确不做

- 不追求覆盖率数字；
- 不引入新的测试框架；
- 不把 archive / probes 重新塞回默认测试；
- 不一次性开启全部 strict lint rules；
- 不为通过 lint 改写无关业务逻辑。
