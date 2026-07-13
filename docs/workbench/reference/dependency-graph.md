# 工作区包依赖关系图 (Dependency Graph)

Loom Studio 严格遵循依赖单向流动（从外围应用到内核）的设计原则。不允许出现循环依赖，也不允许内部基础设施依赖具体的应用逻辑。

## 依赖全景图

```mermaid
flowchart TD
    %% Define Styles
    classDef app fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef pkg fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;
    classDef ext fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px;

    %% Apps
    subgraph Apps["Applications (apps/)"]
        Client("apps/studio-client\n(Vite/React)"):::app
        Server("apps/studio-server\n(Node.js)"):::app
    end

    %% Extensions
    subgraph Extensions["Extensions (extensions/)"]
        ExampleEcho("example-echo"):::ext
        ProviderExt("provider-*"):::ext
    end

    %% Packages
    subgraph Packages["Core Packages (packages/)"]
        LoomCore("core\n@loom/core"):::pkg
        ClientBridge("client-bridge"):::pkg
        ApplicationRuntime("application-runtime"):::pkg
        Kernel("kernel"):::pkg
        DocumentStore("document-store"):::pkg
        LoomRunner("loom-runner"):::pkg
        Transport("transport"):::pkg
        ExtensionSdk("extension-sdk"):::pkg
        ExtensionHost("extension-host"):::pkg
        Shared("shared"):::pkg
        TraceAudit("trace-audit"):::pkg
        Diagnostics("diagnostics"):::pkg
    end

    %% Edges (Dependencies)
    Client --> ClientBridge
    Client --> Transport
    Client --> Shared

    Server --> Kernel
    Server --> ApplicationRuntime
    Server --> Transport
    Server --> ClientBridge
    Server --> DocumentStore

    ApplicationRuntime --> DocumentStore
    ApplicationRuntime --> Shared
    ApplicationRuntime --> LoomCore

    Kernel --> ExtensionHost
    Kernel --> DocumentStore
    Kernel --> LoomRunner
    Kernel --> TraceAudit
    Kernel --> Diagnostics
    Kernel --> Transport
    Kernel --> Shared

    ExtensionHost --> Shared

    ExtensionSdk --> Shared
    ExtensionSdk --> ExtensionHost

    LoomRunner --> LoomCore
    LoomRunner --> Diagnostics
    LoomRunner --> Shared

    ExampleEcho --> ExtensionSdk
    ProviderExt --> ExtensionSdk
```

## 核心约束规则

1. **受控 Core 依赖**：只有 `packages/loom-runner` 与 `packages/application-runtime` 被允许导入 `@loom/core` public API。前者负责平台 adapter，后者负责第一方 PromptBuild pipeline；其余模块不得直接依赖 Core。
2. **应用逻辑闭环**: `packages/kernel` 是一个纯粹的执行引擎，不允许导入 `packages/application-runtime`。所有的应用逻辑（如 Session, PromptBuilder 等）均在 Runtime 和 Server 层组装。
3. **共享基础**: `packages/shared` 和 `packages/transport` 位于最底层，不允许依赖除了外部库之外的任何工作区内的包。
