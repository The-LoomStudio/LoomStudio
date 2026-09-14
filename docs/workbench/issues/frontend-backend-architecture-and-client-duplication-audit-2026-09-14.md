# 前后端架构与客户端重复逻辑审计

日期：2026-09-14  
状态：审计完成 / 后续实施由 Plan 承接
范围：`apps/studio-client`、`apps/studio-server`、`packages/application-runtime`、`packages/application-data`

## 结论摘要

当前生产 TypeScript 约 65,500 行，其中 `apps/studio-client` 约 30,988 行，`packages/application-runtime` 约 16,163 行，`apps/studio-server` 约 7,489 行。

初步判断，规模偏大的主要原因不是单纯领域模块数量多，而是：

- 客户端承担了第二套应用编排层；
- 服务端领域对象在客户端被重新投影、规范化和编排；
- API 类型、客户端实体、Feature Model 和 Widget View Model 之间存在多层重复表达；
- `application-runtime` 聚合了过多领域职责；
- `ApplicationRuntimeContext` 作为全局 Service Locator 被大量 Runtime 模块接收；
- 公共导出面过宽，存在迁移残留和未使用 API。

这份 Issue 记录架构事实、已完成的结构修复和保留边界。拖拽草稿、乐观编辑和浏览器
扩展宿主仍保留必要的本地模型；没有为了减少行数把这些交互状态迁移到服务端。

## 已确认事实

### 规模分布

| 范围 | 文件数 | 行数 |
| --- | ---: | ---: |
| `apps/studio-client` | 182 | 30,988 |
| `packages/application-runtime` | 62 | 16,163 |
| `apps/studio-server` | 40 | 7,489 |
| 其他生产 packages | - | 约 10,000 |
| 测试 | 169 | 25,211 |

客户端内部主要体量：

| 目录 | 文件数 | 行数 |
| --- | ---: | ---: |
| `src/features` | 65 | 11,564 |
| `src/widgets` | 29 | 8,174 |
| `src/app` | 12 | 1,882 |
| `src/entities` | 15 | 1,355 |
| `src/shared/api` | 2 | 799 |

### 前后端职责

服务端链路已经包含：

```text
HTTP -> RPC Router -> Application Runtime -> Application Data / Kernel / Storage
```

服务端已负责 Agent 执行、工具循环、Prompt、State、Narrative、Card、Extension、VFS、Provider、AI Gateway、持久化事务和导入导出。

因此目前没有证据表明客户端因为后端缺少核心领域能力而被迫实现完整业务逻辑。更明显的现象是客户端在服务端能力之上又维护了一层应用工作流和领域投影。

### 客户端应用编排

`apps/studio-client/src/app/use-studio-state.ts` 约 663 行，集中处理 API 创建、初始加载、全局状态组装、资源 CRUD、导入导出、Provider、Settings、Logs 和 State 等多个领域。

多个 Feature Hook 直接重复组织以下流程：

```text
调用 API -> 管理 loading/error -> 刷新或合并数据 -> 更新本地草稿/派生状态
```

项目已有 `shared/hooks/async-operation-model.ts`，但尚未成为统一的数据操作边界。

### 客户端领域投影

`features/context-assets` 同时包含树操作、规范化、组合项、投影顺序、投影 Slot、Workbench、搜索和多个 Hook。这表明客户端拥有一套较完整的资源领域投影，而不是单纯的 UI 状态。

这部分可能有真实需求，但需要确认每个模型是否分别承担：

- 服务端资源的显示投影；
- 本地草稿和未提交编辑；
- 拖拽操作的临时状态；
- RPC 输入转换；
- 纯字段搬运。

最后一种属于高价值精简候选。

### `ApplicationRuntimeContext` 体积与依赖扩散

`packages/application-runtime/src/foundation/application-context.ts` 中的
`ApplicationRuntimeContext` 包含约 20 个服务、存储和工厂能力，包括：

- `dataEngine`、`documents`、`blobs`；
- `agents`、`narratives`、`promptResources`、`states`；
- `gateway`、`providerAdapters`、`aiCapabilities`；
- `agentTools`、`macroProviders`、`stateContributions`；
- `sourceArtifacts`、`mediaAssets`、`secrets`；
- `logger`、`now`、`createId` 以及删除回调。

