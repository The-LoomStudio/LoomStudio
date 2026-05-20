# Loom Studio Extension Manifest Architecture

> **Status**: Draft v0.1（Manifest 与插件生态边界，2026-05-11）
> **Purpose**: 明确 Loom Studio Extension Manifest 的职责、最小字段、动态注册关系、Server/Client 插件边界、贡献点模型、依赖/冲突方向，以及开放 `meta` 的规则。
> **Audience**: Studio Kernel / Plugin Host 实现者、Extension SDK 作者、Extension 作者、DevTool 作者、插件管理器/市场实现者。
> **Non-Replacement**: 本文不替代 Studio 总体架构、数据层 ADR 或未来 Manifest ADR。它先作为架构讨论稿，约束第一版 Manifest 设计方向。

---

## 0. 本文解决什么问题

Loom Studio 是一个 Extension 平台，而不是单纯应用。插件生态需要 Manifest，但 Manifest 过度复杂会直接伤害开发体验。

本文回答：

1. Extension 在工程形态上应该如何区分？
2. Manifest 的职责是什么，不是什么？
3. Server Extension 的 RPC 能力如何声明和实际注册？
4. Client Extension 是否应该通过 `window.xx` 暴露能力？
5. `contributes` 中各类贡献点为什么存在？
6. 如何降低 Manifest 对普通插件作者的负担？
7. `meta` 是否可以开放给子级生态？
8. 哪些字段应该进入核心 Manifest，哪些不应该？

核心判断：

> **Manifest 是 Extension 的静态安装描述和能力索引，不是能力实现本身。**
>
> **Runtime registration is truth. Manifest declaration is contract.**

---

## 1. 设计原则

### 1.1 最小必填，渐进增强

普通插件作者不应该被迫填写大而全的 Manifest。

最小插件 Manifest 应该只需要：

```json
{
  "manifestVersion": 1,
  "id": "example.hello",
  "version": "0.1.0",
  "displayName": "Hello Extension",
  "engines": {
    "studio": "^0.1.0"
  },
  "server": {
    "entry": "./dist/server.js"
  }
}
```

高级字段只在确有需要时出现。

不要求写空数组：

```json
{
  "contributes": {
    "rpc": [
      { "name": "example.hello.sayHello" }
    ]
  }
}
```

而不是：

```json
{
  "contributes": {
    "rpc": [],
    "documentTypes": [],
    "events": [],
    "commands": [],
    "panels": [],
    "conceptStacks": [],
    "workspaceAdapters": []
  }
}
```

### 1.2 Manifest 不应该重复代码负担

最坏的设计是：

```text
代码里注册一遍 RPC；
manifest 里手写一遍 RPC；
文档里再写一遍 RPC；
schema 路径也要手写维护。
```

Loom Studio 应支持：

```text
开发时：
  代码动态注册为准。

发布时：
  Manifest 作为静态 contract snapshot。

工具：
  可从 runtime registration 生成或同步 manifest contributes。
```

建议工具流：

```text
loom ext dev
loom ext inspect
loom ext sync-manifest
loom ext validate
```

### 1.3 Server / Client 是硬工程边界，Role 是软标签

Extension 在工程形态上只需要硬区分：

```text
Server Extension
Client Extension
Full Extension = server + client
```

它们影响：

- 运行位置；
- 隔离方式；
- 入口加载；
- 权限边界；
- 生命周期；
- 是否能注册后端 RPC。

而这些不应成为硬插件类型：

```text
runtime
provider
tool
MCP bridge
concept stack
workspace adapter
devtool panel
theme
extension pack
```

这些只是：

```text
roles: 用于插件管理器展示、搜索、分类。
contributes: 用于声明实际贡献能力。
```

示例：

```json
{
  "roles": ["provider", "devtool"],
  "contributes": {
    "rpc": [
      { "name": "official.provider.openai.invoke" }
    ],
    "panels": [
      { "id": "official.provider.openai.profilePanel", "title": "OpenAI Provider Profile" }
    ]
  }
}
```

`roles` 不能用于权限判断、RPC dispatch、加载排序或数据 ownership。

---

## 2. Manifest 的职责边界

Manifest 负责：

