# 技术栈与外部依赖选型 (Tech Stack & NPM Dependencies)

除了内部包之间的依赖关系，了解 Loom Studio 所选用的核心第三方 NPM 库同样重要。这能帮助 AI 或新加入的开发者快速熟悉开发语境，避免引入重复造轮子的库或违反架构原则的包。

## 1. 前端技术栈 (Client)

- **框架基座**：`React` (最新稳定版) + `Vite`。我们选择标准的 SPA 方案，而不是 Next.js 这类框架。
- **状态管理**：
  - **基础状态**：默认使用 React 自身的 State/Context。
  - **复杂 UI 状态**（如面板布局、弹窗、诊断过滤器等）：按需引入 `zustand`。
  - **服务端状态与数据流**（如向后端查询的列表页、长期运行的轮询等）：按需引入 `@tanstack/react-query`。
- **CSS 方案**：
  - **核心约束**：我们**不使用** Tailwind CSS 或 Styled-components，也不使用 Ant Design、MUI 这类重型全局组件库。
  - **官方选型**：`SCSS Modules` 配合 `CSS Custom Properties` (CSS 变量)。我们引入 `sass` 预处理器以改善嵌套开发体验并支持 Mixins，但**必须强调核心 Token 必须由原生 CSS 变量接管**。这为了将来允许用户或 Extension 能够非常方便地在运行时进行样式覆盖与主题定制。
- **无障碍与复杂组件**：遇到实在需要复杂无障碍交互（如浮动菜单、无障碍对话框）时，按需引入无样式的 `Radix UI` Primitives。

## 2. 后端与传输层 (Server & Transport)

- **基础运行时**：Node.js。我们保持纯正的 Node 兼容性，不把 Bun 作为平台的强制运行契约。
- **HTTP/WebSocket**：
  - **核心约束**：P0 阶段**不引入** Express, Fastify, Hono 等任何 Web 框架。
  - **官方选型**：直接使用 Node 原生的 `http` 模块配合 `ws` 库。因为当前后端的首要任务仅仅是为 Client 提供 RPC 与 Event 的投递通道，功能非常纯粹。
- **持久化层 (Database)**：目前 Document Store 使用内存模式，后续若落盘则优先采用裸写 `better-sqlite3`。暂时**不引入** Prisma 或 TypeORM 等重型 ORM。

## 3. 全局工具与基础设施 (Global Infrastructure)

- **工作空间管理**：`pnpm` (Workspace)。
- **语言**：全栈 `TypeScript`。后端脚本与临时任务使用 `tsx` 执行。
- **数据校验**：
  - **选型**：`zod`。
  - **使用边界**：绝不允许在内部函数的参数中到处套用 Zod schema。Zod 必须且只能用在**系统边界**，比如：解析插件的 Manifest、校验网络传输过来的 RPC payload、拦截不受信任的写入请求。
- **测试框架**：`Vitest`（单测与集成测试）。
- **代码格式与校验**：`eslint` (Flat Config) + `prettier`。后续会引入 `eslint-plugin-boundaries` 来硬性限制跨包违规引用。

## 4. 依赖引入的底线哲学

> **"不假装安全，不为了偷懒而妥协扩展性"**

如果你在实现一个新功能时觉得需要安装一个新的 NPM 包，请先想一想：
1. **这是不是 MVP 所必需的？** 
2. **它会不会污染全局上下文？** （比如一个强约束的主题包会让自定义主题变得不可能）。
3. **如果有疑问，先不要装。**
