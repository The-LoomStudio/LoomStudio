# LoomStudio 全仓代码审阅（2026-08-27）

> **状态**：Open Issues
> **审阅基线**：`main` / `7e69867978b1543e0ddea51ecc22b5cb542ab9d7` + 2026-08-27 当前未提交工作树快照
> **审阅方式**：3 个 `gpt-5.6-luna / high` 子智能体分域初审与第二轮去重增量审计，主智能体按当前源码、正式架构文档、生产调用链、反证与定向检查复核
> **修改边界**：本轮只新增本 Issue 并更新 Issues 索引；不修改源码、测试、配置、依赖或已有未提交工作

修复口径修订：本文保留 2026-08-27 的审查证据与统计，不代表所有问题仍在当前工作区成立。后续施工按[已确认修复口径与新顺序](./audit-remediation-decisions-and-order.md) 复核；FR-012 已从禁止悬空引用改为失效引用消费，FR-017/O-003 与后续专项去重。本次文档修订未修复代码。

## 结论摘要

本轮覆盖 Studio Client、Studio Server、Application Runtime、Kernel、数据与持久化 Store、Extension Host、导入导出、认证/RPC、测试与构建门禁、依赖和文档一致性。两轮去重审阅最终纳入 **2 个 P1、14 个 P2、3 个 P3、6 个优化候选**；未发现 P0。

| 编号 | 级别 | 结论 |
| --- | --- | --- |
| FR-001 | P1 | Client 统一异步封装吞掉异常，使失败 mutation 被调用方当成成功 |
| FR-002 | P2 | 按新合同修复：工作区历史、恢复与 URI 入口分离 |
| FR-003 | P2 | 已修复：快速切换 Card 时旧 Timeline 请求可覆盖新 Card 状态 |
| FR-004 | P2 | 已修复：Provider / Agent Profile 与 Agent Tool 写操作丢失 RPC 调用上下文 |
| FR-005 | P2 | `/rpc` JSON 请求体没有累计大小上限 |
| FR-006 | P2 | 测试与质量门禁存在假绿和契约漂移，当前根检查也未收口 |
| FR-007 | P2 | 实现已修复，人工验收待完成：State/Text Transform 与 Group Dialog 可访问性 |
| FR-008 | P1 | 实现已修复：服务端及前端预览 State 原型污染 |
| FR-009 | P2 | 已修复：受保护 HTTP Origin 校验及 RPC Content-Type 边界 |
| FR-010 | P2 | 已修复：不支持认证代理，拒绝 userinfo 并保留失败时原配置 |
| FR-011 | P2 | Agent Transcript 与 Narrative 提交不满足同 Changeset 原子性合同 |
| FR-012 | P2 | 修复目标已调整：允许删除后引用失效，补齐读取、提醒与执行边界 |
| FR-013 | P2 | 已修复：Extension Document ownership 检查与写入在同一事务内 |
| FR-014 | P2 | 已修复：State / Text Transform 面板缺少 source-scoped 请求代际守卫 |
| FR-015 | P2 | 旧复现入口已移除：Context Asset 旧完整数组覆盖 |
| FR-016 | P2 | 已修复：远程 Card 导入在无可信长度时先完整消费响应体 |
| FR-017 | P3 | Prompt Resource 旧列表响应可覆盖 mutation 后的新列表 |
| FR-018 | P3 | Provider / Agent Profile 客户端丢弃 100 条后的分页结果 |
| FR-019 | P3 | 已修复：InMemory DocumentStore 失败回滚可抹掉并发成功写入 |

## 已确认问题

### FR-001 · P1 · Client 异步封装吞掉异常，失败 mutation 被当成成功

2026-09-23 补充：首次 Narrative 提交创建 Timeline 后，Session 创建失败仍可能返回成功导航目标。现按 runAction 的布尔完成结果决定是否返回导航；保留输入与已创建 Timeline，重试不重复创建。新增受控 Hook 测试 2 项通过（失败与成功 control），主代理核对实际两行行为修改；未验证浏览器，也未覆盖 Agent Run 开始后的输入恢复，本项整体仍未关闭。

进度：部分修复，未关闭。`useAsyncOperations.run()` 现记录全局错误后重新抛出原异常；Card、Agent Profile/Tool、Provider/Capability 及 Prompt Resource 命令已接入，最终 UI 事件接住已上报的 rejection，保存/远程导入只有成功才关闭，媒体和 Tool 编辑器能收到局部错误。创建已提交而刷新失败保留已创建身份，避免重复创建；模型添加失败保留搜索输入，连接保存失败保留凭据草稿，资源删除失败保留确认框。其余旧调用明确使用临时 `runReported()`，包括 Context Asset 和 Narrative；不能据本批关闭这些链路。验证与未覆盖范围见[施工计划](../plans/audit-issue-remediation-plan.md)。下文保留原审查证据。

**证据位置**

- `apps/studio-client/src/shared/hooks/use-async-operations.ts:18-43`：`run()` / `runLatest()` 捕获异常、记录字符串后返回 `undefined`，Promise 仍以 fulfilled 结束。
- `apps/studio-client/src/app/use-studio-state.ts:47-90`：Cards、Context Assets、Provider、Agent、Narrative action 全部通过该封装，并再次 `.then(() => undefined)`。
- `apps/studio-client/src/widgets/character-panel/character-panel.tsx:150-153`：媒体上传依赖 `.catch()` 展示局部错误，但上层已吞异常。
- `apps/studio-client/src/widgets/character-panel/character-panel.tsx:383-391`：Card 保存无条件在 `.then()` 中关闭编辑器。
- `apps/studio-client/src/widgets/character-panel/character-panel.tsx:496-512`：远程导入等待 `onImportCards()` 后关闭弹窗；上层失败仍表现为成功返回。
- `apps/studio-client/src/features/context-assets/model/use-context-assets.ts:62-65,78-102,125-142`：乐观 mutation 的 rollback 依赖外层 rejection，但 `runAction` 会把 rejection 转成 fulfilled。

**触发链**

RPC / mutation reject → `operations.run()` 捕获并返回 `undefined` → 调用组件进入成功分支 → 编辑器或导入弹窗关闭、局部 `.catch()` 和 rollback 不执行 → Client 展示状态与 Server 权威状态分离。

**实际影响**

- 保存失败后 Card 编辑器仍关闭，用户无法从当前交互判断内容是否落库。
- 媒体上传失败不会进入组件自己的错误提示路径。
- Context Asset 乐观更新失败后不恢复持久化快照。
- 全局 Toast 只能说明“某个操作失败”，不能替代调用方必须执行的恢复与关闭条件。

**反证与边界**

统一记录错误本身没有问题；问题是同一个 API 同时承担“展示错误”和“改变 Promise 成败语义”。对纯 fire-and-forget action 可以吞异常，但这些调用方明确依赖 rejection 做业务恢复。

**最小修复方向**

让 mutation action 保留 rejection，或返回明确的 `{ ok, value, error }` 结果；只有无需调用方恢复的 UI action 才使用吞异常版本。补充 RPC reject 后 Card 编辑器不关闭、媒体局部错误可见、Context Asset 回滚生效的定向测试。

**关闭条件**：所有依赖成功/失败分支的调用方都能收到真实结果，且至少覆盖 Card 保存与 Context Asset rollback 两条失败路径。

### FR-002 · P2 · 工作区导航与入口状态归属不一致

状态：2026-09-23 经用户重新确认合同后修复。撤销“所有 Panel 必须改 Path”的方向：普通入口 /studio，History State 保存面板/Timeline/Branch/资源位置，本地按 endpoint 恢复最后工作区；明确 URI 深链优先。面板/独立资源选择同 URL Push，搜索/筛选 Replace；引用查看器受控，窗口标题和正文选择统一；关闭面板保留 Timeline 与已访问宿主。入口表补全 state/play/text-transforms，显式失效 Branch 不自动换绑。资源和消息提供统一入口链接；较早消息按分页定位，旧来源返回不污染新页。

