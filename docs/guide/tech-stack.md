# 技术栈与外部依赖选型 (Tech Stack & NPM Dependencies)

除了内部包之间的依赖关系，了解 Loom Studio 所选用的核心第三方 NPM 库同样重要。这能帮助 AI 或新加入的开发者快速熟悉开发语境，避免引入重复造轮子的库或违反架构原则的包。

## 1. 前端技术栈 (Client)

- **框架基座**：当前使用 `React 19.2.7`、`Vite 8.1.1` 与 `react-router-dom` 的 SPA。
- **状态边界**：React 组件状态处理局部渲染；Zustand 处理布局和交互状态；Server 通过 typed RPC 持有 canonical 业务状态。当前没有安装 `@tanstack/react-query`，不要按旧计划假设它已负责 Server State。
- **CSS 方案**：SCSS Modules 配合 `--loom-*` CSS Custom Properties。项目没有 Tailwind、Styled-components、Ant Design 或 MUI；不要为局部样式建立第二套主题系统。
- **交互基础设施**：复杂菜单优先复用当前已安装的 Radix Context Menu / Dropdown Menu，拖放使用 `dnd-kit`，通知使用 Sonner，图标使用 Lucide 与既有图标资产。

## 2. 后端与传输层 (Server & Transport)

- **基础运行时**：固定为 Node.js 22.18.0；不把 Bun 作为平台合同。
- **HTTP / RPC**：Studio Server 直接使用 `node:http`。主调用面是认证后的 JSON-RPC 风格 `POST /rpc`，Extension Catalog 变化使用专用 SSE。当前运行链没有通用 WebSocket Transport，也没有 Express、Fastify 或 Hono。
- **持久化层**：共享 `@loom-studio/data-engine` 使用 Node 内置 `node:sqlite` 管理 connection、migration 与 transaction；Document、Narrative、Agent、State、Prompt Resource、Secret metadata 和 Asset metadata 由各领域 Store 在同一 Data Engine 上持久化。Blob 字节使用文件系统内容寻址存储。当前不是内存 Store，也没有 `better-sqlite3`、Prisma 或 TypeORM。

## 3. 全局工具与基础设施 (Global Infrastructure)

- **工作空间管理**：`pnpm` (Workspace)。
- **语言**：全栈 `TypeScript`。后端脚本与临时任务使用 `tsx` 执行。
- **数据校验**：边界优先复用现有解析器和 `zod`；不要把 schema 校验扩散到可信内部函数。
- **测试框架**：`Vitest`（单测与集成测试）。
- **代码格式与校验**：`eslint` Flat Config + `prettier`。

## 4. 依赖引入的底线哲学

> **"不假装安全，不为了偷懒而妥协扩展性"**

如果实现新功能看起来需要安装新的 NPM 包，先确认标准库、浏览器 / Node / React 原生能力和现有依赖是否已经覆盖。新增依赖必须解决当前明确需求，并添加到实际消费它的 Workspace；不要为未来可能出现的场景预埋包。
