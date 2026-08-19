# Provider Profile 与通用 Secret Store 基建计划

> **状态**：In Progress / Provider Profile Backend Complete，Client Naming Cleanup Pending
> **日期**：2026-08-15
> **边界**：本计划独立于 Narrative Timeline / Agent Session 数据迁移。它只处理 Provider Profile、模型选择、通用 Secret Store、调用授权与现有明文凭据路径淘汰；不实现流式生成、模型参数面板、多用户权限、Key 轮询或 Provider Extension 完整生态。
> **相关决策**：[`ADR-004`](../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md)、[`AI Gateway and Provider Extension v0`](../discussion/platform/ai-gateway-and-provider-extension-v0.md)、[`Provider Adapter Contract v0`](../discussion/application/provider-adapter-contract-v0.md)。

## 1. 背景与当前事实

当前 Provider 链已经能完成 OpenAI-compatible Chat Completion，但数据模型和安全边界仍是开发期形态：

- `ProviderAccount` 保存连接配置和 `secretRefs`；
- 每个启用模型被建模成独立 `ModelProfile` Document；
- Agent Local Binding 与 Gateway 通过 `modelProfileId` 选择模型；
- Studio Client 会把用户输入的 API Key 包装成 `plain:<value>` 发送；
- Application Runtime 只在 RPC 返回值中把 `plain:` 内容替换成 `plain:***`，数据库中的值仍是明文；
- Gateway 当前直接解析 `plain:` / `env:`，`secret:` 尚未实现；
- 当前 `clientId`、`http-local` 等调用身份是追踪信息，不是认证凭据。

这意味着现有代码可以用于开发验证，但不能作为正式 Secret 方案。只给返回结果加掩码不能保护数据库、备份、日志误采集、插件越权或未授权本地调用。

## 2. 本阶段确定的产品模型

### 2.1 删除独立 Model Profile

前端当前把模型展示成 Provider 下的启用列表，并没有把它当作独立配置实体。下一阶段删除独立 `ModelProfile` Document、CRUD 和 `modelProfileId` 引用。

Provider Profile 保存用户可选模型：

```ts
type ProviderProfileContent = {
  providerExtensionId: string
  displayName: string
  config: JsonObject
  secretRef?: SecretRef
  enabledModelIds: string[]
  createdAt: string
  updatedAt: string
}
```

消费者保存一个嵌入式选择值，而不是引用模型 Document：

```ts
type ProviderModelSelection = {
  providerProfileId: string
  modelId: string
}
```

`ProviderModelSelection` 是值对象，不拥有独立 ID、版本、CRUD 或数据表。Agent、总结器、素材生成工具和未来 Extension 能力都复用这一形状。

### 2.2 模型参数保持极简

M0 不提供以下配置：

- `temperature`；
- `top_p`；
- frequency / presence penalty；
- reasoning effort / thinking budget；
- seed、stop、response format 等 Provider 特有参数。

最大输入和输出 Token 上限在内部可表示为 `null`，但 Provider Payload 必须省略对应字段，不能发送 JSON `null`。本阶段不主动截断输入，也不尝试在调用前精确计算各 Provider Token；超过限制时由 Provider 返回规范化错误。

### 2.3 一个 Provider Profile 绑定一份 Secret

不实现 Key 池、轮询、自动故障切换或多个账号共享 Secret。用户需要两个账号或两套凭据时，创建两个 Provider Profile。

Provider Profile 的 Secret 可以是一份凭证包，以兼容未来需要多个相关字段的单个凭证：

```ts
type SecretPlaintext = {
  values: Record<string, string>
}
```

这不代表支持多个轮询 Key；它仍是一份 Secret、一个所有者和一个生命周期。

## 3. 通用 Secret Store 定位

Secret Store 是 Platform Security 能力，不属于 Provider，也不进入 ordinary Extension。Provider API Key 只是第一位消费者，未来还可能保存：

- 外部服务 Token；
- Extension 受控凭据；
- Webhook Secret；
- 对象存储或数据库凭据；
- 签名密钥或其他平台认证材料。

因此 Store 使用通用所有权和用途元数据：

