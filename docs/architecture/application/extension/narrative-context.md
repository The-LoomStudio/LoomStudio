# 默认剧情上下文来源

默认剧情投影由记忆来源提供已采用的 Memory 与 Raw 范围；PromptBuild 不判断何时总结，也不为每个 Agent Session 保存一份剧情投影。专项采样仍直接调用 Narrative 采样接口，不借 Anchor 传参。

## 来源合同

服务端扩展声明 `narrative.context.provide: true`，通过 `ctx.narrativeContext.register(provider)` 注册。ID 必须使用扩展包命名空间，注册随实例卸载或激活失败自动释放。SDK 类型为 `NarrativeContextProvider` 与 `NarrativeContextProjection`。

Host 为角色安装生成独立本地 Provider ID。Runtime 根据实际 Timeline 的来源 Card 筛选可用来源，预览与 Session 交接使用同一归属；不会调用其他 Card 的私有 Provider。全局来源仍可参与选择，多个可用来源同时返回投影依然报冲突。仅存在其他角色的来源时，当前角色视为没有配置来源，而不是“已配置但无人选择”。公开角色扩展安装仍在接线，此合同不代表整个角色代码权限边界已经完成。

`resolve({ timelineId, branchId })` 是只读操作，可被 Preview 多次调用。它返回该分支**已经采用**的结果；准备中的摘要和插件私有进度不返回。插件自行持久化并选择服务哪些分支。返回 `undefined` 表示该来源不服务这个分支，而非空正文。

```ts
{
  version: "summary-1",
  memory: {
    coveredThroughNodeId: "node-32",
    entries: [
      { id: "plot", content: "1～32 楼的剧情摘要" },
      { id: "entities", content: "这一覆盖范围内需要保留的实体事实" }
    ]
  },
  rawThroughNodeId: "node-40"
}
```

这是默认主剧情的连续前缀合同：`memory` 整体声明覆盖至节点 32，Raw 采样范围为 `(32, 40]`。摘要内部的分层、条目组织与版本管理归来源，不由平台推断各条文本的真实覆盖质量。

- `memory: null` 表示没有摘要覆盖，Raw 从分支起点开始。
- `rawThroughNodeId: null` 明确表示没有默认 Raw；不把空值解释成最新原始 Head。
- 两者均为空允许显式发布空基线。正文仍可持久化、存在于 Session 工具历史或被主动采样。
- 一个来源可以返回多条记忆；其他 Setting 也可独立贡献到记忆锚点。不将“多个文本贡献”混同于“多个默认范围所有者”。
- 同一分支若有多个来源同时返回默认视图，明确报冲突，不按注册顺序覆盖。已注册来源但均不服务所请求分支时也明确报错，不临时追随最新 Head。

接收端校验版本、条目身份、内容和明确终点，并通过共用采样器验证 Memory 边界、Raw 起止节点属于请求的分支路径且顺序合法。预算不能容纳整个 Raw 时拒绝构建，不把截断结果伪装成完整默认范围。

记忆内容原样进入 `@memory.narrative`；Raw 复用现有 prompt 正则加工后进入 `@chat.narrative`。不执行正文 State 宏，不改变权威正文，不伪造 Session 原生消息。Preset 决定包裹角色和位置。Trace 记录来源、版本及覆盖 / Raw 终点；版本本身不写入消息正文，也不冒充 Provider 缓存标识。

## 主动读取与授权

默认被动 Raw 为 `(memory.coveredThroughNodeId, rawThroughNodeId]`，不包括有效 Head 之后的新正文。主 Agent 主动读取的默认区间则为 `(memory.coveredThroughNodeId, 本次读取捕获的原始 Head]`，允许补读新剧情。两者不共用一个会自动推进的 Head。

宿主通过公开的 `createNarrativeReader({ store, context, timelineId, branchId })` 创建主动读取入口。`context` 是已经向 Runtime 提供的 `NarrativeContextRegistry`，不另存一套边界。每次 `sample(request, signal?, approveHistory?)` 重新读取已采用的覆盖声明与当前 Head，随后固定这一次读取的终点；未配置来源时返回 `narrative.context_unconfigured`，不把旧宿主的最近 100 节点策略当作读取授权。

底层 `createNarrativeSampler(store, allowedRange)` 接受**宿主参数** `NarrativeReadRange`：

