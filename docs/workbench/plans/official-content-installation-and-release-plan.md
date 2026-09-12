# 官方内容文件化、安装与独立发布计划

> **Status**：In Progress / WP0 已冻结本地安装切片，远程来源待确认
> **日期**：2026-09-11
> **授权**：用户确认同仓分目录、独立发布、官方资源安装询问、正式安装路径与用户数据保护；源码迁移和本地安装切片已实施，剩余交付按下方最新执行顺序接续。

> **最新执行顺序**：先完成本地 Default 系统与完整可体验交付；远程发布/安装明确延期，不阻塞本地阶段。ST 数据兼容扩展将作为第一个远程发布的官方包。用户已授权取消 ST 静态引用；现已接入 Host RPC 生命周期，见最终结果。

## 目标

将官方基础预设、Settings、专用 Agent 和正式官方扩展作为真实可分发内容维护。应用推荐并询问用户是否安装，通过正式导入/安装能力投入使用；内容可以独立于主应用发布和更新。用户能在正式 Studio 中直接体验完整样例，而不是自行拼接测试文件。

## 首轮实施基线（历史）

下列硬编码官方资源、旧 `extensions/*` 目录和 ST 静态依赖描述记录迁移前状态，不能作为当前事实引用。当前官方文件位于 `official/`，本地显式安装与 Host RPC 解耦结果见本文件最终结果；完整样例和远程发布仍未完成。

- `packages/application-runtime/src/prompt/prompt-resource-defaults.ts` 硬编码官方问答预设、知识 Setting、稳定资源 ID 与节点 ID。
- `packages/application-runtime/src/runtime/runtime.ts` 在初始化时创建官方资源、恢复 tombstone、按节点集合变化重建官方预设、调整 Setting capabilities，并补充全局 Setting 挂载。文件化不能只替换构造函数而保留这些隐式写入。
- `apps/studio-server/src/extensions/extension-sources.ts` 支持 repository、dev-link、installed 三类来源；仓库来源当前扫描一个目录的直接子目录。
- `apps/studio-server/src/extensions/extension-package-installer.ts` 支持本地目录校验、staging 和版本目录安装；这不等于已具备远程下载、Archive 安装、在线版本发现或完整升级事务。
- `apps/studio-server/src/main.ts` 直接导入 `@loom-studio/sillytavern-importer`。本次移动源码不等于解耦该产品依赖。
- `pnpm-workspace.yaml` 当前包含 `extensions/*`；`scripts/dev-with-packages.mjs`、`scripts/check-workspace.mjs` 和验证脚本引用现有路径。
- `extensions/example-echo` 同时包含 RPC、宏、State、文本规则和 Renderer，是接口联调样本，不是面向用户的默认产品内容。
- `examples/loom-scripts/README.md` 目前要求手动导入 Rule、Extractor、Script 并配置 Mount；不能据此声称已有一键可体验的完整角色样例。
- Agent 的可打包配置边界尚需核对。不可把运行 Session、Provider 凭据或本机配置当作官方 Agent 内容导出。

## 已确认决策

### 内容身份与分发

- Official 表示维护来源；Default 表示官方推荐的默认安装集合；Dev 表示开发测试用途。三者不产生独立 Host、权限体系或数据引擎。
- Default 不等于静默安装或启用。新工作区展示推荐内容，用户确认后安装；用户可以跳过，并在后续入口再次安装。
- Official 不自动获得权限。安装、导入作者资源、启用代码、授权是不同操作，继续遵守现有 Mount / Grant 合同。
- ST 数据兼容作为正式官方扩展维护；Echo 保留在开发测试范围。完整教程角色属于可选示例，不能自动混入用户工作区。
- 背景图片和面板材质是原生外观能力方向；本计划不把演示扩展直接提升为默认后台运行插件，也不实施原生化改造。

### Git 与独立发布

