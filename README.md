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
- Node.js >= 20
- pnpm >= 8

### 安装依赖
```bash
pnpm install
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

完整的开发者文档和系统架构请参阅 [`docs/README.md`](docs/README.md)。
我们采用了 **Stable & Workbench** 文档双轨制：
- 📘 `docs/guide/`: 开发者手册与规范
- 📖 `docs/reference/`: API速查与参考
- 📐 `docs/architecture/`: 已定稿的正式架构参考
- 🔧 `docs/workbench/`: 工作台（设计草案、架构讨论、规划）

## 贡献

如果你希望为项目贡献代码，请首先阅读 [`docs/guide/contributing.md`](docs/guide/contributing.md) 以了解我们的开发流程和规范。
