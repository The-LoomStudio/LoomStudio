# Window Layout

> **状态**：已实现的前端架构合同。共享 `WindowColumnLayout` 与 `ColumnSplitter` 已接入 Studio Rail / Panel Host 和 Asset Explorer / Detail；Overlay Layer 仍只定义空间边界，尚未建立通用注册系统。

## 1. 空间模型

Window 内只保留两种空间关系：参与平行宽度分配的 `Column Layout`，以及覆盖在 Column 上方的 `Window Overlay`。

```text
Window
├── Column Layout Layer
│   ├── Column
│   ├── Column Splitter
│   ├── Column
│   └── ...
└── Window Overlay Layer
    ├── Header Overlay
    ├── Bottom Overlay
    ├── Sidebar Overlay
    └── ...
```

Column Layout 占满 Window 的可用主体空间。Overlay 不进入 Column 的 Grid Track，不因自身打开、关闭或改变尺寸而重排 Column。

## 2. Column Layout

`Column` 是 Window 内唯一参与水平平行布局的对象。布局系统不读取 Column 内容的业务身份，只管理列与列之间的宽度关系。

下列内容都可以成为 Column 的内容：

- 功能导航 Rail；
- Asset Explorer；
- Detail Panel；
- 编辑器；
- 长期并列的左侧或右侧 Sidebar；
- 未来由插件贡献的 Panel 内容。

二列、三列和四列使用同一个 Column Layout，根据可见 Column 数量生成对应 Grid Track，不建立 `TwoColumnLayout`、`ThreeColumnLayout` 等平行组件。

至少一个 Column 应作为 Fill Column 消费剩余宽度。其他 Column 可以声明当前宽度、最小宽度、最大宽度，以及可选的折叠宽度和吸附阈值。Column Layout 保持受控，不自行决定业务状态或持久化位置。

Column Layout 区分用户请求宽度与当前有效宽度。Window 空间不足时，布局可以按 Column 的压缩优先级临时缩小或折叠 Column，但不得把临时有效宽度写回持久化偏好；Window 重新变宽后应恢复用户请求宽度。

建议代码词：

```text
WindowColumnLayout
WindowColumn
ColumnId
ColumnSize
ColumnLayoutState
```

## 3. Column Splitter

相邻 Column 之间由 `ColumnSplitter` 调整边界。Splitter 只知道相邻列和宽度约束，不知道两侧内容是 Rail、Explorer、Detail 还是其他 Panel。

Splitter 必须支持：

- Pointer Capture 拖拽；
- 键盘方向键调整；
- `Home` / `End` 到达允许边界；
- `role="separator"`、方向和当前值；
- 最小、最大宽度约束；
- 可选的折叠吸附；
- 拖拽期间关闭影响命中与跟手性的布局动画。

Splitter 的视觉分割线可以保持 `1px`，但交互命中区域必须更宽。拖拽不能成为改变布局的唯一方式，业务界面仍可提供视图快捷按钮。

## 4. Window Overlay

Header、Bottom 控件或临时 Sidebar 如果覆盖在 Column 上方且不改变其他列宽度，则属于 `Window Overlay`，不是 Column。

判断标准是空间行为，而不是控件名称：

| 行为 | 布局身份 |
| --- | --- |
| 与其他内容并列，共同分配 Window 宽度 | Column |
| 覆盖内容，不改变 Column 宽度 | Window Overlay |
| 长期并列的右侧 Sidebar | Column |
| 临时覆盖的右侧 Sidebar | Sidebar Overlay |

Overlay 不直接压缩 Column。需要避免末尾内容、焦点目标或滚动锚点被遮挡时，由 Window 或内容滚动容器消费 Overlay 暴露的 Safe Area，例如 `scroll-padding` 或末尾 clearance；Safe Area 不改变 Column 几何。

## 5. Narrative 默认 Placement

Studio Shell 从 Chat Composer 外框和未展开 Agent 时的 Composer Base 读取三个实时锚点：Narrative 左边缘、Narrative 右边缘和 Composer Base 顶边。默认 Reference Window 使用锚点计算几何，不再通过固定 `vw`、输入框估算高度或硬编码像素逼近正文。

默认 Placement 分为：

| Placement | 水平范围 | 默认 Panel |
| --- | --- | --- |
| `beside-narrative` | 屏幕左边缘到 Narrative 左边缘 | Model、Character、Settings |
| `cover-narrative` | 屏幕左边缘到 Narrative 右边缘 | Preset、Resource、Inspector、Logs |

两者的垂直范围都是 Window 顶部间距到 Composer Base 顶边。Agent 展开不改变该底部锚点。用户显式 Resize 后保存的 Window Size 优先于默认 Placement；Immersive Mode 继续覆盖 Reference Placement。

## 6. 资源工作台映射

资源页的 `explorer`、`split` 和 `editor` 是领域视图动作，负责选择可见 Column 组合，不拥有独立的拖拽体系：

| 资源视图 | 可见 Column |
| --- | --- |
| `explorer` | Explorer Column |
| `split` | Explorer Column + Detail Column |
| `editor` | Detail Column |

资源页左上角的三个按钮只改变 View State。Column Layout 根据 View State 生成列与 Splitter；Explorer 宽度仍属于本地布局偏好，可以由 Zustand 持久化。

Studio 工作窗口使用相同机制表达 Rail Column 与当前 Panel Column。Rail 收到最小端时可以吸附为纯图标宽度；该行为是 Rail Column 的约束配置，不是 Column Layout 内置的业务规则。

## 7. 状态与响应式边界

Column Layout 只接收受控宽度并报告变化。具体 Store 决定宽度字段、持久化键和恢复策略；浏览器存储损坏或旧版本缺少字段时必须回退到安全默认值。

桌面持久化宽度不能直接决定移动端布局。窄屏可以隐藏、堆叠或覆盖某些 Column，但响应式策略属于 Window 或业务界面，不进入通用 Splitter 算法。

## 8. 当前非目标

本合同暂不定义：

- 纵向 Row Split；
- Column 内任意递归嵌套；
- 平铺树或 Niri 风格多 Window 管理；
- 跨 Window 拖动 Column；
- Header、Bottom 和 Sidebar Overlay 的通用注册系统。

出现真实消费者后再扩展这些能力，不为可能性预建完整 Workbench Framework。