```ts
type SecretRef = `secret:${string}`

type SecretMetadata = {
  id: string
  ownerType: string
  ownerId: string
  purpose: string
  label?: string
  createdAt: string
  updatedAt: string
}
```

M0 约束：

- `SecretRef` 使用随机、不透明 ID，不包含路径、Key 名、Provider 名或存储后端信息；
- 一份 Secret 只有一个所有者，不支持共享引用；
- SQL 只保存元数据和所有权绑定，不保存明文；
- Secret 明文优先进入操作系统凭证库；macOS 首个后端使用 Keychain；
- 不自行发明加密算法，也不把加密主密钥和密文保存在同一数据目录；
- Provider Profile 删除时默认级联删除其 Secret；
- Provider、Card、Workspace 或 Extension 导出默认排除 Secret。

跨平台后端只保留最小内部接口，不在 M0 同时实现多个后端：

```ts
type SecretBackend = {
  put(id: string, value: SecretPlaintext): Promise<void>
  read(id: string): Promise<SecretPlaintext | undefined>
  delete(id: string): Promise<void>
}
```

该接口是平台内部存储边界，不是 Extension Host 或 RPC API。

## 4. 权限与 Auth 边界

### 4.1 禁止通用明文读取 RPC

系统不得公开以下能力：

```ts
getSecret(secretRef)
decrypt(secretRef)
listSecretValues()
```

官方 Client 只需要：

- 创建凭据；
- 整体替换凭据；
- 删除凭据；
- 查看 `configured`、`updatedAt` 等元数据。

前端永远不回填旧 Secret。编辑页面只能显示“已配置”，用户输入新值时执行整体替换。

第一阶段不急于暴露通用 `secrets.*` RPC。Provider Application API 可以调用内部 Secret Store 完成创建、替换和删除；未来出现第二个真实消费者后，再提炼通用的写入与状态 RPC。

### 4.2 受控使用能力

只有 AI Gateway 或其他被平台明确注册的受信任服务能够在用途检查后使用 Secret：

```ts
withSecret(ref, {
  caller,
  ownerType,
  ownerId,
  purpose,
}, operation)
```

每次使用至少校验：

1. 调用者拥有对应平台 Capability；
2. Secret 的 owner 与最终解析出的资源一致；
3. 本次 purpose 与 Secret 元数据一致；
4. Provider Profile、Provider Adapter 和目标请求属于同一次已授权调用；
5. Secret 不进入返回值、异常正文、Event、Log、Trace 或 Document。

ordinary Extension 默认没有 Secret 明文读取能力。Provider Adapter 优先声明认证字段和请求结构，由 Gateway 在网络发送前注入凭据；不得把 Secret 交给 Adapter 后再依赖插件自律。

### 4.3 本地单用户 Auth

本阶段不建设多用户、角色或 ACL 系统，但“单用户”不等于“不认证”。正式运行至少需要：

- Server 默认只监听 loopback；
- 官方 Client 使用启动期建立的高熵应用会话凭据；
- Provider / Secret mutation RPC 校验真实会话身份，而不是信任可伪造的 `clientId`；
- 生产模式限制允许的 Origin，并防止其他网页借 localhost API 发起写操作；
- Extension Host 继续 default-deny，Secret Capability 不进入普通 Host；
- 工作区锁定或操作系统凭证库不可用时，Secret 使用必须 fail closed。

本地 Web 合同已固定为 Server 启动期高熵凭据与 HttpOnly Cookie；开发期 Vite 只代理该同一合同，不接触 Token。Electron、Tauri、iOS 与 Android 等原生壳后续使用受控 Native IPC 注入，不要求绕回本地 HTTP。

## 5. Provider 调用合同

Gateway 调用从：

```ts
invokeChat({ modelProfileId, request })
```

迁移为：

```ts
invokeChat({
  model: {
    providerProfileId,
    modelId,
  },
  request,
})
```

调用顺序固定为：

```text
Consumer
  -> ProviderModelSelection
  -> Gateway 读取 Provider Profile
  -> 校验 modelId 位于 enabledModelIds
  -> 校验 Provider Adapter
  -> 受控解析 Secret
  -> 构造并发送 Provider 请求
  -> 归一化结果 / usage / error
```