多个 Runtime 模块都直接接收完整 `ApplicationRuntimeContext`，当前对 `ctx.*`
的静态访问约 500 处。`runtime/context.ts` 还通过
`requireNarratives`、`requireAgents`、`requireSecrets` 等函数在调用点从完整
Context 中取服务。

这说明该类型已经不是请求级上下文，而是应用级依赖容器。它带来的直接成本是：

- 每个领域模块都隐式依赖整个应用基础设施；
- 模块的真实依赖无法从函数签名中直接看出；
- 测试必须构造大 Context，或依赖大量可选字段；
- 新增服务会扩大所有可见的 Runtime 边界；
- 领域模块之间更容易通过 Context 形成非显式耦合。

这里暂不建议机械地把每个函数都改成参数列表。更合理的后续目标是按领域建立窄接口或模块依赖对象，例如 Agent、Prompt、Narrative、State 各自只接收其确实需要的存储和协作者。

### Card 工作流与后端接口粒度

Card 主链路为：

```text
use-cards -> studio-api -> RPC Router -> application/cards handler
-> Application Runtime -> Document Store -> SQLite
```

Card 核心持久化目前直接由 `application-runtime` 操作 `DocumentStore`，并不经过
`application-data` 的 Card Store。

客户端同时维护 summary 列表、详情、选中 ID、编辑草稿、刷新竞态、历史记录和删除
后的关联资源刷新。创建、更新和部分更新分别使用不同的 mutation 后同步策略。

批量删除存在明确的后端接口缺口：客户端 `deleteCards` 接受多个 ID，但实际按顺序
调用 `application.deleteCard`。因此多卡删除不是单事务，中途失败可能留下部分结果，
并产生多个 changeset。

Card Runtime 的 `updateCard` 同时处理基础元数据、Prompt/Setting、Media、Macros、
State、Timeline、Component Mounts 和 bindings。简单名称更新也会进入完整读取、
合并、校验、materialize、规范化和写回路径。

RPC handler 对复杂嵌套参数逐字段解析后，多处使用
`as unknown as JsonValue`，需要继续核查 RPC JSON 边界与 Runtime 返回类型是否存在
重复 DTO 或被强制断言掩盖的契约问题。

### 客户端第二应用层与重复同步

`use-studio-state.ts` 约 663 行，返回超过 170 个字段和动作，集中处理多个领域的
启动加载、刷新、Prompt Resource 导入导出、Mount 管理、History 和异步操作。
它已经是一个隐含的客户端 Application Service，而不是单纯的 React 状态组合器。

`use-cards.ts` 中至少存在三套 mutation 后同步策略：

```text
mutation -> recordEdit -> refresh -> restore selection/detail
mutation -> recordEdit -> local patch summary/detail
delete many -> sequential mutations -> refresh -> external refresh
```

状态配置更新和宏更新都调用同一 `api.cards.update`，随后重复处理 mutation receipt、
详情版本和 summary patch。这里适合提取只负责应用服务端 Card 结果的内部函数，不适合
建立万能 CRUD Hook。

Provider Settings 还把 `ModelProfile` 作为从
`ProviderAccount.enabledModelIds` 投影出来的虚拟实体，再通过合成 ID 反查 Account
并更新原字段。这是数据流重复候选，应先确认领域契约，而不是先增加客户端抽象。

### Context Assets 的数据流冗余

`features/context-assets` 同时维护树结构、兼容字段、Projection order、Composition
order、搜索和 Workbench 草稿。`tree-ops.ts` 的多个插入、移动、复制和删除路径都会
调用 `normalizeContextAssets`，部分路径随后还会调用
`normalizeProjectionOrderNodes`，一次操作可能进行多次递归遍历和完整对象复制。

建议后续按不变量核查三层边界：

```text
tree-structure: insert / remove / move / clone
context-asset-state: compatibility normalization
projection-order: order repair and projection reorder
```

树查找、Projection order、Composition order 和 Activation editor 当前规则不同，
不应仅因函数名相似而合并成高度泛型工具。

### Knip 结果

Knip 当前发现：

- 13 个疑似未使用文件；
- 3 个未使用依赖；
- 2 个未使用 devDependencies；
- 40 个未使用导出；
- 35 个未使用导出类型；
- 2 处重复导出。

