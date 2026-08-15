# AIRP Extension Contribution v0

> **状态**：Open Design  
> **主题**：Extension 如何贡献 Studio Application 领域能力。

---

## 1. 核心判断

Extension 可以贡献内容和能力，但不能绕过 Application Layer 的受控路径。

```text
Extension 贡献的是:
  内容（Setting entries、Memory entries）
  Agent Preset
  能力（Tool、Context Source、Source Adapter、Runtime Driver、Pass）
  规则（Transform Rule、Activation Rule）
  UI（Panel、Editor、Command）

Extension 不能:
  直接修改 canonical data
  绕过 Permission / Consent
  绕过 commit 路径写入 Narrative Timeline
  直接修改 compiled prompt payload
  在任意位置运行 Transform Rule
```

---

## 2. 贡献接口（候选方向）

### 2.1 内容贡献

```text
manifest declares:
  contributes.settingEntries: [...]
  contributes.memoryEntries: [...]

Runtime:
  Extension 注册的 entries 进入 Setting Layer / Memory。
  遵循 Setting Layer 的 source / visibility / lifecycle 规则。
  可被 Agent search 检索。
  可被 Prompt Builder 投影。
```

### 2.2 Tool 贡献

```text
manifest declares:
  contributes.tools: [...]

Runtime:
  Extension 注册的 Tool 进入 Agent 可用工具集。
  遵循 Permission / Consent 策略。
  Tool 调用产生 ToolCall / ToolResult transcript entries。
  可被 Trace 追溯。
```

### 2.3 Source Adapter 贡献

```text
manifest declares:
  contributes.sourceAdapters: [...]

Runtime:
  Extension 注册的 Source Adapter 进入 Prompt Builder 可消费的 source。
  Source Adapter 产出 Composition Fragment[]。
  Fragment 遵循 Prompt Builder convention。
```

### 2.4 Transform Rule 贡献

```text
manifest declares:
  contributes.transformRules: [...]

Runtime:
  Package 携带的声明式 Transform Rule 进入统一资源层。
  Card、Preset 或 Runtime Binding 按资源 ID 启用规则。
  遵循 Transform Rule System 的作用域和权限。
  Rule 执行进入 Trace。
```

普通 Regex Rule 是资源配置，不是 Extension Module 或可执行脚本。它由平台内置 Transform Rule System 执行，不需要 `activate(ctx)`。

Extension Module 只在需要新 matcher / transformer kind 时注册实现能力。规则资源可以引用该 kind；对应 Module 缺失或禁用时保持 unresolved，并产生 Diagnostic。导入规则资源不得隐式安装、启动 Extension 或授予权限。

### 2.5 AI Capability / SubAgent 贡献

Extension 可以贡献独立 AI 能力或子 Agent，但不应绕过平台 AI Gateway 和 Runtime Context Projection。

典型例子：

```text
NovelAI 生图插件:
  - 注册 image generation capability；
  - 在自己的 UI 中查询平台 ModelProfile 列表；
  - 保存用户选择的 modelProfileId；
  - 使用自己的 preset / tag builder；
  - 请求当前 Session / Branch 的受控上下文投影；
  - 调用 AI Gateway；
  - 将输出作为 ArtifactCandidate / CommitCandidate 进入受控路径。
```

Extension 不需要也不应该：

```text
重新保存 provider API key；
重新实现 provider profile；
直接读取所有 Narrative Timeline / Setting Layer；
绕过 AI Gateway 直接请求外部模型；
绕过 commit path 把结果写入正文或资产库。
```

这类能力可以被插件自己的 UI 使用，也可以注册为其他作者界面可调用的能力，例如：

```text
generate portrait
generate background
generate scene illustration
```

平台负责能力注册、权限、上下文投影、Gateway 调用和结果写入边界；插件负责自己的领域逻辑、prompt/tag builder 和 provider-specific adapter。

### 2.6 Agent Preset 贡献

Extension 可以用文件贡献一个或多个 Agent Preset。候选约定：

```text
manifest declares:
  contributes.agentPresets:
    - id: tattoo-designer
      source: ./agents/tattoo-designer.agent.json
```

`*.agent.json` 是候选分发文件名，正式字段和版本尚未确定。

Extension 贡献的 Preset 与用户创建的 Preset 使用同一种 Agent Preset 模型。它可以引用该 Extension 同时贡献的 Tool、Context Source 或 Runtime Driver，但不能借此绕过正常注册和权限边界。

Preset 文件不保存：

- API Key；
- 本地 `modelProfileId`；
- 已授予权限；
- 当前 Narrative Timeline 或 Agent Session 实例；
- Extension 私有安装路径。

依赖处理：

```text
Preset references Extension contribution
  -> dependency available and enabled: resolve normally
  -> dependency missing or disabled: keep unresolved
  -> show missing dependency to user
```

平台不能因为打开或导入 Preset 就自动安装 Extension、激活代码或授予权限。

### 2.7 Runtime Driver 贡献

Extension 可以贡献特化的 Step.kind 与推进逻辑，用于实现特定 Agent 工作方式。

