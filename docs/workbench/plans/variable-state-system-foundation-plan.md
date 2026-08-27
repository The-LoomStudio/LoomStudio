# Variable / State System 基础计划

> **状态**：讨论草案；基础边界已初步收束，Revision、Checkpoint、API、RPC、Tool 与 UI 合同待继续讨论
> **日期**：2026-08-25
> **范围**：定义 Loom Studio 的变量、State、Macro、模板、Artifact 携带方式与 SQL 权威边界，为后续 State Store、PromptBuild 接入、Agent Tool 和 UI 编辑器提供共同基础。
> **事实边界**：本文是持续补充的 Workbench 计划，不代表 State Store 已经实现。当前代码只有 `{{User}}` 的有限宏替换，不存在正式的 Global / Timeline State Store、State Template、State Revision 或变量 RPC。

## 1. 当前决策摘要

### 1.1 Macro 只是文本注入方式

Macro 不拥有变量，也不构成独立的变量类型。它只负责在 PromptBuild 处理模型可见文本时读取变量并展开：

```text
Variable Resolver
  -> Macro Renderer
  -> model-visible text
```

原生 Macro 保持只读、单次、无副作用：

- 不在文本中提供 `setvar`、`getvar`、命令 DSL 或时序控制；
- 不在 Preview、Dry Run 或 PromptBuild 中创建、修改 State；
- 同一次 PromptBuild 先冻结变量快照，重复引用得到相同结果；
- 第一阶段只直接展开 string、number、boolean 等标量；
- State 对象需要读取具体路径，或通过后续 State Projection 渲染为 Prompt Fragment。

示例：

```text
{{global.user.name}}
{{global.writingStyle}}
{{timeline.entities.alice.hp}}
```

`{{User}}` 可以作为 `global.user.name` 的第一方易用别名，但不应成为 Parser 内部写死的另一套变量系统。

### 1.2 持久化 State 第一阶段只分两个 Scope

```text
Global State:
  跨 Narrative Timeline 共享。
  不随单个 Timeline 的分支或回退变化。

Timeline State:
  属于一条 Narrative Timeline 世界线。
  随 Narrative 分支、回退和存档变化。
```

`world`、`entities.alice`、`shops.main` 只是 Timeline State JSON 中的路径或对象，不形成新的底层 State 类型。人物、商店等对象可以由模板实例化，但仍保存于同一个 Timeline State Scope。

派生值是计算或更新方法，不是第三种 State。Runtime 时间、当前输入等非持久化值可以通过统一 Variable Resolver 暴露，但不进入 State Store。

### 1.3 Definition、Carrier 与 Value 分离

变量定义不需要拥有独立、面向用户的导出文件。它应跟随实际使用或提供它的 Artifact / Package 携带：

| 携带者 | 携带内容 | 不携带内容 |
|---|---|---|
| Studio 第一方代码 | `User`、真实时间、Locale 等内置定义与 Resolver | 用户私有值 |
| Preset Artifact | Global Variable requirement、Schema、推荐默认值 | Workspace 当前值 |
| Card Bundle | State Template、Timeline Binding、初始值 | 某次游玩后的实时 State |
| Extension Package | 静态定义、模板、计算型 Resolver | Workspace 当前值 |
| Timeline 存档 / 导出 | 当前 State、Revision、Checkpoint | 模板编辑器本身 |

Artifact 中的嵌入 JSON 是便携投影，不是运行时 SQL 权威结构。导入或安装后，Application 将其物化为正式 Definition、Binding 和 State 数据。

### 1.4 插件同时支持声明式与代码式注册

静态 Definition / Template 适合通过 Extension Manifest 内联，或引用插件包内部 JSON 文件：

```json
{
  "contributes": {
    "stateTemplates": [
      { "source": "./states/character-standard.json" }
    ]
  }
}
```

计算型变量必须由代码提供 Resolver，例如真实时间或外部天气。第一阶段不要求插件额外发布独立 `.state.json` Artifact；JSON 文件只是 Package 内部的声明资源。

