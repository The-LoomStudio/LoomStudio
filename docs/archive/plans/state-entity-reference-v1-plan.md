# State Entity / Component / Reference v1

> **Status**：Implemented / 已晋升 Architecture
> **日期**：2026-09-09
> **授权**：用户确认补齐实体与引用、文件声明与代码注册并行，并采用增量 Revision + 周期 Snapshot 的 State 持久化方向；数据架构讨论已足够，可以进入实施。
> **后续事项**：独立 State Artifact 资源链与运行态软引用检查已转入 [`State 资源与引用检查后续`](../../workbench/issues/state-resource-and-reference-follow-ups.md)。

## 实施进度

- **已完成**：State Store migration v2；普通 Revision 持久化内部 delta，初始化 / 周期节点保存完整 Snapshot，按 `revisionId` 使用有界进程缓存物化；旧完整 Snapshot Revision 保持可读。
- **已完成**：统一 `StateContribution`、`loom.state` schemaVersion 1 Artifact、Card 字段 Adapter，以及 Card Bundle 的新格式导入导出兼容入口。
- **已完成**：Card 显式实体类型、实体、精确 / 类型批量组件挂载、组件引用 Schema 与 unresolved 诊断；Timeline 初始化与 Runtime Context 冻结走统一 Contribution 物化。
- **已完成**：Card 更新 RPC、Client DTO 与完整 YAML 源码编辑链已能读写 Entity / Component / Reference 配置。
- **已确认**：完整 State JSON 只是 Application 的逻辑读写合同；SQLite 不按每个 Revision 重复保存整棵对象，普通变更使用 delta，checkpoint 才保存完整 Snapshot。几十个实体与每轮更新不要求把 Entity / Component 拆成新的 SQL 权威表。
- **已确认**：独立 `*.state.json` 在本地以 `airp.stateArtifact` Document 存入现有 Document Store；Card 保存 `stateArtifactIds[]`。Extension Portable Payload 保持 Extension 私有可移植数据职责，不充当 Card State 资源。
- **已确认**：Extension 注册的 contribution 使用包命名空间 ID 和现有 Extension Scope 生命周期；Card 通过 `stateContributionIds[]` 显式选择。Timeline 创建时冻结 contribution 内容、Package 版本和 Artifact Document 版本。
- **已完成**：确定性大世界储存 characterization；48 个实体、96 次局部变更验证历史恢复、缓存丢弃后重建、checkpoint 重放上限与相对全量 Snapshot 的储存缩减，当前 32 Revision / 256 KiB 策略暂不调整。
- **已完成**：Extension contribution 注册表、`state.contribute/read/write` capability、Card 显式选择、Timeline 来源版本冻结和 Example Echo 样本。
- **已完成**：可视化 EC 作者面板按实体类型 / 实体 / 组件定义 / 组件挂载 / Extension contribution / 高级原始路径组织，编辑区下方展示最终装配树；运行检查继续复用现有 State 面板。
- **已转交**：资源池中的独立 `airp.stateArtifact` / `*.state.json` Document CRUD、Card Artifact 引用与 Bundle 内嵌 / 解包恢复进入后续 Issue，不阻塞 v1 核心晋升。
- **已完成**：State Mutation、Definition 校验与 Agent 读取只遍历 own property；原型式路径作为普通 JSON 键保存，不能污染 JavaScript 对象原型链。

## 本轮结果

- State 的逻辑完整 JSON 与 SQLite 的增量 Revision / 周期 Snapshot 已分离，并通过确定性大世界表征验证。
- `StateContribution` 纯 DTO 已下沉到 `@loom-studio/shared`；Application Runtime 保留严格组合、物化与引用诊断。
- Extension Host 已提供 `state.contribute`、`state.read`、`state.write` capability；Contribution 注册随 Extension Scope 释放，运行读写转发现有 Application State Service。
- Card 的 `stateContributionIds[]` 已进入更新 RPC、Client DTO、作者配置与 Card Bundle；只有显式选择的已注册 Contribution 会进入新 Timeline，来源 Package 版本冻结在 Runtime Context。
- State 作者 UI 已按 EC 概念重建，最终装配树位于编辑区下方；高级原始路径保留为兼容入口，不再通过“挂载”暗建 Character。
- 最终安全收口将 State Mutation、Global Definition 默认值校验与 Agent 读取统一为 own-property 语义；`__proto__`、`constructor` 和 `prototype` 路径保持可序列化，同时不能进入 JavaScript 对象原型链。