消费者不接触 Base URL、Secret、Authorization Header、HTTP、SSE 或 Provider 原生响应。Provider 模型目录由 Adapter 的 `listModels` 能力按需获取；`enabledModelIds` 是用户本地选择清单，不是模型能力权威数据库。手动输入模型 ID继续作为降级入口。

## 6. API 与 DTO 收束

Provider Profile 返回给 Client 时不暴露 `secretRef`，只返回状态：

```ts
type ProviderProfileView = {
  id: string
  version: number
  providerExtensionId: string
  displayName: string
  config: JsonObject
  enabledModelIds: string[]
  credential: {
    configured: boolean
    updatedAt?: string
  }
}
```

第一阶段 Application RPC 建议收束为：

```text
application.createProviderProfile
application.getProviderProfile
application.listProviderProfiles
application.updateProviderProfile
application.replaceProviderCredential
application.deleteProviderProfile
application.listProviderModels
application.pingProviderModel
```

`pingProviderModel` 接受 `providerProfileId + modelId`。不再保留 Model Profile CRUD。

Secret 写入的明文只允许出现在该次 mutation request 的内存中。Transport、RPC logger 和错误映射不得记录请求正文；成功响应只返回 credential status。

## 7. 实施阶段

当前进度：通用 `@loom-studio/secret-store` Package、SQLite metadata、内存测试 backend、受控 `withSecret`、替换/删除失败清理队列和安全不变量测试已经落地。桌面端已通过 `@napi-rs/keyring` 接入 macOS Keychain、Windows Credential Manager 和 Linux Secret Service，并完成 macOS 真实写入、读取、删除探针。

本地 Web 运行已经加入应用会话 Auth：Server 启动期生成高熵凭据，`POST /auth/session` 仅允许 Origin、Host 完全一致的 loopback 来源建立 `HttpOnly; SameSite=Strict; Path=/` Cookie；`/health` 之外的 RPC、Asset、Card 导入导出、Extension Icon 和 SSE 均要求该会话。Client 在 React 挂载前完成 bootstrap，Vite 开发代理同步转发 `/auth`。该边界不把 Token 暴露给 JavaScript、URL、日志或 Document，并以会话身份替代 HTTP 入口原先固定的 `http-local` 追踪值。

Provider 后端已经完成单轨迁移：权威 Document 只保留 `airp.providerProfile`，启用模型进入 `enabledModelIds`，Agent Local Binding 与 Gateway 使用 `{ providerProfileId, modelId }`。独立 Model Profile CRUD、`plain:` / `env:` 凭据解析和模型高级参数 Payload 已删除。Provider Credential 通过 Application RPC 写入通用 Secret Store，Client DTO 只返回配置状态；Gateway 仅以 `application.ai-gateway` 调用者和匹配 owner / purpose 执行 `withSecret`。

Client 数据请求已经接到新 RPC，现有模型面板把 `enabledModelIds` 投影为列表以维持当前 UI；旧 `ProviderAccount` / `ModelProfile` 的前端内部命名与 Agent Runtime 草稿仍需在 Phase 5 单独清理。iOS / Android Auth 与 Secret backend 仍等待原生壳。

### Phase 1：Schema 与安全不变量

1. 固化 `ProviderProfileContent`、`ProviderModelSelection`、`SecretRef` 和 `SecretMetadata`；
2. 把 `plain:` 路径登记为必须删除的开发期债务；
3. 明确正式桌面部署拓扑和本地应用会话凭据传递方式；
4. 为 Secret RPC、日志、Trace、备份和 Extension Host 建立禁止泄漏检查清单。

验收：正式 Schema 中不存在 API Key 明文字段、`ModelProfile` 或通用 Secret read RPC。

### Phase 2：内部 Secret Store

1. 建立平台内部 Secret Store 与最小 Keychain backend；
2. SQL 保存通用元数据和 owner 绑定；
3. 实现 create / replace / status / delete / controlled-use；
4. 验证失败回滚：Document 创建失败不得遗留孤儿 Secret，Secret 删除失败不得伪报 Provider 已完全删除；
5. 加入日志和异常脱敏测试。

