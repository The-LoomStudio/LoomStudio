# SillyTavern 数据兼容插件与 Prompt 锚点系统演进计划

> **状态**：方案制定 / 待评审  
> **日期**：2026-09-04  
> **关联文档**：
> - [`ordered-file-tree-and-anchor-slot-v0.md`](../discussion/application/prompt/ordered-file-tree-and-anchor-slot-v0.md) — 有序文件树与 Anchor / Slot 架构推演
> - [`airp-extension-contribution-v0.md`](../discussion/application/extension/airp-extension-contribution-v0.md) — Extension 领域能力贡献规范
> - [`extension-data-and-portable-payload-foundation-plan.md`](extension-data-and-portable-payload-foundation-plan.md) — Extension 数据与 Portable Payload 基建
>
> **目标**：以官方 Server Extension 插件形式，实现对 SillyTavern（ST）角色卡（V2/V3 PNG & JSON）、世界书（Lorebook）、预设（OpenAI Presets）的无损导入与格式归一化；同时演进 Loom Studio 的 Prompt 锚点系统，建立 `@chat.session.post` 黄金锚点与扩展声明式/自定义锚点拓扑降级机制，彻底废除无意义的 `injection_position`。

---

## 1. 核心洞察与第一性原理

### 1.1 Depth 的本质与物理位置真相

通过对 SillyTavern 源码（`public/scripts/openai.js` 与 `public/script.js`）的实测调研，ST 在组装 Chat Completion 上下文时的实际代码执行流为：

1. `setOpenAIMessages(chat)`：将聊天记录以**逆序**（`messages[0]` 为最新的一条消息，`messages[n]` 为最老的第一条消息）存入数组；
2. `populationInjectionPrompts(prompts, messages)`：从 `i = 0` 开始循环扫描所有注入项：
   ```js
   const injectIdx = i + totalInsertedMessages;
   messages.splice(injectIdx, 0, ...roleMessages);
   ```
   - 当 `i = 0`（即 `depth: 0`）时，内容被插入到逆序数组的最开头（`injectIdx = 0`）；
   - 当 `i = 4`（即 `depth: 4`）时，内容被插入到倒数第 4 条消息之前；
3. `messages = messages.reverse()`：在函数末尾将整个数组**再次反转恢复正序**。

**事实结论**：
所谓 `depth: 0`，在正序恢复后，恰恰位于**整段聊天历史的最末尾**（紧贴在模型待补全的 assistant 提示之前）。

在业界实战中，角色卡作者、插件作者和高级预设开发者之所以疯狂争取 `depth: 0 ~ depth: 4`，本质是因为在扁平数组模型下，**大家都想把最高优先级的指令、状态栏、防抢话和行为修正放在最新对话记录之后**。

在 Loom Studio 的架构中，聊天历史被显式建模为 `Agent Session`。因此，**所谓 Depth 0，在 Loom Studio 中正是在 `Agent Session` 之后开辟的物理孔位**。

### 1.2 为什么预设中彻底不需要 `injection_position`

在 ST 中，`injection_position` 是一个历史遗留概念（`0`: relative to main / `1`: absolute in chat），本质是 ST 没有真正的抽象树结构，只能用一组枚举来指示“这个 prompt 到底是要拼在开头的 system prompt 里，还是硬塞进 chat 数组逆序切片里”。

在 Loom Studio 的“预设即有序文件树（Ordered File Tree）”模型中：
- 预设本身就是一棵强类型的物理顺序树；
- 预设作者通过放置 `kind: 'entry'` 决定静态条目物理顺序；
- 预设作者通过放置 `kind: 'virtual'` 决定动态挂载孔位（`Anchor`）；
- 外部贡献（角色卡、世界书、插件）只需声明目标 `targetAnchorId` 与局部排序 `localDepth`（笼中深度，Caged Depth）。

条目的最终物理归属完全由它挂载的目标 Anchor 所在节点决定，**`injection_position` 概念在概念上和实现上彻底失去存在价值，予以废弃**。

### 1.3 暂时不导入 ST 聊天记录的边界决策

