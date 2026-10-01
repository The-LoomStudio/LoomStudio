# 单 Node.js 发布与玩家安装计划

> 状态：Beta 主程序切片已实施 / 标准应用构建通过 / 后续合同未决
> 更新：2026-10-02
> 本轮授权：2026-10-02 用户确认开始执行；实施已确认边界，不替未决权限/来源策略作决定。

## 1. 目标与已确认方向

玩家下载发行文件后，使用一个 Node.js 进程启动，通过同一浏览器入口访问完整应用。
前端预构建，后端沿用原生 `node:http` 托管；开发环境保留前后端双启动。
暂不制作桌面安装包、独立可执行文件或捆绑 Node.js；npm 发行属于后续方向。
本次发行仅为 Beta，不是正式稳定版。用户自行安装 Node.js 与项目依赖；
Release 暂不携带 node_modules，开包即用与自动安装 Node.js 留待后续。
提供平台启动脚本，避免每次都要求用户手动打开终端输入命令。
启动脚本可承载或提示必要的准备步骤，但不在每次启动时无条件联网安装或重建；
Windows、macOS、Linux 的具体脚本形式和双击行为在实施时按平台确认。
主程序同时支持 Release 下载与 Git Clone 后准备、启动；源码路径允许安装项目依赖与构建，
但最终游玩仍使用单 Node.js 正式入口，不要求双启动开发服务。
此决定不等于授权远程扩展安装器自动执行任意第三方仓库的安装/构建脚本。

正式扩展安装入口为远程链接，覆盖 GitHub 与其他 Git 托管来源。
ZIP 可以作为发行载荷与离线辅助入口，不作为玩家主要安装流程。
官方扩展由独立仓库维护、发版，安装后仍须按正式模块权限合同授权与启用。
ST 兼容导入与 The World 均为独立扩展；ST 兼容扩展用于前期过渡，
不是原生能力，也不是主程序首次运行或发布的必要依赖。
只有玩家选择导入 ST 格式时，才需要该兼容扩展；原生 Loom 内容不依赖它。

## 2. 非目标与未决事项

- 不引入第二套 HTTP 框架、安装器、资源存储或插件权限体系。
- 不自动执行陌生仓库的依赖安装、构建或生命周期脚本。
- 不把同进程 Server 扩展宣称为沙箱；Host 权限不能阻止直接使用 Node API。
- 首版默认本机访问；公网部署、多用户认证不属于本计划。
- 不承诺自动更新、数据恢复或升级后退回旧版；Beta 文档明确数据位置与风险，
  但仍不得主动覆盖或删除已有用户数据，不因 Beta 降低持久化正确性要求。
- Linux 按常规 Node 应用提供依赖安装与启动路径，不承诺已通过 Linux 实机验收；
  当前没有 Linux 人工验收环境，环境差异通过用户 Issue/PR 接续，不新增替代凭据存储。
- 官方扩展随包携带、首次推荐弹窗与勾选列表暂缓决策，不阻塞主程序发行。
- 第三方来源默认策略、允许/阻止名单粒度、内容外链策略尚未确认，不视为已批准行为。
- 直接 Git 安装如何处理未预构建源码、私有仓库认证与不同平台发行发现仍待收口。
- 扩展版本切换、权限增加及已导入资源迁移没有完整升级合同，不自动覆盖。
- 支持的平台/架构与具体 Node 版本范围按依赖和验证结果明确，不以原生包存在冒充实机验收。

承接既有 [Workspace 资源与在线分发计划](./workspace-resource-and-distribution-plan.md)，
不另建来源/更新体系。该计划已有“有 Git 时优先使用 Git、无 Git 时安全替换版本目录”
的方向；本计划补充玩家发行入口与获取边界，不擅自将其替换成仅支持 Release 下载。
若正式安装要求本机 Git，必须明确它是玩家前置条件；否则需提供无需 Git 的获取路径。

## 3. 最小工作包

