# Loom Studio Config and Local State v0

> **Status**: Draft v0.1（第一批实现约束，2026-05-14）
> **Purpose**: 定义 Studio MVP 的配置文件、开发态本地状态、项目数据、Extension 搜索路径与 secrets 边界，避免实现阶段随手写入混乱路径。
> **Audience**: Studio Server、Kernel bootstrap、Extension Host、Document Store、DevTool 实现者。
> **Related**:
> - [`studio-repository-engineering-v0.md`](studio-repository-engineering-v0.md)
> - [`studio-dependency-and-runtime-choices-v0.md`](studio-dependency-and-runtime-choices-v0.md)
> - [`../04-data/studio-document-store-engineering-v0.md`](../04-data/studio-document-store-engineering-v0.md)

---

## 0. Scope

本文只定义 MVP 的路径与配置边界。

它回答：

1. repo 内哪些目录是源码；
2. dev mode 本地状态写到哪里；
3. project 数据写到哪里；
4. extensions 从哪里发现；
5. logs/cache/generated 放哪里；
6. user config 与 project config 如何区分；
7. secrets 是否进入 Document Store / Manifest。

本文不定义：

- 完整桌面应用配置；
- 云同步；
- 多用户配置；
- secrets manager 实现；
- production installer 路径；
- workspace adapter 具体文件布局。

---

## 1. Directory Classes

Studio MVP 区分四类目录：

```text
Repository source
Dev local state
Project operational data
External authoring workspace
```

### 1.1 Repository source

Studio 仓库源码：

```text
LoomStudio/
├── apps/
├── packages/
├── extensions/
├── docs/
├── scripts/
└── tests/
```

源码目录不应保存运行态 project 数据。

### 1.2 Dev local state

开发时临时运行状态，默认放在仓库根部：

```text
LoomStudio/.loomstudio-dev/
```

该目录应被 git ignore。

### 1.3 Project operational data

Studio 内部运行态项目数据，包括 Document Store、revision、changeset、trace、audit、diagnostics snapshots 等。

MVP dev mode 下可放在：

```text
LoomStudio/.loomstudio-dev/projects/<project-id>/
```

未来 installed app 可迁移到 OS app data directory。

### 1.4 External authoring workspace

Dev Workspace / authoring source 是外部工作区，可以在任意路径：

```text
~/Projects/my-character-workspace/
```

它不是 Kernel 的 canonical runtime input。Workspace Adapter 负责 import / validate / sync 到 Document Store last valid snapshot。

---

## 2. Dev Local State Layout

MVP 推荐：

```text
.loomstudio-dev/
├── projects/
│   └── <project-id>/
│       ├── documents/
│       ├── traces/
│       ├── audit/
│       ├── diagnostics/
│       └── generated/
│
├── extensions/
│   ├── installed/
│   └── dev-links.json
│
├── cache/
├── logs/
└── runtime.json
```

说明：

| Path | Purpose |
|---|---|
| `projects/` | dev mode project operational data |
| `extensions/installed/` | 本地安装/解包的 extensions，MVP 可为空 |
| `extensions/dev-links.json` | dev extension 路径声明 |
| `cache/` | 可删除缓存 |
| `logs/` | dev server logs |
| `runtime.json` | 当前 dev runtime 状态，例如 last opened project |

MVP 不要求所有目录立即实现，但禁止随手写入其他源码目录。

---

## 3. Git Ignore Rule

仓库必须 ignore：

```text
.loomstudio-dev/
```

原因：

- 包含运行态数据；
- 可能包含本地绝对路径；
- 可能包含 logs/cache；
- 不应进入源码版本控制。

如果未来需要可提交的 fixture，应放在：

```text
tests/fixtures/
```

而不是 `.loomstudio-dev/`。

---

## 4. Config Classes

Studio MVP 区分三类配置：

```text
Repo dev config
User local config
Project config
```

### 4.1 Repo dev config

服务开发仓库本身，例如 workspace/tooling config。

位置：repo root。

例子：

```text
package.json
workspace config
tsconfig
lint config
format config
```

具体工具由依赖选型文档决定。

### 4.2 User local config

用户本机偏好，例如：

- theme preference；
- recent projects；
- window layout；
- dev extension links；
- local server port preference。

MVP dev mode 可暂放：

```text
.loomstudio-dev/runtime.json
.loomstudio-dev/extensions/dev-links.json
```

未来 installed app 应迁移到 OS user config directory。

### 4.3 Project config

项目自身可迁移、可导入导出的配置。

MVP 应优先进入 Document Store，而不是散落在本地 JSON 文件。

原因：

- Project config 应参与 revision/checkpoint/restore；
- 应可导入导出；
- 应产生 changeset；
- 应可被 Extension / Concept Stack introspect。

---

## 5. Extension Search Paths