ST 的历史聊天记录（`chats/*.jsonl`）包含复杂的本地回滚状态、多分支 swipe、不同版本的 token 统计及私有 extra 结构。当前核心目标是建立**高复用度的静态测试集**（角色卡、世界书、预设），因此首阶段严格保持范围克制：
- **不导入 ST 聊天记录**（留待后续 Timeline 迁移专项统一规划）；
- 专注于卡片本体、世界书词条、激活规则、开场白与高级预设结构的无损消化。

---

## 2. 锚点系统（Anchor System）架构演进

当前应用运行时的默认预设树已包含 `@preset.system`、`@setting.stable`、`@chat.tools`、`@chat.narrative`、`@chat.session`、`@chat.input`。为了完美对接 ST 社区生态与未来高级扩展，锚点系统按以下方案演进。

```text
Prompt Build DFS 遍历流
┌─────────────────────────────────────────────────────────────┐
│ 📁 System Message                                            │
│   ├── 📄 Instructions                                       │
│   ├── ⚓️ @preset.system                                      │
│   └── ⚓️ @setting.stable (蓝灯常驻世界书 / 角色静态设定)       │
├─────────────────────────────────────────────────────────────┤
│ 📁 Tools Context Message                                     │
│   └── ⚓️ @chat.tools                                         │
├─────────────────────────────────────────────────────────────┤
│ 📁 Narrative Timeline Message                                │
│   └── ⚓️ @chat.narrative (长期世界线历史)                     │
├─────────────────────────────────────────────────────────────┤
│ 📁 Session Message (Agent 对话主体)                          │
│   └── ⚓️ @chat.session (当前轮次消息历史)                     │
├─────────────────────────────────────────────────────────────┤
│ 📁 Post-Session Message (会话后动态设定与黄金破限区)          │
│   ├── ⚓️ @setting.lower (★ 触发式/下部世界书条目，会话后展开)  │
│   ├── ⚓️ @chat.session.post (承接 depth 0~4、尾部控制区)      │
│   │    └── [动态挂载/回退展开的扩展新锚点]                      │
│   └── 📄 Post-History Rules (破限 / 防抢话 / 输出格式规范)   │
├─────────────────────────────────────────────────────────────┤
│ 📁 Current Turn User Input                                  │
│   └── ⚓️ @chat.input                                         │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 引入标准会话后锚点 `@setting.lower` 与 `@chat.session.post`

在预设树中，在 `Agent Session` 容器之后显式建立标准虚拟节点：
- **`@setting.lower`**：
  - **语义定义**：动态关键词触发或未设常驻的世界书条目，在会话上下文之后展开；
  - **设计初衷**：保护全局静态底设（`@setting.stable`）的 KV Cache 前缀缓存命中率，同时将刚触发的生动世界设定紧邻对话历史之后，且与尾部破限行为控制做严格解耦；
  - **回退机制**：老预设若无该显式节点，在 `@chat.session` 遍历结束时自动在会话之后、`@chat.session.post` 之前展开。
- **`@chat.session.post`**：
  - **语义定义**：对话历史与动态设定之后、最终用户本轮输入/模型生成之前的尾部指令区；
  - **承载内容**：
    - 传统 ST 中的 `post_history_instructions`（Jailbreak）；
    - 传统 ST 中 `depth: 0` 到 `depth: 4` 的世界书词条与 Author's Note；
    - 角色状态追踪（MVU / 状态栏）、格式强制规范、思考链引导。

### 2.2 扩展注入已有锚点（Injecting Existing Anchors）

扩展向已有锚点注入内容支持两种等价形态：

1. **静态声明式注入（Package Manifest）**：
   ```json
   {
     "contributes": {
       "promptResources": [
         {
           "id": "status-tracker",
           "resourceKind": "setting",
           "source": "./settings/status-layer.json",
           "settingMounts": [
             {
               "targetAnchorId": "@chat.session.post",
               "orderIndex": 50
             }
           ]
         }
       ]
     }
   }
   ```
2. **运行时动态提供者（Server Module Hook）**：
   ```ts
   ctx.prompts.registerContributionProvider({
     id: 'runtime-variable-summary',
     targetAnchorId: '@chat.session.post',
     localDepth: 100,
     provideContent: async (turnContext) => {
       const vars = await getSessionVariables(turnContext.sessionId)
       return renderVariableBlock(vars)
     }
   })
   ```

### 2.3 扩展注册全新锚点（Registering New Anchors）与拓扑降级

**核心矛盾**：
若允许插件任意注册一个全新的语义锚点（例如 `@mvu.variables` 或 `@rag.knowledge`），而用户当前正在使用的预设树中**根本没有预设作者放置的对应 `kind: 'virtual'` 节点**，该锚点的内容将成为“孤儿”，无法在任何 Message 中被编译输出。

**第一性原理解决方案：声明元数据 + 拓扑回退挂载（Fallback Placement Topology）**：

扩展在注册新锚点时，必须同时声明其**默认附着宿主**：

```ts
type AnchorDefinition = {
  id: string // 如 '@mvu.variables'
  label: string // 如 'MVU 状态栏'
  description?: string
  fallbackPlacement: {
    relativeTo: string // 必须是核心已知锚点，如 '@chat.session.post' 或 '@setting.stable'
    position: 'before' | 'after' // 位于基准锚点的前方还是后方
    defaultLocalDepth?: number // 默认局部深度
  }
}
```

**双轨渲染判定规则**：
1. **优先尊重预设作者**：若当前预设树显式包含了该新锚点的虚拟节点（预设作者主动安排了该插件插槽），管线直接将其渲染在预设作者决定的精确位置；
2. **拓扑自动降级**：若当前预设树未包含该节点，管线依据 `fallbackPlacement`，在编译基准锚点（如 `@chat.session.post`）时，自动将其作为附属虚拟子孔位合并展开。

**设计收益**：
- 既保障了“预设作者绝对排版权”的架构底线；
- 又使新插件在任意老旧预设或第三方预设下“开箱即用”，绝不静默丢失。

---

## 3. SillyTavern 真实数据全量摸底与统计证据

本次调研直接对工作区内保存的真实用户数据（**97 张角色卡 PNG** 与 **158 本独立世界书 JSON**）执行了全量自动化解析与静态分析，得出了极具说服力的第一手实测证据。

### 3.1 真实角色卡全量摸底（97 张 PNG 卡片）

对全部 97 张角色卡 PNG 二进制 tEXt chunk（`chara` 与 `ccv3`）的解析结果：

```text
角色卡总计：97 张
- 规范版本：100% 为现代 Character Card V3 (ccv3)
- 内嵌世界书 (character_book)：92 张 (94.8%)
- 多重开场白 (alternate_greetings)：57 张 (58.8%)
- 正则替换脚本 (regex_scripts)：76 张 (78.4%)
- 酒馆助手/状态机扩展 (tavern_helper / TavernHelper_scripts)：65 张 (67.0%)
- 绑定世界书 (world)：97 张 (100%)
- 顶层 post_history_instructions (Jailbreak)：仅 1 张使用
- 顶层 system_prompt：仅 2 张使用
```

**关键实测洞察**：
1. **角色定义向内嵌世界书迁移**：
   在抽检的现代高质量角色卡（如《-魔法少女ノ魔女裁判-》、《Rimworld》、《Re0从零开始的异世界生活》、《Girls Band Cry》等）中，大量卡片的顶层 `description` 和 `personality` 字段长度为 0 或极短，**作者将全套角色定义、场景状态和行为规则全部内嵌在 `character_book` 之中**（多者达 48 条至 103 条）。
2. **后置注入（Depth Injections）是现代卡片运行的核心命脉**：
   以《Rimworld》为例，其内嵌的 47 条世界书中，有 **15 条全部配置为 `position: 4 (atDepth)` 且全部为 `constant: true`（蓝灯常驻）**。
   这些后置条目的 depth 精确分布在 `0` 与 `1`：
   - `depth: 1`：`[mvu_update]变量更新规则`（1859 字符）、`[mvu_update]变量输出格式`（3440 字符）、`[mvu_plot]读取变量`、`认知隔离`、`[mvu_plot]创作与文风`；
   - `depth: 0`：`核心_世界运转`（1608 字符）、`核心_世界法则`（1353 字符）、`[mvu_plot]正文检查`、`[mvu_update]变量检查`、`再次检查`。
   **证据确凿**：真实高级角色卡高度依赖在对话记录末尾（depth 0/1）进行状态变量更新、格式校验与法则强制。这与 Loom Studio 的 `@chat.session.post` 黄金锚点完全契合！
3. **正则替换主要用于 UI 美化与状态栏提取**：
   抽检《-魔法少女ノ魔女裁判-》，其携带 20 条正则替换脚本，主要将 `<content>...</content><StatusBlock>...</StatusBlock>` 实时替换为带有完整 CSS 样式（渐变、阴影、折叠详情）的审判要项面板，这为 Loom Studio 提供了清晰的 TransformRule 转换范式。

### 3.2 真实世界书全量摸底（158 本 JSON，共 10,010 条目）

对全部 158 本独立世界书的 10,010 个条目进行遍历扫描与统计：

```text
世界书总数：158 本
总词条数：10,010 条
- 蓝灯常驻 (constant / alwaysActive)：2,915 条 (29.1%)
- 关键词选择性激活 (selective)：9,038 条 (90.3%)
- 位置分布 (Position)：
    • before_char (0)：5,693 条 (56.9%)
    • after_char (1)：2,406 条 (24.0%)
    • atDepth (4)：1,783 条 (17.8%)
    • ANBottom (3)：96 条 (1.0%)
    • ANTop (2)：16 条
    • EMBottom (6)：15 条
    • EMTop (5)：1 条
    • outlet (7)：0 条
