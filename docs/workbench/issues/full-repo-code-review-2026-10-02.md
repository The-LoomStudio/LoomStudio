# LoomStudio 全仓代码审查（2026-10-02）

> **状态**：审查完成 / 发现待处理；本轮未实施修复
> **审查基线**：`efc45a4fe140686459e46f48da3de7c32672c5b0` + 本轮当前未提交工作树，包含未跟踪源码
> **方式**：主 Agent 审查 Server/Transport/文件往返与工程门禁；三个子 Agent 分别审查 Client、Runtime/Agent/Prompt、数据/Kernel/Extension。主 Agent 对报告候选核对当前关键源码、相邻合同与历史去重记录
> **写入边界**：仅本报告和 Issues 索引；未修改源码、测试、配置、依赖或既有工作区改动；未提交、推送、部署

## 结论

本轮确认 **1 个 P1、9 个 P2**；另有 **2 个待验证候选**，不计入确认问题。未形成有证据支持的 P0/P3 或独立优化建议。

“确认”表示当前源码及受控可执行反例支持结论，不表示所有问题都已在真实浏览器、HTTP 或真实 Provider 中复现。范围为全仓分域审查，不是全部文件和行为组合的穷尽证明。

| 编号 | 级别 | 确认问题 |
| --- | --- | --- |
| OCT-001 | P1 | 脚本读取乱序使 A 的源码与 B 的保存身份错绑 |
| OCT-002 | P2 | 宏源版本更新静默覆盖未保存草稿 |
| OCT-003 | P2 | Narrative 最新页刷新重置旧页游标，重复加载历史节点 |
| OCT-004 | P2 | 创建主对话的晚响应污染后来选择的 Timeline |
| OCT-005 | P2 | 多工具步骤取消后留下无结果 Invocation，阻断工作交接 |
| OCT-006 | P2 | 同 Session 重叠 Run 的 CAS 冲突使失败 Run 无法落库终态 |
| OCT-007 | P2 | 主动 Narrative Reader 未传 Card 归属，漏选私有上下文来源 |
| OCT-008 | P2 | Card 删除游玩数据漏清 Timeline 绑定 Session 及其扩展存储 |
| OCT-009 | P2 | 扩展 Scope 存活校验与写入不原子，删除后仍可提交 Config |
| OCT-010 | P2 | Card 文件往返丢失 Preset 宏候选配置 |

优先处理 OCT-001 的错绑写入，再处理删除/写入边界和 Agent 终态一致性。修复方向属于建议，不构成已批准的并发策略、权限或持久化合同变更。

## 确认发现

### OCT-001 · P1 · 脚本读取乱序使保存身份与正文错绑

- **证据**：[text-transform-panel.tsx](../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.tsx) 的 `selectScript`（253 行）与 `saveScript`（291 行）。选择先更新 `selectedTarget`，异步 `export` 返回后无当前性检查地替换源码和文件名；保存从当前选择读取 ID/version，却使用独立的源码状态。
- **生产链与反例**：authoring 模式读取 scripts/mounts，但不读取 resolvedMounts（同文件 197 行）；已挂载脚本进入树，698 行选择回调调用 `selectScript`，因此可达 export 分支。选择 A，再选择 B；B 导出先返回，A 后返回。随后保存携带 B 的 ID/version、A 的 source/fileName。受控 controller 探针验证实际 update 参数的这一组合；其 mounts 夹具为空，直接调用 controller，树入口可达性由生产源码另行证明，不是探针点击结果。runtime resolvedMounts 命中时直接取内存源码，不在本项乱序 export 条件内。
- **影响与反证**：可能覆盖另一个脚本的作者代码。选择入口没有被 busy 锁住；CAS 校验 B 的版本，无法发现正文来自 A。历史 FR-014 的 inspection 守卫不是脚本导出守卫；本轮既有 text-transform-source 测试通过不否定该反例。
- **建议与关闭条件**：读取发布绑定来源、选择及请求代际，草稿携带所属脚本身份。覆盖两种响应顺序、跨 owner 切换和正常保存，确认目标 ID 与正文始终同源。未验证真实 DOM/服务端写入。

### OCT-002 · P2 · 宏来源更新静默覆盖未保存草稿

