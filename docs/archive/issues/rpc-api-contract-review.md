# RPC API 契约层审查报告 (RPC API Contract Review)

## 审查目标

全面排查 Loom Studio 暴露的 **RPC API 契约层**（涵盖 `studio-server/application-rpc.ts`、`studio-rpc-router.ts`、`studio-client/studio-api.ts` 及传输协议边界），重点审查：
1. **命名一致性与前后端术语对齐**
2. **输入输出设计与包装结构对称性**
3. **类型安全与裸 `JsonObject` 退化**
4. **参数解析样板代码与冗余**
5. **命名空间与路由分层**

---

## 1. 核心问题与设计异味

### 🔴 [高] 1. 前后端核心术语割裂与胶水转换（`ProviderProfile` vs `ProviderAccount`）

**文件：**
- 后端：[`apps/studio-server/src/application-rpc.ts` L31-L36](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-server/src/application-rpc.ts)
- 前端：[`apps/studio-client/src/shared/api/studio-api.ts` L181-L202](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/api/studio-api.ts)

**现象分析：**
- **后端 RPC 全面使用 `ProviderProfile`**：
  `application.createProviderProfile`、`application.listProviderProfiles`、`application.updateProviderProfile`、`application.deleteProviderProfile`，参数为 `providerProfileId`。
- **前端 Client API 全面使用 `ProviderAccount`**：
  `providerAccounts.create`、`providerAccounts.list`、`providerAccounts.update`、`providerAccounts.delete`，参数为 `providerAccountId`。
- **结果**：
  在 `studio-api.ts` 中被迫写了大量双向字段映射胶水代码：
  ```ts
  providerAccounts: {
    list: async () => {
      const result = await bridge.call<{ providerProfiles: ... }>('application.listProviderProfiles', {})
      return { providerAccounts: result.providerProfiles, nextCursor: result.nextCursor }
    },
    create: async input => {
      const result = await bridge.call<{ providerProfile: ... }>('application.createProviderProfile', input)
      return { providerAccount: result.providerProfile }
    },
    delete: async providerAccountId => {
      return await bridge.call('application.deleteProviderProfile', { providerProfileId: providerAccountId })
    },
  }
  ```

**建议：**
- 统一前后端核心领域术语（统一收敛为 `ProviderProfile` 或 `ProviderAccount`），消除 API 客户端全套无意义的重命名适配层，减少 **30+ 行** 样板代码。

---

### 🔴 [高] 2. 客户端 API 契约退化：裸 `JsonObject` 导致类型安全丧失

**文件：** [`apps/studio-client/src/shared/api/studio-api.ts` L78-L141](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/api/studio-api.ts)

**现象分析：**
在 `StudioApi` 接口定义中，超过 20 个方法的入参被直接粗暴地声明为 `input: JsonObject`：
```ts
export type StudioApi = {
  cards: {
    create(input: JsonObject): Promise<CreateCardResult>
    update(input: JsonObject): Promise<UpdateCardResult>
  }
  agentSessions: {
    create(input: JsonObject): Promise<CreateAgentSessionResult>
    invoke(input: JsonObject): Promise<InvokeAgentTurnResult>
    preview(input: JsonObject): Promise<PreviewAgentTurnResult>
  }
  promptResources: {
    create(input: JsonObject): Promise<CreatePromptResourceResult>
    createAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    updateAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    moveAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    deleteAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
  }
  ...
}
```

**危害：**
1. **丢失编译期类型检查与代码补全**：调用方无法获得任何入参提示，传递拼错字段（如把 `cardId` 错写成 `id`）在编译阶段完全不报错。
2. **迫使调用方做额外防御**：直接导致各 Feature Hook 蔓延书写 `toClientJsonObject({ ... })`。

**建议：**
- 将 `JsonObject` 替换为强类型的 Request DTO 接口（如 `CreateCardInput`、`UpdateCardInput`、`CreateAgentSessionInput` 等）。

---

### 🟡 [中] 3. RPC 命名风格不一致与动词不对称

**文件：** [`apps/studio-server/src/application-rpc.ts` L25-L79](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-server/src/application-rpc.ts)