| 工作包 | 所有权与范围 | 完成标准 |
| --- | --- | --- |
| 发行入口 | 根构建配置、Server 入口、HTTP adapter、Client Vite 配置 | 生成 Client dist；单命令启动；页面、静态文件、深链接可用；业务认证不弱化 |
| 发行目录 | 运行时依赖、内部 Package 产物、基础内容及必需静态资源 | 从仓库外任意工作目录启动，不依赖源码、Workspace 链接、tsx 或 Vite |
| 远程安装 | Server 下载/来源解析、现有安装器、扩展工作台 | 链接发现版本与权限，确认后下载、校验并安装；记录来源及精确版本/commit |
| 发布安全策略 | HTTP 认证、下载边界、内容 iframe/CSP、现有 Module grants | 区分入站、安装来源、出站请求、内容外链与代码执行；失败明确可诊断 |
| 玩家首次运行 | 数据目录、凭据、Provider/模型、基础预设、角色导入 | 空白用户目录完成配置、导入及第一次真实模型调用；重启保留数据与凭据 |
| CI / Release | 主仓库与独立扩展仓库 workflow | 校验版本，生成发行产物；仓库外冒烟；标签发布产物与摘要 |

远程安装建议链路：

```text
仓库或发行链接 -> 来源/版本/权限预览 -> 用户确认
  -> 下载与校验 -> 现有安装器 -> 授权/启用
```

下载策略应单独处理协议、重定向、目的地址、预算与取消，不直接套用到允许本机地址的模型 Provider。
摘要用于校验载荷一致性，不代替来源认证。
建议前端产物使用独立静态资源前缀，避免与业务 `/assets` 路由重叠。

## 4. 当前源码事实与阻碍账目

以下账目记录实施前的静态调查，不等同于发行测试；本轮实际修复与证据见第 6 节，
不得将已修复条目或新增 workflow 继续当作未实现，也不得将配置落盘当作远端通过。

| 编号 | 事实/证据 | 玩家影响 | 状态 |
| --- | --- | --- | --- |
| R01 | 根 `package.json` 的 build 为 Packages + tsc；Client 自己的 build 才运行 Vite | 根构建成功也可能没有可访问的前端产物 | 已确认 |
| R02 | `apps/studio-server/src/http/http-server.ts` 没有应用静态托管；会话前只开放 health/auth | 首页无法直接打开；不能把所有静态文件放在认证后 | 已确认 |
| R03 | Server 通过内部包名引用 Workspace，Server dist 不是完整运行目录 | 单独复制 dist 缺模块 | 已确认 |
| R04 | `main.ts` 默认 resolve `official/extensions`、`official/starter`，依赖 cwd | 从其他目录启动缺失基础内容/扩展 | 已确认 |
| R05 | `main.ts` Extension Host mode 固定 development，banner 固定 Client 5173 | 正式合同未启用，入口提示错误 | 已确认 |
| R06 | `codecs/card-png.ts` 顶层读取 `public/images/default-card.png` | 发行目录遗漏图片可在导入模块阶段阻断启动 | 已确认，未实际复现 |
| R07 | `packages/data-engine/src/sqlite.ts` 使用 node:sqlite；工具链固定 Node 22.18.0 | Node 环境属于前置条件，不能承诺任意 Node 版本 | 已确认 |
| R08 | SecretStore 默认系统 Keyring，包含原生依赖；失败不降级明文存储；Keyring 2.1.0 在 Linux 可回退内核凭据存储 | 系统凭据环境不可用时可能受阻；内核回退不会跨系统重启持久化，必须验收重启后凭据可用性 | 已确认，跨平台未验证 |
| R09 | 现有目录/ZIP 安装器和 ZIP UI 可用；没有远程发行发现/下载链路 | 玩家无法通过远程链接完成安装 | 已确认 |
| R10 | 同 ID 多来源被标记 unavailable；没有完整升级合同 | 不能将并存新版或重复安装冒充升级 | 已确认 |
| R11 | `.github/workflows/ci.yml` 只有源码 CI，没有 Release 与成品冒烟 | CI 成功不能证明下载后可用 | 已确认 |
| R12 | `main.ts` 在监听 HTTP 前初始化 Runtime、安装 starter；基础内容路径错误会使启动链路抛错 | 不能把基础内容作为可漏带文件；需在发行完整性检查中覆盖 | 已确认 |
| R13 | `main.ts` 固定默认 4173，支持 PORT；监听错误会使启动失败，无自动端口选择 | 端口占用或重复启动阻断使用；要有可操作提示，是否自动换端口待决定 | 已确认 |
| R14 | `extensions/import-conversion.ts` 将 ST 转换交给 `sillytavern.importer.*`；新 Module 默认禁用 | 仅 ST 导入流程需要已安装/启用兼容扩展；不是原生能力或主应用发布阻碍 | 已确认，独立扩展功能前置 |
| R15 | starter 不分发凭据；`agents-runtime.ts` 明确拒绝无模型绑定的 Preset | 基础预设存在不等于能开始对话；首次运行须完成账户、凭据、模型及预设绑定 | 已确认 |
| R16 | `platform/system-proxy.ts` 读取 HTTP(S) 环境代理与 macOS 系统代理；其他平台无系统代理探测，手动代理不接受认证 | 部分 Windows/Linux 玩家需手动配置；仅 SOCKS 或需要认证的代理目前不能直接配置 | 已确认 |
| R17 | Manifest 只检查 `engines.studio` 存在；当前安装/发现/Manager 未检索到宿主版本范围校验；主程序版本仍为 0.0.0 | 不兼容扩展可能装入后才失败；正式主版本与 SDK 兼容检查需收口 | 已确认，运行未验证 |
| R18 | `features/message-content/model/html-document.ts` 的 CSP 仅允许 data 图片，禁止外部字体、媒体、连接、iframe | 含外链的消息 HTML 无法完整呈现；与安全策略一起确定支持边界，不默认放开 | 已确认 |
| R19 | `studio-client/src/main.tsx` 会话建立失败只呈现固定失败文本；底层细节记录在日志 | 玩家遇到认证/启动失败缺少可操作恢复信息；需按真实失败给出诊断入口 | 已确认 |
| R20 | `data-engine/src/sqlite.ts` 自动执行 namespace migration，并拒绝比当前程序更高的 schema | 更新可能改数据库；仅替换旧程序不保证可回退，备份/恢复与版本支持须明确 | 已确认 |
| R21 | `createStudioServer()` 未传 localPaths 时使用 `.loomstudio-dev`，而正式 `main()` 显式传入系统用户路径 | 新 CLI/bin 若直接调用工厂而漏传路径，会误用开发数据位置；正式入口应复用正确路径规则 | 已确认 |