实施与验证见 [导航计划](../plans/studio-navigation-and-workspace.md)：当前 Client 类型检查通过，实际浏览器确认变量/游玩入口、同 URL 前进后退、刷新/普通入口恢复、Timeline 深链优先和无效 URI 明确报错。未将自动化/客观诊断当成人工动画、焦点和视觉验收。以下为原发现的历史证据，原 URL 全驱动合同已被正式文档中的新合同替代。

**证据位置**

- 正式合同：`docs/architecture/ui/navigation-and-routing.md:3-21,61-69` 明确规定当前 Panel 属于 Path，搜索 `q` 属于 Query；从 Chat 打开 Panel 使用 Push，首次搜索 Push、后续输入 Replace。
- `apps/studio-client/src/pages/studio/studio-rail.tsx:77-101`：Rail 点击只调用 Zustand `togglePanel()`。
- `apps/studio-client/src/pages/studio/model/use-studio-navigation.ts:9-16`：URL 只单向同步到 Store；没有 Panel 或搜索输入的反向导航 API。
- `apps/studio-client/src/pages/studio/model/studio-route.ts:68-75`：`buildStudioPanelPath()` 已实现，但生产代码无调用者，只有测试引用。
- `apps/studio-client/src/widgets/context-workbench/context-workbench.tsx:66,101-102,214` 与 `widgets/preset-workbench/preset-workbench.tsx:108,127-129,429`：`q` 仅初始化本地 state，输入变化不写回 URL。

**触发链与影响**

- 从 `/studio/chat` 打开 Models / Resources 后地址仍停留在 Chat；刷新、复制链接、前进/后退无法恢复当前 Panel。
- 直接访问 Panel URL 后关闭 Panel，URL 又可能保留旧页面身份。
- 搜索条件刷新后丢失、不能分享，也无法按合同“一次返回退出整次搜索”。

**最小修复方向**

由 Router 持有 Panel identity：Rail 与关闭动作调用 `buildStudioPanelPath()` / Chat path 导航；Zustand 只保留布局、尺寸和普通 Asset 本地选择。为 `q` 增加首次 Push、后续 Replace、清空删除参数的单一 helper。

**关闭条件**：Panel 和搜索的刷新、深链、浏览器前进/后退行为与 Architecture 文档一致；普通 Asset 选择仍不持续改写 URL。

### FR-003 · P2 · 快速切换 Card 时旧 Timeline 请求可覆盖新 Card

状态：实现已修复。Card 选择/Play 打开统一调用 Narrative Hook 的 selectCardTimeline；列表按 API 与 Card 来源隔离，选择与 Effect 复用请求，mutation 后显式刷新可以替换旧请求。删除 facade 的重复刷新 Effect；旧列表、详情、创建完成不能发布或返回可导航结果。普通 Card 选择不创建，Play 无历史时仍创建；已发出的创建不取消持久化，只抑制过期结果抢占界面。8 项受控 Hook 异步测试通过，覆盖 A→B 乱序、创建/详情晚返回、相同 Card 的 API 切换、同源新刷新、启动默认 Card 不取消显式 Timeline 导航及失败退出加载。Client noEmit 通过，未做浏览器点击/URL 历史验收。

**证据位置**

- `apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts:66-75`：`refreshCardTimelines(cardId)` 完成后无条件 `setCardTimelines()`，没有 latest-wins 或当前 Card 校验。
- `apps/studio-client/src/app/use-studio-state.ts:130-133`：selected Card 改变时触发一次刷新。
- `apps/studio-client/src/app/app.tsx:176-182`：Card 点击又触发一次刷新，并在完成后自动激活返回列表的最新 Timeline。

**触发链**

A Card 请求尚未返回 → 用户切到 B → B 请求发出 → A 请求晚返回并覆盖 `cardTimelines` → App 的完成回调还可能激活 A 的 Timeline。

**实际影响**

B Card 界面可能短暂展示 A 的会话列表，甚至打开错误 Card 的 Timeline。重复刷新入口扩大了乱序窗口和请求量。

**最小修复方向**

按 `cardId` 建立 latest-wins guard，提交状态前确认请求仍属于当前 Card；保留一个刷新所有者，移除 App 与 facade 的重复触发。增加 deferred Promise 乱序测试。

**关闭条件**：A→B 快速切换且 A 最后返回时，UI 仍只保留 B 的 Timeline，且不会激活 A 的会话。

### FR-004 · P2 · Provider / Agent 写操作丢失 RPC 调用上下文

状态：已修复。Provider/Capability Profile、Agent Profile 和 Tool mutation handler 与 Runtime 传递请求 context；公共 writeDocument 接收并转发 actor、reason 和调用链字段，删除路径同样传递。真实 HTTP 集成用临时 SQLite 与内存 Secret Backend，逐笔核对 Changeset、data.changed、docs.changed 的客户端与 correlation/call/parent metadata；覆盖 create/update/delete、Credential 首次绑定/替换、带凭据创建及注入文档失败后的凭据补偿。单项集成通过，Server 引用图类型构建通过。未访问真实 Provider 或系统钥匙串。测试首轮按顶层读取事件 metadata、并少计 Secret 持久化准备/清理步骤，核对当前契约后修正测试并通过。

**证据位置**

- `apps/studio-server/src/http-server.ts:403-409` 为每次 RPC 构造 `clientId`、`correlationId`、`callId`。
- `apps/studio-server/src/application-rpc.ts:321-327,352-358,366-383,400-401`：部分 Provider / Agent RPC 没有把 `context` 传给 Runtime。
- `packages/application-runtime/src/types.ts:84-101`：相关 Runtime 方法没有统一接收 `RuntimeRequestContext`。
- `packages/application-runtime/src/runtime.ts:739-785,806-829,849-868,893-898,910-926,958-1012,1028-1034`：Profile / Tool 文档写入和删除直接调用 `writeDocument()` 或 `documents.delete()`。
- `packages/application-runtime/src/document-store.ts:25-43`：公共 `writeDocument()` 不接收 actor、reason、correlation/call metadata。
- `packages/document-store/src/changeset.ts:37-51,139-146`：缺失 actor 时明确回退到 `{ kind: 'kernel', id: 'kernel' }`。

**触发链与影响**

HTTP RPC 已生成真实调用上下文 → RPC 或 Runtime 写路径丢弃上下文 → Document Store 回退到 Kernel actor → Changeset、Document Commit Fact 与 `docs.changed` 无法和原始用户调用闭环关联。功能操作本身可以成功，但审计、诊断与错误追踪会把用户写入误记为 Kernel 行为。

**最小修复方向**

让全部 Application mutation 接受统一的 `RuntimeRequestContext`，并由 `writeDocument()` / delete helper 转发 actor、reason、correlationId、callId、parentCallId。Provider Credential 的 Secret 写入、文档回写和回滚必须保留同一请求上下文。

**关闭条件**：经 HTTP 执行的 Provider / Agent create、update、delete 与 credential 回写都记录真实 client actor 和调用链 metadata；集成测试同时断言 Changeset 与事件投影。

### FR-005 · P2 · `/rpc` JSON 请求体没有累计大小上限

**证据位置**

- `apps/studio-server/src/http-server.ts:399-400`：完整读取后直接 `JSON.parse()`。
- `apps/studio-server/src/http-server.ts:479-488`：`readRequestBody()` 持续 `body += chunk`，没有 `Content-Length` 快速拒绝、累计字节上限或超限终止。
- 同文件 `readBinaryRequestBody()` 已按字节累计并在超限后 `request.destroy()`，说明已有可复用模式。

**触发链与影响**

已认证本地请求 → 无界累积 UTF-8 字符串 → `JSON.parse()` 再分配对象 → 内存增长、GC 抖动和事件循环阻塞，极端情况下可使 Studio Server 失去服务能力。

**反证与边界**

服务当前仅绑定 loopback，入口也要求有效 session，因此这不是已确认的远程未认证漏洞，严重度保持 P2；后续受保护入口缺少 Origin 校验的问题另见 FR-009。认证不等于资源配额，已认证本地进程或页面代码仍不应获得无界请求体。

**最小修复方向**

为 JSON RPC 定义覆盖当前最大合法载荷的 `maxBytes`，先检查 `Content-Length`，读取时继续按 UTF-8 字节累计，超限返回 413 并停止读取；同时增加请求读取超时以及分块、多字节字符测试。

