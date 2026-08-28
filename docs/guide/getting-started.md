# 快速启动指南 (Getting Started)

这篇指南将带你从零开始启动 Loom Studio 开发环境。

## 1. 前置条件

Loom Studio 固定使用下面的开发工具链，避免不同机器重新解析依赖或生成无关的 lockfile 变更：

- **Node.js**: 22.18.0（见 `.node-version` 与 `.nvmrc`）
- **包管理器**: pnpm 9.15.0（见根 `package.json` 的 `packageManager`）

## 2. 安装与构建

克隆仓库后，按 lockfile 安装依赖，并检查本机工具链、依赖声明和关键 workspace 运行时导出：

```bash
# 在项目根目录执行
pnpm install --frozen-lockfile
pnpm run check:workspace

# 首次运行建议进行一次全局构建
pnpm build
```

`check:workspace` 会构建内部 packages，并拒绝错误的 Node/pnpm 版本、`latest`/`*` 浮动依赖、过期 lockfile，以及关键内部包缺失或导出不可用的情况。

## 3. 启动开发服务器

Loom Studio 是一个典型的 C/S 架构。你需要同时启动 Server 端和 Client 端。我们建议开启两个独立的终端窗口：

**终端 A: 启动 Server**

```bash
# 启动基于 Node 的后端服务，暴露 RPC 接口
pnpm dev:server
```

Server 默认监听 `127.0.0.1:4173`，可通过 `PORT` 覆盖。当前主 RPC 是建立应用会话后的 HTTP `POST /rpc`；Extension Catalog 变化通过专用 `GET /extensions/events` SSE 推送，不存在通用 WebSocket 当前合同。

**终端 B: 启动 Client**

```bash
# 启动前端 Vite 调试服务器
pnpm dev:client
```

Client 默认监听 `127.0.0.1:5173`。打开浏览器访问该地址即可；Vite 会把 `/auth`、`/assets`、`/cards` 与 `/rpc` 代理到 Studio Server。

两个开发命令都会先构建内部 packages，再持续监听它们的输出。修改 `packages/` 下的源码后无需手动重新构建；Server 还会在 package 产物变化时自动重启。

开发脚本会把 `LOOM_STUDIO_HOME` 设置为仓库 `.loomstudio-dev`，SQLite、Blob、Extension state/cache 与 JSONL 日志都从同一本地路径合同派生。正式运行改用操作系统原生用户数据目录，不会把用户数据写进应用安装目录。

## 4. 依赖变更约定

新依赖必须添加到实际消费它的 workspace，并显式指定版本：

```bash
pnpm add --filter <workspace-name> <dependency>@<version>
```

依赖升级应保持为独立、可审阅的改动，不要与普通功能开发混合提交。禁止使用 `latest` 或 `*`；项目已启用精确版本保存和严格 peer dependency 检查。

## 5. 运行测试

Loom Studio 提供多层级的测试以保证质量：

```bash
# 运行所有活跃的测试
pnpm test

# 运行 Application Runtime 的当前单元与集成测试
pnpm exec vitest run tests/unit/application-runtime tests/integration/application-runtime
```

## 6. 项目结构初探

现在你已经可以跑通项目了。修改代码前先阅读 [`workspace-development.md`](workspace-development.md)，按任务进入目标 Workspace 的本地 README；需要理解全仓依赖和目录时，再查看 [`project-structure.md`](project-structure.md)。
