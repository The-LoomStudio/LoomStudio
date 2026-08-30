# AI Gateway Extension Capability Registry Plan

> **状态**：Archived / M1 已实施  
> **目标**：Extension 注册任意 AI Provider/Capability；Studio 统一提供发现、配置、Secret 与真正的 Profile 驱动 Gateway 调用。  
> **非目标**：LoomStudio 不内置 NovelAI、Embedding、Rerank、ComfyUI 等具体适配，也不统一它们的业务参数。

## 1. 核心判断

AI Gateway 不是第二套 Extension 系统。Extension Host 仍然负责 Package、Module、Instance、权限和卸载生命周期；AI Gateway 只提供一个新的 Extension contribution port：

```text
Extension Host
  └─ ctx.ai
       ├─ registerProvider(...)
       ├─ listProviders()
       └─ invoke(...)
```

Provider Extension 注册后，Studio 获得统一的发现、配置展示和调用入口。注册内容可以是文本生成，也可以是 Embedding、Rerank、生图、语音或任意自定义 Workflow。

“通用”指统一的平台注册、UI、调用和生命周期，不代表不同 Provider 的参数自动兼容。Capability id 是开放字符串；只有共同遵守同一 Capability Contract 的实现才可以无感替换。

## 2. AI Gateway 向 Extension 提供什么

### 2.1 Provider / Capability 注册

```ts
ctx.ai.registerProvider({
  provider: {
    id: 'example.comfyui',
    displayName: 'ComfyUI',
    accountFields: [
      { key: 'endpoint', label: 'Endpoint', type: 'string', required: true },
    ],
    credentialFields: [
      { key: 'token', label: 'Token', type: 'secret' },
    ],
    capabilities: [{
      id: 'comfyui.workflow.run',
      displayName: 'Run Workflow',
      inputSchema: workflowInputSchema,
      outputSchema: workflowOutputSchema,
      profileFields: [
        { key: 'workflowName', label: 'Workflow', type: 'string', required: true },
      ],
      inputFields: [
        { key: 'workflow', label: 'Workflow', type: 'json', required: true },
      ],
    }],
  },
  handlers: {
    'comfyui.workflow.run': async request => runWorkflow(request),
  },
})
```

Provider id 必须由 Extension Package 命名空间拥有。Capability id 可以是生态公共约定，也可以是 Extension 私有 id。

### 2.2 发现

```ts
const providers = ctx.ai.listProviders()
```

Studio UI、作者工具和其他 Extension 读取同一份 Registry。返回定义只包含可公开的字段描述，不包含 handler 或 secret value。

### 2.3 通用调用

```ts
const result = await ctx.ai.invoke({
  profileId: 'ai-capability-profile-id',
  input,
})
```

调用方只提供 `profileId + input`。Gateway 读取 Capability Profile 与 Provider Account，在 Secret Store 的授权回调内解析凭据，再调用当前已挂载的 Extension Handler。普通 Extension 与 Studio Client 均不能读取或注入 Secret。

```text
profileId + input
  → AI Capability Profile
  → Provider Account
  → Secret Store scoped use
  → registered Provider Handler
  → providerCallId + output
```

### 2.4 Schema 驱动 UI

Provider 与 Capability 可以分别注册 `accountSchema / credentialSchema / profileSchema / inputSchema / outputSchema`。UI 同时支持一组克制的 Field DSL 作为普通字段提示：

```text
string / number / boolean / select / secret / json
```

普通参数使用原生表单字段，复杂嵌套参数使用 `json`；没有 Field 提示时，UI 自动回退到原始 JSON 编辑器。Studio 不解释 ComfyUI Graph、NovelAI Sampler 或私有 Rerank 参数的语义。

Model Panel 的 Capability Lab 现在可以创建和调整 Provider Account、Credential、Capability Profile，并通过正式 `profileId` Gateway 执行调用。普通配置进入 Document Store；Credential 只写入 Secret Store，UI 只读取 `configured` 状态。

## 3. 生命周期

运行时注册是事实来源：