**关闭条件**：超限请求不会进入 `JSON.parse()`，不会继续累积，返回稳定 413；正常最大业务载荷保持可用。

### FR-006 · P2 · 测试与质量门禁存在假绿和契约漂移

测试桥接增量：Extension Host helper、ClientBridge data-flow 和平台 smoke 改用当前接口推导参数，emitEvent 返回真实事件；订阅回调不再返回 push 的数字。相关四文件运行时 31 项通过。阶段性 tsc 仍失败（174 条/63 文件），之后仅补平台 smoke 的同类回调返回值，不将未重跑后的诊断数量作推算结论。

2026-09-23 类型检查现状刷新：`tests/tsconfig.json` 补齐 Ai Gateway 根入口/contracts 源映射，并复用 Client 现有 vite-env.d.ts，未添加 any 或忽略规则。实际 tsc 诊断从 118 文件/283 条降至 67 文件/189 条，前后均退出 2；剩余测试 fixture/公共契约及类型环境错误仍待处理，不能沿用下文历史 60 条作为当前基线。

状态：包级空跑与根零测试成功入口已修复；测试类型、lint、全库测试与 CI 门禁仍未完成。当前 Application Runtime/Application Data/Server 已有有效 root/filter，本轮修正剩余 17 个脚本（含 Core 失效目录和嵌套 Extension Host 的三级 root），不增加运行框架。结构化核对 20 个已有测试命令，root 均正确、目标路径均存在，无剩余 passWithNoTests；真实 `pnpm --filter @loom-studio/asset-store test` 执行 3 项通过，`pnpm --filter @loom/core test` 执行 31 项通过，根故意无匹配过滤返回退出码 1（预期拒绝）。其余脚本未逐个执行，不能据路径存在断言测试全绿。当前 Ai Gateway/Secret Store 源别名已存在，本轮仅使 contracts 子路径先于 Ai Gateway 通配前缀；未借此宣称所有来源解析和测试类型已验收。

**已复现事实**

- `packages/application-runtime/package.json:10-13` 指向不存在的 `tests/application-runtime-m0.test.ts`，并使用 `--passWithNoTests`。
- `pnpm --filter @loom-studio/application-runtime test` 与 `pnpm --filter @loom-studio/asset-store test` 均输出 `No test files found, exiting with code 0`。
- `eslint.config.js:4-7` 整体忽略 `tests/**`、`scripts/**` 和所有 config；根 `tsconfig.json:1-29` 不引用 `tests/tsconfig.json`。
- 手动执行 `pnpm exec tsc -p tests/tsconfig.json` 得到 **60 个 TypeScript 错误，涉及 27 个测试文件**，包括 Extension Host handler 契约、Application Runtime 必填依赖、RPC meta、Agent/Profile DTO 和 Store transaction callback 漂移。
- `vitest.config.ts:23-47` 把多数 workspace package 映射到 `src/index.ts`，但遗漏 `@loom-studio/ai-gateway` 与 `@loom-studio/secret-store`；从 `packages/application-runtime` 解析这两个包时实际落到 `dist/index.js`，存在源码变更后测试读到旧产物的窗口。
- 当前根 `pnpm lint` 失败：17 个错误，分布在 5 个源码文件。
- 当前根 `CI=1 pnpm test` 为 118/119 文件、533/534 用例通过；`tests/integration/studio-server/logging.test.ts:102` 的失败可单文件复现。原因是近期初始化和 `createCard` 产生多次合法 Document commit 后，测试仍断言只有一次 commit。

**实际影响**

- 包级 `test` 命令可以在完全没有执行测试时返回成功。
- Vitest 的 transpile-only 运行能通过一部分运行时断言，却无法发现测试 mock、helper 和公共类型契约已经失配。
- 缺失 source alias 会让测试结果依赖是否提前构建过某些内部包。
- 当前仓库没有一个同时代表源码、测试类型和运行时测试健康的稳定绿色门禁。

**反证与边界**

根 `pnpm test` 仍能发现 119 个测试文件，根 `pnpm build` 当前通过；因此问题不是“完全没有测试”，而是包级命令假绿、测试类型未纳入门禁，以及根质量状态尚未收口。

**最小修复方向**

1. 先修正当前 lint、logging test 和测试类型错误，避免在红基线上增加门禁。
2. 让 package `test` 指向真实测试，默认移除 `--passWithNoTests`；确实允许空测试的包应显式说明。
3. 把 `tests/tsconfig.json` 纳入独立 `test:typecheck`，补齐 SCSS declaration 与 workspace source paths。
4. 让 Vitest source alias 覆盖所有被源码消费的内部包，或改为单一、自动生成的 workspace alias 来源。
5. 建立最小 CI：workspace check、build、lint、test:typecheck、test。

**关闭条件**：包级命令不再空跑假绿；测试类型检查为绿；Vitest 不依赖旧 dist；根 build/lint/test/typecheck 全部通过并由 CI 执行。

### FR-007 · P2 · 新 State / Text Transform UI 未完成 i18n 与可访问性合同

状态：State/Text Transform 与 Character Group Dialog 的实现均已修复，人工键盘/读屏验收仍未关闭。并行 B 补齐 State 配置、规则/提取器 JSON、脚本文件名/源码、上下文选择和导入按钮的名称，以及预览错误、状态、修订、返回和缩放双语文案；用户数据、源码和协议字段不翻译。新增 SSR/i18n 测试与既有面板/source 测试共 4 文件/37 项通过，Client 定向类型检查与 diff 检查通过。主代理核对交付及测试范围，没有重复跑测；SSR 属性断言不等于真实读屏器验收。

Character Group 补包：A 将自定义容器/焦点循环替换为既有公共 Dialog，模态与背景隔离复用其原生 showModal 生命周期，删除失去消费者的遮罩样式。分组操作与父级关闭清空草稿回调不变，未改共享 Dialog 或 FR-016 下载逻辑。真实公共 Dialog 的 SSR 标题关联、控件名称和关闭卸载两项测试通过；主代理定向核对组件与测试，无重复跑测，浏览器键盘/焦点恢复/背景隔离仍需人工验收。

**证据位置**

- `apps/studio-client/src/features/text-transforms/ui/text-transform-panel.tsx:103-125`：标题、说明、状态、按钮和 option 混用硬编码中英文；`select`、Document ID input 和 JSON textarea 没有 `label`、`aria-label` 或 `aria-labelledby`。
- `apps/studio-client/src/features/state-variables/ui/state-variables-panel.tsx:83-114`：同样存在硬编码文案；Definition、Snapshot、Card Config 的 select/input/textarea 缺少显式 accessible name。
- `apps/studio-client/src/widgets/character-panel/character-panel.tsx:630-667`：Character Group 自定义 Dialog 虽已有 `role="dialog"` 和手写焦点循环，但仍缺少 `aria-modal="true"` 与背景隔离；公共 `Dialog` 已存在可复用。

**实际影响**

切换 `en-US` 后新功能仍显示混合语言；屏幕阅读器不能可靠识别多个核心编辑控件的用途。自定义 Group Dialog 的模态语义也没有与项目公共组件收口。

**反证与边界**

这不是主观视觉意见：项目已有 typed i18n 和公共 Dialog contract，缺失 accessible name 可从静态 DOM 结构确认。具体读屏器播报与焦点手感仍需人工验收。

**最小修复方向**

补齐 typed i18n key；为每个表单控件建立真实 `<label htmlFor>` 或 `aria-labelledby`；将 Character Group 迁移到公共 `Dialog`，或补齐等价模态和背景隔离语义。

**关闭条件**：双语切换无硬编码泄漏；自动化可查询所有表单控件的 accessible name；键盘与读屏器人工验收通过。

### FR-008 · P1 · State 路径与 Binding 可污染进程级 `Object.prototype`