| 领域 | 当前 RPC 命名 | 不一致点说明 | 建议标准化命名 |
|---|---|---|---|
| **Card 导出** | `application.exportCardArtifact` | 与 `importCardBundle` 不对称（一处称 Artifact，一处称 Bundle） | `application.exportCard` 或 `application.exportCardBundle` |
| **Narrative 创建** | `application.createNarrativeTimelineFromCard` | 唯一带有 `FromCard` 来源后缀的特异命名，破坏标准 CRUD 格式 | `application.createNarrativeTimeline`（`cardId` 作为入参字段） |
| **Prompt 子资源** | `application.createPromptResourceAsset` | 采用复合长命名，而其它子资源采用统一前缀 | 统一命名或规范化为 `promptResourceAssets.*` |
| **Prompt 导入** | `application.importPromptResource` | 与 `importCardBundle` 动宾结构不完全对称 | 保持对齐 |

---

### 🟡 [中] 4. 返回值结构不一致（Envelope 对称性缺失）

**现象分析：**
1. **Delete 操作返回格式割裂**：
   - `application.deleteCard` → `{ mutation: MutationReceipt, deletedCardId: string }`
   - `application.deleteProviderProfile` → `{ deleted: true }`
   - `application.deleteAgentProfile` → `{ deleted: true }`
   - `application.deleteAgentSession` → `{ deleted: true }`
   - `application.deletePromptResource` → `{ mutation: MutationReceipt, deletedResourceId: string }`
2. **解包（Unwrap）不统一**：
   - `application.listProviderModels` 返回 `{ modelIds: string[] }`，前端 API 解包为 `string[]`；
   - `application.pingProviderModel` 返回 `{ text: string }`，前端 API 解包为 `string`；
   - 其他接口均保持返回 Envelope 对象 `{ card }`、`{ timeline }`。

**建议：**
- 统一规范所有 Mutation 操作的返回体结构，确保携带统一的 `MutationReceipt` 或标准的 `{ success: boolean; id: string }` 结构。

---

### 🟡 [中] 5. 跨层直接穿透调用 Kernel RPC（命名空间混淆）

**文件：** [`apps/studio-client/src/shared/api/studio-api.ts` L154](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/api/studio-api.ts)

```ts
history: {
  revert: async changesetId => {
    // 前端大部分走 application.*，此处直接穿透调用底层 Kernel docs.revertChangeset
    const result = await bridge.call<{ changesetId: string }>('docs.revertChangeset', { changesetId })
    return { changesetId: result.changesetId }
  }
}
```

**问题分析：**
- 前端 `StudioApi` 绝大部分操作都被封装在 `application.*` 命名空间下。
- 历史回滚操作直接越过 Application 层，调用底层的 `docs.revertChangeset`，绕过了 `ApplicationRuntime` 的领域层上下文与事件广播。

**建议：**
- 增加 `application.revertChangeset`，由 Application Runtime 统一承接并记录业务级别的历史变更。

---

### 🟢 [低] 6. 后端手写解包样板代码庞大（~300 行 `rpc-params.ts` 串行提取）

**文件：** [`apps/studio-server/src/application-rpc.ts`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-server/src/application-rpc.ts)

**现象分析：**
每个 RPC 方法中都包含大量的显式参数读取：
```ts
case 'application.updateCard':
  return await runtime.updateCard({
    cardId: readString(params, 'cardId'),
    name: readOptionalString(params, 'name'),
    userName: readOptionalString(params, 'userName'),
    description: readOptionalString(params, 'description'),
    preset: readOptionalPreset(params, 'preset'),
    opening: readOptionalOpening(params, 'opening'),
    settingLayer: readOptionalSettingLayer(params, 'settingLayer'),
    media: readOptionalCardMedia(params, 'media'),
  }, context)
```
整个 `application-rpc.ts` 中有近 **400 行** 代码都在机械重复上述解包逻辑。

**建议：**
- 未来可引入轻量级 Schema 校验器（或统一映射器），消除上百行机械的 `readOptional*` 样板代码。

---

## 2. 审查与优化收益汇总

| 优化维度 | 问题描述 | 预期收益 |
|---|---|---|
| **术语对齐** | `ProviderProfile` vs `ProviderAccount` 前后端术语割裂 | 消除前端 30+ 行无意义字段翻译胶水代码 |
| **类型安全** | 客户端输入裸 `JsonObject` 导致类型检查丢失 | 恢复编译期入参提示与校验，杜绝字段拼错隐患 |
| **命名统一** | `createNarrativeTimelineFromCard` / `exportCardArtifact` 命名偏异 | 规范为标准统一的 CRUD RPC 接口 |
| **返回值对齐** | Delete 操作与解包格式不一致 | 统一错误与 Mutation 响应模型 |
| **命名空间收敛** | `docs.revertChangeset` 越层穿透 | 保持 Application 层统一门面封装 |
