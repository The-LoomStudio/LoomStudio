# 插件生态架构横向参考：oh-my-pi、PulsarAI 与 LoomStudio

> **状态**：Reference / 两轮静态源码审计完成；不是新的稳定架构规范。
> **审计日期**：2026-08-27 至 2026-08-28。
> **固定快照**：oh-my-pi `37eee71978951fccf66b21f7e3e2b74596ac9d74`；PulsarAI `45c7ddaa5069f8dce3cdb62e8e77b6ab041870a4`；LoomStudio HEAD `7e69867978b1543e0ddea51ecc22b5cb542ab9d7`。
> **工作区边界**：LoomStudio 当前工作区另有未提交的 Extension Storage、Portable Payload 与相邻文档改动。本文会明确区分已提交基线、当前 working tree 实现和 Workbench 提案，不把未提交代码自动写成稳定合同。

## 1. 结论

三方没有一个可以直接复制的“完整插件系统”。它们分别优化了不同问题：

- **oh-my-pi（OMP）** 优化的是 Coding Agent 生态兼容与作者接入速度：Extension、Hooks、Skills、MCP、Context Files、Prompt、Commands 可以从多种用户级、项目级和 Marketplace 来源发现；作者 API 丰富，单项加载失败通常局部隔离。但运行时 Extension 与宿主同进程，能力主要靠 API 约定而不是强权限边界，也没有 Loom 式 Package / Module / Instance 声明与运行时对账。
- **PulsarAI** 优化的是“角色资源可编辑”和“生成流程可替换”：Plugin 是带稳定节点 ID 的资源树，`.chat.json`、Markdown、Container 与 `imports` 提供显式依赖；`generatePath` 或 Action Process 可以自行组装最终 Provider payload。它的 `manifest.json` 实际是 schema 驱动的可编辑设置，不是完整安装、权限或贡献 Manifest；所谓 Sandbox 不是 hostile-code 安全边界，当前授权面还存在已确认越权链。
- **LoomStudio** 已经拥有更适合作为平台合同的 Package / Module / Instance、Manifest v2、声明与 runtime registration 对账、default-deny Host capability、owner 强制、反序清理，以及 Prompt Resource / PromptBuild / Activation / Zone / Slot / Trace。当前真正缺少的不是再发明一套 `CTX`，而是 **把 Package 中的声明式 Prompt 资源、作者级显式 import、Tool/Skill/MCP contribution 和安装管理体验接到现有权威上**。

因此建议路线是：

1. 借 OMP 的发现兼容层、作者入口、Skills/MCP 生态、加载错误隔离、受管后台任务和 Marketplace 经验；
2. 借 Pulsar 的稳定资源身份、相对路径 import、惰性 Container、可编辑内置资源与恢复默认体验；
3. 保留 Loom 的 Package / Module / Instance、Manifest/runtime 双重验证、default-deny grant、owner identity、PromptBuild authority、事务和 scope disposal；
4. 不引入任意插件都能写入的全局 `CTX` 字符串槽，不允许 Prompt import 绕过 Activation、Projection、权限或 Trace；
5. 把 disable、reload、uninstall 拆开，并明确代码、声明式资源、用户修改副本、Package-owned data、portable payload 与 Instance scratch 的不同生命周期。

---

## 2. 审计方法与证据边界

本文按以下端到端链审计，而不是只看 README 或类型名：

```text
Package / Plugin discovery
  -> package identity + source precedence
  -> Manifest / frontmatter / convention validation
  -> resource contribution
      -> Prompt / Context / CTX / Skill
      -> Tool / Command / Hook / MCP
      -> UI / Setting / Provider
  -> activation + runtime registration
  -> effective grant / runtime scope / isolation
  -> context construction + provenance
  -> disable / reload / uninstall / dispose
  -> persistent data + orphan cleanup
```

证据优先级：

1. 当前源码 producer -> consumer 链；
2. 可执行测试与正式 Architecture；
3. 项目自带设计文档；
4. README、示例与作者意图。

本文明确区分：

- **已实现事实**：当前源码或正式 Architecture 能确认；
- **建议**：适合 LoomStudio、但尚未实现；
- **开放问题**：需要产品选择或进一步运行时验证。

本文没有运行 PulsarAI、没有安装第三方插件、没有启动浏览器，也没有把静态源码审计描述为恶意代码隔离测试或实际 Marketplace 兼容验收。

---

## 3. 首先消除术语误导

三方使用了相似单词，但对象并不等价。

| 术语 | OMP | PulsarAI | LoomStudio |
|---|---|---|---|
| Plugin / Package | npm、linked 或 Marketplace 安装单元；可携带 Extension、Skill、Hook、MCP 等 | 本地/全局资源树，带 `packageId`、`enabled`、`builtIn`；不等于 npm 包 | Package 是安装、来源、版本、声明式资源和持久数据归属边界 |
| Extension / Module | TS/JS factory，自由注册事件、Tool、Command、Renderer、Provider | 没有同构的 Module；JS 资源由生成流程或 Action 执行 | Module 是 runtime、entry、grant 和 runtime contribution 边界 |
| Instance | 主要是 Session 内 runner/handler 状态，没有公开的 Package/Module/Instance 三层合同 | 每次脚本执行有环境，但没有正式 Instance identity / disposer 模型 | Instance 是一次激活与临时注册资源的 scope 边界 |
| Manifest | `package.json`、Marketplace catalog、可选 plugin manifest 与各能力约定组合 | `manifest.json` 是可编辑设置数组，只有少量固定键 | Manifest v2 是 Package、Module、capability request 与 contribution 静态合同 |
| Prompt Resource | SYSTEM/APPEND、Context Files、Skills、Prompt capability、MCP Prompt 等多条表面 | 资源树中的 Markdown、`.chat.json`、脚本、Container 成员 | 版本化 Prompt Resource tree，经 Source Adapter 形成 Prompt Contribution |
| CTX / Context | Session context、context files、Hook/Extension context event、skills 等 | `CTX_BUILD` / `CTX_PROCESS_BEFORE_REGEX` 是 Container ID；最终上下文由 generate script 组装 | PromptBuild 是模型输入投影权威；Context Scope 是受控可读范围，不是共享最终字符串 |
| Tool | Extension/custom/MCP Tool，进入 Agent Tool Registry | 默认 Agent 只向模型暴露 `codeAct`，自定义 Tool 是 `ctx.tools` 中的函数 | Tool Definition、Registration、Mount、Provider/content transport 分离 |
| Skill | `SKILL.md` + frontmatter + supporting resources，可被模型或用户按需加载 | 文档与 API 中可作为 Agent 能力，但 Plugin 资源本身不是 OMP Skill | 尚无独立稳定 Skill 类型；可建模为 Package Resource 到 Prompt/Tool mount 的投影 |

最危险的错误类比有三个：