```

**atDepth 条目的深度分布验证（共 1,783 条）**：

| Depth 深度 | 条目数量 | 占比 | 典型用途与内容特征 |
|---|---|---|---|
| **`depth: 0`** | **494 条** | **27.7%** | 对话最末尾的输出格式强行约束、最终合规检查、状态更新提交 |
| **`depth: 1`** | **400 条** | **22.4%** | 倒数第一句之前的即时反应引导、变量计算规则、临场思维链注入 |
| **`depth: 2`** | **239 条** | **13.4%** | 近期上下文动作强化（如《鸣潮》世界书核心异象：海蚀、残象潮、岁主） |
| **`depth: 4`** | **312 条** | **17.5%** | ST 默认深度推荐值（普通世界观条目插入近期记忆） |
| **`depth: 3`** | **113 条** | **6.3%** | 近期情景聚焦 |
| **`depth: 5`** | **114 条** | **6.4%** | 中近期背景设定 |
| `depth > 5` | 111 条 | 6.2% | 特殊自定义或极深历史插桩 |

**核心统计结论**：
- **`depth <= 5` 占了全部 atDepth 条目的 93.8%（1,672 / 1,783）**！
- **近一半（494 + 400 = 894 条，占 50.1%）直接挤在 `depth: 0` 和 `depth: 1`**！
- 这充分证实了用户的断言：**所有所谓的 depth，94% 以上本质上都是为了把内容插入到近期对话、尤其是当前对话记录之后**。在具备强类型有序树与 `@chat.session.post` 锚点之后，这一复杂的数字倒序切片机制可以被彻底降维简化。

---

## 4. 转换规格与算法设计

### 4.1 角色卡（Character Card）转换管线

| ST 字段 (V2/V3) | 类型/位置 | Loom Studio 目标映射 | 转换与处理策略 |
|---|---|---|---|
| `name` | 顶层 | `CardManifest.name` | 直接映射 |
| `description` | 顶层文本 | Setting Entry / `@setting.stable` | 作为卡片默认 Setting 树中的角色基础设定条目 |
| `personality` | 顶层文本 | Setting Entry / `@setting.stable` | 作为独立条目，便于在树中单独开关与调整深度 |
| `scenario` | 顶层文本 | Setting Entry / `@setting.stable` | 作为场景上下文条目 |
| `first_mes` | 顶层文本 | `Opening` 资源条目 | 映射为 Card 资产中首选开场白 |
| `alternate_greetings` | 字符串数组 | `Opening` 备选资源库 | 存入 Card 的开场白选择器列表，支持随心切换 |
| `system_prompt` | 顶层文本 | Setting Entry / `@preset.system` | 设定为特定于该卡片的系统指导覆写 |
| `post_history_instructions` | 顶层文本 (Jailbreak) | Setting Entry / `@chat.session.post` | **关键转换**：消除 ST 旧 Jailbreak 概念，直接挂载至会话后置黄金锚点 |
| `extensions.depth_prompt` | `{ prompt, depth, role }` | Setting Entry / `@chat.session.post` | 映射为带有 `localDepth: depth` 的后置条目 |
| `extensions.regex_scripts` | 正则替换脚本数组 | `TransformRule` 资源 | 转换为系统标准声明式 Transform Rule，脱离危险脚本依赖 |
| `character_book` | 内嵌世界书 | `PromptResource` (kind: 'setting') | 自动解包为内嵌 Setting Layer，与独立世界书共用同一编译器 |

### 4.2 世界书（Lorebooks / World Info）转换规格

ST 世界书的核心属性映射如下：

```text
ST Lorebook Entry
  ├── constant: true (蓝灯常驻) ──────────> PromptActivation.kind = 'always'
  ├── selective: false + key ──────────────> PromptActivation.kind = 'keyword' (any of keys)
  ├── selective: true + key + secondary ───> PromptActivation.kind = 'keyword' (keys 且 secondary)
  ├── position: 0 (before_char) ───────────> targetAnchorId = '@setting.stable', localDepth = order
  ├── position: 1 (after_char) ────────────> targetAnchorId = '@setting.stable', localDepth = order + 1000
  ├── position: 4 (atDepth) ───────────────> targetAnchorId = '@chat.session.post', localDepth = depth * 100
  └── position: 7 (outlet) ────────────────> targetAnchorId = '@outlet.' + outletName
