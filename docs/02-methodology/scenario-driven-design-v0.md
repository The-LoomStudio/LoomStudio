# 场景驱动设计 v0

> **状态**：Open Design Method
> **目的**：为 Studio Application 设计提供一套可复用的场景模拟方法，避免过早 schema-first。

---

## 1. 为什么需要场景驱动

Studio Application 不是普通业务表单系统，而是一个面向 AIRP 内容、预设、插件、provider adapter 和运行时体验的开发平台。

如果只从数据结构出发，很容易得到看似完整但无法使用的模型。例如：

- 预设层过早变成 OpenAI-style `messages[]`；
- Setting Layer 被拆成过多硬编码类；
- 插件作者不知道自己应该写 Document、Fragment、Pass 还是 Runtime hook；
- Provider Adapter 被迫理解 Card / Chat / Opening 等上层领域；
- 简单卡作者为了写一张卡被迫理解复杂 pipeline。

场景驱动的目的不是替代规格，而是在规格之前过滤错误抽象。

---

## 2. 场景模板

每个关键场景用同一套模板记录。

```text
Scenario:
  场景名称

Actor:
  谁在使用 Studio 或扩展 Studio

Goal:
  他想完成什么

Input:
  他手上已有的数据、文件、插件或 provider

Expected Flow:
  他理想中怎么完成

Studio Support:
  Studio 明确提供了哪些帮助

Studio Friction:
  Studio 制造了哪些阻碍或认知负担

Required Concepts:
  这个场景真正需要哪些领域概念

Unnecessary Concepts:
  这个场景暂时不应该要求用户理解什么

Trace / Diagnostics:
  出问题时应该如何解释

Design Implication:
  对文档、模型、RPC、插件接口或实现的影响
```

---

## 3. 第一批模拟场景

### 3.1 预设作者：写 OpenAI 风格预设

Actor:

```text
预设作者
```

Goal:

```text
声明一个类似 SillyTavern preset 的 composition skeleton，
让角色设定、世界信息、用户人格、聊天历史和扩展提示词填进固定位置。
```

需要观察：

- Skeleton 是否能表达 slot / marker / order；
- slot 是否能声明填充策略；
- role-like 设计是否只是 provider hint，而不是 provider payload；
- OpenAI-style skeleton 在 Anthropic / Gemini 下是否有 compatibility diagnostics；
- 预设作者是否需要理解 Provider Adapter 细节。

设计影响：

```text
Composition Skeleton 应该吸收 ST 的 skeleton-and-slot 洞察。
但 Skeleton 不应直接等同于最终 provider messages[]。
```

### 3.2 预设作者：写 provider-specific 预设

Actor:

```text
高级预设作者
```

Goal:

```text
专门为 Anthropic、Gemini 或某个 OpenAI-compatible provider 写预设。
```

需要观察：

- Skeleton 是否能声明 target provider family；
- Studio 是否能在 provider 不匹配时提示风险；
- provider-specific 能力是否通过 capabilities 表达；
- 是否允许 fallback、warn、error 三种策略。

设计影响：

```text
默认应支持 provider-neutral skeleton。
但高级作者应能声明 provider-specific skeleton。
```

### 3.3 简单卡作者：写一张单角色卡

Actor:

```text
简单卡作者
```

Goal:

```text
写角色设定、开场和少量行为规则，然后直接游玩。
```

需要观察：

- 作者是否可以不理解 Skeleton 细节；
- Card metadata 是否保持展示用途，不混入 prompt；
- prompt-facing 内容是否进入 Setting Layer / Opening；
- 默认 Skeleton 是否足够可用；
- preview 是否能解释最终 prompt 包含了什么。

设计影响：

```text
简单 Card 创建流程必须有默认 Composition Skeleton。
Setting Layer 和 Opening 是 prompt-facing 内容的主要入口。
```

### 3.4 复杂卡作者：写多角色 / 世界模拟卡

Actor:

```text
复杂卡作者
```

Goal:

```text
写一个多角色剧场、世界模拟或互动小说，不被 Character Card 三件套限制。
```

需要观察：

- Setting Layer 是否支持嵌套、索引和投影；
- 是否避免过早硬编码 Actor / Speaker / CharacterProfile；
- Opening 是否能表达预制剧情，而不是特殊第一条 Chat message；
- Skeleton 是否能控制多类内容的输出位置。

设计影响：

```text
Card 不等于 Character。
Setting Layer 要提供能力，而不是用硬编码类层级限制创作空间。
```

### 3.5 插件作者：写 prompt 增强插件

Actor:

```text
插件作者
```

Goal:

```text
根据当前 Session / Card / Chat 追加检索结果、风格约束或临时上下文。
```

需要观察：

- 插件贡献的是 Document、Fragment、Pass，还是 Composition Source；
- 插件是否能声明目标 slot；
- 插件是否能被 Trace 解释；
- 插件是否需要理解 provider payload；
- 插件输出是否能被权限和 audit 追踪。

设计影响：

```text
插件应尽量贡献 composition source 或 fragment convention，
不应直接拼 provider request body。
```