1. Pulsar 的 `manifest.json` **不是** Loom Manifest v2；
2. Pulsar 的 `CTX_BUILD` **不是**一个由宿主强制执行的 Context Pipeline；
3. OMP Extension API 丰富不等于它有比 Loom 更强的权限隔离。

---

## 4. 三种生态模型

### 4.1 OMP：能力发现网络，而不是单一插件内核

OMP 把 Extension Module、Hook、Skill、Context File、System Prompt、MCP、Commands 等建模为不同 capability，再由 discovery provider 从 native、Claude、Codex、Gemini、Agents、GitHub、installed plugin 等来源发现和去重。

Extension 本身是一个默认导出的 TS/JS factory。加载期只能注册；`ExtensionRunner.initialize(...)` 之后才获得 live action/context。一个模块可以同时注册 Tool、Command、event handler、Renderer、Provider，并可注入 Session message。证据：OMP `docs/extensions.md:17-65`、`:109-139`。

这种设计的优势是兼容真实生态：作者可以只交付一个 Skill，也可以交付带 Extension、MCP 和命令的包，不必先理解一套宏大的统一对象模型。

代价是治理分散：

- Package manifest 主要告诉 discovery 去哪里找资源；
- Extension 的真实贡献发生在 factory 运行时；
- Skill frontmatter、Context File、MCP config 各自有独立 schema；
- Extension 没有逐项 capability grant；
- 注册事实与包级静态声明没有 Loom 式强制对账。

### 4.2 PulsarAI：资源树拥有作者体验，脚本拥有生成权威

Pulsar Plugin 是一棵稳定 ID 资源树。路径用于展示和相对寻址，移动/重命名不改变节点身份。角色包拥有 local Plugin，也可启用 global Plugin；`builtIn` 是正交标记，内置 Plugin 允许编辑和恢复默认内容。证据：PulsarAI `src/features/Resources/Plugin/domain/plugin-types.ts:1-38`、`插件系统.md:7-14`。

根级约定文件包括：

- `manifest.json`：可编辑配置；
- `containers.json`：Container 定义；
- `*.chat.json`：带 role 的上下文模板；
- `tools/<name>/tool.js` + `prompt.md`：Sandbox 函数；
- `action/`：JS Process 或 Markdown composer action；
- `components/`、`background/`、`regex.json`、`.data.json` 等资源。

`generatePath` 是主插件的生成入口，但 JS Action 可以临时替代它。真正的最终上下文由脚本读取资源、拼装 messages 并调用 Agent/Model；Container 只建立惰性索引，不保证参与生成。内置 `generate.js` 只读取 compression 配置和 `default.chat.json`，没有自动执行 `CTX_BUILD`、`CTX_PROCESS_BEFORE_REGEX` 或 `REGEX`。证据：PulsarAI `插件系统.md:279-290`、`builtIn/core/generate.js:1-46`。

### 4.3 LoomStudio：分发、执行、实例和 Prompt 投影分权

Loom 当前正式模型是：

```text
Package
  -> Module
       -> Instance

Package resources
  -> Application Source Adapter
       -> Prompt Contribution
            -> PromptBuild
                 -> Provider Messages
```

Package 是安装、来源和声明式资源边界；Module 是 runtime、entry、enabled、grant 与 runtime contribution 边界；Instance 是实际激活和临时注册生命周期。Prompt Resource 则是 Application 数据，不等同 Module code。证据：LoomStudio `docs/architecture/extensions/README.md:1-23`。

当前实现边界仍然很窄：Server Host 已实现；Client Module 只能被发现并保存 desired state，没有 Client Host、Client Instance、Panel Registry 或 UI runtime。Agent Tool Definition / Mount / Registration 虽已存在，Extension Host 也尚未把 Module contribution 接到 Tool Registry；`externalRuntime` 是 Application 内部 Prompt 输入 seam，不是 Extension registration API。证据：`apps/studio-server/src/extensions/extension-manager.ts:113-129`、`:188-240`；`packages/application-runtime/src/agent-turn.ts:22-113`。

这种分权是 Loom 最重要的基础：插件可以提供内容或 adapter，但 **最终模型输入仍由 Application-owned PromptBuild 编译**。当前所有正式提示词来源进入同一次 `materialize -> order -> emit` pipeline，并保留 Source、Projection、Activation、Zone、Slot 与 Trace。证据：`docs/architecture/application/prompt-build/README.md:1-49`。

---

## 5. 发现、安装与分发

### 5.1 OMP 值得借鉴：多来源发现与生态兼容

OMP 原生 Extension 来源包括项目 `.omp/extensions`、用户 Agent 目录、settings、CLI 显式路径、JS/TS Hook factory，以及 installed plugin 的 `omp.extensions` / legacy `pi.extensions`。Skill、Context、MCP 等还可从其他工具约定目录发现。证据：OMP `docs/extension-loading.md:26-70`；`docs/context-files.md:7-20`。

它的 enable/disable 也是按 capability 分开的：`--no-extensions` / `disableExtensionDiscovery` 只关闭 ambient Extension factory 与相关 sibling roots，显式路径仍可加载；Skills、MCP、Tools、Prompts 和 Rules 保留各自开关。这一点比“禁用 Package 等于删除所有表面”更真实，但管理 UI 必须把部分启用状态展示清楚。证据：OMP `docs/extension-loading.md:95-135`。

Marketplace 支持 user/project scope，项目安装可以 shadow 用户安装；catalog 可以声明相对目录或 Git 来源，并兼容 `.omp-plugin/marketplace.json` 与 `.claude-plugin/marketplace.json`。安装后的真实 runtime discovery 仍来自插件树和 manifest，而不是把 catalog metadata 当成注册事实。证据：OMP `docs/skills/authoring-marketplaces.md:8-10`、`:44-79`、`:207-242`。

Loom 应学习的是 discovery adapter，而不是照搬所有目录：

- Catalog/Marketplace 负责“可获得什么”；
- Installer 负责“安装了什么”；
- Package Catalog 负责“当前发现什么”；
- Manifest 负责“声明什么”；
- Host Registry 负责“实际注册什么”。

这些状态不能压成一份 lockfile 或一个 `enabled` 布尔值。

### 5.2 Pulsar 值得借鉴：资源身份不依赖路径

Pulsar Plugin tree 节点有稳定 ID，路径和名称可以变化。跨资源既支持相对路径，也支持 `resourceById`；Conversation binding 和 message environment metadata 保存稳定 ID。这个设计适合编辑器产品，避免文件移动后所有引用失效。

Loom 的 Prompt Resource node 已经有稳定 ID 和 tree mutation；未来 Package 内 Prompt asset import 也应同时支持：

- 作者友好的相对路径；
- 持久绑定使用稳定 SourceRef / resource ID；
- 移动后路径可重算；
- Trace 保存当次解析到的版本和 digest。

### 5.3 Loom 应保持的安装底线

