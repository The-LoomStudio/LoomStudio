# Data 目录、内部数据与文件备份计划

> **Status**：In Progress / WP1 完成；WP2 核心目录闭环已实现，待用户交互验收；其他资源文件包待接续。完整开发模式与 CLI/MCP 已移出本计划
> **日期**：2026-09-12
> **授权**：用户确认目录保存、根目录 data，以及角色、Preset、Settings、Extension 的共通分发边界；后续已授权实施计划，并单独批准真实数据停服迁移。2026-09-12 最新决定将本计划限定为内部数据与文件备份层，不再包含开发模式或 CLI/MCP 的实施。

> **范围优先级**：以下现行目标、工作包与完成条件优先于末尾历史交付记录。历史中“在线开发”“WP5”及以 CLI 未完成为由不归档的说法已被本次拆分取代，不构成后续实施授权。

### 追加切片：通用图片查看器

- 用户批准先做图片查看器并接入卡面。复用 Dialog 的模态、Escape 与焦点恢复，新增 media 全屏布局；顶部透明底，不沿用普通弹窗的实色色条。
- 已实现：适配窗口、原始尺寸、缩放按钮/滚轮、拖动/双指缩放、图片复制（PNG）、保存和支持文件分享的平台分享。预先准备分享文件，避免异步下载消耗点击的用户激活窗口。失败明确反馈。
- 公共组件位于 `shared/ui/media-viewer/`；现有 `/dev/preview/card-resources` 卡面入口直接复用，不另造预览实现。文档继续使用 Markdown 阅读；视频与 HTML 渲染不在此图片切片中实现。
- 当前客户端没有原生文件夹打开桥接，未新增虚假的“打开目录”按钮；浏览器下载/分享不等于系统文件夹定位。原生宿主接入后再提供对应操作。
- 验证：图片适配、缩放锚点与拖动边界 3 个定向测试通过。Client 类型检查覆盖新组件与入口。真实设备双指手感、系统剪贴板/分享权限和主观视觉由用户验收，未声称已经跨平台实机通过。

## 目标

以 LS 管理的真实目录承载资源保存副本与文件备份，明确数据库、资源目录、媒体及运输包之间的身份映射和一致性。普通游玩保持 DB 编辑、显式保存；用户修改目录后，可显式校验并 Apply 回原资源。数据库继续提供运行读取与索引，Timeline 运行数据不反写作者初始化文件。PNG / ZIP 是运输格式，不再额外维护一份必须长期保存的压缩包备份。可编辑的文件与显式 Apply 是基础能力，不等于已经提供完整开发模式或 IDE。

## 已确认事实

- Card 文件投影、ZIP v2 和 PNG 内嵌 ZIP 已实现，见[文件化角色包架构](../../architecture/application/card-bundle-files.md)。不重新实现序列化；当前导入创建新 Card，不是对原 Card 的 Apply。
- `apps/studio-server/src/main.ts` 的 PNG / ZIP 导入先创建媒体 Asset，再导入解码 Artifact，并不统一保存整个原始 PNG / ZIP。
- `packages/application-runtime/src/cards/workspace.ts` 的 ImportBundle 在数据库保留来源 Artifact；`runtime/cards-runtime.ts` 仅在 `source.text` 输入时额外保存原始 JSON Source Artifact。不能把现状描述为已有完整原包备份回写机制。
- `packages/asset-store/src/store.ts` 当前 Media Asset 必须关联 Blob；HTTP 图片读取使用 immutable 缓存。随卡脚本也使用 Blob，不可把整个 Blob Store 简化为生成图片专用库。
- Preset / Settings 已有 Prompt Resource Artifact 导入导出，独立文件包未完成。入口为 `packages/application-runtime/src/runtime/prompt-runtime.ts`。
- 扩展目录安装、dev-link、嵌套 `dist/` 和包内文件服务已存在。安装器拒绝符号链接和越界路径；本地 ZIP 安装尚未补齐。
- 当前本机数据库位于 `.loomstudio-dev/data/studio.sqlite`；路径统一入口是 `apps/studio-server/src/platform/local-paths.ts`。不能按此单一样本假定所有用户路径。
- Playground 四方世界实验只覆盖导入基线的文件投影和当前封面，不是完整编辑态导出或正式同步实现。热缓存微基准未显示目录读图明显快于哈希文件；不能作为端到端性能承诺。

## 已确认决策

### 本次收尾执行边界

- 角色定制脚本保留在角色目录；完整可复用 Extension 独立安装，随卡携带配置和初始化数据。不建设随卡完整扩展的多版本加载器，也不把 Portable Payload 当程序包。
- 目录确认导入为新角色，不以包内来源 ID 覆盖已有 Card。采用本机目录绑定，原文件夹不重命名、不再复制一份；先预留新 Card ID 并写入导入日志，以 DB 是否存在该 ID 恢复登记。导入成功后的首次保存规范化 ID 映射，已有额外作者文件不删除。
- 导入正常 PNG/ZIP 后建立本机目录保存副本；保存失败与 DB 导入成功分别报告，不能提示用户盲目重新导入。此项复用目录保存服务，不新增包格式。
- 反向 Apply 首版保存本机不透明 snapshot（对象 ID/版本/映射）在 `.loom` 基线中。原子更新既有私有资源、子节点、作者 State、既有脚本与 payload；不变的共享资源保留，需要修改共享原件时拒绝。首版不自动 fork，也不依据文件顺序猜新主体身份；新增/删除顶层主体暂拒绝。
- Apply 提交后复用已有文件保存日志规范化目录，包括由 Card 内容派生的 Manifest 名称/描述；恢复比较可编辑内容，不把派生字段变化误判为提交失败。日志记录已提交 snapshot 后再完成文件收尾；规范化仍校验外部文件哈希，不覆盖提交后的 IDE 编辑。此行为不是自动同步，只有显式 Apply 或其未完成操作恢复时写文件。
- 文件 Apply 只改作者资源，不自动升级 Timeline 已冻结的配置、脚本挂载或运行 State。脚本内容变更不自动启用或扩大权限。目录直接运行与 Timeline 显式重载继续遵守授权/冻结合同，不能绕过已有 Blob 快照执行任意源码。
- 分工：主 Agent 负责目录日志/绑定/导入、服务接线、公共类型、UI与计划；Sol 仅负责新增 `runtime/card-directory-sync.ts` 及定向 Runtime 测试。主 Agent 不重复其实现调研，按明确的事务/共享/CAS验收证据集成。
- 验证预算：目录导入/恢复/重复导入、Apply基线及文件冲突的定向测试；Runtime私有原ID更新/共享拒绝/CAS/授权测试；相关Client/Server类型检查。只读读取原卡，涉及写入只在隔离fixture。WP3—WP4 与原生文件夹桥接不混入本次核心闭环；原 WP5 已转交独立计划。

