# Extension Contribution 领域文档

> **状态**：Data Foundation Implemented / Remaining Design Capture
> **目的**：集中记录 Studio Application 中 Extension 如何贡献领域能力的设计讨论。

---

## 1. 定位

Extension 是 Loom Studio 的平台层能力，但 Application Layer 需要定义 Extension 如何贡献 AIRP 领域的特定能力。

```text
Kernel Extension:
  平台级扩展机制。
  注册 RPC、Document Type、Pass、Event、Capability。

AIRP Extension Contribution:
  Application 级扩展协议。
  定义 Extension 如何贡献 Setting entries、Prompt source、Tool、Agent 配置、Transform Rule、UI projection 等。
```

二者不是同一层，但前者是后者的物质基础。

---

## 2. 核心问题

> Extension 如何在不侵入 Application canonical model 的前提下，贡献内容、能力和 UI？

需要避免：

```text
Extension 直接修改 canonical data。
Extension 注册的 Tool 绕过 Permission。
Extension 贡献的 Prompt source 无法 Trace。
Extension 的 UI 注入破坏用户体验。
```

---

## 3. 候选贡献点

Extension 可能贡献：

### 3.1 内容贡献

```text
Setting Layer entries:
  插件给某个 subject 贡献设定内容。
  例如角色私有笔记、插件生成的事件。

Memory / Summary entries:
  插件贡献记忆条目。

Narrative entries:
  插件贡献剧情内容（通过 commit 路径）。
```

### 3.2 能力贡献

```text
Tool:
  注册可被 Agent 调用的工具。

Source Adapter:
  注册 Prompt Builder 可消费的 source。

Pass:
  注册 Loom pipeline 可执行的 Pass。
```

### 3.3 规则贡献

```text
Transform Rule:
  注册某个 phase 下的 transform / regex。

Activation Rule:
  注册 Setting Layer 内容的激活规则。
```

### 3.4 UI 贡献

```text
Panel / View:
  注册 Studio AIRP UI 中的面板或视图。

Editor:
  注册特定 Document Type 的编辑器。

Action / Command:
  注册命令面板中的操作。
```

---

## 4. 贡献边界

Extension 贡献的内容和能力必须遵循 Application Layer 的边界：

```text
写入 canonical data:
  必须通过受控路径（commit / state mutation API）。
  不能直接修改 Document Store。

Tool 调用:
  必须经过 Permission / Consent。
  不能绕过 Agent 权限。

Prompt source:
  必须通过 Source Adapter。
  不能直接修改 compiled payload。

Transform Rule:
  必须在受控 phase 中执行。
  不能在任意位置运行 regex。

Trace:
  Extension 贡献必须可追溯。
```

---

## 5. 与 Kernel Extension 的关系

Kernel Extension 机制提供注册和调度基础。

Application Layer 在此之上定义语义约定：

```text
Kernel:
  Extension 可以注册 RPC。
  Extension 可以注册 Document Type。
  Extension 可以注册 Pass。

Application:
  定义 RPC 的语义约定（例如 search tool 的接口）。
  定义 Document Type 的命名空间和 schema 约定。
  定义 Source Adapter 的 convention。
```

---

## 6. 文件列表

| 文件 | 状态 | 主题 |
|---|---|---|
| [`airp-extension-contribution-v0.md`](airp-extension-contribution-v0.md) | Open Design | Extension 如何贡献 AIRP 领域能力 |
| [`extension-module-scenarios-v0.md`](extension-module-scenarios-v0.md) | Partial Implementation | 数据 Capability 与 Client Renderer 已实现；Job 与高级贡献点待讨论 |
| [`card-extension-portable-payload-v0.md`](card-extension-portable-payload-v0.md) | Implemented Foundation | Card 安全携带插件私有配置和初始数据；UI、Asset closure 与二进制待讨论 |
| [`../ui/narrative-inline-rendering-and-render-mount-v0.md`](../ui/narrative-inline-rendering-and-render-mount-v0.md) | Partially Promoted / Core Implemented | Node-bound Extension Record 已可动态贡献消息内 Render Mount；Streaming、Marker 与 Attachment 仍开放 |

---

## 7. 相关文档

- [`../agent/tool-capability-v0.md`](../agent/tool-capability-v0.md) — Tool / Capability
- [`../agent/permission-consent-v0.md`](../agent/permission-consent-v0.md) — Permission / Consent
- [`../prompt/README.md`](../prompt/README.md) — Prompt Builder 领域
- [`docs/architecture/extensions/`](../../../../architecture/extensions/) — 当前平台层 Extension 架构
