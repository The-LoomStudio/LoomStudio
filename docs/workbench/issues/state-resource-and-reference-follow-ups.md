# State 资源与引用检查后续

> **状态**：Open / Backlog
> **优先级**：P2
> **创建时间**：2026-09-09
> **当前基线**：State v1 核心运行链已经晋升至 Architecture；本文只跟踪不阻塞当前运行能力的作者资源与检查体验。

## 结论

State v1 已经覆盖 Card / Extension Contribution、Entity / Component 初始化、软引用、Timeline 冻结、Revision / Branch / Undo、统一 Mutation、Agent Tool 与宏消费。以下两项不继续留在已完成 Plan 中，也不阻塞其他模块推进。

## STATE-FOLLOW-001 · 独立 State Artifact 资源链

当前已存在 `kind: "loom.state"`、`schemaVersion: 1` 的交换格式、校验器和 Card Bundle 内嵌能力，但资源池尚未提供独立 `airp.stateArtifact` Document CRUD，Card 也没有通过稳定 Artifact ID 选择、冻结和恢复该资源的完整链路。

关闭条件：

- 资源池能够创建、读取、更新和删除独立 State Artifact；
- Card 通过稳定资源引用选择 Artifact，并在 Timeline 创建时冻结精确版本；
- Card Bundle 导入导出和 Dev Workspace 打包解包能够保持引用或内嵌恢复；
- 缺失资源、版本冲突和重复 Contribution identity 明确失败，不建立第二套 State Store。

建议归属：File-backed Resource / Dev Workspace 模块。

## STATE-FOLLOW-002 · 运行态软引用检查

初始化物化已经能够识别 `x-loom-entity-ref` 并生成 unresolved 诊断，Timeline Runtime Context 也会冻结引用字段元数据；当前 Client / RPC 尚未消费这些元数据，运行期 Mutation 后也没有重新计算并展示引用诊断。

关闭条件：

- Runtime Inspector 能识别软引用字段并定位目标实体；
- 目标缺失时能够基于当前 Snapshot 重新计算并展示 unresolved 诊断；
- 检查保持只读，不引入级联删除、强外键或第二份引用权威数据。

建议归属：Runtime State Inspector 后续体验，不与 ECS Query、投影 DSL 或引用所有权捆绑实施。

## 非目标

- ECS System 调度、Trait Query、响应式自动挂载和组件生命周期；
- 引用级联删除、垃圾回收、跨 Timeline 强引用；
- State Prompt 投影 DSL、Pin、记忆系统或脚本沙箱。