状态：服务端与后续发现的前端预览遗漏均已修复。现有 Pointer、deepMerge、Binding 写入和 Delta 已使用 own-property/defineProperty 边界；并行工作包 B 补上 Contribution collection 路径、通配 Binding 读取、Schema properties 与引用诊断中的继承读取。保留合法 own `__proto__`、`constructor` 等 JSON 数据键，不再要求笼统禁止这些字符串；安全边界是不得沿原型链读写。B 的 6 文件/43 项定向测试通过，包含修前可复现的 Collection 污染、空键/null/扩展字段与 SQLite Delta 重放；主代理核对了实际 diff 与证据，未重复运行。没有完整 HTTP RPC/Agent Tool 端到端验证，不将底层测试冒充入口级证明。

前端补充证据：`features/state-variables/ui/state-authoring-panel.tsx` 的 `buildAssemblyPreview -> setPreviewPath` 直接读取 `current[segment]` 后写入，可被 `collectionPath: "__proto__"` + 自定义 entityId 或同类 Binding 路径污染浏览器 Object.prototype；源码编辑触发本地预览即达，无需保存。`deepMerge` 对 own `__proto__` 普通赋值则会改变结果实例原型并丢失序列化数据。B 在独立内存探针确认两者并清理测试污染，未操作用户浏览器；已获授权只修当前预览与最小回归。

前端修复验收：setPreviewPath 与 deepMerge 同样只读 own 属性并使用 defineProperty 写入，空键不再被无意义丢弃。B 的 `state-preview-prototype.test.ts` 与既有 State 面板测试共 2 文件/15 项通过，覆盖实际配置解析器和组件 SSR 的 Entity/Binding 输入、实例/全局原型不变、特殊键序列化及普通预览。主代理核对实际实现及回归证据，无重复测试；未执行用户浏览器输入验收。

**证据位置**

- `packages/application-runtime/src/state.ts:391-397,432-478`：点路径和 JSON Pointer 读取使用 `segment in current`，对象写入直接执行 `parent[key] = value`，没有拒绝 `__proto__` 等危险 segment。
- `packages/application-runtime/src/state-definition.ts:21-39,197-227`：Global / Timeline Binding 的路径正则允许 `__proto__`，`deepMerge()` / `setObjectPath()` 同样向普通对象直接赋值。
- `apps/studio-server/src/application-rpc.ts:215-225,988-1008`：已认证 RPC 可以提交任意字符串 State path。
- `packages/application-runtime/src/runtime.ts:1958-1977`：Agent Tool 的 State update 进入同一 mutation 实现。

**已复现事实**

```text
applyStateOperations({}, [{ op: 'set', path: '/__proto__/loomPolluted', value: true }])
  -> ({}).loomPolluted === true
  -> 返回 snapshot JSON 仍为 {}

materializeTimelineState(binding.path = '__proto__.loomTimelinePolluted')
  -> 普通对象继承攻击者提供的对象
```

探针结束后已删除测试属性，没有修改持久数据。污染值不出现在 own property 或序列化结果中，因此普通 State 校验、日志和 UI 很难直接发现。

**实际影响**

已认证 RPC、受 Provider 输出驱动的 Agent Tool 或导入的恶意 Binding 可以修改 Studio Server 进程中后续普通对象的继承属性。具体可利用结果取决于后续属性读取，但这是跨请求、跨领域的进程级完整性破坏，不能按普通输入错误处理。

**最小修复方向**

所有对象路径读取只接受 own property，写入通过安全 own-property 定义而非原型 setter；覆盖 `deepMerge()`、点路径、JSON Pointer、Binding materialization 与 Delta 重放。合法 JSON 对象可以拥有 `__proto__`、`prototype`、`constructor` 字段，不能为修安全问题额外收紧扩展数据 Schema。RPC 与 Agent Tool 的完整端到端回归仍应与底层边界验证区分记录。

**关闭条件**：所有 State 入口都不能改变 `Object.prototype` 或读取继承属性；恶意路径返回稳定输入错误，正常 JSON Pointer / Binding 行为保持兼容。

### FR-009 · P2 · 受保护 HTTP 入口缺少 Origin 校验，可被 loopback 跨端口同站 CSRF

状态：实现已修复。受保护入口携带显式 Origin 时必须通过精确白名单校验，错误 Origin 在业务处理前返回 403；RPC 非 application/json 返回 415。保留合法开发来源、无 Origin 的原生调用及图片读取。子代理实际 HTTP 测试 27 项、现有认证测试 4 项通过；主代理补齐停机测试的 JSON 请求头后，生命周期测试 5 项通过。未做真实浏览器 CSRF 验收；本项不包含 FR-005 请求体大小限制。

**证据位置**

- `apps/studio-server/src/application-session-auth.ts:26-39`：Bootstrap 校验 Origin，但后续 `authenticate()` 只验证 Cookie。
- `apps/studio-server/src/http-server.ts:42-104,381-409`：`/rpc`、Card 导入、Asset 与其他受保护入口只调用 Cookie authentication；`/rpc` 也没有要求 `application/json`。
- Cookie 为 `SameSite=Strict`，但 Cookie SameSite 以 scheme + site 判断，不包含端口；`127.0.0.1:5999` 与 `127.0.0.1:4173` 仍是同站、不同源。
- `docs/guide/project-structure.md:115-118` 与 `docs/archive/plans/provider-profile-secret-store-foundation-plan.md:255-263` 把严格 loopback 同源保护写成正式安全边界。

**已复现事实**

主审用实际 Auth 和 HTTP Server 做无浏览器探针：先从允许 Origin 获取 Cookie，再携带该 Cookie、错误 Origin `http://127.0.0.1:5999` 和 `Content-Type: text/plain` 请求 `/rpc`；Server 返回 200，stub mutation 被调用 1 次。浏览器的 Cookie 发送条件来自 SameSite 合同，本轮未启动浏览器。

**触发链与影响**

Studio 页面已建立会话 → 用户访问另一个 loopback 端口上的恶意页面 → 页面以 `credentials: include` 发送 simple `text/plain` JSON 请求 → 浏览器可携带同站 Cookie，Server 不校验 Origin → 任意已认证 RPC mutation 执行。CORS 会阻止攻击页面读取响应，但不会撤销已经发送的 simple request。

服务只监听 `127.0.0.1`，攻击者还需要本地恶意页面或受控 loopback 服务，因此不按远程未认证漏洞定级；一旦满足前提，删除、修改、导入等写操作均在影响范围内。

**最小修复方向**

对所有受保护请求统一校验精确允许的 Origin；`/rpc` 强制 `application/json` 并拒绝 simple content type。补“合法 Cookie + 错误跨端口 Origin + text/plain RPC”的集成测试；Native Shell 后续应改用其受控 IPC/Origin 合同，而不是放宽 Web 白名单。

**关闭条件**：错误 Origin 请求在进入 RPC Router 前被拒绝，合法开发和桌面 Origin 保持可用。

### FR-010 · P2 · 手动代理 URL 的 userinfo 凭据被明文持久化、回显并写入日志

状态：按用户“不需要认证代理、不单独建设”决定完成最小修复。manual HTTP/HTTPS 拒绝 userinfo，不新增 SecretStore 系统；旧带凭据配置启动明确失败，不默默改走 system，也不改写用户文件。仅缺失配置使用默认；无效 JSON/URL 错误不包含原始秘密。更新先持久化再发布内存，写入失败不造成双份配置不一致。子代理真实临时文件 17 项通过；主代理核对当前实现，未访问真实配置/Keychain，未改 Provider API Key 或普通/system/direct 代理路径。下列未决状态是修复前记录。

2026-09-23 当前边界核对：`platform/network-settings.ts` 仍只校验协议，userinfo 可进入普通 network.json 和 get/update DTO；此部分未修。当前 HTTP 成功日志只接收 `summarizeRpc` 的计数/标识摘要，不再记录原始 params，下面旧 sanitizer 的成功日志复现不能直接代表现状。不据此宣称所有错误日志已完成秘密审查。彻底关闭仍需要确认认证代理是否受支持：拒绝 userinfo 或移入 Secret Store 会改变产品/存储合同，待用户决定，未擅自选择。

**证据位置**