这些结果需要考虑动态扩展加载、公共 SDK、测试入口和 UI 注册机制造成的误报，不能直接批量删除。但它们支持“客户端公共 API 和模块边界过宽”的判断。

### Shared 契约层不足

`packages/shared` 当前约 419 行，主要包含 JSON、宏、聊天、State Contribution
和资源目录类型。它已经承担了一部分前后端共享语义，但还没有成为稳定的共享契约层。

当前重复链条仍然可能是：

```text
Server DTO
  -> Client API DTO
  -> Client Entity
  -> Feature Model
```

后续应评估将真正跨端共享的内容收敛到 `shared`：

- RPC 请求、响应、错误码、分页和 Mutation Receipt；
- Card、Prompt Resource、State、Agent Tool 等跨端领域契约；
- JSON、资源引用、ID、时间和版本等基础值对象；
- 前后端都需要的纯校验、规范化、序列化和解析函数；
- 宏、State Contribution、聊天消息等已经存在的跨端纯逻辑。

`shared` 不应承载：

- `ApplicationRuntimeContext`、数据库、Blob、Secrets、Logger；
- React、Zustand、浏览器 API 或 Node 专属运行时；
- RPC 调用器、服务端事务、Agent 执行器；
- UI 草稿、拖拽状态、布局和组件 View Model。

需要特别核查 `shared/src/index.ts` 当前对 `node:crypto` 的依赖。浏览器和服务端
共享的契约不应被 Node 专属实现绑定；ID 生成等运行时设施应与 Shared 中的值类型、
格式校验区分开。

目标不是把所有类型塞进 Shared，而是让前后端共享“协议、值对象和纯函数”，从而
删除重复 DTO、字段搬运、重复校验和重复 normalize。Shared 需要保持低依赖，并遵守：

```text
shared 不依赖 apps
shared 不依赖 application-runtime
shared 不依赖 document-store
shared 不依赖 React / Node 专属能力
```

建议迁移顺序为：先定义 Shared 依赖规则，再提取 RPC 协议，随后合并跨端领域契约
和纯函数，最后删除客户端重复 Entity，并据此收缩 `ApplicationRuntimeContext` 和
`useStudioState`。

### 分层复用库与 FSD 收敛方向

前端已经存在 `shared/ui`、`shared/hooks`、`shared/browser` 和 `shared/lib`，
后端也存在 `foundation` 与 `core/utils`，但当前复用边界尚未形成明确规则。代码中
仍可见多处重复的 UUID/ID 生成、搜索文本规范化、下载、JSON 响应读取、错误文本
转换、刷新和 mutation 同步逻辑。

后续不应只依赖跨端 `packages/shared`，而应建立三层复用边界：

```text
packages/shared
  跨前后端的协议、值对象、纯函数

apps/studio-client/src/shared
  浏览器能力、React Hooks、UI 原语、客户端资源操作

apps/studio-server/src/lib 或 packages/*/src/utils
  Node/SQLite/文件系统/服务端专属纯逻辑
```

前端 FSD 应明确依赖方向：

```text
shared -> entities -> features -> widgets -> pages -> app
```

实际迁移时需要避免把所有代码按目录搬运，而是按职责判断：

- `shared/ui` 只放跨多个 Feature 的稳定 UI 原语和布局；
- `shared/lib` 只放无业务领域归属、可测试的纯函数；
- `entities` 只放跨 Feature 的实体契约和最小实体行为；
- `features` 放一个用户能力的状态、命令和局部模型；
- `widgets` 只负责组合多个 Feature，不重新实现资源 CRUD；
- `app` 只负责应用装配、路由和生命周期。

可优先收敛的低风险共享能力包括：

- `downloadBlob`、`downloadBase64`；
- JSON 响应解析和统一错误消息；
- 搜索文本规范化；
- ID 格式校验与客户端生成策略；
- 通用 mutation 后资源更新；
- 统一的可折叠树节点和 Drop Target 行为。

但 `shared/lib` 不应成为新的杂物间。每个新增工具都应满足：至少两个真实消费者、
没有明确领域归属、输入输出稳定、无需访问全局状态。领域规则应留在所属 Feature
或 Runtime，不能为了少几行把不同语义的逻辑错误合并。

