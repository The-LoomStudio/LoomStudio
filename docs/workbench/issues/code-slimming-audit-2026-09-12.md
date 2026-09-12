# LoomStudio 代码瘦身与重复实现审计（2026-09-12）

> **状态**：Open Issues
> **审计基线**：`main` / `e7683f1cac7bc8d9a59de724f753a765942bd3e7` + 当前未提交工作树
> **目标**：找出真实的重复算法、职责重叠和无效依赖，减少维护面；不把“文件较长”本身当作问题

## 量化概览

当前 `apps/`、`packages/`、`official/`、`tests/`、`scripts/` 中的 TypeScript/JavaScript 源码约 **95,095 行**（不含 `dist/`、`node_modules/` 与其他生成目录）。代码集中在少数聚合点：`application-runtime` 最大单文件约 1580 行，`sessions-panel.tsx` 约 1389 行，多个运行时、工作台和服务入口超过 800 行。

这说明首要目标不是机械拆文件，而是删除或合并重复的行为实现。以下问题均有当前调用链或源码重合证据。

按目录聚合后，Client `features/` 约 11,354 行、`widgets/` 约 7,704 行；Application Runtime 的 `runtime/` 约 5,384 行、`agents/` 约 3,570 行、`cards/` 约 1,518 行、`state/` 约 1,303 行。也就是说，前端业务层和 Application Runtime 是主要复杂度中心，应优先处理其中的重复流程与宽接口，而不是平均分配重构资源。

## 已确认问题

### SHR-001 · P1 · Prompt 编译器存在两套高度重复的 DFS 与挂载实现

`packages/application-runtime/src/prompt/prompt-build-pipeline.ts:35-180` 与同文件约 `:200-280` 分别实现 `childrenByParent` 遍历、Entry/Virtual 节点处理、Contribution 挂载，以及 `@setting.lower`、`@chat.session.post` fallback。

两条路径只在最终输出形态和角色处理上略有差异，但核心分支重复维护。修改挂载顺序、fallback 或空内容规则时，容易只修一条路径，导致不同 Prompt 构建入口产生不一致结果；重复排序和扫描也增加运行成本。

最小精简方向：抽出一个只负责按树顺序产出 `PromptFragment` 的内部遍历，消息模式与非消息模式只保留最终聚合差异。统一 fallback 和排序位置，不引入新的公共抽象。

### SHR-002 · P1 · Extension 导入为四类资源复制维护相同的版本与墓碑逻辑

`packages/application-runtime/src/runtime/extensions-runtime.ts:498-590` 对 Prompt Resource、Agent Tool、Text Transform Rule、Text Extractor 分别执行来源匹配、版本检查、ID 冲突、墓碑恢复和已有资源收集。

这些循环结构高度同构，却分别维护不同的 Map/Set、错误文本和恢复变量。新增资源类型时需要复制整段流程；任一类别漏掉版本或墓碑处理，就会产生类别间不一致。

最小精简方向：统一按 extension origin 建立索引、校验 package/version、解析 active/tombstoned 状态；保留每种资源的解析与写入差异，使用少量泛型或明确适配器，避免无类型通用对象。

### SHR-003 · P2 · Card Bundle 校验与归一化各自实现一套字段协议

`packages/application-runtime/src/cards/workspace.ts:909-1299` 维护多组字符串、可选字符串、字符串数组、对象结构和递归资源节点断言；`packages/application-runtime/src/cards/card.ts:46-84` 的归一化路径又实现相近字段规则。

同一 Bundle 数据经过两套手写解释器。字段新增或删除时，可能出现“校验通过但归一化丢失”或“归一化接受但导入拒绝”的维护分叉。

最小精简方向：把共享字段级解析/读取收敛到一个协议模块；导入负责严格拒绝，归一化只负责兼容旧字段，二者共享底层字段规则。

### SHR-004 · P2 · SessionsPanel 在组件层重复编排已有模型层职责

`apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx:104-230` 在组件内编排排序、Session 合并、Timeline/Standalone 分区、搜索过滤、展开和多组选中；`apps/studio-client/src/widgets/sessions-panel/sessions-panel-model.ts:1-180` 已提供排序、筛选和选择工具。

展示规则分散在 JSX 容器与 model 文件之间，后续增加筛选或排序时需要同时修改两个层级；这也会放大既有 Session 多状态源和异步失败问题。

最小精简方向：把 `allSessions` 合并、分区和可见 ID 计算收敛到现有 `sessions-panel-model.ts`，组件只保留 React 状态和事件回调。不新增 manager 或额外 hook。

## 依赖精简候选

