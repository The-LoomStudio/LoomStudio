# 事件日志中枢与前后端展示改进

> **状态**：Closing / 实现与定向验证完成，人工视觉验收待确认
>
> **日期**：2026-09-22
>
> **执行负责人**：主 Agent；批量迁移使用一个 Luna High 子 Agent
>
> **正式基线**：[运行日志架构](../../../architecture/platform/logging.md)

## 1. 目标与授权

不展开原始 JSON，仅阅读事件日志，就能知道一次 Agent 调用是否开始、执行到哪一步、Provider 收发结果、工具执行结果、失败阶段以及最终是否提交。日志不是完整工作内容或快照。

用户已确认前端采用时间流与原地展开，后端保留终端风格，并同意主 Agent 负责中枢及两端渲染、低成本子 Agent 负责模块日志迁移。2026-09-22 后续明确要求开始实施。

后续收到实施指令后，按下述顺序连续执行；常规局部实现不再逐项请求确认。

## 2. 当前事实

| 当前实现 | 证据与限制 |
| --- | --- |
| Root/Child Logger、Memory/Console/JSONL 已存在 | `packages/logging/src/`；复用现有 Sink、cursor/gap、脱敏和非阻塞写入，不重建采集系统 |
| Provider 已有 started/completed/failed 日志 | `apps/studio-server/src/logging/ai-gateway-logging.ts`；摘要固定，失败主要剩 `failureType`，缺少 Step 与取消语义 |
| Runtime 有 Transcript 和 Run 事件，但普通日志未闭环 | `packages/application-runtime/src/runtime/agents-runtime.ts`、`agents/tool-loop.ts`、`apps/studio-server/src/rpc/handlers/application/agents.ts` |
| HTTP 成功日志会写 params，错误日志缺少有效原因 | `apps/studio-server/src/http/http-server.ts`、`rpc/rpc-summary.ts`；简单遮罩/截断不等于正文准入，与正式 metadata-only 规则不一致 |
| 正式前端已有分页、两秒轮询、过滤、导出及追随最新 | `apps/studio-client/src/features/log-viewer/model/`、`widgets/log-viewer/log-viewer.tsx`；不能按旧文档重新建设 |
| 初始 DEV 草稿已演进为正式组件 | 现为 `apps/studio-client/src/widgets/log-viewer/log-event-row.tsx` 及同名 SCSS；旧 DEV 样例在后续清理中移除 |

调研曾读取近期本地 JSONL：一个实例 376 条记录中有 349 条 RPC 成功，其中 108 条为 Run subscribe；这是样本证据，不是固定比例或性能基准。

工作区已有其他任务修改，包含 Server main、Agent RPC、Runtime 和 Client Extension Host。执行前必须重读当前版本，不覆盖、不提交或整理无关改动。

## 3. 已确认的体验

### 前端

- 基础 Logs 保持从上到下的事件流，不使用 Master–Detail，不增加双布局开关。
- 使用原生或现有同等能力的折叠结构，多条可以同时展开；展开和关闭不主动跳到最新、不切换页面。
- 折叠行以事件摘要为主；耗时紧跟摘要，Token 位于同一阅读区域，禁止把耗时重新放到最右侧。
- 参考现有会话/Agent 索引列表的字号、紧凑行距、表面与悬停风格；保留来源辨识色和异常色，不把“统一风格”做成全部灰色。
- ID 不占据默认摘要。详情提供安全字段、复制、按本次运行过滤；原始 JSON 二级折叠、限高滚动。
- 默认降低普通读取与轮询成功日志的存在感，保留技术明细入口；warn/error 不能因来源属于 RPC 而被隐藏。
- 保留正式 Viewer 的 Server/Client 来源、搜索、级别过滤、轮询、gap、导出和最新记录提示。展开引起尺寸变化时不得打断阅读。
- Runs Inspector 以后承接 Message、PromptBuild 详细过程和快照，适合 Master–Detail，但不在本计划中建设。

### 后端