### 存储与目录

目标默认布局：

```text
data/
  studio.sqlite
  characters/
  presets/
  settings/
  extensions/
  blobs/
  .loom/
```

- 根目录 `/data/` 必须在迁移前被 Git 忽略，覆盖 SQLite、WAL、SHM、私人资源和内部索引；检查已跟踪文件，ignore 不等于自动取消跟踪。
- `data/` 是持久数据，不叫 authoring 或 library，不限定用户身份。`official/` 保持官方发行源；`Playground/` 保持实验用途。
- 这是默认布局，不删除已有显式路径配置能力；发行环境的可写根目录需核对，不能强行写只读安装目录。
- 每种主体拥有自己的保存目录；内部格式保持各领域合同，不建立万能资源表或任意绑定图。
- 上述 `presets/`、`settings/` 是独立主体保存的预留位置，不是角色工程的共享文件依赖库，不为角色复用而创建。角色需要携带的内容完整保存在自己的目录，允许不同角色目录包含相同内容。
- 封面为剥离角色载荷的纯图片，真实正文、配置、源码、媒体分别保存；不在目录封面中再藏完整角色包。
- 目录可带 `src/`、`dist/` 和嵌套资源，Manifest 指向真实入口；不要求平铺。存在源码不自动执行构建或安装脚本。
- 角色目录的 `extensions/` 已有 Portable Payload 含义，源码工程与该合同的区分必须核查后明确，不能直接复用同名目录推断类型。

### 保存与显式应用

- 普通游玩中 DB 是当前应用数据，Studio 修改通过显式保存回写目录，不自动覆盖原卡。目录不是运行时直接扫描 MD / JSON 的替代数据库。
- 用户显式 Apply 时应用到原资源，不经重新导入创建重复角色。无效文件不进入数据库，冲突拒绝覆盖，文件与 DB 提交阶段分别记录和恢复，不宣称跨两者天然原子化。
- 本计划不切换编辑源、不接管 IDE 编辑过程、不自动提交正文或代码。开发模式的编辑权归属、模式切换、草稿与连续同步转入 [Workspace Dev Sync](./workspace-dev-sync-plan.md)，讨论完成前不实施。
- Timeline State 数值、会话等运行数据不回写作者模板或初始化文件。开发目录可变，不同时充当修改前的不可变检查点；现有来源与历史基线保留。
- 文件副本不传递对数据库共享原件的修改权限；文件读取禁止路径和链接越界。保存或 Apply 脚本不等于授权执行脚本、终端命令、构建或安装依赖。内部 Agent 文件权限另由开发模式与 Agent 能力计划讨论。
- CLI/MCP 由[现有适配器计划](./application-capability-cli-mcp-adapters-plan.md)承接，不属于本计划的工作包或验收条件。
- 使用稳定资源 ID、来源版本与同步基线。路径改名不改变资源身份；基线冲突不能静默覆盖，首版不做自动合并与双向 watcher。
- 缺失被索引文件、非法声明或解析失败必须拒绝同步，不能跳过后把远端条目删除。
- `.loom/` 保存机器管理的映射与同步信息，不放凭据，不把本机绝对路径写入可分发的领域资源。
- 开发与保存统一不等于取消历史基线；原作者版本与用户修改不能因一次回写而混成无法区分的一份内容。

### 文件完整性与数据库共享

- 用户决定取消文件层共享依赖设计：角色目录是完整、可编辑的内容副本，允许 Settings、脚本等文本与代码在不同角色目录重复保存。不为复用建立根目录共享库、跨工程链接或 pnpm 资源依赖管理。
- 示例：爱丽丝世界书、爱丽丝衣物世界书与随卡携带的女性衣物大全都保存在该角色目录内；女性衣物大全在数据库中仍可以被多个角色引用。文件重复不要求数据库重复，数据库共享也不要求文件共享。
- 复用、资源身份和关联关系由数据库负责；本机同步映射与版本基线由 `.loom/` 记录。用户补充确认目录仍区分自有内容和外部来源副本，但分类仅表示来源，不模拟数据库共享，也不改变授权。
- 文件使用安全包内路径，不通过符号链接或 `../../` 引用其他角色工程。角色开发不要求包管理器或构建工程，文件目录尽量复用已有完整分发投影。
- 文件副本不意味着数据库资源独占。反向 Apply 仍需核对共享对象与版本，不能仅凭同 ID 或文件位于角色目录就覆盖共享原件；修改共享原件还是为角色另存版本的具体操作仍需冻结，未确定前拒绝受影响的写入。
- 完整保存仅收集明确的角色内容与附件，不扫描或复制当前启用的全局扩展。扩展安装、启用、权限和已有依赖声明继续使用原合同；取消文件共享不等于删除这些运行约束，也不等于随卡源码自动执行。
- 不迁移或重写上一切片已保存的角色目录来实现共享布局。下一切片核对现有文件与 DB 对象的可靠映射，直接服务于原角色更新，不先建设共享文件解析器。

### 媒体与分发

- 目标是让角色自带媒体可直接由角色目录提供，不再无条件复制进 Blob。保留稳定 Asset 身份，存储位置不等于引用身份。
- Blob 保留生成、共享、不可变历史等实际用途；脚本、来源载荷和其他现有消费者逐项核对，不进行全局替换。
- 用户已确认：目录图片修改立即影响游玩，不等待资源同步。实现必须让后续图片请求读取新内容，并通知或刷新已显示图片；不能保留旧 immutable URL 缓存而宣称立即生效。具体更新检测与缓存策略在 WP0 冻结。
- 一份可变目录图片不提供旧画面的不可变历史；需要历史固定的其他载荷继续使用对应版本机制，不因此改变所有 Blob 消费者。
- Card 分发支持 PNG / ZIP；Preset / Settings 独立分发补 ZIP，并保留简单 JSON 入口。
- Extension 本地分发使用 ZIP，经安全解包进入已有目录安装流程；运行产物及依赖必须齐全，可附带源码。安装、启用、授权保持分离。
- 只携带明确附件；共享资源引用、随包资源与外部依赖分别表达，不扫描当前启用的全局扩展，不自动安装或授权依赖。