Loom 当前从仓库、dev link 和 installed 目录发现 Package；同一 `packageId` 多来源时整个 Package unavailable，不选择隐式赢家。安装使用 staging、预算校验、路径边界检查和 rename 原子提交；卸载只接受 installed source。证据：`apps/studio-server/src/extensions/extension-manager.ts:65-118`、`:131-188`；`extension-package-installer.ts:24-46`。

不应为了兼容 npm/Marketplace 退回：

- 先覆盖目标目录再尝试恢复；
- 同 ID first-wins；
- project-local package 自动启用；
- catalog 声明成功即视为 runtime 可用；
- 安装成功即视为可信。

---

## 6. Manifest：声明、配置与运行事实必须分开

### 6.1 OMP：多个 manifest 层协作

OMP 没有一个统一 Manifest 同时声明所有 runtime contribution，实际至少有三层：Package `package.json#omp/#pi` 描述 tools/hooks/extensions/commands/features/settings；Marketplace catalog 描述分发来源及 LSP/DAP 等安装元数据；Agent Plugin `plugin.json` 描述 portable skills、MCP 与实例数据目录。三者覆盖面不同，也不是同一个 Runtime API。

此外，各能力继续使用自己的约定：

- `package.json#omp.extensions` / `pi.extensions` 指向 Extension entry；
- Skill 使用 `SKILL.md` frontmatter；
- MCP 使用独立配置；
- Marketplace catalog 描述分发；
- 可选 plugin manifest 携带技能、命令、MCP 等路径元数据；
- Extension factory 运行后才知道实际注册的 Tool、Command、Provider 和 handler。

优点是渐进式与兼容，缺点是静态审计难以回答“安装这个 Package 实际开放什么”。Loom 可以做 discovery compatibility layer，但不应放弃自己的统一 Package/Module identity 和运行时对账。

### 6.2 Pulsar：`manifest.json` 是设置表，不是权限声明

Pulsar `PluginManifest` 是 `GroupContent[]`：每项包含 UI component、props 和 JSON value。固定键只有 `runtime/generatePath`、`generation/model`、`appearance/background` 等；Plugin 的 `id/packageId/enabled/builtIn` 在 Plugin 元数据，不在 manifest 中。它没有 version、author、dependency、runtime grant、贡献列表或卸载策略。证据：PulsarAI `domain/plugin-manifest.ts:1-45`、`:233-237`。

因此不能把它类比为 Loom Manifest v2。它更接近：

```text
Plugin-owned editable settings schema + values
```

这个作者体验值得吸收：配置定义可以直接生成 UI。但配置 schema 不能承担安装身份、权限申请和 runtime contribution 合同。

### 6.3 Loom：静态声明与运行注册对账是正确方向

Loom Manifest v2 已声明 Package metadata、Module runtime/entry、capability request、Package contribution 和 Module runtime contribution。当前真正存在“静态声明 vs 动态注册”双向对账的是 RPC 与 Event：开发/测试模式中未声明注册产生 warning/degraded，生产模式拒绝；声明未注册也产生 Diagnostic。`documentTypes` 是 Host 访问 allowlist，不是 runtime registration；`panels` 属于尚未实现的 Client Host，不能写成已经对账。证据：`packages/extension-sdk/src/index.ts:89-136`；`packages/extension-sdk/extension-host/src/index.ts:573-632`、`:1132-1203`。

后续新增 Prompt/Skill/MCP contribution 时应保持相同原则：

- Manifest 声明资源索引和请求的能力；
- 安装阶段校验路径、schema、namespace 与 engine；
- 激活阶段验证 runtime registration；
- Application 消费阶段再次验证领域 contract；
- Trace 记录实际进入本次 Run 的 effective surface。

“Manifest 声明过”不等于“已经注册”，“已经注册”也不等于“本次 Run 已授权和激活”。

---

## 7. 插件如何提供 Prompt 资源

### 7.1 OMP：分层资源，不是单一 Prompt 文件夹

OMP 的 Prompt-facing 能力至少分为：

| 表面 | 作用 | 注入时机 |
|---|---|---|
| `SYSTEM.md` / `APPEND_SYSTEM.md` | 替换或追加基础 system prompt | Session 初始化 / prompt render |
| Context Files | 项目/用户持久指令 | Session opening context |
| `RULES.md` / rule files | always-apply 或按 glob 可发现的规则 | 靠近当前 turn 或按需读取 |
| Skills | 先暴露 name/description，按需读取完整 `SKILL.md` 和资源 | 模型或用户选择时 |
| Extension `before_agent_start` | 注入可持久化、UI 可见 message，或链式替换本轮完整 system prompt | Agent run 前 |
| Extension / Hook `context` | 修改单次 Provider call 的 messages | 每次 LLM 调用前 |
| MCP Prompt / Resource | 外部 Server 提供的动态内容 | 通过 MCP manager/commands 使用 |

这种分层值得学习：常驻短描述与按需完整内容分开，避免所有资源无条件塞入 Context。但 OMP 的 `context` hook 可以直接替换 message 列表，属于可信 Coding Agent middleware，不适合作为 Loom 普通 Package 的默认能力。

OMP Skills 的渐进加载尤其值得保留：系统提示只列 name + description；正文和 supporting resources 通过 `skill://` 按需读取，并执行绝对路径、`..` 与 package contain-root 检查。`hide` 只阻止模型自动发现，不等于禁用用户显式调用。证据：OMP `docs/skills.md:1-9`、`:127-180`。

OMP 还提供了一个很有价值的反例：Package provider 会发现 `<plugin-root>/prompts/*.md` 并注册 `prompts` capability，但活跃 `loadPromptTemplates()` 只读取用户 prompts 与项目 `.omp/prompts`；当前明确的 `loadCapability("prompts")` 消费者只是 Extension 状态 UI。`resources_discover` 虽允许返回 `promptPaths`，也没有 AgentSession 主链 callsite 证明它们进入 `/prompt-name` 展开。结论只能是“已发现”，不能写成“已进入 Prompt”。证据：OMP `packages/coding-agent/src/discovery/omp-plugins.ts:133-151`、`:379-385`；`packages/coding-agent/src/config/prompt-templates.ts:153-180`；`packages/coding-agent/src/modes/components/extensions/state-manager.ts:208-217`。

### 7.2 Pulsar：显式 import + 惰性 Container

Pulsar 的核心不是 `CTX_BUILD` 名称，而是 source-scoped `imports`：

- `imports.resource(path)`；
- `imports.resourceById(id)`；
- `imports.container(scope, id)`；
- `imports.containers(scope, pattern)`；
- `imports.config.local/global(...)`。