- 当前保持同一 Git 仓库，不创建子仓库或 submodule。按交付单元独立版本与构建发布：官方基础内容包、ST 兼容扩展分别维护。
- 源文件进 Git；私人卡、实际会话、数据库、密钥、本机 dev-link 路径不进 Git。构建产物由源文件生成，不维护另一份手工副本。
- 应用发行固定推荐/携带的内容版本，不跟随浮动分支。内容可以在主应用两个 release 之间单独发布。
- GitHub Release、NPM 等是包来源，不是运行机制。来源解析后进入同一校验与安装路径；不能将 `git pull`、`npm install` 或安装脚本直接作用到用户运行工作区。
- 同仓独立发布先行。拆仓需要真实独立维护需求与稳定消费合同，不是本阶段前提。

### 作者文件、安装包与用户数据

```text
Git 中的作者工程
  -> 正式编解码/打包
  -> 固定版本发行产物
  -> 本地来源或远程来源获取
  -> 校验与安装
  -> 用户确认导入/启用
  -> 用户工作区与 Timeline
```

- 复用既有资源 Artifact、Extension Manifest、State Artifact 和 `.loom.js` 格式。普通预设/Settings 不因分发而强制拥有可执行 Module。
- 分文件作者工程与发行 Artifact 可以不同，但转换由同一套编解码能力承担。CLI、Dev Workspace 和 Studio 不各造一套。
- 迁移保留已有 Package、资源、节点与授权身份。不以目录名称推导新 ID。
- 用户已有资源不被启动时重写、恢复删除或重挂已移除绑定。首次默认安装也改为用户确认，不保留“只要缺失就自动创建”的旧提议。
- 新包可用不等于更新当前作者副本。首版不做自动合并；替换用户修改需明确目标、差异/影响与确认，并沿现有版本并发检查。
- 更新不得反向改写已冻结 Timeline。扩展升级不得继承未经确认的新权限；不能默认多版本可同时激活。
- 内部必需的 Tool 实现、Runtime 不变量与普通可选官方内容要分清，不能把所有带 `official` 名称的对象一并移出启动过程。

## 建议目录与非目标

WP0 核对路径后冻结；以下是目标分区，不是新增文件格式合同：

```text
official/
  starter/                     # 预设、Settings、Agent 配置及资产
  extensions/
    st-data-compat/             # 保留原 package / manifest 身份
examples/
  character-status/            # 完整可导入、可体验的角色工程
tests/
  fixtures/
    extensions/
      echo/                    # 可构建、可复用的接口样本
```

不建立内容重复的 `default-data/`。发行清单选择官方包及其固定版本；具体清单格式由 WP0 复用现有合同后决定。

本计划不包含完整双向文件同步、通用 CLI/MCP 平台、依赖求解、Marketplace、自动合并、跨包原子升级保证、Server 强隔离重构、ST 转换逻辑重写、背景原生化。只消费相关计划中完成本次交付必需的能力。

## 工作包与文件边界

### 2026-09-11 本轮冻结的首个执行切片

- 源目录按上文迁移；天气测试扩展同 Echo 放入 `tests/fixtures/extensions/weather-station`。保留原 npm package name / Manifest ID。
- 本地官方基础资源由 Server 读取 `official/starter` 的文件，应用层处理稳定身份与事务写入；Runtime 不直接依赖仓库路径。首次安装必须显式调用，初始化不再写官方预设、Setting 或全局挂载。
- Agent 采用不携带模型的模板（名称 + preset 引用），安装资源后用户选择已有模型再调用现有 `createAgentProfile`，不把凭据/Provider ID/Session 放进官方包，不强行放宽当前 AgentProfile 的必填模型合同。
- 第一切片只新增缺失的官方资源，保留已有资源且不重挂已有 preset；不将其宣称为完整升级实现。显式替换、在线版本来源和原生背景能力不在该切片中。
- 官方内容入口提供只读包信息和显式安装动作，跳过即不安装；不在启动时自动弹反复出现的阻塞对话框。完整首次推荐样板随后在现有工作台中接入。
- 目录迁移首切片曾暂留 ST 直接依赖；后续用户已授权取消，导入仅调用当前 Host RPC 注册。远程发布主体与地址未提供，禁止伪造在线成功。