## 非目标

本计划不实施完整开发模式、Studio/Agent 工程文件编辑器、CLI/MCP 适配器、完整更新系统、三方自动合并、State 迁移、旧 Timeline 自动升级、远程发布、Marketplace、通用 CodeAct 沙箱、作者资源自动监听同步、完整 IDE（终端 / 调试器 / 语言服务器）或完整组件库拆分。媒体变更通知是已确认的例外，不解析、同步或执行脚本。目录化不意味着上述能力已经具备，也不以这些能力完成作为本计划归档前提。

## 工作包与文件边界

### 本轮执行合同：WP1

- 已核对：开发启动器显式设置 `LOOM_STUDIO_HOME=.loomstudio-dev`；无 override 的正式入口使用系统用户目录。现有扩展启用状态只按 Package / Module 身份保存，不依赖数据根绝对路径。
- 新增 `LOOM_STUDIO_DATA_ROOT` / resolver 的 `dataRoot` 参数，只覆盖持久数据根；日志与缓存仍由 HOME / 系统目录派生。开发默认指向仓库 data，显式 HOME 或 DATA_ROOT 继续优先；正式无配置启动仍使用系统用户目录。
- 启动器在旧默认 DB 存在而新目标尚未就绪时拒绝静默新建空库，提示执行离线迁移；真实用户库本轮不搬、不停止正在运行的服务。
- 提供默认只检查的迁移命令。显式执行时拒绝已有目标、重叠目录、链接和打开中的源文件；复制到目标旁的 staging，核对文件哈希与 SQLite 完整性后发布，保留原目录。工具只支持能够通过 lsof 核实关闭状态的环境，不支持时明确拒绝执行，不假装跨平台自动安全。
- 源文件检查只读；复制后仅对 staging SQLite 做完整性检查。失败清理仅限本次创建的 staging，不删除或覆盖用户已有目标。
- 写入范围：`.gitignore`、`package.json`、`scripts/dev-with-packages.mjs`、新增 `scripts/development-data-paths.mjs`、`scripts/migrate-data-directory.ts`、`scripts/lib/data-directory-migration.ts`、`platform/local-paths.ts`、定向路径 / 迁移测试、Getting Started 与本计划。
- 验证：路径优先级 / 启动冲突测试，临时 SQLite + Blob + 扩展状态的复制重开、已有目标拒绝、损坏源 / 链接拒绝、活动源拒绝；真实目录只执行检查。不声称完成角色目录或用户数据库迁移。

### 本轮执行合同：WP2 首个切片

- 首先交付当前 DB → 角色目录的显式保存、文件级差异与未完成保存恢复，不将首切片称为双向同步完成；反向 Apply 和目录媒体替换 Blob 在后续切片接续。
- 位置固定为 `data/characters/<cardId>/`，名称留在 card.json，不随显示名称改变路径；内部同步基线与事务暂存位于 `data/.loom/card-directories/<cardId>/`，不写入可分发资源。
- 抽取现有 ZIP 的文件集合编解码供目录和 ZIP 共用，不先压缩再解压；目录输出排除临时 `metadata.exportedAt`，其他声明与附件不丢失。
- `directories.previewCard` 返回目录、受管理文件差异、外部修改冲突和确认 token；`directories.saveCard` 必须使用该 token，拒绝过期 DB 输出、基线变化或外部文件变化。未受管理文件不删除或覆盖。
- 多文件保存使用预写 before/after 内容与持久日志，完成所有文件后才提交基线；`directories.recoverCard` 只在内容匹配旧/新已知版本时回退，发现外部修改则拒绝覆盖。无 fsync 保证时不宣称断电原子性；不配合锁的外部 IDE 仍存在最终校验与替换间的竞争。
- 接线在现有角色导出对话框增加“保存到资源目录”，复用样式和图标，不增加新工作台。目录差异 API 先于完整可视 Diff UI 交付。
- 写入范围：Server `codecs/card-bundle-zip.ts`、新增 `resource-directories/card-directory.ts`、`rpc/studio-rpc-router.ts`、`main.ts`；Shared 目录结果类型与导出；Client `shared/api/studio-api.ts`、`features/cards/model/use-cards.ts`、`widgets/character-panel/character-panel.tsx`、中英 i18n；相关目录/ZIP定向测试、本计划。
- 验证：包含正文、源码、附件和媒体的完整文件往返；重复保存无变化；少量修改只更新变化文件；过期 token、用户编辑、路径越界/链接拒绝；模拟中断后的恢复与恢复冲突。真实卡只在首次新增目录时验证，不改 DB 内容、原媒体或游玩数据。

本计划工作包限定为 WP0—WP4；原 WP5 已移出，不再作为后续执行步骤。主 Agent 负责冻结公共合同、迁移方案和验收边界。

### 本轮执行合同：资源来源目录

- 自有内容保持现有 `prompts/`、`scripts/`、`extensions/` 结构；显式标记的外部副本对应置于 `external/prompts/`、`external/scripts/`、`external/extensions/`。全部为包内真实文件，不依赖其他工程。
- Prompt 来源属于 Card 与资源的关系，Artifact 用根节点 ID 列表 `externalContextAssetIds`，Card 用实际 DB ID 列表 `externalPromptResourceIds`；导入重映射 ID、导出反向映射，不把来源写成共享资源自身的全局属性。
- Script 附件与 Portable Payload 使用可选 `resourceOrigin: 'card' | 'external'`。未声明的历史输入沿用原目录，不根据引用数量或 Package ID 推断。扩展 Payload 仍是数据，不是扩展程序包。
- 目录读取以 Manifest 引用为准，来源标记决定下一次输出目录；手动移动文件必须同步修改引用及来源声明。沿用 ZIP v2 的可选字段扩展，旧包可读，不迁移真实用户目录。
- 范围：Runtime Artifact / Card / 附件类型及校验、导入导出和资源关联更新；Server codec 与关联 RPC；定向文件往返及 Runtime 导入导出验证。此切片不实现反向 Apply、开发模式 UI 或新的扩展程序打包器。
- 验收：外部副本在目录中可见；内容、顺序、来源在导入导出及 ID 冲突重映射后保留；非法来源和悬空来源 ID 拒绝；旧文件布局不变；共享授权不因来源标记变化。

