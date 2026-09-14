# 前后端架构与客户端重复逻辑审计

日期：2026-09-14  
状态：调研中  
范围：`apps/studio-client`、`apps/studio-server`、`packages/application-runtime`、`packages/application-data`

## 结论摘要

当前生产 TypeScript 约 65,500 行，其中 `apps/studio-client` 约 30,988 行，`packages/application-runtime` 约 16,163 行，`apps/studio-server` 约 7,489 行。

初步判断，规模偏大的主要原因不是单纯领域模块数量多，而是：

- 客户端承担了第二套应用编排层；
- 服务端领域对象在客户端被重新投影、规范化和编排；
- API 类型、客户端实体、Feature Model 和 Widget View Model 之间存在多层重复表达；
- `application-runtime` 聚合了过多领域职责；
- 公共导出面过宽，存在迁移残留和未使用 API。

这份 Issue 目前记录架构事实和后续审计范围，不直接认定所有客户端模型都应删除。拖拽草稿、乐观编辑和浏览器扩展宿主可能需要本地模型，需按工作流逐项核实。

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

### Knip 结果

Knip 当前发现：

- 13 个疑似未使用文件；
- 3 个未使用依赖；
- 2 个未使用 devDependencies；
- 40 个未使用导出；
- 35 个未使用导出类型；
- 2 处重复导出。

这些结果需要考虑动态扩展加载、公共 SDK、测试入口和 UI 注册机制造成的误报，不能直接批量删除。但它们支持“客户端公共 API 和模块边界过宽”的判断。

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

## 非目标

- 当前不直接重构前后端；
- 当前不批量删除 Knip 报告的文件或导出；
- 当前不因为行数本身拆分 package；
- 当前不把所有客户端状态迁移到服务端。

## 验证记录

- `pnpm exec knip --reporter compact`：执行完成，报告上述结果。
- `pnpm exec tsc -b --pretty false`：失败，存在 `BlobStorage` 契约和 `workspace.ts` 事务返回值类型错误。
- `pnpm lint`：失败，180 个错误，包含核心未使用导入及官方扩展环境配置问题。
- 本 Issue 仅记录审计结论，未修改实现代码。