```

**排序（Order & Priority）与蓝灯常驻保障**：
- ST 的 `insertion_order`（0~1000）直接映射为 Loom Studio 节点的 `localDepth`；
- 蓝灯常驻条目（`constant: true`）直接赋予 `PromptActivation: { kind: 'always' }`，跳过任何运行时文本扫描，100% 稳定进上下文。

### 4.3 预设（Presets）自动合并算法

以调研中实际捕获的真实高级预设（如包含 115 个条目的 `【明月秋青】6.0.1.json`）为基准：
ST 预设由海量单条微型 Message（如“作者声明”、“输出语言”、“写作指导”、“防神化”、“NSFW 指导”、“思维链引导”）组成。

若机械地将每个 ST 条目转为 Loom Studio 的 `kind: 'message'`，将向模型输出数十个相互隔离的 System Message，严重违背主流模型 API 的协议规范。

**自动聚合与树状重构算法（Auto-Squash Pipeline）**：

```text
ST 扁平 prompt_order 遍历
  │
  ├── 阶段 1：遇到 chatHistory 之前的连续系统指令
  │     └── 聚合成单组 📁 System Message
  │           └── 内部生成多个有序 📄 Entry (按 ST prompt name 命名)
  │
  ├── 阶段 2：遇到内置 Marker
  │     ├── worldInfoBefore / charDescription / scenario ──> 注入 ⚓️ @setting.stable
  │     ├── dialogueExamples ───────────────────────────────> 注入 ⚓️ @chat.examples
  │     └── chatHistory ────────────────────────────────────> 注入 ⚓️ @chat.session
  │
  └── 阶段 3：遇到 chatHistory 之后的所有条目（如视角、对话、剧情、思维链、输出格式）
        └── 聚合成单组 📁 Post-Session Message
              ├── 放置黄金锚点 ⚓️ @chat.session.post
              └── 内部按 ST 顺序放置各功能块 📄 Entry
