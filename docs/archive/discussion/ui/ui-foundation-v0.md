# UI Foundation v0

> **状态**: Archived / Fully Promoted to Architecture（已由 docs/architecture/ui/visual-language.md 替代）
> **主题**: Studio Application UI 的基础原则，服务默认 AIRP 第一方体验。

---

## 1. 问题

当前 `apps/studio-client` 更接近 POC console。它证明了 RPC 和 Application Runtime 可以连通，但没有定义正式 UI 的基础约束。

如果继续直接在 POC 上加功能，风险是：

- 布局和滚动容器被具体页面临时决定；
- loading / error / dirty 等状态各写各的；
- I18N 和可访问性后补时成本很高；
- Shell 容器、Application UI、Extension panel 的责任边界混淆；
- POC 的调试信息密度被误认为正式产品 UI。

本文先收束第一层原则，不进入组件 API。

---

## 2. 基础立场

### 2.1 默认 AIRP UI 是工作台，不是落地页

默认 AIRP UI 应优先服务长期使用、反复编辑、调试和运行。

它需要：

- 高信息密度，但不能拥挤；
- 稳定的导航和布局；
- 清晰的运行状态；
- 可解释的 prompt / trace / provider / run 结果；
- 支持长文本、长列表和多面板并存；
- 避免营销页式 hero、装饰性卡片堆叠和过大的展示文案。

### 2.2 桌面优先

`07-client` 已经把 Shell 定位为桌面优先。Application UI 应继承这个前提。

当前默认不为移动端压缩正式 Shell。移动端如果出现，应作为独立客户端通过 Transport 接入。

### 2.3 Domain UI 通过 Application RPC 优先

默认 AIRP UI 不应直接把所有 Document 当成裸 JSON 编辑。对于有领域语义的操作，应优先讨论 Application RPC 或 view model。

候选判断：

| 操作 | 倾向 |
|---|---|
| 低层调试、DevTool、raw document inspection | 可以直接看 Document |
| 创建 Card / Session / submitTurn / forkBranch | Application RPC |
| Prompt preview / trace explanation | Application RPC 或专用 projection |
| Provider account / model profile 配置 | Platform/Application RPC，避免 UI 直接处理 secret 明文 |

---

## 3. UI 层级边界

```text
Shell:
  几何、容器、全局命令、主题 token、通用原语。

Application UI:
  AIRP 导航、页面组织、领域状态、默认工作流。

Domain view model:
  把 Card / Session / Run / Trace 等数据整理成可展示结构。

Extension panel:
  在约定槽位内展示扩展 UI，不修改 Shell 几何。
```

Application UI 可以使用 Shell 原语，但不应把业务状态塞回 Shell。

---

## 4. 设计 Token 初始分类

第一版只需要定义 token 分类，不需要确定具体值。

```text
color:
  background / surface / border / text / muted / accent / danger / warning / success

space:
  panel padding / row gap / toolbar gap / dense list row height

typography:
  body / compact / label / code / heading

motion:
  short feedback / panel transition / disabled for reduced motion

z-index:
  shell chrome / drawer / popover / modal / toast
```

原则：

- token 名称应表达用途，不表达颜色；
- Application UI 可以消费 token，不应随意覆盖 Shell 几何 token；
- 颜色不能把整个 UI 压成单一色系；
- 文本大小不要按 viewport width 缩放。

---

## 5. 文案原则

UI 文案应服务操作，不解释系统哲学。

建议：

- 按用户正在做的事命名按钮和菜单；
- 错误文案提供下一步；
- 空状态提示可执行动作；
- 避免在界面里长篇解释架构、协议或快捷键；
- `Settings` 不作为主要 UI 术语，避免和 `Setting Layer` 混淆；应用设置使用 `Preferences`。

---

## 6. 待决问题

1. 默认 AIRP UI 的主导航是以 Card、Session、Project、Run 还是 Workspace 为第一层？
2. POC console 是否保留为 DevTool / Debug Console，而不是逐步演化成正式主页？
3. Application UI 是否需要独立的 view model package？
4. Preferences 的 schema 和 Form View 原语是否要在 Shell 层统一？
5. Trace / Prompt Preview 是否作为 Drawer 默认面板，还是作为 Canvas 类型？