通过 manifest 与源码 import 对照，发现：

- `packages/application-runtime/package.json:27` 的 `@loom/core` 当前由 README 和源码证据表明未被该包使用；应在确认 TypeScript 构建 reference 后移除。
- `apps/studio-client/package.json` 中 `@dnd-kit/sortable`、`diff`、`clsx` 未发现 Client 源码或 Vite 配置引用；`typescript` 也不被源码运行时消费，属于构建工具，当前却放在 `dependencies`，应迁移到 `devDependencies`。`@dnd-kit/utilities` 虽无直接 import，但同时是 `@dnd-kit/core` 的传递依赖，不能按独立孤儿依赖删除；`@vitejs/plugin-react` 有 `vite.config.ts` 明确引用，也不属于孤儿依赖。`sass` 已位于 `devDependencies`，不属于此次误报。
- `apps/playground/package.json` 声明的 workspace 依赖明显多于 `apps/playground/src/index.ts` 的运行时 import；但其中部分依赖同时出现在 `apps/playground/tsconfig.json` 的 project references 中，不能仅按源码入口删除，应先区分构建图依赖与运行时依赖。

精确复核结果：按各包 `src/` 工作目录重新扫描后，源码层未引用候选收敛为 Playground 的 `@loom-studio/shared`、`@loom-studio/transport`、`@loom-studio/application-runtime`，Client 的 `@dnd-kit/sortable`、`clsx`、`diff`，以及 Application Runtime 的 `@loom/core`。进一步核对发现 Playground 的候选仍被 `tsconfig.json` project references 使用，因此暂降级为“构建图精简候选”；`@dnd-kit/utilities`、`@vitejs/plugin-react` 已有传递或配置入口证据，不列为删除候选。

这些候选不应直接自动删除：动态 import、构建插件和类型配置可能不经过普通源码 import 扫描。完成复核后再改 manifest 和 lockfile。

`pnpm audit --prod --audit-level low` 于 2026-09-12 退出码为 **1**，当前结果为 1 个 low：`esbuild@0.28.0`，经 Vite、`@vitejs/plugin-react@6.1.1` 和 `tsx@4.23.13` 的 **4 条依赖路径**进入；公告描述为 Windows development server 的任意文件读取，修复版本为 `>=0.28.1`。当前没有证据证明该构建工具进入浏览器生产运行时，因此不单独升级为产品安全缺陷；但应在工具链升级时一并收口。

## 模块复杂度补充

对 365 个 TS/TSX 文件建立相对 import 图，共得到 1018 条边。高 fan-in 入口包括 `apps/studio-client/src/entities/index.ts`（56 个调用者）、`apps/studio-client/src/shared/i18n/index.ts`（47 个调用者）和 `packages/application-runtime/src/types.ts`（28 个调用者）；高 fan-out 入口包括 `packages/application-runtime/src/index.ts`（35 条边）、`apps/studio-client/src/app/app.tsx`（33 条边）和 `apps/studio-server/src/main.ts`（19 条边）。

静态图发现 10 个循环候选，但逐项核对后，主要由 `import type` 和 barrel re-export 形成，不能直接认定为运行时循环缺陷。它们仍然说明公共类型桶和聚合导出承担了过多依赖传播，后续可按领域拆分 type entrypoint，减少无关模块被迫重新编译和理解的范围。

该项暂列为结构优化观察，不升级为缺陷：当前没有证据表明这些类型环已经导致运行时初始化错误或构建失败。

## 追加精简候选

### SHR-005 · P3 · Legacy 兼容字段仍深入核心运行路径，扩大每次协议修改的分支面

当前 legacy 处理分散在多个核心模块：`packages/application-runtime/src/cards/card.ts:46-83` 继续把旧 Card 字段映射到新模型；`packages/application-runtime/src/prompt/prompt-resource-mapper.ts:15-87` 保留旧节点字段集合；`apps/studio-client/src/pages/studio/model/studio-layout-store.ts:358-382` 继续读取旧 Panel ID；`apps/studio-client/src/widgets/model-panel/model-panel.tsx:69,155` 继续维护旧 Provider ID 集合。

这些路径不一定都能立即删除，但它们已经不再是边缘导入适配，而是进入正常读取、布局恢复和模型展示路径。结果是新协议每次修改都要同时考虑旧字段、旧 ID 和新字段，增加分支和认知负担，也让“迁移是否完成”无法从目录结构判断。

最小精简方向：把仍需支持的兼容逻辑集中到明确的 import/migration boundary；对已完成迁移的旧字段建立一次性清理策略。不要在各业务读取函数中继续添加新的 legacy 分支。

