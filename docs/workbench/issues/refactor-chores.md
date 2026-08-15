# 待处理架构重构任务 (P1-P3)

> **状态**：Active Backlog / Event Catalog Foundation Partially Implemented
> **边界**：本页只记录尚未进入具体计划的治理任务。事件 Definition Registry 与 Extension 事件权限边界已经落地；通用外发目录、能力发现面和 Application Runtime 模块化仍待后续决策。

本文件记录了在 Loom Studio 开发过程中需要逐步落地的三项重要架构治理“杂活”任务，后续可以根据优先级安排实施。

---

## 1. [P3] Application Runtime 目录的领域切片拆分

### 目标与背景
目前 `packages/application-runtime/src/` 下的文件都集中平铺在根目录。其中 `runtime.ts` 已经累积了超过 30KB（800+行）的代码，包含了 cards、sessions、timeline、providers 等多个领域，极大地增加了维护和重构的难度，违反了“单文件不应超过 300 行且承担多个领域”的架构规则。

### 改造内容
- [ ] 在 `application-runtime/src/` 下按领域划分目录：
  - `cards/`
  - `sessions/`
  - `prompt/`
  - `agents/`
  - `providers/`
  - `runs/`
  - `timeline/`
- [ ] 将业务逻辑、commands 和 queries 分类拆分到对应子目录的文件中，禁止领域间直接导入内部非公开文件。
- [ ] 将根目录的 `runtime.ts` 瘦身为纯 Facade（仅做依赖注入和业务接口暴露）。

---

## 2. [P1] 完善统一 Capability Registry (能力发现面)

### 目标与背景
根据架构设计规则，所有的 RPC、events、document types 应该能在一个统一的发现面（Introspection Surface）中被发现。目前 kernel 提供的 `system.introspect` 仅返回了极简的方法列表，不包含 application-level RPC、renderer RPC 等其他外围能力，也缺少参数/返回值的 schema 描述。

### 改造内容
- [ ] 设计统一的 `RpcCapability` 注册元数据（包含 `name`、`owner`、`namespace`、`stability`、`description` 等）。
- [ ] 让 Application RPC、Renderer RPC、Extension RPC 都接入这个统一的发现面，而不用在 server 中通过硬编码前缀分支进行旁路分发。
- [ ] 丰富 `system.introspect` 的返回结构，为生态开发者和 DevTools 提供无源码发现平台能力的基础。

---

## 3. [P2] 建立规范的 Event Catalog (事件目录)

### 目标与背景
Kernel 已具备 Event Definition Registry、owner / visibility / capability / payload 等基础元数据，但跨端外发目录和领域事件审计仍未完成。基础事件（如 `docs.changed`）仍不能被当做具体领域事件滥用。

### 改造内容
- [x] 为 Kernel / Extension public events 建立首版定义元数据与注册边界。
- [ ] 将现有定义面扩展为可供通用 Transport 和 DevTools 消费的 Event Catalog。
- [ ] 明确划清 `docs.changed`、`diagnostics.updated` 与各领域层专属事件的边界。
- [ ] 保证 WebSocket 和 SSE 等投递机制能够基于 Event Catalog 的元数据安全、受控地向外发布。
