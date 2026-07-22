# PromptBuild 可观测性计划

> **状态**：Draft / Discussion Capture
>
> **主题**：PromptBuild 的生命周期日志、详细 Trace、前端解释视图和敏感数据边界。
>
> **依赖**：[日志与可观测性总计划](README.md)

---

## 1. 定位

PromptBuild 的目标不是输出大量普通日志，而是让一次构建可以被解释和复现到足够程度。

用户应能回答：

- 当前 Source Set 包含什么；
- 哪些 facts / signals 参与了本次 Activation；
- 哪些 entry / slot / zone active 或 inactive，原因是什么；
- 内容为什么投影到某个 Injection Group / Zone / Slot；
- Resolution 为什么选择、合并、替换或压制某个 contribution；
- 最终顺序来自 rank、order hint 还是 source tree fallback；
- 哪些 Transform / Render / Loom Core Pass 执行过；
- 最终 compiled payload 与 source document 如何关联；
- 哪些内容被裁剪、隐藏或脱敏。

PromptBuild Trace 是 Application Layer 的解释模型，不应退化为 Kernel Log，也不应要求 Loom Core 理解 Card、Setting Layer、Agent 或 Runtime 语义。

---

## 2. 当前基础

当前代码和文档已经存在以下基础：

- Prompt Preview 可以返回 `promptBuildTrace`；
- Prompt Projection 已包含 sourceRows、promptRows、Zone、Slot、Fragment 与 orderSource；
- Client Inspector 可以展示原始 PromptBuild Trace JSON；
- Activation 已区分持久化作者配置 `enabled` 与本次求值结果 `active`；
- Prompt Builder 文档已要求解释 Source、Activation、Projection、Resolution + Order 四层。

仍缺少：

- 稳定的 PromptBuild Trace envelope；
- 生命周期摘要 Log 与详细 Trace 的边界；
- inactive item、raw prompt、facts snapshot 的保留策略；
- 多次 build 的 diff 与关联方式；
- 前端正式解释 UI，而不只是原始 JSON。

---

## 3. Log 与 Trace 的边界

系统 Log 只记录 PromptBuild 生命周期摘要：

```text
prompt.build.started
prompt.build.completed
prompt.build.failed
```

候选摘要字段：

```text
buildId / traceId
sessionId / branchId / runId
workspaceId
sourceCount
activeCount / inactiveCount
fragmentCount / messageCount
durationMs
diagnosticCount
correlationId / callId
```

详细内容进入 PromptBuild Trace：

- Source Set 与 source refs；
- facts / signals snapshot；
- Activation Report；
- Projection Report；
- Resolution Report；
- Ordering Report；
- Transform / Render / Core Pass Report；
- compiled payload summary；
- Diagnostic refs；
- redaction metadata。

普通 Log 不保存完整 prompt、完整 Setting 内容、完整 ToolResult 或完整 provider payload。

---

## 4. PromptBuild Trace 候选阶段

### 4.1 Build Envelope

记录本次构建的身份与总体状态：

```text
buildId
status: running | completed | failed
startedAt / completedAt / durationMs
correlationId / callId
sessionId / branchId / runId
workspaceId
modelProfileId?
```

这些字段是候选 trace envelope，不代表已接受的公共 API。

### 4.2 Source Set

记录 Runtime 为本次 build 显式选择了哪些 source：

- Composition Skeleton / Preset；
- Setting Layer projection；
- Narrative projection；
- 当前 Runtime input；
- 当前 Run Transcript projection；
- Dynamic Context Mount / Fresh Read Tail；
- Plugin contribution；
- Global scope / memory 等其他明确 source。

Trace 应优先保存 source ID、document version、source kind、数量和摘要，不默认复制完整正文。

### 4.3 Facts / Signals Snapshot

Activation 必须基于冻结快照求值：

```text
keyword hits
vector matches
runtime facts
state facts
manual pins / overrides
plugin signals
```

Trace 需要说明本次用了哪一份 snapshot，但敏感状态值可以只保存摘要、hash、范围或 redacted value。

### 4.4 Activation Report

每个可控目标至少需要解释：

```text
target id / kind / source
enabled
active
matched / unmatched conditions
signal / fact refs
manual override
reason
```

要求：

- inactive 结果可以被查询；
- Activation 不修改 source 配置；
- 关键词、向量、runtime fact、state fact、manual pin 和 plugin signal 共享同一解释入口；
- Activation failure 只有在规则无效、数据损坏或能力缺失时才升级为 Diagnostic；普通条件不匹配不是 warning。

### 4.5 Projection Report

解释内容如何进入结构：

```text
source contribution
injectionGroupKey
zoneKey
slotKey / source-scoped slot
anchor
lifecycle
projection fallback
```

资源树的位置不是 Prompt 最终位置。Trace 必须区分 Source Tree 与 Prompt Projection。

### 4.6 Resolution + Ordering Report

Resolution 与排序分开解释：

```text
Resolution:
  selected / merged / replaced / suppressed
  semanticSlotKey
  policy
  competing contribution refs

Ordering:
  final position
  rankKey / slotOrderHint / entryOrderHint / sourceTreeFallback
  stable tie-break reason
```

不能继续让 order 字段同时承担冲突处理语义。

### 4.7 Transform / Render / Emit

记录：

- binding / macro 是否解析成功；
- transform rule / pass 是否执行；
- Loom Core pass 名称、状态和耗时摘要；
- fragment 如何变成 compiled payload segment；
- provider capability hint 是否触发兼容性 Diagnostic；
- emit 后的 message / content part 数量。