### SHR-006 · P3 · 三处本地配置原子写入重复实现，错误语义和清理策略可能漂移

`apps/studio-server/src/platform/network-settings.ts:62-67`、`apps/studio-server/src/extensions/extension-sources.ts:193-201`、`apps/studio-server/src/extensions/extension-state-store.ts:164-172` 都独立实现“写入 `.tmp` → rename → 失败时 unlink”的流程。

这不是单纯代码风格重复：临时文件命名、权限、异常清理和 rename 失败语义由三处分别决定。后续修复磁盘写入失败、Windows rename 或权限问题时，容易只更新一处。

最小精简方向：在 Server platform 层提供一个很薄的 `writeJsonAtomically` helper，参数只包含文件路径、序列化内容和权限；调用方保留各自的 schema/业务校验，不新增通用存储抽象。

### SHR-007 · P3 · 跨 Runtime 与 Store 重复手写分页聚合循环

当前至少十处实现相同的 `do/while` 分页骨架，例如 `packages/application-runtime/src/foundation/document-store.ts:16-21`、`runtime/cards-runtime.ts:267-274,515-519`、`runtime/transforms-runtime.ts:394-411`、`runtime/extensions-runtime.ts:277-292`，以及客户端 `use-cards.ts:60-64`、`use-narrative-runtime.ts:84-100`。

这些循环分别查询不同领域，不能简单合并查询接口；但 cursor 初始化、page 累加、nextCursor 终止和 limit 选择由每个调用点复制维护。未来某个 Store 改变 cursor 语义或返回空页时，容易出现某条链漏页、重复页或无限循环。

最小精简方向：在已有调用层增加一个类型安全的 `collectPages(fetchPage)` 小工具，统一分页骨架，仍由调用方提供查询函数和领域结果合并逻辑。若不愿新增 helper，至少统一分页契约并集中约束 `limit`，不要在每个 Runtime 方法中继续复制循环。

### SHR-008 · P2 · Application Runtime barrel 与 Studio API 形成过宽的公共聚合面

`packages/application-runtime/src/index.ts` 汇总导出约 35 组内部能力，其中还包含 `export type * from './types.js'`；`apps/studio-client/src/shared/api/studio-api.ts` 达到约 717 行，集中声明并实现 Cards、Agents、Providers、Prompt Resources、State、Scripts、Transforms、Directories、Logs 等多个领域的 RPC facade。

这两个入口把大量不相关能力绑定到同一个 import surface。调用者只需要一个领域类型，也会依赖整个聚合模块；任何公共类型变化都会扩大编译和理解范围。更严重的是，Runtime 的内部模块已经按领域拆分，但 barrel 又把它们重新合并成一个宽接口，削弱了拆分收益。

最小精简方向：按领域提供明确的 type/runtime entrypoint，逐步让 Client API 按领域拆成已有 feature 所需的窄 facade；保留一个兼容聚合入口，但禁止新代码继续从宽 barrel 引入。不要一次性破坏现有公共导出。

### SHR-009 · P2 · JSON 守卫与 RPC 参数读取器在多个边界重复实现

基础 JSON 守卫分散在 `packages/shared/src/index.ts:90`、`packages/application-runtime/src/foundation/json.ts:3`、`packages/kernel/src/handlers.ts:249`、`packages/extension-sdk/extension-host/src/manifest.ts:290` 及多个 Runtime 文件；RPC 参数读取则同时存在于 `apps/studio-server/src/rpc/rpc-params.ts:3-75` 和多个 application handler 的本地函数中。

这些实现大多只差返回类型或错误文本，导致同一类输入在不同 RPC 入口的拒绝条件和错误语义逐渐分叉。它也让新 handler 继续复制几十行参数读取代码，直接增加仓库体量。

最小精简方向：在 `shared` 提供无业务含义的 JSON 基础守卫；在 Server RPC 层统一复用带稳定错误语义的参数读取器。Store 行解析器和带领域约束的 Bundle 校验仍保留在各自模块，不要为了“统一”把数据库 schema 校验塞进 shared。

### SHR-010 · P3 · 两个源码文件已脱离当前模块图，仍占据维护和搜索空间

基于当前源码文件的相对 import 图，人工复核后确认：

- `apps/studio-client/src/features/context-assets/ui/projection-order-editor/projection-order-editor.tsx`（24 行）没有生产代码或测试引用。
- `packages/application-runtime/src/runtime.ts`（1 行）仅重新导出 `./runtime/runtime.js`，但 package `exports` 指向 `./dist/index.js`，当前源码没有引用它。

