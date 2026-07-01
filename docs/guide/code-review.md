# 审查指南 (Code Review)

代码审查不仅是为了找 Bug，更是为了保护系统的架构边界不被腐蚀。当你在审查别人的代码（或审查 AI 助手的生成代码）时，请严格遵守以下防线。

## 架构边界红线 (最重要)

如果一个 PR 触犯了以下红线，无条件要求重构：

1. **Kernel 层被污染**：`packages/kernel` 内部出现了 `chat`, `messages`, `prompt`, `agent` 相关的概念。Kernel 必须保持完全的业务无感知。
2. **反向依赖**：内核包 import 了应用包（例如 `packages/document-store` import 了 `packages/application-runtime`）。
3. **绕过 Runner 访问 Core**：任何非 `packages/loom-runner` 的模块直接 `import { xxx } from '@loom/core'`。
4. **客户端绕过 Transport**：`apps/studio-client` 中存在任何试图跳过 HTTP/WS 接口去直接访问系统文件系统或内核对象的代码。

## 设计意图检查

1. **是否有过度设计？** (KISS 原则)
   - 不要为了"未来可能需要"而添加额外的灵活性抽象。不要抽象只使用一次的逻辑。
2. **错误处理是否合理？**
   - 不要屏蔽不该屏蔽的 Error。
   - 需要向外抛出的 Error 必须在 Transport 边界上具备可序列化能力。

## Client 审查清单

前端改动必须额外检查这些点：

1. **命名是否统一**：源码目录、`.ts`、`.tsx`、`.module.scss` 一律 `kebab-case`；React 组件和类型才使用 `PascalCase`。
2. **widget 是否越界**：`widgets/` 只做页面级组合、布局和局部交互，不直接发 RPC，不持有跨领域 server state，不实现复杂领域算法。
3. **feature 是否承载业务逻辑**：RPC 编排、状态 hook、tree/projection/provider/session 等领域逻辑应在 `features/*/model`。
4. **shared 是否保持纯净**：`shared/` 不 import `features`、`widgets`、`pages`、`app`。
5. **facade 是否继续膨胀**：`app/use-studio-state.ts` 只能组合 feature hooks。新增领域时优先新建或扩展对应 feature hook。
6. **测试是否覆盖抽出的模型逻辑**：非平庸纯函数、排序、映射、树 mutation 至少要有一个最小 runnable check。

如果以上任何一项需要“先暂时这样”，必须在 `docs/workbench/issues/` 写成议题，说明限制、风险和后续关闭条件。

## 零上下文进入项目的 5 分钟检查

在开始改 Client 代码前，先做这五步：

1. 读 `docs/guide/README.md`，确认 Guide 是当前施工入口，workbench 只是议题和历史记录。
2. 读 `docs/guide/project-structure.md` 的 Client 任务路由表，按任务定位 feature / widget / shared。
3. 用 `rg` 验证调用链，而不是从 `app/app.tsx` 或某个 widget 开始猜。
4. 改动前先判断：这是类型、model、UI、widget 组合、API client，还是 app facade。
5. 改动后至少跑任务路由表里的对应 unit test；如果改了 import、文件名、CSS Module 或 app 装配，再跑 client build。

## 代码与文档的一致性

1. 如果新增了或修改了 Kernel/Application 的 RPC，是否同步更新了 `reference/rpc-methods.md`？
2. 如果新增了 Document Type，是否同步更新了 `reference/document-types.md`？
3. 如果改动了 Client 分层、命名或 widget/hook 边界，是否同步更新了 `guide/` 的施工规则或 `workbench/issues/` 的议题状态？

## Git 提交规范

在合并时，我们倾向于 Squash 并附带一条有意义的 Commit Message。格式参考：

- `feat(runtime): add support for projection order profile`
- `fix(kernel): resolve memory leak in event bus`
- `docs(guide): update testing guideline`
