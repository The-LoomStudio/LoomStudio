# PromptBuild MessageBlock 实施计划

> **状态**：后端第一阶段已实施，前端消费与旧资源迁移待后续单独处理
> **日期**：2026-08-16
> **范围**：Application Runtime / `@loom/core` PromptBuild 编译语义

## 1. 固化的心智模型

```text
MessageBlock
  ├── Zone       外部来源可见的语义注入锚点
  ├── Slot       一组外部 Entry 的集合
  └── Entry      Prompt 正文原子

Native Slot     保留 Agent Session 的原生 Message 边界
```

`MessageBlock` 不命名资源、不提供外部注入 ID，也不管理子内容的来源。它只是把已经按 Preset 主排序排列好的 Context 编译成一条 Provider Message，并为这条 Message 指定 role。Zone 不再提供 `providerRoleHint`，也不触发相邻同 Role 的隐式合并。

外部来源必须通过 Preset 显式声明的 Zone、Context Slot 或 Binding Entry 进入。未挂载的 active Contribution 直接失败，不回退到任意 Zone。

## 2. 当前后端结构

`CompositionSkeleton.items` 现在支持：

```ts
type CompositionItem = MessageBlockNode | ZoneNode | SlotNode | EntryNode

type MessageBlockNode = {
  kind: 'message'
  id: string
  orderIndex: number
  displayName: string
  role: PromptProviderRole
  items: Array<ZoneNode | SlotNode | EntryNode>
}

type SlotNode = {
  kind: 'slot'
  bindingId: string
  zoneId?: string
  messageMode?: 'context' | 'native'
  slotKey?: string
}
```

`PromptProjectionCapability` 增加可选 `bindingId`，用于把 Runtime Contribution 与 Preset 声明的 Slot / Entry Binding 直接匹配。普通资源仍必须提供 `zoneId`。

默认骨架已经改为：

```text
MessageBlock(system)     preset.system + setting.stable + setting.lower
MessageBlock(developer)  narrative zone + narrative context slot
Native Slot               session.history
MessageBlock(user)       current input binding
MessageBlock(system)     fresh.tail
```

因此，同一个 System MessageBlock 中的多个 Zone 会输出一条 Message；两个显式 System MessageBlock 即使 role 相同也保持两条 Message。Session History 的每条 canonical Agent Message 仍然分别输出，并保留 user / assistant 边界；Current Input 仍是独立的 user Message。

Narrative History 的 `runtime.narrativeHistory` 是可挂载的运行时 Context Slot，不自带 Provider Message 语义。默认骨架将它放在 Developer MessageBlock 中只是官方默认选择；Preset 作者可以把同一个 Slot 放进自己的 MessageBlock，并由该 Block 选择 `system`、`developer`、`user` 或 `assistant` role。Timeline 节点的正文和顺序仍由 Timeline 提供，role 永远由包裹它的 MessageBlock 决定。

## 3. Core Pipeline 实施状态

- `prompt.materialize`：继续由 `@loom/core` 生成并验证 Composition Fragment；保留 Zone 接受来源类型的校验。
- `prompt.order`：继续由 `@loom/core` 排序 Zone 内 Slot 与 Entry。
- `prompt.emit`：新骨架下调用 MessageBlock 编译器，生成按 Block 聚合的 Core message fragments；旧 Zone-only Skeleton 保留兼容路径。
- `compilePromptWithCore`：新骨架输出 `CompiledPrompt.messageBlocks`，`messages` 仅作为 Provider 兼容的扁平视图。
- Provider Adapter 的 API 合法性转换仍是独立步骤；PromptBuild 本身不做相邻同 Role 自动合并。

## 4. 兼容边界

旧的 `skeletonPatch.items` 如果没有任何 `message` 节点，会继续走旧 Zone-only 编译路径，避免把旧 Preset 的平铺结构与新默认 MessageBlock 混合。新建 Preset 使用新的默认骨架。旧资源的持久化迁移、Direct Preset Entry 无 Projection 的完整支持，以及前端 Projection Runlist 的新视图，不在本次后端切片中完成。

## 5. 已验证行为

- System Block 内多个 Zone 编译为一条 Message；
- 同 Role 的两个显式 MessageBlock 不自动合并；
- Narrative / Session / Current Input 的 Runtime Binding 能按主排序进入 Prompt；
- Native Session Slot 保留每条 Agent Message 的原生 role 和边界；
- 未挂载的 active Contribution fail-fast；
- Preview 与 Invoke 共用同一 Core PromptBuild 路径；
- `tests/unit/application-runtime/prompt-build-pipeline.test.ts` 与 `tests/integration/application-runtime/agent-session.test.ts` 定向测试通过。

## 6. 后续非本切片事项

1. 将 Direct Preset Entry 的资源读取从“必须有 Zone Projection”迁移为 `EntryNode.source.preset.nodeId` 直接引用；
2. 将 `CompiledPrompt.zones[]` 消费方逐步迁移到 `messageBlocks` / Composition Projection；
3. 更新前端 Workbench 的 Message 预览与 Zone 包围框；
4. 完成旧 Preset 的持久化迁移和旧类型清理；
5. 增加 provenance 旁路，使最终 Message 预览能回指多个来源而不污染正文。