```

该算法在保证 100% 还原作者原始物理排列的同时，输出极其紧凑、标准的树状结构。

---

## 5. 插件工程架构：`@loom-extension/sillytavern-importer`

### 5.1 目录划分与模块职责

在工作区建立官方扩展 `extensions/sillytavern-importer`，遵循严格的单向依赖与代码克制原则：

```text
extensions/sillytavern-importer/
├── manifest.json              # Extension Package Manifest (声明权限、图标与模块入口)
├── package.json               # npm 依赖与构建脚本
├── tsconfig.json              # TypeScript 编译配置
├── icon.png                   # 插件图标 (见 5.3 规范)
└── src/
    ├── index.ts               # Server Module 入口 (activate / dispose / 注册导入拦截适配器)
    ├── parser/                # 纯数据解析层 (只读 Buffer/JSON，零重量级外部依赖)
    │   ├── png-reader.ts      # 从 PNG tEXt 提取 chara / ccv3 chunk 并 base64 解码为 UTF-8
    │   ├── sniffer.ts         # 格式嗅探器 (精准识别 Card V2/V3、Lorebook、Preset 或普通图像)
    │   └── validator.ts       # 针对 ST 各种历史怪异字段的宽容校验与默认值兜底
    ├── normalizer/            # 领域模型归一化层
    │   ├── card.ts            # ST Card -> CardBundleArtifact & CardSourceContent
    │   ├── lorebook.ts        # ST Lorebook -> PromptResourceNode (kind: 'setting')
    │   └── preset.ts          # ST Preset -> 树状聚合 PromptResourceNode (kind: 'preset')
    └── adapter/               # 宿主静默对接层
        └── card-adapter.ts    # 注册进入宿主 CardImportAdapterChain 的拦截适配器