```text
1. identity
2. compatibility
3. entrypoints
4. permission / capability declaration
5. dependency / conflict declaration
6. static contribution index
7. marketplace / plugin manager metadata
8. child ecosystem metadata namespace
```

Manifest 不负责：

```text
1. 实现 RPC handler
2. 保存用户设置
3. 保存 provider API key
4. 定义完整业务配置
5. 替代 runtime registration
6. 替代 Document Store
7. 承载 Runtime 业务状态
```

插件自己的业务配置应放在 Document Store 或 Extension-managed storage 中，不应塞进 Manifest。

例如 provider API key 不应写在 Manifest。

---

## 3. Server Extension 能力声明与动态注册

### 3.1 Manifest declaration + runtime registration

Server Extension 的公开能力应采用：

```text
Manifest 静态声明 + 激活后动态注册
```

流程：

```text
1. Studio 读取 manifest。
2. Plugin Host 校验 id / version / engines / dependencies / conflicts。
3. 根据 manifest 启动 server extension。
4. server extension activate。
5. server extension 调 registerRpc / registerDocumentType / registerEvent 等。
6. Plugin Host 对比 manifest 声明和实际注册。
7. 一致则标记 active。
8. 不一致则 diagnostics / degraded / disabled。
```

Manifest 表示 intent / contract：

```text
这个插件预期提供这些 public contributions。
```

Runtime registration 表示 actual truth：

```text
这个插件当前实际注册成功了这些能力。
```

### 3.2 为什么不能只靠 Manifest

Manifest 可能声明了：

```json
{
  "contributes": {
    "rpc": [
      { "name": "example.foo" }
    ]
  }
}
```

但实际可能：

- 插件进程启动失败；
- handler 没注册；
- schema 文件缺失；
- capability 未授权；
- 依赖插件未加载；
- 版本不兼容。

所以必须有 runtime registration 确认。

### 3.3 为什么不能只靠动态注册

如果完全不在 Manifest 写 contributes：

- 插件管理器在未启动前不知道插件能力；
- Marketplace 无法索引；
- 安装前无法展示权限和能力；
- 冲突检测必须启动插件后才知道；
- 依赖解析困难；
- 恶意插件可以运行后偷偷注册额外 public RPC；
- 用户无法理解安装了什么。

因此 Manifest 仍然需要作为静态入口。

### 3.4 三种严格度

#### Dev Mode

```text
允许注册 manifest 未声明的 public contribution。
允许 manifest 声明但 runtime 未注册。
生成 diagnostics。
支持自动 sync manifest。
```

#### Installed Mode

```text
runtime 注册未声明 public RPC -> warning 或禁用该 RPC。
manifest 声明但未注册 -> plugin degraded。
capability 未授权 -> RPC unavailable。
```

#### Marketplace / Signed Mode

```text
runtime public contributions 必须是 manifest 声明子集。
manifest 声明必须可验证。
权限必须完整声明。
不允许偷偷注册额外 public RPC。
```

---

## 4. Client Extension 不使用任意 `window.xx` 作为平台契约

### 4.1 不推荐裸 `window.xx`

Client Extension 不应通过主窗口上的任意全局对象来暴露能力，例如：

```js
window.myExtension = { ... }
```

原因：

- 全局命名冲突；
- 生命周期不可控；
- 无法追踪 owner extension；
- 难以卸载和热重载；
- 容易绕过 capability / audit / transport；
- 安全边界不清楚；
- 插件间调用无法做版本和依赖管理。

### 4.2 推荐 Client Host Bridge

Client Extension 应在隔离环境中运行：

```text
iframe / webview / module sandbox
```

并通过受控 bridge 与 Studio 通信。

可以允许插件 bundle 在自己的 sandbox 内暴露唯一入口：

```js
window.LoomClientExtension = {
  activate(ctx) {
    ctx.registerPanel("example.panel", ...)
  }
}
```

但这个 `window.LoomClientExtension` 只是插件 sandbox 内的入口约定，不是 Studio 主窗口的全局发现机制。

更理想的 ESM 形式：

```ts
export default createClientExtension({
  async activate(ctx) {
    ctx.registerPanel("example.panel", panel)
  }
})
```

### 4.3 Client Extension 可以调用 RPC，但不直接注册后端能力