- **证据**：[macro-authoring-panel.tsx](../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.tsx) 的 `useMacroAuthoring` 来源同步 Effect（95 行）；[studio-panel-registry.tsx](../../../apps/studio-client/src/app/studio-panel-registry.tsx) 构造 Card/PromptResource sources。只要来源版本上升，就替换 rows、baseline、draftVersion，不检查草稿是否已编辑。
- **反例**：修改宏但不保存，再在其他面板修改同一资源正文，使资源版本增加。受控 Hook 探针得到 `UNSAVED → original`、`dirty=true → false`。
- **影响与反证**：未保存输入无提示丢失。已访问面板仍挂载，其他字段更新也会触发；历史 Context Asset 草稿修复没有覆盖此宏编辑器。
- **建议与关闭条件**：干净来源继续同步；脏来源保留输入与原版本，冲突显式处理。验证无关字段更新、宏更新及失败刷新均不静默丢输入。未执行浏览器切面板验收。

### OCT-003 · P2 · 保留历史节点时把游标重置到最新页

- **证据**：[use-narrative-runtime.ts](../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts) 的事件刷新（190 行）、终态刷新（722 行）与 `loadOlderNodes`（952 行）。刷新通过 `reconcileNarrativeNodes` 保留历史前缀，却把 `olderCursor` 改回最新页的 nextCursor；旧页加载直接 prepend，不去重。
- **反例**：已加载两页后 SSE 重连/刷新最新页，再加载更早。受控探针得到 `[n1,n2,n1,n2,n3,n4]`，6 项只有 4 个唯一 ID。
- **影响与反证**：重复节点、楼层和虚拟列表 key。已有分页测试只覆盖相同游标请求去重及失败重试；历史 DOM 窗口化问题不涵盖数据窗口与分页边界不一致。
- **建议与关闭条件**：节点窗口与分页边界一起维护。验证两页以上历史在重连、提交事件和终态刷新后不重复、不跳页。未验证真实 SSE/浏览器。

### OCT-004 · P2 · 创建主对话的晚响应污染新选择

- **证据**：[use-narrative-runtime.ts](../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts) 的 `createAgentSession`（1053 行）及 `setPrimaryAgentSession`（1022 行）。Session RPC 返回后直接修改当前 Session 列表和 primary；归属校验对比闭包捕获的旧 targetTimeline，而非完成时的实际选择。
- **反例**：在 Timeline A 创建主对话，等待期间选择 B，A 响应晚返回。受控 Hook 探针确认实际 Timeline 为 B，但 primary 和当前 Session 列表包含 A 的 Session。
- **影响与反证**：当前 UI 会话来源错绑，后续 Widget 成功回调还可能打开旧上下文。全局集合有 API 来源守卫，局部列表、primary 和自动打开结果没有同等选择守卫。旧 Card 切换及删除/重命名晚响应测试不覆盖此创建路径。
- **建议与关闭条件**：保留已提交 Session，只在原来源与选择仍有效时发布当前列表、primary 和自动打开结果。覆盖切 Timeline/Card/API、无 Timeline 的创建及正常完成；不回滚已提交会话。未执行端到端浏览器。

### OCT-005 · P2 · 多工具取消遗留未完成调用

- **证据**：[tool-loop.ts](../../../packages/application-runtime/src/agents/tool-loop.ts) 一次落库全部 Invocation（490 行），逐项保存 Result，首项取消后在 594 行退出；[agent/store.ts](../../../packages/application-data/src/agent/store.ts) 的工作交接检查（132 行）拒绝任何无 Result 的 Invocation。
- **反例**：Gateway 返回两个 Native Call，首个工具等待 abort；在其开始后发出 `user-stop` 或 `user-pause`。真实内存 SQLite 得到 2 Invocation / 1 Result。stop 的终态为 aborted，pause 为 suspended；pause checkpoint 有两个 call、仅一个 result。随后追加 discarded 仍无法提交独立 work-summary，报 `agent.summary_boundary_invalid`。
- **影响与反证**：已结束/丢弃的 Run 阻断 Session 工作交接；checkpoint 的调用配对也不完整。现有 [native-tool-loop.test.ts](../../../tests/integration/application-runtime/native-tool-loop.test.ts) 的单调用取消用例（633 行）不能覆盖剩余调用。
- **建议与关闭条件**：已持久化但尚未执行的调用需要明确终结语义，Transcript 与 checkpoint 配对保持一致。多调用任意取消点都有唯一对应 Result，丢弃/结束后可交接，恢复不误执行已取消的剩余调用。未验证真实 Provider 对 checkpoint 的响应。

### OCT-006 · P2 · 重叠 Run 冲突后无法记录失败终态

