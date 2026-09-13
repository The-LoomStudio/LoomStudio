# The World 运行面板与全局天色迁移审计（v0）

> 状态：仅完成源码调研与迁移设计，未在本稿完成代码修复。
> 
> 目的：解释 ST The World 为什么能同时显示原页面、天色背景、毛玻璃材质和运行面板，并给出 Loom Studio 的对应实现路径。本文针对 2026-09-14 运行面板打开后出现整页深色遮罩、主应用内容消失、面板颜色没有随天色同步的问题。

## 1. 当前可复现现象与判断

截图中的深色区域不是 The World 面板本体，而是全屏渲染层或原生 dialog 背景在页面层级中覆盖了主应用。运行面板本身只应占据右上角的矩形区域；空白区域必须透明且可穿透。

当前 Loom 实现把 `shell.focus-surface` 渲染为一个全视口 `<dialog>`，再把扩展 Renderer 挂在其内部。即使 The World 使用 `dialog.show()`，仍然存在三条需要同时满足的链路：

1. `dialog` 和 Surface Host 的空白区域必须 `pointer-events: none` 且 `background: transparent`；
2. The World 的全局天色背景必须挂在应用的背景层之下，不能挂在会覆盖 Stage 内容的同级层；
3. 原生页面材质必须把背景透出来，不能由 The World 直接把 `body` 或整个 Stage 替换成一块深色填充。

这三条链路当前没有统一的“主题状态 → 背景层 → 页面材质 → 面板材质”更新入口，所以打开面板时容易看到一块深色遮罩，而看不到原页面与天色同步效果。

## 2. ST 原版的实际结构

源码根目录：

```text
/Users/macbookair/Desktop/AIRP_dev&private_data/SillyTavern_extension&script_Devspace/extensions_dev/SillyView-project/参考案例/the_world
```

### 2.1 DOM 骨架

文件：`panel.html`

```text
body
├── #the_world-panel.tw-panel
│   ├── .tw-theme-layers
│   │   ├── .tw-bg-layer-1
│   │   └── .tw-bg-layer-2
│   ├── .tw-rain-layer
│   ├── .tw-header
│   ├── .tw-tabs
│   ├── .tw-content
│   │   ├── #world-state-pane
│   │   ├── #map-nav-pane
│   │   └── #settings-pane
│   ├── .tw-fx-container-local
│   └── .tw-resize-handle
├── #the_world-fx-layer
└── #the_world-fx-layer-bg
```

ST 把面板局部背景、全局前景天气、全局背景天色拆成三层。天气雨雪等全局特效放在 `#the_world-fx-layer`，星空、云等背景特效放在 `#the_world-fx-layer-bg`，不会和面板内容混为一层。

### 2.2 面板位置、拖拽、缩放与关闭

文件：`modules/ui/UIPanelManager.js`、`modules/ui/UIEventManager.js`。

- 默认宽度约 450px，高度为视口 60%，初始位于右上方。
- 拖拽只监听 Header；`mousedown/touchstart` 开始，直接修改 `top/left`，结束时才保存状态。
- 移动过程中限制在视口边界内，距离边缘 50px 时吸附，吸附使用约 200ms 动画。
- 调整大小只监听右下角 `.tw-resize-handle`。
- `.tw-close` 只负责隐藏面板；它会被拖拽事件排除。
- 面板不依赖全屏遮罩来实现拖拽或关闭。

对应 Loom 文件：

- `apps/studio-client/src/features/extension-renderers/ui/renderer-focus-surface.tsx`
- `apps/studio-client/src/features/extension-renderers/ui/renderer-surface-host.tsx`
- `official/extensions/the-world/src/client/panel-view.tsx`

Loom 应保留上述交互语义：位置和尺寸由 The World 自己持久化，Focus Surface 只负责生命周期，不负责制造遮罩。

### 2.3 ST 天气图标并不是 SVG

文件：`modules/ui/UIRenderer.js`、`css/weather_icons.css`。

`UIRenderer.getWeatherIconHtml()` 输出的是多层 HTML：`.tw-weather-icon > .icon > .cloud/.sun/.rain/.snow/.lightning`。图形、动画和颜色全部由 `weather_icons.css` 完成，包括：

- `sunny`：太阳圆形、光线和 `spin` 动画；
- `cloudy`：两个云层和 `cloud` 动画；
- `rainy`：云层加 `rain:after` 伪元素；
- `flurries`：云层加两个雪花；
- `thunder-storm`：云层加两个闪电；
- 夜间晴天：原版使用月亮/星空主题变体。