R13/R16/R18/R19 为可达的使用限制，不等同于已复现运行 Bug。
R08 的 Keyring 读取是按操作发生，不能据此宣称所有机器会在空白启动时失败。
初次调查时没有独立发行产物，因此当时的“仓库外运行失败”是待验收风险；
本轮已生成并验证独立运行目录，证据与完整构建限制见下文。

首轮继续调查的结论：发布硬阻碍集中于成品完整性、正式入口、远程安装与首次配置；
涉及扩展更新时再收口兼容/升级合同；数据库备份/回退作为后续事项，
本次 Beta 不承诺恢复能力，不将其作为发布阻塞项。
无需将所有开发工具、视觉改进与未来生态能力都作为首版发布前置。

2026-10-01 平台补充：核对 Node 22.18.0 BUILDING 与 Keyring 2.1.0 发布元数据，
Windows、macOS、Linux 均有对应平台/架构支持；未发现必须整体排除某个主流桌面系统的依据。
这不是 Loom Studio 跨平台验收通过；OS 最低版本、Linux libc/凭据服务和目标架构仍须明确。
Keyring 的 Linux 内核回退不跨系统重启持久化，不可将启动或一次保存成功当作凭据持久化验收。

证据入口：

- [Server](../../../apps/studio-server/src/main.ts)
- [HTTP](../../../apps/studio-server/src/http/http-server.ts)
- [扩展安装器](../../../apps/studio-server/src/extensions/extension-package-installer.ts)
- [扩展发现](../../../apps/studio-server/src/extensions/extension-sources.ts)
- [扩展工作台](../../../apps/studio-client/src/features/extension-renderers/ui/renderer-workspace-panel.tsx)
- [本地路径](../../../apps/studio-server/src/platform/local-paths.ts)
- [官方内容](../../../official/README.md)
- [ST 转换入口](../../../apps/studio-server/src/extensions/import-conversion.ts)
- [系统代理](../../../apps/studio-server/src/platform/system-proxy.ts)
- [消息 HTML 策略](../../../apps/studio-client/src/features/message-content/model/html-document.ts)
- [Manifest 校验](../../../packages/extension-sdk/extension-host/src/manifest.ts)
- [数据迁移](../../../packages/data-engine/src/sqlite.ts)