- 改进现有 Console Sink，不建设交互式 TUI；保留时间、级别、来源配色和简短树形附属信息。
- 默认一条摘要加必要结果行，不递归打印全部 data/关联 ID；耗时、模型、Token、状态直接可读。
- 完整安全字段仍保存在结构化记录中；显式详细输出可查看关联 ID，非彩色输出也必须可读。
- 终端与前端共享事实，不要求共享 React 组件或完全相同的排版。

### 原草稿（已于 2026-09-22 清理）

- 原前端路径：`/dev/preview/log-frontend`，现已移除。
- 原终端模拟路径：`/dev/preview/log-terminal`，现已移除。
- 直接复用并演进现有草稿组件，不让 Worker 根据截图重做。
- `DraftLogEntry` 只留在 DEV 样例文件，转换为真正 LogRecord 后进入正式组件；“运行 01”等标签不是生产身份。正式消费者不依赖样例常量、状态、Token 或失败原因。
- 先前类型和模块加载检查通过；后续颜色、耗时小修只作局部检查。浏览器连接曾超时，未完成自动化交互验收，不把用户方向确认写成生产全量验收。

## 4. 最小设计与所有权

### 4.1 日志中枢：主 Agent

沿用 `LogRecord`、Logger、Memory/Console/JSONL 和既有查询链路。优先用 `event + data + correlation` 表达事实；只有现有消费者无法满足要求时才作最小合同调整。不引入新日志框架、通用 Event Schema Registry、查询 DSL 或资源解析服务。

2026-09-22 冻结：不修改 LogRecord 形状。`data.detail` 是安全单行附属摘要；`durationMs` 为数值毫秒；`usage.inputTokens/outputTokens` 缺失不填零；`technical: true` 只隐藏普通成功，warn/error 永远可见；`outcome` 表达终态；`runId/sessionId/providerStep/invocationId` 为关联字段，完整 ID 留在详情。`readLogFailure` 仅提取允许的错误类型、数值 HTTP 状态及本地固定原因，不放行原始错误文本或任意 code。

成功/失败样板：`apps/studio-server/src/logging/ai-gateway-logging.ts`。跨端格式化：`packages/logging/src/presentation.ts`；安全错误提取：`failure.ts`。Console 的 `verbose` 选项由 `LOOM_STUDIO_LOG_DETAILS=1` 接线，不增加配置系统。

通用字段规则：

| 维度 | 必须统一的规则 |
| --- | --- |
| 身份 | service/instance/namespace、runId、Step 序号、Provider invocation、Tool invocation 的来源和传递；不能把 RPC callId 当作 Step 身份 |
| 摘要 | canonical English，脱离 UI 仍可理解；UI 标签可以本地化；不通过解析 message 或 mention 语法推导业务关联 |
| 数值 | 耗时统一为数值毫秒，Token 保持输入/输出数值；缺失不填零，不把最后一个 Step usage 冒充整轮汇总 |
| 结果 | completed/failed/cancelled/suspended 与失败阶段；Provider 完成、Loop 完成、Narrative 提交必须区分 |
| 降噪 | 明确哪些成功读取/轮询属于技术明细；异常优先于降噪规则，不删除失败记录 |
| 隐私 | 调用点采用字段白名单；不保存 params、Prompt、Message、ToolResult、Provider payload、Secret 或未经准入的异常正文 |

Kernel 和 Logging 不拥有 Agent 业务。领域事实由 Runtime/Server 生产，日志包只承担通用记录、格式化与分发；前端视图映射放 `features/log-viewer/model`，避免逐 Sink 复制领域判断。

保留完整关联 ID 用于详情/筛选，默认展示隐藏。当前范围的“仅看本次运行”可过滤已加载记录，必须明确受 Memory 窗口限制，不能声称查到完整历史。若确需扩展服务端查询，主 Agent 同步 RPC、类型和 cursor/gap 验证。