- **证据**：[agents RPC](../../../apps/studio-server/src/rpc/handlers/application/agents.ts) 的 Run 创建（181 行）不按 Session 排他；[tool-loop.ts](../../../packages/application-runtime/src/agents/tool-loop.ts) 的 append（708 行）一直使用本 Run 的局部 entryCount，终态写失败在 684 行被吞掉以保留原异常。
- **反例**：A 落 running/measurement 后等待 Provider；B 读取最新 Session 计数并完成；再释放 A。真实内存 SQLite 中 A 的 Observation 写入报 `agent.entry_count_conflict`，failed 写入使用同一旧计数再次冲突。持久状态为 `A=running, B=running→completed`，工作交接报 `agent.summary_boundary_invalid`。
- **影响与反证**：模型请求已执行但 Observation 与 terminal 未保存，Run 一直显示 running。计数 CAS 正确防覆盖，但没有完成生命周期收尾；[agent-store.test.ts](../../../tests/unit/agent-store/agent-store.test.ts) 的 stale append 验证（399 行）只证明拒绝。
- **开放决策与关闭条件**：正式文档未明确允许或禁止同 Session 并发 Run。建议在正式 Runtime/Store 起始边界拒绝重叠执行，不能仅禁用 UI；若选择支持并发，则需保证 Observation、terminal 和交接判断正确。修复前须确认策略。覆盖 RPC、直接调用和 Resume，不再出现已失败但永远 running 的记录。未执行真实 HTTP 并发。

### OCT-007 · P2 · 主动 Narrative 读取漏掉私有来源

- **证据**：[narrative/access.ts](../../../packages/application-runtime/src/narrative/access.ts) 的 `sample`（34 行）只用 Timeline/Branch resolve；[agents-runtime.ts](../../../packages/application-runtime/src/runtime/agents-runtime.ts) 的 Reader 装配（1027 行）也没有传 Card。Registry 会过滤不匹配 cardId 的私有 Provider，而被动 Turn Preparation 传递 Card 归属。
- **反例**：注册目标 `{kind:'card', cardId:'card-A'}` 的 Provider；带 Card 的 resolve 选中 `private.memory`；同 Timeline 的 Reader sample 报 `narrative.context_unconfigured`。探针在来源解析阶段失败，未访问占位 Store。
- **影响与反证**：同一 Run 被动上下文可用，CodeAct/Narrative VFS 主动读取却不可用；同时存在全局来源时还可能使用不同边界。现有 [narrative-context.test.ts](../../../tests/contract/extension-host/narrative-context.test.ts) 验证私有隔离，[narrative-read-access.test.ts](../../../tests/integration/application-runtime/narrative-read-access.test.ts) 使用全局来源，未覆盖两者组合。
- **建议与关闭条件**：宿主从可信 Timeline 身份取得 Card 归属并传给 Reader，不由 Agent 自报权限。私有来源的被动/主动选择一致，其他 Card 来源仍不可见，历史读取审批边界保持不变。

### OCT-008 · P2 · Card 删除漏清绑定 Session

- **证据**：[cards-runtime.ts](../../../packages/application-runtime/src/runtime/cards-runtime.ts) 的 `deleteCards` 事务（191 行）删除 Timeline、State、Timeline scoped storage，却不调用 Agent Session 删除；[narrative-runtime.ts](../../../packages/application-runtime/src/runtime/narrative-runtime.ts) 的直接 Timeline 删除（279 行）已经实现同事务级联绑定 Session 和其存储。
- **反例**：创建 Card、Timeline、绑定 Session 和 Session scoped Record；`deleteCard({includePlayData:true})` 后真实内存 SQLite 显示 `timelineDeleted=true`、绑定 Session 仍在 liveSessions、`sessionStorageLive=true`；Changeset 没有相关 Agent/Session storage 删除 operation。
- **影响与反证**：相同游玩数据删除经不同入口结果不一致，保留已删除 Timeline 的会话和私有存储。不是把所有软引用误判成级联 ownership；直接 Timeline 删除的当前实现与分页/回滚测试构成相邻合同。旧 storage lifecycle 测试只有独立 Session。
- **建议与关闭条件**：在 Card 删除的同一 dataTx 补齐 Timeline 绑定 Session 及其存储清理。覆盖单卡、批量、跨页、失败原子回滚，保留独立与其他 Timeline 的 Session。未进行真实磁盘/HTTP验证。

### OCT-009 · P2 · 删除后仍能写入新的 Scope Config