另两个“无源码引用”候选被排除：`artifact-slot-host.tsx` 有专门的单元测试，可能是测试/预览入口；`packages/logging/src/node.ts` 通过 `@loom-studio/logging/node` subpath 被 Server 和测试直接消费。

最小精简方向：确认 `projection-order-editor` 是否已被新 projection workbench 取代；确认 `runtime.ts` 是否仍被外部脚本或文档引用。若无正式入口，删除文件和对应测试/文档引用，避免保留幽灵模块。

### SHR-011 · P3 · Context Menu 与 Dropdown Menu 重复维护同一套 Item UI 行为

`apps/studio-client/src/shared/ui/context-menu/context-menu.tsx:111-180` 与 `apps/studio-client/src/shared/ui/dropdown-menu/dropdown-menu.tsx:32-105` 几乎逐字重复 Item、Separator、Shortcut 和 SubTrigger 的 class 组合、icon leading slot、danger/inset 处理与 label 包装。

两者底层 Radix primitive 不同，不能直接把整个组件替换成一个不透明的通用组件；但当前重复意味着 icon spacing、危险色和子菜单触发器修复需要同步修改两处。

最小精简方向：共享无 Radix 依赖的菜单 item class/leading-label 结构和样式 token，或抽出极薄的内部渲染 helper；保留 Context Menu/Dropdown Menu 各自的 primitive wrapper 与类型。

### SHR-012 · P2 · Client entities 与 Runtime/Store 重复定义同一组 RPC DTO

`apps/studio-client/src/entities/card.ts:34-126`、`entities/narrative.ts:3-78`、`entities/provider.ts:40-120`、`entities/agent.ts:20-101` 分别定义 Card、Narrative、Provider、Agent 的实体和结果类型；`packages/application-runtime/src/types.ts:284-1480` 又定义了大部分同名或同结构的 RPC DTO，底层 Store 还重复定义实体类型。

这已经超出合理的“前端投影”：创建、列表、更新和删除结果的字段大多相同，Client 通过 `studio-api.ts:512-714` 再逐项手写类型绑定，并频繁使用 `as unknown as ClientJsonValue`。字段增加、分页、mutation receipt 或错误结果改变时，需要同步维护多处协议，造成类型漂移和大量胶水代码。

量化核对显示：Client `entities/` 导出的 143 个类型中，有 **60 个**与 `packages/application-runtime/src/types.ts` 的 213 个导出类型同名；`studio-api.ts` 出现 **72 处** `as unknown as ClientJsonValue`，Client API、Server RPC 与 Kernel 边界合计约 **188 处** `as unknown as JsonValue/ClientJsonValue`。重名本身不证明每个类型都应合并，但与大量断言叠加后，足以确认这是系统性跨层重复和协议类型逃逸，而不是个别 DTO 的合理投影。

最小精简方向：确定一个 transport/application DTO 权威来源，Client entities 只保留真正的 UI 派生类型；API facade 直接复用按领域拆分的 DTO 类型。对于确实不同的 Store 内部类型，使用明确的 mapper，不要继续复制整套公共结果类型。

### SHR-013 · P2 · Extension Runtime 暴露任意 RPC method，绕过领域 API 和类型边界

`apps/studio-client/src/shared/api/studio-api.ts:544-547` 暴露 `extensionRuntime.call(method, params)`，方法名和参数均为任意字符串/JSON；`apps/studio-client/src/features/extension-renderers/model/use-client-extension-runtime.ts:26-28` 又以 `params as never` 调用它。当前源码中该入口由扩展渲染器使用，因此不是无调用者的死代码，但它绕过了 `StudioApi` 中所有按领域定义的 RPC 方法。

Server/Extension Host 当前确实会检查 RPC 是否已注册、是否由扩展声明，因此本项不是“未注册 RPC 可直接执行”的安全越权。真实问题在 Client 侧：新增或改变 Server method 时，TypeScript 不会提示受影响的扩展调用；调用者也无法从类型上证明 method 属于当前扩展、已授权 namespace 或允许的参数形状。它与 `SHR-012` 的宽 facade 叠加，削弱了 DTO 收敛的收益。

最小修复方向：为扩展 RPC 绑定明确的 extension namespace/capability 校验，并让 method 参数至少通过按 namespace 的类型映射；若正式合同必须允许动态方法，也应把它隔离到 extension-only API，不要让普通 Client 业务代码可见。

### SHR-014 · 已撤回 · 构建产物混入本次统计，不是已证实的仓库缺陷

