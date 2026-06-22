# Layout and Scroll Containers v0

> **状态**: Open Design
> **主题**: Studio Application UI 的布局、滚动所有权、可恢复滚动位置和长列表策略。

---

## 1. 问题

Studio UI 会同时出现：

- 左侧资源树；
- 中间 Chat / Editor / Preview / Inspector；
- 底部 Trace / Diagnostics drawer；
- 右侧或内嵌属性面板；
- 长列表、长文本、streaming 输出和虚拟列表；
- 可切换 Session / Branch / Run 的多上下文视图。

如果滚动容器没有统一规则，常见问题会很快出现：

- body scroll 和 panel scroll 混在一起；
- Drawer 展开导致中间内容跳动；
- Chat timeline、Trace timeline、Document list 互相抢滚动；
- 切换 tab / session 后滚动位置丢失；
- streaming 输出自动滚到底，打断用户查看历史；
- 虚拟列表和 sticky header / keyboard focus 冲突。

---

## 2. 布局边界

Shell 负责主几何：

```text
Title Bar / Menu
Activity Bar
Side Panel
Canvas
Drawer
Status Bar
```

Application UI 负责 Shell 槽位内的二级布局：

```text
Side Panel:
  resource tree / session list / filters

Canvas:
  chat timeline / card editor / setting editor / prompt preview / run inspector

Drawer:
  trace / diagnostics / console / provider calls
```

规则：

- Application UI 不修改 Shell 几何；
- 每个区域内部只能有明确的主滚动容器；
- toolbar / header / footer 不参与内容滚动；
- 可 resize 的 panel 必须有 min / max 约束；
- 固定格式 UI 元素要有稳定尺寸，避免 hover / loading / badge 导致布局跳动。

---

## 3. 滚动所有权

初始规则：

| 区域 | 滚动所有者 | 说明 |
|---|---|---|
| Body | 不滚动 | Shell 根节点占满 viewport |
| Side Panel | 当前 panel 内容 | resource tree / list 自己滚动 |
| Canvas | 当前 canvas 类型 | Chat、Editor、Preview 各自独立滚动 |
| Timeline | Timeline 内容 | Narrative / Agent / Trace timeline 各自独立滚动 |
| Overlay | 当前 overlay 内容 | Utility panel 自己滚动，不推动 Canvas |
| Agent Panel | Agent 面板内容 | 工作对话、ToolCall、Action Card 独立滚动 |
| Drawer | 当前 drawer tab 内容 | Trace / Diagnostics 各自滚动 |
| Modal / Popover | 自己滚动 | 不把 body 解锁为背景滚动 |

动工前已定：

```text
body / Canvas / Timeline / Overlay / Agent Panel / Drawer 都有独立滚动所有权。
streaming 自动锚底也按 surface 独立处理，具体规则后续随实现调整。
```

禁止：

- 页面级 body scroll；
- 多层 `overflow: auto` 嵌套但没有明确用途；
- 用 padding / margin 临时补 Drawer 高度；
- 在滚动区域内部放高度不稳定的 sticky 控件。

---

## 4. Chat Timeline 滚动

Chat / Narrative Timeline 是特殊滚动场景。

候选规则：

- 默认进入 Session 时滚到底部；
- 用户手动向上滚动后，streaming 不强制拉回底部；
- 底部出现新内容时显示 jump-to-latest affordance；
- reroll / fork / branch switch 应恢复该 branch 的滚动位置；
- pending assistant output 占位必须有稳定高度或渐进增长策略；
- long message 内部不再创建二级滚动，除非是 code block / artifact preview。

待决：

- 是否需要反向虚拟列表；
- streaming delta 是修改最后一条 message，还是追加临时 segment；
- branch 切换时滚动位置按 `sessionId + branchId + canvasId` 记忆，还是只按 branch 记忆。

---

## 5. 长列表与虚拟化

需要虚拟化的候选：

- Card list；
- Session list；
- Trace events；
- Diagnostics；
- Agent Transcript；
- Document browser；
- Setting Layer 大型树。

不应过早虚拟化：

- 短表单；
- 小型 toolbar 菜单；
- 当前 Session 的少量分支列表；
- 短 Prompt Preview。

虚拟列表必须处理：

- keyboard navigation；
- focus restoration；
- item measurement；
- sticky group header；
- screen reader fallback；
- search / filter 后的滚动恢复。

---

## 6. 待决问题

1. 默认 Canvas 是否允许右侧属性面板，还是只通过 Drawer / split view？
2. Chat Canvas 是否是单独 Canvas 类型，还是 Tab Editor 中的一种 document view？
3. Drawer 打开后是否压缩 Canvas，还是覆盖 Canvas 底部？
4. Trace Viewer 更适合 Drawer、Canvas，还是二者都支持？
5. 需要怎样的 scroll position key 规则来支持 Session / Branch / Run 切换？