因此迁移时应复制 DOM 结构和 CSS 动画，而不是寻找不存在的 SVG 文件，也不能用 emoji 替代。

## 3. ST 的天色与面板同步链

### 3.1 时间渐变计算

文件：`modules/time_gradient/index.js`。

`TimeGradient.getThemeForTime({ timeString, weatherString, periodString })` 先解析 `HH:mm`，解析不到时再使用“清晨、黄昏、夜晚”等时段。它在主题 JSON 的相邻时间节点之间插值两组颜色，并返回：

```text
{ background, brightness, period }
```

主题来源：

```text
the_world/themes/sky/default.json
the_world/themes/sky/legacy.json
the_world/themes/sky/eternal_night.json
```

### 3.2 面板主题

文件：`modules/core/ThemeManager.js`。

`applyThemeAndEffects(data)` 使用同一个 `TimeGradient` 结果：

1. 在 `.tw-theme-layers` 内维护两个背景层；
2. 新背景写入未显示的层，随后交叉淡入，持续约 9 秒；
3. 根据 `brightness` 切换 `.theme-light-text` / `.theme-dark-text`；
4. 再更新面板局部天气光效和开关状态。

面板颜色不是固定深蓝。它来自和全局背景相同的 `theme.background`，只是通过面板透明度、边框和文字亮度保证可读性。

### 3.3 全局页面主题

文件：`modules/core/GlobalThemeManager.js`。

`activate()` 创建 `tw-global-theme-container`，其中有两个 `.tw-global-bg-layer`，并把容器插入 `body` 最前面。`updateTheme()` 使用同一个 `TimeGradient` 结果更新背景层。

在沉浸模式下，它只修改可透出背景的页面表面：

```css
body { background: transparent !important; }
#chat { background: transparent !important; }
#chat_background { background: transparent !important; }
.mes_content {
  background-color: rgba(20, 22, 28, 0.6) !important;
  backdrop-filter: blur(4px);
}
```

ST 没有把整个页面替换成一块不透明深色背景。背景、页面材质、面板材质是三个独立层。

### 3.4 天色主题切换

文件：`modules/core/SkyThemeController.js`。

主题切换后，它会依次调用：

```text
TimeGradient.loadTheme()
GlobalThemeManager.updateTheme()
ThemeManager.applyThemeAndEffects()
```

这保证全局页面和 The World 面板使用同一份天色主题与同一个时间点。

## 4. Loom 当前实现对应关系

### 已存在的 Loom 文件

- 全局扩展入口：`official/extensions/the-world/src/client/index.js`
- 时间渐变：`official/extensions/the-world/src/client/sky-gradient.js`
- 全局天气渲染：`official/extensions/the-world/src/client/weather-renderer.js`
- 云层：`official/extensions/the-world/src/client/clouds-3d.js`
- 运行面板：`official/extensions/the-world/src/client/panel-view.tsx`
- Focus Surface：`apps/studio-client/src/features/extension-renderers/ui/renderer-focus-surface.tsx`
- Surface 宿主：`apps/studio-client/src/features/extension-renderers/ui/renderer-surface-host.tsx`
- 原生背景/材质设置：`apps/studio-client/src/widgets/settings-panel/appearance-store.ts`、`background-materials-view.tsx`

### 当前关键偏差

1. `index.js` 创建的 `globalSky/globalBackground/globalForeground` 直接追加到 `application-layer-stage`，但没有和主应用的正式背景层契约绑定；需要明确这三个层的 DOM 所在层级和 stacking context。
2. `panel-view.tsx` 只根据本地 `readWeather(result)` 生成面板 CSS 变量，面板没有订阅全局外观状态，也没有和全局天色渲染器共享一个可观察的主题快照。
3. Focus Surface 是全屏 dialog。它只能提供生命周期容器，不能承担页面背景；The World 的非模态 Surface 必须让空白区域穿透，Renderer 实例内部再单独启用命中。
4. 主应用现有的 `appearance-store` 与 The World 的 `localStorage` 状态没有统一桥接。打开面板不应成为背景初始化的触发条件。

## 5. Loom 应采用的实现方案

### 5.1 统一主题快照

在 The World client 内建立一个最小主题快照，来源只有一处：

```text
{ timeMinutes, period, weather, backgroundGradient, brightness, skyThemeId }
```

状态变化、调试按钮和恢复上一状态都先更新快照，再由三个消费者读取：

```text
主题快照
├── GlobalSkyLayer：页面最底层天色
├── NativeMaterialBridge：主应用页面表面透明度、模糊和渐隐线
└── WorldPanelTheme：运行面板颜色、文字亮度和局部效果
```