### 验证结果

- State Store 定向测试：9/9 PASS，其中大世界表征覆盖 48 个实体与 96 次局部变更。
- Client State 定向测试：9/9 PASS；Studio Client build PASS。
- Extension State contract 与 Narrative Timeline：15/15 PASS。
- Workspace Artifact：14/14 PASS，覆盖 Extension contribution 选择的 Bundle round-trip。
- Shared、Application Runtime、Extension SDK / Host、Studio Server 与 Example Echo build PASS。
- `pnpm run check:docs` PASS；浏览器和主观视觉验收未执行，按约定由用户完成。

## 目标

在不新增 State Store、不改变 Revision / Branch / Undo 边界的前提下，为 Timeline State 补齐可被 Card、Extension、UI、Agent 与程序共同理解的实体类型、实体实例、组件挂载和实体引用合同。作者能够预览初始化装配结果；运行态仍由现有 State Mutation 修改和回滚。

## 已确认事实

- `@loom-studio/state-store` 对外只暴露通用 `JsonObject` Snapshot、不可变 Revision 与 Scope，不理解 Entity、Component 或 Reference；物理层已支持 checkpoint Snapshot + 内部 delta。
- 当前 `CardStateTemplate + timelineStateBindings.path` 只能按路径物化数据；`entities.characters.<id>.components.<component>` 是示例约定，不是正式实体类型。
- Timeline Runtime Context 已冻结 Card 版本、具体 Binding Schema、宏和文本规则，适合继续承载初始化语义快照。
- Extension Host 具备 owner、capability、注册 handle 与 scope dispose 模式，但没有 State contribution 或 State read/write capability。
- Card Bundle schemaVersion 2 已兼容可选 `loom.state` Artifact，同时继续读取原模板和路径 Binding 字段。
- 当前运行态由 SQLite State Store 保存：初始化 / checkpoint Revision 的 `snapshot_json` 是完整 `JsonObject`，普通 Revision 保存内部 `delta_json`，`operations_json` 保留调用事实；它不是 Prompt Resource 式的节点集合，也不存在持久化内存 Entity Graph。
- 当前 Card 作者配置位于 Card Document `content`；Extension 私有 Document / Record 不会自动进入 Timeline State。Card Bundle 是导入导出 Artifact，不是作者工程目录。

## 作者源、构建产物与运行储存

State 的作者源、可分发产物和 Timeline 运行数据是三个不同阶段，不共用同一个编辑或持久化模型：

```text
Studio 无代码配置 ─────────────────────────┐
Dev Workspace（YAML / JSON / TS / 脚本）─ build ─┼─> StateContribution JSON
Extension Package JS 注册 API ─────────────┘
                                                    ↓ 解析引用、校验、组合、冻结
                                             Timeline SQLite State Snapshot
```