当前已有共享 UI 组件（如 `master-detail-workbench`、`asset-workbench-layout`、
`file-tree`），后续应优先检查真实消费者是否复用，而不是继续新增相似组件。FSD
治理的目标是减少跨层引用、重复 View Model 和局部业务编排，不是追求目录结构本身
看起来整齐。

## 当前假设

当前代码规模可能由以下数据流重复造成：

```text
Application Data 类型
  -> Application Runtime 类型
  -> Server RPC 参数/结果
  -> Client API 类型
  -> Client Entity 类型
  -> Feature Model 类型
  -> Widget View Model
```

多层转换只有在存储形态、信任边界、运行时语义或 UI 投影确实不同的时候才有价值。需要通过完整工作流确认哪些转换只是字段搬运。

## 后续审计任务

1. 以 Prompt Resource 编辑为样本，追踪一次加载、编辑、保存、撤销的完整调用链和 RPC 次数。
2. 以 Card 编辑为样本，比较服务端 Runtime 对象、RPC 返回对象、Client Entity 和 Widget Model 的字段重叠。
3. 审计 `features/context-assets`，区分必要的本地编辑模型和重复的服务端领域逻辑。
4. 审计 `use-studio-state.ts`，识别可以下沉到服务端聚合命令或客户端通用资源操作层的流程。
5. 对 Knip 的未使用导出逐项做动态入口核验，再收紧公共导出。
6. 统计 `ApplicationRuntimeContext` 各字段的消费者，按领域生成最小依赖集合，确认哪些字段可以从模块签名中移除。
7. 核对 `require*` helper 的调用链，判断是否存在 Context 依赖隐藏和可合并的领域服务边界。
8. 统计 Card 工作台真实首屏 RPC 序列，验证是否需要聚合读取接口。
9. 比较 Card 与 Prompt Resource 的 summary/detail、mutation 后同步和 DTO 映射模式。
10. 逐项确认 `ModelProfile`、旧 Card 字段兼容和 Context Asset normalization 是否仍有真实运行时需求。
11. 盘点前后端重复 DTO、校验和规范化函数，确定哪些应迁入 `packages/shared`。
12. 检查 `packages/shared` 的运行时依赖和导出边界，确保 Shared 不被 Node、React 或 Runtime 服务绑定。
13. 盘点前端 `shared/ui`、`shared/hooks`、`shared/browser`、`shared/lib` 的真实消费者，识别未复用的公共能力。
14. 为 FSD 建立依赖方向和导入约束，优先收敛客户端跨 Feature 的资源命令、错误处理、下载和搜索规范化。
15. 盘点后端 `foundation`、`core/utils` 与各领域私有工具，避免服务端重复实现同一类纯逻辑。
16. 对每个候选共享工具要求至少两个真实消费者，并记录不能抽象的领域差异。

### 组件复用率与后端纯逻辑复用审计

#### 前端现有共享组件

前端 `shared/ui` 并非完全没有复用。当前真实消费者较多的能力包括：

- `Toggle`：约 26 个消费者；
- `Dialog`：约 17 个消费者；
- `clipboard`：约 14 个消费者；
- `Skeleton`：约 10 个消费者；
- `MasterDetailWorkbench`：约 10 个消费者；
- `LongTextEditor`：约 10 个消费者；
- `ContextMenu`：约 9 个消费者；
- `FileTree`：约 5 个消费者；
- `AssetWorkbenchLayout`：约 3 个消费者。

这说明基础 UI 原语和工作台布局已经有一定复用，不能把“前端组件多”简单归因于
缺少 Button、Dialog 等基础组件。更大的问题在于高层能力复用不足：

- 资源 CRUD 后的刷新、选择恢复和版本同步仍在 Feature Hook 内部重复；
- 下载、JSON 响应读取和错误消息转换仍有局部实现；
- Projection Drop Target 在不同语义节点中重复 preview/commit 流程；
- `use-async-operations` 已存在，但没有成为资源命令的统一生命周期边界。

因此组件治理应优先关注“领域工作流组件”和“客户端命令协调器”，而不是继续扩充
基础 UI 组件目录。

#### 前端 FSD 复用判断