- `apps/studio-server/src/network-settings.ts:50-64`：只验证 `http:` / `https:`，接受 `http://alice:password@proxy/...`，并把完整 URL 以 `0600` 写入 `network.json`。
- `apps/studio-server/src/settings-rpc.ts:16-27`：get / update 原样返回 `proxyUrl`。
- `apps/studio-client/src/widgets/settings-panel/settings-panel.tsx:20-25,51-65`：完整 URL 进入 Client state 和普通文本输入框。
- `apps/studio-server/src/http-server.ts:411-430` 与 `rpc-summary.ts:3,14-35`：RPC 成功日志记录 sanitized params，但敏感键规则不包含 `proxyUrl`，也不解析 URL userinfo。

主审临时目录探针确认：`http://alice:secret@example.test:8080` 被完整返回、完整写入 mode `0600` 文件，`sanitizeRpcParams()` 也原样保留。

**实际影响与边界**

认证代理凭据会出现在配置文件、设置 UI、Client 内存和 JSONL / LogViewer 记录中。配置文件权限降低了同机泄漏面，但日志备份、故障报告和 UI 查看会扩大明文副本；这与 Provider Credential 已采用 Secret Store 的边界不一致。

**最小修复方向**

若产品不支持认证代理，直接拒绝 URL userinfo；若需要支持，把用户名/密码拆入 Secret Store，DTO、UI、日志只保留无凭据 URL 或 Secret ref。同时让 sanitizer 对 URL userinfo 做结构化遮盖，不能只靠字段名正则。

**关闭条件**：代理密码不进入普通配置、RPC result、Client state 或日志；认证代理的支持/拒绝行为有明确测试。

### FR-011 · P2 · Agent Transcript 与 Narrative 提交不满足同 Changeset 原子性合同

施工提示：以下引用的是原审阅基线的合同。当前 Architecture 已说明 Transcript 分阶段提交、最终 Narrative 另开事务；本项不再作为恢复“整轮同 Changeset”的实施指令。剩余失败表达与重复提交风险需由正在进行的 Agent 工作核对，本轮不修改执行器，也不据文档演进宣布这些风险已经消失。

**证据位置**

- 正式合同：`docs/architecture/data/README.md:118-120` 与 `docs/workbench/reference/rpc-methods.md:75-76` 规定 `narrativeTarget.commit = true` 时 Agent Message 与 Narrative Node 同一 Data Engine transaction / Changeset 提交。
- `packages/application-runtime/src/agent/tool-loop.ts:264-267,395,411-421,461-493`：user、run-state、Provider observation、tool entry、assistant 与 completed 状态经多次独立 Agent Store transaction 逐步落盘。
- `packages/application-runtime/src/runtime.ts:1121-1173`：Tool Loop 全部完成后，Narrative user / assistant node 才进入另一条 transaction。

**触发链与影响**

Provider 和 Transcript 已成功完成 → Narrative 在提交时发生 head conflict、磁盘/SQLite 错误或其他异常 → RPC 返回失败，但 Agent Session 已保留 completed transcript，Narrative 没有对应节点。调用方重试会生成新的 run 和重复 transcript，返回的单个 `mutation.changesetId` 也无法代表整次 Turn 的全部持久化事实。

**反证与边界**

不应在长 Provider 调用期间持有 SQLite transaction；问题不是要求把网络调用包进事务，而是当前实现仍宣称最终提交具备同 Changeset 原子性，却没有补偿、可恢复状态或显式 partial-failure 合同。

**最小修复方向**

二选一收口合同：要么在 Provider 完成后把尚未落盘的最终 Agent/Narrative 事实放入一个共享 transaction；要么明确采用可恢复提交协议，记录 Narrative commit pending/failed、关联全部 changeset，并提供幂等重试或补偿。增加 Narrative head conflict 后的集成测试。

**关闭条件**：失败响应不会留下未声明的 completed split-brain；重试不会重复 Turn，且文档、RPC receipt 与实际 Changeset 模型一致。

### FR-012 · P2 · 删除后失效引用的读取、提醒与执行边界

StateDefinition/PortablePayload 增量：仅移除跨 Card 拒删，保留条件版本校验与引用。State 的真实 Runtime/SQLite 三项证明已有 Timeline 正文及冻结 State/Schema 可继续读取和校验，新建缺模板明确失败且不创建 Timeline，有内联模板的路径正常。Payload 三项证明两个 Card 不变、读取/Bundle/Directory 导出明确报缺失、CAS 仍拒绝冲突、同名不替代、显式解绑后恢复导出。主代理另更新 workspace-artifact 的旧拒删断言，定向 1 项通过/14 项跳过；核对删除实现，未重复执行子代理测试。未验证遗留库或浏览器，不等同所有编辑面板缺失状态均验收。

Setting/Tool 展示增量：Preset 工作台保留缺失 ID 和不可用提醒，工具列表/详情保留失效挂载与选择；可显式移除全部不可用 Tool 挂载，失败保留原项。Card Setting 绑定弹窗保留缺失项，允许显式移除和沿用现有重新绑定入口；不误删仍有效的非 Setting 引用。Preset Setting 预览只提醒，未新增编辑系统。子代理三个定向文件 19 项通过，Client noEmit 通过，主代理核对投影与移除逻辑；未做浏览器视觉/焦点验收，不据此宣称所有领域引用消费已穷尽。

Preset/扩展删除增量：不再拒绝被 Profile 引用的 Preset，也不清理外部 Card/Timeline/Profile 引用、其他 Preset 的 Tool mounts 或 Profile overrides；解绑计数为零。被删 Preset 自有挂载及已归属附属资源仍删除。子代理真实本地 HTTP RPC + 临时 SQLite 两文件 5 项通过，验证外部引用不变、自有资源清理及主 Preset 缺失后预览/执行失败；主代理核对实现并同步 RPC 参考与正式契约，不重复跑测。无迁移、无执行器修改，未做真实 Provider/浏览器验收。

2026-09-23 前端选择补充：Profile 列表刷新保留原 current/stored ID，即使目标已删除；仅无既有选择时选首项。Agent 面板不再回退展示另一份 Profile，而是显示带原 ID 的不可用提醒，等待用户手动选择。两个定向测试文件 6 项通过，覆盖选择规则、不可用视图不展示其他 Profile 编辑表单、既有创建流程；未做真实浏览器与 Session 联动端到端验证。

AgentProfile CRUD 子链：删除移除 Session 存在性拒绝，不改历史或引用；普通编辑不重验未提交的旧 Tool overrides，显式提交仍校验。子代理真实 Runtime + 内存 SQLite 定向 3 项通过、同文件范围另 22 项未执行，覆盖删除后 Session/Transcript 保留、实际 preview/invoke/createSession 明确失败、失效 Tool 下无关编辑及显式引用校验。主代理核对 CRUD 实现和定向断言，未重复跑测；未涉及执行器实现或真实 Provider。

Setting 删除子链：Runtime 直接删除仅墓碑化 Setting，解绑计数为零；底层保留其入向挂载，Card/Timeline 的 IDs 不清空。共用语义同时适用于扩展资源移除，无迁移或兼容开关；Preset 自身拥有的出向挂载清理保持不变。子代理在 Narrative、PromptBuild 与扩展资源 RPC 三文件中定向 3 项通过、18 项跳过，覆盖真实删除后警告/跳过、主 Preset 与存储失败 control、扩展删除仍保留外部 Setting 挂载；主代理核对 Runtime/底层实现。未修改扩展层其他显式清理，Setting/Tool UI 缺失条目提示仍待处理。

**修复目标修订**

用户已确认允许业务引用在目标删除后失效，不因存在引用就阻止删除，也不做跨领域自动清空或重绑。原“任何并发顺序都不得留下悬空引用”的修复要求撤销；下列交错记录保留为历史证据，不再单凭产生失效 ID 认定数据损坏。

**原审查最强复现链**

- `packages/application-runtime/src/runtime.ts:1028-1034`：`deleteAgentProfile()` 先查询 `hasSessionForProfile()`，再单独删除 Profile Document。
- `packages/application-runtime/src/runtime.ts:1037-1044`：`createAgentSession()` 先读取 Profile Document，再在 Agent Store 的另一条 transaction 创建 Session。
- Agent Store 与 Document Store 共享 SQLite，但 `agent_sessions.agent_profile_id` 无法对 Document Store 行建立 FK。

