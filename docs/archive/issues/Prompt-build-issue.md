# PromptBuild 链路代码审查报告

> **状态**：Historical Audit Snapshot / Superseded
> **当前入口**：当前 PromptBuild 事实见 [`docs/architecture/application/prompt-build/`](../../architecture/application/prompt-build/)；后续代码问题以 [`full-repo-code-review-2026-08-27.md`](../../workbench/issues/full-repo-code-review-2026-08-27.md) 为准。
> **最后审计**：2026-08-19（数据层大重构后重审）
> **主要进展**：已落地 MessageBlock 结构与 `provider-payload.ts` 中的相邻 System 消息合并；解耦了 Agent Profile 与 Session 创建；统一了空 Projection Profile。

## 链路覆盖范围

```
useNarrativeRuntime.submitTurn / previewPrompt   (前端 feature hook)
  → StudioApi.agentSessions.invoke / preview
    → ClientBridge → JSON-RPC → application-rpc.ts
      → runtime.invokeAgentTurn / previewAgentTurn
        → prepareAgentTurn()
          → composeAgentTurnPrompt()  (agent-turn.ts)
            → readPromptResourceInputs()  (workspace.ts / prompt-resource-store)
              → collectPromptInputs()
            → compilePromptDataModel()  (prompt-builder.ts)
              → evaluatePromptActivation()  (prompt-activation.ts)
          → buildProviderPayloadPreview()
        → ctx.gateway.invokeChat()
```

---

## 1. 代码异味 / 问题状态

### ✅ [已解决] `compilePromptDataModel` 的 `messages` 输出过滤了空 zone，会生成乱序的 Provider Message

**文件：**
- [`prompt-builder.ts`](../../../packages/application-runtime/src/prompt-builder.ts)
- [`provider-payload.ts` L59-L70](../../../packages/application-runtime/src/provider-payload.ts)

**审查结论：**
- **已在 `provider-payload.ts` 中实现 `mergeAdjacentSystemMessages`**，在转为 Provider Payload 时将连续相邻的 `system` / `developer` 消息自动按双换行合并，解决了多 Provider 对连续 system message 的兼容性限制。
- `prompt-builder.ts` 引入了 `MessageBlockNode`，同 MessageBlock 内的多个 fragment 已在编译阶段完成合并。

---

### 🟡 [已改善 / 部分解决] `composeAgentTurnPrompt` 中"无资源时仍调用 `compilePromptDataModel`"产生无意义的空编译

**文件：** [`agent-turn.ts`](../../../packages/application-runtime/src/agent-turn.ts)

**审查结论：**
- 数据层重构后引入了 `SettingMount` 挂载体系与 `createRuntimePromptSources`，空 profile 已收敛为导出的 `emptyProjectionOrderProfile`。
- 无论有无设定资源，Runtime 消息与当前用户输入均通过统一的 DataModel 进行编译，行为已规范化。

---

**文件：** [`agent-turn.ts` L40-L47](../../../packages/application-runtime/src/agent-turn.ts)

```ts
// resourceIds.length === 0 时的分支
: compilePromptDataModel({
    skeleton: defaultCompositionSkeleton,
    sourceNodes: [],
    contributions: [],
    orderProfile: { id: 'profile.agent-empty', scope: 'global', slotRanks: [] },
    currentInput: input.userInput,
    activationFacts: input.activationFacts,
  })
```

**问题：**
- 当没有任何 `promptResource` 时，用空输入调用 `compilePromptDataModel`，结果必然是 `zones: [], messages: [], editorProjection: { sourceRows: [], promptRows: [] }`。
- 这个分支的唯一目的是提供一个"空 projection"用于 `previewAgentTurn` 的 `projection` 字段，但它浪费了一次 `compilePromptDataModel` 调用（含 `Map` 和 `Set` 分配）。
- `orderProfile` 的 `id` 是内联的 `'profile.agent-empty'`，与另一个内联常量 `emptyProjectionOrderProfile`（在 `prompt-builder.ts` L170）重复定义语义相近但 `id` 不同（`'profile.empty'` vs `'profile.agent-empty'`），造成混乱。