- **文件声明与代码注册是并行的一等入口**，不是互斥模式。无代码 Card 不需要为了 State 引入 JS；复杂 Card / Extension 也不需要把大量实体初始化塞进一个 Studio 文本框。
- 所有入口必须产出同一个可序列化 `StateContribution`。Studio UI 保存等价的结构化配置；Dev Workspace 可从多个源文件构建；Extension JS 在注册阶段返回或注册同一 DTO。代码不得绕过该合同直接写初始化 Snapshot。
- 规范分发与交换格式为 JSON，v1 使用 `*.state.json` Artifact，并携带 `kind: "loom.state"` 与 `schemaVersion: 1`。YAML、TS 和拆分 JSON 只属于作者源格式，不直接作为运行态权威数据。
- `*.state.json` 可以作为资源进入资源池，由 Card 或 Extension Package 通过稳定资源引用选择；打包时纳入 Artifact，解包时恢复引用关系。具体资源 ID、版本约束和缺失依赖诊断由工作包 B 定义。
- Timeline 创建时解析 Card、被选择的 Extension contribution 及其资源链接，完成校验、组合和具体挂载展开，并把解析结果及来源版本冻结到 Runtime Context。已有 Timeline 不因源文件、Card 或 Extension 后续修改而漂移。
- 运行期权威数据仍由现有 SQLite State Store 管理。逻辑读取结果始终是完整 `JsonObject`，物理储存改为增量 Operations + 周期 Snapshot；运行时程序通过 Application State Service 读取或提交 Mutation，不回写 `*.state.json`，也不建立第二套 Store。
- 一般静态定义和大批量初始化优先使用 JSON Artifact；需要生成、按配置组合或提供运行行为时使用代码。两者只在作者体验上不同，在进入 Timeline 前必须收敛为同一 Contribution。

## State Revision 物理储存

完整 State JSON 是 Application 的逻辑模型，不等于每个 Revision 都必须物理复制完整 JSON。当前每次 Mutation 同时保存完整 `snapshot_json` 与 `operations_json`，会让历史容量和同步 SQLite 写入成本近似按“State 体积 × Revision 数”增长。

v1 收口采用以下物理模型：

```text
State Revision
├── parentRevisionId
├── operations
└── snapshot?          # 初始化、周期 checkpoint 或压缩节点才保存

读取 Revision
├── 找到最近的祖先 Snapshot
├── 顺序重放后续 Operations
└── 得到完整 JsonObject，并按 revisionId 缓存
```

- 每次成功 Mutation 仍产生不可变 Revision、Changeset 与幂等事实，但普通 Revision 只持久化 Operations。
- Timeline 初始化 Revision 必须保存完整 Snapshot；达到固定 Revision 间隔或累计增量体积阈值时生成新的完整 Snapshot，限制重放链长度。
- 对外 `StateStore` / Application State Service 继续返回完整 Snapshot，不把重放、checkpoint 或缓存细节泄漏给 Card、Extension、UI 与 Agent。
- 物化缓存按不可变 `revisionId` 键控，只是可丢弃的进程内派生数据；重启后必须能从 SQLite 独立恢复，不成为权威来源。
- Branch Head 仍只引用 State Revision；分支、回滚与补偿 Revision 不改变语义。回滚需要的目标值通过物化历史 Revision 获得，不复制或改写旧 Revision。
- 不把 Entity / Component 规范化为 SQL 行。以后如需 Agent 定向搜索，可增加从完整 State 重建的派生索引，但索引不参与 State 权威、回滚或引用所有权。
- 高频局部修改的成本由 delta 大小决定，而不是由完整 State 体积直接决定；读取方仍获得一次物化后的完整对象，避免把物理储存细节扩散到 UI、Agent 与 Extension API。
- checkpoint 的初始间隔和增量体积阈值必须由确定性大世界 Fixture 验证，目标是限制单次恢复重放长度和数据库写放大；它们属于 Store 内部策略，不成为作者配置。

## 决策

