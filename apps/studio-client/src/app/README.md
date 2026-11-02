# App 装配

Client 的跨 Feature 入口。先看 [Workspace README 的 FSD 与状态归属](../../README.md#源码导航与-fsd-架构规范)，再按任务阅读：

1. [`main.tsx`](../main.tsx)：浏览器启动、开发预览分流、认证会话、QueryClient 与 Router。
2. [`app.tsx`](./app.tsx)：页面与 Widget 组合、跨 Feature 回调和宿主级事件接线。
3. [`use-studio-state.ts`](./use-studio-state.ts)：创建 typed API、组合 Feature hooks，并向 App 提供 facade。
4. [`use-studio-derived-state.ts`](./use-studio-derived-state.ts)：仅在派生的展示状态或选择关系有问题时继续读。

`main.tsx` 在正式入口先 `POST /auth/session`，随后并行加载 App 与当前语言包，完成后挂载 `BrowserRouter`、`QueryClientProvider` 和 `AppErrorBoundary`。因此依赖 Query 的 Feature hook 必须在应用树下运行；API endpoint、Logger、翻译函数及操作执行器由 App/facade 注入。开发预览在 `import.meta.env.DEV` 下提前分流，不经过正式认证与业务初始化。

`useStudioState` 用 `/trpc` 作为实际 RPC transport；派生的 `/rpc` endpoint 只作为 workspace/draft 本机键的兼容 scope，不代表网络路由。调整二者时要分别核对调用地址与既有本地状态键。

`useStudioState` 持有 App 级组合职责，`App` 负责跨领域的展示接线。具体领域查询、命令、运行生命周期仍由对应 Feature 所有；不要把它们移入 App，也不要让 Widget 直接调用 RPC。状态分类与 FSD 规则沿用 Workspace README，不在此重复定义。

改动入口：启动、Provider 或路由前置条件改 `main.tsx`；跨 Feature 组合、导航和面板接线改 `app.tsx` / `use-studio-state.ts`；领域行为回到对应 Feature；展示布局留在 Page/Widget。跨层合同见[系统总览](../../../../docs/architecture/system-overview.md)。

相关验证入口：[启动装配](../../../../tests/unit/client/studio-startup.test.ts)、[useStudioState](../../../../tests/unit/client/use-studio-state.test.ts)、[工作区导航](../../../../tests/unit/client/studio-workspace-navigation.test.ts)。按实际改动选择；这些路径只是定位入口。

## 多层浏览状态接线

页面和浮层中的每组 Tab、范围选择都用 `shared/studio-shell/use-workbench-view.ts` 的 `useWorkbenchView`，通过现有 Zustand `viewPreferences` 持久化。层数不限；每组使用稳定语义键，例如 `scripts.scope`（当前角色/全局）、`scripts.filter`（正则/脚本）、`scripts.detail`（运行/源码）。不要以一个 activeTab 保存整个面板，也不要在父层切换时重置子层。不同父分支需要各自记忆时，键可包含稳定的父视图名，例如 `state.runtime.scope`。

`choices` 只传当前可用选项。缺少角色、故事或功能暂不可用时，hook 返回 fallback，但不写回覆盖之前的偏好；条件恢复后可以继续显示原选项。显式路由定位优先，由面板处理。具体资源 ID 沿用带 endpoint/角色作用域的导航状态，编辑草稿、弹窗开关、请求状态不放入浏览偏好。新增嵌套 Tab 时，每层都要接线，不能只检查最外层。

## 通知内容与定位

通知标题和摘要只放用户可理解的问题、资源名称及下一步。原始异常、资源 ID、挂载 ID 和诊断码放 `NotifyOptions.details`，由独立详情浮层展示和复制；不得把 ID 当资源名称，也不对任意错误字符串做正则替换来猜名称。异常调用使用 `notify.failure(操作说明, error, options)`。有处理目标时传 `action`，导航使用结构化路由一次提交；缺失的资源应跳到引用方或管理面板，不能生成指向已删除对象的假链接。

显示规则诊断保留所属预设、可用资源名和原引用序号。规则已删除而名称无法获取时明确说明名称不可用。扩展自定义消息属于扩展内容，宿主不猜测或改写其中的 ID；内部 owner 标识只放技术详情。通知消失不关闭已打开的详情。

### 移动端横滑与抽屉

工作区在移动端的 Master 列表保留窄 Dock，Detail 与无列表页面全宽显示；详情返回列表，再返回导航页。横滑由 `useMobileNavigationGestures` 统一处理，复用 Tab 原有点击回调，不另存一份选中状态。

Tab 与它负责的内容共用 `data-loom-mobile-tab-scope` 容器；横滑只响应当前页面的一级 Tab，二级及更深的 Tab 只点击切换。一级第一项右滑执行当前页面返回。同级多组 Tab 必须划分内容范围，不能靠 DOM 顺序猜测；未划分时不自动切换。编辑控件、按钮、文本选择、横向滚动区域不接管。

默认 Dialog 在移动端呈现底部抽屉，拖拽条下拉调用原有 `onClose`，不绕过关闭检查；workbench/media 保持全屏，alertdialog 保持确认布局。浏览器或系统边缘返回不属于应用能够保证拦截的范围，导航手势不依赖边缘起点。