**建议：** 在没有资源时直接返回一个预定义的 `emptyCompiledPrompt` 常量，而不是执行完整的 pipeline；或者将空 profile 常量统一到 `prompt-builder.ts` 中。

---

### 🟡 [中] `readFact` 函数存在优先级二义性

**文件：** [`prompt-activation.ts` L125-L134](../../../packages/application-runtime/src/prompt-activation.ts)

```ts
function readFact(facts: ActivationFacts, path: string): JsonValue | undefined {
  if (Object.hasOwn(facts, path)) return facts[path]  // 优先匹配整体 key

  let cursor: JsonValue | undefined = facts
  for (const part of path.split('.')) {             // 再尝试点路径遍历
    if (!isObject(cursor) || !Object.hasOwn(cursor, part)) return undefined
    cursor = cursor[part]
  }
  return cursor
}
```

**问题：** 若 `facts` 同时含有 `{ 'agent.mode': 'x', agent: { mode: 'y' } }`，`readFact(facts, 'agent.mode')` 会返回 `'x'`（整体 key 优先），而不是走点路径。这个行为是有意的，但没有文档说明，也没有测试覆盖。

另外，`createActivationFacts` 在前端使用了 `'agent.mode'` 这个含点的 key，而不是嵌套对象 `{ agent: { mode: ... } }`，这与"点路径遍历"的设计意图不一致——实际上整体 key 匹配才是真正被用到的路径，点路径遍历是死路。

**建议：** 在 `readFact` 注释中明确说明"整体 key 优先于点路径"的语义；或者统一使用整体 key 格式并删除点路径遍历分支，因为它只会让人误以为支持嵌套 facts。

---

### 🟡 [中] `buildPromptBuildSteps` 前端做了一份与后端近似的 Activation 评估，且两者行为不一致

**文件：** [`build-prompt-build-steps.ts` L114-L123](../../../apps/studio-client/src/features/prompt-build/model/build-prompt-build-steps.ts)

```ts
function settingEntryMatches(entry: JsonObject, input: string): boolean {
  if (entry.enabled === false) return false
  const activation = entry.activation
  if (!isObject(activation)) return true
  if (activation.kind === 'manual') return false
  if (activation.kind === 'keyword') {
    return Array.isArray(activation.keywords) && activation.keywords.some(
      keyword => typeof keyword === 'string' && input.includes(keyword)
    )
  }
  return true  // condition 类型直接返回 true，不评估
}
```

**问题：**
- 这是前端在没有真实 `projection` 时的"预估"显示（用于 UI 在触发预览前就展示大概的 activation 状态），但它与服务端 `evaluatePromptActivation` 的行为不一致：
  - 没有 `caseSensitive` 支持（服务端的 keyword 匹配是大小写不敏感可配置的）
  - `condition` 类型直接返回 `true`，而服务端会真正评估 fact 条件
  - 没有 `all` 类型的支持
- 这意味着前端在"预估激活状态"时会给用户错误的预期，特别是使用了 `condition` 类型的 entry。

**建议：** 明确在注释中说明这是"仅做粗略估算"的前端预览逻辑，不用与服务端完全对齐；或者考虑在每次输入变化时触发一次轻量的 `previewPrompt`，完全依赖服务端结果（但会有性能成本）。

---

### ✅ [已解决] `ensureAgentSession` 隐式创建了一个 hardcoded 的 AgentPreset

**审查结论：**
- 数据层大重构已将 Agent Profile 与 Agent Session 彻底解耦，Session 引用 `agentProfileId` 而非硬编码 Preset，前端不再即时伪造并依赖临时 AgentPreset。

---

### ✅ [已解决] `prepareAgentTurn` 中 `buildId` 被计算但从未使用

**审查结论：**
- `buildId` 目前已作为 `PromptBuildTrace` 的权威追踪 ID 注入结构化日志与 Audit 上下文，具备了清晰的 Tracing 语义。

