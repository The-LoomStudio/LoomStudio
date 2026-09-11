# ST 扩展渲染参考：Engram 与 The World

> **状态**：只读源码参考 / 非实施计划
> **调研日期**：2026-09-10
> **范围**：插件如何加载、挂载 UI、隔离样式，以及渲染与宿主能力之间的边界。不评价插件完整业务架构。
> **证据边界**：基于本机源码，未记录 commit，不代表上游最新版本；未运行插件、构建产物或执行浏览器验收。下文的 Loom 映射是设计建议，不代表已实现或已批准。

## 1. 核心结论

- 宿主不使用 React，不妨碍插件把自己的 React 应用挂载到宿主 DOM。
- 统一接入应约束声明、挂载位置、运行上下文和销毁，而不是限制作者的框架或要求单文件构建。
- 独立 UI、世界状态、模型工具、宿主外观与声音可以属于同一个扩展包，但不能都归入 Renderer 生命周期。
- 修改插件自己的 Root 与修改宿主聊天界面是两种能力。CSS 命名空间、Shadow DOM 和 iframe 不能混称为执行安全隔离。

## 2. 本地证据入口

以下路径是本次调研的本地样本，不是仓库依赖或可移植的安装路径。

### Engram

根目录：`/Users/macbookair/SillyTavern/public/scripts/extensions/third-party/Engram_project/`

| 文件 | 核对内容 |
|---|---|
| `manifest.json` | `js` 指向 `dist/index.js`，并声明 HTML 入口 |
| `vite.config.ts` | React 构建；固定 `index.js`、`style.css` 输出名，`inlineDynamicImports: true` |
| `src/index.tsx` | 通过 `setReactRenderer`、`setGlobalRenderer` 注册回调，调用 `ReactDOM.createRoot()` |
| `src/integrations/tavern/ui/ui.ts` | 创建宿主按钮、向 `document.body` 追加面板与 Overlay；关闭主面板时 unmount 并移除 DOM |
| `src/ui/styles/main.css` | `.engram-app-root` 下的局部样式与 Reset |

### The World

根目录：`/Users/macbookair/SillyTavern/public/scripts/extensions/the_world/`

| 文件 | 核对内容 |
|---|---|
| `script.js` | 等待 ST 与 TavernHelper 等宿主依赖可用 |
| `modules/ui/UIController.js` | fetch `panel.html`，追加到 body，创建特效层和悬浮入口 |
| `modules/core/InjectionEngine.js` | 按 ID 创建、替换和删除宿主 head 中的 style |
| `modules/core/GlobalThemeManager.js` | 读取时间天气状态，管理背景 DOM、层级、过渡与宿主样式 |
| `modules/TheWorldApp.js` | 消息事件驱动处理；编辑、删除、切换聊天后的状态维护与重算 |
| `modules/core/CommandParser.js` | 提取 `<command>` 并解析其中的函数式指令 |
| `modules/api/MacroManager.js` | 通过 TavernHelper 注册宏 |
| `modules/map_system/CommandHandler.js` | 通过 ST Context 注册 Function Tools |

## 3. Engram：把 React 当成局部应用挂进去

核对的主面板路径：

```text
React / TSX 源码
  -> Vite 生成浏览器 JS 与 CSS
  -> ST 依据 Manifest 加载入口
  -> 插件创建 div 并插入 document.body
  -> ReactDOM.createRoot(div).render(App)
  -> 关闭时 root.unmount()，移除 div
```

入口还注册了独立的全局 Overlay 渲染回调，因此主面板不是插件唯一的 React Root。

下面是合并多个文件后的语义示意，不是原文件逐字摘录：

```tsx
function open() {
  container = document.createElement("div");
  container.className = "engram-app-root";
  document.body.append(container);
  root = createRoot(container);
  root.render(<App onClose={close} />);
}

function close() {
  root.unmount();
  container.remove();
}
```

### 隔离边界

核对的主界面直接挂载到 DOM，不使用 iframe 或 Shadow Root。`.engram-app-root` 的样式作用域是约定式隔离：

- 减少插件样式向外影响，但不是所有输出 CSS 都天然被约束在该选择器下；
- 宿主全局样式仍可能作用于插件元素；
- 插件 JavaScript 与宿主共享页面执行环境。

不能根据源码中的 iframe 类型声明或注释，推断主面板实际采用 iframe。

### 对 Loom 的启示

同样的应用可以保留内部 React 组件，仅把创建容器、面板入口与销毁交给 Renderer Host。作者负责 `mount(root, context)` 与 disposer，Host 负责 Surface、Scope 和实例回收。

采用 Shadow Adapter 时仍需处理样式加载与弹窗 Portal 的挂载目标；不能仅修改 Adapter 字段就宣称框架应用完成隔离迁移。

