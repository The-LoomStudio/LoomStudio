# Content Component / Binding v0

> **状态**：Open Design / Discussion Capture
> **主题**：Setting Layer 内容层的 ECS-like 思想、Prompt Builder 组件模型，以及宏 / 变量注入 / binding 的关系。

---

## 1. 问题

Prompt Builder 已经倾向采用 ECS-like 的中间表示：

```text
Composition Fragment = entity
fragment.meta.components = composition components
Pass = system
Trace / Mutation = system execution record
```

但 Setting Layer 本身也可能需要类似思想。

例如一个角色身上可能有：

- 作者写的角色资料；
- 插件写入的长期记忆；
- runtime 更新的状态；
- AI 写入的关系变化；
- importer 转换来的旧卡字段；
- 用户手动维护的事件目录；
- 插件私有但 prompt-facing 的扩展条目。

这些内容都可能和同一个 subject 相关，例如 `alice`。如果每个模块都维护自己的数据模型和聚合逻辑，后续 prompt projection、排序、上下文复用和 trace 都会变复杂。

---

## 2. 候选分层

当前建议区分两层 ECS-like 模型：

```text
Content / Setting Layer Component Model:
  用来组织内容本体。
  例如角色、记忆、状态、关系、事件、插件贡献内容。

Prompt Composition Component Model:
  用来编译提示词。
  例如 slot、ordering、activation、render、budget、provider compatibility。
```

两层之间通过 projection / source adapter 连接：

```text
Setting Layer entity / entry
  -> projection / source adapter
  -> Composition Fragment
  -> Prompt Builder passes
  -> compiled prompt payload
```

这意味着：

- Setting Layer 可以使用组件化思想组织内容；
- Prompt Builder 也可以使用组件化思想编译 prompt；
- 两者不应合并成同一套 component vocabulary；
- `@loom/core` 仍不理解这些 component 的领域含义。

---

## 3. Setting Layer 中的组件化想法

候选例子：

```text
/characters/alice/profile
/characters/alice/memory/event-001
/characters/alice/state/mood
/characters/alice/plugin/foo/private-note
```

这些可以被视为内容层 entries / entities，并携带若干 component-like 信息：

```text
subject:
  alice

kind:
  profile / memory / state / relation / event / rule

source:
  user / plugin / importer / runtime / ai

visibility:
  prompt-facing / private / ui-only

projection:
  如何投影到 prompt source

lifecycle:
  static / mutable / session-scoped / plugin-owned
```

这些只是方向，不是已接受 schema。

关键目标是：

```text
不同来源、但指向同一个 subject 的内容可以被统一查询、聚合、投影和解释。
```

---

## 4. 与宏 / 变量注入的关系

宏不应成为 canonical data model。

例如：

```text
{{alice.memory}}
```

不应是系统唯一知道 `alice.memory` 的方式。

更稳的方向是：

```text
结构化 entry / component 是 canonical data。
Binding 是可查询、可投影的引用。
宏只是引用 binding 的一种文本语法。
```

也就是说：

```text
{{alice.memory}}
  -> BindingRef(alice.memory)
  -> query Setting Layer
  -> aggregate matching entries
  -> render fragments
  -> trace source entries
```

这样既支持作者在文本中使用熟悉的变量语法，也保留结构化数据的能力。

---

## 5. Scalar Binding 与 Content Binding

需要区分两类 binding。

### 5.1 Scalar Binding

适合简单替换：

```text
{{user.name}}
{{char.name}}
{{alice.currentMood}}
```

它们通常返回一个短字符串、数字或简单值。

### 5.2 Content Binding

本质是 query + aggregation + render：

```text
{{alice.memory}}
{{currentScene.relevantEvents}}
{{party.relationships}}
{{session.summary}}
```

它们不应只是字符串替换。

更合理的执行方式：

```text
Binding definition
  -> query setting/content entries
  -> apply activation / visibility / ordering
  -> render multiple fragments or grouped content
  -> fill prompt slots
```

---

## 6. 与 Prompt Builder 的关系

Prompt Builder 不应直接解析所有 Setting Layer 目录结构。

候选流程：

```text
Binding / Projection:
  从 Setting Layer 查询内容层 entries。

Source Adapter:
  将查询结果转成 Composition Fragment[]。

Prompt Builder:
  对 fragments 做 activation、slot assignment、ordering、render、budget。
```

这样可以避免 Prompt Builder 变成 Setting Layer 的内部实现细节读取器。

---

## 7. 风险

### 7.1 过早组件化

如果 Setting Layer 过早变成完整 ECS，会增加作者和实现者的认知负担。

当前更稳的策略：

```text
只有当多个来源反复需要同一种能力时，才提升为 component-like convention。
```

### 7.2 宏语法掩盖结构

如果所有能力都通过宏表达，系统会失去：

- 目录式查看；
- 细粒度 trace；
- source entry 回链；
- activation / ordering / budget 的可解释性；
- 插件声明式贡献内容的能力。

### 7.3 两套组件模型混淆

Setting Layer component 和 Prompt Composition component 必须区分。

例如：

```text
Setting Layer subject=alice
```

不等于：

```text
Prompt Fragment slot=character.context
```

前者描述内容本体，后者描述 prompt 编译位置。

---

## 8. 开放问题

- Setting Layer 是否采用显式 component bag，还是只采用 component-like convention；
- `SettingEntry` 是否仍是最小原子，还是需要更通用的 `ContentEntry`；
- path / folder / subject / component 之间如何分工；
- Binding definition 存在哪里；
- 宏解析属于 Setting Layer、Prompt Builder，还是独立模板层；
- Content Binding 是否直接产出 fragments，还是先产出 binding result；
- 插件如何声明自己给某个 subject 贡献了内容；
- Trace 如何同时解释 binding query 与 prompt slot filling。