Runtime Driver 必须：

- 使用有 owner 的命名空间注册；
- 声明能够恢复和处理的 Step kinds；
- 通过正式 Tool / Mutation API 读写数据；
- 服从 Run 预算、取消和权限；
- 缺失时让相关 Step / Agent Preset 保持 unresolved，而不是猜测执行。

---

## 3. 命名空间与冲突

Extension 贡献的内容和能力需要命名空间隔离。

```text
Extension ID:
  作为贡献内容的 namespace prefix。

冲突处理:
  同一 slot 多个 Extension 贡献内容的合并策略。
  同一 Tool name 的冲突检测。
  同一 Source Adapter kind 的注册冲突。
  同一 Agent Preset ID / Step kind / Runtime Driver 的注册冲突。
```

开放问题：

- 命名空间规则的具体约定；
- 冲突检测是 manifest-time 还是 runtime-time；
- 用户如何查看和管理 Extension 贡献。

---

## 4. 与平台层 Extension 的分工

```text
平台层 Extension:
  注册 RPC、Document Type、Pass、Event、Capability。
  不理解 AIRP 领域语义。

Application Layer Extension Contribution:
  定义 RPC 的 AIRP 语义约定。
  定义 Document Type 的 AIRP schema 约定。
  定义 Source Adapter、Tool、Transform Rule 的 convention。
```

平台层提供注册机制，Application Layer 定义语义约定。

---

## 5. 非目标

本文件不定义：

- Kernel Extension 注册机制；
- Extension sandbox / isolation；
- Extension market / distribution；
- Extension 热加载 / 卸载；
- 完整 manifest schema。

---

## 6. 开放问题

1. Extension 贡献的 Setting entries 是否需要用户确认才能进入 canonical data？
2. Extension Tool 是否需要单独的权限配置？
3. Extension Source Adapter 的输出是否需要校验？
4. Extension Transform Rule 的执行顺序如何确定？
5. 多个 Extension 贡献同一 slot 内容时的合并策略？
6. Extension 贡献的 UI 面板如何与 Studio AIRP UI 集成？
7. Extension 贡献的 Memory entries 是否对 Agent 可见？
8. `contributes.agentPresets` 的正式 manifest schema 和版本规则是什么？
9. Runtime Driver 的恢复兼容性和卸载边界如何验证？

---

## 7. Discussion Capture: 纯 JS 脚本作为轻量交互层 (Interaction Layer) (2026-05-30)

### 背景
在早期的社区生态（如 ST）中，作者往往使用 EJS 等模板语言嵌入在“世界书”中，以实现复杂的逻辑判定（如好感度分支、动态激活）。这不仅导致文本与代码严重耦合，还产生了极大的编写心智负担。
为了解决“变量状态（State Store）”与“静态设定（Setting Store）”之间的交互联动，我们决定放弃构建复杂的 JSON 可视化规则引擎，转而拥抱真正的编程语言（JavaScript）。

### 核心决议：Scriptable Rules
将基于受控沙盒执行的**纯 JS 脚本**作为统一的逻辑交互层，将其视为一种**轻量级的本地 Extension（脚本插件）**。

#### 场景 1：动态激活控制 (JS as Activation Rule)
作者（或 Agent）无需配置复杂的 JSON 条件表达式，而是通过编写简单的 JS 脚本来贡献 `Activation Rule`。
```javascript
export function checkBloodlust(state) {
  // 从 State Store 获取变量并执行任意复杂的逻辑判定
  return state.get('alice.hp') < 20 && state.get('scene.location') === '王都';
}
```
引擎在 Activation Pass 时执行此沙盒函数，精确控制对应 Setting Entry 的状态。

#### 场景 2：动态文本注入 (JS as Source Adapter)
当需要根据复杂的 if-else 或 switch-case 分支动态生成提示词时，脚本可作为 `Source Adapter` 贡献点。
```javascript
export function injectWeather(state) {
  const weather = state.get('scene.weather');
  switch(weather) {
    case 'rain': return '大雨倾盆，路面泥泞不堪。';
    case 'snow': return '鹅毛大雪漫天飞舞。';
    default: return '';
  }
}
```
其返回值通过 Prompt Builder 的预设槽位直接注入，彻底取代在世界书正文中强行嵌入 EJS 的脏代码生态。

### Agent 辅助开发
结合 LoomStudio 的 Agentic 特性，普通作者无需亲自编写上述 JS。作者只需用自然语言描述逻辑（如：“当金币少于100时触发贫困描写”），内置 Agent 即可自动生成 JS 脚本并完成挂载。底层图灵完备，表层零代码。

### 安全约束 (Sandbox)
由于直接执行逻辑，该交互层的 JS 必须运行在严格的 Sandbox（沙盒）中。脚本仅能执行无副作用的逻辑运算（Pure Function）并对 State Store 进行只读访问（Read-only）。严禁脚本直接发起网络请求、包含死循环，或绕过受控路径直接修改底层数据库（任何状态的变更必须通过 Agent 主动调用的 `patch_state` Tool 来执行）。