### 本轮执行合同：目录发现与只读打开（旧独立浏览器 UI 已被下述决定替代）

- 启动扫描及手动刷新 `data/characters/` 一级工程目录，读取 Manifest 与角色头信息；不修改 DB、不导入、不执行脚本。列表返回单目录错误，损坏工程不阻止其他工程被发现。
- `directories.list` 读取当前扫描结果，`directories.scan` 手动刷新，`directories.open` 接收用户明确指定的绝对目录路径，校验 Manifest 引用的完整文件后返回名称、资源摘要和文件清单。打开不等于导入或同步，本切片不提供编辑和 Apply。
- 已登记关联须同时核对 DB Card、当前 canonical 目录的保存基线与导出来源；包内 Card ID 单独只作来源提示，不能作为覆盖授权。同来源目录显示提示，不自动合并或重绑。
- 打开范围限于用户选定工程，包内路径拒绝越界与链接；仅加载 Manifest 引用内容，不递归扫描 `node_modules` 或读取任意未声明源码。复用文件 decoder 和现有 4096 文件 / 单文件 64 MiB / 总量 128 MiB 限额，扫描头信息另限 4 MiB、扫描目录数量限 4096。
- UI 在角色面板增加目录入口，复用 Dialog 和 MasterDetailWorkbench；列表、刷新、路径打开与只读摘要，不把发现目录混成可直接游玩的 DB 角色。窄屏使用现有下钻返回，主观验收由用户负责。
- 写入范围：Server 文件引用加载、目录 catalog、新启动接线与既有目录 RPC；Shared 类型；Client API、角色入口及独立目录浏览组件、中英 i18n；定向 catalog 测试与本计划。
- 主要验证：复制工程刷新可见但 DB 列表不变；只读打开、重复来源提示、无效索引 / 缺失文件 / 越界 / 链接拒绝，未索引文件不读取。公共接口变化补 Server build 与 Client 类型检查，真实后台只用隔离目录验证。

### 本轮执行合同：角色删除与资源概览

- 删除 Card 统一经过 Runtime 的平台删除协作入口，内部工具与 RPC 使用相同语义。先将受管理的角色目录 rename 暂存，DB 删除提交失败则还原；以 DB tombstone 为提交事实，启动恢复未完成的删除。保存与删除共用单卡锁，不声称防断电或防任意外部 IDE 并发。
- 删除不提供第二个真实文件复选框；用户原有游玩数据与关联资源选项不变。其他 Card、保留 Timeline、全局/预设挂载仍引用的 Prompt Resource 不级联删除。
- 撤销独立目录管理器、路径输入和文件树。角色详情“资源与附件”展示保存目录统计，避免重复 DB 专业面板的 Settings、State 与脚本编辑。路径复制为次级操作。
- 列表刷新负责刷新角色及扫描，未登记工程需确认后导入，不能仅凭包内 source ID 自动覆盖或关联。确认导入与原目录登记/迁移必须一起完成，不能重复导入或悄悄删除原目录。
- 附件预览仅对明确支持的文件声明开放；未声明 HTML 不自动运行，不新增任意主机文件服务。README/HTML 声明、目录媒体读取若未落地，必须记录缺口而不是做假入口。
- 验证预算：目录删除成功、DB 失败还原、重启恢复、共享资源保留的定向验证；跨层接口改动补 Client/Server 类型检查。用户原卡不参与删除测试。

### WP0：核查并冻结最小合同

- 入口：`platform/local-paths.ts`、`main.ts`、`cards/workspace.ts`、`runtime/cards-runtime.ts`、Asset / Blob Store、现有文件 codec。
- 明确目录身份映射、保存基线、附件归属、资源删除、图片缓存和临时文件处理。
- 核对旧路径配置、实际数据库、WAL 和 Blob 引用，提出停服迁移与恢复步骤。不得边运行边搬 SQLite。
- 核对来源 Artifact 与当前 DB 导出差异，明确“保存当前版本”与“恢复保存副本”操作，不用导入基线冒充当前内容。
- 在本计划追加确切写入清单、接口及最小验证后再授权代码；涉及不可逆操作或未决产品行为须由用户确认。

### WP1：Data 根目录与迁移

- 主要范围：`.gitignore`、`apps/studio-server/src/platform/local-paths.ts`、必要的启动配置和路径测试；迁移工具位置由 WP0 冻结。
- 保留显式配置，默认持久数据转入根目录 data。旧新目录同时有数据时明确拒绝猜测。
- 迁移前确认停服、备份及磁盘目标；保留原数据直至验证完成，不自动清理。
- 验收：重启能找到同一资源、媒体与扩展状态；Git 不跟踪 data；迁移失败有明确恢复路径。

### WP2：角色目录保存与媒体读取

- 主要范围：`apps/studio-server/src/codecs/card-bundle-files.ts`、`main.ts`、`http/http-server.ts`、`packages/asset-store/src/`、`packages/application-runtime/src/cards/` 与 `runtime/cards-runtime.ts`。
- 复用文件投影创建完整保存副本，覆盖当前声明、脚本、明确附件和媒体；PNG 封面清洗。
- 建立目录资源映射、显式保存及应用到原 Card 的路径；保存和同步冲突可解释，不误删共享数据。
- 反向 Apply 前先补齐文件副本与 DB 对象的同步映射及共享写入边界；优先核查 Card、Prompt Resource、Script owner / mount、Extension Package / Portable Payload，不把载荷文件误当扩展包。不引入文件层共享依赖声明，不能用重新导入替代原对象更新。
- 只提供显式文件校验与原资源 Apply，不包含开发模式入口、Agent 文件编辑或连续双向同步。
- 媒体目录来源与 Blob 来源在明确接口内解析，前端不获得任意文件读取权限。
- 验收：修改正文、宏、State 作者声明及图片后可完成目录往返，主体身份不变；原 Timeline 不被偷偷重建或升级。

### WP3：Preset / Settings 文件目录与 ZIP

