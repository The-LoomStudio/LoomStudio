# Extension 主题与样式增强

主题与样式增强是 Extension Package 的贡献，面向原生 Studio 工作台。它们不创建新的资源类型，不替代 Display 或 Renderer，也不穿透 iframe。当前仅接受全局包；Timeline 参与包不能贡献全局样式。

## 声明与采用

`manifestVersion: 2` 的 `contributes.themes` 声明主主题，`contributes.styles` 声明可独立启停、调整顺序的增强。两者使用同一份 `ExtensionStyleContribution` 合同：`id`、`label`、包内 `css` 入口，以及可选的 `description`、`parameters`、`nativeMotion`、`moduleId` 和 `supportsCssOnly`。一个包可以同时声明多个主题和多个增强；一个包内两类贡献的 ID 必须唯一。

同时采用一个主题，可以叠加多个增强。安装、采用样式与授权运行 Client Module 是三个独立动作。纯 CSS 贡献不需要模块。若声明 `moduleId`，它必须引用本包的 Client Module；默认需要先授权代码。仅声明 `supportsCssOnly: true` 的贡献允许在模块未启用时使用 CSS 部分，此字段不能单独用于无模块贡献。

完整样例见 [官方主题包](../../../official/extensions/themes/manifest.json)（`official.themes`）：`paper`、`tide` 是纯 CSS 主题；`smooth-motion`、`mint`、`amber` 是三个独立增强，其中 `smooth-motion` 支持纯 CSS 模式，并在授权 `motion` 模块后提供 JS 面板动效。默认开发入口直接从 `official/extensions/` 发现此包，无需复制到用户安装目录；JS 是无需额外构建的 ES Module。官方包不能删除式卸载，可以取消采用外观或停用模块。源码修改需要服务重新发现或重启，没有文件级 HMR。

## CSS、素材与优先级

CSS 入口必须是打包好的包内相对路径。入口内的图片、字体与 mask 可使用相对 URL；浏览器以原始 CSS URL 为基准解析，因此样例 `paper.css` 的 `url('./assets/parchment.svg')` 和 `url('./assets/settings.svg')` 随包分发即可。入口不可包含 `@import`、`@namespace` 或 `!important`；请在发布前打包依赖。`!important` 会反转 cascade layer 的优先级，因此加载器明确拒绝它，不静默删除声明。

宿主统一建立以下层顺序，作者无需自行声明宿主层：

```css
@layer loom-native, loom-motion, loom-theme, loom-enhancements, loom-user;
```

普通声明按原生、原生动效开关、主题、增强、用户覆盖逐层生效，后层可覆盖前层更高 specificity 的选择器。增强按用户顺序分配 `e0`、`e1` 等独立子层。原生为隐藏状态、减少动效保留的 important 声明仍有优先权；内联定位、虚拟列表与拖拽尺寸仍归宿主管理。这不是允许主题任意覆盖全部运行时状态的承诺。

公开的 `data-loom-*` hook 和语义属性是样式入口，构建生成的 CSS Module 类名不是稳定 API。样例使用 `base-chat-canvas` 修改实际聊天背景，并通过 `utility-rail` 内按钮的 `aria-controls="studio-settings-panel"` 替换设置图标；保留原按钮、可访问名称和键盘行为。

加载器以惰性的 `style media="not all"` 包含 `@import … layer(…)`，等待真实加载完成，再通过 CSSOM 检查包内规则；成功后激活已有 stylesheet，不重新复制 CSS 或重写素材 URL。候选加载失败、取消或超过 15 秒会清理候选。切换过程保留原主题，以便新主题加载或激活失败时恢复原来的样式与采用实例。

## 参数与个人覆盖

`parameters` 支持 `number`、`color`、`select`、`boolean`，每项有稳定 `id`、显示名称 `label`、目标 CSS 变量 `variable` 和类型对应的默认值。数值项提供 `min`、`max`，可选 `step` 和单位；具体字段见 [SDK 合同](../../../packages/extension-sdk/src/styles.ts)。

