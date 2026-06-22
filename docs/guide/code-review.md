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

## 代码与文档的一致性

1. 如果新增了或修改了 Kernel/Application 的 RPC，是否同步更新了 `reference/rpc-methods.md`？
2. 如果新增了 Document Type，是否同步更新了 `reference/document-types.md`？

## Git 提交规范
在合并时，我们倾向于 Squash 并附带一条有意义的 Commit Message。格式参考：
- `feat(runtime): add support for projection order profile`
- `fix(kernel): resolve memory leak in event bus`
- `docs(guide): update testing guideline`