打开/关闭运行面板不得创建或销毁 GlobalSkyLayer。

### 5.2 正确的层级

推荐从底到顶：

```text
应用背景图片
→ The World 天色背景层
→ 云、星空等背景特效
→ 原生聊天/工作区材质层
→ Agent 对话面板
→ The World 运行面板
→ 全局雨雪等前景特效（如开启）
→ Header / Dock / Modal
```

其中 The World 运行面板的空白区域透明穿透，只有实际面板矩形可点击。全局前景天气特效必须 `pointer-events:none`，且不能盖住 Agent 面板。

### 5.3 面板颜色同步

`WorldPanelTheme` 不应另造一套固定蓝色。它应消费 `backgroundGradient` 和 `brightness`：

- `backgroundGradient` 用作面板两层背景的淡入淡出目标；
- `brightness` 决定浅色/深色文字与边框；
- 面板填充使用透明度混合，不覆盖天色；
- 毛玻璃开启时启用 `backdrop-filter`；关闭时才使用实色填充；
- 毛玻璃开启时关闭实色渐隐伪元素，与主应用材质开关保持一致。

### 5.4 Focus Surface 修正边界

`renderer-focus-surface.module.scss` 只负责：

```css
.dialog[data-modal='false'] {
  background: transparent;
  pointer-events: none;
}
```

Surface Host 和 Renderer 实例的空白区域也必须是 `pointer-events:none`。The World Shadow DOM 内的 `.tw-panel` 显式设为 `pointer-events:auto`。不得把整个直接子节点恢复为 `pointer-events:auto`，否则会重新出现透明整屏遮罩。

### 5.5 运行面板结构

面板应继续使用直接 Renderer + Shadow DOM，不需要 iframe。结构按 ST 保持：

```text
.tw-panel
├── .tw-theme-layers
├── .tw-rain-layer
├── .tw-header
├── .tw-tabs
├── .tw-content
└── .tw-resize-handle
```

React 只负责状态和事件；视觉 CSS 继续以 ST 的 class、尺寸、动画时序为基准，不把所有样式压缩成无法核对的单行字符串。

## 6. 具体查找路径

### ST → Loom 对照表

| 能力 | ST 源文件 | Loom 目标文件 |
| --- | --- | --- |
| 面板 DOM | `panel.html` | `official/extensions/the-world/src/client/panel-view.tsx` |
| 面板布局/交互 | `css/base.css`、`UIPanelManager.js`、`UIEventManager.js` | `panel-view.tsx` |
| 天气图标 | `UIRenderer.js`、`css/weather_icons.css` | `panel-view.tsx` 内联 CSS/组件 |
| 时间插值 | `modules/time_gradient/index.js`、`themes/sky/*.json` | `sky-gradient.js`、`resources/sky/*.json` |
| 面板颜色同步 | `modules/core/ThemeManager.js` | The World 主题快照消费者 |
| 全局背景 | `modules/core/GlobalThemeManager.js` | `index.js` + 主应用背景桥接 |
| 主题切换 | `modules/core/SkyThemeController.js` | `index.js` 的统一主题更新入口 |
| 全局前景天气 | `css/weather_effects.css`、天气系统 | `weather-renderer.js` |
| 云/星空背景特效 | `css/clouds_3d.css`、主题层 | `clouds-3d.js`、背景层 |

## 7. 实施顺序与验收标准

1. 先固定主应用背景层和材质层的 stacking contract，确认 The World 背景不会覆盖 Stage 内容。
2. 把 The World 的时间、天气和天色主题合并成可订阅快照。
3. 让全局背景、原生材质和运行面板同时消费该快照。
4. 再复刻 ST 的面板 CSS 和天气图标细节。
5. 最后接入调试按钮、状态订阅和上一状态恢复。

验收必须同时满足：

- 打开运行面板后，聊天、Header、Agent 面板仍可见；
- 面板外空白区域可以点击底下的聊天控件；
- 关闭 X 后运行面板消失，但天色背景不消失；
- 天色从白天切到黄昏、夜晚时，页面材质和 The World 面板使用同一组渐变；
- 毛玻璃开关只改变材质层，不改变背景层位置；
- 雨雪前景特效不拦截点击，云和星空位于聊天容器下方；
- 面板拖拽只在 Header 生效，松手后位置持久化；
- Agent 对话面板始终覆盖 The World 运行面板。

## 8. 非目标

本次审计不改变 State / EC 数据合同，不重新设计地图数据，不增加 iframe，不新增天气资源格式，也不把所有复杂覆盖层强行塞进主应用。实现阶段只修复层级、主题同步、面板结构和 ST 视觉迁移链。
