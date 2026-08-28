# LoomStudio 全仓代码审阅（2026-08-27）

> **状态**：Open Issues
> **审阅基线**：`main` / `7e69867978b1543e0ddea51ecc22b5cb542ab9d7` + 2026-08-27 当前未提交工作树快照
> **审阅方式**：3 个 `gpt-5.6-luna / high` 子智能体分域初审与第二轮去重增量审计，主智能体按当前源码、正式架构文档、生产调用链、反证与定向检查复核
> **修改边界**：本轮只新增本 Issue 并更新 Issues 索引；不修改源码、测试、配置、依赖或已有未提交工作

## 结论摘要

本轮覆盖 Studio Client、Studio Server、Application Runtime、Kernel、数据与持久化 Store、Extension Host、导入导出、认证/RPC、测试与构建门禁、依赖和文档一致性。两轮去重审阅最终纳入 **2 个 P1、14 个 P2、3 个 P3、6 个优化候选**；未发现 P0。

| 编号 | 级别 | 结论 |
| --- | --- | --- |
| FR-001 | P1 | Client 统一异步封装吞掉异常，使失败 mutation 被调用方当成成功 |
| FR-002 | P2 | Panel 与搜索条件只单向读取 URL，Router/Zustand 形成双源状态 |
| FR-003 | P2 | 快速切换 Card 时旧 Timeline 请求可覆盖新 Card 状态 |
| FR-004 | P2 | Provider / Agent Profile 与 Agent Tool 写操作丢失 RPC 调用上下文 |
| FR-005 | P2 | `/rpc` JSON 请求体没有累计大小上限 |
| FR-006 | P2 | 测试与质量门禁存在假绿和契约漂移，当前根检查也未收口 |
| FR-007 | P2 | 新 State / Text Transform UI 未完成 i18n 与 accessible-name 合同 |
| FR-008 | P1 | State 路径与 Binding 可污染进程级 `Object.prototype` |
| FR-009 | P2 | 受保护 HTTP 入口缺少 Origin 校验，可被 loopback 跨端口同站 CSRF |
| FR-010 | P2 | 手动代理 URL 的 userinfo 凭据被明文持久化、回显并写入日志 |
| FR-011 | P2 | Agent Transcript 与 Narrative 提交不满足同 Changeset 原子性合同 |
| FR-012 | P2 | 跨 Store 引用检查与写入存在 TOCTOU，可产生悬空引用 |
| FR-013 | P2 | Extension Document ownership 检查与条件写入非原子 |
| FR-014 | P2 | State / Text Transform 面板缺少 source-scoped 请求代际守卫 |
| FR-015 | P2 | Context Asset 串行队列仍会用旧完整快照覆盖连续成功编辑 |
| FR-016 | P2 | 远程 Card 导入在无可信长度时先完整消费响应体 |
| FR-017 | P3 | Prompt Resource 旧列表响应可覆盖 mutation 后的新列表 |
| FR-018 | P3 | Provider / Agent Profile 客户端丢弃 100 条后的分页结果 |
| FR-019 | P3 | InMemory DocumentStore 失败回滚可抹掉并发成功写入 |

## 已确认问题

### FR-001 · P1 · Client 异步封装吞掉异常，失败 mutation 被当成成功

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

### FR-002 · P2 · Panel 与搜索条件没有真正由 URL 驱动

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

统一拒绝 `__proto__`、`prototype`、`constructor` 危险 segment；所有路径读取改用 `Object.hasOwn()`；State 组合过程优先使用 null-prototype object，并审查 `deepMerge()`、点路径、JSON Pointer 与 Binding materialization 的同类赋值。补 RPC、Agent Tool、Global Definition 和 Timeline Binding 四条危险路径测试。

**关闭条件**：所有 State 入口都不能改变 `Object.prototype` 或读取继承属性；恶意路径返回稳定输入错误，正常 JSON Pointer / Binding 行为保持兼容。

### FR-009 · P2 · 受保护 HTTP 入口缺少 Origin 校验，可被 loopback 跨端口同站 CSRF

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

### FR-012 · P2 · 跨 Store 引用检查与写入存在 TOCTOU，可产生悬空引用

**最强复现链**

- `packages/application-runtime/src/runtime.ts:1028-1034`：`deleteAgentProfile()` 先查询 `hasSessionForProfile()`，再单独删除 Profile Document。
- `packages/application-runtime/src/runtime.ts:1037-1044`：`createAgentSession()` 先读取 Profile Document，再在 Agent Store 的另一条 transaction 创建 Session。
- Agent Store 与 Document Store 共享 SQLite，但 `agent_sessions.agent_profile_id` 无法对 Document Store 行建立 FK。

按“Create 已读 Profile → Delete 确认无 Session → Delete Profile → Create 提交 Session”顺序的探针得到：Session 创建成功、`agentProfileId` 仍指向已删除 Profile、后续 Turn 无法读取 Profile。

同根因还存在于 `deleteStateDefinition()` 对 Card 引用的事务外扫描、Provider Profile / Agent Profile、Portable Payload / Card 等跨 Store 或跨文档引用检查。单个写入的 optimistic version 不能保护另一侧关系在检查后发生变化。

**最小修复方向**

将引用存在性检查与目标写入/删除放进同一个共享 Data Engine transaction，并在 transaction 内重新读取权威关系；无法建立 SQL FK 的 Document 关系需要条件写入或显式 relation table。优先补 AgentProfile↔Session 与 StateDefinition↔Card 的 deferred 并发测试。

**关闭条件**：任何允许的并发顺序都不能提交悬空引用；冲突方收到稳定 conflict，不会把损坏状态留给后续请求发现。

### FR-013 · P2 · Extension Document ownership 检查与条件写入非原子

**证据位置**