```

### 5.2 Extension 图标系统规范

在 Loom Studio 的 Extension 系统（`extension-host`）中，插件图标的规范合同如下：

1. **声明方式**：在 `manifest.json` 顶层添加 `icon` 字段，必须为相对于 Package 根目录的**相对路径**（不支持绝对路径）：
   ```json
   {
     "manifestVersion": 2,
     "id": "loom.extension.sillytavern-importer",
     "version": "0.1.0",
     "displayName": "SillyTavern 数据导入器",
     "icon": "./icon.png"
   }
   ```
2. **支持格式**：受系统正则严格校验 `/\.(png|jpe?g|webp|gif)$/i`，支持 `PNG`、`JPEG`、`WebP`、`GIF`；
3. **推荐规格**：
   - 文件命名：直接放在扩展根目录 `./icon.png`（或 `./assets/icon.png`）；
   - 纵横比：`1:1` 正方形；
   - 分辨率：推荐 `256x256` 或 `512x512`（Retina 屏清晰度最佳，加载轻量）。

### 5.3 ST 角色卡二进制储存与三层区分机制

ST 角色卡导入时，既要保证走主系统相同的标准卡片流程，又必须做到血统清晰、数据可溯源：

1. **二进制资产与头像储存**：
   - 原始卡片 PNG Buffer 通过 `ctx.assets.publish({ bytes, kind: 'card-source-artifact', mediaType: 'image/png' })` 存入底层的 **Blob Store**，生成唯一 `blobId`、`sha256`、`sizeBytes`；
   - 从 PNG 提取的图像同时作为媒体 Asset 写入，将生成的 `assetId` 赋给 `card.media.avatarAssetId`。
2. **三层格式隔离与区分**：
   - **第一层：`sourceArtifactRef.format` 显式标记**：
     原生卡片为 `format: 'loom.cardBundle'`；
     ST 导入卡片显式写入 `format: 'sillytavern.cardV3'`（或 `cardV2`），记录原始文件名与 `blobId`；
   - **第二层：`ImportBundle` 来源元数据**：
     在随卡创建的 `ImportBundleContent` 中记录来源生态：`{ sourceFormat: 'sillytavern', sourceSpec: 'ccv3', originalSpecVersion: '3.0' }`；
   - **第三层：ST 私有扩展数据进入 Portable Payload**：
     ST 专有的非核心字段（如 `tavern_helper`、`TavernHelper_scripts`、`xiaobaix-tasks`、`regex_scripts` 等），不侵入 Loom 核心卡片 Schema，而是调用 `ctx.portablePayloads.publish()` 打包为 `airp.portableExtensionPayload` Document，挂载在 `cardId` 下。
     *收益*：Core 纯粹干净；原始私有逻辑 100% 完整保留；未来支持一键无损重新导出为 ST PNG。

### 5.4 静默生效机制（零新增按钮）

用户在 Studio 界面中不需要面对多余的“从 ST 导入”新按钮，而是直接复用现有的“导入角色卡 / 导入预设”弹窗：

```text
[用户拖入任何文件 (*.png / *.json) 到现有导入弹窗]
                       │
                       ▼
         Studio RPC: application.importCardBundle
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ CardImportAdapterChain (宿主导入适配链)                         │
│                                                                 │
│  1. Loom 原生嗅探器 ──(不匹配)──┐                              │
│                                 ▼                               │
│  2. SillyTavern 插件嗅探器 ──(匹配 ccv3 / chara / ST Lorebook)  │
│        │                                                        │
│        ▼ (在内存中静默转换为标准 CardBundleArtifact)             │
│  3. 移交回原生核心写入流程 ─────────────────────────────────┐   │
└─────────────────────────────────────────────────────────────┼───┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ DataEngine.transact (单一原子性事务)                            │
│  ├── PromptResourceStore (创建内嵌世界书 Setting Layer)         │
│  ├── DocumentStore (创建 Card Document)                         │
│  ├── DocumentStore (创建 ImportBundle Document & 记录溯源)      │
│  └── DocumentStore (创建 PortablePayload Documents)             │
│                                                                 │
│  ===> 产出原子性 ApplicationChangeset (支持一键 Undo / 回滚)    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
        [前端收到标准的 ImportCardBundleResult 成功提示]