Client Extension 可以：

- register panel；
- register UI command；
- render editor；
- call authorized RPC；
- subscribe allowed events；
- show diagnostics view。

Client Extension 不应：

- 直接写 Kernel internals；
- 绕过 Transport；
- 直接访问 Document Store 内部对象；
- 直接注册 server RPC handler。

---

## 5. `engines` 字段

### 5.1 `engines.studio` 必须有

```json
{
  "engines": {
    "studio": "^0.1.0"
  }
}
```

`engines.studio` 表示该插件兼容哪个版本范围的 Loom Studio Extension Host / Protocol / Plugin API。

它解决：

```text
这个插件能不能被当前 Studio 安全加载？
```

### 5.2 `node` 不应是全局必填

不推荐每个插件都写：

```json
{
  "engines": {
    "studio": "^0.1.0",
    "node": ">=20"
  }
}
```

Node 版本只在 Node-based Server Extension 对 Node 有特殊要求时有意义。

默认规则：

```text
Studio 使用 bundled Node LTS。
插件不声明 node 版本时，使用 Studio 默认 Node runtime。
```

如需特殊 Node 版本，可放在 server entry 下：

```json
{
  "server": {
    "loader": "node",
    "entry": "./dist/server.js",
    "engines": {
      "node": ">=22"
    }
  }
}
```

适用场景：

- 插件用到特定 Node API；
- 插件以 external process 使用系统 Node；
- 插件依赖 native module，受 Node ABI 影响；
- 插件明确不兼容 Studio bundled Node。

---

## 6. `contributes` 字段解释

`contributes` 是 Extension 对 Studio 生态的声明式能力索引。

它不是运行时代码入口。

### 6.1 `contributes.rpc`

示例：

```json
{
  "contributes": {
    "rpc": [
      {
        "name": "official.provider.openai.invoke",
        "description": "Invoke an OpenAI-compatible model."
      }
    ]
  }
}
```

用途：

- 声明插件预期注册的 public RPC；
- RPC namespace collision 检查；
- DevTool introspection；
- capability / audit 关联；
- 插件管理器展示能力；
- 发布前安全审核。

真实 handler 由 Server Extension 在激活时注册。

### 6.2 `contributes.documentTypes`

示例：

```json
{
  "contributes": {
    "documentTypes": [
      {
        "type": "official.sillytavern.worldbook.entry",
        "displayName": "Worldbook Entry",
        "schema": "./schemas/worldbook-entry.schema.json"
      }
    ]
  }
}
```

用途：

- 声明插件定义/拥有的 typed JSON Document；
- schema 校验；
- DevTool 展示；
- document ownership；
- permission scope；
- migration；
- query / introspection；
- 插件卸载影响分析；
- document type 冲突检查。

Kernel 不理解这些 document type 的业务语义。

它只知道：

```text
某个 type 由某个 extension 贡献，并可携带 schema / display metadata。
```

### 6.3 `contributes.events`

示例：

```json
{
  "contributes": {
    "events": [
      {
        "name": "official.workspace.import.completed",
        "description": "Emitted after workspace import succeeds."
      }
    ]
  }
}
```

这里的 `events` 表示插件可能发布的 public events，不表示订阅事件。

用途：

- Event introspection；
- event name collision 检查；
- payload schema 文档化；
- 让其他插件知道可订阅事件；
- DevTool 展示 event source。

订阅事件应放在 activation 或 subscription 机制中，不应混入 `contributes.events`。

MVP 可以只支持系统事件，第三方 event contribution 可后置。

### 6.4 `contributes.commands`

示例：

```json
{
  "contributes": {
    "commands": [
      {
        "id": "official.workspace.syncNow",
        "title": "Workspace: Sync Now",
        "rpc": "official.workspace.syncNow"
      }
    ]
  }
}
```

Command 是用户可触发动作，不等同于 RPC。

用途：

- command palette；
- 菜单/工具栏；
- 快捷键；
- context-aware action；
- 用户可理解的动作标题。

一个 command 可以调用 RPC，但还需要 UI 语义：

- title；
- category；
- icon；
- when condition；
- confirmation；
- keybinding。

### 6.5 `contributes.panels`

示例：