样例声明画布宽度 `--loom-canvas-width`、模糊 `--loom-preview-blur` 和纹理强度 `--extension-paper-texture`。宿主已有外观参数沿用既有用户覆盖；主题专属参数按贡献身份保存，切换主题后保留，恢复默认只清除对应覆盖。未修改的参数随主题默认值变化。

以下共享参数映射到宿主已有外观偏好，必须声明为 `number`，单位与范围由 SDK 的 `sharedStyleParameterDefinitions` 定义：

| CSS 变量 | 单位 | 宿主范围 |
| --- | --- | --- |
| `--loom-ui-scale` | 无单位（`unit: ""`，也可省略） | 0.8–1.25 |
| `--loom-canvas-width` | `px` | 540–1120 |
| `--loom-preview-blur` | `px` | 0–32 |
| `--loom-preview-opacity` | `%` | 0–100 |

主题声明的 `min` / `max` 可以缩小宿主范围，默认值必须处于主题自身范围内；不能改变共享变量的类型、单位或扩大宿主范围。已有用户共享覆盖按宿主完整范围校验，即使超出当前主题建议的范围也继续保留。缩放数值使用比例，例如 `1` 表示 100%，不能声明为 `100` 或添加 `px` 单位。

主题专属变量应带明确的扩展前缀，避免跨贡献冲突。分栏、虚拟列表、滚动锚点、键盘安全区域等内部状态不作为可编辑主题参数。不要用参数覆盖这些布局输入，也不要在承担定位的节点争用 `transform`。个人 Custom CSS 持久化在用户覆盖层，不是独立分发资源格式。

## Client Module 与动效生命周期

模块在 `activate(ctx)` 中调用 `ctx.styles.register(contributionId, factory)` 注册工厂；模块启用不等于采用该样式。工厂只在贡献采用期间运行，收到采用生命周期的 `signal`、当前 `parameters` 与动画注册接口。副作用应在工厂内创建，返回 `{ dispose() }` 清理。不要在模块注册阶段就修改全局 DOM。

```js
export function activate(ctx) {
  ctx.styles.register('smooth-motion', style => {
    return style.animations.register('workbench.panel', ({ element, phase, signal }) => {
      signal.throwIfAborted();
      return element.animate(
        phase === 'enter' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
        { duration: 160, fill: 'both' },
      );
    });
  });
}
```

动画返回值须有 `finished: Promise` 与 `cancel()`，原生 Web Animations `Animation` 满足合同。宿主管理打开、关闭、取消、焦点和最终清理；快速反向操作、贡献切换或卸载会取消旧过程。宿主有 10 秒截止保护，避免永不完成的扩展 Promise 阻塞面板回收；这不是推荐动画时长。自行创建的监听器、节点及其他动画仍需扩展自己清理，同页面 Client Module 不提供强安全隔离。

当前可注册过程为 `workbench.panel`。多个贡献接管同一过程时，按增强顺序由最后一个生效，没有增强接管时使用主题或原生行为。`nativeMotion: 'disable'` 通过中间层关闭原生 CSS 动效，后续主题与增强层可以提供替代效果；不要使用全局 `animation: none !important`。减少动效偏好优先，宿主跳过 JS 替代动画，作者自己的 CSS 也应同时尊重 `prefers-reduced-motion` 和 `html[data-loom-motion='reduce']`。

## 恢复与验证边界

样式遮挡普通界面时，按 `Ctrl+Alt+Shift+T`，或以 `?appearance=native` 打开工作台，恢复原生外观。恢复会撤销主题、增强并清空个人 CSS；主题参数覆盖仍保留。发布前应自行检查键盘操作、减少动效、快速开关面板、贡献切换与失败恢复。