当前工作树包含多个未跟踪但被 `.gitignore` 忽略的 `dist/` 目录。此前一次历史统计曾得到源码约 **95,068 行**、`dist/` 约 **81,674 行**；该段数字仅用于说明统计口径，不能作为当前精确基线，也不构成仓库缺陷证据。典型重复包括 `packages/application-runtime/src/types.ts` 与其 `dist/types.d.ts`、Client 源码与 `dist` 编译文件，以及 Server 的源码与 `dist` JavaScript。

这些产物没有被 Git 跟踪，并已由 `.gitignore` 排除。本次使用的临时 `find` 命令没有排除生成目录，不能据此认定项目工具或 IDE 存在索引缺陷；也没有查到项目自身审计命令被污染的证据。因此撤回此前 P2 判定，仅保留统计口径说明。源码数字仅包含 TS/TSX/JS/JSX，而上述生成目录数字包含所有文件，二者不能直接用来计算代码膨胀比例。

后续审计命令必须明确文件扩展名及排除目录；不要求仓库新增审计框架，不改变构建产物策略。

### SHR-015 · 合并至 SHR-008/SHR-012 · Runtime 类型聚合补充证据

`packages/application-runtime/src/types.ts` 当前约 **1,580 行**，从 `ApplicationRuntime`、RPC 输入/结果，到 State、Card、Provider、AI Gateway、Agent、Prompt Resource、Extension、Storage 等多个领域全部集中在同一文件；`packages/application-runtime/src/index.ts` 又同时导出这些类型、运行时工厂、解析器、工具注册表和内部构造函数。这个文件不只是“公共类型入口”，实际上还承担了跨领域的内部依赖总线。

以上是 SHR-008 公共聚合面及 SHR-012 DTO 重复的补充证据，不另计一个独立缺陷。尚未测量增量编译影响，也没有证据证明 Client 复制 DTO 的动机是避免该入口；不能把这两项推测当成事实。行数和断言数量用于定位维护热点，不单独证明架构失效。

最小精简方向：按 Card、Narrative/Session、Prompt Resource、State、Provider/AI、Extension 等领域拆分 transport/application contract；把 Store 内部类型和 Runtime wiring 类型留在包内私有模块，公共入口只导出跨边界必需的 DTO 与服务接口。拆分过程中优先让 Client/API 复用领域合同，不要求一次性重写全部调用方。

### SHR-016 · 合并至 SHR-009 · RPC 参数读取重复的补充证据

Server 已有 `apps/studio-server/src/rpc/rpc-params.ts`，提供 `readString`、`readNumber`、`readBoolean`、可选值、对象和字符串记录等基础读取器；但 `handlers/application/loom-scripts.ts` 又实现自己的 `readOptionalObject`、`readBoolean`、`readStringArray`、`readOptionalString`，`providers.ts` 和 `portable-payloads.ts` 分别实现专用数组/record 读取器，`states.ts` 则维护另一套 State 专用对象解析。`studio-rpc-router.ts` 还重复定义 `readOptionalBoolean` 和 `readRequiredString`。

领域专用解析本身是合理的，重复 primitive 读取归入 SHR-009，不另立重复 Issue。Router 的 `readOptionalBoolean` 对非法值返回 `undefined`，公共 helper 会抛错，但同一删除请求随后仍进入 Cards handler 并接受公共读取器校验；尚不能据此断言请求最终被静默接受。可确认的问题是基础读取逻辑重复，而非已复现的输入校验绕过。

最小精简方向：保留 State、Card、Extension 等真正的领域解码器，但把 primitive/数组/record 的读取语义统一到一个底层模块；明确“缺失可选”和“存在但类型错误”的区别，禁止 Router 私自静默降级。领域解码器只负责组合与联合类型判断，不再复制基础类型检查。

### SHR-017 · 优化观察 · Application RPC 顺序试探式分发

`apps/studio-server/src/rpc/handlers/application/index.ts` 对每次 Application RPC 调用依次执行最多 **10 个**领域 handler；每个 handler 内部再对完整 method 字符串执行一次 `switch`，未命中返回 `undefined`，由下一个 handler 继续尝试。当前路由总量不大，尚无证据表明它已经造成实际性能瓶颈，因此不升级为运行时缺陷。

但该结构复制了 10 份“匹配/未命中/继续”的控制流，并把路由唯一性变成隐式约定：如果两个领域未来误收同一个 method，前面的 handler 会静默取得优先权；新增 RPC 还必须手工记住在入口注册对应 handler。它与 `studio-rpc-router.ts` 外层 namespace 路由叠加后，形成两级线性试探。