按“Create 已读 Profile → Delete 确认无 Session → Delete Profile → Create 提交 Session”顺序的探针得到：Session 创建成功、`agentProfileId` 仍指向已删除 Profile、后续 Turn 无法读取 Profile。

同根因还存在于 `deleteStateDefinition()` 对 Card 引用的事务外扫描、Provider Profile / Agent Profile、Portable Payload / Card 等跨 Store 或跨文档引用检查。单个写入的 optimistic version 不能保护另一侧关系在检查后发生变化。

**最小修复方向**

按消费者收口失效行为：列表、编辑页和历史查看保留原引用并显示不可用原因，允许用户重新绑定；Provider/Model 等必要执行依赖只在实际调用时明确失败。Prompt Build 的可跳过贡献与未展开宏采用提醒而非统一阻断。不建立全局 relation table、反向引用扫描或级联清空系统。

Provider 子链已完成：投影容忍缺失并保留原引用，删除不再被业务引用阻拦，手动重绑校验新目标，实际调用仍失败。BACKEND-ADV-005 的证据归入[实施计划](../plans/audit-issue-remediation-plan.md)，其独立后端报告已删除。AgentProfile、Setting/Preset、扩展资源、Tool/Setting 提醒以及 StateDefinition/PortablePayload 的具体完成证据见本节顶部。其余 Prompt Build 消费及各编辑面板缺失提示、浏览器验收未穷尽，整体 FR-012 暂不关闭。

**关闭条件**：顺序与并发删除后配置和历史仍可查看、失效项可修复；必要执行依赖缺失明确报错，宽松构建产生可定位提醒；不自动清空运行配置、切换默认目标或掩盖已提交事实。Blob 字节、Secret 恢复、Extension ownership 和同一事务正确性不适用这一宽松规则。

### FR-013 · P2 · Extension Document ownership 检查与条件写入非原子

状态：已修复。当前 `extension-host/src/instance.ts` 将 owner/type 检查与 write/delete 放入同一 DocumentStore transaction，检查包含 tombstone；新建使用 `expectedVersion: 'new'`，已有同 owner/type 文档仍允许省略版本，不新增 SDK 公共版本要求。子代理在真实 InMemory、SQLite Store 上的 16 项定向测试通过，覆盖竞争创建、类型变更、空 ID、tombstone、排队期间输入变化及删除交错。主代理核对实际事务实现；未运行该文件另 3 项既有测试，也未做动态扩展加载或 Kernel RPC 端到端验证。

**证据位置**

- 正式合同：`docs/architecture/extensions/README.md:139-150` 规定 Extension 不能夺取其他 Package Document。
- `packages/extension-sdk/extension-host/src/index.ts:663-677`：Host 先 `get(id)` 检查 owner，再独立调用 `documents.write()`。
- `packages/extension-sdk/src/index.ts:176-183`：`ExtensionDocumentWriteInput` 仍允许显式 `id` 且 `expectedVersion` 可省略。
- `packages/document-store/src/changeset.ts:171-179`：未提供 `expectedVersion` 时，已有 Document 不触发 conflict。

**触发链与影响**

Package A、B 同时以相同显式 ID 创建各自已声明类型 → 两次 owner 检查都看到 Document 不存在 → A 先创建 → B 未带 `expectedVersion` 的 write 被当作普通 update → type 与 `ownerExtensionId` 改成 B。这样可以绕过 Host 声明的 ownership 边界，且后续 A 已无法访问自己的 Document。

**最小修复方向**

显式 ID 的创建使用 `expectedVersion: 'new'`；将 owner/type 检查和写入合并为同一 transaction，不能依赖事务外 preflight。已采用事务方案，因此不要求同 owner/type 的普通更新新增 numeric version 公共约束。

**关闭条件**：两个 Package 竞争同一 ID 时只有一个 create 成功，另一方稳定 conflict；任何路径都不能改变已有 Document 的 owner/type。

### FR-014 · P2 · State / Text Transform 面板缺少 source-scoped 请求代际守卫

状态：两侧实现已修复，浏览器交互仍待验收。当前 State 面板已有部分 target/request 守卫，本轮补上 API 身份，立即隐藏旧 source 快照；保存前验证 target、草稿上下文和同步提交锁，保存完成后以当前 ref 而非闭包自比较判断是否可发布。切换来源/作用域释放旧保存状态，旧完成/失败不影响新草稿；保存期间编辑区 inert，失败保留草稿与原 revision。4 项受控组件异步测试通过，Client noEmit 通过；覆盖目标乱序、同 target 换 API、重复提交、失败重试和错误 target 拒写。未做浏览器焦点/IME 验收，未改切换 source 时现有的草稿清空策略。

Text Transform 补充：inspection 作用域包含 API、owner、来源、phase、consumer Agent Session；首段、自动 trace 请求和 override 请求每次返回均校验当前作用域/序号，结果及 override 配置同批发布，切换时立即隐藏旧结果/版本。旧错误、busy 完成和 override 保存回调不能污染新来源，重复保存受同步锁约束；目录刷新也增加 API/owner 请求守卫。6 项受控 Hook 测试与 Client noEmit 通过，不冒充真实浏览器性能或焦点验收。此次未重构 Script/Rule/Extractor authoring 的完整编辑生命周期。

**证据位置**

- `apps/studio-client/src/features/state-variables/ui/state-variables-panel.tsx:26-48`：refresh 不记录 Card / Timeline / Branch key，旧请求完成后无条件写入 timeline、文本和 Card config。
- 同文件 `56-80`：保存直接使用当前 state 中的旧 `snapshot.target` / `revisionId`，并调用当前 props 的 Card update callback。
- `features/text-transforms/ui/text-transform-panel.tsx:85-100`：dry-run / extractor 结果无 source 校验，旧 Narrative 或 Agent Session 结果可覆盖当前展示。
- `pages/studio/studio-panel-host.tsx:87-110`：Panel 访问后持续挂载；隐藏不会取消请求或清空状态。

**触发链与影响**

A source 请求未返回 → 用户切换到 B → B 请求先返回 → A 晚返回并覆盖 State 面板 → 用户在显示 B 身份的面板点击保存时，可能使用 A 的 target/revision 修改 A；Text Transform 则会显示与当前 source 不一致的 projection/extraction。

这与 FR-003 的 Card Timeline 列表竞态属于同类防护模式，但生产入口、状态所有者和写错目标的关闭条件完全不同，因此不以换标题方式重复 FR-003。

**最小修复方向**

为 source / target 建立稳定 key 和请求序号；提交状态前确认 key 仍匹配，source 改变时立即清空旧 projection/extraction。保存前再次确认 snapshot target 等于当前 props target。补 A→B deferred response 与错误目标保存测试。

**关闭条件**：旧 source 响应不能改变当前面板，也不能通过当前 UI 写入旧 target。

### FR-015 · P2 · Context Asset 串行队列仍会用旧完整快照覆盖连续成功编辑

当前核对：原 Add Zone 与 Composition items/zones 全数组 mutation 生产入口已不在当前 PresetWorkbench；当前 Zone/Composition 只读详情不构造这些补丁。对 Context/ Preset UI 和 context-assets UI 的 `skeletonPatch` 写入核对没有发现对应替代入口；onChangeNodes 只剩 Props/装配传递，未在这两个工作台内消费。因此原确定性 UI 复现不再适用，本轮不新建 updater/operation 框架来服务已移除入口。当前 commitEdits 已先发布统一 draft、串行使用版本基线，已有待保存输入与连续自身成功基线测试记录于施工计划。此判断是对原消费链的 no_change 归档，不承诺任意未来调用者提交两个旧完整数组时系统能推断并合并用户意图。

**证据位置**

- `apps/studio-client/src/features/context-assets/model/use-context-assets.ts:62-102`：队列执行时会基于最新 `persistedNodesRef` 应用传入 partial，但 partial 本身可能包含调用时生成的完整旧数组。
- `apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx:175-223`：Add Zone 从当前 render 的完整 `zones` 生成新数组并整体提交。
- 同文件 `262-270`：Composition mutation 同时整体提交 `items` 与 `zones`。

**确定性触发链**