Provider Adapter 的真实网络调用不属于 PromptBuild Trace；它属于 Agent Run / Provider Trace 与 Audit。

---

## 5. 内容与隐私边界

本节继承总计划的“metadata-only by default”规则。Source、Card、Preset、Session 的用户自定义显示名属于私密元数据，不进入普通 PromptBuild 生命周期日志；Inspector 可以在当前权限下通过 source / document reference 临时解析显示。

默认策略：

- Log 不保存 raw prompt；
- Trace 默认保存 source refs、摘要、长度、hash 和必要片段；
- 完整 Prompt Preview 只在用户主动查看、明确 debug 模式或现有 Run Document 已授权保存时展示；
- Secret、Authorization header、API key、credential、受保护插件数据必须在进入 Log / Trace 前脱敏；
- 大型 ToolResult、二进制内容和附件只保存 asset / document reference；
- Trace 的 redaction 结果本身应可解释，例如显示 `redacted: secret`，而不是静默缺字段。

暂不承诺通过 Trace 完整重放 Provider 请求。可解释性优先于保存所有原始内容。

---

## 6. 前端展示需求

PromptBuild Inspector 应从原始 JSON 展示逐步演进为四层解释视图：

```text
1. Source
2. Activation
3. Projection
4. Resolution + Order
```

补充视图：

- Build summary：状态、耗时、source / active / fragment / message 数量；
- Pipeline：Source Set -> Activation -> Projection -> Resolution -> Render -> Emit；
- Active / Inactive 切换；
- 按 source、zone、slot、rule 搜索；
- 点击 compiled payload segment 跳回 source document；
- 点击 Diagnostic 跳转 Diagnostics；
- 点击 buildId / correlationId 跳转关联 Agent Run；
- 后续可以支持两次 PromptBuild 的 diff，但不进入第一阶段。

通知策略：

- Preview / Build 失败时显示靠近操作位置的 error；
- 后台 build 持续失败或能力降级时可以通知；
- 普通 inactive entry、fallback ordering 和正常裁剪不产生 Toast；
- successful build 默认不为每次输入弹 success Toast。

---

## 7. 实施阶段

### Phase PB-1：Trace Envelope 与摘要日志

- 为现有 `promptBuildTrace` 增加稳定 envelope；
- 写入 started / completed / failed 摘要 Log；
- 贯穿 buildId、traceId、correlationId、runId；
- 保持现有 Prompt Preview public shape 尽量不变。

> **部分实施状态（2026-07-22）**：摘要日志已接入 `previewPrompt` 与 `submitTurn` 共享构建边界，使用 `prompt.build` namespace，并贯穿 buildId、correlationId、callId 与可用的 runId。当前没有修改 `promptBuildTrace` public shape，也未建立 traceId 或专用 Inspector，因此 PB-1 尚未整体完成。

折叠行 message 直接表达 mode、messageCount 与 duration，例如 `runtime prompt build completed · 7 messages · 11.08 ms`；引用 ID 与完整结构化字段仍保留在 data，不要求 Viewer 解析 message。

验证：一次 build 可以从系统 Log 跳转到完整 PromptBuild Trace。

### Phase PB-2：Activation / Projection 正式报告

- 统一 active / inactive / reason；
- 记录 frozen facts / signals snapshot refs；
- 解释 Injection Group、Zone、Slot 和 orderSource；
- UI 不再依赖解析任意 message 文本。

验证：用户可以回答“为什么这个条目出现 / 没出现、为什么在这里”。

### Phase PB-3：Resolution / Render / Redaction

- 增加 resolution decision；
- 增加 transform / render / emit 摘要；
- 增加统一 redaction metadata；
- 限制大型正文与 payload 的默认持久化。

验证：Trace 能解释选择、合并、覆盖与输出，而不会泄露 Secret 或无限膨胀。

### Phase PB-4：正式 Inspector

- 实现分层解释 UI；
- 支持 source / compiled segment 双向定位；
- 支持按 build / run / correlation 关联查询；
- 评估 build diff。

验证：常见 Prompt 问题不需要开发者阅读原始 JSON 或后端 stdout 才能定位。

---

## 8. 非目标

- 不把 PromptBuild Trace 变成普通 Log 数组；
- 不把 Runtime loop、Tool dispatch、commit policy 塞入 Prompt Builder；
- 不要求 Loom Core 理解 Application Source / Slot / Agent 语义；
- 不默认保存完整 raw prompt 和 Provider request body；
- 不把 inactive condition 当作错误；
- 不在第一版实现完整规则引擎或 Trace 查询语言。

---

## 9. 待确认事项

1. inactive targets 默认保存全部、仅保存摘要，还是按 debug level 保存；
2. facts / signals snapshot 的脱敏粒度；
3. 完整 Prompt Preview 的持久化位置和保留期；
4. PromptBuild Trace 是否继续随 Run Document 保存，还是进入独立 Trace Store；
5. build diff 是否需要稳定 fragment identity；
6. budget trimming 与 token estimate 进入哪个阶段；
7. Provider capability diagnostics 与 PromptBuild Trace 的引用协议。

相关文档：

- [Prompt Builder 领域文档](../../discussion/application/prompt/README.md)
- [Prompt Builder 设计哲学](../../discussion/application/prompt/prompt-builder-philosophy-v0.md)
- [Trace / 可解释性](../../discussion/application/trace-explainability-v0.md)
- [Composition Pipeline](../../discussion/application/composition-pipeline-v0.md)