---

### 🟢 [低] `build-prompt-build-steps.ts` L60 有一个未翻译的硬编码 label

**文件：** [`build-prompt-build-steps.ts` L60, L69-70](../../../apps/studio-client/src/features/prompt-build/model/build-prompt-build-steps.ts)

```ts
{ label: 'Compiled zones', value: ... },         // L60 - 硬编码英文
{ label: 'Core status', value: ... },             // L69 - 硬编码英文
{ label: 'Core passes', value: ... },             // L70 - 硬编码英文
{ label: 'Trace rows', value: ... },              // L71 - 硬编码英文
```

**问题：** 同一个函数里，其他 label 都通过 `t('prompt.label.xxx')` 翻译，但这 4 个 label 是硬编码的英文字符串。在项目整体是中文 UI 的背景下，这 4 条会以英文直接展示给用户。

**建议：** 将这 4 个 label 移入 i18n 文件，或者如果这些是有意保留为"开发者向"的 debug label，在代码里加一个注释说明意图。

---

### 🟢 [低] `mergeByKey` 中 patch 不会覆盖已存在的 zone

**文件：** [`prompt-builder.ts` L422-L431](../../../packages/application-runtime/src/prompt-builder.ts)

```ts
function mergeByKey<T>(baseItems: T[], patchItems: T[], readKey: (item: T) => string): T[] {
  const itemsByKey = new Map(baseItems.map(item => [readKey(item), item]))

  for (const item of patchItems) {
    const key = readKey(item)
    if (!itemsByKey.has(key)) itemsByKey.set(key, item)  // ← 已存在则跳过！
  }

  return [...itemsByKey.values()]
}
```

**问题：** 函数名叫 `mergeByKey`，但实际上是"仅添加不存在的 key"（append-only）。如果 `skeletonPatch` 里提供了同 id 的 zone 意图**修改**它的属性（比如改 orderIndex 或 band），会被静默忽略。

这个行为在 `applyCompositionSkeletonPatch` 的注释里没有说明，调用者可能误以为 patch 可以覆盖已有 zone。

**建议：** 要么改成覆盖语义（`itemsByKey.set(key, item)` 无条件），要么将函数名改为 `appendMissingByKey` 并在注释里说明现有 key 不会被覆盖。

---

## 2. 值得肯定的设计

| 设计 | 说明 |
|---|---|
| **Activation 类型系统完整** | `PromptActivation` 涵盖 always/manual/keyword/condition/all，组合方式通过 `combineActivationGates` 纯函数实现，无副作用，逻辑清晰 |
| **前后端激活数据传递一致** | `createActivationFacts` 在前端生成的 `JsonObject` 和服务端 `evaluatePromptActivation` 消费的 `ActivationFacts = JsonObject` 是同一个类型，接口无缝 |
| **prompt build 日志结构化** | `prepareAgentTurn` 中的 started/completed/failed 三个事件有统一的 `references` 上下文（buildId/runId/sessionId/timelineId），便于 tracing |
| **`collectPromptInputs` 递归干净** | 通过 spread + override 传递 `parentId`/`inheritedCategory`/`inheritedSourceId` 的递归方式正确且无可变副作用（只写 `contributions` 和 `sourceNodes` 两个 push-only 数组）|
| **`updatePromptResourceAssets` 批量操作支持去重校验** | 在 batch update 入口处检查 `assetId` 重复，在操作之前就 fail-fast，不会产生半途状态 |
| **`assertUniquePromptResourceNodeIds` 在写入前校验** | 每次写入 resource 树前都调用 `assertUniquePromptResourceNodeIds`，兜住了 id 冲突这个最常见的树结构错误 |
| **`agentSessionPromiseRef` 防止并发重复创建** | `ensureAgentSession` 用 `ref` 缓存 in-flight promise，保证即使多个 trigger 同时触发也只会创建一个 session，是正确的 dedup 模式 |
