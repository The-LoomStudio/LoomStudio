# Loom Studio

Loom Studio 是一个专为 AI Native 时代设计的桌面端对话扮演与智能体开发框架。它采用严格的四层架构，并原生集成了 Loom Core，为 AI 应用提供了极其强大的底层支持能力。

## 项目结构

```text
LoomStudio/
├── apps/               # 独立应用层（包含 Studio Server 和 Studio Client）
├── packages/           # 核心领域包与基础设施层
├── extensions/         # 插件层
└── docs/               # 文档层
```

## 快速上手

### 环境要求

- Node.js 22.18.0
- pnpm 9.15.0

### 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 启动开发服务器

我们提供了并行启动客户端和服务器的命令，在不同的终端中执行：

1. 启动 Studio Server：

```bash
pnpm dev:server
```

2. 启动 Studio Client：

```bash
pnpm dev:client
```

### 运行测试

```bash
pnpm test
```

## 文档

开始修改代码前，先从 [`docs/guide/workspace-development.md`](docs/guide/workspace-development.md) 按任务进入对应 Workspace；进入目录后，再阅读该 Workspace 的本地 `README.md`。

完整文档体系见 [`docs/README.md`](docs/README.md)：

- `docs/guide/`：全仓开发流程、共同规则和任务路由
- `apps/*/README.md`、`packages/*/README.md`：靠近代码的局部开发入口
- `docs/architecture/`：已经实现并稳定的跨 Workspace 合同
- `docs/workbench/`：仍在演进的 Discussion、Plan、Issue 和 Reference
- `docs/archive/`：已经完成、被取代或冻结的历史材料

## 贡献

如果你希望为项目贡献代码，请首先阅读 [`docs/guide/contributing.md`](docs/guide/contributing.md) 以了解我们的开发流程和规范。
