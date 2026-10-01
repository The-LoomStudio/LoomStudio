# Loom Studio Beta

本发行是 Beta，不承诺自动更新、数据恢复或退回旧版。升级前自行备份数据；
不要把旧程序能读取新数据库当作保证。

## 下载与启动

先安装 Node.js 22.18 或更新版本，确保 `node` 和 `npm` 能在当前账户使用。
Release 不携带 Node.js 或 node_modules，需要联网安装生产依赖。

- Windows：运行根目录的 `start.bat`。
- macOS：运行 `start.command`；系统执行权限或安全提示需要按本机设置处理。
- Linux：运行 `./start.sh`；桌面双击行为由文件管理器决定。
- 通用命令：在发行目录运行 `npm start`。

脚本首次发现没有 node_modules 时安装依赖，之后直接启动，不每次重新安装或构建。
打开终端输出的 `http://127.0.0.1:4173` 即可游玩，运行期间不要关闭服务窗口。
端口占用时停止另一个实例，或通过 `PORT` 环境变量指定端口。
服务仅允许本机访问，不承诺手机、局域网或公网访问。

如需手动准备 Release：

```sh
npm ci --omit=dev
npm start
```

Git Clone 用户使用相同启动脚本。首次准备会通过 npm 调用固定版本 pnpm 安装开发依赖、
构建应用，然后启动正式服务；源码发生变化后，主动运行 `pnpm build:app` 重建。
开发联调仍使用 `pnpm dev:server` 与 `pnpm dev:client`。

## 用户数据与凭据

应用文件和用户数据分开保存。默认位置：

- macOS：`~/Library/Application Support/LoomStudio`
- Windows：`%LOCALAPPDATA%\LoomStudio`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/loom-studio`

`LOOM_STUDIO_HOME` 可以指定独立的 data/cache/logs 根目录；
`LOOM_STUDIO_DATA_ROOT` 可以单独覆盖数据目录。不要让不同版本并发操作同一目录。
数据库和文件备份不包含系统凭据存储中的 API Key，换机后可能需要重新填写。

Linux 按普通 Node 应用提供运行路径，目前未进行 Linux 实机人工验收。
系统凭据服务不可用时可能保存失败，或回退到不跨系统重启保留的内核存储。
我们不自动降级到明文凭据文件，环境差异可通过 Issue/PR 反馈。

## 模型与扩展

基础预设不包含 API Key 或模型绑定。开始对话前，在应用中配置账户、模型并绑定预设。
原生 Loom 格式无需 ST 兼容扩展；导入 ST 格式才需要安装、授权并启用独立兼容扩展。
The World 等官方扩展同样可选，不随主程序自动安装或授权。

当前 Beta 发布切片未实现远程扩展发现/下载；已有本地 ZIP 导入仍保留，
不代表计划中的远程安装流程已经完成。
可执行 Server 扩展是可信同进程代码，不是安全沙箱；安装前确认来源和风险。

## 维护者发行命令

从已安装依赖的源码仓库运行：

```sh
pnpm build:app
pnpm release:prepare
pnpm release:smoke
```

默认发行目录为 `.artifacts/loom-studio-<版本>`，已存在时拒绝覆盖。
prepare 可接受另一个新目录；smoke 可接受相同目录参数。
发行目录包含运行产物、npm 锁文件和启动入口，不携带 node_modules、源码和开发扩展。
冒烟会复制到临时目录、安装生产依赖，使用独立用户目录验证后清理，不访问正式用户数据。

标签 `v<根 package.json 版本>` 触发 GitHub Beta Release。标签与版本必须一致；
发布状态固定为 prerelease，不自动宣布稳定版。独立扩展仓库的发版不由此 workflow 负责。
