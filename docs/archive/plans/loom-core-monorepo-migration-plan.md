# Loom Core Monorepo 迁移计划（已归档）

> **状态**：Archived / Complete
> **归档日期**：2026-07-23
> **归档原因**：迁移已经完成，当前架构由 [`docs/architecture/application/prompt-build/loom-core/`](../../architecture/application/prompt-build/loom-core/) 维护。
> **日期**：2026-07-13
> **源仓库**：`/Users/macbookair/Desktop/LoomProject`
> **源 commit**：`25b0c5b8d26517a1dfff7fa0fb06a8e003131861`
> **目标目录**：`packages/core`

## 1. 目标

将 `@loom/core` 从外部 LoomProject 仓库迁入 LoomStudio pnpm workspace，使 Studio 的开发、测试、构建和运行不再依赖同级目录，同时保持：

- package name 仍为 `@loom/core`；
- public exports 与 Core v0.1 行为不变；
- Core 原有严格类型检查、Trace Schema 和 47 项测试不丢失；
- Core 仍是独立 package，不与 `loom-runner` 或 Application Runtime 合并；
- Studio 通过 package public API 使用 Core，不 import Core internal path。

## 2. 迁移范围

迁入：

```text
LoomProject/packages/core/package.json
LoomProject/packages/core/tsconfig.json
LoomProject/packages/core/tsconfig.build.json
LoomProject/packages/core/src/
LoomProject/packages/core/test/
```

不迁入：

```text
LoomProject/packages/core/dist/
LoomProject/node_modules/
LoomProject/poc/
LoomProject/packages/stdlib/
LoomProject/examples/
LoomProject/.git/
```

`@loom/stdlib`、examples 与旧仓库归档方式另行决定。本次迁移完成前不删除 LoomProject。

## 3. 当前耦合点

- `packages/loom-runner` 使用外部 `file:` dependency；
- `packages/application-runtime` 使用外部 `file:` dependency，并在 PromptBuild pipeline 中直接使用 Core；
- `vitest.config.ts` alias 到 `../LoomProject/packages/core/src/index.ts`；
- `pnpm-lock.yaml` 持有外部 directory resolution；
- 当前 Core dist 使用无扩展名 ESM 相对 import，Node 无法直接加载。

## 4. 实施步骤

1. 导入 Core 的 tracked source、test、Schema 与 package 配置；
2. 保持 Core 独立的 Bundler TypeScript 配置和严格检查；
3. 将 Core 源码内部相对 import/export 改为 `.js` specifier，使构建产物可被 Node ESM 加载；
4. 将两个消费者改为 `@loom/core: workspace:*`；
5. 将 Vitest alias 改到 `./packages/core/src/index.ts`；
6. 让 Studio 根 build 先执行 Core package build；
7. 由 Core 自己声明 Trace Schema 测试所需的 AJV 8；
8. 运行 `pnpm install` 更新 lockfile；
9. 更新当前有效的 package map、依赖图和 Core dependency 文档；
10. 完成定向与全量验证。

## 5. 架构边界

迁移只改变物理仓库位置，不改变 Core 的职责：

```text
@loom/core
  -> 同步 Fragment / Pass / Pipeline / Trace / Mutation / Owner tracking

@loom-studio/loom-runner
  -> Kernel/RPC 面向 JSON 的 Core adapter

@loom-studio/application-runtime
  -> PromptBuild 领域 pipeline；当前直接使用 Core public API
```

当前允许 `loom-runner` 与 `application-runtime` 两个后端 package 依赖 Core。Kernel、Document Store、Extension Host、Client 和 Extension 仍不得直接依赖 Core。

## 6. 验证门槛

```bash
pnpm install
pnpm --filter @loom/core typecheck
pnpm --filter @loom/core test
pnpm --filter @loom/core build
node --input-type=module -e "import('@loom/core')"
pnpm build
pnpm test
pnpm lint
git diff --check
pnpm why @loom/core
```

完成判据：

- Core 6 个测试文件、47 项测试通过；
- Studio 默认测试全部通过；
- `@loom/core` 解析为 workspace link；
- Node 能直接加载 Core dist；
- 非历史文档与运行配置不再引用 `/LoomProject/packages/core`；
- 外部 LoomProject 未被破坏或删除。

## 7. 完成记录

迁移已于 2026-07-13 完成：

- `@loom/core` 已迁入 `packages/core`；
- `loom-runner` 与 `application-runtime` 已改为 `workspace:*`；
- pnpm 将两处依赖解析为 `link:../core`；
- Vitest alias 已改为仓库内 Core source；
- Core 内部 ESM specifier 已补齐 `.js`，Node 可直接 import 构建产物；
- Core 在 Studio TypeScript 6 下完成一处只读数组窄化兼容；
- Core 原 6 个测试文件、47 项测试全部通过；
- Studio 全量 50 个测试文件、204 项测试全部通过；
- `pnpm build`、`pnpm lint` 与 `git diff --check` 通过；
- 外部 LoomProject 保持原状，仅保留其原有未跟踪 `.vscode/`。
