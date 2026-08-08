# Isolation Scope Boundary v0

> **状态**：Open Design
> **主题**：Narrative Timeline、Agent Session、Run、Card Source 与本地 Binding 的隔离边界。
> **迁移说明**：旧稿将 Session 同时作为剧情实例和对话隔离边界；本文拆开这两个所有权。

---

## 1. 核心原则

隔离边界应跟随数据所有者，而不是让一个 `Session` 容纳所有运行时状态。

```text
Narrative Timeline owns:
  story tree / active narrative head / story-world checkpoints

Agent Session owns:
  agent work tree / active agent head / runs / steps / transcript policy

Card / Asset Source owns:
  distributable author content

Local Binding owns:
  provider / model / permissions / local overrides

Changeset records:
  applied changes across owned documents
```

---

## 2. Narrative Timeline 隔离

每条 Narrative Timeline 是独立的剧情世界线容器。

默认不共享：

- Narrative nodes 和 branch heads；
- 与世界线绑定的动态状态版本；
- checkpoint / save 标记；
- 仅对该世界线有效的 overlay。

同一 Card 可以初始化多条 Narrative Timeline，但后续演进默认隔离。共享 Card Source 不意味着共享运行时状态。

---

## 3. Agent Session 隔离

每个 Agent Session 有独立的：

- Agent Preset 选择；
- 本地 Binding 引用；
- Session Tree、branch 和 head；
- Run / Step；
- Transcript archive 与 projection policy；
- suspended continuation；
- 临时候选和工作状态。

两个 Agent Session 可以连接同一 Narrative Timeline，但不能直接读写彼此的内部 Step 或候选。若需要协作，应通过显式 Agent 调用、共享 Context Source 或受控结果引用。

---

## 4. Binding 不是所有权

```text
Agent Session
  -> binds Narrative Timeline
  -> binds allowed Assets / Context Sources
  -> uses Local Binding
```

Binding 只表达当前工作目标和可访问范围：

- 不把 Narrative 节点复制进 Agent Session；
- 不把 Agent Step 嵌入 Narrative Timeline；
- 不让 Narrative 回退自动改变 Agent head；
- 不让 Agent 分支自动改变 Narrative head；
- 不让 Agent Session 获得目标对象的无限读取权限。

切换 binding 后，旧 Context Projection 立即失效。Runtime 必须基于新目标、版本和权限重新构造上下文。

---

## 5. Card Source 与运行时演进

Card、Agent Preset、Setting Asset 等可分发 Source 不应被运行时默认直接污染。

```text
Source:
  作者发布和复用的内容。

Runtime-owned document / overlay:
  某条 Narrative Timeline 或编辑任务中的演进状态。
```

Agent 修改 Source 必须使用明确的编辑能力和 Changeset，而不能因为它正在使用该 Card 就自动获得写权限。

运行时演进是否能够 promote 回 Source，应是显式用户操作，并保留 diff、版本校验和冲突处理。

---

## 6. Run 与 Step Scope

Run 是 Agent Session 内的执行边界，Step 是树中的推进节点。

```text
Agent Session Scope:
  多个 Run 和整棵工作树。

Run Scope:
  本次执行的预算、取消信号、临时候选和 continuation。

Step Scope:
  单次输入、输出、工具动作、等待或提交事实。
```

Run 结束后，临时 provider payload、stream buffer 和未提交 candidate 可以释放；持久 Step、Changeset 引用和必要 Trace 按策略归档。

---

## 7. Context Scope

Agent 能看到的内容由 Context Projection 决定，不等于所有绑定对象的全集。

至少应区分：

- current Agent Session path；
- current Run working set；
- selected Narrative branch projection；
- active Setting / State sources；
- recent or selected Changesets；
- explicit user pin；
- Extension-granted Context Sources。

未激活、不可搜索或无权限的世界书条目不能因为处在同一 Card、Timeline 或 Workspace 中就被 Agent 读取。

---

## 8. Changeset 与隔离

Changeset 可以跨多个 owned documents 描述一次逻辑修改，但不能取消各领域的所有权。

```text
Changeset coordinates history.
Owning domain validates and writes data.
Document transaction determines atomicity.
```

Undo Changeset 时必须重新检查：

- 当前版本是否仍以该 Changeset 为可撤销祖先；
- 后续 Changeset 是否依赖它；
- 是否包含不可逆外部副作用；
- 是否会跨越当前 Narrative 或 Agent Session binding；
- 用户是否拥有所有目标的写权限。

---

## 9. 分支隔离

### Narrative Branch

隔离剧情世界线和与其绑定的世界状态。它不拥有 Agent Transcript head。

### Agent Session Branch

隔离编辑尝试和执行状态。它不拥有 Narrative head，也不自动撤销已应用 Changeset。

### Changeset History

记录真实持久化演进，可被两种树引用，但自身不等于其中任何一棵树。

三者必须通过显式引用关联，禁止依靠相同 branch name 或数组位置做隐式对齐。

---

## 10. Kernel 与 Provider 边界

Kernel 只提供 Document、RPC、Event、Trace 等通用能力，不认识 Narrative Timeline 或 Agent Session 的领域语义。

Provider Adapter 只消费编译后的 payload，也不拥有 Session、权限或 Context Projection。

Application Runtime 负责：

- 解析 binding；
- 执行 Context Projection；
- 推进 Run / Step；
- 调用领域写入 API；
- 关联 Changeset；
- 在提交成功后发出领域事实。

---

## 11. 当前实现与迁移边界

当前代码仍将旧 Session 作为多领域聚合点。本文只记录目标所有权，不授权立即重命名 Schema 或迁移存量数据。

迁移前需要先确认：

- Narrative Timeline 是否完全取代旧游玩 Session；
- 哪些状态真正属于世界线；
- Agent Session Tree 的最小持久化模型；
- Changeset 与现有 Document version / transaction 的映射；
- RPC 和 Client 当前依赖的旧 Session 语义。

---

## 12. 开放问题

1. Workspace 是否需要拥有跨 Timeline 的共享慢变量？
2. Narrative Timeline 初始化时如何引用 Card Source 版本？
3. Agent Session 同时绑定多个目标时如何表达 active target？
4. 多 Agent Session 并发修改同一目标时使用乐观版本还是串行队列？
5. Changeset undo 如何处理已经被后续 Narrative checkpoint 引用的状态？
6. Agent Session 删除后，Changeset 的 source provenance 保留到什么程度？
