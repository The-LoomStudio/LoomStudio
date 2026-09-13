# AI 代码维护注释规范与补注计划

> **状态**：Ready for execution
> **日期**：2026-09-13
> **目标**：为后续人类与 AI 维护者补充稳定、可核对、解释设计意图的英文代码注释，不把注释变成逐行翻译或另一套过时文档。

## Thought

当前仓库并非完全没有注释。源码中已经存在约百处注释，主要集中在 `ponytail` 限制标记、文件系统/事务边界、媒体交互和局部状态说明；但没有统一的“什么值得注释”标准。现有注释还混合了中文、英文、阶段标题和代码复述，导致真正重要的决策上下文容易被普通说明淹没。

AI 生成代码尤其需要保留以下信息：为什么不能采用更简单的实现、某个顺序或状态不变量是什么、失败后哪些数据必须保留、兼容逻辑何时可以删除，以及当前实现明确接受了什么限制。普通的字段映射、简单 CRUD、显而易见的 React JSX 和类型定义不需要补注释。

本计划只补“决策注释”和必要的公共 API TSDoc，不借注释机会重构业务代码，不以注释数量作为完成指标。

## 已确认事实

- `docs/guide/code-style.md` 目前没有注释规范，主要规定命名、导出、类型和依赖顺序。
- `docs/guide/code-review.md` 已要求检查架构边界、错误语义和 Client 分层，但没有要求逐行注释。
- `docs/guide/testing.md` 要求回归测试注释说明“以前为什么错”和复现步骤，说明注释应服务于行为合同，而不是解释语法。
- 当前高价值注释主要使用 `ponytail` 标记真实的容量、兼容或升级限制；普通设计说明多使用英文短句，局部旧代码仍使用中文。
- `docs/workbench/plans/extension-developer-experience.md` 已提出为 Extension SDK 的公共接口补充 TSDoc，但尚未形成范围和验收标准。

## 注释规则

### 应该注释

1. **Invariant**：调用方看不出、但修改后会破坏数据或顺序的内部不变量。
2. **Why**：看起来可以删除、合并或改写，但因为协议、事务、兼容或浏览器语义而不能这么做的决策。
3. **Failure semantics**：失败时为何保留部分状态、为何不能回退、为何要把错误继续抛出。
4. **Compatibility**：旧版本、旧字段、旧路径或旧客户端为何仍在边界保留，以及清理条件是什么。
5. **Boundary contract**：跨包、RPC、Extension、文件系统和第三方 Provider 边界中，类型本身无法表达的约束。
6. **Ponytail limit**：实际存在的容量、性能或暂时性启发式限制，必须说明原因和升级路径。

### 不应该注释

- 复述变量名、函数名或下一行代码的注释。
- 给每个 `map`、`filter`、`if`、JSX 区块或普通 getter 添加说明。
- 只写“临时”“以后优化”但没有触发条件、证据或升级方向的 TODO。
- 用注释掩盖模糊命名、过长函数、重复逻辑或错误的状态所有权。
- 为了统一语言机械翻译现有有效注释；只有在修改附近或语义明显混乱时才顺手统一。

### 语言与格式

- 代码注释和 TSDoc 默认使用简洁英文，便于编码 AI 直接消费；用户可读的完整设计解释继续放在中文 Markdown 文档中。
- 注释优先放在产生决策的位置，避免在调用链上下游重复描述同一事实。
- 一条注释原则上不超过两句；复杂规则拆成条目或提炼为命名良好的函数。
- `ponytail` 只用于真实限制，不用于普通设计说明。格式保持现有风格：

```ts
// ponytail: [reason for the current limit]; upgrade to [next mechanism] when [trigger].
```

- 公共 SDK、跨包类型和可被扩展作者直接调用的接口使用 TSDoc；内部实现优先使用行内短注释，不批量为所有导出符号生成模板文档。

## 补注范围

### Batch 0：建立注释清单

**定位**：`packages/application-runtime/src`、`apps/studio-server/src`、`apps/studio-client/src`、`packages/extension-sdk/src`。

**实现**：

1. 按上述六类规则逐文件标记候选点，记录文件、符号、缺失的决策上下文和推荐注释类型。
2. 将已有注释分为有效、代码复述、过时/待核对三类；不因为数量少就扩大注释范围。
3. 优先选择修改后最容易被 AI 误删或误改的代码，不为普通业务流程建立注释清单。

**验证**：清单中的每个候选都有源码证据；无法说明“删掉注释会造成什么误解”的候选直接排除。

### Batch 1：后端和运行时边界

**定位与建议内容**：

- `packages/application-runtime/src/prompt/prompt-build-pipeline.ts`：树遍历顺序、Virtual/Entry 节点合并、fallback 的优先级和角色继承不变量。
- `packages/application-runtime/src/runtime/extensions-runtime.ts`：Extension package version 不自动迁移、墓碑资源恢复和 origin 唯一性的原因。
- `packages/application-runtime/src/cards/workspace.ts`、`cards/card.ts`：严格 Bundle 校验与兼容归一化为何必须分开；source artifact 版本与规范化版本为何可能不同。
- `packages/application-runtime/src/runtime/agents-runtime.ts`、`agents/agent-turn.ts`：Agent scope、Branch 所属校验、投影内容缺失时不得回退原文的失败语义。
- `packages/application-runtime/src/foundation/pagination.ts`、`foundation/document-store.ts`、相关 Runtime：cursor 起点、页序反转和“调用方负责领域过滤”的边界。
- `apps/studio-server/src/platform/atomic-json.ts`：临时文件、权限、rename 和清理顺序的持久化意图；不声称具备 power-loss atomicity。
- `apps/studio-server/src/resource-directories/card-directory.ts`、`runtime/card-directory-sync.ts`：canonical path、并发快照和不可回滚的文件/数据库边界。
- `apps/studio-server/src/rpc/rpc-params.ts`：公共 primitive reader 的拒绝语义；领域 handler 仍负责业务结构校验。