- 主要范围：`runtime/prompt-runtime.ts`、Server 对应 codec / RPC 与资源导入导出入口；确切附件公共类型在 WP0 冻结。
- 复用已有 Prompt 树合同，支持各自主体目录、完整附件收集、独立 ZIP 往返及显式保存/应用；不接入完整开发模式。
- 验收：共享资源不因保存角色而重复创建；独立资源往返保留身份映射、节点顺序、配置及合法附件；导入不自动改变全局挂载。

### WP4：Extension 本地 ZIP 安装

- 主要范围：`apps/studio-server/src/extensions/extension-package-installer.ts`、`extension-manager.ts`、相邻上传接口及现有扩展安装 UI。
- 安全解包到 staging，复用目录校验与安装，保留嵌套结构。校验路径、链接、数量、大小及失败清理，不执行包脚本。
- 验收：含 src / dist / assets 的真实包可安装，入口和相对资源可读取；畸形包不激活半成品，新增权限不自动生效。

### 已移出：开发模式与 CLI/MCP

- 完整开发模式及工程工作流：[Workspace Dev Sync](./workspace-dev-sync-plan.md)，待讨论，未授权实施。
- CLI/MCP 的协议、连接、授权和首批命令：[Application Capability、CLI 与 MCP 适配器计划](./application-capability-cli-mcp-adapters-plan.md)，待讨论，未授权实施。
- 两份计划消费本计划的文件格式、映射和显式保存/Apply 能力，不反过来阻塞数据与备份层验收。

## 完成条件

- 数据根与迁移、角色文件保存/导入/Apply/删除、媒体读取及失败恢复完成相应验收；现有限制和用户交互验收结果明确记录。
- WP3、WP4 的其他资源文件包完成，或经用户明确决定转交对应领域计划；不能因移除 CLI 就把这些尚未完成的文件层工作标成完成。
- 归档只核对以上数据与文件层范围，不等待完整开发模式、内部 Agent 编辑或 CLI/MCP。

## 验证预算

- 迁移：临时数据目录的停服迁移 / 重启读取 / 冲突拒绝测试；真实用户数据只在另行确认的执行窗口迁移。
- 保存与同步：一张真实卡的隔离副本，验证文件往返、稳定身份、双边修改冲突、非法文件拒绝、附件完整性和失败恢复。
- 媒体：验证替换后的读取与缓存版本、路径越界拒绝、目录丢失错误、已有 Blob 资源仍可读；不以 Playground 文件微基准代替服务验证。
- 扩展：一个嵌套产物 ZIP 的安装测试及路径穿越 / 超限失败测试。
- 跨包合同或构建入口改变才增加相关类型检查 / build，不默认全仓检查。主观 UI 由用户验收。

## 停止条件与开放问题

1. **目录图片更新实现**：立即影响游玩已确认；WP0 核查更新检测、已挂载图片刷新与缓存失效方式。图片刷新不等于自动同步整个作者目录的正文、配置或代码。
2. **保存失败一致性**：DB 与文件系统不是天然单事务；必须确定 staging、提交标记与恢复语义，不宣称一次跨资源 Apply 天然原子化。
3. **运行依赖**：当前 Timeline 未冻结 Prompt Resource 正文，目录化不修复这一点；不得把“保存目录”宣传为完整游玩隔离。
4. **程序包完整性**：携带 src 不保证 dist 自包含；本计划仅检查分发入口及附件完整性，不建设公共 UI SDK、构建工具链或源码复用样板。
5. 需要删除原数据、改变历史引用、自动迁移 State、新依赖或扩大主机文件权限时，停止并回报。
6. **Git 演进**：用户提出未来角色工程可能自带 Git 与远程来源，作为后续方向保留；本阶段不自动初始化仓库、提交或推送，不把 Git 当作文件与 SQLite 的跨系统事务机制。
7. **共享写入**：文件层不建立共享依赖库。当前 Apply 保留不变的共享资源，拒绝修改共享原件；新增 fork/合并行为须另行确认。进入开发模式时的未保存修改、草稿恢复和自动同步问题已移出本计划。

## 关联与取代范围

- [Workspace Dev Sync](./workspace-dev-sync-plan.md)：本计划拥有文件存储、身份映射和显式保存 / Apply；该计划独立讨论完整开发模式，不再将其实施转交本计划。
- [CLI/MCP 适配器](./application-capability-cli-mcp-adapters-plan.md)：承接原 WP5 的在线工具入口；首批范围和实施难点待讨论，不新建重复 CLI 计划。
- [Typed Primary Resource Bundle](./typed-primary-resource-bundle-plan.md)：本计划承接 Preset / Settings 的实际附件分发，不引入通用 Package 实体。
- [官方内容计划](./official-content-installation-and-release-plan.md)：提供真实样例及后续发行消费者；远程发布继续延期。
- [Agent Context 计划](./agent-session-context-and-workspace-capability-plan.md)：提供内置 Agent 的 Context / Target 边界；不把整个 Agent 改造作为离线文件格式的前置条件。
- [State 后续](../issues/state-resource-and-reference-follow-ups.md)：独立 State Artifact 资源池仍按该 issue 核对，不能因已拆成文件就标记 CRUD / 冻结链完成。

## 最终结果

当前汇总：WP1 完成，WP2 核心目录闭环已实现并通过自动化验证，待用户交互验收；WP3、WP4 仍是本计划内待接续的文件层工作。完整开发模式与 CLI/MCP 已拆出，不计入本计划未完成项。以下按时间保留历史结果，不以历史阶段描述覆盖当前范围。

- 新增持久数据根 override，开发启动默认使用仓库 data；系统用户目录与显式 HOME 保持兼容，日志 / 缓存不随数据迁移。
- `pnpm data:migrate` 默认只检查；`--apply` 拒绝活动源、已有目标、链接和重叠目录，复制后比对全部文件内容并检查 SQLite 完整性，源目录不删除。
- 开发启动识别旧库并提示迁移，迁移完成凭据允许使用新库；不静默创建第二个空库。源目录保留仅用于回退，不是双写同步副本。
- 已运行路径与迁移定向测试 11/11；随后新增并单独运行 WAL 中断恢复用例 1/1。临时数据验证同一资源身份、媒体和扩展状态复制重开、损坏数据库拒绝、打开中的文件拒绝及 staging 清理；子进程 SIGKILL 留下的已提交 WAL 数据迁移后仍可读，源 WAL 字节未改变。
- Studio Server build、文档链接检查 287 文件、diff 空白检查通过。`git check-ignore` 确认 data 中 DB / WAL / SHM / 角色文件及默认迁移 staging 都被忽略。
- 迁移前执行 `pnpm data:migrate` 检查：旧 DB 115,683,328 字节，根 data 尚不存在。`git ls-files data` 无结果。
- 工具要求支持 lsof 的离线环境；不提供不停服迁移，不声称断电后 staging 可自动恢复或系统文件锁能阻止其他程序重新打开源目录。中途失败保留源，未发布的 staging 不作为有效目标。
- 脚本迁移不修正用户扩展或其他任意内容里自行硬编码的绝对路径；dev-link 等显式外部路径保持原样。后续必须用实际工作区验收，不以临时数据通过代替完整真实应用验收。