## 5. 验证与停止条件

实施后主要证据是独立发行目录冒烟：仓库外运行、空白用户目录、可写临时数据目录；
验证首页与深链接、静态文件、建立会话后的 RPC、基础内容、远程扩展安装、重启与正常停机。
真实 Provider 与系统 Keyring 验收单独记录，不以 Memory backend 或 HTTP health 冒充。
涉及原生依赖时按支持平台/架构验收；整体视觉和交互手感由用户验收。

调查期间不运行会写正式用户目录、下载执行陌生代码或调用真实模型的探测。
产品策略、权限、持久化升级或不可逆外部操作需要决定时暂停并提问。

## 6. 执行记录

### 本轮文件级设计

目标：Release 与源码准备后均能通过启动脚本运行一个正式 Node 服务。
复用现有 `node:http`、应用会话与用户路径，不修改业务存储和 UI。

1. `apps/studio-server/src/http/` 新增静态托管并接入现有 adapter；
   `main.ts` 使用安装位置解析资源，正式入口启用 production、仅同源认证；
   开发脚本显式声明 development，保留开发用扩展扫描。
2. `scripts/release/` 构建并整理 runtime dependency closure、前端与必需资源，
   生成 npm 安装清单/锁文件，不携带开发代码和 node_modules；
   根启动脚本支持首次准备、后续直接启动，不覆盖用户数据。
3. 主 CI 增加应用构建与成品冒烟；独立 Release workflow 校验标签版本，
   冒烟通过后打包并生成 SHA-256，仅标签触发远端发布。
4. 只验证静态路由/认证边界与真实独立产物；
   跨平台脚本和 CI 由 workflow 验收，本机不假称 Windows/Linux 已通过。

写集：上述 HTTP/入口/扩展扫描参数、Vite 配置、根脚本与 package scripts、
`.github/workflows/`、聚焦 HTTP 测试、发布文档与本 Plan/索引。
不改已有业务逻辑、凭据方案、内容 CSP、自动升级或数据恢复。
远程扩展完整获取策略及首次推荐暂留后续；不以本轮主程序发行冒烟冒充其完成。

- [x] 记录已确认发布方向与未决合同。
- [x] 核对构建、HTTP、路径、扩展安装、Keyring 和现有 CI。
- [x] 静态检查首次启动、模型前置条件、ST 导入、代理、内容外链与升级链路；记录 R12–R21。
- [x] 冻结并实施主程序 Beta 文件写集；未决权限/来源策略不擅自实施。
- [x] 实施统一 HTTP 入口、production 模式、安装位置资源路径、启动脚本、runtime 发行目录和 CI/Release。
- [x] 独立目录冒烟通过：首页、深链接、静态资源、认证、starter、无开发扩展、重启与停机。
- [x] 修复 Manifest Setting 引用校验；Packages 与 Server 标准构建通过。
- [x] 完整 `build:app` 通过：Manifest 校验与 Client 翻译键缺失均已修复。
- [ ] 远程扩展安装、来源/脚本执行策略、首次推荐与升级合同。
- [ ] 真实模型和系统凭据、浏览器人工验收，以及 Windows/Linux 远端验证。

2026-10-02 决策补充：Beta 允许用户自行安装 Node 与依赖，提供便捷启动脚本；
不承诺更新/恢复；Linux 保留常规发行路径并如实标记未实机验收。
本轮仅更新 Plan，未实施启动脚本或替代凭据后端。

### 2026-10-02 实施结果

已交付：

- `build:app` 明确构建后端与 Vite Client，Client 使用独立 `/app-assets/` 前缀，
  展示版本读取根版本；原开发双启动保留。
- 静态页面/文件在应用会话前可读取，API 与扩展文件保持原认证；
  支持 HEAD、受限 SPA fallback、路径/符号链接边界、MIME 与缓存策略。
