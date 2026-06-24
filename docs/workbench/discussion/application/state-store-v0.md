# Unified State Store (Variable System) v0

> **状态**：开放设计
> **来源**：2026-05-30 Discussion

---

## 1. 核心定位与背景

在早期的生态（如 ST 生态）中，系统缺乏独立的状态/变量库，导致大量插件或预设作者被迫将变量、Schema 以及宏语法注入强行塞入到“世界书（Worldbook）”条目中（例如通过假的、常时激活的 Worldbook Entry 来携带 JSON 或 YAML 声明，再通过冗长难用的嵌套宏提取）。

**State Store 的目标：**
将动态的数值、可变状态、模板 Schema 与“静态设定文本（Setting Store）”彻底剥离。
状态库（State Store）是一个带有层级命名空间、支持 Schema 校验，且独立于文本设定层，但被 Prompt Builder 深度依赖的**响应式状态库**。

---

## 2. 作用域分类 (Scopes)

所有的变量在底层统一存放于 State Store，并根据 Scope（命名空间/作用域）进行隔离寻址。

*   **Context Scope (全局/系统上下文)**
    *   例如：`user.name`, `char.name`。
    *   这类变量属于只读环境变量，通常由应用配置或会话初始条件注入，Agent 大多数情况下不可修改。
*   **Global Scope (全局/世界场景状态)**
    *   例如：`scene.weather`, `world.day_count`。
    *   作用于整个 Session，用于维系剧本进度和总体环境。
*   **Entity Scope (局部/实体动态状态)**
    *   例如：`alice.hp`, `alice.mood`, `alice.status_effects`。
    *   依附于具体 Entity（人物、地点等），各个实体拥有独立的命名空间，避免同名字段互相覆盖。

---

## 3. 多 Schema 模板机制与前端注册

为了彻底取代在“世界书文本”里用 YAML 手写 Schema 的做法，LoomStudio 原生引入**基于组件的变量视图**：

### 3.1 预设与卡片的独立视图
角色卡和预设拥有专门的「变量/状态」面板（UI），无论是手动填表还是上传配置文件，变量定义和初始化完全剥离于设定正文。

### 3.2 面向对象的 Schema 抽象
作者可以定义多套模板（Schema）：
```yaml
# NPC Schema 示例
schema:
  hp: { type: number, default: 100, max: 100, min: 0 }
  mood: { type: string, default: "calm" }

# Shop Schema 示例
schema:
  gold_reserves: { type: number, default: 1000 }
```
当实例化具体对象时，可直接继承对应的 Schema 进行初始化。ECS 底层会将其映射为对应的 `VariableSchemaComponent`。

### 3.3 自动推导注册 (Lazy / Fallback Initialization)
为了照顾普通作者的纯文本编写习惯，支持在文本宏中顺手声明：
```text
{{ writing_style | default: '金庸风格' }}
```
解析引擎首次遇到时，如果 State Store 无此键，会自动创建并赋初始值。这就平滑替代了旧时代 `{{setvar:}}` 每次渲染都重置的缺陷。

---

## 4. 宏与 Prompt Builder 注入逻辑

**宏（Macro）根本不应该是一种独立的变量类型，它仅仅是一种「文本注入语法」（Injection Syntax）和交互方式。**

*   **真正的表达式引擎**：
    底层采用标准的模板引擎（如 Handlebars 或类似解析器），摒弃旧时代 `{{get_message_variable::stat_data.{{user}}.人格魅力}}` 的扭曲反人类嵌套。
    支持优雅的对象属性与作用域访问：
    ```text
    {{stat_data[user.name].人格魅力}}
    {{user.人格魅力}}
    ```
*   **注入过程分离**：
    Prompt Builder 作为独立的组装管线，遇到 `{{alice.hp}}` 时，会直接调用 State Store 读取该值进行文本插值。
    第三方插件（如 Engram）想要注入，直接通过 `PromptBuilder.registerProvider('MemorySlot', data)` 挂载槽位，彻底废除用“空头世界书”作为注入通道的丑陋生态。

---

## 5. Agent 交互与前后端数据流

### 5.1 Agent 交互 (JSON Patch)
大模型不需要知道底层 SQL 的结构，统一提供一个专门的标准化 JSON Patch Tool 供其操作变量：

**Tool Name**: `patch_state` (基于 RFC 6902 JSON Patch)
```json
{
  "name": "patch_state",
  "arguments": {
    "patches": [
      { "op": "replace", "path": "/entities/alice/hp", "value": 15 },
      { "op": "add", "path": "/entities/alice/status_effects/-", "value": "bleeding" }
    ]
  }
}
```
后端收到请求后，必须先经过 Variable Schema 校验合法性（例如校验 HP 数值未超过 Max 上限），校验通过后再持久化写入 SQL。

### 5.2 前后端通信层 (REST + SSE)
客户端与后端的同步闭环完全由标准 API 与事件流组成：

*   **初始加载 (REST GET)**：
    用户进入会话时，前端发送 `GET /api/sessions/{session_id}/state` 进行全量或分页拉取。利用 REST 完美的缓存和语义表达能力，确保首屏加载极快。
*   **前端主动修改 (REST PATCH)**：
    用户在 UI 直接修改某项变量时，前端发送 `PATCH /api/sessions/{session_id}/state` 给后端。
*   **后台响应式同步 (SSE / WebSockets)**：
    由于 Agent（或后台规则引擎）可能随时通过 Tool Call 隐性修改变量，为了保持前端状态最新，后端在持久化状态修改后，会通过 Server-Sent Events (SSE) 或 WebSocket 单向给前端下发对应的 Patch 补丁包。
    前端状态树（如 Redux / Zustand）直接 apply patch，实现界面的无刷新热更新（比如让 UI 上的 HP 血条立刻扣除）。

---

## 6. Discussion Capture: State Store 不承载“慢变量” (2026-05-30)

### 6.1 核心判断

不要为了 UI 展示、宏读取或统一寻址，把低频稳定设定提升成 State Store 变量。

```text
不应进入 State Store 的典型内容:
  人设、性格、年龄、长期关系、写作风格、背景设定。

应该留在 Setting Store:
  低频修改、适合总结阶段更新、需要作者排序和设定树管理的内容。
```

这些内容即使需要 UI 展示或模板读取，也可以通过统一寻址 / Binding / Setting projection 访问，不需要成为变量。

### 6.2 State Store 的合理边界

State Store 应聚焦高频、结构化、需要即时 patch / 校验 / 响应式 UI 的状态：

```text
- HP / MP / 金币 / 回合数
- 临时 flag
- 状态效果
- 当前地点 marker
- 需要规则系统即时读取和 JSON Patch 修改的值
```

如果某个值只会在总结阶段由 Agent 修改，或它更像一段设定文本，那么它属于 Setting Store。

### 6.3 避免第二套世界书

State Store 的目标不是发明一套"慢变量世界书"。

```text
Setting Store:
  管稳定设定、文本内容、作者排序、绿灯动态挂载。

State Store:
  管高频状态值、schema 校验、patch、响应式同步。
```

统一寻址层负责让上层不关心数据来自哪个 store，但不意味着两个 store 的语义边界消失。
