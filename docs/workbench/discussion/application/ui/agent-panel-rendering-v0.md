# Agent Panel Rendering v0

> **状态**: Open Design
> **主题**: Agent 面板内的文本、Artifact、ToolCall 和交互卡片如何渲染，以及它与 Narrative 正文渲染的统一边界。

---

## 1. 问题

默认 AIRP UI 至少有两类渲染 surface：

```text
Narrative 正文:
  面向沉浸阅读。主要渲染剧情文本、局部样式化片段、inline artifact 和少量消息动作。

Agent 面板:
  面向工作流。主要渲染 Agent 工作对话、工具调用、工具结果、选择卡、批准/应用/重试等可执行操作。
```

二者都可能需要自定义渲染：

- 剧情正文中的 `<特写>...</特写>`；
- Agent 面板中的自定义 TC / 工作日志格式；
- Agent 返回 `<choice>...</choice>` 后渲染成四个按钮；
- ToolCall / ToolResult 渲染成可交互面板；
- CodeAct / Artifact / 小型可视化结果渲染成 inline block 或 sandbox iframe。

问题不在于能不能用正则替换 HTML，而在于：

```text
如何让文本处理、渲染和交互过程透明、可追踪、可禁用，并给插件留下稳定 hooks。
```

---

## 2. 当前结论

底层可以共享 Semantic Part registry 和投影接口，但 Markdown 只处理普通正文：

```text
Narrative raw source
  -> Semantic Block Parser
  -> TextSegment -> built-in Markdown renderer
  -> SemanticPart -> registered surface renderer
```

但表层需要按 `surface` 区分策略：

```text
narrative:
  偏展示、沉浸、样式化、inline artifact。

agent-panel:
  偏工作流、工具状态、选择、确认、可执行 action。

tool-result:
  偏结构化结果、日志、diff、preview、错误详情。

custom-renderer:
  偏完整界面接管，由独立 renderer 决定最终表现。
```

一句话：

```text
统一 display pipeline，不统一 UI 语义。
展示型内容走 artifact，行为型内容优先走 structured event / ToolCall。
```

---

## 3. Source of Truth

最终渲染分块不应成为持久化正文。Narrative Semantic Projection 可以作为可重建派生数据持久化，但不是第二份 canonical 正文；完整正文 Schema 见 [`../narrative-timeline-content-schema-v0.md`](../narrative-timeline-content-schema-v0.md)。

默认关系：

```text
message.rawText / NarrativeNode.body.raw:
  唯一可信的消息原文。

prompt transform:
  发送给模型前动态执行，产出 Chat History / Prompt Skeleton 中的文本投影。

semantic compile:
  只把已注册标签交给对应 Semantic Compiler，编译为通用 Semantic Part。

display transform:
  显示时动态执行，产出 displayParts / renderParts。

displayParts:
  当前渲染器消费的临时结构。可做内存缓存，但不作为 canonical data。
```

Markdown AST 不进入 Semantic Part，也不作为通用 DisplayPart。内置 Markdown Renderer 只消费 TextSegment；Semantic Renderer 只消费已经解析和校验的 Semantic Part，不得再次解析原始标签或其 YAML-like body。

这样可以保留 ST 式正则系统的灵活性，同时避免持久化风险：

- 未闭合标签不会污染长期数据；
- 规则改动后可以重新渲染；
- 原始文本导出、调试和迁移不需要反向组装；
- “仅影响显示”和“影响提示词”可以进入不同 transform phase。

---

## 4. Surface-Aware Display Pipeline

候选输入：

```text
Narrative message rawText
Agent transcript message rawText
ToolCall
ToolResult
Runtime event
Extension contributed event
```

候选输出：

```ts
type DisplayPart =
  | { type: 'text'; text: string }
  | { type: 'markdown'; text: string }
  | { type: 'artifact'; artifactType: string; content: unknown; renderMode: 'inline' | 'iframe' }
  | { type: 'tool-call'; toolCallId: string }
  | { type: 'tool-result'; toolResultId: string }
  | { type: 'agent-action'; actionId: string }
```