- **证据**：[extensions-runtime.ts](../../../packages/application-runtime/src/runtime/extensions-runtime.ts) 的 `upsertExtensionConfig`（257 行）先执行 Scope 存活查询，再进入 Document 写事务；Scope 查询实现位于 420 行。
- **反例**：A 完成真实 Timeline 存活查询，用 gate 延迟返回；B 删除 Timeline 并完成级联清理；放行 A，再进入写事务。真实共享内存 SQLite 得到 `timelineDeleted=true, configLive=true`，存活 Config 仍指向已删 Timeline。
- **影响与反证**：删除成功后又出现应随 Scope 消亡的存活存储。FIFO 只保护各次事务，Config CAS 只验证 Config，不保护事务外 Scope 查询。事先不存在 Scope 和普通更新测试通过不否定此交错。
- **关联风险**：[Host storage.ts](../../../packages/extension-sdk/extension-host/src/storage.ts) 的 Records.create（152 行）有类似先校验后提交结构，仅静态检查，未独立复现，不作为额外发现计数。
- **建议与关闭条件**：权威 Scope 校验与存储提交使用同一共享事务，不重入外层 Engine。验证写先提交时删除能清理，删除先提交时写明确失败；不得创建/恢复存活存储。未执行真实跨连接并发。

### OCT-010 · P2 · 文件往返丢失 Preset 宏候选

- **证据**：[workspace.ts](../../../packages/application-runtime/src/cards/workspace.ts) 导出保留 cardContent.preset（463 行）；[card-bundle-files.ts](../../../apps/studio-server/src/codecs/card-bundle-files.ts) 的投影（65–69 行）与恢复（156–160 行）仅处理 system/macros，遗漏正式类型支持的 macroOptions。
- **反例**：直接调用当前 `encodeCardBundleZip` 再 `decodeCardBundleZip`，输入 preset 有 tone 宏与 quiet/loud 两个候选，输出保留 system/macros，但 macroOptions 消失。内存 tsx 探针退出 0，未写磁盘。
- **影响与反证**：ZIP、承载同一 ZIP 的 PNG、目录文件共用此投影，作者候选配置无法完整往返；Card 顶层 macroOptions 和 PromptResource metadata 不是本项丢失字段。现有 [card-bundle-zip.test.ts](../../../tests/unit/studio-server/card-bundle-zip.test.ts) 往返测试只有 system/macros（315、366 行）。
- **建议与关闭条件**：在同一文件合同保留 preset.macroOptions，读写与加载一致。验证候选 ID/label/value 完整往返，含只有 macroOptions 的 Preset；不新增独立宏存储或另一套容器格式。

## 待验证候选

### C-OCT-001 · ST 迁移实例释放没有收敛扫描与暂存目录

[ST Bridge index.ts](../../../official/extensions/st-data-compat/src/index.ts) 的 migration.start 创建 tmpdir（116 行），以 void 启动 scanDirectory（128 行）；onDispose（408 行）只报告诊断。commit/cancel/机会式 TTL 会删除目录，但释放实例没有等待扫描或清理未完成会话，模块 reload 后会话 Map 也可能失去可访问入口。

此项有当前源码及本地 dist 分发入口证据，但未执行真实停用/reload 动态验证，不计入确认问题。独立发布扩展不能用主应用测试绿灯代替验收。下一步需用临时测试目录验证扫描中停用、完成后 reload、显式 cancel，检查迟到写入和遗留目录；不要操作真实 ST 数据。

### C-OCT-002 · Narrative 旧页读取可能回退已编辑正文

[use-narrative-runtime.ts](../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts) 的事件读取（185 行）有请求序号但无共享本地写入代际。受控 Hook 探针得到“旧读取开始 → 编辑成功发布 → 旧读取返回覆盖正文/Head”。但真实 SSE 写入事件可能先使旧读取失效，本轮没有验证 HTTP/SSE 的完整时序。

不计入确认问题。需验证新事件延迟时旧读取能否覆盖已提交编辑，并同时核对无延迟事件的反证；不能仅据模拟时序宣称浏览器数据回退已发生。

## 覆盖与去重

| 分域 | 实际检查范围 | 结论边界 |
| --- | --- | --- |
| Client | 资源编辑与发布、导航/历史、Card/Provider/Preset、宏、脚本、Agent/Narrative、分页、Query、Display、事件投影 | 4 项确认，1 项候选；非所有 UI 行为穷尽检查 |
| Runtime/AI | Prompt/Tool 编译、Provider Step、Transcript、取消/暂停、交接、上下文来源、有效 Head、token 测量、Tokenizer/Loom Runner 接缝 | 3 项确认；未验证真实 Provider 或完整恢复生命周期 |
| 数据/Kernel/Extension | 事务、CAS、分页、ownership、删除、Blob/Asset 两阶段写入、Secret cleanup、RPC/事件权限、安装启停卸载、Host Scope | 2 项确认，1 项候选；未验证系统 Keychain、多进程或磁盘故障 |
| Server/工程 | HTTP 认证/Origin、取消与收敛、RPC 适配、文件编码、目录同步/恢复、日志和网络设置、测试配置与 CI 脚本 | 1 项确认；门禁仅静态检查，未执行远端 CI 或主应用全套门禁 |