第一次点击基于 `Z0` 排队提交 `Z0 + A` → RPC 返回前第二次点击仍基于旧 render `Z0` 排队提交 `Z0 + B` → 队列先持久化 A → 第二项在最新节点上应用“完整 zones = Z0 + B” → A 被覆盖。两次 RPC 都可成功，FR-001 的异常/rollback 修复不能保护这条链。

**最小修复方向**

队列中保存用户意图而不是完整旧集合：Add/Delete/Reorder 传 operation 或 updater，在真正执行时基于最新 persisted node 重算；或者在调用时立即更新统一 draft，并以 version/conflict 驱动重放。补连续新增 Zone、Composition item 和连续 reorder 的 deferred-RPC 测试。

**关闭条件**：连续操作全部保留；后一次成功 mutation 不会静默覆盖前一次已经成功的用户意图。

### FR-016 · P2 · 远程 Card 导入在无可信长度时先完整消费响应体

状态：已修复。远程导入改为 readBoundedResponseBlob，按 chunk.byteLength 累计，首个超限块不入缓存，立即 cancel，不再读后续块或创建超限 Blob/File；声明长度仅提前拒绝并取消 body。保存原始二进制/MIME、恰好 128 MiB 的允许边界及现有文件名/PNG/ZIP 分流。组件卸载 abort 下载，结束时释放 fetch，重复提交有同步锁。Client noEmit 通过；限量下载与现有导入失败测试共 14 项通过，含不可信长度、UTF-8 字节计数、取消失败、读取失败、精确边界、空 body 和本地 HTTP fetch abort。独立只读调查/候选审查未发现具体剩余绕过或回归。未进行浏览器完整文件导入或实际卸载竞态验收；累计字节上限不等于浏览器峰值内存上限。

`apps/studio-client/src/widgets/character-panel/character-panel.tsx:496-510` 只在可信 `Content-Length` 大于 128 MiB 时提前拒绝；Header 缺失或伪造时，`await response.blob()` 会先完整下载/消费响应体，之后才检查 `blob.size`。

攻击者控制且允许 CORS 的 HTTPS URL 可以造成远超限制的客户端下载和临时分配，极端情况下使页面失去响应或被浏览器终止。`https:`、`credentials: omit`、CORS 和 Server 后续 128 MiB 限制能降低其他风险，但不能保护 Client 消费阶段。

**最小修复方向**：使用 `response.body.getReader()` 分块累计实际字节数，超限立即 cancel；Content-Length 只作为快速拒绝。补 chunked、缺失/错误 Content-Length、多字节内容和 abort 测试。

**关闭条件**：实际接收字节超过上限时不再继续读取，也不会构造超限 Blob/File。

### FR-017 · P3 · Prompt Resource 旧列表响应可覆盖 mutation 后的新列表

状态：当前 QueryClient 实现的同根因已随 FRONTEND-011 修复。三个 cache setter 在发布写入结果前取消精确 key 的旧查询，真实 QueryClient 交错测试三项通过；记录集中于施工计划。下文保留历史实现证据。

去重：本项旧 refresh 实现与 [FRONTEND-011](./frontend-rendering-and-state-retention-audit-2026-09-21.md) 的 Query 缓存交错属于同一条修复链。实施以当前源码为准，不同时建设两套请求/缓存状态管理。

- `apps/studio-client/src/app/use-studio-state.ts:93-102` 对任何 list 结果都直接覆盖 library，并同步重置 Context Asset nodes。
- 同文件 `116-127` 的 Bootstrap list 与 `214-228` 的 Create 后 list 可并发；`features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.tsx:51-58` 在 Bootstrap / mutation 期间仍允许 Create。
- 两次独立 HTTP 响应若按“旧快照 A 最后到达”排序，新 Resource 会从 UI 消失，当前 Context Asset draft 也可能被旧树重置。Server 权威数据仍存在，刷新可恢复，因此定为 P3。

**最小修复方向**：Prompt Resource refresh 使用统一 latest-wins 序号，或串行化 Bootstrap/mutation refresh；覆盖 library 前确认 response generation。补 A 旧、B 新、A 最后返回的测试。

### FR-018 · P3 · Provider / Agent Profile 客户端丢弃 100 条后的分页结果

修复状态：已修复。Provider、Capability Profile 与 Agent Profile 的 Hook 完整收集各页后更新列表，创建模型前的 Provider 重读也按相同方式处理；101 条消费与后页失败回归通过，详见[实施计划](../plans/audit-issue-remediation-plan.md)。下文保留原发现基线。

- `packages/application-runtime/src/runtime.ts:793-804,836-847` 正确返回 `nextCursor`，底层默认页大小为 100。
- `apps/studio-client/src/features/provider-settings/model/use-provider-settings.ts:25-31` 与 `features/agent-profiles/model/use-agent-profiles.ts:19-37` 只请求一次并丢弃 cursor。
- Cards 已在 `features/cards/model/use-cards.ts:51-58` 循环消费全部页，可作为现有模式。

超过 100 个 Provider Profile 或 Agent Profile 后，后续实体在 UI 中不可见、不可选、不可维护；Server 数据未丢失，因此按规模边界定为 P3。

**最小修复方向**：像 Cards 一样按 cursor 聚合全部页，或把 UI 改成明确分页/虚拟列表。关闭条件为 101 条实体的客户端测试全部可达。

### FR-019 · P3 · InMemory DocumentStore 失败回滚可抹掉并发成功写入

状态：已修复。外层 get/list/getChangeset 与所有写入、回滚操作使用同一 FIFO，transaction callback 使用直连事务实例。AsyncLocalStorage 检测外层 Store 重入并明确拒绝，避免队列死锁。失败不会阻断后续操作。DocumentStore 契约测试共 62 项通过，新增两种 Store 各 5 项，覆盖失败事务之后的 write/delete/transact/revert、历史版本与 Changeset 保留、读隔离和重入失败后的继续写入。只使用内存数据库，无用户数据修改。

`packages/document-store/src/in-memory-store.ts:193-207,255-286` 在 transaction callback 前复制整个 Store snapshot，但没有串行队列；callback 跨 `await` 期间其他 write 可以成功，随后失败 transaction 的 `restoreState()` 会整体恢复旧 snapshot。

主审复现：Transaction A 写入后等待，普通 write B 成功并生成 Changeset，A 随后失败；最终 current 为空，B Changeset 也无法查询。默认生产 SQLite Store 有 Data Engine FIFO，不受此实现影响；风险集中在公开 InMemory 实现、测试和显式注入路径，因此定为 P3。

**最小修复方向**：为 InMemory Store 增加与 SQLite 一致的 FIFO transaction queue，或把全部 write/delete/transact 统一串行化。补失败回滚与并发成功写入的契约测试。

**关闭条件**：A 回滚只撤销 A 自己的变化，不会删除并发已提交的 B。

## 可优化项

### O-001 · Agent Transcript 渲染与刷新存在可消除的二次方扫描

`apps/studio-client/src/widgets/agent-composer/agent-composer.tsx:182-191,327-329` 为每条 message 重新过滤整个 transcript，渲染 N 条消息需要约 O(N²) 扫描；`features/narrative-runtime/model/use-narrative-runtime.ts:191-195,344-355` 在每次 Agent Turn 后又重新分页读取全部 transcript。

建议渲染前一次生成 message index 映射，并优先追加已知提交结果。当前没有浏览器 profile 或真实长会话手感证据，因此只列优化候选；关闭前应使用长 transcript 做 React Profiler / 输入延迟对比。

### O-002 · prepend 更早 Timeline 节点时保持滚动锚点

`features/narrative-runtime/model/use-narrative-runtime.ts:270-281` 直接 prepend 节点，`widgets/narrative-timeline/narrative-timeline.tsx:210-224` 没有在更新前后补偿容器高度差。建议记录旧 `scrollHeight` / `scrollTop`，提交后补偿差值。

静态链表明存在跳动风险，但真实浏览器布局、字体和滚动行为尚未验收，因此保持优化候选；关闭条件是浏览器中加载更早内容后原阅读节点保持视觉位置。

### O-003 · Document Store 统一分页输入守卫

`packages/document-store/src/sqlite-store.ts:107-138` 与 `in-memory-store.ts:44-59` 直接消费 `limit` / `cursor`，Kernel `docs.list` 没有统一的范围校验。建议复用一个最小 guard，统一非负 cursor、正整数 limit 和合理上限，保证 SQLite / InMemory 行为一致。