### WP0：主 Agent 冻结合同

- 核对所有默认内容与必需 Runtime 初始化，确定可选安装清单、Agent 可分发配置和绑定恢复语义。
- 冻结目录迁移表、包格式、身份映射、推荐入口、安装/导入/更新状态归属，以及可用来源优先级。
- 核对旧官方 ID 的消费方，保证拒绝安装时不会产生悬空默认 Agent/Preset/Setting 引用。
- 使用真实 UI 组件制作安装询问与包详情的最小样板；复用现有 Master–Detail，不建立另一套市场页面。
- 写入本计划后才派发实施任务。公共合同、根配置和启动集成由主 Agent 持有。
- 写入范围：本 Plan、必要的公共合同/初始化入口、正式开发预览样板；跨范围修改先明确新边界。

### WP1：Sol Low，官方内容与安装语义

- 将硬编码作者内容转成真实文件与正式可分发资源；不是把 TypeScript 大对象原样藏进另一层加载器。
- 复用正式导入和持久化能力，取消该内容的启动恢复/重写/重挂行为，处理旧工作区已有资源。
- 接入官方推荐安装和显式更新的业务流程，错误可见，拒绝/取消不创建资源或授予权限。
- 主路径：`packages/application-runtime/src/prompt/`、`runtime/runtime.ts`、必要的资源导入方法、`official/starter/`；UI/RPC 写入清单由 WP0 精确冻结。
- 不自行创造通用 Package Manager、Agent Bundle 或来源更新协议；遇到合同缺失回报主 Agent。

### WP2：Luna High，机械目录迁移

- 在 WP0 清单冻结后移动 ST、Echo 及适用样本；保留内容与身份，更新指定相对路径、构建引用和文档链接。
- 移动范围只限清单中的原目录/目标目录与指定引用文件，不修改 Runtime 生命周期和 ST 转换逻辑。
- 根 Workspace、watch 配置、lockfile 及启动入口交主 Agent 集成，避免与 WP1 交叉写入。
- 机械范围较小时由 Sol 一并完成，不强制启动第二个 Worker。

### WP3：Sol Low，发行产物与来源获取

- 先跑通自包含产物和本地安装，再接首个确认的远程来源；远程安装属于目标，不把“本地成功”当作整个计划完成。
- 复用现有 Installer，增加必要的来源解析、下载/Archive 校验、版本/兼容性检查与失败清理。
- 固定版本与产物完整性；摘要必须来自可信发布索引/来源，不能把包自报 hash 当成来源认证。
- 路径穿越、符号链接、超限、下载失败、已存在版本等按现有安全边界处理；不执行包安装脚本。
- 相关入口：`apps/studio-server/src/extensions/extension-sources.ts`、`extension-package-installer.ts`、`extension-manager.ts`，以及 WP0 指定的 RPC、发布脚本和测试。
- 官方内容与可执行扩展仍使用各自正式导入/启用合同，不为了统一下载强制统一运行类型。

### WP4：主 Agent 集成与可见交付

- 干净工作区中确认安装官方内容、选择模型配置并使用官方 Agent；无 API 凭据时明确待配置，不伪造成功。
- 提供完整示例角色，以固定正文和数据验证 State、宏、文本处理、渲染，不要求付费模型调用才能看到结果。
- 从文件打包导入、应用编辑、导出核对；语义与绑定不丢，源码要求 byte-exact 的部分继续保持。
- 验证正式发行不扫描 Dev 样本，开发环境显式加载样本仍走真实 Host。
- 更新 Architecture 的已实现事实、教程和本 Plan 最终结果；用户确认实际体验后再归档。

