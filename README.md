<div align="center">

<img src="docs/images/nom-banner-015.png" alt="Loom Studio 与看板娘诺姆" width="960" />

# Loom Studio

**Weave worlds, interweave stories.**  
*编织世界，交织故事*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/Node-%3E%3D24.22.0-339933.svg?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Beta](https://img.shields.io/badge/status-Beta-e6ac35?style=flat-square)](docs/guide/beta-release.md)
[![Build Status](https://github.com/The-LoomStudio/LoomStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/The-LoomStudio/LoomStudio/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/The-LoomStudio/LoomStudio?include_prereleases&style=flat-square)](https://github.com/The-LoomStudio/LoomStudio/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg?style=flat-square)](docs/guide/)

<p align="center">
  <a href="#核心特性">核心特性</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#文档导航">文档</a>
</p>

[下载 Beta](https://github.com/The-LoomStudio/LoomStudio/releases) ·
[安装指南](docs/guide/beta-release.md) ·
[反馈问题](https://github.com/The-LoomStudio/LoomStudio/issues)

</div>

---

## 项目简介

**Loom Studio** 是本地运行的 AI 角色扮演与互动叙事工作台。角色、世界设定、故事分支和提示词可以放在一起管理，也可以给 Agent 配置工具，让它参与剧情编辑和状态更新。

每条故事使用同一份会话历史承接扮演输入与讨论。阅读视图聚焦剧情正文，工具调用与工作记录按需查看；在允许切换时更换预设，也能继续沿用已有历史。需要排查生成方式时，可以查看本轮提示词构建与模型调用记录。

目前处于 **Beta** 阶段，适合愿意尝试新功能、反馈问题的玩家和创作者。开始对话需要自行配置模型服务与 API 凭据；模型调用会将本轮上下文发送给所配置的服务。

## 核心特性

### 故事可以有另一种走向

用时间线整理剧情，从已有节点建立分支，继续尝试不同的发展。角色说错了话，或者只是想看看另一种选择，都可以另开一条线。

<p align="center">
  <img src="https://raw.githubusercontent.com/The-LoomStudio/LoomStudio-website/02791640977e1800de66a697cf6bc28a5eaf521d/public/images/nom/stickers/fullbody/reading.png" alt="抱着书阅读的诺姆" width="112" />
</p>

<p align="center"><em>诺姆：另一条线也想看……唔，就看一眼。</em></p>

### 角色和设定放在一起

用角色卡保存人物资料，用 Lore 整理世界设定，再通过预设安排它们如何参与对话。多个角色可以引用同一份设定，不必每张卡都复制一遍。

### 看看模型收到了什么

提示词预设负责组织消息、排列内容和选择设定。需要排查生成结果时，可以查看本轮构建结果，确认哪些内容送进了模型。

### 给 Agent 配上工具

除了生成回复，Agent 还可以通过已配置的工具读取状态、更新变量或编辑剧情。工具调用和返回结果保留在工作记录中；具体能做什么，取决于所用预设、已启用工具和扩展授权。

### 故事有自己的工作文件

每条时间线有共享文件工作区，可保存笔记与 `MEMORY.md` 等材料。Agent 通过已开放、已授权的工具读写文本；文件版本随故事分支与恢复点关联。文件保存和脚本执行是不同操作，保存脚本不会自动运行。

界面支持中文、英语、日语与韩语，语言与外观可在设置中调整。

---

## 快速上手

<p align="center">
  <img src="https://raw.githubusercontent.com/The-LoomStudio/LoomStudio-website/02791640977e1800de66a697cf6bc28a5eaf521d/public/images/nom/stickers/bust/tip.png" alt="举指提示的 Nom" width="112" />
</p>

### 安装并启动

先安装 **Node.js 24.22.0 或更新版本**，确保当前账户可以使用 `node` 和 `npm`。
程序不携带 Node.js 或依赖，首次启动需要联网。

在 [Releases](https://github.com/The-LoomStudio/LoomStudio/releases) 查看可用的 Beta 成品包，下载后解压。
若没有可用成品包，可使用下方源码启动方式。GitHub 自动生成的 Source code 压缩包也是源码，需要构建后运行。

| 系统 | 启动入口 |
| --- | --- |
| Windows | `start.bat` |
| macOS | `start.command` |
| Linux | `./start.sh` |
| 通用命令 | 在程序目录运行 `npm start` |

首次启动会安装依赖，之后直接启动。macOS 执行权限或安全提示需按本机设置处理；
Linux 双击行为取决于文件管理器，目前未进行 Linux 实机人工验收。

打开服务窗口显示的地址，默认是 **http://127.0.0.1:18010**，运行期间保持服务窗口开启。
端口占用时停止其他实例，或通过 `PORT` 环境变量指定端口。
前端已由 Node.js 服务托管，玩家无需分别启动前后端。

<details>
<summary>数据存在哪里，升级前怎样备份</summary>

正常启动不需要设置数据路径。正式运行的数据不在解压目录：macOS 默认位于
`~/Library/Application Support/LoomStudio`，Windows 位于 `%LOCALAPPDATA%\LoomStudio`，
Linux 位于 `${XDG_DATA_HOME:-~/.local/share}/loom-studio`；终端会显示实际数据目录。
更换程序目录不会新建一套用户数据，删除程序也不会删除这些数据。
开发命令 `pnpm dev:server` 则默认使用仓库 `data/`，与正式运行隔离。
升级前停止服务并备份整个数据目录；旧数据库不兼容时不要直接删除，处理方式见
[Beta 安装与发布指南](docs/guide/beta-release.md#用户数据与凭据)。

目前不提供自动更新，也不保证新版数据能退回旧版使用。备份不包含系统凭据存储中的 API Key，换机后可能需要重新填写。

</details>

**升级前请停止服务并备份数据目录。** 数据恢复和旧版兼容仍有限制，详见上面的数据说明。

### 从源码启动

```sh
git clone https://github.com/The-LoomStudio/LoomStudio.git
cd LoomStudio
npm start
```

也可以使用相同的启动脚本。首次启动会通过 npm 调用固定版本 pnpm 安装依赖，
在缺少构建产物时构建应用。更新源码后需主动运行 `pnpm build:app`；
启动脚本不会检测源码是否变化。

开始对话前，还需要在应用中配置账户、API 凭据、模型并绑定预设；
基础内容不提供 API Key 或模型绑定。服务仅供本机使用，不承诺局域网、公网或移动端访问。
用户数据与程序文件分开保存，路径和系统凭据限制见 [Beta 安装与发布指南](docs/guide/beta-release.md)。

### 官方扩展

| 扩展 | 用途 |
| --- | --- |
| [STBridge](https://github.com/The-LoomStudio/LS_STBridge) | 导入 SillyTavern 角色卡、世界书、预设和聊天记录，并提供部分 EJS / MVU 兼容。 |
| [The World](https://github.com/The-LoomStudio/LS_The_World) | 管理故事中的时间、天气、地点与场景，为 Agent 提供读取和更新世界状态的工具。 |

两个扩展都可以按需安装，不是启动主程序的前提。可用版本、安装方式和兼容范围以各自仓库为准；STBridge 不会完整复刻 SillyTavern 的运行环境。

扩展中心支持公开 HTTPS Git、远程 ZIP 和本地 ZIP 安装。安装来源需要包含构建产物，宿主不会代为构建。安装后还需按提示授权、启用，并在实际使用的角色、故事或预设中采用相应能力。

Server 扩展运行在服务端进程中，**不是安全沙箱**。安装前请确认来源与权限。

## 开发环境

### 环境准备

- **Node.js**: 开发工具链固定 `24.22.0`（`.node-version` / `.nvmrc`）
- **pnpm**: 开发工具链固定 `9.15.0`（`package.json` 的 `packageManager`）

根 `package.json` 的最低运行要求为 Node `>=24.22.0`、pnpm `>=9.0.0`；开发环境按上述固定版本对齐。

### 1. 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 2. 启动开发环境

在两个独立终端分别启动服务端与客户端；两个命令均会先构建并监听内部 Packages：

```bash
# 启动后端核心服务 (端口 18010)
pnpm dev:server

# 在另一个终端中启动前端客户端工作台 (端口 18011)
pnpm dev:client
```

启动完成后，在浏览器中访问 [http://127.0.0.1:18011](http://127.0.0.1:18011) 即可进入 Loom Studio 创作工作台。

### 3. 检查与构建

按改动范围选择相关检查，具体见[测试指南](docs/guide/testing.md)。

```bash
# 运行默认测试集（unit、contract、integration、regression；不含 probes / stress）
pnpm test

# 检查包与测试的类型契约
pnpm check:types

# 运行集成测试套件
pnpm exec vitest run tests/integration

# 编译检查所有 packages
pnpm build:packages

# 构建完整主应用（Packages、Server 与 Client）
pnpm build:app
```

---

## 项目结构

客户端提供编辑和阅读界面，本地 Node.js 服务负责模型调用、数据存储与扩展运行。

```text
LoomStudio/
├── apps/
│   ├── studio-client/     # 工作台界面
│   ├── studio-server/     # 本地服务
│   └── playground/        # 命令行调试入口
├── packages/              # 运行逻辑、存储、模型接入与共享组件
├── official/              # 随主程序发行的基础内容
├── extensions/            # 独立安装或开发的扩展，不由主仓库跟踪
├── examples/              # 示例内容
├── public/                # 图片等展示资源
└── docs/                  # 使用说明与开发文档
```

涉及提示词编译时，先看 [PromptBuild 文档](docs/architecture/application/prompt-build/README.md)：当前 Agent 使用 Application 编译器及异步正文处理器；Core 原型已经退役。更详细的目录职责见[项目结构](docs/guide/project-structure.md)。

开发界面前，先看 [Client README](apps/studio-client/README.md) 的依赖职责与复用入口：Zustand 管理本地布局和偏好，TanStack Query 管理已接入领域的远端缓存，表单草稿与流式执行状态由各自组件或 Feature 拥有。其他能力与实际使用入口见[技术栈](docs/guide/tech-stack.md)和[依赖所有权](docs/architecture/platform/external-dependency-ownership.md)，避免重复实现已有的编辑、解析、菜单和存储能力。

---

## 文档导航

了解模块关系与前后端协作时，从[系统总览](docs/architecture/system-overview.md)进入。开始具体开发时，用[需求词与源码路由](docs/guide/workspace-development.md)定位；文档分工见 [`docs/README.md`](docs/README.md)，不要求通读文档库：

- **[`docs/guide/workspace-development.md`](docs/guide/workspace-development.md)** — 全仓开发规范、共同契约与任务路线
- **[`docs/guide/beta-release.md`](docs/guide/beta-release.md)** — 玩家安装、数据目录、发行命令与 Beta 限制
- **[`docs/architecture/`](docs/architecture/)** — 核心领域稳定架构合同（PromptBuild、Timeline / Session、Agent、State、Workspace）
- **[`docs/workbench/`](docs/workbench/)** — 演进中的设计提案与讨论
- **本地 `docs/archive/`** — 冻结的历史材料，不代表内容全部已实现；该目录被 Git 忽略，不随 GitHub 仓库分发

---

## 参与贡献

问题反馈请附上系统、Node.js 版本、启动方式和相关日志，不要上传 API Key 或其他私密数据。

欢迎提交 Issue 和 Pull Request。改动尽量聚焦一个问题，沿用现有代码风格，并说明验证了哪些行为。开发入口和验证方式见上方文档。

<div align="center">

### 项目活动

![Repobeats 项目活动看板](https://repobeats.axiom.co/api/embed/b45b36c376b32dccef9d2efee5e871c2827709cf.svg "Repobeats analytics image")

[![贡献者](https://contrib.rocks/image?repo=The-LoomStudio/LoomStudio)](https://github.com/The-LoomStudio/LoomStudio/graphs/contributors)

### 一起编织下一段故事

[![Star History](https://api.star-history.com/svg?repos=The-LoomStudio/LoomStudio&type=Date)](https://www.star-history.com/#The-LoomStudio/LoomStudio&Date)

<img src="https://raw.githubusercontent.com/The-LoomStudio/LoomStudio-website/02791640977e1800de66a697cf6bc28a5eaf521d/public/images/nom/stickers/bust/thank-you.png" alt="比心感谢的 Nom" width="128" />

谢谢每一位分享作品、反馈问题和参与贡献的伙伴。

<em>诺姆：原来已经有这么多人来看了呀……有点紧张。不过，好开心。</em>

</div>

---

## 许可证

本项目采用 [MIT License](https://opensource.org/licenses/MIT) 开源协议。