插件不应在每次 `activate()` 时无条件创建或重置变量。静态 Definition 应让 Host 在执行插件代码前完成校验、冲突诊断和权限检查。

### 1.5 所有写入进入同一个 State Mutation Service

```text
UI RPC ─────────┐
Agent Tool ─────┼─> State Mutation Service
Logic Script ───┘       -> Schema validation
                         -> version / permission check
                         -> apply mutation
                         -> persist revision
                         -> emit Changeset / event
```

Agent 仲裁和 UI 直接执行是产品策略，不应形成两套持久化 Handler。角色扮演型商店可以先把用户行动发送给 Agent，再由 Agent 调用 State Tool；严格规则型商店以后可以通过同一个 Mutation Service 直接执行确定性 Command。

## 2. Definition 与 Template 的初步模型

### 2.1 Global Variable Requirement

Preset 可以声明自己需要某个 Global Variable，但不拥有当前值：

```json
{
  "path": "global.writingStyle",
  "schema": { "type": "string" },
  "default": "自然、简洁"
}
```

导入或启用时的目标行为：

- 已存在且 Schema 兼容：复用现有变量；
- 不存在：使用默认值初始化，或要求用户填写；
- 已存在但不兼容：产生诊断，不静默覆盖。

第一方内置变量不要求每个 Artifact 重复携带 Definition。

### 2.2 State Template 与 Timeline Binding

State Template 使用 JSON Schema 表达对象结构、默认值和约束。Card 或其他 Artifact 通过 Binding 将模板实例挂载到 Timeline State 的某个路径：

```json
{
  "stateTemplates": [
    {
      "id": "character.standard",
      "schemaVersion": 1,
      "schema": {
        "type": "object",
        "properties": {
          "hp": { "type": "number", "minimum": 0, "default": 100 },
          "affinity": { "type": "number", "default": 0 }
        }
      }
    }
  ],
  "timelineStateBindings": [
    {
      "path": "entities.alice",
      "templateId": "character.standard",
      "templateVersion": 1,
      "initial": { "hp": 100, "affinity": 0 }
    }
  ]
}
```

第一阶段采用模板实例化，不提前定义多层继承、Mixin、自动迁移或模板热更新。已有 Timeline 是否跟随模板新版本变化仍是开放问题。

### 2.3 JSON Schema 是便携 Definition；Zod 不是持久化格式

动态、用户可编辑的 Definition 以 JSON Schema 为 canonical 表达，供导入导出、UI 表单、Tool Schema 和跨语言验证使用。Zod 可以用于第一方固定输入和 Definition 外壳的 TypeScript 运行时校验，但不与 JSON Schema 共同成为双份权威。

## 3. SQL 权威边界

### 3.1 不把整个 State Store 压进单个 Document `content_json`

现有 Document Store 每个 Revision 保存完整 `content_json`。它适合低频 Definition / Template，不适合 Timeline State 的高频小修改、分支和 Delta Replay。

当前建议：

```text
Definition / Template:
  低频、可版本化。
  可以使用 Document Store content_json。

Global / Timeline State Value:
  高频、可分支、可回退。
  使用独立 SQL State Store。
```

### 3.2 State Store 的候选最小关系

以下只是讨论骨架，不是已接受 Schema：

```text
state_scopes
  id
  kind                  global | timeline
  owner_id              workspace | narrativeTimelineId
  head_revision_id

state_revisions
  id
  scope_id
  parent_revision_id
  changeset_id
  delta_json
  checkpoint_json?
  created_at
  created_by_json
```

关系、身份、Head、Revision 和索引使用 SQL 列；Schema、Delta、Checkpoint 与任意 State Value 使用 JSON 列。第一阶段不把每个标量变量拆成一条 SQL 行，也不依赖每次读取时扫描完整 Revision 历史。

## 4. 与 Narrative Timeline 的待收束接缝

目标方向是让 Narrative Branch 同时能够定位正文 Head 与 State Head：

```text
Narrative Branch
  narrativeHeadNodeId
  stateHeadRevisionId
```

这允许：