MVP Extension Host 按以下顺序发现 extensions：

```text
1. Builtin/dev extensions in repo: ./extensions/*
2. Dev linked extensions from .loomstudio-dev/extensions/dev-links.json
3. Installed extensions from .loomstudio-dev/extensions/installed/*
```

### 5.1 Repo extensions

```text
extensions/example-echo/
```

用于开发与测试。

### 5.2 Dev links

```json
{
  "extensions": [
    {
      "id": "example.external-dev",
      "path": "/absolute/path/to/extension"
    }
  ]
}
```

规则：

- `path` 可以是绝对路径；
- `dev-links.json` 不提交；
- Extension id 仍以 manifest 为准；
- id mismatch 应产生 diagnostic。

### 5.3 Installed extensions

MVP 可保留目录但不实现 marketplace install。

---

## 6. Project Data Layout

MVP dev mode project data：

```text
.loomstudio-dev/projects/<project-id>/
├── documents/
├── traces/
├── audit/
├── diagnostics/
└── generated/
```

如果 P0 使用 in-memory backend，该目录可以只存 placeholder 或不落盘。

如果后续启用 SQLite backend，可放：

```text
.loomstudio-dev/projects/<project-id>/workspace.db
```

但 SQLite schema 不在本文定义。

### 6.1 Relationship to portable workspace layout

`../00-overview/loom-studio-architecture.md` 中的 `my-workspace/` 是未来 installed / portable workspace target layout；本文的 `.loomstudio-dev/projects/<project-id>/` 是 P0 dev-mode surrogate。

映射原则：

- portable `workspace.db` 对应 dev-mode `.loomstudio-dev/projects/<project-id>/workspace.db`；
- portable `loom-studio.lock` 对应 dev-mode `.loomstudio-dev/runtime.json` 与 extension dev links 的组合，P0 不承诺完整 lockfile；
- portable `.loom/token` 对应 dev-mode runtime auth token；P0 可以暂缓真实 token；
- portable `extensions/installed/` 对应 dev-mode `.loomstudio-dev/extensions/installed/`。

---

## 7. Cache / Generated / Logs

### 7.1 Cache

```text
.loomstudio-dev/cache/
```

可删除，不应包含唯一事实。

### 7.2 Generated

```text
.loomstudio-dev/projects/<project-id>/generated/
```

用于 build artifact、compiled artifact、temporary export 等。

规则：

- generated 不是 canonical source；
- runtime 应消费 stable artifact snapshot，而不是任意 workspace files；
- invalid workspace import 不应污染 last known good runtime snapshot。

### 7.3 Logs

```text
.loomstudio-dev/logs/
```

Logs 不替代 Audit。

Audit 是结构化事实记录；logs 是调试辅助。

---

## 8. Secrets Boundary

Secrets 不进入：

```text
Manifest
Document Store normal documents
Trace payload
Audit details raw payload
Git-tracked files
```

Examples：

```text
provider API key
OAuth token
local credential
private endpoint token
```

MVP 可以暂不实现 secrets manager，但必须遵守：

```text
Do not store secrets in manifest or project documents.
```

如果某 Extension 需要 secrets，P0 行为应是：

- 明确不支持持久化 secret；或
- 从 environment variable 读取；或
- 使用本地未提交 dev-only config，并产生 warning。

未来需单独设计：

```text
studio-secrets-management-v0.md
```

---

## 9. Environment Variables

P0 可支持少量 dev-only environment variables：

```text
LOOM_STUDIO_DEV_HOME
LOOM_STUDIO_PORT
LOOM_STUDIO_LOG_LEVEL
```

规则：

- env vars 只影响 local dev runtime；
- 不成为 project portable config；
- 不写入 Document Store；
- 不在 UI 中明文展示 secrets。

---

## 10. OS App Data Future

未来 installed app 可迁移到 OS app data directory。

Examples：

```text
macOS: ~/Library/Application Support/LoomStudio/
Linux: ~/.local/share/loom-studio/
Windows: %APPDATA%/LoomStudio/
```

MVP 不直接实现跨平台 app data resolver，避免提前引入桌面壳复杂度。

但代码应避免硬编码 `.loomstudio-dev` 到核心包中。

推荐：

```ts
type LocalStatePaths = {
  root: string
  projects: string
  extensions: string
  cache: string
  logs: string
}
```

由 `apps/studio-server` bootstrap 注入。

---

## 11. Non-Goals

本文不定义：

- complete config schema；
- OS-specific installer paths；
- secret storage implementation；
- workspace adapter layout；
- package export format；
- cloud sync state；
- multi-user project storage；
- backup strategy。

---

## 12. Document History

- 2026-05-14: Draft v0.1. 定义 dev local state、project data、extension search paths、cache/log/generated、secrets 与 OS app data future 边界。