### 2026-09-12 真实数据迁移

- 用户明确批准暂时停服。停止当前后台及另一套遗留后台 watcher，前端保持运行；lsof 确认源数据无占用、4173 端口释放后执行 `pnpm data:migrate --apply`。
- 从 `.loomstudio-dev/data` 复制至根 `data`，19 个文件、155,495,257 字节，逐文件哈希与 SQLite 完整性检查通过。收据位于 `data/.loom/data-migration.json`；源目录未删除，不作为双写副本。
- 通过标准 `pnpm dev:server` 重启；启动日志位于 `.loomstudio-dev/migration-server-start.log`。lsof 确认后台打开新库，未打开旧库。
- 全部 23 张业务表行数一致；72 条 Document、12 个 Media Asset、13 个 Blob；四方世界和 EC 示例卡 ID / version 均一致。扩展启用状态文件字节一致。
- 正式 HTTP `/health` 返回 200；鉴权 RPC `application.listCards` 返回原两张卡；`extensions.listPackages` 显示 ST 导入器 active、原背景扩展仍 available 且 desired enabled。
- 四方世界封面通过正式鉴权 `/assets/{id}` 读取 873,826 字节，SHA-256 与数据库登记值一致。未重新导入卡、未调用模型、未执行浏览器主观视觉验收。
- Git ignore 核对覆盖新库、WAL、SHM 与迁移收据。根 data 当前仍主要是原持久数据；角色可编辑目录尚未物化，不把路径迁移称为完整目录化交付。

### 2026-09-12 保存中断与 Diff 实验

- 实验脚本：`Playground/diff-recovery.mjs`；结果：`Playground/diff-recovery-1789189316020/results.json`。这些私人实验文件被 Git 忽略，不是可分发测试 fixture。
- 四方世界导入基线副本共 547 文件，其中 542 个 Markdown，包含开场白，不等于 542 个世界书条目；非当前编辑态完整导出。
- 热缓存全量读文件、SHA-256 与文件差异比较 30 次，中位 31.841 ms，P95 42.695 ms；已知三个变化路径时 100 次，中位 0.124 ms。后者不承担发现其他文件变化的责任。未测试逐行差异、领域解析或端到端同步。
- 成功保存仅改动三个文件。独立子进程替换两个文件后 SIGKILL，新的进程从预写旧/新内容日志恢复，完整文件哈希与基线相同。
- 保存前已有 IDE 修改时拒绝写入；中断后用户再编辑已替换文件时，恢复拒绝并保留全部现场，不宣称自动恢复总能成功。
- 嵌套文件移动被识别为删除与新增；未自动修复索引，不能视为领域重命名已实现。
- 限制：无 fsync / 断电验证，无 SQLite 联合提交；最后校验到 rename 之间仍存在不配合锁的外部 IDE 写入竞争窗口，正式实现不得宣称绝不丢外部编辑。
- 实验未读取或写入原数据库，未修改原媒体及先前实验的源目录。上述结果不改变 WP0 未决合同，也不构成生产实现完成。

### 2026-09-12 WP2 首切片交付

- 复用 `card-bundle-zip.ts` 的文件集合编解码；ZIP 和目录使用同一文件格式，没有增加另一套序列化。保存时忽略瞬时导出时间，保留正文、配置、脚本附件和媒体。
- 新增 `directories.previewCard / saveCard / recoverCard`；预览 token 校验当前导出、目录与基线，外部修改拒绝覆盖，未管理文件保留。逐文件写入与恢复日志支持可识别的保存中断恢复，不承诺断电原子性或阻止 IDE 竞争写入。
- 角色导出对话框新增“保存到资源目录”，成功通知显示绝对目录及变化文件数。恢复目前仅有 RPC / Client API，无 UI 操作入口；完整 Diff 展示也未实施。
- 目录定向测试最终 8/8 通过，覆盖完整文件往返（含 CRLF 脚本源码与扩展载荷）、零改动重复保存、增量写入、外部冲突、过期预览、恢复及恢复冲突、路径和链接拒绝。此前目录与 ZIP 联合测试 17/17 通过；最终修改后重跑目录测试。Studio Server build 与 Client 定向类型检查通过。
- 通过运行中后台的正式鉴权 RPC，对四方世界与 EC 示例卡首次保存；预览均为纯新增且无冲突，没有修改数据库、原媒体或 Timeline。
- 四方世界：`data/characters/card-f0deda5b-b22d-4637-8729-5f864070a1ff/`，547 文件、3,423,256 字节，首次保存请求约 913 ms。EC 示例：`data/characters/card-fb73de06-fd0f-40ff-914a-dfa0001e2c75/`，11 文件、1,065,931 字节，约 80 ms。这是本机单次正式请求结果，不是稳定性能承诺。
- 两个落地目录均使用共享文件 decoder 成功解码，保存后预览零差异、重复保存 `changedFiles=0`。四方封面 873,826 字节，EC 封面 1,062,619 字节。
- 尚未实施：目录反向 Apply、目录媒体来源与图片刷新、其他资源类型目录 / ZIP、CLI / MCP。当前游玩图片仍从 Blob 读取，目录图片修改不会立即影响游玩。
- 未执行浏览器检查，新增导出选项的主观 UI 与实际点击验收由用户完成。

### 2026-09-12 后续合同调整

- 文件优先开发模式保留，普通游玩仍保持显式保存，替代此前所有场景一律 DB 编辑后手动回写的目标描述。
- 用户后续明确撤回文件层共享与内部 / 外部依赖工程化方案：角色目录完整保存，允许副本；共享复用留在数据库，不引入根共享库或 pnpm 资源管理。独立 Settings / Preset 保存能力不是角色共享文件机制。
- 本次仅更新计划，尚未实现开发模式或反向 Apply，也未迁移已保存目录。后续核对 DB 映射与共享写入语义，再接开发同步；不把现有单向保存能力当作开发工作区完成。