修复状态：与 DOCUMENT-DATA-003 共同关闭。两种 Store 使用相同页长/游标校验和筛选绑定，keyset 不再使用数字 OFFSET；验证证据见[实施计划](../plans/audit-issue-remediation-plan.md)，不重复计为另一项交付。

### O-004 · Card Bundle ZIP 拒绝重复 entry

状态：已随 CARD-FILE-002/CRC 子链修复，无需重复实施。当前 `codecs/card-bundle-zip.ts` 在解压入口以 seenPaths 拒绝重复文件或目录名，且要求本地条目与中央目录一致；`card-bundle-zip.test.ts` 已构造两个 manifest.json 验证拒绝。此前已登记的 Card ZIP/PNG/Asset HTTP 41 项包含重复路径与数量预算；本轮只核对当前实现和测试，未重复跑测。

`apps/studio-server/src/card-bundle-zip.ts:99-145` 用 `Map` 收集 entry，重复路径由后项覆盖前项。当前没有签名或哈希验证合同，尚不足以认定安全绕过；建议把重复 entry 视为格式错误，为未来签名、审计和跨实现兼容消除歧义。

### O-005 · 启动与测试文档对齐当前实现

状态：本项已修复。并行 A 按当前工具链版本文件、开发脚本、Vite/Vitest 配置及 HTTP 入口更新根/Server/Client README、getting-started 与 project-structure；区分固定开发版本与最低要求、双终端启动、package watch、HTTP RPC/SSE、代理端口及默认测试范围。A 定向核对 74 个相对链接目标、13 处测试路径引用和 diff 通过，主代理核对交付范围；未启动服务、未执行测试/构建，也未检查外链和锚点。FR-006 的零测试成功与全仓质量门禁问题不因文档说明而关闭。

- `README.md:17-19` 写 Node `>=20` / pnpm `>=8`，实际 `package.json`、`.node-version` 与 `.nvmrc` 固定 Node `22.18.0` / pnpm `9.15.0`。
- `docs/guide/getting-started.md:31-36` 声称 Server 启动 WebSocket 与 HTTP；当前实现是 HTTP RPC 和 Extension SSE，没有 WebSocket Server 构造路径。
- `docs/guide/project-structure.md` 仍引用不存在的 `tests/unit/client/cards.test.ts`。

这些不会直接破坏运行时，但会误导新环境搭建和测试定位，建议与 FR-006 一并收口。

### O-006 · 构建工具依赖与安全公告卫生

`apps/studio-client/package.json` 把 Vite、`@vitejs/plugin-react` 与 TypeScript 放在 `dependencies`；`pnpm audit --prod --audit-level low` 因而仍遍历构建工具链，并报告 **3 high、1 moderate、1 low**，涉及 PostCSS、nanoid 与 esbuild 的传递依赖。

当前没有证据表明这些构建期模块进入浏览器生产运行时，或已形成可由 LoomStudio 生产入口触发的利用链，因此不把公告数量直接等同于 5 个产品安全缺陷。建议把只在开发/构建时使用的工具移到 `devDependencies`，在兼容 Vite 8 的前提下升级或 override 相关传递依赖，并分别保留生产依赖审计与完整供应链审计。

## 明确不纳入或已有设计边界

- 删除 Card 不自动删除 Portable Extension Payload：当前 Plan 明确推迟到 Binding / GC Phase，不作为本轮缺陷。
- Server Extension 代码没有 Worker / 进程沙箱：Architecture 已明确它是受信任本地 Node 代码，不误报为现有权限绕过。
- Node SQLite `ExperimentalWarning`：本轮测试中的运行时提示，不影响用例结论。
- Build 的大 chunk warning、文件长度、缺少 `useMemo`、普通 O(N) 列表、命名与视觉偏好：没有独立影响证据，不纳入。
- Logging 测试红灯没有证明 Document logging 产品逻辑错误；当前证据指向测试断言未跟随合法多次提交语义。
- “超过 200 条 Extension Storage 时删除会因 offset 跳页而漏删”只适用于旧实现；当前 `packages/application-runtime/src/runtime.ts:2356-2370` 已先收集全部分页结果、再统一删除，候选撤回。
- 生产依赖审计报告的 5 项公告目前均来自构建工具链，没有确认的生产可达利用链；保留为 O-006，不列为已确认安全缺陷。
- 未进行浏览器视觉验收、真实触控板/读屏器验收、磁盘耗尽/WAL 损坏/进程崩溃、多进程迁移或远程暴露故障注入。

## 审阅覆盖与验证记录

| 审阅面 | 覆盖内容 | 结果 |
| --- | --- | --- |
| Client | Router/Zustand、Async action、Cards、Context Assets、Narrative/Agent、State/Text Transform、A11y/i18n | 9 个确认问题（FR-001/002/003/007/014/015/016/017/018），2 个优化候选 |
| Server / Security | Auth、Origin/Cookie、HTTP、RPC、代理配置、导入导出、日志、Extension Manager | 4 个确认问题（FR-004/005/009/010），1 个 ZIP 优化候选 |
| Runtime / Data / Extensions | Application mutation、State、Agent/Narrative、Document/Changeset、Data Engine、各领域 Store、Extension Host | 6 个确认问题（FR-004/008/011/012/013/019，FR-004 为跨层问题），1 个分页优化候选；未复报已显式 deferred 的 GC/迁移事项 |
| Quality / Supply Chain | package scripts、Vitest、TypeScript、ESLint、build、测试、依赖与文档 | 1 个综合门禁问题，2 个优化候选 |

执行结果：

```text
pnpm build
  PASS

pnpm lint
  FAIL: 17 errors / 5 source files

CI=1 pnpm test
  FAIL: 118 passed, 1 failed test file
        533 passed, 1 failed test case

CI=1 pnpm exec vitest run tests/integration/studio-server/logging.test.ts
  FAIL: same assertion reproduced in isolation

pnpm exec tsc -p tests/tsconfig.json
  FAIL: 60 TypeScript errors / 27 test files

pnpm --filter @loom-studio/application-runtime test
pnpm --filter @loom-studio/asset-store test
  FALSE GREEN: no test files found, exit code 0

主审追加执行的定向测试
  PASS: 3 test files / 12 tests
        network-settings, rpc-summary, application-session-auth

主审只读/临时探针
  CONFIRMED: State JSON Pointer 与 Timeline Binding 可污染 Object.prototype
  CONFIRMED: 错误 Origin + session Cookie + text/plain 可执行 /rpc mutation
  CONFIRMED: proxy URL userinfo 被持久化、回显并保留在 RPC sanitizer 输出
  CONFIRMED: AgentProfile 删除与 Session 创建竞态可提交悬空引用
  CONFIRMED: InMemory transaction 回滚可抹掉并发成功 Changeset

pnpm audit --prod --audit-level low
  REPORT: 3 high / 1 moderate / 1 low
          all traced to Vite/PostCSS/nanoid/esbuild build tooling
```

子智能体额外执行的定向检查：Backend 相关 3 文件 / 22 用例通过；Client 31 文件 / 98 用例通过并完成 Client build；Quality 相关 3 文件 / 17 用例通过。这些通过项只证明相邻基线没有回归，不覆盖上述失败断言或关闭条件。

## 建议处理顺序

后续由[统一施工顺序](./audit-remediation-decisions-and-order.md) 接管，不再按本文件旧基线直接施工。

1. 先复核当前源码、并行修改归属与实际消费链；若 FR-008/009/010/013 等高影响边界问题仍成立，优先处理，不因为行号已迁移就忽略。
2. FR-001/003/014/015/017 与前端专项合并施工，公共失败语义先于表单状态与编辑冲突；FR-018 与底层分页链联合验证。
3. FR-012 按允许失效引用的新目标处理，不新增强引用管理器；FR-011 交由当前 Agent 工作核对，不恢复旧合同。
4. FR-005/006/007/016/019 与剩余质量、交互项按实际风险和依赖进入相关批次；不将原审阅的检查结果当作当前红灯或通过证据。