这不是已定 API，只是表达方向：

```text
DisplayPart 是渲染协议，不是持久化模型。
```

Transform / Renderer 都应能读取 surface：

```ts
displayPipeline.run(input, {
  surface: 'agent-panel',
  locale,
  enabledRules,
  permissions,
})
```

同一个规则可以选择只在某些 surface 生效：

```text
<特写>:
  narrative 生效，agent-panel 默认不生效。

<choice>:
  narrative 可以渲染为展示卡，agent-panel 可以渲染为可执行 action card。
```

---

## 5. Agent 面板内的四类渲染

### 5.1 Text Renderer

用于普通 Agent 工作对话：

- 纯文本；
- Markdown；
- TC 风格样式；
- 轻量日志格式；
- 插件贡献的文本高亮规则。

原则：

- 默认紧凑、可扫描；
- 支持复制原文；
- 不直接执行 HTML / JS；
- display transform 失败时回退为原始文本。

### 5.2 Artifact Renderer

用于 Agent 面板中的展示型块：

- `<choice>` 的只读预览；
- CodeAct 日志块；
- 工具结果摘要；
- 小型状态卡；
- 可折叠 debug 信息。

Artifact 可以由正则、tag parser、markdown fence 或结构化事件生成。

如果只是展示，不应升级成 ToolCall。

### 5.3 ToolCall Renderer

用于语义明确的工具调用和工具结果：

- 工具名称；
- 参数摘要；
- 执行状态；
- 结果 preview；
- 错误、重试、取消；
- permission / consent 状态。

ToolCall Renderer 不是普通富文本。它承载 Runtime Transcript 中已经发生或等待确认的语义事件。

### 5.4 Agent Action Card

用于会触发后续行为的交互卡片：

- 选择一个选项继续；
- 批准写入记忆；
- 应用一段重润色结果；
- 接受工具建议；
- 重试某一步 Agent 任务；
- 把结果提交到 Narrative Timeline。

原则：

```text
按钮点击不直接改 DOM。
按钮点击通过受控 action / RPC / SDK 调用后端。
真正写入 canonical data 的行为必须经过权限和 commit 边界。
```

---

## 6. `<choice>` 的两条路径

`<choice>` 是最典型的分界案例。

### 6.1 轻量路径：Regex / Tag -> Artifact

Agent 输出：

```xml
<choice>
A. 温柔回应
B. 转移话题
C. 追问细节
D. 保持沉默
</choice>
```

Display transform 解析为：

```ts
{
  type: 'artifact',
  artifactType: 'choice-card',
  content: {
    choices: [
      { label: '温柔回应' },
      { label: '转移话题' },
      { label: '追问细节' },
      { label: '保持沉默' }
    ]
  },
  renderMode: 'inline'
}
```

适合：

- 轻量插件；
- 兼容 ST 式标签写法；
- 选择结果只是发送一段普通文本；
- 不需要复杂权限、审计或工具状态。

限制：

- 语义弱；
- 不适合承载高风险状态修改；
- 不适合绕过 Tool / Permission 系统。

### 6.2 正式路径：Structured Event / ToolCall -> Action Card

Agent 或 Tool 产出结构化事件：

```ts
{
  type: 'agent.choice.requested',
  choices: [
    { id: 'a', label: '温柔回应' },
    { id: 'b', label: '转移话题' },
    { id: 'c', label: '追问细节' },
    { id: 'd', label: '保持沉默' }
  ],
  action: {
    kind: 'agent.invoke',
    task: 'continue-with-choice'
  }
}
```

Agent 面板渲染为受控 Action Card。

适合：

- 点击会继续驱动 Agent；
- 点击会调用工具；
- 点击会写入记忆 / 状态 / Narrative；
- 需要权限、审计、回放、重试和错误处理；
- 需要跨 Host / iframe / custom renderer 同步。

推荐：

