# 快速启动指南 (Getting Started)

这篇指南将带你从零开始启动 Loom Studio 开发环境。

## 1. 前置条件

由于 Loom Studio 依赖于特定的现代 Node 特性（例如 `--experimental-strip-types` 等待测试），你需要：

- **Node.js**: >= 20 (推荐使用 20.11+)
- **包管理器**: pnpm >= 8 (项目完全使用 `pnpm-workspace` 管理)

## 2. 安装与构建

克隆仓库后，安装依赖并进行一次全局构建，以确保所有本地 workspace 的链接都被正确解析和编译：

```bash
# 在项目根目录执行
pnpm install

# 建议初次运行进行一次全局检查和构建
pnpm lint
pnpm build
```

## 3. 启动开发服务器

Loom Studio 是一个典型的 C/S 架构。你需要同时启动 Server 端和 Client 端。我们建议开启两个独立的终端窗口：

**终端 A: 启动 Server**
```bash
# 启动基于 Node 的后端服务，暴露 RPC 接口
pnpm dev:server
```
Server 会在 `localhost:8080` 或配置好的端口上启动 WebSocket 及 HTTP 监听。

**终端 B: 启动 Client**
```bash
# 启动前端 Vite 调试服务器
pnpm dev:client
```
Client 通常会启动在 `localhost:5173`。打开浏览器访问该地址即可。

## 4. 运行测试

Loom Studio 提供多层级的测试以保证质量：

```bash
# 运行所有活跃的测试
pnpm test

# 运行特定模块的测试（例如只跑 application-runtime）
pnpm --filter application-runtime test
```

## 5. 项目结构初探

现在你已经可以跑通项目了！在写下第一行代码前，强烈建议你阅读：
👉 **[`project-structure.md`](project-structure.md)**
这是整个项目的全局文件地图，让你清楚每个 package 是做什么的，以及去哪里寻找对应的代码。