执行顺序：WP0 → WP1/WP2（仅写入边界独立时并行）→ WP3 的本地产物部分 + WP4 本地可见交付 → 独立安排 WP3 远程部分，以 ST 为首个官方发布包。每个 Worker 任务包指定实际文件、单一目标、最小验证和停止条件；不继承整个历史重新设计。本地阶段可以独立验收，但不将远程部分标为已实现。

## 完成条件与验证预算

- 新工作区可接受或跳过官方推荐；跳过后可正常启动，无缺失引用；重新启动不再次隐式安装。
- 旧工作区的修改、删除、解绑、授权和冻结 Timeline 保持；用覆盖这些行为的定向 Runtime 测试验证。
- 正式 Artifact 在干净环境可安装，不依赖源码仓库路径或 `workspace:*` 运行解析；运行相关构建和单个安装/往返测试。
- 首个远程来源可以固定版本安装及显式更新；下载/校验失败不激活半成品，不扩大权限。使用本地模拟下载验证失败路径；真实发布端到端验证单独记录。
- Echo 可被现有测试/开发命令使用但不默认出现在发行环境；核对发行清单和扫描入口，不以移动目录代替证据。
- 用户可通过正式 UI 看到官方资源和完整示例的真实结果。自动测试、客观浏览器诊断、主观验收分开记录。
- 不默认跑全仓检查；公共类型改变才做受影响包类型检查，路径/产物改变才做相关构建，文档修改运行链接检查。

## 尚需冻结的执行参数

以下不阻塞保存计划和 WP0 调研，不允许 Worker 自行假定：

1. 主 Agent 根据现有编解码确定基础内容包如何承载 Agent 配置与跨资源引用，是否确有缺失合同。
2. 首个远程源用 GitHub Release 还是 NPM、具体发布主体/仓库/包名、可信索引地址；由主 Agent 提方案，用户确认实际外部发布目标。当前没有发布到任何外部平台的操作授权。
3. Archive 格式复用范围、内容包与扩展包的版本选择/替换动作，须与现有 Manager 多版本处理对齐。
4. 离线时是否提供随应用携带的固定版本安装包，以及安装询问出现位置/跳过记忆；由主 Agent 在 WP0 样板中给出最小方案。
5. ST 加载边界已冻结并实施：应用仅绑定转换 RPC 协议，不导入扩展实现；启停、重载与卸载受现有 Host 管理，不新增转换器注册系统或进程隔离。

## 停止条件

- 需要变更既有身份、数据库迁移、强制覆盖/删除用户资源、执行外部安装脚本或新权限时，停止受影响部分并回报。
- 不以官方身份绕过授权，也不宣称同进程 Server Extension 具备恶意代码隔离。
- 缺少真实发布地址/权限时完成本地与模拟源验证，明确真实发布阻塞，不捏造远程验收。
- 不扩大到完整 Dev Workspace、市场或跨资源自动合并。连续两轮同一失败后停止 Worker 自修，由主 Agent 判断。

## 相关计划

- [Extension Package Source 与 Host](./extension-package-source-host-runtime-plan.md)：仅承接本计划必需的产物与来源工作；其历史“尚未实现”列表须按当前源码复核。
- [Dev Workspace](./workspace-dev-sync-plan.md)：后续消费同一作者文件/编解码，不在本次补齐双向同步。
- [CLI / MCP 适配器](./application-capability-cli-mcp-adapters-plan.md)：正式能力的工具入口，不另造导入语义。
- [主体资源 Bundle](./typed-primary-resource-bundle-plan.md)：先核对现有实现，避免重复格式。
- [Text Pipeline 已归档基线](../../archive/plans/text-pipeline-loom-script-renderer-integration-plan.md)：沿用已实现能力，补充可见样例，不重启该计划。

## 最终结果

首个本地安装切片已实施，整个计划保持 In Progress，不归档：