```text
Agent 面板内，行为型 choice 优先使用 structured event / ToolCall。
Regex choice 作为轻量兼容与原型入口。
```

---

## 7. 与 Narrative 正文渲染的关系

Narrative 和 Agent Panel 可以共享：

- Transform Rule registry；
- Matcher / parser 基础设施；
- DisplayPart 协议；
- Artifact renderer registry；
- CSS token / data-airp hooks；
- iframe sandbox 策略；
- debug / trace 面板。

但不共享默认语义：

```text
Narrative:
  渲染结果主要服务阅读体验。

Agent Panel:
  渲染结果经常连接 Runtime 行为。
```

因此插件注册时应声明 surface：

```ts
airp.render.registerMatcher({
  id: 'choice-tag',
  surfaces: ['agent-panel', 'narrative'],
  phase: 'display',
})

airp.render.registerRenderer({
  artifactType: 'choice-card',
  surfaces: ['agent-panel'],
})
```

上述代码只是候选形态，不是最终 SDK。

---

## 8. iframe 在 Agent 面板中的位置

Agent 面板内也可以出现 sandbox iframe，但它不应是默认路径。

适合 iframe：

- 复杂 HTML / JS artifact；
- 插件可视化工具结果；
- 小型交互图表；
- 需要隔离第三方 CSS / JS 的内容。

不适合 iframe：

- 普通文本样式；
- 简单按钮；
- ToolCall 状态；
- 高密度工作日志。

iframe 原则：

- Host 管理 sandbox、权限、尺寸、焦点和销毁；
- iframe 内只能通过受限 SDK 调用能力；
- iframe 不能直接修改 Host DOM；
- iframe 需要 fallback 文本；
- 复杂到接管整个体验时，升级为 Custom Renderer tab。

---

## 9. 插件贡献边界

插件可贡献：

```text
Matcher:
  如何从 rawText 中识别某段内容。

Display Transform:
  如何把识别结果转为 display part。

Renderer:
  如何在特定 surface 绘制某类 part。

Action:
  用户点击后触发什么受控行为。

Panel / Slot:
  插件自己的 Agent side panel 或工具入口。
```

插件不应：

```text
直接 querySelector Agent 面板内部 DOM 并插入节点。
通过 innerHTML 执行任意脚本。
绕过 Agent permission / consent 调用高风险能力。
把显示用 transform 结果写回 canonical message。
```

---

## 10. 调试与透明度

因为这套系统本质上是给渲染和文本处理加 hooks，必须提供可解释性。

候选调试信息：

- 哪些 transform rule 生效；
- 生效 phase 是 prompt 还是 display；
- 生效 surface 是 narrative 还是 agent-panel；
- 原始文本片段；
- 产出的 display part；
- 使用的 renderer；
- 点击 action 最终调用的 RPC / Tool / Agent task；
- transform / render fallback 原因。

这部分可以与 Trace / Diagnostics UI 复用。

---

## 11. 非目标

本文不定义：

- 最终 TypeScript API；
- 完整插件权限模型；
- ToolCall 数据结构；
- Agent runtime loop；
- iframe sandbox 的完整安全策略；
- Custom Renderer tab 的完整 SDK；
- 正则系统的完整语法。

这些应分别进入 Agent、Extension、Runtime、Security 或 Custom Renderer 文档。

---

## 12. 待决问题

1. `surface` 是 display pipeline 的通用参数，还是每个 renderer registry 自己过滤？
2. Agent 面板里的 `<choice>` 首版是否只支持 artifact，还是直接支持 structured choice event？
3. ToolCall Renderer 的通用 UI 能力边界在哪里，哪些交给插件自定义？
4. Agent Action Card 的 action id / permission / audit 如何与 Runtime Transcript 绑定？
5. iframe artifact 在 Agent 面板内是否允许网络请求、脚本和 SDK？
6. displayParts 是否只做前端内存缓存，还是后端也允许生成一次性 projection？
7. Debug 面板是否需要展示 prompt transform 与 display transform 的 diff？