当前目录大致已经具备 `shared -> entities -> features -> widgets -> pages -> app`
的形态，但依赖约束还不够强。后续需要检查：

- `widgets` 是否直接调用 API 并重新实现 Feature 逻辑；
- `app/use-studio-state` 是否向下暴露过多跨域命令；
- `entities` 是否包含实际只被单个 Feature 使用的类型；
- `features` 是否重复实现同一资源的刷新和错误生命周期；
- `shared/ui` 中的布局组件是否被相似页面实际复用。

高价值候选是把 Prompt Resource、Card、Provider Account 的命令和同步流程留在
Feature 级协调器中，再由 Widget 组合，而不是让 Widget 或全局 App Hook 直接拼业务
RPC。

#### 后端纯逻辑重复

后端目前存在多个可疑的重复家族：

- `isRecord`：`shared`、Kernel、Server RPC、Runtime/Codec 各自存在实现；
- `readString`、`readOptionalString`、数组和 Record 读取：Server RPC 与多个领域解析器
  分散实现；
- `validateId`、`validateOptionalId`、`assertNonEmpty`、`normalizeOptionalText`：
  Application Data、Runtime、Asset Store、Secret Store 等多处重复；
- JSON clone/parse/serialize：Core、Runtime、Application Data、Archive 各自拥有局部版本；
- `normalize` 与 `validate` 常常在同一模块多次出现，且边界不总是清晰。

这些不能全部移到跨端 `packages/shared`。建议按依赖性质分层：

```text
packages/shared:
  JsonValue、isRecord、基础 ID/文本/分页/错误契约、纯序列化

packages/server-shared 或 packages/core:
  Node/SQLite 无关的服务端领域基础工具

各领域包:
  只保留带有本领域不变量的 validate/normalize

apps/studio-server:
  只保留 HTTP/RPC/文件系统安全边界解析
```

例如 `rpc-params.ts` 的参数读取逻辑可以继续属于 Server RPC 边界，不应因为名字相似
就和领域 `validateId` 合并；但通用 `isRecord`、字符串数组解析和基础 JSON 断言应
评估是否统一来源。

#### 可共享性决策规则

候选代码只有同时满足以下条件才应下沉：

1. 至少有两个真实消费者；
2. 语义属于同一层，而不是仅仅代码长得相似；
3. 输入输出稳定，且不需要访问全局状态；
4. 抽出后能减少维护分支，而不是增加泛型参数和配置；
5. 可以明确写出不应复用的领域差异。

当前高置信度候选：浏览器下载、JSON 响应解析、通用 `isRecord`、基础搜索文本
规范化、ID 格式校验、客户端 Card 结果同步。低置信度候选：万能 CRUD Hook、
统一所有领域的 `validateId`、统一所有树/投影组件。

## 非目标

- 当前不批量删除 Knip 报告的文件或导出；
- 当前不因为行数本身拆分 package；
- 当前不把所有客户端状态迁移到服务端。

## 后续实施入口

依赖、性能和状态基础设施的实施记录位于
[核心依赖、性能与状态治理计划](../plans/core-dependencies-performance-and-state-plan.md)。该 Plan
已完成 TanStack Query 试点、Panel 分包、Zustand 订阅治理、性能与包体积基线、React
Compiler 注解模式试点以及 Shared Schema 版本统一；Pretext 与 `proxy-memoize` 因缺少
符合边界的真实收益证据而未引入。本 Issue 保留审计事实和已完成修复，不再继续承载
依赖实施清单。

## 验证记录

- 第一批低风险收敛已实施：
  - 新增前端 `shared/browser/download.ts`，统一 Blob/Base64 下载；
  - 新增前端 `shared/lib/text.ts`，统一搜索文本规范化；
  - Card 状态更新和宏更新复用统一的 Card 结果同步函数；
  - Card、Prompt Resource、Preset Tool 搜索和导出路径已接入共享能力。
- 第二批低风险收敛已实施：
  - `packages/shared` 新增 `isJsonObject`；
  - Studio Server RPC 参数解析和 Kernel Handler 复用同一 JSON 对象谓词；
  - 保留 Server/Kernel 各自的参数读取语义，未强行合并领域校验。