最小精简方向：保留领域文件的局部组织，但在应用 RPC 入口建立一次性的 `method -> handler` 注册表，或按 method namespace 直接选择领域 handler；注册阶段检测重复 method，调用阶段只执行一次目标 handler。不要为了这项优化引入通用依赖注入容器或复杂路由框架。

### SHR-018 · 优化观察 · Extension SDK 公共合同集中维护

`packages/extension-sdk/src/index.ts` 当前为 **793 行**，集中定义事件、Renderer/沙箱消息、Client/Server 扩展上下文、RPC、Document/Storage/State、AI、贡献和 Manifest 合同。此前按固定行区间估算的领域导出数量并非语义分类结果，撤回这些分组数字。

公共 SDK 集中提供合同可以是合理设计，类型 re-export 也不等于复制定义。未发现该入口导致的运行时循环、已测量的编译退化或具体合同错误，故降为优化观察，不维持此前 P2 判定。

最小精简方向：按 `events`、`renderer/sandbox`、`rpc/storage`、`state`、`ai/tools`、`manifest/contributions` 拆成内部模块，并在 `package.json` 增加少量稳定 subpath exports；根入口只保留最常用且稳定的类型。宿主内部实现应依赖具体域入口，避免继续从 SDK 总桶获取无关类型。

### SHR-019 · P2 · Client App 顶层组件承担状态编排、面板注册与业务接线

`apps/studio-client/src/app/app.tsx` 当前为 **784 行**，同时负责调用 `useStudioState`、维护多个局部 UI 状态、计算导航/忙碌状态、创建 Extension Renderer host、注册全部 Studio panels。TypeScript AST 实测 `StudioPage` JSX 直接属性为 **35 个**，无 spread 属性；此前约 70 个的估算错误，已撤回。`panels` 映射还包含面板构造、路由跳转和状态变更。

这使顶层组件成为前端的隐式依赖总线：任一面板新增一个动作，都需要修改 App 的状态选择、props 转接和 panel registry；状态所有权分散在 `useStudioState`、App 局部 state 与各 panel model 之间，导致 `SessionsPanel` 等组件继续膨胀。当前没有证据表明需要引入全局状态库或容器，因此问题是职责集中和 prop drilling，而不是缺少框架。

最小精简方向：按稳定边界拆出面板注册/导航组合层、Agent/Session 组合层和资源/编辑器组合层；让领域容器直接消费领域 API/model，App 只保留生命周期、全局布局和跨面板导航。拆分时保持现有 UI 行为，不新增状态管理框架。

### SHR-020 · P2 · useStudioState 将多个领域状态和副作用压缩成单一全局 hook

`apps/studio-client/src/app/use-studio-state.ts` 当前为 **632 行**，在一个 hook 内同时创建 Bridge/API、翻译器、异步操作、编辑历史、Cards、Context Assets、Provider Settings、Agent Profiles、Narrative Runtime，并维护 Prompt Resources、Mounts、宏预览、Activation Control 等额外状态。TypeScript AST 实测最终返回对象为 **163 个属性**；调用的项目自定义 hook 共 **7 个**，不含 React 自带 hook。此前约 100 个字段及 9 个领域 hook 的估算已撤回。

该 hook 直接声明 **6 个**以 `refresh` 开头的函数：资源库、Setting Mounts、Preset Tool Mounts、Macros、States、History Anchor。Official Content 安装同时刷新多个资源库和 Agent Profiles，是可确认的跨域编排实例；集中编排是否需要拆分还应按具体修改成本判断，不能仅因刷新函数数量认定状态所有权缺失。

最小精简方向：保留单一 API/Bridge 初始化入口，将 Cards、Prompt Resources/Context Assets、Provider/Agent、Narrative/Session、Macro/Prompt Build 分成领域容器 hook；跨领域刷新通过明确的事件或窄回调连接，不再依赖一个巨型返回对象。不要引入新的全局状态框架，也不要把每个 `useState` 机械拆成文件。

## 死代码证据

定向执行 `pnpm exec eslint apps/studio-client/src apps/studio-server/src packages/application-runtime/src packages/shared/src` 得到 **56 个错误**。其中大量是可直接删除的未使用 import、变量和 helper，而不是需要设计决策的风格问题，代表当前代码已经出现明显的实现残留：

- Client 多个工作台、页面和 `SessionsPanel` 存在未使用的图标、导航值、状态 setter、过滤 helper 与常量。
- Server 的 Card Bundle 与 Workspace handler 存在未使用局部值和 helper。
- Application Runtime 存在未使用的 `TimelineArchiveParticipant`、类型导入、比较 helper 以及多个未使用参数。
- 另有 5 个 `preserve-caught-error` 和 2 个空 block，属于错误上下文丢失或无意义分支，需在删除死代码时一并确认。

