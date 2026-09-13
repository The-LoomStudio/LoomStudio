# LoomStudio 全仓代码审阅（2026-09-12）

> **状态**：Partially Resolved
> **审阅基线**：`main` / `e7683f1cac7bc8d9a59de724f753a765942bd3e7` + 当前未提交工作树
> **范围**：Studio Client、Studio Server、Application Runtime、workspace manifests 与开发工具
> **原则**：只记录有当前调用链或明确依赖证据的问题；不把防御性偏好、文件长度或测试数量本身当作缺陷

## 结论摘要

本轮审阅发现 **4 个 P2、3 个 P3、2 个精简候选**。2026-08-27 全仓审阅中的 FR-001～FR-019 已逐项去重，本文件只记录新的或当前证据发生变化的问题。

| 编号 | 级别 | 结论 |
| --- | --- | --- |
| SEP-001 | P2 | 已修复：批量删除 Session 的部分失败会被本地状态伪装成成功 |
| SEP-002 | P2 | 已验证：Text Transform 的 Override 顺序保留调用方顺序 |
| SEP-003 | P2 | 已修复：Agent Narrative 工具可用节点 ID 跨 Branch 改写历史 |
| SEP-004 | P2 | 已修复：Text Transform 过滤结果可能被原始消息回退重新注入 |
| SEP-005 | P3 | 已修复：`application-runtime` 保留当前未使用的 `@loom/core` 运行时依赖 |
| SEP-006 | P3 | 部分修复：Client 清单包含至少三项静态未使用依赖候选 |
| SEP-007 | P3 | 已修复：`playground` 声明了多项未被入口消费的 workspace 依赖 |
| SEP-008 | 优化 | Session 列表由多个状态源重复维护 |
| SEP-009 | 优化 | 已修复：Provider 刷新 API 名称与实际刷新范围不一致 |

## 已确认问题

### SEP-001 · P2 · 批量删除 Session 的部分失败会被本地状态伪装成成功

`apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx:264-282` 使用 `Promise.allSettled` 执行批量删除，但没有把 rejected 结果反馈给调用方，也没有只清理成功项。删除 RPC 部分失败时，服务端仍保留 Session，而客户端清空选择并移除本地记录，下一次刷新才暴露不一致。

最小修复方向：按结果更新本地状态，只移除成功项；失败项保留选择并显示统一错误。不要要求批量操作全成全败，除非服务端已有事务合同。

### SEP-002 · P2 · Text Transform 的 Override 顺序在投影阶段被二次排序破坏

`packages/application-runtime/src/runtime/transforms-runtime.ts:300-306` 已按 `orderedRuleIds` 生成覆盖顺序，但 `packages/application-runtime/src/transforms/history-text.ts:218-220` 的 `projectHistoryEntries()` 又默认按 `compareRules` 排序。用户保存的规则顺序因此不会成为最终 prompt/display 投影顺序，Override 的核心语义被后续通用排序覆盖。

最小修复方向：让投影函数明确区分“已排序输入”和“需要默认排序输入”；当前 Override 链路应保留调用方给出的顺序，并用一条规则顺序不同于默认排序的用例确认行为。

### SEP-003 · P2 · Agent Narrative 工具可用节点 ID 跨 Branch 改写历史

`packages/application-runtime/src/runtime/agents-runtime.ts:692-700` 的 `editNode()` 只依赖全局 `nodeId` 写入节点。当前 Agent scope 限制了 timeline/branch，但没有在写入前验证目标节点属于当前 branch。若输入或模型获得同一 Timeline 另一 Branch 的节点 ID，可从当前 Agent 上下文跨分支修改历史。

最小修复方向：在事务内重新读取目标节点，校验 timeline、branch 及当前 Agent 允许的写入范围；不满足时返回稳定的冲突/越权错误。

### SEP-004 · P2 · Text Transform 过滤结果可能被原始消息回退重新注入

`packages/application-runtime/src/agents/agent-turn.ts:192-245` 先消费 `projectHistoryEntries()` 的投影结果，随后又遍历原始 `agentMessages`，并以 `sessionText.get(...) ?? message.content` 作为回退。被规则删除或置空的消息没有对应文本时，会再次使用原始内容进入 Agent prompt，绕过 `remove/empty` 语义。