### 3.6 Provider Adapter 作者：适配新模型 API

Actor:

```text
Provider Adapter 作者
```

Goal:

```text
把 Studio Application 的 compiled payload 转成某个 provider 的 request body。
```

需要观察：

- Adapter 是否只消费 compiled payload；
- Adapter 是否不需要理解 Card / Setting Layer / Opening / Chat documents；
- Adapter 是否能注册 capability validation；
- role、system、assistant prefill、tool call、content parts 等差异是否可诊断；
- usage / error / streaming 是否能规范化。

设计影响：

```text
Provider Adapter 负责 compiled payload -> provider request body。
它不负责编译 AIRP documents。
```

### 3.7 Importer 作者：导入 SillyTavern 数据

Actor:

```text
Importer / Compatibility 作者
```

Goal:

```text
导入 ST 角色卡、世界书、聊天记录和 preset。
```

需要观察：

- ST 字段是否映射到 canonical model，而不是反向塑造 canonical model；
- Character description / personality / scenario 是否进入 Setting Layer；
- First Message 是否变成 Opening；
- ST preset 是否转换为 Composition Skeleton；
- 无法无损映射的行为是否进入 diagnostics。

设计影响：

```text
兼容层可以保存历史语义，但不能让历史字段决定 Studio canonical model。
```

### 3.8 插件作者：注册文生图能力与子 Agent

Actor:

```text
文生图插件作者
子 Agent 作者
作者 UI 开发者
复杂卡作者 / 玩家
```

Scenario:

```text
一个 NovelAI / Diffusion 类文生图插件希望作为独立 Extension 接入 Studio。

它不想并入主 AIRP Agent，也不想重新实现 API Profile、密钥保存、模型配置和网络收发。
它希望注册自己的 AI capability、自己的子 Agent、自己的 tag builder / preset，
然后复用 Studio 的 AI Gateway、ModelProfile 列表、Session 上下文和 Extension Runtime。
```

Goal:

```text
插件作者提供一个可复用的生图能力：

1. 在自己的面板中选择平台已有的模型配置；
2. 根据当前 narrative timeline、active setting layer 和玩家输入生成 tag 串；
3. 调用注册在平台 AI Gateway 上的文生图 provider；
4. 返回图片 artifact、tag 结果或正文候选；
5. 允许其他作者界面复用这个能力，例如生成证件照、背景图、角色立绘或场景插图。
```

Input:

```text
Extension Manifest:
  - extensionId
  - capability contribution
  - subAgent contribution
  - provider extension contribution

Capability:
  - id: plugin.novelai.image.generation
  - displayName
  - input schema
  - output schema
  - permission requirement

Provider Extension:
  - providerExtensionId
  - provider config schema
  - model profile config schema
  - payload adapter
  - response parser

Plugin Agent Profile:
  - selected modelProfileId
  - plugin preset / tag builder config
  - context projection request
  - trigger policy

Runtime Context:
  - current sessionId
  - current branchId
  - narrative timeline projection
  - active setting layer projection
  - current player input / selected entry
```

Expected Flow:

```text
1. 插件注册 AI capability：plugin.novelai.image.generation。
2. 插件注册 Provider Extension，用来描述 NovelAI / Diffusion provider 的配置 schema、payload adapter 和 response parser。
3. Studio 在统一 Provider / Model 配置面板中渲染该 Provider Extension 声明的字段。
4. 用户创建 ProviderAccount 和 ModelProfile。
5. 插件 UI 调用平台接口：
   listModelProfiles({ capability: "plugin.novelai.image.generation" })
6. 插件 UI 不再要求用户重新填写 API key、baseUrl 或 provider profile。
7. 用户把某个 modelProfileId 绑定到插件自己的 Agent Profile。
8. 子 Agent 运行时向 Studio 请求受控 Runtime Context Projection。
9. 子 Agent 使用自己的 preset / tag builder 生成生图输入。
10. 子 Agent 调用 AI Gateway：
    invoke({ capability, modelProfileId, input, trace })
11. AI Gateway 读取 ModelProfile -> ProviderAccount -> ProviderExtension。
12. Provider Extension 只负责 input -> provider payload 和 provider response -> normalized output。
13. AI Gateway 负责 secret、网络请求、流式/非流式收发、错误归一和日志脱敏。
14. 插件拿到 normalized output 后生成 ArtifactCandidate 或 CommitCandidate。
15. Studio 通过受控提交路径把图片、tag 串或正文候选展示给用户确认。
```

Studio Support:

```text
Studio 应提供：

- 开放的 AICapabilityId 注册，而不是封闭 capability enum；
- 可按 capability 查询的 ModelProfile 列表；
- 统一 ProviderAccount / ModelProfile / secretRef 存储；
- 由 Provider Extension schema 驱动的统一配置面板；
- AI Gateway 的统一 invoke、网络收发、日志、错误、权限和密钥边界；
- Runtime Context Projection，允许插件拿到必要上下文，而不是扫描全部文档；
- SubAgent / Extension Agent 注册点；
- ArtifactCandidate / CommitCandidate 这种受控输出路径；
- Trace，解释上下文来源、tag builder 输出、gateway 调用和 artifact 写入。
```