普通安全元数据不等于任意字符串都安全。HTTP 状态、稳定错误 code 和失败阶段由知道语义的边界提取；不放行整个 error.message/stack，不从被截断的正文重新猜测错误。新隐私保存范围必须回到用户决定。

### 4.2 Agent 运行闭环：主 Agent

这不是机械替换，主 Agent 自己实现：

- 调用进入与终态覆盖准备失败、Provider 失败、Tool 失败、取消/暂停以及最终提交失败。
- 每个 Provider Step 有序号、模型选择、消息/工具数量、交付模式、耗时、usage、finish reason 和安全失败原因；首输出耗时只在实际可观测时记录，不能伪造或逐 token 写日志。
- 工具记录实际调用标识、执行结果和耗时，不复制参数或结果内容；失败 ToolResult 与抛出异常都需按实际语义处理。
- Narrative commit 只在真正提交后成功；不因 Provider 返回或 Transcript terminal 已写入而提前宣布整个调用成功。
- 异步 Run create 的 RPC 成功仅表示接受调用；取消不能统一记成 Provider ERROR。保留当前执行、恢复、审批和持久化语义，不借加日志重构状态机。
- 明确每个生命周期事件的唯一生产位置，避免 RPC wrapper、Runtime、Gateway 同时记三份同义成功/失败。

### 4.3 两端渲染：主 Agent

前端将草稿展示接入正式 `useLogFeed`，沿用现有来源、分页和生命周期所有者。通用样式使用 `@loom-studio/ui` 与现有 token，不另建主题系统。未知 event 仍显示现有 canonical message 和安全详情，不为每个扩展事件强制建立专用 renderer。

Console 从同一条结构化事实提炼紧凑输出；任何 detail 开关都只控制呈现，不改变隐私准入或 JSONL 内容。详细模式的最小启动接线由主 Agent 在 P1 定好，不引入配置管理器。

## 5. 执行顺序与分工

| 阶段 | 负责人 | 写入范围与交付 |
| --- | --- | --- |
| P1 契约与样板 | 主 Agent | `packages/logging/src/`；`apps/studio-server/src/logging/ai-gateway-logging.ts`；`packages/application-runtime/src/providers/gateway.ts`、`types.ts`、`foundation/application-context.ts`、`runtime/context.ts`、`runtime/runtime.ts`、`runtime/agents-runtime.ts`、`agents/tool-loop.ts`；Server `main.ts`、Agent RPC；冻结字段表、注入方式和安全错误样板 |
| P2 边界修正 | 主 Agent | Server `http/http-server.ts`、`rpc/rpc-summary.ts`；删除通用 params 转储，明确 RPC 分类，修正同步/异步调用摘要；仅修改日志相关行为 |
| P3 模块迁移 | 一个 Luna High Worker | 按下一节逐批派发，严格按照样板替换已有日志；不设计合同 |
| P4 渲染集成 | 主 Agent，与 P3 并行 | `packages/logging/src/console-sink.ts`；Client `widgets/log-viewer/`、`features/log-viewer/model/`、`dev/preview/`、`shared/i18n/{en-us,zh-cn}.ts`；必要的 `shared/api/studio-api.ts` 与 Server `rpc/handlers/logs-rpc.ts` 由主 Agent 独占 |
| P5 收尾 | 主 Agent | 定向集成验证；更新正式 Logging Architecture、包/Client README 和本 Plan 状态；交付人工视觉验收 |

以上为预定写集。实施前按当前 checkout 校对，新增文件须属于这些模块；需要改动所有权以外的代码先调整任务包。P3 只在 P1/P2 所需样板完成后启动，不允许 Worker 一边猜协议一边迁移。

### Luna High 任务包

默认一个子 Agent 顺序接续三个小批次，不开三个用户可见任务，不继承整个长会话，不层层再委派。请求模型为 `gpt-5.6-luna`、reasoning `high`；派发时核对实际工具支持，不能静默换成更贵模型。不能精确选择时先报告限制，Plan 不代表模型已派发。