```json
{
  "contributes": {
    "panels": [
      {
        "id": "official.workspace.diagnostics",
        "title": "Workspace Diagnostics",
        "entry": "diagnosticsPanel"
      }
    ]
  }
}
```

Panel 是 Client Extension 贡献的 UI 面板。

用途：

- DevTool panel；
- provider profile panels；
- trace timeline；
- workspace diagnostics；
- custom document editor；
- runtime-specific UI。

Studio Web UI 不应写死所有界面。Panel contribution 让插件可以扩展 UI，同时仍通过 Client Host Bridge 和 Transport 通信。

### 6.6 `contributes.conceptStacks`（历史草案，待重写）

> **2026-05-20 方向修正**：`Concept Stack` 不再作为主要正式概念；默认完整 AIRP 体验将收束为 Studio 第一方内建 `Studio AIRP Layer` / package layer，而不是 ordinary extension contribution。因此本节为历史草案，后续应删除或重写为第三方上层体验 / workspace adapter / importer 的贡献模型。

示例：

```json
{
  "contributes": {
    "conceptStacks": [
      {
        "id": "official.sillytavern",
        "displayName": "SillyTavern Compatible Stack"
      }
    ]
  }
}
```

历史草案中的 Concept Stack 定义一套项目语义和编译规则。

它可以定义：

- 项目里有哪些 document type；
- 哪些 authoring content 可以编译成 Fragment；
- prompt / worldbook / character / preset 的概念模型；
- 如何生成 runtime artifact；
- 需要哪些 Loom passes；
- 如何导入导出；
- 推荐搭配哪些 runtime。

为什么需要声明：

```text
项目可能声明 conceptStack = official.sillytavern。
Studio 必须知道该 concept stack 是否已安装，以及由哪个 extension 提供。
```

这不意味着 Kernel 理解 concept stack 业务语义。新方向下，默认 AIRP 能力不应依赖该 ordinary extension contribution。

### 6.7 `contributes.workspaceAdapters`

示例：

```json
{
  "contributes": {
    "workspaceAdapters": [
      {
        "id": "official.sillytavern.workspace",
        "forConceptStack": "official.sillytavern",
        "displayName": "SillyTavern Dev Workspace",
        "features": ["export", "import", "watch", "validate", "build", "package"]
      }
    ]
  }
}
```

Workspace Adapter 负责某个上层体验或数据格式的 Dev Workspace 映射。旧文档中 “Concept Stack” 表述待后续重写。

它知道如何：

- export SQL documents -> workspace files；
- import changed files -> document patches；
- validate source files；
- maintain source map；
- build runtime artifact；
- package distribution output。

为什么需要单独声明：

- 不是所有上层体验都有 Dev Workspace；
- 一个上层体验可能有多个 workspace layout；
- Workspace Sync 是 DevTool / Authoring 能力，不是 Kernel 领域能力；
- Studio 需要知道当前项目可用哪些 adapter。

---

## 7. `meta` 开放命名空间

### 7.1 `meta` 的目的

`meta` 是开放、命名空间化的扩展区域。

它可以服务子级生态，例如：

- 某个上层体验的额外索引；
- 某个 Marketplace 的展示字段；
- 某个社区 mod manager 的分类；
- 某个游戏式 modpack 的 load priority；
- 某个组织内部审核信息；
- 某个 AI assistant 的提示；
- 某个 registry 的签名或 provenance；
- 某个子生态的兼容标签。

### 7.2 命名空间规则

不推荐：

```json
{
  "meta": {
    "foo": "bar"
  }
}
```

推荐：

```json
{
  "meta": {
    "official.marketplace": {
      "featured": true,
      "category": "Provider"
    },
    "community.roleplay": {
      "style": "longform",
      "recommendedFor": ["character-card", "worldbook-heavy"]
    },
    "official.sillytavern": {
      "compatibleCardVersions": ["v2", "v3"]
    }
  }
}
```

规则：

```text
meta keys 必须是 namespace。
Studio Core 不解释未知 namespace。
Studio 必须 preserve unknown meta on read/write。
meta 不参与核心加载决策，除非某个已安装插件显式声明自己理解该 namespace。
```

### 7.3 `meta` 不能替代核心字段

