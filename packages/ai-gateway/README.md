# `@loom-studio/ai-gateway`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/ai-gateway` 是 Loom Studio 统一的大语言模型调度网关。它封装多模型厂商协议，提供流式生成响应、工具调用（Function Calling）生命周期管理、能力画像映射与离线测试支持。

## 业务使命与设计架构

在多 Agent 与多角色叙事场景中，不同模型供应商（OpenAI、Anthropic、Google 及各类兼容 OpenAI 协议的本地推理框架）的调用参数、流式协议与错误格式各不相同。
`@loom-studio/ai-gateway` 提供统一的门面层：
- **统一模型抽象**：基于 Vercel AI SDK 标准化各厂商接入；
- **流式运行模型 (`AiGatewayRun`)**：统一输出 `text-delta`、`tool-call`、`finish` 与 Token 使用量统计（`AiGatewayUsage`）；
- **画像与凭据解析 (`ProfiledAiGateway`)**：结合 `@loom-studio/secret-store`，根据当前请求模型 Profile 动态解析对应的真实系统凭据；
- **能力注册表 (`AiGatewayCapabilityRegistry`)**：支持平台内建 Provider 与 Extension 动态注入的自定义模型能力；
- **官方 Fake Provider**：内置 `createOfficialFakeChatCompletion()`，提供可预测的离线模拟调用能力，支持脱机开发与自动化测试。

---

## 架构规约与外部依赖所有权 (Rules & Boundaries)

1. **唯一合法的大模型调用入口**：
   - **全仓所有 LLM 调用必须通过本包发起**；
   - 业务代码（如 `application-runtime`、Extension 等）**严禁直接安装或 import `@ai-sdk/*`、`openai` 等厂商 SDK**，杜绝碎片化调用。
2. **Schema 校验规范**：
   - 外部 Provider 配置使用 `zod` 执行运行时边界校验，内部可信数据传递保持纯 TypeScript 契约。
3. **无状态调度**：
   - 网关只负责单次会话或单次 Tool Step 的请求与流式回传，**不维护聊天时间线历史或会话持久化**（这些属于 `application-runtime` 和 `application-data`）。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createAiGateway(options)`：基础网关工厂；
- `createProfiledAiGateway(options)`：带凭据解析与能力画像的高级网关；
- `createAiGatewayCapabilityRegistry()`：能力注册表；
- `createOfficialFakeChatCompletion()` / `officialFakeModelId`：离线测试 Fake Provider；
- 子路径 [`contracts`](./src/contracts.ts)：轻量化提供者合同导出；
- 核心类型：`AiGatewayRequest`、`AiGatewayResult`、`AiGatewayRun`、`ProfiledAiGateway`、`ResolvedAiCapabilityProfile`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/ai-gateway build

# 运行网关单元与流式测试
pnpm exec vitest run tests/unit/ai-gateway
```

---

## 正式文档

- [External Dependency Ownership 依赖所有权](../../docs/architecture/platform/external-dependency-ownership.md)
- [Application 核心领域架构](../../docs/architecture/application/README.md)