| 批次 | 允许修改的文件 | 必须保持 |
| --- | --- | --- |
| W1 Document | `apps/studio-server/src/logging/document-store-logging.ts` | 只调整摘要、安全字段和关联；不改 transaction、提交时序、DocumentStore 返回值 |
| W2 Server Extension | `packages/extension-sdk/extension-host/src/host.ts`、`instance.ts` | 只迁移生命周期与日志映射；保持 Host 注入身份、权限、激活/dispose 顺序和插件 Logger 公共能力 |
| W3 Client Transport | `apps/studio-client/src/shared/api/client-bridge-logging.ts` | 保持调用返回、异常传播、无请求正文；只按模板补安全摘要与分类 |

Client Extension Host 当前已有其他任务修改，不默认交给 Worker；主 Agent 先确定写入所有权，再决定是否增加明确文件的批次。其他原有日志由 Worker 先只读列出遗漏的调用点，主 Agent 判断必要性后追加小批次，禁止全仓机械替换或擅自扩写集。Prompt 日志位于主 Agent 负责的 `agents-runtime.ts`，由主 Agent 顺手完成本任务范围内的迁移，不交叉写。

每次派发仅包含：本 Plan 的相关章节、冻结字段表、样板路径、当前批次精确文件、需要保留的行为、最小验证及停止条件。子 Agent 可自行处理局部命名和测试修正；不得改变 level/event 合同、隐私规则、重试、业务控制流、公共接口或依赖。

子 Agent 报告：完成/部分/阻塞、改动文件、迁移点与未迁移点、验证命令和结果、偏差。主 Agent 依据约定证据集成，不默认重读所有实现或重新跑同一测试；只有证据缺失、合同偏移、交叉集成改变前提时定向复核。

## 6. 验收与验证预算

| 风险 | 最小证据与责任 |
| --- | --- |
| 底座或格式合同变化 | 主 Agent 运行 `tests/unit/logging/core.test.ts`；未改 JSONL 不机械重跑文件轮转测试 |
| Provider 安全错误及取消 | 主 Agent 定向 `tests/unit/studio-server/ai-gateway-logging.test.ts`，覆盖成功、HTTP 失败、取消和敏感内容不进入记录 |
| Run/Tool/Commit 时序 | 主 Agent 在 `tests/integration/application-runtime/agent-session.test.ts`、`native-tool-loop.test.ts` 和 `tests/unit/studio-server/agent-run-rpc.test.ts` 中选择直接覆盖改动的最小用例；重点覆盖多 Step 与提交失败，必要时补非平庸缺口 |
| RPC 不再保存正文，降噪不吞异常 | 主 Agent 定向 `tests/unit/studio-server/rpc-summary.test.ts`、`tests/integration/studio-server/logging.test.ts` |
| 模块迁移等价 | Worker 每批只运行主 Agent 指定的一个相关测试文件/最小 runnable check；W2 优先 `tests/contract/extension-host/logging.test.ts`，不改动不相关断言 |
| 前端真实消费行为 | 主 Agent 定向 `tests/unit/client/log-viewer.test.ts`；保留分页/gap/切源保护，确认多条展开、过滤、复制、追随最新和展开时阅读位置 |
| UI 人工验收 | 用户确认实际前端与终端：颜色、密度、摘要附近的耗时、长文本/窄屏及展开手感；DEV 样例通过不等于真实日志通过 |

每阶段只运行覆盖实际变化的检查，不把上表当作全套串行清单。公共类型变化再做对应 package/client 定向类型检查；入口或依赖变化才补 build。未来 Worker 的验证涉及测试修改时，派发前把具体测试文件加入该批写集。

验收底线：

- 同一 Run 从开始到实际终态可关联；失败原因不再只有 `Error`，不存在伪造的完成/usage/首输出。
- 普通界面不铺满 ID 或 RPC 轮询成功，关键异常在默认视图可见。
- 消费真实 LogRecord，不依赖样例字段、固定模型或“运行 01”。
- 不泄漏请求正文/凭证，也不因日志改动改变业务执行。
- 所有结果区分通过、既有失败、环境阻塞和未执行；外部 Provider 实测需用户明确许可，默认用已有测试 gateway/fixture，不消费真实 API 额度。