## 4. The World：一个包中的多种能力

The World 的核对路径采用原生 JS 模块、HTML、CSS 与宿主 API；业务复杂度不来自是否使用框架或打包。

### UI 与宿主外观

`UIController.loadPanelHtml()` 加载 HTML 后追加到 body，并创建独立特效层。`GlobalThemeManager` 自行建立背景容器，用多个背景层做过渡；`InjectionEngine` 则向宿主 head 写入 CSS。

这里至少存在两种不同操作：

1. 在插件自己的区域画状态面板、地图、背景或特效。
2. 改变宿主已有界面的外观，使聊天内容与背景共同形成沉浸效果。

第二种不是一般的 Root 内渲染。单纯给 Renderer 提供 Shadow Root 或 iframe 无法替代它。

### 模型、状态与渲染联动

```text
消息事件 / Function Tool / 用户操作
  -> 捕获与业务指令
  -> 世界和地图数据更新
  -> 保存、必要时重算
  -> 状态面板、地图与背景更新
```

`TheWorldApp` 监听消息接收、编辑、swipe、删除与聊天切换；存在从历史消息重新计算状态的逻辑。正文中的 `<command>` 使用私有 Parser 解析，另外也提供宏与 Function Tools。

本次没有核对出替换底层生成函数的证据，因此不将“劫持生成引擎”写成事实。已确认的是对宿主 DOM、事件、ST Context 和 TavernHelper 的直接依赖。

## 5. Loom 能力映射建议

| 样本需求 | 建议归属 | 关键边界 |
|---|---|---|
| 状态面板、地图编辑器 | Renderer / 工作台 | 自己的 Root 内渲染 |
| 正文附近的状态展示 | Timeline tail / 消息内 Renderer | 展示位置与数据来源分离 |
| 时间、天气驱动背景 | Background Renderer | 跟随当前 Timeline 更新，不保留上一个世界的状态 |
| 聊天透明度、毛玻璃等 | 宿主外观能力 | 不以任意 CSS 选择器作为稳定公共 API |
| 地点、天气、NPC 等事实 | Timeline State | 由 State 合同负责修改、分支与回滚 |
| Agent 修改世界 | Agent Tools + State Mutation | 捕获文本不等于获得写权限 |
| 兼容正文里的旧格式指令 | 私有 Parser / 可选 Extractor | 解析和副作用提交分开 |
| 给提示词输出世界信息 | 宏提供者 / Prompt 投影 | 不把 Renderer 输出当 Prompt 数据 |
| 环境音与音效 | 独立音频生命周期 | 面板关闭不应自动代表声音停止 |

同一个包可以贡献以上多种能力。拆分的是合同、权限与生命周期，不要求作者拆成多个插件。

## 6. 当前 Loom 基础与开放问题

以 [Client Renderer Host 架构](../../architecture/extensions/client-renderer-host.md) 和 [Extension SDK](../../../packages/extension-sdk/src/index.ts) 为现有合同：

- 已有 Manifest 声明、Client Module 注册、Surface / Scope、mount / update / disposer 和三种 Adapter。
- Client Module 仍是受信同源 JS；sandbox iframe 不能反向隔离已在宿主执行的 Module。
- 已有 State / History 读取及包 namespace RPC，但不能据此声称完整的 Client State 写入、配置或事件订阅已经提供。
- `shell.background` 当前是 Workspace Scope。背景读取当前 Timeline 的需求需要明确上下文变化通知与清理语义，不必立即把背景 Surface 改成 Timeline Scope。

以下是后续课题，不是本参考授权的实现：

1. **宿主外观**：先评估背景透出、内容区透明度等有限语义选项；需要用户控制、冲突处理和停用恢复，不直接建设万能 CSS 注入引擎。
2. **纯 HTML 接入**：已有 `frame.src`，但当前仍需 Client Module 注册；是否增加纯声明式页面入口需要单独决定。
3. **上下文变化**：Workspace UI 如何稳定读取当前 Timeline，切换后如何取消旧读取并更新显示。
4. **音频**：实例生命周期、用户启用、资源访问及停止行为应独立讨论，不通过隐藏 Renderer 顺带实现。

## 7. UI 结论

继续使用 Owner 工作台的 Master–Detail：

- 左侧列所属包或资源的 Renderer、State、Tools 等贡献；
- 右侧就地显示选中项的声明、入口、配置与运行状态；
- 源码沿所属 Module 的入口查看，不复制另一套编辑器；
- 跨扩展的 Surface 占用和排序属于运行管理，不是第二个渲染资源库。

作者从所属资源找到实现，用户从实际展示位置管理效果。两者引用同一贡献身份，不创建两份资源。
