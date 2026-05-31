# AIRP Extension Contribution v0

> **状态**：Open Design  
> **主题**：Extension 如何贡献 Studio Application 领域能力。

---

## 1. 核心判断

Extension 可以贡献内容和能力，但不能绕过 Application Layer 的受控路径。

```text
Extension 贡献的是:
  内容（Setting entries、Memory entries）
  能力（Tool、Source Adapter、Pass）
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
  Extension 注册的 Transform Rule 进入指定 phase。
  遵循 Transform Rule System 的作用域和权限。
  Rule 执行进入 Trace。
```

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