- 正式合同：`docs/architecture/extensions/README.md:139-150` 规定 Extension 不能夺取其他 Package Document。
- `packages/extension-sdk/extension-host/src/index.ts:663-677`：Host 先 `get(id)` 检查 owner，再独立调用 `documents.write()`。
- `packages/extension-sdk/src/index.ts:176-183`：`ExtensionDocumentWriteInput` 仍允许显式 `id` 且 `expectedVersion` 可省略。
- `packages/document-store/src/changeset.ts:171-179`：未提供 `expectedVersion` 时，已有 Document 不触发 conflict。

**触发链与影响**

Package A、B 同时以相同显式 ID 创建各自已声明类型 → 两次 owner 检查都看到 Document 不存在 → A 先创建 → B 未带 `expectedVersion` 的 write 被当作普通 update → type 与 `ownerExtensionId` 改成 B。这样可以绕过 Host 声明的 ownership 边界，且后续 A 已无法访问自己的 Document。

**最小修复方向**

显式 ID 的创建必须传 `expectedVersion: 'new'`；更新必须要求 numeric version。更稳妥的是把 owner、type、version 检查和写入合并为一个底层条件 transaction，不能依赖事务外 preflight。

**关闭条件**：两个 Package 竞争同一 ID 时只有一个 create 成功，另一方稳定 conflict；任何路径都不能改变已有 Document 的 owner/type。

### FR-014 · P2 · State / Text Transform 面板缺少 source-scoped 请求代际守卫

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

`apps/studio-client/src/widgets/character-panel/character-panel.tsx:496-510` 只在可信 `Content-Length` 大于 128 MiB 时提前拒绝；Header 缺失或伪造时，`await response.blob()` 会先完整下载/消费响应体，之后才检查 `blob.size`。

攻击者控制且允许 CORS 的 HTTPS URL 可以造成远超限制的客户端下载和临时分配，极端情况下使页面失去响应或被浏览器终止。`https:`、`credentials: omit`、CORS 和 Server 后续 128 MiB 限制能降低其他风险，但不能保护 Client 消费阶段。

**最小修复方向**：使用 `response.body.getReader()` 分块累计实际字节数，超限立即 cancel；Content-Length 只作为快速拒绝。补 chunked、缺失/错误 Content-Length、多字节内容和 abort 测试。

**关闭条件**：实际接收字节超过上限时不再继续读取，也不会构造超限 Blob/File。

### FR-017 · P3 · Prompt Resource 旧列表响应可覆盖 mutation 后的新列表

- `apps/studio-client/src/app/use-studio-state.ts:93-102` 对任何 list 结果都直接覆盖 library，并同步重置 Context Asset nodes。
- 同文件 `116-127` 的 Bootstrap list 与 `214-228` 的 Create 后 list 可并发；`features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.tsx:51-58` 在 Bootstrap / mutation 期间仍允许 Create。
- 两次独立 HTTP 响应若按“旧快照 A 最后到达”排序，新 Resource 会从 UI 消失，当前 Context Asset draft 也可能被旧树重置。Server 权威数据仍存在，刷新可恢复，因此定为 P3。

**最小修复方向**：Prompt Resource refresh 使用统一 latest-wins 序号，或串行化 Bootstrap/mutation refresh；覆盖 library 前确认 response generation。补 A 旧、B 新、A 最后返回的测试。

### FR-018 · P3 · Provider / Agent Profile 客户端丢弃 100 条后的分页结果

- `packages/application-runtime/src/runtime.ts:793-804,836-847` 正确返回 `nextCursor`，底层默认页大小为 100。
- `apps/studio-client/src/features/provider-settings/model/use-provider-settings.ts:25-31` 与 `features/agent-profiles/model/use-agent-profiles.ts:19-37` 只请求一次并丢弃 cursor。
- Cards 已在 `features/cards/model/use-cards.ts:51-58` 循环消费全部页，可作为现有模式。

超过 100 个 Provider Profile 或 Agent Profile 后，后续实体在 UI 中不可见、不可选、不可维护；Server 数据未丢失，因此按规模边界定为 P3。

**最小修复方向**：像 Cards 一样按 cursor 聚合全部页，或把 UI 改成明确分页/虚拟列表。关闭条件为 101 条实体的客户端测试全部可达。

### FR-019 · P3 · InMemory DocumentStore 失败回滚可抹掉并发成功写入

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

### O-004 · Card Bundle ZIP 拒绝重复 entry

`apps/studio-server/src/card-bundle-zip.ts:99-145` 用 `Map` 收集 entry，重复路径由后项覆盖前项。当前没有签名或哈希验证合同，尚不足以认定安全绕过；建议把重复 entry 视为格式错误，为未来签名、审计和跨实现兼容消除歧义。

### O-005 · 启动与测试文档对齐当前实现

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

1. **立即处理 FR-008**：先封堵所有 State / Binding 入口的原型污染，并按关闭条件覆盖 RPC、Agent Tool、Definition 与 Timeline 四条链。
2. **随后收口高影响完整性与边界问题**：FR-001、FR-009、FR-011、FR-012、FR-013。它们分别影响失败语义、会话授权边界、跨领域提交和持久化引用完整性。
3. **再处理 Client 写错目标或丢编辑问题**：FR-003、FR-014、FR-015、FR-016、FR-017；其中 FR-014/015 应使用 deferred response / deferred RPC 测试验证真实乱序。
4. **并行修复其余 P2 与质量门禁**：FR-002、FR-004、FR-005、FR-006、FR-007、FR-010。FR-006 应先恢复现有红灯，再新增门禁。
5. **最后处理 P3 与优化项**：FR-018、FR-019、O-001～O-006；O-001/O-002 与 FR-007 的性能、滚动、键盘和读屏效果仍需要人工验收。