```ts
const sampler = createNarrativeSampler(store, {
  timelineId, branchId,
  afterNodeId: node32, // exclusive
  throughNodeId: node45, // inclusive; null explicitly grants an empty range
})
const sample = await sampler.sample({
  timelineId, branchId,
  selection: { kind: 'tail', count: 1000 },
  maxNodes: 8,
})
```

该请求最多取得 33～45 的一个有界尾页；下一页仍须经过同一个宿主范围检查。`count` 是范围内最多读取的数量，不是扩大权限的授权。显式越界起止 ID、错误分支、倒置区间和伪造续读返回 `narrative.read_out_of_range`；范围参数不会从 Agent 的请求对象读取。`complete` 及 `nextBeforeNodeId` 只描述授权范围内的剩余数据，不返回越过下界的续读入口。固定范围采样的 `readHeadNodeId` 为宿主固定的上界，不暴露更晚的节点。

不传第二个参数的底层采样器、`runtime.sampleNarrative` 仍是可信宿主接口，不能直接当作无授权的 Agent 入口。Run 的 `ToolExecutionScope.narrative.sample` 已改用有界 reader；原文 / prompt 加工选择不改变权限。

### Tools 审批接线

主动请求越过默认区间时，reader 交给正在执行该工具的 `ToolRuntimeRegistration.approve` 处理。沿用 `ToolApprovalHandler` 和 `allow / deny` 决定，不维护永久 grant 或 Session 权限副本。新增 `ToolApprovalContext.action` 的形状为：

```ts
{
  kind: 'narrative-history-read',
  timelineId, branchId,
  selection: { kind: 'tail', count: 1, throughNodeId: node5 },
  maxNodes: 1000,
  maxCharacters: 2000000
}
```

- 工具本身的执行审批没有 `action`；读取旧正文的审批有上述 `action`，不能把“允许执行 CodeAct”当成“允许所有旧正文”。
- 没有处理器时拒绝这项 action，即便同一工具原本可以执行。已有处理器须检查 `action`：返回 `allow` 就明确批准该次请求；不能忽略 action 后无条件放行。
- 授权绑定本次已捕获的 Timeline / Branch / 请求终点 / 选择 / 预算。允许后仍校验上界和分支，不包括等待期间追加的正文；审批回调改写收到的对象也不能扩大实际请求。下一页或后续调用重新审批，不自动记住整段历史权限。
- 处理器收到 `signal`，等待交互时必须响应取消；返回后宿主再次检查取消，不返回旧正文。拒绝通过失败 Tool Result / CodeAct 错误返回，不自动重试。
- Tool Registry 在执行作用域绑定实际工具的处理器，不接受脚本传入“已授权”标志或任意放行函数。

**UI 接线（2026-09-24）**：官方 Content/JSON CodeAct 注册通过 `approve` 将历史读取 action 交给宿主 `onHistoryReadApproval`；没有宿主处理器仍拒绝。Run 发布独立的 `history-read-approval-requested` 事件，客户端用 `application.agent.run.history-read-approval` 答复。弹窗显示 Timeline、Branch、固定选择和预算，不展示未授权原文，也不伪造资源修改 Diff。答复按请求类型匹配，一次消费，取消后失效。CodeAct 将等待控制传至 Registry，仅在历史审批等待期间暂停墙钟计时，不把整个采样调用排除在执行预算之外。弹窗人工视觉验收未完成。

## 消费接口

无需 Session 的宿主可直接取得默认声明，并选择是否加工：

```ts
const published = await contextRegistry.resolve({ timelineId, branchId })
if (!published) throw new Error('No Narrative context source')
const raw = published.rawThroughNodeId === null ? undefined : await runtime.sampleNarrative({
  timelineId, branchId,
  selection: {
    kind: 'range',
    afterNodeId: published.memory?.coveredThroughNodeId,
    throughNodeId: published.rawThroughNodeId,
  },
  processing: { phase: 'prompt', presetId },
})
if (raw && !raw.complete) throw new Error('Default Narrative range exceeds the budget')
```

省略 `processing` 返回原文；提供它则复用已有规则解析与 `projectNarrativeSample`，也可用 `consumerAgentSessionId` 选择现有 Session 的规则，但不能同时指定 Preset。结果保留来源节点 ID、`body.raw`、加工后的 `text`、规则版本及诊断，不写回 Narrative。Preset 继续分别编排 Memory 与 Raw 的锚点，调用方不应再建立一套摘要 / 正文排序系统。