Container 成员不会自动进入 Context。`list()` 只列资源，`get()` 或资源字符串渲染才读取；相对路径不能越出 Plugin 根。资源递归解析有循环检测。Resolver 会记录被解析、导入、编译或读取的 resource ID，并写入 message environment metadata；该集合不是严格的 content-read trace。证据：PulsarAI `插件系统.md:206-230`；`plugin-reference-resolver.ts:348-350`、`:378-399`、`:490-499`、`:781-787`。

更准确的边界是“Container membership 不等于 Prompt injection”，而不是“Plugin 内容绝无宿主准备的 Prompt”。Generation Host 每轮都会构造 `bootstrapMessages` 候选，其中包含 Feature API bootstrap；本轮 effective visible Plugin（`enabled`、当前主 Plugin 或当前 Package-local Plugin）下完整的 `tools/<name>/tool.js + prompt.md` 会形成 `ctx.tools` 函数及 `# 自定义工具` 说明；Resolver 还会静态扫描可见资源的 `imports.resource(...)` / `resourceById(...)`，把被引用 `.data.json` 的说明汇总为 `# Data`。绑定 Plugin/文件的开发或测试 Conversation 另会加入当前资源、根 `info.md`、`AGENTS.md` 和 Plugin guide，普通无 binding Chat 不会。证据：PulsarAI `plugin-generation-environment.ts:46-50`。

这些内容仍不是宿主不可绕过的最终注入。它们只是放入 `bootstrapMessages`，内置与默认 `generate.js` 会把该数组展开进 Provider messages，自定义 `generatePath` 或 Action Process 可以完全忽略它。因此 Pulsar 的最终 Prompt authority 仍在脚本，而不是 Host。证据：PulsarAI `Capabilities/application/capability-registry.ts:95-122`；`application/plugin-custom-tools.ts:39-184`；`plugin-reference-resolver.ts:402-450`、`:484-487`；`Resources/Conversation/application/conversation-generation.ts:287-320`、`:517-550`；`conversation-resource-context.ts:27-39`、`:78-109`；`builtIn/core/generate.js:1-6`。

这还带来一个生命周期事实：effective visible topology 不只是“允许以后读取静态资源”。Resolver 建立时会实际执行 `insertion.condition`；Custom Tool JS 会被解析和编译，但函数正文只在调用时执行；Tool/Data 说明被准备进 `bootstrapMessages`，只有 Process 将其展开进 Provider messages 时才真正暴露给模型。证据：PulsarAI `plugin-reference-resolver.ts:638-681`；`plugin-custom-tools.ts:48-106`；`conversation-generation.ts:287-320`；`builtIn/core/generate.js:1-6`。

这是本文认为 Pulsar 最值得 Loom 吸收的部分。

### 7.3 Loom 的正确接法：Package Resource -> Contribution -> PromptBuild

Loom 当前 Prompt Resource 保存版本化树、node body、enabled、capabilities 和 metadata；Setting Mount 与 Preset Tool Mount 是独立关系。证据：`packages/prompt-resource-store/src/types.ts:9-47`、`:109-176`。

当前 Manifest 已支持顶层 `promptResources`、`agentTools` 与 `transformRules`。Prompt Resource / Tool Definition 通过显式 `extensions.importPackageResources` 实例化到现有 Application 权威存储；Server Module 仅通过 `agentToolHandlers + ctx.agentTools.register()` 提供生命周期绑定的执行器。安装本身不注入 Prompt，也不自动启用 Tool。运行时 Prompt Source Adapter 仍未实现。

Extension Package 提供 Prompt 内容时分成两类：

1. **声明式 Prompt Resource**：已实现。Package 安装后进入 Package Catalog，由 Application 显式实例化；不需要启动 Module；
2. **运行时 Prompt Source Adapter**：尚未实现。未来 Module 只能通过窄 capability 产出 `PromptContribution[]`，不能直接提交最终 Provider payload。

最小链应是：

```text
Package manifest resource entry
  -> validated package-relative source
  -> stable PackageResourceRef
  -> user/application mount or adapter resolution
  -> PromptContribution
       content
       sourceRef
       projection capability
       optional activation/lifecycle/render
  -> PromptBuild materialize/order/emit
  -> Provider Message + Trace
```

Prompt import 只解析身份或候选，不直接表示“读取并注入”。真正进入 Prompt 仍要经过：

- Package/Module grant；
- Workspace/Session Context Scope；
- user/preset mount；
- enabled；
- per-build Activation；
- Zone/Slot compatibility；
- ordering；
- Provider projection。

---

## 8. CTX：不要建立共享字符串总线

### 8.1 OMP 的 Context middleware

OMP Extension/Hook 的 `context` event 可以链式替换即将发给模型的 messages；`before_agent_start` 可以注入持久 message。对单产品 Coding Agent，这给安全审查、脱敏、上下文修剪和实验带来极强可塑性。

但它也意味着多个扩展按顺序改写同一 payload，最终来源和冲突难以只靠静态声明解释。Loom 若需要类似能力，应作为少数第一方 Application Pass 或高权限、可审计 middleware，不应给普通 Package 一个 `ctx.messages = ...` 接口。

### 8.2 Pulsar 的 CTX 名称没有宿主权威

Pulsar 内置 Container 定义了 `CTX_BUILD` 与 `CTX_PROCESS_BEFORE_REGEX`，但它们只是 JS resource index。系统不规定参数、返回值、执行顺序或必用性；`generatePath` 可以完全忽略。运行环境中的 `ctx` 也只是 `finalEnvironment` 的自引用别名，会连同 Conversation 对象、Feature API、Plugin API、Tool、Skill、MCP 等广泛表面一起暴露；它不是独立、最小或版本化的 CTX 合同。证据：PulsarAI `builtIn/core/containers.json:14-16`；`插件系统.md:286-290`；`Resources/Conversation/application/conversation-generation.ts:503-550`。

这种模式适合让高级作者完全替换角色生成流程，但代价是：

- 每个 Plugin 可以形成自己的 Context ABI；
- 无法保证统一 Activation / ordering / token policy；
- Tool、History、Memory、Regex、Prompt 的 provenance 依赖脚本自觉；
- Host 难以提供稳定 Preview、Diff、Trace 和冲突诊断。

### 8.3 Loom 应保留唯一 PromptBuild authority

Loom 已经有 `PromptContribution -> PromptFragment -> Zone/Slot -> Activation/order -> Provider Message` 的正式边界。外部内容在 emit 前保持节点身份；这正是避免“CTX 大字符串”失控的关键。证据：`docs/architecture/application/prompt-build/README.md:26-49`。

建议把未来 `ctx` 分成三个不同对象，避免名称混淆：

| 对象 | 用途 | 是否权威 |
|---|---|---|
| `ExtensionActivationContext` | Module 注册、Host capability、生命周期 | Host runtime authority |
| `Application Context Scope` | 当前 Module/Agent 可读取哪些领域对象与资源 | 访问边界，不是事实源 |
| `PromptBuildContext` | 本次 build identity、facts、mounts、budget、trace sink | Prompt projection authority |

