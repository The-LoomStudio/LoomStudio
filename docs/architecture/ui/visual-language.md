# Visual Language

## 1. 定位

Studio 默认 UI 是面向长时间阅读、对话和提示词创作的平面编辑式工作台。视觉秩序主要由表面色、排版、留白和对齐建立，而不是由卡片、阴影和完整边框建立。

默认主题采用 Catppuccin Mocha 方向的暗色体系，主强调色为紫色。暗色不等于纯黑，正文也不使用纯白。

## 2. 表面层级

当前主要表面语义为：

```text
Background:
  应用和默认聊天背景，使用 --loom-color-background。

Surface:
  Window、Panel、用户消息等主要内容表面，使用 --loom-color-surface。

Subtle / Inset / Emphasis Surface:
  编辑器、代码块、元信息或需要与父表面区分的局部区域。

Raised Surface:
  Dialog、Popover、Context Menu 和 Toast 等 Top Layer 内容。
```

颜色 Token 只表达视觉层级，不按 Window、Panel、Dialog 等 UI 对象命名。对象名称继续用于布局、尺寸和圆角等几何 Token。

聊天流默认直接铺在 Base Canvas 上，不额外制造聊天容器边框。用户消息可以使用浅色气泡，Assistant 正文保持接近文档流。

## 3. 视觉约定

默认产品语言遵循以下约束：

- 不给浮动面板添加阴影或发亮外框；
- 不用贯穿容器的边框表达每一级布局；
- 必须分区时使用有上下或左右内距的短分割线；
- 圆角用于可交互区域和局部表面，不把所有内容包装成卡片；
- Hover 优先高亮图标与标题文字，不默认点亮整块背景；
- 选中、焦点、危险、成功等状态使用语义色，不只依赖亮暗差异；
- 图标默认使用细线图标，并通过共享尺寸和 stroke token 保持一致；
- 界面文案不使用斜体。斜体仅可出现在用户内容的语义渲染中。

## 4. 排版与密度

导航和工具界面的目标是紧凑、稳定、可扫读：

- 图标、标题和 Header 使用共享对齐基线；
- 导航标题字号小于图标视觉尺寸；
- 间距与图标尺寸联动，避免状态切换时图标横向跳动；
- 元信息弱于正文，但仍满足可读对比度；
- 长文本编辑器优先保证正文宽度、行高和底部可滚动留白；
- 行号与正文使用相同字号和行高，当前光标范围的首尾行号可被强调。

当前排版基础由共享字体族、八级字号、保持既有值的字重等级和常用行高 Token 提供。默认正文使用操作系统 UI 字体，不加载产品自有字体；等宽内容使用系统等宽字体栈。Markdown 与错误页等内容型宿主可以保留相对标题或 Display 比例，不要求机械映射到普通 UI 字号等级。

固定像素可用于细线、图标和最小点击目标等局部标定；窗口宽度优先使用视口相对约束和上下限，避免只适配开发机屏幕。

## 5. 交互与动画

动画只服务于空间关系和状态连续性：

- Dock 与目录开合可以使用短暂位移、宽度或透明度过渡；
- Hover、选择和按钮反馈应快速，不延迟操作；
- 不为装饰持续运行动画；
- 动画不得改变稳定对齐点，尤其是 Menu、Header 和导航图标位置；
- `prefers-reduced-motion: reduce` 下关闭非必要过渡。

当前实现已有局部 reduced-motion 覆盖，但这不是对所有组件已经完成审计的声明。新增动画必须同时提供 reduced-motion 行为。

## 6. Dialog 与破坏性操作

Studio 的通用 Dialog 基于浏览器原生 `<dialog>`，用于阻断当前流程的确认、警告和短表单。原生 Top Layer、焦点约束、Escape 与背景 inert 是组件合同的一部分，不再由各 Feature 重复模拟。

Dialog 不等于删除按钮的默认包装。是否确认由可恢复性和影响范围决定：

- 可以由 Undo 完整恢复的资源条目、正文和局部编辑直接执行；
- 删除整个角色卡、资源包、Session、Provider Account 或其他大范围持久化对象需要 Dialog；
- 特别危险且不可恢复的工作区级清空未来可以增加名称输入确认，但当前不提前实现；
- Bottom Sheet、Popover、Context Menu 和 Toast 不迁入 Dialog。

当前通用 Dialog 支持受控开关、标题与描述语义、可选 backdrop 关闭、不可中断状态和焦点恢复。Feature 只提供领域文案与操作按钮，不复制 backdrop、动画和布局 CSS。

## 7. 通知反馈

Studio 使用 Sonner 渲染右下角 Toast。通知层位于 Workspace 之外，并根据 Composer 的实际高度上移，不能遮挡当前输入区域。

当前只把全局异步错误接入 Toast。错误事件携带 `scope` 和单调递增的 `sequence`，因此连续发生的相同错误仍能被识别，旧读取响应也不会制造过期通知。

边界约定：

- Sonner 只是 Client Toast renderer，不是 Notification 领域协议或日志 Sink；
- 字段校验、编辑器反馈和当前操作附近的状态继续原位显示；
- Error Boundary 继续使用完整恢复页面；
- 普通 Log、pending 状态和高频成功操作不自动产生 Toast；
- Toast 不承载唯一恢复入口、长文本或完整诊断信息。

## 8. 开放性

默认 UI 应是可删除、可覆盖的基础样式，而不是主题作者必须先拆除的装饰层。视觉效果不应依赖难以发现的伪元素堆叠，也不应通过高 specificity 或 `!important` 锁死。

CSS 公共边界详见 [`css-and-theming.md`](css-and-theming.md)。