凡是影响以下行为的字段，不能放进 `meta`：

```text
加载
执行入口
权限
依赖解析
冲突判断
安全审计
核心 contribution registration
```

这些不应该放入 `meta`：

```json
{
  "meta": {
    "my.loader": {
      "entry": "./server.js"
    },
    "permissions": ["network.fetch"],
    "dependencies": ["other.extension"]
  }
}
```

如果 Studio Core 需要解释它，它就不是 `meta`。

---

## 8. 假想例子：OpenAI Provider Extension

### 8.1 目录

```text
official-provider-openai/
  loom.extension.json
  server/dist/index.js
  client/dist/index.js
  schemas/provider-profile.schema.json
```

### 8.2 Manifest

```json
{
  "manifestVersion": 1,
  "id": "official.provider.openai",
  "version": "0.1.0",
  "displayName": "OpenAI Provider",
  "description": "Provides OpenAI-compatible model invocation and model listing.",
  "roles": ["provider"],

  "engines": {
    "studio": "^0.1.0"
  },

  "server": {
    "loader": "node",
    "entry": "./server/dist/index.js"
  },

  "client": {
    "entry": "./client/dist/index.js"
  },

  "activation": {
    "events": ["onStartup"]
  },

  "contributes": {
    "rpc": [
      {
        "name": "official.provider.openai.invoke",
        "description": "Invoke an OpenAI-compatible chat completion API."
      },
      {
        "name": "official.provider.openai.listModels",
        "description": "List available models."
      }
    ],

    "documentTypes": [
      {
        "type": "official.provider.openai.profile",
        "displayName": "OpenAI Provider Profile",
        "schema": "./schemas/provider-profile.schema.json"
      }
    ],

    "commands": [
      {
        "id": "official.provider.openai.refreshModels",
        "title": "OpenAI: Refresh Models",
        "rpc": "official.provider.openai.listModels"
      }
    ],

    "panels": [
      {
        "id": "official.provider.openai.profilePanel",
        "title": "OpenAI Provider Profile",
        "entry": "profilePanel"
      }
    ]
  },

  "capabilities": {
    "required": [
      {
        "id": "network.fetch",
        "scope": ["https://api.openai.com/*"],
        "reason": "Call OpenAI-compatible APIs."
      },
      {
        "id": "secrets.read",
        "scope": ["official.provider.openai.apiKey"],
        "reason": "Read the configured API key for provider requests."
      },
      {
        "id": "documents.readwrite",
        "scope": ["official.provider.openai.profile"],
        "reason": "Store provider profile data such as base URL and default model."
      }
    ]
  },

  "meta": {
    "official.marketplace": {
      "category": "Provider",
      "verified": true
    },
    "community.llm": {
      "providerKind": "openai-compatible",
      "supportsStreaming": true
    }
  }
}
```

### 8.3 Server activation