不要提供一个可跨插件 append 的 `CTX: string[]`。如果需要增量贡献，API 应接收结构化 Contribution，并由 PromptBuild 决定是否、何处、以何角色进入最终 payload。

---

## 9. 注册、冲突与运行时对账

### 9.1 OMP

Extension factory 自由调用 `registerTool`、`registerCommand`、`registerProvider`、事件订阅等。单个路径加载失败会记录 load error，其他扩展继续；handler dispatch 大多捕获错误并继续。Tool call interception 在参数改写后会重新验证并进入 approval。证据：OMP `docs/extension-loading.md:7-13`；`docs/extensions.md:38-65`、`:244-263`。

值得学：

- 每条加载错误带 source path；
- 一项失败不阻止健康项；
- 注册表可在 UI 检查；
- middleware 修改后的输入重新走 validation/policy；
- 冲突规则需要确定性和可见诊断。

不应照搬：只靠运行时自由注册、缺少 Package 声明和 grant 的方式。

OMP 不同表面的冲突合同也并不统一：Capability resource 是高优先级 first-wins；Extension Tool 可由后加载项覆盖；standalone custom Tool 冲突拒绝；Command、Shortcut、Renderer 和 MCP minted name 又各有 last-wins、skip、first-wins 或稳定 origin winner。Loom 应把 owner、resource kind 与 collision policy 作为可查询合同，不能依赖每个 Registry 的偶然实现。证据：OMP `packages/coding-agent/src/extensibility/extensions/runner.ts:784-802`、`:905-1006`；`packages/coding-agent/src/extensibility/custom-tools/loader.ts:126-188`；`packages/coding-agent/src/mcp/tool-bridge.ts:372-410`。

### 9.2 Pulsar

Pulsar Container/resource conflict 设计意图是 fail，而不是覆盖；成员按确定性顺序查询。实际实现已有漂移案例：重复 resource ID 可能只产生诊断，Generation 入口只把包含“冲突”的中文消息当作 blocking，形成 first-wins。这个反例说明 Diagnostic 必须有 machine-readable code/severity，不能靠文案匹配决定控制流。

### 9.3 Loom

Loom 应继续坚持：

- Package source conflict -> Package unavailable；
- 同 namespace registration conflict -> 拒绝，无隐式赢家；
- 未声明注册 -> dev degraded / production reject；
- 声明未注册 -> Diagnostic；
- Instance handle 只能移除自己注册的对象；
- runtime summary 同时展示 desired state 和 actual state。

未来 Prompt/Skill/MCP contribution 也应复用这套 reconciliation，而不是各建一份 registry。

---

## 10. 权限、隔离与信任边界

### 10.1 OMP：可信同进程 Extension

OMP 文档明确 Extension in-process、no isolation。raw timer 或 detached promise 的未处理异常甚至可能进入进程级 postmortem；平台因此提供受管 `ctx.setInterval/setTimeout`，捕获 callback 错误并在 Session shutdown 自动清理。证据：OMP `docs/extensions.md:171-192`。

OMP 的安全价值主要在 Tool approval、Hook fail-closed 和进程边界外工具的 policy，不在 Extension 本身的沙箱。Extension 可以访问 Node/Bun 能力，适合用户主动安装的可信 Coding Agent 扩展。

### 10.2 Pulsar：同 Realm Sandbox 不是安全边界

Pulsar 使用 `new Function` / `AsyncFunction` + `with` 构建脚本环境。文档也承认同 Realm 下不是恶意代码隔离。当前默认 Global Capability 开放 network、storage、page、workers、codeGeneration；通用 Database read 还可读取 `secret` 表明文，再通过 `fetch` 外传。证据链详见 [`pulsarai-architecture-and-product-reference.md`](pulsarai-architecture-and-product-reference.md) 第 10 节。

此外，当前 Generation 把真实 `conversation` / `activePath` 对象放入环境，普通 Plugin 可以直接变异内存对象；scoped Plugin 的 `read` 组还混入 write/remove/run。这说明“提供一个看起来受控的 API object”不等于建立权限边界。

中央 denylist 还屏蔽了旧的 `plugin.remove/write/create/move` 等名称，却没有屏蔽当前存在的 `createGlobal/update/restore`。Generation 构造 scoped Plugin API 时先展开 inherited Plugin API，再覆盖 scoped self facade，并将结果写回 `plugin`、`PLUGIN` 与 `capabilities.plugin`；因此 generatePath、Action、自定义 Tool，以及捕获同一 environment 的 CodeAct 都可调用这些方法。证据：PulsarAI `Capabilities/application/capability-registry.ts:39-55`、`:95-110`；`Resources/Conversation/application/conversation-generation.ts:380-460`；`Agent/application/default-agent.ts:71-129`、`:178-200`。

### 10.3 Loom：Host capability 是治理边界，Server Module 仍是可信代码

Loom Host 不暴露 Kernel、SQL connection 或内部 Registry；owner、Package/Module/Instance identity 由 Host 注入；RPC reserved namespace、Document owner/type 与 Asset grant 由已提交 facade 强制。当前 working tree 还增加了 package-owned typed Storage 与 Portable Payload，但它们属于未提交实现，且目前不是 Manifest request / per-Module grant；不能把它们升格为稳定授权基线。证据：`packages/extension-sdk/src/index.ts:240-345`；`docs/architecture/extensions/README.md:69-125`。

但当前 Server Module 仍与宿主同进程，能直接 import Node 文件、网络和进程 API。正式文档已经正确说明 Host capability 不是强安全沙箱。这个表述必须保留。

建议建立清楚的信任级别，而不是一个 `trusted` 布尔值：

| 类型 | 默认信任 | 可用能力 |
|---|---|---|
| 纯声明式 Package Resource | 不执行代码 | 解析、校验、导入、Prompt contribution |
| 可信 Server Module | 用户明确启用 | 当前 Host facade；进程级代码能力仍需 UI 警示 |
| Client UI contribution | 未实现 | 未来按 Direct / Shadow DOM / iframe / Worker adapter 区分 |
| 外部 MCP / process provider | 独立进程但有网络/文件副作用 | 明确 credential、consent、tool grant 与 teardown |
| 不可信代码 | 当前不支持 | 需要 Worker/进程/OS sandbox，不能靠 facade 宣称安全 |

---

## 11. 生命周期：发现、启用、重载、停用、卸载不是一件事

### 11.1 OMP

OMP Extension 主要跟随 Session lifecycle：load factory、initialize runner、接收 `session_shutdown`，managed timers 自动清理。MCP Manager 则有更完整的连接 ownership：server disconnect 移除 tool/prompt/resource 状态，owning Session dispose 有 3 秒有界清理，借用 parent manager 的 subagent 不负责关闭。证据：OMP `docs/mcp-runtime-lifecycle.md:198-232`。