```text
Manifest declaration
  → Module activation
  → ctx.ai.registerProvider
  → Registry visible
  → Gateway resolves persisted Profile and Secret
  → invoke acquires Extension Scope lease
  → Module dispose stops new work
  → wait for in-flight invoke
  → registration disposed
  → Registry entry removed
```

现有 Extension Scope 已具备停止接单、AbortSignal、等待在途调用和逆序释放 Registration Handle 的能力；AI Gateway 直接复用，不建立平行生命周期。

## 4. Manifest 与权限

静态声明：

```json
{
  "capabilities": {
    "ai.invoke": true
  },
  "contributes": {
    "aiProviders": [
      { "id": "example.comfyui" }
    ]
  }
}
```

- `contributes.aiProviders` 声明本 Module 可以注册的 Provider id；
- `capabilities.ai.invoke` 表示本 Module 可以调用 Registry 中的 AI Capability；
- Development Mode 对未声明注册产生 diagnostics；Production Mode 拒绝；
- 注册句柄由 Extension Scope 自动释放。

## 5. Fake Provider

平台内置 `official.fake` 作为参考实现和开发工具。它首先是一个正常的 Provider Account，而不是绕过 Account、模型绑定或 Gateway 的测试开关。

当前提供：

```text
Fake Account (`official.fake`)
  ├─ fixed model: `fake-echo-m0`
  ├─ Agent Profile: preset + provider account + model binding
  └─ Capability Profile: `chat.completions` + profile-backed `ai.invoke`
```

创建 Fake Account 时不需要 Base URL、Credential 或 Provider 配置；服务端会自动启用唯一固定模型 `fake-echo-m0`。旧 Fake Account 会在 Runtime 初始化时移除早期实验配置并补齐固定模型，旧 `text.generate` Capability Profile 也会迁移到 `chat.completions`。

Fake AI 只模拟 LLM Chat Completion，不承担 Embedding、Rerank、生图或任意 Capability fixture。Agent Chat 选中该 Account/Model 后返回确定性的 assistant 消息；Capability Gateway 只注册 `chat.completions`，接收 OpenAI 风格的 `messages`，并返回 `chat.completion` 对象。调用方仍只提交 `profileId + input`，因此外部插件和 Studio Client 都通过正式 Gateway 模拟输入输出，而不是绕过 Account/Profile。

Fake 响应不提供 mode、模板、错误场景或其他可调参数。这是刻意保持的开发便利层；更复杂的模拟应由具体 Extension 或测试代码自行实现。

当前 Agent Chat 的历史 `createFakeAiGateway()` 无显式模型 fallback 仍保留为兼容路径；绑定 `official.fake` Account 与 `fake-echo-m0` 的主链会生成相同的 OpenAI Chat Completion 形状，不依赖 Account 配置。

## 6. 已实施范围

1. `@loom-studio/ai-gateway` 增加动态 Capability Registry。
2. Extension SDK 增加 `ctx.ai`、Manifest contribution 和调用权限。
3. Extension Host 将 Registration Handle 绑定现有 Instance Scope。
4. Studio Server 增加 `ai.providers.list` 与 `ai.invoke` RPC。
5. Model Panel 增加 Schema 驱动的 Capability Lab。
6. 注册 `official.fake` 作为平台参考 Provider。
7. 定向测试覆盖注册冲突、调用、卸载清理和 Fake 调用。
8. 复用 `airp.providerProfile` 作为 Provider Account，Credential 继续只保存 `secretRef`。
9. 新增 `airp.aiCapabilityProfile`，保存 Provider Account、Capability 与能力级普通配置。
10. `ai.invoke` 与 `ctx.ai.invoke` 收紧为 `profileId + input`，Registry 的原始 Handler 调用不再作为公开入口。
11. Gateway 在 `application.ai-gateway` 授权范围内读取 Secret，并仅在单次调用回调中交给 Provider Handler。
12. Provider Extension 卸载后 Account/Profile 保留并显示 unavailable；重新挂载后自动恢复。

## 7. 后续阶段

后续按真实需求再推进：

- 流式 Gateway Event；
- Asset Store 输出约定；
- well-known Capability Contract 与版本协商。

这些能力建立在同一个 Registry 上，不要求 LoomStudio 内置任何具体 Provider 参数。