这批问题已被旧审查的 FR-006 作为“lint 门禁失败”覆盖，本节只补充其对代码瘦身的含义：应先清理确定无调用者的残留，再判断剩余 lint 是否揭示真实契约问题。不能用自动 `eslint --fix` 替代逐项确认，因为部分未使用参数可能说明调用契约本身已经过时。

测试侧的类型检查也未形成可靠合同：`pnpm exec tsc -p tests/tsconfig.json --noEmit` 于 2026-09-12 退出码为 **2**，输出 338 行、可计数为 **197 个 TypeScript 错误**。除大量缺失 SCSS/`ImportMeta.env` 声明外，还存在测试引用不存在的 `@loom-studio/ai-gateway`、已移除的 Runtime 导出、缺失必填字段、旧 `AssetViewMode` 值以及同步/异步事务签名不一致等问题。这说明测试目录与当前公共类型、包导出和运行时合同已经明显漂移；它不是单纯的测试覆盖率问题，也不应通过放宽 `tsconfig` 或批量 `as any` 来掩盖。

## 结构排除结论

package 级依赖扫描结果：29 个 workspace、93 条内部依赖边、0 个 package cycle。当前没有证据支持“workspace package 循环依赖”这一问题，不列为 issue。

## 不纳入

- 单纯按文件行数拆分，不自动视为代码瘦身。
- 普通 `useMemo`、循环或 CSS 重复，没有证明维护或运行影响的不单独立项。
- 2026-09-12 前一份审查中的 SEP-001～SEP-009，以及 2026-08-27 的 FR 系列不重复登记。

## 验证记录

- 工具量化：统计源码行数、最大文件、函数与 React 状态调用密度。
- 依赖检查：对 workspace manifest 与 TypeScript/JavaScript import 做静态候选比对。
- 子代理只读审计：Prompt 编译、Extension 导入、Card Bundle、SessionsPanel 四个范围。
- 测试类型检查：`pnpm exec tsc -p tests/tsconfig.json --noEmit` → FAIL（退出码 2，197 个错误，338 行输出）；该结果补充说明测试合同漂移，但不新增独立 Issue。
- Workspace 检查：`pnpm run check:workspace` → BLOCKED（退出码 1）；仓库要求 Node `22.18.0`，当前环境为 `26.8.2`，该结果属于环境版本不匹配，不作为源码缺陷证据。
- 尚未运行完整重构验证；安全审计工具已启动但尚未完成，结果不在本文件中冒充通过。

## 可执行实施方案

### Thought

这不是一次“按行数砍代码”的重写，而是沿着现有边界，把重复的行为实现收敛为一个权威来源。实施顺序按风险和依赖安排：先做无行为变化的盘点与清理，再处理协议重复，最后处理前端状态所有权。任何涉及持久化格式、公共导出、RPC method、用户可见顺序或状态生命周期的变化，都必须停在兼容迁移边界内，不能直接用一次大提交替代。

### 非目标与不变约束

- 不修改业务功能、持久化格式、RPC method 名称和用户可见排序语义。
- 不引入新的状态管理框架、依赖注入容器、通用存储层或新的大型工具包。
- 不以 `eslint --fix`、批量删除或 `as any` 掩盖未确认的契约问题。
- 不在同一批次同时重构 Prompt、Extension、DTO 和前端全局状态；每批次保持可回滚、可定位。

### 实施批次

#### Batch 0：建立基线与调用清单

**定位**：本文件的 SHR-001～SHR-020；重点入口为 `prompt-build-pipeline.ts`、`extensions-runtime.ts`、`workspace.ts`/`card.ts`、`sessions-panel.tsx`、`studio-api.ts`、`app.tsx` 和 `use-studio-state.ts`。

**实现**：

1. 为每个准备实施的 issue 列出生产引用、测试引用、动态 import、package exports 和文档引用。
2. 为 Prompt、Extension、Card Bundle 记录现有输入到输出的行为样本，尤其是顺序、fallback、墓碑和旧字段。
3. 将确认无引用的依赖或文件单独列出，未完成复核的候选不得进入删除提交。

**验证**：

- `rg`/TypeScript import 图与 package exports 复核通过；
- 基线命令及其失败原因记录在对应 issue；
- 任何“待确认”项都明确标注 owner 和停止条件。

#### Batch 1：低风险清理与基础工具收敛

**范围**：SHR-005、SHR-006、SHR-007、SHR-009、SHR-010、SHR-011，以及确认无引用后的依赖候选。