`/reload-plugins` 也不是完整代码热重载。它会刷新 filesystem/plugin cache、Agent、Skill、slash command、capability 与 MCP connection/tool binding，但不会重新导入或卸载当前 Session 已驻留的 Extension factory、standalone custom Tool 和 JS/TS Hook。Package uninstall 同样不会让 resident code 立刻离开当前 Session；OMP 没有 per-plugin `dispose/unregister` transaction，主要依赖整个 Session shutdown、managed timer cleanup 和 custom-tool shutdown callback。证据：OMP `packages/coding-agent/src/slash-commands/builtin-marketplace.ts:23-40`、`:553-565`；`packages/coding-agent/src/extensibility/plugins/manager.ts:611-642`；`packages/coding-agent/src/session/agent-session.ts:3918-3932`。

Agent Plugin 的 `PLUGIN_DATA` 会按安装实例 identity digest 隔离并跨更新保留；当前没有证据表明 Marketplace uninstall 会清理该目录，因此准确说法是“durable data 可保留，也可能在卸载后成为 orphan”，不是自动清理。另一方面，OMP 不把已实例化的 Extension/custom-tool 闭包传给子 Session，只传 source path，由子 Session 重新执行 factory 和绑定 runtime API。这种“不跨 Session 复用 Instance callback/CTX”的边界值得 Loom 保留。证据：OMP `packages/coding-agent/src/discovery/agent-plugins.ts:43-93`、`:228-300`；`packages/coding-agent/src/sdk.ts:430-464`。

Package 卸载、Extension runtime teardown、Skill 失效、PLUGIN_DATA 和 persisted Session custom entries 并不是统一事务。Loom 应借鉴 MCP 的 owner/borrower 语义和 epoch 防复活，而不是把整个 Session 当作唯一 scope。

### 11.2 Pulsar

Pulsar 没有正式的 install/uninstall hook、Module activate/dispose 或 Instance scratch 清理。JS Action 只是替代本次 generate process。删除全局 Plugin 时，Store 会阻止仍作为主要 Plugin 的删除、从角色的 enabled global 集合移除引用、删除精确绑定的测试 Conversation，再删除 Plugin 记录；非 test Conversation 即使仍保存该 Plugin binding 也不会被删除或重写，历史 Message 的 `environmentInfo` / Action part 也不会更新，源码中的 Plugin ID 字符串引用同样不被分析。`temp/` 只是内置资源树约定，没有 per-run / disable cleanup consumer；删除整棵 Plugin tree 时才随树消失。更没有统一合同处理 Plugin 生成的其他领域数据、外部副作用或脚本后台任务。证据：PulsarAI `Resources/Plugin/application/plugin-store.ts:888-928`；`Resources/Conversation/domain/conversation-types.ts:44-59`。

内置 Plugin 可编辑并恢复默认是很好的产品能力，但 `restore` 与一般 package upgrade/migration 不是一回事。

Pulsar 的 Portable Archive 另有一个值得单独借鉴的资源迁移语义：Copy 模式重映射冲突 ID，Update 模式按稳定节点 ID 合并，内容冲突时保留重命名副本而不是静默覆盖。文件闭包则不是 typed reference graph：Rust 会递归扫描序列化 payload 中所有字符串，只要字符串是 `file://` 或绝对路径、且解析到资源根内的现存文件，就改写为 archive URL 并携带该文件；这可能漏掉非字符串/非绝对形式，也可能把恰好长得像路径的普通字符串当成引用。它仍不是带签名、依赖、兼容和 grant 的安装包，但比“导入即整树覆盖”更适合作为 Loom Package resource / user copy 的产品参考。证据：PulsarAI `src/features/Backup/docs.md:29-51`、`Backup/application/backup-store.ts:788-856`、`src-tauri/src/lib.rs:509-616`。

### 11.3 Loom 当前语义

Loom Server Module 支持 discover/load/activate/reload/dispose；Instance scope 先停止新调用并 abort，再等待 in-flight callback，最后按注册反序执行 disposer并汇总错误。证据：`packages/extension-sdk/extension-host/src/index.ts:1242-1306`。

Manager disable 会保存 desired state 并 dispose Server Module；reload 只允许 enabled Server Module；uninstall 先 dispose Modules，再删除 installed directory。证据：`apps/studio-server/src/extensions/extension-manager.ts:164-240`。

当前还有一个必须在 Marketplace 前收束的高置信边界：`uninstallPackage` 不删除 `ExtensionStateStore` 中按 `packageId + moduleId` 保存的 enabled 与 grant；State Store 也没有 delete/purge API。重新安装同 ID Package 后，初始化或 install flow 会读取旧状态并可能自动激活新代码。因此“保留用户选择”与“不同版本/来源代码继承旧 grant”目前是同一行为，尚未绑定 publisher、signer、source provenance 或用户复核。证据：`extension-manager.ts:117-120`、`:149-151`、`:164-186`；`extension-state-store.ts:27-35`、`:51-93`。

这不一定要简单改成卸载即清空。更合理的是显式区分：同 provenance 的 reinstall/upgrade 可申请保留；publisher、signature、source kind 或 requested capability 变化时必须重新确认。Package-owned durable data 也同理：连续身份可以继承，只有相同字符串 ID 不能自动证明连续身份。

当前 working tree 的 Scoped Storage 与 Portable Payload 进一步暴露了必须明确的数据边界：代码卸载不应自动删除 Package-owned durable data，否则重装、暂时停用和兼容资源会丢失；但永久清理也不能永远没有入口。

### 11.4 建议的资源清理矩阵

| 对象 | disable | reload | uninstall code | purge package data |
|---|---|---|---|---|
| Module runtime registration | dispose | dispose old + activate new | dispose | 已不存在 |
| Module desired state / grants | 保留 | 保留 | 当前仍保留 | reset 与 provenance 复核需显式定义 |
| Instance scratch / temp handles | 删除 | 删除旧 Instance | 删除 | 删除 |
| Package 声明式资源索引 | 保留但 inactive | 重扫/对账 | 从 Catalog 移除 | 已移除 |
| 用户导入/修改的独立副本 | 保留 | 保留 | 保留，并标记 source unavailable | 用户明确删除 |
| Package-owned config / record | 保留 | 保留 | 默认保留 | 显式、可预览、可审计删除 |
| Portable payload / Artifact binding | 保留 | 保留 | 保留并显示缺失 handler | 按引用与用户选择清理 |
| Secret ref | 保留或 revoke，取决于 purpose | 保留 | 默认 revoke runtime access | 用户明确删除 secret |
| 外部 MCP/process credential | 停止使用 | 重连需重新绑定 owner | revoke/disable | 用户确认删除 |

卸载 UI 至少要区分：

```text
Remove package code
Remove code + package-owned data
Export data before removal
Cancel
```

