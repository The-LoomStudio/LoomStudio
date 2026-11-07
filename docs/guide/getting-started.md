# 快速启动指南 (Getting Started)

这篇指南将带你从零开始启动 Loom Studio 开发环境。

## 1. 前置条件

Loom Studio 固定使用下面的开发工具链，避免不同机器重新解析依赖或生成无关的 lockfile 变更：

- **Node.js**: 24.22.0（见 `.node-version` 与 `.nvmrc`）
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

Server 默认监听 `127.0.0.1:18010`，可通过 `PORT` 覆盖。当前主 RPC 是建立应用会话后的 HTTP `POST /trpc/<procedure>`；Extension Catalog 变化通过专用 `GET /extensions/events` SSE 推送，不存在通用 WebSocket 当前合同。

**终端 B: 启动 Client**

```bash
# 启动前端 Vite 调试服务器
pnpm dev:client
```

Client 默认监听 `127.0.0.1:18011`。打开浏览器访问该地址即可；Vite 会把 `/auth`、`/assets`、`/cards`、`/extensions` 与 `/trpc` 代理到 Studio Server。

若 Server 设置了不同的 `PORT`，启动 Client 时须同步设置 `STUDIO_SERVER_URL`（例如 `http://127.0.0.1:4174`）；代理目标不会自动跟随 Server 的端口环境变量。

### 在开发期间预览生产前端

保持 `pnpm dev:server` 运行，在另一个终端执行：

```bash
pnpm preview:client
```

命令先构建当前前端，再于 [http://127.0.0.1:18013/studio](http://127.0.0.1:18013/studio) 启动生产产物预览，可与 `18011` 的热更新开发页并行。它复用当前后端及其数据，页面中的保存、删除等操作会作用于同一份数据；不是独立沙箱或完整发行环境。

源码变化后停止并重新运行该命令以更新预览。`Ctrl+C` 只停止预览服务；端口占用时明确报错，不自动换端口或停止其他进程。自定义后端同样通过 `STUDIO_SERVER_URL` 指定。预览代理保留浏览器原始 Host，不改写 Origin，也不需要放宽后端会话白名单。

### 移动端局域网直连调试 (LAN 模式)

默认开发命令与正式生产运行仅绑定 `127.0.0.1`，严格拒绝外部网络请求以保护本地数据与模型凭据。若需要在同一 Wi-Fi 下使用手机等移动设备直连调试，使用显式独立命令：

- **DEV 热更调试**：
  - 终端 A：`pnpm dev:server:lan`（后端保持本地绑定，显式放行私网 RFC 1918 会话 Origin）
  - 终端 B：`pnpm dev:client:lan`（前端以 `0.0.0.0:18011` 启动，控制台输出手机可访问的局域网 Network IP）
- **生产产物预览调试**：
  - 保持 `pnpm dev:server:lan` 运行；
  - 另一个终端执行：`pnpm preview:client:lan`（前端生产产物预览以 `0.0.0.0:18013` 启动）

手机连接同一 Wi-Fi 后，访问终端输出的局域网地址（如 `http://192.168.x.x:18011/studio` 或 `:18013/studio`）即可直连。LAN 模式仅限开发态放行 RFC 1918 私网网段（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）及本地 `.local` 域名；生产运行坚决拒绝外部网络直接接入。请勿在不可信的公共网络下开启。

两个开发命令都会先构建内部 packages，再持续监听源码并更新产物。具有独立发布周期的扩展在根目录 `extensions/` 开发，自行构建后通过扩展中心重载；Server 不代为构建扩展。修改 `packages/` 下的源码后无需手动重新构建；Server 还会在 package 产物变化时自动重启。

STBridge、The World 以各自独立仓库的源码为基准，修改及构建后的完整 `dist/` 一起交付到对应仓库；不要在 `official/extensions/` 再维护副本。主仓库维护的官方内容从 `official/extensions/` 就地加载，不复制到根目录 `extensions/`。开发默认发现该目录中的现有包；发行打包范围由发行脚本单独决定。详见[官方扩展目录约定](../../official/extensions/README.md)。

开发脚本默认将持久数据放在仓库 `data/`，通过 `LOOM_STUDIO_DATA_ROOT` 指定；SQLite、Blob、Extension state/installed 等均使用这个根目录。运行日志（JSONL）与测试沙箱收拢在 `.loomstudio-dev/`。`/data/` 与 `.loomstudio-dev/` 均被主仓库 Git 忽略。

若本地开发沙箱积累了测试脏数据需要快速清理，可执行：

```bash
pnpm data:reset  # 安全备份现有数据后重置开发环境 data/
```

开发启动不会从旧 `.loomstudio-dev/data/` 目录迁移或恢复数据库。需要使用的数据库必须位于当前解析的数据根目录；Store namespace 版本不匹配时启动会报错，不会自动升级旧数据库。

正式无配置运行继续使用操作系统原生用户数据目录，不会默认把用户数据写进应用安装目录。

## 4. 依赖变更约定

安装前先查看 [`tech-stack.md`](tech-stack.md) 与正式
[`External Dependency Ownership`](../architecture/platform/external-dependency-ownership.md)，确认该问题是否已有能力所有者。已有依赖能够完整覆盖时优先复用；不要只因为不熟悉现有入口就增加平行库或手写第二套状态生命周期。

新依赖必须添加到实际消费它的 workspace，并显式指定版本：

```bash
pnpm add --filter <workspace-name> <dependency>@<version>
```

依赖升级应保持为独立、可审阅的改动，不要与普通功能开发混合提交。禁止使用 `latest` 或 `*`；项目已启用精确版本保存和严格 peer dependency 检查。

## 5. 运行测试

Loom Studio 提供多层级的测试以保证质量：

```bash
# 运行默认测试集（unit、contract、integration、regression；不含 probes / stress）
pnpm test

# 运行 Application Runtime 的当前单元与集成测试
pnpm exec vitest run tests/unit/application-runtime tests/integration/application-runtime
```

以上命令从仓库根目录执行，默认范围以根 `vitest.config.ts` 为准；显式设置 `LOOM_TEST_SCOPE` 会切换收集范围。需要 probes 或 stress 时分别使用 `pnpm test:probes`、`pnpm test:stress`（仅运行 stress）。根配置在没有匹配测试时失败退出，各包已有的测试命令也指向仓库根目录中的对应测试；验证时仍须核对实际执行的文件与用例数。

## 6. 项目结构初探

现在你已经可以跑通项目了。修改代码前先阅读 [`workspace-development.md`](workspace-development.md)，按任务进入目标 Workspace 的本地 README；需要理解全仓依赖和目录时，再查看 [`project-structure.md`](project-structure.md)。