- 正式入口按安装位置读取基础内容和前端，production Host 不默认扫描仓库开发扩展，
  不允许 Vite Origin 作为正式跨源；仍使用系统用户目录。
- 根 `start.sh` / `start.command` / `start.bat` 与 Node launcher 提供首次准备；
  Release 使用 npm ci，源码使用固定 pnpm 安装/构建，后续不重复准备。
- 发行目录只携带 20 个 runtime workspace 的 dist/元数据、锁定依赖清单、
  Client、starter、默认卡片图片和 banner；不含 node_modules 或可选官方扩展。
  内部依赖在发行根统一声明，运行包不执行 Workspace 开发脚本。
- CI 新增 Linux/macOS/Windows 的发行目录冒烟；标签 workflow 复用 CI，
  校验根版本、再次验证待上传目录、生成 ZIP/tar.gz/SHA256SUMS 并以 prerelease 发布。
  本轮没有推送、创建标签或实际发布 GitHub Release。

验证账目：

| 检查 | 结果与范围 |
| --- | --- |
| client-files + application-session-auth | 2 文件、5 用例通过；页面公开不等于 API 放行 |
| Server 定向 TypeScript | `tsc -p apps/studio-server/tsconfig.json` 通过，使用已生成依赖声明 |
| Vite production build | 通过；存在既有大 chunk 警告，未借此扩大优化范围 |
| Server 触及文件 ESLint | 通过；不代表全仓 lint 已运行 |
| Unix 启动脚本语法、workflow YAML 解析 | 通过；不代表 Windows 双击、GitHub workflow 已执行 |
| 独立产物冒烟 | Node 26.8.2 与 Node 22.18.0 均通过；复制到带空格临时目录，cwd 在应用外，使用空白用户目录 |
| 完整 build:app | 未通过：extension-host/src/manifest.ts 135、137、139 行仍使用可选 resourceId；该类型变更来自既有工作区，未覆盖或猜测其 reference 合同 |

实际偏差：为定位运行链路，先使用 `tsc -b apps/studio-server --noCheck` 生成依赖产物，
再进行 Server 定向类型检查和 Vite 构建；这不是完整构建成功。
运行验证目录为 `.artifacts/loom-studio-0.0.0-verified`，含 generated npm lock；
它是本地调试候选，不是可对外宣布通过全部发布门槛的正式产物。
首次冒烟因测试误读 listPackages 返回字段而失败，已按实际 `items` 合同修正，
最终 Node 26/22 两次检查通过；所有临时进程/用户目录均已清理。

剩余限制：远程获取/脚本执行与外链策略未决，未实现；没有真实 Provider、真实 Keyring
保存/系统重启、浏览器或 Windows/Linux 实机验收。没有自动更新和恢复能力。
标准 build:app 已在下述接续中通过；完整远端 CI 与发布仍未执行。

### Manifest 修复接续

用户确认修复后，仅调整 `extension-host/src/manifest.ts` 的 Setting Mount 校验，
沿用现有 legacy resourceId / package reference / external reference 合同。
包内引用验证声明与资源类型，外部引用验证字段与 origin，不要求包内存在外部资源；
按引用身份判重，拒绝混填、缺失和非法引用。不改变资源导入/解析语义。

`manifest.test.ts` 与 `extension-resource-import.test.ts` 共 41 用例通过。
再次运行标准 `pnpm build:app`，内部 Packages 与 Server 已通过；
Client 目前在 `preset-workbench.tsx:332` 因未定义翻译键 `preset.panel.views` 报 TS2345。
该 UI 改动来自既有工作区，本次未修改；当前全构建阻碍不再是 Manifest。
此前 runtime 候选与冒烟记录保留为当时证据，不宣称它们已包含本次修复。

### Client 翻译键修复接续

用户授权后，在中英文词典补齐 `preset.panel.views`，保留原有面板与无障碍标签。
标准 `pnpm build:app` 已完整通过，覆盖内部 Packages、Server 和 Client 的类型检查与构建。
Vite 仍提示部分产物超过 500 kB，这是非阻断警告；本轮未重新生成发行候选或执行成品冒烟。