## 7. 非目标与停止条件

非目标：Run Inspector、Prompt/Message/Provider/Tool 内容快照、Trace/Audit 新存储、Notification、SSE/WebSocket、历史 JSONL 查询、Client 上传、交互 TUI、OTel、资源名称解析服务、数据迁移。

遇到以下情况，Worker 回传主 Agent，不直接问用户：样板不足、需要新增错误分类、未知数据敏感性、跨写集、并发修改冲突或同一阻塞连续两次。主 Agent 能在已确认边界内解决就继续；需要改变产品行为、隐私/权限、公共合同范围、持久化或恢复语义时才向用户确认。

P1 工程细节已收束：保持 LogRecord 形状；Runtime 单独注入 `runtimeLogger`，不改变原 PromptBuild logger 的意义；通用格式化与安全失败分类在 Logging，namespace 展示在 Client feature；Console 通过显式 `verbose` 和 Server 环境变量接线。

## 8. 状态与交接账目

- [x] 文档、实现和本地日志调研。
- [x] 两版 DEV 草稿及用户确认的流式展开、辨识色、就近耗时调整。
- [x] 记录主 Agent / Luna High 的分工、依赖和写入边界。
- [x] P1/P2：冻结合同、关键运行闭环和隐私边界修正。
- [x] P3：一个 `luna_operator`，实际配置 `gpt-5.6-luna` / `high`，顺序完成 W1/W2/W3；没有新建用户任务或子级委派。
- [x] P4：正式前端消费真实 LogRecord；Console 紧凑输出；旧草稿行实现、mention 解析和 namespace 连续分组已移除。
- [x] P5 自动化：定向检查、正式组件的样例浏览器交互与文档同步。
- [ ] P5 人工：正式运行的前端/终端观感、窄屏及操作手感；未执行真实外部 Provider 请求。

### 实际交付与偏差

- 主 Agent 完成 Logging 的 `failure.ts` / `presentation.ts`、Provider adapter、Runtime Run/Step/Tool/Commit 生命周期、HTTP metadata-only 和两端渲染。
- Worker 修改 Document adapter、Server Extension `host.ts`、Client Bridge；`instance.ts` 经核对无需改动。主 Agent 定向纠正了 Document 关联 ID 应保留、摘要最多三种类别、Client 失败原因放进折叠摘要三点，Worker 完成修正。
- `ApplicationRuntimeContext` 的实际注入位置为 `foundation/application-context.ts`，已纳入写集。没有改动 Agent RPC 的执行语义、Logger/Sink 持久化策略、数据迁移或依赖。
- 集成验收时前端 DEV 入口直接挂正式 `LogViewer`，仅 API/Memory 数据为样例；样例已按后续要求移除。生产路径仍为 `/studio/logs`。
- 未改 Server query 合同；按运行过滤只在当前缓冲区执行。没有增加 Renderer Registry、Resource Resolver、TUI 或专业 Inspector。
- 未重写旧 JSONL；已有日志中的历史内容不会因本次迁移自动消失。未知错误保留安全类别及阶段，不打印未知正文；最后一个 Provider usage 未被伪装成整轮汇总。
- 取消在最终提交期间到达时，Run 日志按取消/暂停记录，并单独保留 `narrativeCommitted` 的真实结果；不改变原有事务或调用返回行为，不把取消误写成“没有发生提交”。

### 验证账目