最小修复方向：只消费带有明确 entry-to-content 映射的投影结果；缺少投影内容时保持删除/空值语义，不回退到未经投影的原始消息。

### SEP-005 · P3 · `application-runtime` 保留当前未使用的 `@loom/core` 运行时依赖

`packages/application-runtime/package.json:27` 声明 `@loom/core`，但 `packages/application-runtime/README.md:43` 已说明当前 PromptBuild 使用本包 DFS 编译器，源码扫描也未发现该包消费 Core public API。该依赖增加安装、构建图和升级成本，并使包的架构归属与实际实现不一致。

最小修复方向：从 `dependencies` 和不再需要的 TypeScript reference 中移除；如果未来重新接入 Core，应在真正的调用点出现时再加入。

### SEP-006 · P3 · Client 清单包含至少三项静态未使用依赖候选

`apps/studio-client/package.json` 声明 `@dnd-kit/sortable`、`@dnd-kit/utilities`、`diff`，当前 `apps/studio-client/src` 没有对应 import。`clsx`、`typescript`、`@types/node`、`sass` 也应分别核对构建配置后决定是否保留；其中前三项可直接归入依赖清理候选。

最小修复方向：先用包级 import 扫描和构建配置确认，再删除无调用者的依赖并更新 lockfile；不要仅按名称自动删除可能由配置或插件隐式消费的包。

### SEP-007 · P3 · `playground` 声明了多项未被入口消费的 workspace 依赖

`apps/playground/package.json:10-19` 声明了 9 个 workspace 包，但 `apps/playground/src/index.ts` 的实际入口只消费其中一部分。当前扫描把 `@loom-studio/shared`、`@loom-studio/transport`、`@loom-studio/application-runtime` 标记为未使用候选，导致 playground 的依赖合同比实际入口更宽。

最小修复方向：按入口和动态 import 复核后删去没有调用者的声明；若 playground 计划作为聚合实验入口，应拆成明确的示例入口，而不是把所有运行时包放进单一 manifest。

已完成：删除 `@loom-studio/shared`、`@loom-studio/transport`、`@loom-studio/application-runtime` 及对应 project references；`playground` 类型检查和入口启动烟测通过。

## 精简候选

### SEP-008 · Session 列表由多个状态源重复维护

`apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx:91-124` 合并远端、Narrative 和 Chat 三份列表，`apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts:36-40,457-465` 又维护自己的 Session 列表。排序、删除和刷新因此需要多处同步，容易与已有异步竞态问题叠加。

建议收敛一个权威列表 owner，其余来源只提供派生视图或索引。此项目前是维护成本问题，尚未单独证明新的数据损坏路径。

### SEP-009 · Provider 刷新 API 名称与实际刷新范围不一致

`apps/studio-client/src/features/provider-settings/model/use-provider-settings.ts:46-66` 中 `refreshAiProviders` 实际调用完整的 `refreshAiGatewaySettings`，会连带刷新多个设置域，与 `refreshProviderSettings` 的职责重叠。建议按实际刷新范围拆分或重命名，减少调用者误用和重复请求。

已完成：`refreshAiProviders` 现在只刷新 AI Gateway provider 列表，并删除无独立调用者的重复聚合函数；完整设置刷新仍由 `refreshProviderSettings` 负责。

## 去重与不纳入

- FR-001、FR-003、FR-014、FR-015 等旧审查已覆盖的客户端异步竞态不重复列入。
- Provider/Agent 调用上下文丢失、State 原型污染、Origin/代理安全、跨 Store 原子性等旧问题不重复列入。
- 未把 `@napi-rs/keyring`、`@loom/core` 等动态 import 仅凭静态扫描判为未使用；本轮只把有 README/源码证据的 `@loom/core` 列为候选。
- 未要求新增防御分支、完整测试套件或浏览器视觉验收；实现时只需覆盖上述具体行为。

## 验证记录