同范围同规则的主动读取与被动贡献共用 `projectNarrativeNodes`；这里的“一致”以同一个采样窗口为单位。正则 depth / position 相对于本次窗口，分别加工多页再拼接不保证等于整段加工，不能冒充同一窗口。

## 工作交接

Runtime / RPC 的 `completeAgentSessionHandoff({ agentSessionId, expectedEntryCount, summary, branchId? })` 接收**已经写好的工作交接文本**，不自行调用模型、不决定总结阈值。它执行：

1. 用 Transcript 计数 CAS 追加一条独立 `work-summary` 事实。在持久化事务内拒绝仍在运行 / 暂停的 Run、尚无结果的工具调用、空文本及过期计数。
2. 后续 Prompt 不再投影该记录之前的工作段，将最新交接文本放入 `@memory.session`。原 Transcript 不删除；新 Session 不继承另一 Session 的工作摘要。
3. 对绑定 Timeline 的 Session，在提交成功后通知所选来源的可选 `onSessionHandoff`。参数包含确定的 Timeline / Branch、Session、交接 Entry ID，以及通知前捕获的原始正文 Head。

记忆来源可以在该通知中发布已准备好的摘要及缓冲 Raw。以 1～40 楼为例，第 32 楼的摘要准备不调用采用入口；第 40 楼交接后才发布 Memory 1～32 + Raw 33～40。回调只采用已有结果，不等待后台生成；没有准备好就保持原发布记录不变。原始 Timeline Head 不由此修改。

Session 交接提交与插件发布是**两个独立提交**。回调失败时返回已提交的 Session / Entry / Changeset，另报 `memoryNotification.status: "failed"`；不抛出一个暗示全部回滚的错误，不自动重试。`notified` 只证明回调完成，不证明插件一定发布了新版本。来源须使用自己的存储事务 / 版本检查保留发布状态，平台不回滚其私有写入。无回调或无绑定 Timeline 时返回 `not-configured`。

当前分支上多个 Session 读到同一个已发布剧情视图，通知不会清理其他 Session 的工作历史。插件跨分支继承、废弃未来的摘要处理及切换策略仍归来源；非法节点不能通过接收端检查。

## 当前边界

- 官方记忆插件默认自带且可替换是已确认产品方向；本接口不包含官方摘要算法、安装 / 默认启用、楼层调度或自动生成交接文本。测试中的生产者不冒充已交付的官方插件。
- 完全未注册来源的旧宿主被动 Prompt 仍暂用最新 100 节点，并产生 `narrative.context_unconfigured` 诊断。此路径是待迁移实现，不是新设计的无插件兜底，也没有基线冻结保证。主动 Tool reader 不继承该回退，缺来源时明确失败。接好官方来源后才能移除旧被动路径。
- 固定节点范围不等于不可变正文快照。低层原地编辑的内容版本、摘要失效、插件选择 UI、Token 容量兜底与实际模型缓存验收尚未完成。
- 自由文档式记忆可以经 Setting 注入锚点；自动让 Agent 声明覆盖 / 更新 Raw 范围属于后续能力，不从文本内容猜测边界。

## 验证入口

- `tests/integration/application-runtime/narrative-context.test.ts`：真实 SQLite、40 次工具写入、32 楼准备与 40 楼交接发布、41 楼保持基线、重开数据库、新 Session、冲突 / 非法范围、失败回调、过期交接和工具安全边界。
- `tests/contract/extension-host/narrative-context.test.ts`：真实扩展实例注册、能力 / 命名空间检查、卸载及激活失败清理。
- `tests/integration/studio-server/session-handoff-rpc.test.ts`：HTTP RPC 输入检查、交接保存、旧 Transcript 保留及新 Prompt。
- `tests/integration/application-runtime/narrative-read-access.test.ts`：1～45 楼的被动 / 主动范围差异、245 节点跨页有界续读、失效来源、Tools 审批缺失 / 拒绝 / 允许、取消、等待期间追加与授权对象改写；两种真实 CodeAct 工具循环中不泄漏旧正文、不改变被动前缀。
- `tests/integration/application-runtime/narrative-projection.test.ts`：无 Session 加工、来源节点及原文保留、规则顺序与主动 / 被动一致。

这些测试使用脚本化 Gateway，不证明自动总结质量、后台调度或真实 Provider 缓存命中。