### 2026-09-12 资源来源目录交付

- 已实现本轮来源目录合同：显式外部 Prompt、Loom Script 附件、Portable Payload 保存至 `external/` 下对应分类，其余保持现有包内目录；全部为本地内容副本。
- Prompt 分类保存在 Card 关联中，`application.updateCardPromptResources` 可提交 `externalPromptResourceIds`；不改变 Prompt Resource 的共享属性。导入按原根节点到新 DB ID 映射，导出使用当前关联，不复用过时导入快照。关联解除时移除对应来源标记。
- Script 来源随 Mount 的 origin 保存，Payload 来源随原数据文档保存；导入脚本仍 disabled、空授权，不因来源标记自动执行。
- 文件和 Runtime 定向验证 31/31 通过（`card-bundle-zip.test.ts`、`card-directory.test.ts`、`workspace-artifact-boundary.test.ts`），覆盖旧布局、外部完整副本、源码 / 内容 / 顺序保留、ID 冲突重映射、悬空 / 重复来源拒绝及当前关联修改。Studio Server build 通过。
- 可见隔离样例：`Playground/resource-origin-example/`，12 文件，由正式文件 encoder 生成并由 decoder 校验；包含两份自有世界书、一份外部服饰资料、外部脚本和扩展数据。该目录被 Git 忽略，未导入 DB，未改两张真实角色卡。
- 未实现来源切换 UI；目前通过 Artifact 声明与上述关联 API 配置。State 拆分来源、实际 Extension 程序包携带不属于本轮新增能力，不能把 Portable Payload 称为完整扩展包。
- 未执行浏览器验收。本轮未实现反向 Apply、开发模式或目录媒体运行读取，整个计划继续 In Progress。

### 2026-09-12 运行中后台来源目录验收

- 用户授权使用独立测试卡验证。通过当前后台正式鉴权 HTTP / RPC 导入样例，创建 `[验收] 资源来源目录` 与 `[验收] 资源来源目录 · 重导入`，保留供用户查看；没有在原卡上进行测试。
- 第一张卡通过 `application.updateCardPromptResources` 清除并恢复外部标记，分别保存目录，确认 Prompt 文件从自有路径移至 `external/prompts/`，原受管理路径被移除；外部 Script 与 Payload 副本保留。
- 从正式 HTTP 导出 ZIP，将所得字节原样重新导入。新 Card / Prompt ID 不同，外部根节点标记正确重映射，世界书正文、脚本源码、附件内容与顺序不丢失。两张卡均保存 13 文件，保存后预览无差异，重复保存零改动。
- 原有两张卡在测试前后的 ID、名称与版本保持一致；最终仅多出两张验收卡。未创建 Timeline、未调用模型、未启用样例脚本；未进行前端点击或视觉验收。
- 实际将第一张卡的目录复制到 `data/characters/directory-copy-check-<timestamp>/`，一秒观察窗口内列表未新增角色；随后只删除本次创建的临时复制目录。结合入口核对，当前无启动 / 运行期角色目录扫描注册，不能仅凭观察窗口声称覆盖任意延迟行为。
- 当前 `directories.*` 仅有预览、保存和恢复；导入入口仍是 Artifact / PNG / ZIP。直接放入目录不会登记到 DB，“打开目录并校验导入”尚未实现，复制目录也不能替代已有角色的反向 Apply。
- 私人验证脚本：`Playground/resource-origin-live-check.mjs`；结果与真实 HTTP 导出包：`Playground/resource-origin-live-1789197119496/`。这些文件不提交，不把测试数据加入默认资源。

### 2026-09-12 目录发现与只读打开交付

- 新增目录 Catalog，后台创建时启动扫描，`directories.list` 等待首次结果；`directories.scan` 手动刷新，`directories.open` 校验用户指定工程。目录发现仅有内存列表，不写入角色 DB；扫描根不存在时返回空列表，不创建空工程。
- Manifest / Card 头部轻量发现与完整引用文件校验分离。打开复用正式 decoder，按索引加载正文、State、源码、附件和媒体，不递归读取未声明的构建产物；已知 pending 保存拒绝打开。只读校验不保证任意 IDE 并发写入期间的原子文件快照。
- 目录登记核对实际 DB Card、canonical 保存基线和来源 ID；复制目录仅显示同来源提示，不因携带原 ID 自动绑定。损坏头信息、链接与超限单独报告，不吞掉其他可识别工程。
- 角色列表工具栏新增文件夹入口，复用 Dialog + MasterDetailWorkbench，提供目录搜索、刷新、绝对路径打开、校验摘要和引用文件清单；窄屏沿用下钻返回。未新增导入、同步、文件编辑或执行动作。
- 定向测试最终 16/16 通过：`card-directory-catalog.test.ts` 与 `card-bundle-zip.test.ts`。覆盖复制身份、缓存 / 刷新、外部工程打开、未索引大文件与链接忽略、缺失引用 / 越界 / 索引链接拒绝、坏头信息隔离、pending 保存拒绝，以及含 60 实体的文件加载往返。Server build 与 Client 类型检查通过。
- 正式后台验收：启动 Catalog 发现原 4 个保存目录；复制四方世界到 `data/characters/discovery-check-1789198371552/` 后，刷新发现 `[发现验收] 四方世界目录副本`，未登记、同来源数量 1，打开 547 文件。单次扫描请求约 39 ms，单次打开约 102 ms，仅为本机样本，不作性能承诺。
- `Playground/resource-origin-example/` 可通过绝对路径打开，校验 12 文件，不自动加入扫描列表。临时损坏目录可见错误且不影响四方副本；验证后仅清理本次损坏目录，并刷新缓存。
- 4 张已有 DB 卡的 ID、名称、版本完全不变；未创建 Card、Timeline 或启用脚本。保留未登记的四方目录副本供用户验收。脚本与结果位于 `Playground/directory-discovery-live-check.mjs` 和 `Playground/directory-discovery-live-1789198371552/`，均被 Git 忽略。
- 未执行前端点击与主观视觉验收；尚未实现目录导入登记、反向 Apply、完整开发编辑及目录媒体即时生效。实际引用文件打开与 DB 登记仍是两个不同操作，整个计划不归档。