第一版不必实现复杂依赖求解，但必须避免把“卸载目录成功”描述为“所有插件影响已清除”。

---

## 12. Provenance、Context Trace 与可解释性

### 12.1 OMP

OMP 的优势是生态对象可发现且错误可定位到 path/provider；Skills 只在 system prompt 暴露短描述，按需读取正文。Extension/Hook 对 Context 的动态修改则需要依赖 Session event、日志和 handler 顺序理解，静态 Manifest 无法完全解释最终 payload。

### 12.2 Pulsar

Pulsar resolver 会记录被解析、导入、编译或读取的 resource IDs，并写入 Assistant message 的 environment metadata。这比“只记录可见 Plugin”更有价值，但不是严格的 content-read trace；它尚未完整区分候选、解析、读取、渲染和最终进入 Provider payload，也没有强制所有自定义 generatePath 遵循同一 trace schema。

### 12.3 Loom

Loom PromptBuild trace 已记录 pass、fragment、mutation、diagnostic 和 source/projection 关系。未来 Package resource import 应继续进入同一条 Trace，不新增一个平行 `pluginEnvironmentInfo` 权威。

建议最少记录五个阶段：

```text
declared candidate
  -> visible by grant/scope
  -> reference resolved
  -> content read/rendered
  -> active contribution emitted
```

每条 trace 至少包含：

- requester SourceRef；
- requested PackageResourceRef / PromptResourceRef；
- Package/version/source provenance；
- resolved resource/node ID；
- content version/digest；
- grant/scope decision；
- Activation decision；
- Zone/Slot；
- final Provider message/block relation；
- missing/cycle/conflict/unsupported diagnostic code。

---

## 13. 作者体验：Loom 最需要补的不是更多底层抽象

OMP 和 Pulsar 都提醒了一个现实：生态成熟度不只取决于权限模型，还取决于作者能否在十分钟内做出一个可检查的扩展。

Loom 当前 Host 合同更严谨，但作者体验仍缺：

- 单一、清楚的 Package entrypoint；
- 最小纯资源 Package 示例；
- 最小 Server Module 示例；
- Prompt Resource contribution 示例；
- Manifest schema/diagnostic 文档；
- 开发态 reload 和实例状态 UI；
- effective grant 与实际注册 surface 检查；
- Package resource preview / PromptBuild trace；
- Marketplace 前的本地 link/install 工作流。

建议优先交付三个极小模板，而不是先做通用插件生成器：

1. `prompt-pack`：无代码，携带 Prompt Resource；
2. `tool-module`：一个 Server Module，注册一个窄 RPC/Tool adapter；
3. `prompt-source-module`：读取已授权领域数据，产出结构化 Prompt Contribution。

每个模板都应能通过同一个验证器输出：Manifest、资源路径、请求 grant、实际 registration、未使用声明、Trace preview 和卸载后保留数据。

---

## 14. 建议的最小贡献模型

以下是研究方向，不是已批准 Schema。

### 14.1 Package 级声明式资源

顶层 `contributes` 只索引不需要执行 Module 的资源，例如：

```json
{
  "contributes": {
    "promptResources": [
      { "id": "author.example.style", "source": "./resources/style.prompt.json" }
    ]
  }
}
```

约束：

- `id` 在 Package 内唯一；
- `source` 必须位于 Package 根内；
- 安装时完成 schema 和引用闭包校验；
- Package Catalog 暴露声明，但不自动 mount；
- 用户导入为独立副本时记录 origin；
- 直接引用 Package resource 时绑定 packageId/version/resourceId。

### 14.2 Module 级运行贡献

需要代码的能力继续放在 `modules[*].contributes`，并要求对应 capability grant。例如 runtime Prompt Source 不应只声明一个名字，还要说明它会读什么领域 scope、产出哪类 Contribution；激活后实际 registration 必须对账。

不建议现在加入：

- 通用 DI Container；
- 任意 Module dependency graph；
- 用户可编程的全局 Context middleware 链；
- 自定义最终 Provider payload executor；
- Package 内再建第二套持久数据库抽象。

### 14.3 Skill 作为分发/激活模式，而不是新事实源

如果 Loom 引入 Skill，建议定义为：

```text
Package Resource
  + name/description/author instructions
  + optional supporting assets
  + optional Tool mount requirements
  -> activation/import policy
  -> PromptBuild Contribution + effective Tool Mounts
```

它不需要成为与 Prompt Resource 平行的永久正文 Store。Skill 的索引 metadata 可来自 Package，用户修改正文后仍由 Prompt Resource/Document 权威保存。

### 14.4 MCP 作为 Tool Provider adapter

MCP 不应直接进入 Kernel 或 Prompt Resource Store。合理接缝是：

```text
Extension / Application MCP Provider
  -> connection owner + credential purpose
  -> discovered Tool/Prompt/Resource capabilities
  -> Tool Definition / Prompt Resource candidate
  -> user grant + mount
  -> live registration state
```

必须先定义：connection owner、parent/child borrow、credential destination、late registration、stale tool、reconnect、dispose 和 UI degraded state。

---

## 15. 分阶段建议

### P0：先完成声明式 Prompt Package 闭环

目标不是 Marketplace，而是让一个无代码 Package 能：

1. 在 Manifest 声明 Prompt Resource；
2. 安装时校验；
3. Catalog 中可见；
4. 用户显式导入或 mount；
5. 经 PromptBuild 进入 Preview/Run；
6. Trace 回链 Package/version/resource；
7. disable/uninstall 后状态可解释。

这是成本最低、风险最小、最符合现有架构的生态起点。

### P1：显式 resource import 与作者诊断

在现有 Prompt Source/Contribution 上增加：

- relative path + stable ID resolution；
- cycle、missing、duplicate、scope denied diagnostics；
- candidate/resolved/read/emitted trace；
- deterministic ordering；
- author preview。

Import 仍不能绕过 Activation、Zone/Slot 与 grant。

### P1：Extension Developer Experience

- `defineServerExtension` 最小示例；
- Manifest schema 和 generated reference；
- dev link/reload；
- desired vs actual state；
- grant/registration diff；
- managed timers/background jobs 或明确禁止模型；
- uninstall data preview。

### P2：Skill packaging

先做只读 Package Skill + Prompt/Tool mounts，不做自动学习、在线市场或任意脚本。验证真实作者需求后再增加 managed skill、project/user shadowing 和 discovery adapter。

### P2：MCP Provider

只有 Tool Registry 能表达 late/stale/degraded，UI 能展示连接 owner，Secret 能绑定 destination/purpose 后再引入。

### P3：Marketplace 与 supply chain

Marketplace 需要单独处理：签名、provenance、版本锁、更新、兼容范围、撤回、恶意包警告、审计报告和 rollback。它不是 Extension Host 的一个下载按钮。

---

## 16. 明确不应照搬