- 第三批低风险收敛已实施：
  - Studio Server 的 Extension Source 和 Extension State Store 复用 Shared `isRecord`；
  - 保留 RPC 专用和 Kernel 专用类型谓词，避免跨边界增加不必要断言。
- 第四批结构守卫已实施：
  - ESLint 新增前端 FSD 边界规则；
  - `shared` 和 `entities` 不得依赖 `features`、`widgets`、`pages` 或 `app`；
  - 当前扫描未发现违反该边界的导入。
- 第五批后端复用已实施：
  - Extension Host Manifest 和 Loom Runner 复用 Shared 的 JSON 对象谓词；
  - 剩余 RPC、Kernel 和特定 Codec 的对象谓词保留各自边界类型。
- 第六批后端与客户端复用已实施：
  - Character Gallery、Studio Layout、Loom Script Renderer Runtime 和 Loom Script Codec
    复用 Shared JSON 对象谓词；
  - 仅保留具有不同协议/客户端类型边界的对象谓词实现。
- 第七批客户端复用已实施：
  - State Variable Editor 复用 Shared JSON 对象谓词；
  - 普通业务代码中的本地 `isRecord` 实现已清除，剩余实现仅位于 RPC/Kernel 边界。
- 定向 `eslint`：通过，覆盖本批修改文件。
- `pnpm exec tsc -b apps/studio-client --pretty false`：通过。
- `pnpm exec tsc -b packages/shared packages/kernel apps/studio-server --pretty false`：通过。
- 后端共享改动定向 `eslint`：通过。
- Studio Server 扩展模块定向 `eslint`：通过。
- `pnpm exec tsc -b apps/studio-server --pretty false`：通过。
- FSD 反向依赖扫描：无命中；对应 ESLint 规则定向检查无错误。
- `pnpm exec tsc -b packages/shared packages/extension-sdk/extension-host packages/loom-runner --pretty false`：通过。
- Extension Host / Loom Runner 定向 `eslint`：通过。
- 第六批复用涉及文件的定向 `eslint`：通过。
- `pnpm exec tsc -b apps/studio-client packages/application-runtime --pretty false`：通过。
- State Variable Editor 定向 `eslint`：通过。
- `pnpm exec tsc -b apps/studio-client --pretty false`：通过。
- 前端 `shared` / `entities` 反向依赖 Feature、Widget、Page 检查：无命中。
- `git diff --check`：通过。
- `pnpm exec knip --reporter compact`：执行完成，报告上述结果。
- 第八批客户端复用已实施：
  - 扩展工作区官方内容导出接入共享 Base64 下载能力，移除重复的 Blob/URL/Anchor 实现。
- `pnpm exec tsc -b --pretty false`：失败，存在 `BlobStorage` 契约和 `workspace.ts` 事务返回值类型错误。
- `pnpm lint`：失败，180 个错误，包含核心未使用导入及官方扩展环境配置问题。
- 两次独立只读子代理审计：分别覆盖 Card 前后端链路与 `studio-client` 重复逻辑，结论已合并至本文。
- `packages/shared` 契约层方向：已登记为架构审计项，尚未实施迁移。
- Context 窄化验证：Card Runtime 表面只使用约 11 个 Context 字段，但其调用的 foundation
  helper 仍要求完整 `ApplicationRuntimeContext`；仅修改入口类型会产生 TypeScript 契约错误，
  因此暂不保留伪窄化，后续需连同 helper 参数契约一并迁移。
- 第九批 CTX 收敛已实施：Card Runtime 的媒体校验和时间线分页 helper 改为只声明所需的
  `mediaAssets` / `narratives` 窄依赖，调用行为不变。
- 第十批 CTX 收敛已实施：Runtime 的 `require*`、时间线运行时上下文读取、Loom Script
  解析以及 Card 的时间线构建 helper 改为按实际字段声明依赖；Card Runtime 不再让这些
  helper 以类型形式依赖完整 Context。`tsc` 已验证通过。
- 第十一批客户端流程复用已实施：`useStudioState` 抽取扩展资源变更后的统一刷新流程，
  官方内容安装、扩展资源导入和移除复用同一协调函数，避免重复维护四组刷新调用。
- 回归修复：发现 `packages/shared` 的 `createId` 使用 `node:crypto` 导致客户端 Vite
  externalized 错误；已改为优先使用 `globalThis.crypto.randomUUID()`，移除 Shared
  对 Node 专属模块的静态依赖。客户端与 Shared 定向 `tsc`、ESLint 已通过。