沿用归档全仓审查的方法，不沿用其旧缺陷结论或旧行号。历史 FR-001/003/008/009/013/014/019、分页与扩展生命周期修复已作为反证/去重背景；本轮未将其自动重开。

不纳入问题数量：文件长度、普通 map/useEffect、未加 memo、一般抽象偏好；已经明确延期的远端 CI、Blob/归档 GC；同进程受信任代码不是强沙箱；计划未完成不是已实现缺陷。Preset 切换文档与 immutable 实现存在口径差异，但当前测试明确要求不可变，因此不擅自判作产品 Bug。

## 验证账目

| 执行者 | 检查 | 结果 | 证明范围 |
| --- | --- | --- | --- |
| 主 Agent | `pnpm exec vitest run tests/unit/studio-server/http-lifecycle.test.ts tests/integration/studio-server/origin-protection.test.ts tests/unit/studio-server/card-directory-apply.test.ts tests/unit/studio-server/card-bundle-zip.test.ts` | 4 文件 / 67 项通过 | HTTP/Origin/目录 Apply/ZIP 现有合同；不覆盖遗漏宏候选 |
| Client 子 Agent | `tests/unit/client/` 下 text-transform-source、card-timeline-selection、macro-panel-ui 三个既有测试文件 | 3 文件 / 44 项通过 | 相邻 Client 合同，未覆盖四个新增交错 |
| 数据子 Agent | agent-session、extension-config-runtime 两个文件，按下方名称筛选 | 2 文件 / 3 项通过，33 项跳过 | 直接 Timeline 删除的跨页/失败回滚与 Config 普通 CAS |
| 主 Agent | 当前 ZIP 编解码 tsx 内存往返 | 成功执行，复现字段丢失 | OCT-010 |
| Client 子 Agent | 当前 Hook/controller 的受控异步探针 | 四项确认反例及一个待验证反例 | OCT-001～004、C-OCT-002；不等于真实 React DOM |
| Runtime 子 Agent | 当前源码的内存 SQLite 工具取消/并发探针及 Registry/Reader 探针 | 复现三项 | OCT-005～007；Reader 失败先于 Store 访问 |
| 数据子 Agent | 共享内存 SQLite 的 Card 删除探针与真实 Scope 查询 gate 探针 | 复现两项 | OCT-008～009；不是 HTTP 并发 |

既有测试实际执行 **114 项通过、33 项跳过**，不是全仓测试结果。子 Agent 已执行的验证未机械重跑；主 Agent 复核因果接缝、关键源码和反证，未把自建探针冒充独立浏览器验收。

子 Agent 的实际定向测试命令：

```bash
pnpm exec vitest run tests/unit/client/text-transform-source.test.ts tests/unit/client/card-timeline-selection.test.ts tests/unit/client/macro-panel-ui.test.ts
pnpm exec vitest run tests/integration/application-runtime/agent-session.test.ts tests/integration/application-runtime/extension-config-runtime.test.ts -t 'deletes all Timeline-bound|rolls back Timeline|creates and updates Package-owned Config'
```

探针不写测试文件：Runtime 使用 `pnpm exec tsx` 标准输入加载当前源码；数据使用 `TSX_TSCONFIG_PATH=tests/tsconfig.json node --import tsx --input-type=module -e ...`。SQLite 为 `:memory:`，结束后关闭。Client 使用 `node` 标准输入读取当前生产源码，以 TypeScript `transpileModule` 转译并加载真实导出的 Hook/controller，替换 React/RPC/未渲染 UI 依赖；状态按槽位存储，Effect 手动执行。没有抽出 AST 函数或手工重写业务模型，也没有验证真实 React 调度。

Client 分页探针首次误触发 Session 订阅而断言失败，修正为触发有效订阅后才复现重复；首次夹具失败不计为产品证据。临时探针未沉淀为回归文件；后续修复需按各项关闭条件提供可重复回归验证。

**未执行**：全仓 lint/typecheck/test/build、依赖安装或在线漏洞库查询、远端 CI、真实 Provider、真实 HTTP/SSE 并发、浏览器客观诊断、移动端/读屏/IME/视觉验收、长时内存性能、多进程及崩溃/磁盘故障注入。本报告不是安全专项扫描或无漏洞保证。

**实际偏差**：沿用历史分域流程，但没有为仪式完整而执行全套门禁；只做风险相关定向测试和内存反例。没有开始修复；OCT-006 的并发策略仍需决策。人工视觉验收未做，也不作为本次代码审查已通过事项。