| 执行者 | 实际检查 | 结果 |
| --- | --- | --- |
| 主 Agent | `pnpm exec vitest run tests/unit/logging/core.test.ts tests/unit/studio-server/ai-gateway-logging.test.ts tests/unit/studio-server/rpc-summary.test.ts`（首次与 Client/Server 日志测试同批） | 通过；覆盖紧凑/详细 Console、HTTP 安全分类、取消、流首输出、RPC 摘要 |
| 主 Agent | `tests/unit/client/log-viewer.test.ts` | 7/7；技术异常可见、运行过滤、分页、gap、切源请求隔离；移除不再存在的 namespace 分组断言 |
| 主 Agent | `tests/integration/application-runtime/agent-session.test.ts` + `native-tool-loop.test.ts` | 原 34/34；随后新增“提交期间取消”定向用例 1/1（同文件其余 22 项按 `-t` 跳过，不算重跑通过）；覆盖准备失败、取消/暂停、最终提交失败、多 Step/Tool 关联及原有运行语义 |
| 主 Agent | `tests/integration/studio-server/logging.test.ts` | 4/4；Server 实际注入 Run/Commit、Prompt/Provider 关联、params 不进入日志；夹具隔离启动记录并按真实 Prompt 数量验证 |
| 主 Agent | `tests/unit/studio-server/agent-run-rpc.test.ts` | 4/4；已有异步 Run 接口行为 |
| Worker | `pnpm exec vitest run tests/integration/application-runtime/data-layer-atomicity.test.ts` | 5/5，覆盖 Document 日志包装下的回滚及删除；没有新增形式化测试文件 |
| Worker | `pnpm exec vitest run tests/contract/extension-host/logging.test.ts` | 2/2 |
| Worker | `pnpm exec vitest run tests/unit/client/studio-api.test.ts` | 13/13 |
| 主 Agent | `pnpm exec tsc -b packages/logging packages/application-runtime` | 通过 |
| 主 Agent | `pnpm exec tsc -p apps/studio-client/tsconfig.json --noEmit --composite false --incremental false` | 通过 |
| 主 Agent | Server 类型检查 | 被 `rpc/handlers/application/agents.ts:255,300` 两处本轮未改代码阻塞：Transcript union 的 content 访问、缺失的 inspectProviderAccount；未顺手修复 |
| 主 Agent | 浏览器 DOM/可访问性检查，正式组件 + DEV 内存样例 | 两条同时展开、运行过滤、检查时出现“回到最新”、技术明细从 14 条切到 22 条；不是生产日志内容或主观视觉验收 |
| 主 Agent / Worker | `git diff --check` | 通过；没有 commit，保留其他任务的未提交修改 |

2026-09-22 验证：`pnpm check:docs` 失败于本轮范围外的 7 项既有问题，本次文档未被报告。3 个断链位于 `docs/archive/issues/frontend-fsd-and-architecture-review.md` 和 `docs/archive/plans/ui/background-and-panel-materials-plan.md`；4 个生命周期/可达性问题位于 `file-backed-resource-agent-script-codeact-plan.md` 和 `ui/shell-motion-integration-2026-09-18.md`。未修改这些文档，不将全仓文档检查记为通过。后续阶段实际偏差与验证记录继续更新本节。

### 后续清理：2026-09-22

- [x] 定位 banner 重复：`main.ts` 只有一次启动打印调用；截图为 `.tsbuildinfo` 触发 `tsx watch` 重启后的第二次启动。开发脚本排除此类构建元数据，不压制真实启动日志。
- [x] 删除七组旧 DEV 样例，共十二个 TSX/SCSS 文件；保留空预览注册表和 DEV 入口。移除正式日志行样式中遗留的预览专用规则，不修改正式日志交互。
- [x] 隔离运行已安装的 `tsx watch`：修改 `.tsbuildinfo` 无重启，修改扩展运行 JSON 文件仍重启；测试进程已结束，临时夹具已清理。
- [x] 清理后 Client 定向 TypeScript 检查、`git diff --check` 通过。
- 未中断用户运行中的后端；新监听参数须下次重新启动 `pnpm dev:server` 才生效。没有新增浏览器诊断或人工视觉验收。
- 日志批量复制、原生助手只读查询、扩展采集/归属和资源 URI 展示属于下一阶段讨论，本轮未实现或扩大公共契约。