- 官方问答预设/知识 Setting 已从 TypeScript 大对象移至 `official/starter` 的正式 Prompt Resource Artifact；保留原稳定资源和节点身份。`catalog.json` 包含独立版本、文件与挂载引用、不含模型的 Agent 模板。
- `installOfficialContent` 通过 Application 事务显式创建缺失资源。启动不再创建、恢复、覆盖官方资源或重挂全局 Setting / 已移除 Tool Mount；已存在资源与 tombstone 保留。存在 Profile 引用时拒绝删除 Preset，不再回退到可能未安装的官方 Preset。
- Server 的 `official.listContent`、`official.installContent`、`official.exportContent` 从配置的本地目录读取；安装/导出检查用户确认的内容摘要，文件读取限制目录边界和大小。摘要不是远程来源认证。
- 扩展工作台「官方推荐」提供确认安装、原始包导出、选择用户已有模型创建 Agent；并不声称已做全局首次启动安装向导。跳过该入口不安装资源，也不写额外的安装偏好记录。
- ST 源码移至 `official/extensions/st-data-compat`；Echo 与天气测试扩展移至 `tests/fixtures/extensions`。Manifest/package 身份保持，Workspace、构建/测试别名与 lockfile 已同步；离线重建 Workspace links 未新增依赖。
- `pnpm official:pack` 生成可携带的 ZIP，拒绝覆盖已有目标。`.artifacts` 被 Git 忽略；没有执行远程发布。正式部署需携带 `official/starter` 或指定 `officialContentDirectory`，目前不支持 UI 上传 ZIP。

验证记录：

- Worker：Runtime 定向测试 4/4；Application Runtime 构建通过，覆盖新工作区不自动创建、显式安装、重启保护、重复无写入和非法输入无半成品。
- 主 Agent：Server 官方内容集成测试 2/2；从正式 RPC 导出 ZIP，核对原始文件字节，再从解包目录启动第二个干净工作区并安装，稳定身份不丢；同时覆盖摘要过期拒绝、路径越界拒绝和 Dev 默认排除。
- 主 Agent：ST importer 定向测试 7/7、Client `tsc -b`、Server 构建、Echo/天气测试扩展构建通过；`pnpm official:pack` 实际生成 `.artifacts/official.starter-0.1.0.zip`。
- 迁移回归：旧 `post-session-anchor.test.ts` 仍引用已移除的硬编码构造函数，已改为读取真实官方 Artifact，2/2 通过；没有恢复重复的硬编码数据。
- 未运行真实浏览器、移动端或主观视觉验收；未验证真实在线安装、更新或发布。

本轮新增的具体阻塞：

1. 完整演示角色的 Rule / Extractor 打包阻塞已由[文件化角色包计划](../../archive/plans/file-backed-card-bundle-plan.md)解除：Artifact v4 携带 Card 自有文本规则，ZIP v2 与 PNG 共用真实文件载荷，旧格式可读。完整官方演示角色本身仍需制作与验收，不以底层编解码通过代替样例交付。
2. ST 静态引用阻塞已修复：Server 的 PNG 与 Prompt Resource 导入调用当前 Kernel RPC 注册；转换结果经过 Artifact 校验再进入应用写入。Server package 和 tsconfig 已移除扩展依赖，扩展内负责格式识别与转换。官方身份不绕过启用与生命周期。
3. 尚无确认的远程发布主体、包地址和可信版本索引。远程 Source、安全 Archive 安装、版本替换/CAS 和发布流程仍未实施；不把本地包导出称为独立在线更新完成。

2026-09-12 生命周期补齐验证：ST 扩展与 Server 构建通过；定向导入集成测试覆盖真实 ST PNG/Lorebook/Preset、未启用/停用拒绝、重新启用、原生格式独立导入、临时安装转换器代码更新后 reload 使用新结果、非法返回拒绝及卸载后不可调用。未执行浏览器视觉验收、远程更新或进程安全隔离测试。

下一执行入口：制作并验收完整官方样例，复用已完成的文件化 Card Bundle；CLI / Dev Workspace 也消费同一文件编解码，不另造序列化。远程来源选择不再阻塞本地阶段；不重复路径迁移、ST 解耦或 Bundle 基础实现。