### 2026-09-12 删除联动与资源概览切片

- 删除经 `ApplicationRuntimeOptions.withCardDeletion` 统一协调真实目录；目录暂存与 DB 提交分开，DB 失败还原，提交后清理失败记录错误并由启动恢复继续清理。还原遇到外部新目录拒绝覆盖，保留恢复资料。保存和删除共享单卡锁。保留其他角色、未删除 Timeline 和全局/预设挂载仍引用的 Prompt Resource。
- 删除快照期间若发生并发 DB 提交，拒绝本次删除并提示重试；这是保守的全库提交检查，不是精细的资源版本锁。当前保证可恢复的进程中断，不保证断电原子性或任意 IDE 写入互斥。
- 删除旧目录浏览器和文件树。角色详情新增纯文字“资源与附件”页；统计已索引资源体积、媒体数量/容量、说明文档数。不重复显示 Prompt/State/脚本配置；路径收敛为“本机工程”提示和复制图标。
- `directories.attachment` 仅允许 Manifest 已声明的受支持栅格卡面/背景，以及约定的根目录 `README.md`。README 限 512 KiB，以 Markdown 阅读，禁用 HTML、远程图片自动加载。未实现通用 HTML/音视频附件声明和执行，也不将构建产物计入已索引统计。
- 列表入口改为刷新，刷新 DB 列表并扫描；只有未登记目录出现发现提示。**确认导入仍未实现**：需要把新 Card 与原目录登记一起完成，避免复制目录重复导入、同源误绑定或导入失败后的半登记。当前提示只有发现结果，不做假的导入动作。
- 复用展示组件的隔离预览：`/dev/preview/card-resources`。不连接业务 RPC，不写数据库，可看空附件、卡面和 README。
- 定向验证：目录服务、Catalog、Runtime Artifact 三个测试文件 35/35 PASS；Server/Client TypeScript build PASS。四方世界真实保存目录只读验证：547 个引用文件、3,423,256 字节、1 个媒体、0 个 README，概览与媒体预览合计约 217 ms（单样本）；Manifest 哈希不变，没有修改真实卡或删除用户数据。
- 未做主观浏览器验收；目录确认导入、打开系统文件夹、任意附件 HTML/音视频预览、反向 Apply 与目录媒体即时游玩读取未实现。本切片不代表 WP2 或整个计划完成，不归档。

### 2026-09-12 目录闭环收尾

- `directories.open` 提供文件校验 token；`directories.import` 经再次校验将未登记目录导入为新 Card，绑定原目录，不重命名或复制。首次规范化保留未索引的 README 等作者文件；已有登记、损坏登记、过期 token 和重复提交拒绝。普通 HTTP PNG/ZIP 导入成功后自动建立目录；Artifact RPC 导入仍需显式保存，未宣称所有 Runtime 创建入口都自动物化。
- `captureCardDirectoryState / applyCardDirectoryState` 保存原对象身份和版本，SQLite 单事务更新既有私有 Card、Prompt 树、作者 State、Script 和 Portable Payload。共享内容修改、身份变更、顶层新增/删除、pinned Script 修改以及规则/提取器/包元数据修改首版拒绝。没有自动 fork、授权、启用或 Timeline 升级。
- `directories.previewApply / apply` 接入角色“资源与附件”页；确认前显示文件变化数量与冲突。导入发现行有实际确认按钮。失败也刷新列表，反映可能已提交的 Card；保留原错误与刷新失败。目录未完成操作在概览中可见，不伪装成尚未保存。
- 导入与 Apply 使用持久日志。DB 未提交可清除未完成登记；DB 已提交则继续目录收尾，不再次创建角色。Apply 的已提交 snapshot 与文件保存日志共同覆盖规范化中断；无法恢复时保留现场，启动记录单卡错误而不阻塞其他卡。扫描仍只读，不借刷新自动 Apply。显式 `directories.recoverCard` 仍可恢复 Apply/保存；未增加完整冲突解决 UI。
- 新 `/cards/<cardId>/media/avatar|background` 使用当前 Card 媒体引用：与保存基线匹配时读取目录，否则读取既有 Blob。保留原 Blob/Asset 以支持既有消费者和不可变引用，没有做删除 Blob 或全面取消双份媒体存储的迁移。新请求支持鉴权、ETag、no-cache、nosniff；目录 PNG 返回前清除文本卡载荷。
- Node 原生媒体监听合并短窗口事件，经现有 SSE 发出 `directories.media.changed`；角色、会话和叙事头像/背景换 URL，断线重连也刷新。监听释放时清理 timer，无每图片连接或轮询。这里只读图片，不把作者源码改动自动执行。卡面/背景路径变更和目录 rename 也会通知。
- 旧目录需先进行一次“保存到资源目录”以建立 snapshot/mediaRefs。没有新基线时，Apply 明确提示先保存，媒体沿用原 Blob，不猜测旧目录映射。已存在的原卡目录本轮未迁移或改写。
- 自动化证据：目录服务/目录导入/Catalog/真实 Runtime Apply 四个定向文件 31/31 PASS；媒体 reader、HTTP 与 watcher 文件由 Worker 验证 8/8 PASS；完整 Server HTTP 集成 1/1 PASS，覆盖 ZIP 自动建目录、实际文件改图、SSE 通知、PNG 载荷清洗、Blob 不变、原 ID Apply、复制目录确认导入及重复拒绝。Runtime 独立的事务/共享/授权 5 项此前由 Worker 验证；本轮集成发现并修复空来源列表与派生描述导致的恢复误判，不把最初失败记录成通过。
- Server TypeScript build、Client TypeScript 检查及 diff-check 通过。测试使用隔离临时目录与 SQLite，不改用户原卡、Timeline，不启动浏览器或调用模型。桌面/移动端交互、系统剪贴板/分享与主观视觉仍由用户验收。
- 剩余边界：原生文件夹打开桥接、完整文件优先开发模式、受限 Agent 文件操作、其他资源独立 ZIP、CLI/MCP；完整 Extension 继续独立安装，随卡脚本仍经现有 Blob 快照与授权执行，未实现从任意目录源码直接热执行。保持无 fsync/断电原子性、最终校验到替换间 IDE 竞争窗口等已知限制。整个计划不归档。