- 客户端生产构建验证：`pnpm exec vite build --config apps/studio-client/vite.config.ts`
  通过，未再出现 `node:crypto` externalized 错误；构建仍有既有的大 chunk 警告。
- 第十二批 Card Runtime 重构已实施：将三个删除事务分支共有的 Card 文档、扩展作用域、
  文本转换规则和运行时上下文收尾逻辑抽为 `deleteCardDocuments`，保留各分支独有的
  时间线删除与 Prompt Resource 级联语义。定向编译和 ESLint 通过。
- 第十三批客户端架构拆分已实施：Prompt Resource 的创建、复制、删除、宏更新、Mount
  替换以及 JSON/ZIP 导入导出迁入独立 Feature 命令 Hook；Extension 的官方内容安装、
  包资源导入/移除和 ZIP 安装也迁入 Extension Feature。`useStudioState` 从约 663 行降至
  497 行，对外返回契约保持不变。
- 第十四批 CTX 收敛已实施：Official Content、Card Directory 和 Loom Script Runtime
  工厂改为领域最小 Context。其余 Runtime 的试验性窄化暴露内部 helper 隐藏依赖后未
  保留，避免只在入口制造伪边界；后续应按模块连同 helper 一并迁移。
- 第十五批客户端架构拆分已实施：Macro 目标选择与预览请求状态迁入 Prompt Build
  Feature，保留 Narrative Runtime 所需的选择读取回调和现有外部状态字段；
  `useStudioState` 进一步从 497 行降至 468 行。
- 第十六批 CTX 收敛已实施：Extension、State、Narrative、Macro、Provider、Text Transform、
  Agent、Prompt Runtime 及 Tool Loop 连同内部 helper 全部改为显式能力子集。除组合根
  `runtime/runtime.ts` 外，业务 Runtime、State 和 Script 函数不再接收完整
  `ApplicationRuntimeContext`。
- 第十七批前端孤儿代码清理已实施：删除无外部消费者的 `projection-runlist` 组件目录、
  失效样式和过时 Guide 指向，共移除约 1,700 行；当前 Projection 功能继续由
  `FileTree`、Context Workbench 与 Preset Workbench 承担。
- 第十八批共享面收敛已实施：删除 Context Menu / Dropdown Menu 未使用的 Shortcut 与
  Submenu 能力及残留样式，收回 Runtime 和客户端文件内误导性的私有导出；客户端移除
  未直接使用的 `@dnd-kit/utilities` 声明，保留 FileTree 实际使用的 `@dnd-kit/core`。
- 第十九批审计入口修复已实施：Playground CodeAct 改用正式 Workspace 包入口并登记
  `codeact:check` / `codeact:run` 脚本，避免跨 `rootDir` 深引入；全仓 TypeScript 构建恢复通过。
- 第二十批 Card 删除架构修复已实施：新增 `application.deleteCards`，多卡删除在单个
  SQLite 事务中完成并只生成一个 changeset；Card Directory 会按稳定顺序同时锁定和暂存
  所有目标目录，提交失败时整体恢复。单卡 API 保持兼容并复用同一批量实现。
- 最终规模账目（排除本审计文档和并行修改的 Agent 讨论文档）：新增 736 行、删除
  2,552 行，净减少 1,816 行。
- 最终验证：`pnpm exec tsc -b --pretty false` 通过；13 个相关测试文件共 128 个测试通过；
  Playground `codeact:check` 通过；Studio Client 生产构建通过；本次修改文件定向 ESLint
  0 error；`git diff --check` 通过。
- 全仓 `pnpm lint` 仍有 180 个既有错误，集中在 `Playground/`、官方 `the-world` 扩展和
 旧 Workspace Codec；本次批量删除最初引入的 2 个错误已修复，不把既有基线描述为通过。
- 最终 Knip 复跑后剩余 7 个未使用文件、2 组依赖、27 个未使用导出、35 个未使用类型和
  1 个重复导出。SCSS additionalData、示例、Probe、Extension 动态入口和私有包公共面仍需
  按各自运行方式核验，没有在本 Issue 中冒险批删。