```

### 5.5 涉及的 API 与 CTX 交互

- **`ctx.assets.publish()`**：保存卡片原始二进制与头像 Asset；
- **`ctx.portablePayloads.publish()`**：保存 ST 私有扩展数据；
- **`ctx.diagnostics.report()`**：遇到损坏或不可解析字段时汇报诊断，不中断主流程；
- **`ctx.lifecycle.onDispose()`**：插件卸载时安全撤销适配器注册；
- **`DataEngine.transact()`**：保证写入全部进入原子性事务，享有完整的审计与回滚能力。

---

## 6. 实施路线图与验证检查点

### 6.1 Phase 1：Prompt 锚点系统升级与 `@chat.session.post`
- **改动范围**：`packages/application-runtime` 的默认预设生成器与 `prompt-build-pipeline.ts`；
- **具体实施**：
  1. 在 `prompt-resource-defaults.ts` 中加入标准 `@chat.session.post` 虚拟节点；
  2. 增强 `prompt-build-pipeline.ts`：支持外部挂载项直接将 `@chat.session.post` 作为 `targetAnchorId`；
  3. 支持扩展注册新锚点时的 `fallbackPlacement` 拓扑合并逻辑；
- **验证检查点**：
  - 运行单元测试，确认包含 `@chat.session.post` 的构建结果能够严格位于 `@chat.session` 之后、`@chat.input` 之前。

### 6.2 Phase 2：PNG tEXt 解析与角色卡 (V2/V3) 转换器
- **改动范围**：`extensions/sillytavern-importer`（新增）；
- **具体实施**：
  1. 实现 PNG tEXt / ccv3 提取逻辑；
  2. 映射基本信息、开场白、Setting 层；
  3. 将 `post_history_instructions` 与 `depth_prompt` 自动映射至 `@chat.session.post`；
- **验证检查点**：
  - 以真实卡片（如 `default_Seraphina.png` 及测试集卡片）运行导入测试，断言导出的 CardBundle 字段完整且开箱可用。

### 6.3 Phase 3：世界书（Lorebook）独立导入与激活映射
- **改动范围**：`extensions/sillytavern-importer`；
- **具体实施**：
  1. 解析 `Eldoria.json` 等独立世界书；
  2. 蓝灯常驻映射为 `always`，关键词检索映射为 `keyword`；
  3. 处理 `order` 与 `position`，归一化为带 `localDepth` 的条目；
- **验证检查点**：
  - 验证 161 本真实世界书样本抽检，确认语法与激活解析零异常。

### 6.4 Phase 4：预设（Preset）自动聚合转换器
- **改动范围**：`extensions/sillytavern-importer`；
- **具体实施**：
  1. 编写扁平 `prompts[]` 到树状有序结构的聚合算法；
  2. 识别并对齐 ST 内置 markers；
  3. 聚合前后端规则条目并彻底去除 `injection_position`；
- **验证检查点**：
  - 以包含 115 个条目的 `【明月秋青】6.0.1.json` 进行完整导入并渲染，验证生成的最终 Prompt 片段与 ST 预期输出 100% 语义一致。