- 只提交正文：Narrative Head 前进，State Head 不变；
- 纯 UI 商店操作：State Head 前进，Narrative Head 不变；
- 正文与状态一起提交：两个 Head 在同一实际事务中前进；
- Narrative 分支或回退：恢复该世界线声明关联的 State Head；
- Agent Session 分支或重试：不自动回退已提交的 Narrative / State。

具体是否直接扩展 Narrative Branch、引入独立 World Head，或通过 Checkpoint 关联，仍待下一阶段讨论。

## 5. 后续讨论顺序

### Phase 0：概念与携带边界（当前已初步收束）

- Macro 只是只读文本展开；
- Global / Timeline 是第一阶段仅有的两个持久化 State Scope；
- Entity 是 Timeline State JSON 中的模板实例路径；
- Definition 跟随 Artifact / Package 携带，Value 进入 SQL；
- 插件静态声明与代码 Resolver 分工；
- UI、Agent、Script 共享 Mutation Service。

### Phase 1：Definition、Template 与 Binding

待讨论：

- Global Variable Definition 与 State Template 是否共用同一种 Definition Schema；
- Preset requirement 的初始化、兼容检查与冲突规则；
- Card Bundle 中 Template / Binding 的正式字段；
- Template identity、version、默认值覆盖和已有实例升级；
- Extension contribution 的 owner、卸载与失效 Resolver 行为。

### Phase 2：Revision、Delta、Checkpoint 与回滚

待讨论：

- Mutation Operation 采用 JSON Patch、领域 Command，还是二者并存；
- State Revision 与 Narrative Node / Branch / Changeset 的关系；
- Global State 与 Timeline State 的 Undo / Redo 差异；
- Checkpoint 生成时机与 Delta Replay 上限；
- 分支、并发 expected revision、幂等键和冲突处理。

### Phase 3：Data Store 与事务

待讨论：

- 最小 SQL 表和索引；
- Definition Document 与 State Store 的跨 Store 事务；
- State Snapshot 的读取与缓存；
- Changeset Operation 如何表达 State Mutation；
- schema migration、删除、孤儿 Template 和插件卸载边界。

### Phase 4：Application API、RPC 与事件

待讨论：

- Query / Snapshot / Mutation / Subscribe 的 Application contract；
- Client RPC 与响应式更新事件；
- UI 手动编辑、批量 Patch、乐观更新和错误展示；
- Extension capability、权限和审计。

### Phase 5：PromptBuild、Macro 与 State Projection

待讨论：

- Variable Snapshot 在 PromptBuild 中的冻结时机；
- Macro parser 的最小 grammar、缺失值诊断和别名；
- State 直接投影到 Preset Slot 的 Source / Renderer；
- State Fact 如何进入 Activation；
- Dry Run、Trace 和变量来源回链。

### Phase 6：Agent Tool、Script 与产品能力

待讨论：

- State read / patch / command Tool；
- 模板是否生成模型可见 Tool 表面；
- Agent 仲裁与 UI 直接执行策略；
- Tool 重试幂等、权限确认与失败 Result；
- 逻辑脚本、商店、状态栏和自定义 UI 的接入方式。

## 6. 当前非目标

- 在 Prompt 文本中实现 `setvar` 或复杂命令式宏；
- 完整兼容 ST 的宏时序、嵌套和副作用；
- 将 State 重新塞进 Setting / Worldbook 条目；
- 为变量强制增加独立的用户导出文件；
- 第一阶段实现模板继承树、ECS、Scheduler 或通用表达式语言；
- 在 Definition、Revision 和 Mutation 合同未收束前直接建设完整变量 UI。

## 7. 当前完成标准

本计划进入实施前，至少需要完成以下设计闭环：

1. 一个 Preset 能声明并解析 Global Variable requirement；
2. 一个 Card 能携带 State Template 与 Timeline Binding，并初始化 Timeline State；
3. UI 与 Agent Tool 能通过同一 Mutation Service 修改 State；
4. Narrative 分支切换能够恢复对应 State Head；
5. PromptBuild 能从冻结快照展开 Macro，并可选择直接投影 State；
6. Definition、Value、Revision、Changeset 和 Artifact 之间只有一份明确权威。