2026-10-17 使用本机已有 Google Chrome 的 headless 模式，在临时 HTTP 页面验证了加载机制：惰性 `@import` 触发 `load`、CSSOM 可读；激活前保留原生颜色，激活后主题层覆盖更高 specificity 的原生规则；图片相对 URL 解析到原 CSS 所在目录。探针对应实现为 [style-loader.ts](../../../apps/studio-client/src/features/themes/model/style-loader.ts)，临时页面与 profile 未入仓。另有加载器单测、Vite CSS 预处理与生产构建验证；[真实临时包安装测试](../../../tests/unit/studio-server/theme-package.test.ts)覆盖样例安装、Catalog、CSS/SVG 文件及默认禁用 JS。此证据不等同于完整样例包在工作台中的浏览器验收；通过工作台入口安装、实际视觉和完整交互仍需验收。

## 即时切换与启动画面

设置中的主题、增强开关与顺序即时采用，成功后提交偏好；失败保留此前的实际采用状态。代码授权独立进行。启动遮罩等待首次外观应用完成或失败后退出；主题可通过 `#loom-startup` 覆盖图标、文字和背景，撤除时机由宿主控制。宿主等待有限动画完成，每阶段最多等待 1.2 秒，避免扩展阻塞进入工作台。HTML 第一帧仍使用原生兜底。

纸页样例使用包内生成的 PNG 纹理覆盖整个 Timeline 画布，消息表面透明，虚拟列表定位保持宿主所有。同一 [官方主题包](../../../official/extensions/themes/manifest.json) 内的潮汐主题和两个独立强调色增强，展示覆盖顺序与专属参数。

## 静态背景资源

背景与主题独立分发。官方背景包源码 `official/extensions/backgrounds/manifest.json`（`official.backgrounds`）通过 `contributes.backgrounds` 声明 `id`、`name`、`description` 和包内图片路径 `image`，无需 Client Module。全局包被发现后即可在背景设置中选择，宿主使用包的 `displayName` 作为来源名称；发现不会自动切换背景；用户安装包卸载后对应候选不可用，官方包则不能删除式卸载。静态背景与全局外观贡献一样，仅接受全局安装包；Timeline 参与包不能声明，卡内安装也不会进入全局背景列表。

`image` 必须是包内相对图片路径，可带 `./` 前缀，不能越界或使用 URL、query、hash；支持 PNG、JPEG、WebP、GIF、SVG 和 AVIF。模块仍可通过 `ctx.backgrounds.register` 动态注册背景，适用于确实需要运行代码生成或管理候选的扩展。静态图片无需为此增加模块和授权步骤。

开发默认发现 `official/extensions/` 中所有现有包，主题及本地存在的背景包无需另行安装；背景目录整体被 Git 忽略。用户安装包仍在 `extensions/`，相同包 ID 出现在两个来源时报告冲突。默认首次 setup 仅处理 assistant 与 story-memory，保留用户已停用的模块状态。发行包默认仍只携带 assistant 与 story-memory，详见 [官方扩展目录](../../../official/extensions/README.md)。


## 玩家个人背景

玩家背景在外观面板导入、预览、选用和移除；支持 PNG、APNG、JPEG、GIF、WebP、AVIF，单张最大 64 MiB。“我的 → 资源”只汇总个人背景目录，点击条目跳到外观面板预览，不直接更改当前背景，也不提供导入或移除操作。

图片沿用 `POST /assets`，二进制由现有 Blob Store 保存到用户数据目录，清单以 `user-backgrounds:global` 文档保存 `{ id, name, assetId }`，通过版本检查防止并发覆盖。清单不归属于具体扮演身份或 Timeline；背景引用进入已有本机外观偏好。扩展背景仍引用包内文件，不复制到个人清单。

移除只删除个人清单记录；移除当前选用项时清除本机对应选择，不删除可能仍被其他资源引用的底层图片资产。个人背景不进入仓库或官方包。
