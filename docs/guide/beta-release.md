# Loom Studio Beta

本发行是 Beta，不承诺自动更新、数据恢复或退回旧版。升级前自行备份数据；
不要把旧程序能读取新数据库当作保证。

## 下载与启动

先安装 Node.js 24.22 或更新版本，确保 `node` 和 `npm` 能在当前账户使用。
Release 不携带 Node.js 或 node_modules，需要联网安装生产依赖。

macOS / Linux 发行启动器会启用 Node 原生模块编译缓存，改善后续启动。缓存使用 Node 默认临时目录，也可通过 `NODE_COMPILE_CACHE` 指定目录；`NODE_DISABLE_COMPILE_CACHE=1` 可禁用。缓存不可用时仍正常启动，删除缓存不影响业务数据。Windows 暂不自动启用，待验证当前 Node 的长路径行为后再调整。

- Windows：运行根目录的 `start.bat`。
- macOS：运行 `start.command`；系统执行权限或安全提示需要按本机设置处理。
- Linux：运行 `./start.sh`；桌面双击行为由文件管理器决定。
- 通用命令：在发行目录运行 `npm start`。

脚本首次发现没有 node_modules 时安装依赖，之后直接启动，不每次重新安装或构建。
打开终端输出的 `http://127.0.0.1:18010` 即可游玩，运行期间不要关闭服务窗口。
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

普通用户直接使用启动脚本或 `npm start` 即可，无需设置环境变量。
首次使用且目录中没有数据库时，程序自动创建当前版本的数据结构。
启动终端会显示实际数据目录；换一个程序解压目录仍会读取同一账户的默认数据，
并不会把不同程序目录的数据合并。删除程序目录也不会删除用户数据。
开发命令 `pnpm dev:server` 默认使用源码仓库内的 `data/`，不是上述正式数据目录。

升级前停止所有相关实例并备份整个数据目录。若已有旧库报表结构不兼容，
保留原数据并反馈错误，不要直接删库或把旧库覆盖到开发目录。
只为测试新安装时，可使用 `LOOM_STUDIO_HOME` 指定新的空目录；
这是一种可选隔离方式，不是普通用户启动的前提，也不会迁移或修复旧数据。

`LOOM_STUDIO_HOME` 可以指定独立的 data/cache/logs 根目录；
`LOOM_STUDIO_DATA_ROOT` 可以单独覆盖数据目录。不要让不同版本并发操作同一目录。
数据库和文件备份不包含系统凭据存储中的 API Key，换机后可能需要重新填写。

Linux 按普通 Node 应用提供运行路径，目前未进行 Linux 实机人工验收。
系统凭据服务不可用时可能保存失败，或回退到不跨系统重启保留的内核存储。
我们不自动降级到明文凭据文件，环境差异可通过 Issue/PR 反馈。

## 模型与扩展

基础预设不包含 API Key 或模型绑定。开始对话前，在应用中配置账户、模型并绑定预设。
原生 Loom 格式无需 ST 兼容扩展；导入 ST 格式才需要安装、授权并启用独立兼容扩展。
The World 等独立发行的官方扩展同样可选，不随主程序自动安装或授权。

扩展中心支持公开 HTTPS Git、远程 ZIP 和本地 ZIP 安装，先确认依赖清单，
再单独授权和启用。Git 来源需要系统 Git 2.37 或更新版本；ZIP 安装不需要 Git。
Git 分支可检查更新、切换 ref 和回退到前一个代码快照，本地修改须自行处理；
ZIP 由用户手动导入新版，不提供自动更新检查。
独立扩展在应用根目录 `extensions/` 安装和开发，文件数据位于用户数据目录
`extensions/<packageId>/`，源码和可执行产物不放入用户数据目录。
首次官方选择可跳过；STBridge 与 The World 从各自独立仓库下载，不预先放在发行包的
`official/extensions/`。Git 安装不执行构建，扩展发布包须包含 Manifest、资源和已构建的完整
`dist/`，不能把缺少运行产物的源码 ZIP 当作成品安装。当前源码的发行准备脚本携带 Loom Assistant 与 Story Memory，主题和背景包不随包分发；实际下载版本以对应发行说明及包内容为准。
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
冒烟会复制到临时目录、安装生产依赖，使用临时系统用户目录验证默认数据路径后清理，
不设置 Loom 数据路径覆盖变量，不访问正式用户数据。

标签 `v<根 package.json 版本>` 触发 GitHub Beta Release。标签与版本必须一致；
发布状态固定为 prerelease，不自动宣布稳定版。独立扩展仓库的发版不由此 workflow 负责。