```ts
export default defineServerExtension((ctx) => {
  ctx.registerDocumentType({
    type: "official.provider.openai.profile",
    schemaPath: "./schemas/provider-profile.schema.json"
  })

  ctx.registerRpc("official.provider.openai.listModels", async () => {
    const profile = await ctx.documents.getByType("official.provider.openai.profile")
    const apiKey = await ctx.secrets.get("official.provider.openai.apiKey")

    const res = await ctx.fetch(`${profile.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })

    return await res.json()
  })

  ctx.registerRpc("official.provider.openai.invoke", async (params) => {
    const apiKey = await ctx.secrets.get("official.provider.openai.apiKey")

    const res = await ctx.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    })

    return await res.json()
  })
})
```

### 8.4 Client activation

```ts
export default defineClientExtension((ctx) => {
  ctx.registerPanel("official.provider.openai.profilePanel", {
    render(container) {
      container.innerHTML = `<button id="refresh">Refresh Models</button>`

      container.querySelector("#refresh")!.addEventListener("click", async () => {
        const models = await ctx.rpc.call("official.provider.openai.listModels", {})
        console.log(models)
      })
    }
  })
})
```

### 8.5 Runtime flow

```text
1. Studio 读取 manifest。
2. 校验 engines.studio。
3. 检查 capabilities，向用户展示权限。
4. 启动 server extension。
5. server 注册 document type 和 rpc。
6. Plugin Host 对比 manifest contributes。
7. 用户打开 OpenAI Provider Profile panel。
8. Studio 加载 client extension sandbox。
9. client 注册 panel。
10. 用户点击 Refresh Models。
11. client 通过 ctx.rpc.call 调用 server RPC。
12. Kernel audit RPC 调用和 network.fetch。
13. server 返回 models。
14. panel 更新 UI。
```

---

## 9. 假想例子：SillyTavern Concept + Workspace Adapter

```json
{
  "manifestVersion": 1,
  "id": "official.concept.sillytavern",
  "version": "0.1.0",
  "displayName": "SillyTavern Concept Stack",
  "description": "Provides SillyTavern-compatible authoring, workspace sync, and packaging.",
  "roles": ["concept-stack", "workspace-adapter"],

  "engines": {
    "studio": "^0.1.0"
  },

  "server": {
    "loader": "node",
    "entry": "./server/dist/index.js"
  },

  "client": {
    "entry": "./client/dist/index.js"
  },

  "contributes": {
    "conceptStacks": [
      {
        "id": "official.sillytavern",
        "displayName": "SillyTavern Compatible Stack"
      }
    ],

    "workspaceAdapters": [
      {
        "id": "official.sillytavern.workspace",
        "forConceptStack": "official.sillytavern",
        "displayName": "SillyTavern Dev Workspace",
        "features": ["export", "import", "watch", "validate", "build", "package"]
      }
    ],

    "documentTypes": [
      {
        "type": "official.sillytavern.character",
        "displayName": "Character"
      },
      {
        "type": "official.sillytavern.worldbook.entry",
        "displayName": "Worldbook Entry"
      },
      {
        "type": "official.sillytavern.preset",
        "displayName": "Preset"
      }
    ],

    "rpc": [
      { "name": "official.sillytavern.workspace.export" },
      { "name": "official.sillytavern.workspace.importChangedFiles" },
      { "name": "official.sillytavern.workspace.validate" },
      { "name": "official.sillytavern.workspace.buildArtifact" },
      { "name": "official.sillytavern.package.exportJson" }
    ],

    "panels": [
      {
        "id": "official.sillytavern.workspace.diagnosticsPanel",
        "title": "Workspace Diagnostics",
        "entry": "diagnosticsPanel"
      }
    ]
  },

  "capabilities": {
    "required": [
      {
        "id": "workspace.read",
        "scope": ["project"],
        "reason": "Read Dev Workspace source files."
      },
      {
        "id": "workspace.write",
        "scope": ["project"],
        "reason": "Export documents and update source files from Studio authoring UI."
      },
      {
        "id": "documents.readwrite",
        "scope": ["official.sillytavern.*"],
        "reason": "Import validated workspace files into Studio documents."
      }
    ]
  }
}
```

验证流程：

```text
1. 项目声明 conceptStack = official.sillytavern。
2. Studio 查询 registry，发现该 stack 由 official.concept.sillytavern 贡献。
3. Studio 查询 workspaceAdapters，发现 official.sillytavern.workspace。
4. 用户点击 Enable Dev Workspace。
5. Studio 调 official.sillytavern.workspace.export。
6. Adapter 将 SQL documents 导出成多文件目录。
7. file watcher 检测 VSCode 保存。
8. Studio 调 importChangedFiles。
9. Adapter parse + validate。
10. valid: 写入 SQL changeset / document revisions / source map / rebuild artifact。
11. invalid: 写 diagnostics，保留 last valid snapshot。
```

---

## 10. 依赖、冲突与 DAG 方向

Manifest 需要表达依赖和冲突，但 MVP 应保持克制。

建议未来区分：

```text
required dependency:
  缺失则不能加载。

optional dependency:
  存在则启用集成，不存在也能加载。

peer dependency:
  要求宿主项目中存在兼容插件，但不自动安装。

extension pack:
  推荐一起安装，不是运行依赖。