**定位**：

- Server 原子 JSON 写入：`apps/studio-server/src/platform/network-settings.ts`、`extensions/extension-sources.ts`、`extensions/extension-state-store.ts`；
- 分页骨架：`packages/application-runtime/src/foundation/document-store.ts`、相关 Runtime 和 Client hooks；
- primitive JSON/RPC 读取：`packages/shared`、`apps/studio-server/src/rpc/rpc-params.ts` 及 handler；
- 菜单重复 UI：`context-menu.tsx`、`dropdown-menu.tsx`；
- 孤儿模块与 manifest：SHR-010 及“依赖精简候选”章节。

**实现**：

1. 只抽取无业务含义、参数明确的薄 helper；调用方继续拥有 schema、错误上下文和领域合并逻辑。
2. 兼容字段集中到 import/migration boundary，不改变正常读取结果。
3. 删除文件或依赖前完成动态入口、配置、测试和文档复核，并单独更新 lockfile。

**验证**：

- 相关包定向 typecheck；
- 相关 lint 文件无新增错误；
- 分页、原子写入、参数读取和菜单渲染的现有定向测试或最小 runnable check；
- 依赖删除后 workspace install/build graph 仍可解析。

#### Batch 2：收敛协议重复

**范围**：SHR-001、SHR-002、SHR-003。

**定位与实现**：

1. `prompt-build-pipeline.ts`：抽取单一树遍历，产出内部 `PromptFragment`；消息与非消息入口只保留最终聚合差异。先锁定现有 fallback、排序、空内容和角色行为，再删除重复 DFS。
2. `extensions-runtime.ts`：按 extension origin 建立索引，用明确的资源适配器复用版本、冲突和墓碑判定；资源解析与写入仍由各领域函数负责。
3. `workspace.ts`/`card.ts`：共享字段级读取规则；严格导入与旧字段归一化保持不同入口，禁止用宽松 parser 代替严格校验。

**验证**：

- 每个入口保留重构前后的代表性输入输出对照；
- 覆盖空树、重复 ID、版本冲突、墓碑恢复、旧字段和字段缺失；
- application-runtime 定向 typecheck、相关测试和最小构建；
- 不允许出现公共导出、持久化格式或 RPC method 的无意变化。

#### Batch 3：收窄公共合同与前端状态边界

**范围**：SHR-008、SHR-012、SHR-013、SHR-019、SHR-020；并吸收 SHR-015、SHR-016 的补充结论。

**实现顺序**：

1. 先按 Card、Narrative/Session、Prompt、State、Provider/AI、Extension 拆分内部 contract entrypoint。
2. 让 `studio-api.ts` 按领域复用 DTO；Client entities 只保留 UI 派生类型，确有差异时显式 mapper。
3. 为 Extension RPC 设定 namespace/capability 类型边界，保留动态扩展能力但隔离普通业务 API。
4. 拆出 App 的面板注册/导航组合层，再按领域拆 `useStudioState`；保持现有返回兼容入口，逐步迁移调用方。

**验证**：

- 先做调用方和导出兼容性检查，再逐批迁移；
- Client、Server、Application Runtime 定向 typecheck；
- 运行涉及资源安装、刷新、Session、Prompt、Extension 的定向测试；
- 对 `studio-api.ts` 的 `as unknown as ClientJsonValue` 数量和公共入口依赖做前后对比；
- 任一状态刷新链路、导航、面板挂载或扩展调用行为变化都应单独记录，不得用“编译通过”替代验收。

### Task List

- [ ] 建立 Batch 0 的调用、导出、动态入口和行为样本清单。
- [ ] 清理确认无引用的死代码、依赖和重复基础工具。
- [ ] 收敛原子写入、分页、primitive RPC 读取和菜单样式重复。
- [ ] 合并 Prompt 的重复 DFS，并完成顺序/fallback 对照验证。
- [ ] 合并 Extension 资源导入的公共冲突与墓碑流程。
- [ ] 统一 Card Bundle 共享字段规则，保留严格导入与兼容归一化差异。
- [ ] 拆分领域 contract，收窄 API facade 和 Extension RPC 类型边界。
- [ ] 分批拆分 App 与 `useStudioState`，维持兼容入口并验证刷新链路。
- [ ] 每个批次记录实际删除量、行为变化、验证结果和未处理风险。

### 停止条件

出现持久化格式迁移、公共 RPC/导出破坏、无法解释的行为差异、需要新增依赖或需要改变状态所有权时，停止当前批次并重新确认范围。不要为了完成 Task List 强行合并。