1. **State Store 保持不变**。Entity / Component / Reference 是 Application Runtime 的 State 语义层，不创建 Entity Store、Reference 表或第二套 Revision。
2. **实体类型定义集合位置**：`StateEntityType { id, collectionPath, label? }`。例如 `character -> entities.characters`；类型决定实体集合位置，不硬编码 Character。
3. **实体身份为二元组**：`StateEntityId { typeId, entityId }`。实例存在于 `<collectionPath>.<entityId>`；组件位于该实例的 `components.<componentKey>`。
4. **Card 初始化实体显式声明**：`timelineStateEntities[]` 创建实体容器，即使实体暂时没有组件也能存在。添加组件不得暗中创建实体。
5. **组件定义扩展现有模板**：Card State Template 可选声明 `componentKey` 与 `targetEntityTypeIds`；Schema 与默认值仍由现有模板合同负责。
6. **结构化组件挂载**：新增 `timelineComponentMounts[]`，目标只能是一个实体或一个实体类型。实体类型目标只在 Timeline 初始化时展开，不持续监听运行中新实体。
7. **旧 `timelineStateBindings` 保留**，作为兼容与高级原始路径入口；新 UI 默认不通过它制造实体。结构化实体与挂载在物化阶段编译为现有具体 State 路径，继续复用 Schema 校验和 Runtime Context 的 concrete bindings。
8. **引用是软引用**：值使用 `{ typeId, entityId }`；组件 Schema 通过 `x-loom-entity-ref` 标注单值或数组元素及允许类型。写入边界验证形状和允许类型；目标缺失产生可检查诊断，不自动删除、搬迁或级联。
9. **引用不控制投影**。默认 Prompt 投影由作者代码激进过滤；主动检索读取完整 State，Pin 属于 Agent 信息组织能力。引用解析、投影展开与数据所有权保持分离。
10. **Extension contribution 显式绑定**：Extension 通过受 capability 与生命周期管理的 API 注册命名 State contribution；Card 通过 `stateContributionIds[]` 选择。只有被 Card 选择且创建 Timeline 时可解析的 contribution 才进入初始化快照，已有 Timeline 不随扩展重载改变。
11. **Extension 运行访问复用 Application State Service**：Host 只暴露受 capability 限制的 snapshot / mutation facade，不向 Extension 交出 Store 或 Runtime Context。写入仍要求 target、expectedRevisionId 与幂等键。
12. **Contribution 是唯一初始化边界**：文件 Artifact、Card 内联配置和 Extension 注册不得拥有不同的实体、组件或引用语义；它们只提供来源与所有权信息，统一经过同一解析、校验和物化流程。
13. **Extension 代码分注册期与运行期**：注册期只能贡献可序列化初始化数据并参与新 Timeline 冻结；运行期只能通过受限 State facade 操作当前 Timeline。裸 JS 文件不能被当作 State Artifact 执行，最小代码分发单元仍是带 Manifest、包 ID、版本、能力和入口的 Extension Package。
14. **完整 JSON 是逻辑合同，不是每 Revision 的物理格式**：State Store 使用增量 Operations、周期 Snapshot 与可丢弃物化缓存；不得为了查询方便把 Entity / Component 变成新的权威关系表。
15. **State Artifact 复用 Document Store**：`*.state.json` 导入为 `airp.stateArtifact` Document，本地引用使用 Document ID，版本由 Document CAS 与 Timeline Runtime Context 冻结；不增加通用文件 Store，也不复用 Extension Portable Payload。
16. **Extension contribution 使用注册表而非持久化私有数据**：纯可序列化 DTO 放在 `@loom-studio/shared`，Application Runtime 保留解析、验证、组合与物化；Server Composition Root 共享同一个 Registry 给 Runtime 与 Extension Host。卸载只释放注册项，不回写或删除已有 Timeline State。
17. **v1 冲突确定性拒绝**：多个来源组合后若实体类型、模板、实体身份或最终组件路径重名，则 Timeline 创建失败并报告来源；v1 不提供隐式覆盖顺序或兼容 fallback。

## 非目标

- 完整 ECS Query、System 调度、Trait 继承、响应式自动挂载或组件生命周期事件。
- 引用所有权、自动级联删除、垃圾回收、跨 Timeline 引用或强一致外键。
- 投影 DSL、自动重要性判断、Pin 实现、记忆系统或 Agent 临时文件。
- Preset State、任意 Timeline 浏览器、把 Extension 私有 Document 自动并入 State。
- Dev Workspace CLI、通用文件监听、增量编译器或新的脚本运行时；本计划只定义其应产出的 Artifact 合同与接入边界。
- Entity / Component SQL ORM、持久化对象图、强制常驻内存世界或不可重建的搜索索引。
- 迁移或重写既有 Timeline Snapshot；旧 Timeline 继续按冻结 Runtime Context 运行。

## 工作包

### A. State Revision 增量储存与物化