```

冲突示例：

```json
{
  "conflicts": [
    {
      "id": "other.provider.openai",
      "reason": "Registers the same provider namespace."
    }
  ]
}
```

DAG resolver 未来需要：

```text
1. 读取所有 manifests。
2. 校验 manifestVersion / id / version。
3. 检查 engines.studio。
4. 建立 dependency graph。
5. 检查 required dependencies。
6. 检查 version ranges。
7. 检查 conflicts。
8. 检查 contribution namespace collisions。
9. 对可加载插件拓扑排序。
10. 对不可加载插件生成 diagnostics。
```

MVP 可以只实现：

```text
duplicate id check
engines.studio check
required dependencies check
rpc namespace collision check
document type ownership collision check
diagnostics
```

---

## 11. 字段进入标准的判定标准

Manifest 字段进入核心标准前，必须满足至少一个条件：

```text
1. Kernel / Plugin Host 加载必须用到；
2. 插件管理器展示必须用到；
3. capability / security 必须用到；
4. dependency resolver 必须用到；
5. contribution / introspection 必须用到；
6. marketplace / update 必须用到；
7. compatibility / migration 必须用到。
```

否则不要进入核心 Manifest。

不应进入核心 Manifest 的例子：

- Provider 默认模型列表；
- 世界书字段细节；
- Runtime prompt schema；
- Workspace adapter 的完整 mapping 规则；
- 用户设置；
- API key；
- 临时缓存；
- Runtime 当前状态。

这些应进入 Document Store、Extension storage、schema 文件或子生态 `meta` namespace。

---

## 12. MVP Manifest 建议

### 12.1 必填字段

```text
manifestVersion
id
version
displayName
engines.studio
```

### 12.2 常用可选字段

```text
description
roles
server
client
activation
contributes
capabilities
dependencies
conflicts
meta
```

### 12.3 最小 server 插件

```json
{
  "manifestVersion": 1,
  "id": "example.greeter",
  "version": "0.1.0",
  "displayName": "Greeter",
  "engines": {
    "studio": "^0.1.0"
  },
  "server": {
    "entry": "./dist/server.js"
  }
}
```

代码：

```ts
export default defineServerExtension((ctx) => {
  ctx.rpc("hello", async ({ name }) => {
    return `Hello, ${name}`
  })
})
```

Dev Host 发现：

```text
registered RPC:
  example.greeter.hello
```

并提示：

```text
Manifest missing contributes.rpc[example.greeter.hello].
Run loom ext sync-manifest to update manifest.
```

同步后：

```json
{
  "manifestVersion": 1,
  "id": "example.greeter",
  "version": "0.1.0",
  "displayName": "Greeter",
  "engines": {
    "studio": "^0.1.0"
  },
  "server": {
    "entry": "./dist/server.js"
  },
  "contributes": {
    "rpc": [
      {
        "name": "example.greeter.hello"
      }
    ]
  }
}
```

---

## 13. Non-Goals

本文不定义：

- 完整 Manifest JSON Schema；
- Marketplace 上传格式；
- 签名与 provenance；
- 插件包格式；
- 具体 Client sandbox 实现；
- 完整 dependency resolver 算法；
- 完整 capability enforcement；
- Runtime / Provider / Tool 的业务 payload schema；
- 官方 Chat schema；
- 官方 SillyTavern schema。

这些应在后续 ADR / engineering spec 中收敛。

---

## 14. 当前决策摘要

```text
1. Manifest 必须保持最小必填，避免阻碍开发。
2. Server / Client 是硬工程边界。
3. Runtime / Provider / Tool / Concept Stack / Workspace Adapter 是 roles/contributions，不是硬插件类型。
4. Server public capability 通过 RPC 等 runtime registration 实际提供。
5. Manifest contributes 是静态声明和追踪入口。
6. Client Extension 不使用任意 window.xx 作为 Studio-facing API。
7. Client Extension 使用 Client Host Bridge / sandbox activation。
8. engines.studio 必填，server.engines.node 可选。
9. contributes 不写空数组，只声明实际贡献。
10. documentTypes 用于 typed Document ownership / schema / introspection。
11. conceptStacks 用于声明项目语义提供者。
12. workspaceAdapters 用于声明 Dev Workspace 映射提供者。
13. meta 开放但必须 namespaced。
14. meta 不能承载加载、权限、依赖、冲突等核心语义。
15. Dev Mode 可允许动态注册超前于 manifest，并提供 sync-manifest 工具。
```