- 只读检查：项目结构、现有 Issue 台账、workspace manifests、Vitest 配置、前后端相关调用链。
- 子代理审查：Client 与 Server/Runtime 分域静态审查，均未修改文件。
- 依赖扫描：对 `apps/`、`packages/`、`official/extensions/` 的 TypeScript/JavaScript import 与 manifest 做候选比对。
- 初审阶段未运行全量 build、lint 或 test；本文件不把未执行的检查描述为通过。
- 工作区存在大量哥哥未提交的修改，本轮未覆盖、回滚或格式化这些文件。

实施复核：Client 与 Application Runtime 定向 typecheck、相关文件 ESLint 和 `git diff --check` 通过；Extension storage lifecycle 与 RPC registration 测试 8/8 通过；Playground 类型检查、入口启动烟测和文档链接检查通过。Client 全量测试仍有 4 个未触碰的 `studio-layout-store` 既有契约失败，未归因于本轮改动。

## 可执行实施方案

### 实施原则

先修复会改变数据正确性或权限边界的功能问题，再做依赖和状态精简。每个批次只处理同一类风险，保留现有 RPC、持久化和用户可见语义；结构性瘦身按照 [`code-slimming-audit-2026-09-12.md`](./code-slimming-audit-2026-09-12.md) 的 Batch 0～3 执行，不与本文件的功能修复混成一个提交。

### 实施步骤

#### Batch 1：Prompt 与 Agent 正确性

**定位**：`agents-runtime.ts:692-700`、`agents/agent-turn.ts:192-245`、`runtime/transforms-runtime.ts:300-306`、`transforms/history-text.ts:218-220`。

**实现**：

1. 在事务内校验 `editNode` 的 timeline、branch 与 Agent 写入范围。
2. 让投影结果携带明确的 entry-to-content 状态；删除或置空的内容不得回退原始消息。
3. 保留调用方给出的 Override 顺序，禁止投影层再次默认排序。

**验证**：跨 Branch ID、删除/置空消息、非默认规则顺序各增加或复用一个最小行为用例；运行 application-runtime 相关定向测试和 typecheck。

#### Batch 2：客户端结果与投影语义

**定位**：`sessions-panel.tsx:264-282` 以及 SEP-002 对应 Transform 调用链。

**实现**：批量删除只移除成功项，失败项保持可重试状态并显示现有错误反馈；不引入全成全败事务假设。

**验证**：混合成功/失败删除、全失败和刷新后恢复三种路径；确认服务端未删除项不会在客户端永久消失。

#### Batch 3：依赖与状态精简

**定位**：SEP-005～SEP-009 及其 manifest、动态 import、配置和 project references。

**实现**：先完成静态候选复核，再删除确认无调用者的依赖；Session 列表和 Provider 刷新职责只在确认行为等价后收敛。

**验证**：相关 workspace install、定向 typecheck、受影响 Client 测试；依赖删除不得以环境版本错误冒充源码通过。

### Task List

- [x] 修复 Agent 跨 Branch 写入边界；`agents-runtime.ts` 在编辑前校验当前 branch 的节点归属。
- [x] 修复 Transform 删除/置空结果被原始消息回退的问题；缺少投影内容时不再回退原始消息。
- [x] 保留用户指定的 Transform Override 顺序；现有顺序覆盖用例通过。
- [x] 修复批量删除的部分失败状态表达；客户端只清理成功项并保留失败选择。
- [x] 复核并清理确认无调用者的依赖；已清理 Client `@dnd-kit/sortable`、`clsx`、`diff`，迁移 `typescript`，移除 Application Runtime 的 `@loom/core`，并删除 Playground 三项无调用者的 workspace 依赖。
- [ ] 在行为等价前不合并 Session 或 Provider 状态源。
- [x] 将已完成验证结果和环境阻塞分别记录；全仓测试中的既有失败、Node 版本不匹配和媒体测试默认超时未冒充为本次回归。

### 停止条件

若需要改变服务端事务合同、持久化 schema、RPC method、权限模型或用户可见规则顺序，停止当前 issue 批次并重新确认；这些变化不能作为普通 bug 修复隐式带入。