- **写集**：`packages/state-store/src/{types,store}.ts`、必要的 migration 与 State Store 定向测试；Application State Service 只做适配，不改变公开 Mutation 语义。
- 将 `snapshot_json` 改为 checkpoint 可选字段；旧 Revision 的非空 Snapshot 原样可读，新 Timeline 初始化仍写完整 Snapshot。
- 普通 Revision 写 Operations；Store 负责从最近 Snapshot 重放到目标 Revision，并以 `revisionId` 缓存物化结果。
- 增加确定性大世界 Fixture，对比现有全量 Revision 与增量 Revision 的数据库 / WAL 体积、恢复重放长度和 Mutation 时间，据此确定内部 checkpoint 间隔与字节阈值。
- 保持幂等检查、Branch Head、补偿回滚与 Changeset 语义；迁移失败必须显式中止，不能静默退回双写完整 Snapshot。

### B. Contribution DTO、Artifact 与资源引用合同

- **写集**：`packages/shared/src/state-contribution.ts`、Application Runtime 的 Artifact Document / Card Adapter、Bundle import/export 与对应定向测试。
- 定义唯一 `StateContribution` v1，容纳 owner/source、实体类型、实体 seed、组件定义、结构化挂载、旧路径 Binding 和引用 Schema annotation。
- 定义 `kind: "loom.state"`、`schemaVersion: 1` 的 `*.state.json` 容器，以及 Card / Extension 对资源池 Artifact 的稳定引用、版本冻结、缺失与冲突诊断。
- 定义三个 Adapter：Card 内联配置、文件 Artifact、Extension 注册结果；Adapter 之后只允许进入同一校验与组合管线。
- 明确同一 ID 的命名、owner 边界、组合顺序和冲突语义。未完成这些合同前，不继续 Entity 物化、Extension capability 或 UI 实施。

### C. 核心数据合同与物化

- **写集**：`packages/application-runtime/src/types.ts`、`state/state-definition.ts`、`runtime/{cards,narrative}-runtime.ts`、`cards/{card,workspace}.ts`、`index.ts`，以及对应 Application Runtime 定向测试。
- 增加实体类型、实体 seed、结构化组件挂载与引用 Schema annotation 类型。
- 物化顺序固定为：创建显式实体 → 精确组件挂载 → 初始化批量挂载 → 旧路径 Binding。
- Runtime Context 冻结实体类型、实体索引、具体组件 Schema 与引用字段信息。
- Card update、Bundle import/export 对新增字段执行版本、重复 ID、目标类型、componentKey 与引用 annotation 校验。

### D. Extension State capability

- **写集**：`packages/extension-sdk/src/index.ts`、`packages/extension-sdk/extension-host/src/{types,instance,manifest}.ts`、`apps/studio-server/src/main.ts`、必要的 Extension manager/manifest 类型，以及 Extension Host contract tests。
- 增加 `state.contribute`、`state.read`、`state.write` capability；贡献 ID 强制包名前缀，注册 handle 由既有 scope 自动释放。
- 建立共享 contribution registry，Application Runtime 在创建 Timeline 时按 Card 绑定解析并冻结贡献。
- snapshot / mutation facade 必须调用现有 Application State Service；不得直连 State Store。
- 注册 API 只接受或返回工作包 B 的可序列化 `StateContribution`；运行 API 不得伪装成初始化 contribution，也不得直接修改 Artifact。

### E. Client 作者与检查 UI

- **写集**：`apps/studio-client/src/entities/`、`shared/api/studio-api.ts`、`features/state-variables/{model,ui}/`、`app/{app,use-studio-state}.ts`、两份 i18n，以及对应 Client 定向测试。
- 初始化配置按“实体 / 组件 / 挂载 / 原始配置”编辑；新增实体先选类型并填写 ID，新增组件挂载先选择已有实体或类型。
- 右侧上方编辑当前对象，底部展示按新合同物化的初始化预览；预览显示实体层级、组件来源、批量规则匹配数和未解析引用。
- 运行态树识别实体引用，显示可定位目标与缺失诊断；不把引用目标复制成嵌套 State。
- Extension contribution 在当前 Card / Timeline 的组合范围内展示来源与只读定义；只有 Card 绑定开关可编辑，不伪装成角色卡内联模板。
- Studio 的少量手写编辑、内置 Agent 修改和 Dev Workspace Artifact 查看共享同一 Contribution 视图；不把 Studio 编辑器扩张成完整 IDE。