验收：数据库、普通 RPC、日志和 Trace 中均不存在 Secret 明文；重启后仍能通过受控 Gateway 调用使用凭据。

### Phase 3：本地 Auth 与 Capability Gate

1. 为正式 Server / Client 建立本地应用会话认证；
2. Provider / Secret mutation 使用真实身份校验；
3. AI Gateway 获得用途受限的 Secret 使用能力；
4. ordinary Extension、Client Extension 和普通 Server Extension 默认拒绝；
5. 验证跨 Origin、伪造 `clientId` 和猜测 SecretRef 均不能读取或替换凭据。

验收：未认证调用不能创建、替换、删除或使用 Secret；通过 Extension Host 也不能取得明文。

进度：本地 HTTP Application Session 与敏感入口统一认证已完成；Provider mutation、Gateway `withSecret` 和 Capability Gate 随 Phase 4 迁移实现。

### Phase 4：Provider Profile 单轨迁移

1. `ProviderAccount` 重命名和收束为 `ProviderProfile`；
2. 把已启用模型迁移为 `enabledModelIds`；
3. 删除 Model Profile Document、Store 查询、RPC 和 Client entity；
4. Agent Local Binding 等消费者改用嵌入式 `ProviderModelSelection`；
5. Gateway、Prompt preview、ping 和 Provider logging 改用 `providerProfileId + modelId`；
6. Provider Payload 不再读取 Model Profile config，也不发送未支持参数和 `null` Token 上限。

当前 Provider 数据主要用于开发测试。本阶段不迁移 `plain:` 凭据；用户必须重新输入 Secret。无价值的旧 Model Profile 可以直接删除，不为其增加兼容层。

验收：一次真实调用只需 Provider Profile、模型 ID、Canonical Request 和受控 Secret；代码中不再存在 `modelProfileId` 主路径。

进度：后端 Schema、Application RPC、Agent Binding、Gateway、Provider Payload、日志和测试已完成；没有旧数据兼容层。Client 已消费新 RPC，但内部展示层命名清理归入 Phase 5。

### Phase 5：Client 接轨与清理

1. 保留当前 Provider 列表和启用模型交互；
2. Provider 创建/编辑只展示 Secret 配置状态与替换入口；
3. 所有模型消费者统一使用 Provider + enabled model 两级选择器；
4. 删除 `plain:`、旧 Model Profile 文案、API、测试和孤儿代码；
5. 更新 Architecture、RPC Reference、Document Types 与相关延期计划。

验收：Client 不保存、回填或读取旧 Secret；消费者不能选择未启用模型；删除 Provider Profile 会明确处理其引用并级联删除独占 Secret。

## 8. 明确非目标

本阶段不实现：

- 多用户登录和角色权限；
- Secret 共享、版本历史、轮换计划和 Key 池；
- 云端 Secret Manager；
- 自定义 AES 密文文件；
- 自动模型参数调优；
- Tokenizer、输入裁剪和上下文预算器；
- Provider SSE / WebSocket 流式执行；
- 插件自由读取 Secret 或自由发送带凭据的网络请求；
- Provider 健康状态轮询。

## 9. 开放实施门

编码前仍需确认两个部署事实：

1. 浏览器 / 本地 HTTP 交付采用 Studio Server 同源提供前端与 RPC；Electron、Tauri、Android、iOS 等原生壳使用受控 Native IPC，不为形式上的同源额外绕 HTTP；
2. 应用会话凭据采用启动期高熵、短生命周期的经典 Session Credential：Web 优先使用 HttpOnly + SameSite Cookie，原生壳通过受控 IPC 注入；不进入 LocalStorage、URL、日志或普通 Document；
3. 正式目标覆盖 macOS Keychain、Windows Credential Manager / DPAPI、Linux Secret Service、iOS Keychain 与 Android Keystore。桌面后端优先落地；移动端后端随原生壳实现，不退化成明文存储。

这些部署决策已经锁定。具体平台 API 或原生桥依赖仍需在对应后端实施前单独核验，但不得改变本文的数据模型、权限不变量和 Provider 调用合同。