Studio Friction:

```text
以下情况说明设计制造了错误阻力：

- 平台把 capability 写死成 chat.completion / image.generation / embedding 等封闭枚举；
- 插件必须自己保存 API key、baseUrl 和 provider profile；
- 插件必须自己实现 SSE / HTTP / retry / secret redaction；
- 插件必须理解 Card / Setting Layer / NarrativeEntry 的内部表结构；
- 插件可以绕过 Gateway 直接请求外部模型，导致权限和日志不可控；
- 插件可以直接修改 narrative timeline 或 asset store；
- 主 Agent、子 Agent、插件 UI 各自维护一套模型配置；
- Provider Extension 被迫理解 AIRP Card / Session / Prompt Builder。
```

Required Concepts:

```text
AICapabilityId:
  开放字符串，由 Extension 注册，不是平台封闭枚举。

ProviderAccount:
  保存 provider 账号、baseUrl、secretRef 和 provider-level 配置。

ModelProfile:
  一个可调用模型单元，绑定 provider account、provider extension、capability 和 model-level 配置。

Provider Extension:
  声明配置 schema、payload adapter、response parser 和 capability 支持。

Extension Profile / SubAgent Profile:
  插件自己的运行配置，引用 modelProfileId，但不复制 provider secret。

Runtime Context Projection:
  平台按权限投影当前 session / branch / timeline / setting layer。

AI Gateway Invoke:
  平台统一执行模型调用，Extension 只做格式转换。

ArtifactCandidate / CommitCandidate:
  插件输出先成为候选，再由用户、规则或 Agent commit path 接受。
```

Unnecessary Concepts:

```text
当前不应要求平台提前建好所有能力类型，例如：

- chat.completion
- image.generation
- image.edit
- text.embedding
- speech_to_text
- text_to_speech

这些可以作为示例 capability，但不应成为 M0 的封闭列表。

当前也不应要求：

- 平台理解 NovelAI 的所有参数；
- 平台替所有图像、音频、embedding provider 设计统一参数模型；
- 插件作者理解主 AIRP Prompt Builder 的全部内部结构；
- 插件维护自己的 provider credential store；
- 插件直接写 narrative timeline；
- 子 Agent 必须并入主 Agent 的 prompt 或 transcript。
```

Trace / Diagnostics:

```text
出问题时 Studio 应能解释：

1. 当前调用使用了哪个 capability；
2. capability 由哪个 Extension 注册；
3. 选中了哪个 ModelProfile；
4. ModelProfile 绑定了哪个 ProviderAccount 和 ProviderExtension；
5. 子 Agent 请求了哪些 context projection；
6. narrative timeline / setting layer 中哪些内容进入了 tag builder；
7. tag builder 输出了什么中间结果；
8. Gateway 最终发送了什么脱敏后的 provider payload；
9. provider 返回了什么 normalized output；
10. 图片或 tag 串为什么成为 ArtifactCandidate / CommitCandidate；
11. 候选结果是否被接受、拒绝或回滚。
```

Design Implication:

```text
这个场景说明 AI Gateway 是平台生态能力，而不是主 Application Runtime 的私有工具。

Capability 应该是 Extension 注册的开放标识。
平台只提供注册、查询、配置渲染、权限、密钥、网络、日志和调用边界。
具体 capability 的 input schema、参数含义、payload adapter 和 response parser 由 Extension 提供。

ModelProfile 应该是最小可调用单元。
预设不应该绑定 provider；插件也不应该复制 provider 配置。
插件自己的 Agent Profile 只引用 modelProfileId，并保存自己的 preset / tag builder / trigger policy。

Runtime Context Projection 应成为 Extension / SubAgent 读取上下文的标准入口。
插件不应该直接扫描 Session 数据表，也不应该直接修改 Narrative Timeline。

这个场景应长期作为 Extension 生态、Provider Gateway、SubAgent Runtime、Artifact 数据层和权限系统的回归模拟用例。
```

---

## 4. 场景评估问题

每个场景结束时，至少回答这些问题：

1. 这个场景需要哪些最小概念？
2. 哪些概念只是我们提前想象出来的？
3. 用户需要理解多少层才能完成目标？
4. 失败时 Studio 能否给出清晰诊断？
5. Trace 能否解释最终 prompt / payload 的来源？
6. 这个设计是否污染 Kernel？
7. 这个设计是否把 Provider 差异推给了错误的人？
8. 如果换成 OpenAI / Anthropic / Gemini，行为是否可解释？

---

## 5. 与 Application Layer 的关系

`docs/08-ApplicationLayer/` 中的每个重要模型都应能被场景反推：

- Card Model；
- Chat / Opening Model；
- Setting Layer；
- Composition Skeleton；
- Composition Pipeline；
- Runtime Boundary；
- Provider Adapter Boundary；
- Trace / Explainability。

当一个字段无法对应到任何当前场景时，默认不进入 M0。

当一个场景反复需要同一种能力时，再把它提升为正式模型或 Application convention。