### F. 文档与样本

- 更新 Architecture 的 State、Prompt 投影与 Extension 边界。
- 将 Loom City / Example Echo 样本升级为：Character 持有 Inventory 引用，独立 Item 实体为一把剑；转移引用不复制剑，默认投影可省略背包与剑，主动 State 读取仍可定位。

## 完成条件

- Card 能声明至少两个实体类型、多个实体和结构化组件挂载，并创建正确 Timeline Snapshot。
- 连续局部 Mutation 不再为每个 Revision 持久化完整 State；任意历史 Revision、分支 Head 与补偿回滚仍能物化出与旧实现一致的完整 JSON。
- 进程重启并清空物化缓存后，当前与历史 Revision 仍可从最近 Snapshot + Operations 恢复；重放长度受 checkpoint 策略上限约束。
- 同一份 Contribution 能从 Card 内联配置、`*.state.json` 和 Extension 注册三种入口进入同一校验 / 组合流程；来源差异不改变实体与引用语义。
- Card 能引用资源池中的 `*.state.json`，打包 / 解包后保持可解析引用；Timeline 创建后冻结解析版本，源 Artifact 后续变化不影响已有 Timeline。
- 同一把 Item 可被 Character Inventory 引用；改变引用持有者时 Item ID 与组件数据不变。
- 删除或缺失目标不会级联删除其他 State，引用检查能报告 unresolved。
- Extension 可注册组件 / 初始化挂载贡献，由 Card 显式选择并在新 Timeline 固化；禁用或重载扩展不改变既有 Timeline。
- UI 不再通过新增挂载暗建 Character，能够在编辑区下方查看初始化物化结果和来源。
- 旧 Card Bundle、旧路径 Binding 与既有 Timeline 行为保持兼容。

## 验证预算

- A：State Store 定向测试覆盖旧全量 Revision 兼容、增量重放、checkpoint、分支历史、幂等与补偿；运行一次确定性容量 / 恢复 characterization，不把机器数据写成性能 SLA。
- B：DTO / Artifact Schema 的最小 parse round-trip，以及三个 Adapter 产出等价 Contribution、资源缺失 / 冲突 / 版本冻结的定向合同测试。
- C：`state-definition.test.ts`、`narrative-timeline.test.ts`、`workspace-artifact.test.ts`，只新增覆盖实体物化、批量挂载、引用诊断与旧 Binding 兼容的高价值用例。
- D：一个 Extension Host contract 文件和一个 Application Runtime 集成文件，覆盖注册生命周期、Card 显式绑定和冻结行为。
- E：Client 定向 TypeScript 检查及现有 State 两个测试文件；只为实体选择、装配预览和引用诊断增加必要行为测试。
- F：`pnpm run check:docs`。浏览器与主观视觉验收由用户执行，不作为自动化通过项。

## 停止条件

- 数据迁移无法保持既有 `snapshot_json NOT NULL` Revision 可读，或需要改变 Revision / Branch Head 语义、引入新依赖时停止并上报。
- `StateContribution`、Artifact 资源引用、组合冲突和 Timeline 冻结合同未实现前，不用临时类型或双路径逻辑抢跑后续 Extension / UI 接入。
- Extension contribution 无法在不隐式全局应用的情况下绑定 Card 时，不采用自动应用 fallback。
- 软引用无法覆盖已确认场景、必须引入所有权或级联删除语义时，先回到架构讨论。
- 同一失败连续两轮，或任务需要超出各工作包写集时停止扩张。

## 开放问题

- Studio 内联 Contribution 是继续存放于 Card Document `content`，还是统一转成资源引用，需要以当前 Card 更新与 Bundle 合同的最小改动为准后确认。
- Pin、投影代码宿主与运行时 Entity 查询 API 保持后续独立能力，不阻塞工作包 B，但不在本计划中顺带实现。
