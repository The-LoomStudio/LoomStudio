<div align="center">

<img src="public/images/banner.png" alt="Loom Studio Banner" width="460" />

# Loom Studio

**Weave worlds, interweave stories.**  
*编织世界，交织故事*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node Version](https://img.shields.io/badge/Node-%3E%3D22.18.0-339933.svg?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](tsconfig.packages.json)
[![Architecture](https://img.shields.io/badge/Architecture-4--Layer-8A2BE2.svg?style=flat-square)](docs/architecture/)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg?style=flat-square)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg?style=flat-square)](docs/guide/)

<p align="center">
  <a href="#核心特性">核心特性</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#编译与执行数据流">编译管线</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#文档导航">文档体系</a>
</p>

</div>

---

## 项目简介

**Loom Studio** 是专为 AI Native 时代设计的现代交互叙事与智能体编排工作台。

不同于传统简单的聊天工具，Loom Studio 原生集成 **Loom Core** 编译核心，将提示词编排（PromptBuild）、非线性时间线分支（Narrative Timeline）、模块化设定层（Setting Layer）与自主 Agent 工具链深度融合，为创作者与玩家提供工业级的上下文控制力与沉浸式叙事体验。

---

## 核心特性

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>预设即有序树 & 笼中深度</h3>
      <p>彻底告别传统的矩阵投影与深度争夺军备竞赛。预设是一棵干净的有序树，单次线性 DFS 遍历编译；外部世界书与卡片注入目标 Anchor 自动聚合为 Slot，局部深度（<code>1~9999</code>）严格封闭隔离，绝不打乱主干排版。</p>
    </td>
    <td width="50%" valign="top">
      <h3>时间线非线性叙事分支</h3>
      <p>像 Git 分支一样自由探索故事流向。支持随时建立多分支支线、节点级时光回溯与段落重演，结合底层细粒度事务保障，让每一段对话与世界发展都拥有可靠的持久化记忆。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Message 一等公民容器</h3>
      <p>所见即所得的消息边界。彻底剔除老旧工具中对相邻同角色消息的黑盒暴力合并；预设树上定义了几个 Message 块，大模型即精准接收几条物理消息，角色继承与作用域极其纯粹。</p>
    </td>
    <td width="50%" valign="top">
      <h3>Agent Tools & 动态上下文闭环</h3>
      <p>深度打通双向智能体能力。内置状态读写（<code>read_state</code> / <code>update_state</code>）、叙事交互工具（<code>append_narrative</code> / <code>edit_narrative</code>）与 Fresh Context 动态挂载，赋予模型修改世界并实时反馈的真正自主能力。</p>
    </td>
  </tr>
</table>

---

## 编译与执行数据流

```text
       ┌──────────────────┐      ┌──────────────────┐
       │   Card Bundle    │      │  Setting Layers  │
       └────────┬─────────┘      └────────┬─────────┘
                │                         │
                └───────────┬─────────────┘
                            ▼
           ┌────────────────────────────────┐
           │   PromptBuild DFS Pipeline     │
           │  (Ordered Tree & Caged Slots)  │
           └────────────────┬───────────────┘
                            ▼
           ┌────────────────────────────────┐
           │      Compiled Messages[]       │
           │  (First-Class Message Blocks)  │
           └────────────────┬───────────────┘
                            ▼
                 Provider Gateway & LLM
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
      [Text Output Stream]     [Tool Execution Loop]
               │                         │
               ▼                         ▼
      Timeline Append/Edit      State Mutation & Update
```

---

## 快速上手

### 环境准备

- **Node.js**: `>= 22.18.0`
- **pnpm**: `>= 9.15.0`

### 1. 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 2. 启动开发环境

我们提供了并行启动客户端与服务端的一键开发命令：

```bash
# 启动后端核心服务 (端口 4173)
pnpm dev:server

# 在另一个终端中启动前端客户端工作台 (端口 5173)
pnpm dev:client
```

启动完成后，在浏览器中访问 [http://127.0.0.1:5173](http://127.0.0.1:5173) 即可进入 Loom Studio 创作工作台。

### 3. 运行自动化检查与测试

```bash
# 运行单元测试
pnpm test

# 运行集成测试套件
pnpm exec vitest run tests/integration

# 编译检查所有 packages
pnpm build:packages
```

---

## 项目结构

项目采用严格的四层分层架构，单向依赖，高内聚低耦合：

```text
LoomStudio/
├── public/                 # 公共展示静态资源 (Logo、Banner、视频等)
│   ├── images/
│   └── videos/
├── apps/                   # 独立应用层
│   ├── studio-server/      # 服务端核心网关与 RPC 服务 (Node.js/Hono)
│   └── studio-client/      # 前端交互工作台 (React 19 / Vite / SCSS)
├── packages/               # 核心领域包与基础设施层
│   ├── core/               # @loom/core 编译内核管道
│   ├── application-runtime/# 应用运行时引擎、Agent Loop 与 PromptBuild 管线
│   ├── narrative-store/    # 时间线叙事分支持久化引擎 (SQLite)
│   ├── prompt-resource-store/# 预设与设定树存储
│   └── document-store/     # 统一文档与状态持久化
├── extensions/             # 扩展插件层
└── docs/                   # 完整架构设计与演进规范文档
```

---

## 文档导航

开始修改代码或了解深层设计之前，请查阅完整文档体系 [`docs/README.md`](docs/README.md)：

- **[`docs/guide/workspace-development.md`](docs/guide/workspace-development.md)** — 全仓开发规范、共同契约与任务路线
- **[`docs/architecture/`](docs/architecture/)** — 核心领域稳定架构合同（PromptBuild、Timeline、Agent、State）
- **[`docs/workbench/`](docs/workbench/)** — 演进中的设计提案与讨论
- **[`docs/archive/`](docs/archive/)** — 已落地完成的历史实施计划与归档总结

---

## 参与贡献

欢迎提交 Issue 和 Pull Request。在开始贡献前，请确保：
1. 恪守 KISS 原则与极简主义，杜绝过度工程；
2. 保持测试覆盖，提交前执行 `pnpm build:packages` 与相关定向测试；
3. 遵循现有的代码风格与命名契约。

---

## 许可证

本项目采用 [MIT License](LICENSE) 开源协议。