- 不把 OMP 的同进程 Extension API 当作安全沙箱；
- 不允许 Package 获得整个 Application Runtime、Kernel、SQL 或 Store；
- 不把 Pulsar `manifest.json` 复制成 Loom Package Manifest；
- 不把 `CTX_BUILD`、`before_char`、`depth:K` 等具体容器名写进平台核心；
- 不让 Plugin script 自行成为最终 Provider payload 的唯一权威；
- 不把 Tool、Prompt、Skill、Hook、MCP 合并成一个无类型“资源”；
- 不让 import 自动等同 activate + read + inject；
- 不依赖中文 Diagnostic 文案决定是否阻塞；
- 不使用 denylist 从全量 API 中删除少数危险方法；
- 不给 `read` grant 混入 write/remove/run；
- 不让 project-local Package 自动启用；
- 不在卸载代码时默认删除 durable Package data；
- 不在没有 Worker/进程隔离时宣称支持不可信代码；
- 不为尚未出现的依赖需求预建通用 DI、Module graph 或复杂 resolver。

---

## 17. 开放问题

1. Package Prompt Resource 是直接只读引用，还是安装时 materialize 到 Prompt Resource Store？建议先支持只读 Package source + 用户显式导入副本，两者 provenance 分开。
2. 同一 Package version 升级后，用户 mount 应追随 compatible resource，还是固定旧 digest？需要产品选择。
3. Package-owned data 在卸载后保留多久，UI 在哪里展示 orphaned package data？
4. 卸载后保留的 enabled/grant 在 reinstall 或 upgrade 时何时可以继承？判断连续身份至少需要哪些 provenance？
5. 一个 Package 的多个 Module 是否共享 Prompt Resource adapter？建议 Package resource 共享，runtime registration 仍按 Module 独立。
6. Client contribution 采用 Direct、Shadow DOM、iframe 还是 Worker？当前没有证据支持提前统一。
7. 哪些 Context middleware 必须由第一方保留，哪些可开放为高权限 Extension Pass？
8. MCP credential 由 Package、Module、Workspace、Agent Session 还是用户全局拥有？
9. Skill 是用户显式调用、模型自动发现，还是两者都支持？其短描述注入的 token budget 如何治理？
10. Package source 不可用时，Portable Payload、用户副本和历史 PromptBuild trace 如何展示 degraded provenance？

---

## 18. 关键证据索引

### 18.1 oh-my-pi

- Extension 作者 API与生命周期：`docs/extensions.md`；
- Extension discovery、优先级、disabled 与 package manifest：`docs/extension-loading.md`；
- Context Files 与多 provider discovery：`docs/context-files.md`；
- System Prompt override/append：`docs/system-prompt-customization.md`；
- Skills frontmatter、发现、collision 与按需读取：`docs/skills.md`、`packages/coding-agent/src/extensibility/skills.ts`；
- Hooks context/tool interception：`docs/hooks.md`、`packages/coding-agent/src/extensibility/hooks/`；
- MCP connection/reconnect/dispose：`docs/mcp-runtime-lifecycle.md`、`packages/coding-agent/src/mcp/`；
- Marketplace schema与 scope：`docs/skills/authoring-marketplaces.md`、`packages/coding-agent/src/extensibility/plugins/marketplace/`。

### 18.2 PulsarAI

- Plugin model/conventions：`src/features/Resources/Plugin/domain/plugin-types.ts`；
- editable manifest：`domain/plugin-manifest.ts`；
- resource/container/import contract：`src/features/Resources/Plugin/插件系统.md`；
- resolver：`application/plugin-reference-resolver.ts`；
- Generation environment：`application/plugin-generation-environment.ts`；
- built-in pipeline：`builtIn/core/generate.js`、`default.chat.json`、`containers.json`；
- Plugin lifecycle/delete：`application/plugin-store.ts`、`application/plugin-persistence.ts`；
- Sandbox：`src/features/Sandbox/domain/sandbox.ts`、`sandbox-globals.ts`、`global-capabilities.ts`；
- Conversation generation：`src/features/Resources/Conversation/application/conversation-generation.ts`。

### 18.3 LoomStudio

- Package / Module / Instance：`docs/architecture/extensions/README.md`；
- Manifest 与 SDK：`packages/extension-sdk/src/index.ts`；
- Host registration/grant/scope/disposal：`packages/extension-sdk/extension-host/src/index.ts`；
- Package discovery/install/uninstall：`apps/studio-server/src/extensions/`；
- Prompt Resource：`packages/prompt-resource-store/src/types.ts`、`store.ts`；
- PromptBuild authority：`docs/architecture/application/prompt-build/README.md`；
- Prompt Source/Contribution pipeline：`packages/application-runtime/src/prompt-build-pipeline.ts`；
- Activation：`packages/application-runtime/src/prompt-activation.ts`；
- Agent Tool Registry/Mount：`packages/application-runtime/src/agent/tool-registry.ts`、`tool-prompt-build.ts`。

---

## 19. 两轮独立审计后的修订结论

首轮完成三方 producer -> consumer 对照；第二轮分别从 OMP、Pulsar 与 Loom 基线反向证伪，并修正了以下关键误读：

- OMP 的生态优势来自 capability discovery 和作者 API，不来自统一强 Manifest 或 Extension sandbox；
- OMP Plugin Prompt 存在“发现但未接入活跃 PromptTemplate 消费链”的断层，`/reload-plugins` 也不是 resident code 热卸载；
- Pulsar 的 `manifest.json` 是设置 schema，Container/CTX 是惰性索引，最终 Context authority 在 generate script；
- Pulsar resource metadata 混合 resolved/imported/compiled/read，不能写成严格实际读取 Trace；effective visible Plugin 也不等于 `enabled === true`；
- Pulsar `plugin.createGlobal/update/restore` 已确认对 generatePath、Action、自定义 Tool 与 CodeAct 可达；
- Loom 的 Prompt Resource、PromptBuild 与 Extension Host 已经覆盖大部分治理概念，不应再造平行 CTX/Registry；
- Loom 当前 RPC/Event 才有完整的声明/注册对账；Client Host、Extension Prompt/Tool/Skill/MCP contribution 尚未实现；
- Loom working tree 的 Storage/Portable Payload 不是 stable HEAD，也不是 per-Module grant；
- Loom uninstall 会保留 desired state/grant 和 durable data，同 ID 重装可能自动激活，必须在 Marketplace 前引入 provenance 复核与显式 reset/purge 语义；
- Loom 最值得补的是 Package Prompt contribution、显式 import、DX、Marketplace 前置治理和卸载数据语义。

第二轮没有推翻本文主路线：Loom 不缺第三套 Plugin/CTX 抽象；它缺的是把 Package 声明式资源和 Module 动态贡献接入现有 PromptBuild、Tool Registry 与 Instance lifecycle，并把 code removal、desired state、durable data 与 portable payload 拆成不同操作。