**实现约束**：只在已有复杂分支旁补 1～2 句英文注释；不通过注释替代类型、校验或事务代码，不新增运行时抽象。

**验证**：Application Runtime、Studio Server 定向 typecheck；运行 Prompt、Extension、Bundle、Agent、分页、目录和 RPC 相关已有测试；逐条核对注释没有声称比实现更强的事务或安全保证。

### Batch 2：Client 状态与交互边界

**定位与建议内容**：

- `apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx`：远端、Narrative、独立 Session 合并的来源优先级，以及批量删除部分失败时成功项/失败项的状态语义。
- `apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts`：可选 transcript 刷新失败为何保留已持久化消息，Narrative append-only 草稿限制。
- `apps/studio-client/src/app/use-studio-state.ts`：只保留跨领域组合边界的区块说明；删除仅用于导航的标题式注释，不给每个 hook 返回值写注释。
- `apps/studio-client/src/shared/ui/asset-workbench-layout/asset-workbench-layout.tsx`、`master-detail-workbench.tsx`：移动端 pane 所有权和受控/非受控行为，只有在代码无法从 Props 看出时补充。
- `apps/studio-client/src/shared/ui/media-viewer/image-viewer.tsx`、`long-text-editor/code-mirror-change-tracking.ts`：浏览器事件和性能限制类现有注释只在语义准确时保留。

**实现约束**：不为 JSX 层级、按钮行为、普通状态 setter 和 CSS 类名增加注释；UI 注释只记录浏览器行为、异步竞态或状态所有权。

**验证**：Client 定向 typecheck、相关 model/unit 测试和必要的 client build；人工抽查注释是否仍与受控 Props 和状态流一致，不进行纯视觉验收替代代码验证。

### Batch 3：公共 Extension SDK 与协议入口

**定位**：`packages/extension-sdk/src`、`packages/extension-sdk/extension-host/src`、`apps/studio-client/src/shared/api/studio-api.ts` 中对外暴露的类型和动态 Extension RPC 边界。

**实现**：

1. 为 Extension capability、注册 API、RPC context、storage scope 和公共错误合同补充最小 TSDoc。
2. 说明动态 Extension RPC 的 namespace/capability 前提，不把任意 method 写成普通业务 API。
3. 对 `studio-api.ts` 只保留领域分区的职责说明；不靠 TSDoc 掩盖 DTO 重复和过宽 facade，DTO 拆分仍由原代码瘦身 Plan 负责。

**验证**：SDK 与 Client 定向 typecheck/build；检查生成的 `.d.ts` 可读且没有重复模板文档；现有 Extension Host/RPC 契约测试通过。

## Task List

- [ ] 建立候选注释清单，按 Why、Invariant、Failure semantics、Compatibility、Boundary contract、Ponytail 分类。
- [ ] 在 `docs/guide/code-style.md` 增加简短的英文代码注释规范和反模式说明。
- [ ] 补充 Application Runtime 与 Studio Server 的高风险边界注释。
- [ ] 补充 Client 状态所有权、异步失败和浏览器行为注释。
- [ ] 补充 Extension SDK 公共接口的最小 TSDoc。
- [ ] 清理确认过时、复述代码或与实现矛盾的注释。
- [ ] 对每个批次执行对应的定向 typecheck、lint 和高价值已有测试。
- [ ] 更新本 Plan 的实际改动、未补注释项、验证结果和剩余风险。

## 完成条件

- 所有新增注释都能回答“为什么这里不能直接用更简单的写法”，或明确记录一个无法从类型表达的合同。
- 没有为了达到注释数量而给普通 CRUD、JSX、映射和 getter 添加噪音。
- `ponytail` 注释都有真实限制、原因和升级触发条件；没有把临时限制描述成长期保证。
- 公共 SDK TSDoc 与实际运行时行为一致，未扩大安全、事务或兼容承诺。
- 相关源码 lint、定向 typecheck 和已有高价值测试通过；未执行的完整测试不描述为通过。

## 非目标与停止条件

- 不要求全仓每个函数都有注释，不把注释覆盖率作为质量指标。
- 不在本 Plan 中拆分 `studio-api.ts`、`useStudioState`、Runtime 类型或其他架构问题。
- 不因为英文注释风格而批量改写已有中文文档或用户可见文本。
- 如果补注过程中发现实现本身需要改变公共契约、事务语义、权限边界或持久化格式，停止补注并回到对应代码 Plan，不用注释掩盖该问题。

## 预期影响

代码运行行为、RPC method、持久化格式和用户界面均不应改变。主要收益是减少后续 AI 误删关键边界、错误合并分支或重新引入已修复问题的概率；主要成本是少量维护性文本，并需要在相关实现变化时同步更新注释。
