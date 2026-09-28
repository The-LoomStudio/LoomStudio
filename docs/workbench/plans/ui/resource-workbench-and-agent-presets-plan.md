# 资源工作台与 Agent 预设 UI 改进

> **状态**：调研完成 / 信息结构方向已确认 / Shell 草稿与后端契约待接续 / 未实施
> **日期**：2026-09-27
> **底层依赖**：[资源包、作用域与 Agent 预设底层计划](../resource-packages-and-agent-presets-backend-plan.md)
> **当前草稿**：`http://127.0.0.1:5173/dev/preview/resource-registry`

## 1. 目标和边界

基于正式 Floating Dock / Workspace 改进资源浏览、Agent 编辑和运行检查，而不是把现有草稿的完整三栏页面套进正式面板。

本计划负责导航、目录、详情、交互与业务接线；安装归属、模型迁移、执行作用域、资源导出规则由底层计划负责。后端最小 API/实体适配可以先做，不能以本地 UI 数组冒充真实资源注册表。

已确认方向：

- 彻底取消 Profile 管理与 Profile → Preset 选择关系，统一编辑可直接调用的“Agent 预设”；不只是隐藏旧 Profile 表单，不新增“预设来源包”。
- 包只有角色卡包和扩展包；扩展可以只是多套可开关的 Settings。是否有代码作为内容特征，不是必须跨越的新导航层。
- 资源类型、包浏览是同一资源的双入口。Agent 可展开查看其编排，工具使用配置留在 Agent 内，不建立顶层工具管理入口。
- 归属按文件夹组织，不使用归属下拉框替代目录。作用域/查看模式使用少量切换，不为每种来源复制正则、宏、工具等整套二级 Tab。
- 外部包放在内部包下方，以简单分隔标明“外部预览”；从目录加载、浏览，不以资源复制弹窗代替打开整个包。
- 文件/二进制留在所属角色或扩展内。README 可只读 Markdown 查看，角色教程优先支持 Settings；是否可供 AI 读取与自动注入分开。
- 工作区自有是明确归属；全局使用不会使资源失去来源。真实的复制、引用、安装与包预览必须区分。
- 用户选择更新角色卡/扩展后，已有 Timeline 立即跟随资源变化，不设置“逐存档更新依赖”或版本锁定入口。更新涉及的资源移除和作者迁移要求需明确显示，State 等运行数据不自动重置。

## 2. 当前工作台及草稿差距

| 当前实现 | 对改造的影响 | 入口 |
| --- | --- | --- |
| 正式 Shell 是聊天底层 + 浮动工作窗口，窗口可 reference/immersive；不是固定全页 Sidebar | 草稿不自带第二套外壳、Header、尺寸与持久布局 | [Shell](../../../architecture/ui/workspace-shell.md)、[导航](../../../architecture/ui/navigation-and-routing.md) |
| Dock 分别注册 agent、preset、resource、state、text-transform、extensions | 合并需要处理旧导航入口和资源定位，不能只改显示名称 | [Panel Registry](../../../../apps/studio-client/src/app/studio-panel-registry.tsx)、[Resource Panels](../../../../apps/studio-client/src/app/studio-resource-panels.tsx) |
| PresetWorkbench 已有有序树、锚点、投影、工具配置、宏/正则/脚本入口 | 提取编辑能力到新 Agent 详情，保留已有功能，不能拿草稿平铺列表覆盖正式编排器 | [PresetWorkbench](../../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx) |
| AgentPanel 选择 Preset 和模型，并覆盖 Preset 工具开关 | 移除重复配置依赖底层单一 Agent 契约；新模型槽允许未绑定 | [AgentPanel](../../../../apps/studio-client/src/widgets/agent-panel/agent-panel.tsx) |
| ContextWorkbench、Macro Inspector、Pipeline Workbench、State Panel 已有领域能力 | 复用编辑器/Inspector，不建设新的通用详情引擎 | [ContextWorkbench](../../../../apps/studio-client/src/widgets/context-workbench/context-workbench.tsx)、`features/state-variables/`、`features/text-transforms/` |
| 编辑草稿与远端缓存分离，导航保留 endpoint、Timeline/Branch 与明确资源身份 | 双入口共享编辑会话；包预览不能改变当前游玩或把草稿写进布局持久化 | `features/prompt-resources/model/`、`features/context-assets/model/`、`shared/studio-shell/` |
| 草稿只有本地样例、固定上下文、模拟工具开关、两种 Agent 目录；外部“打开包”是样例按钮 | 不是已完成的包读取、作用域查询、排序持久化、模型绑定或运行检查 | [草稿入口](../../../../apps/studio-client/src/dev/preview/resource-registry/resource-registry-preview.tsx)、[草稿组件](../../../../apps/studio-client/src/dev/preview/resource-registry/resource-registry-workbench.tsx) |

草稿专用文件现已全部置于 `src/dev/preview/resource-registry/`；未定稿组件继续留在开发目录，引用现有基础 UI。确认后按正式 feature/widget 边界抽取，不整目录搬入生产。

## 3. 目标信息结构

以下是 Shell 内的信息组织，不是要求新增与 Dock 重复的固定导航栏。

```text
现有 Dock / 工作窗口
  资源分类入口：Agent 预设、Settings、正则、宏配置、脚本、State 定义
  包入口：角色卡、扩展
  运行检查入口：复用已有 State / 正则 / Inspector 能力

工作窗口的资源目录                    详情
  工作区自有                          同一资源的编辑器
  当前角色                            或包概览 / 安装信息
  扩展安装
    Agent 预设
      生图助手
        提示词编排
          正文 / 锚点 / 顺序
        工具配置
        本地模型槽
    Settings / 正则 / 文件
  ----------------
  外部预览
    已打开的角色包或扩展包              只读内容，不改变当前上下文
```

- Dock 可以保留资源分类快捷入口，资源面板内的类型筛选与之共享同一定位；不展示两套重复分类导航。具体收纳位置需在真实尺寸草稿中确认。
- “全局 / 当前角色”表达目标范围；“全部资源 / 当前使用”表达集合视图，两者不能混成一个含义不明的作用域字段。“当前生效”需真实构建上下文，不能仅凭 installed/enabled 判断。
- Agent/Session 是消费者选择，Timeline/Branch 是运行数据目标，不另造“每 Agent 私有世界”的作用域 Tab。
- “资源型扩展”可以标记无 Module、包含多少 Settings；没有代码时不显示空白授权或运行控制区。
- Agent 内正则/Settings 选择只改变使用关系，不把其来源搬到 Agent 文件夹下成为所有权。展示引用时保留跳转到原资源的入口。
- 工具目录节点与详情子 Tab 二选一，按 Shell 草稿确认；不得同时形成两套不同的工具配置。底层工具定义仍可共享，不因取消顶层工具入口而删除。

## 4. 关键交互

### 4.1 纯 Settings 扩展

加入“衣物世界书”代表场景：现代、礼服、旅行三组文件夹，支持选择需要的组及排序；选择的是当前使用关系，不改所有角色共享的作者正文。

从当前角色进入，明确“用于此角色”；从全局进入，明确“设为全局默认”。包可浏览但尚未安装/尚未使用时，不能显示为已经注入。安装与单条目编辑使用各自真实保存入口。

### 4.2 外部包浏览

“打开资源包”调用真实文件选择/只读解析，解析完成后把整个包放在目录底部，选中资源直接看详情；不先要求选择要复制哪些条目。

已安装但不属于当前上下文的角色也可通过包浏览入口打开。两种来源要区分本地实体和外部 artifact 身份，不给未导入 artifact 伪造数据库资源 ID。

关闭预览只移除打开记录，不卸载包、不删除导入数据。显式引用、复制、安装是独立动作，完成后定位真实身份并保留来源。只读解析需底层有不落库、不激活模块的入口，不能借 import RPC 假做预览。

### 4.3 详情与保存

- 文本、提示词树、正则、宏配置、State 定义、模型槽使用已有领域控件；长文继续使用 LongTextEditor 与 MarkdownContent。
- 来源类型视图和包视图指向同一个编辑对象；保存失败或版本冲突保留输入、selection 与基线，不自动重试覆盖，也不切换到别的资源。
- 包内作者文件显示所属包与只读状态；Settings 可以编辑并切 Markdown 预览，不为教程强制生成 `.md` 附件。
- 扩展配置/私有记录留在扩展详情，不因值是字符串就混入“宏变量”编辑器。
- 引用丢失、模型未绑定、依赖未安装、执行器未注册分别显示原因；不要统一成“禁用”或默认替换。

### 4.4 导出

使用“导出编排/Setting”和“打包导出”两个有区别的动作。前者只导出资源本体；后者展示携带资源与外部依赖，产物为扩展包或角色包。

不能将下载操作变成本地安装/归属迁移。旧带脚本或正则的 Preset 输入展示明确转换结果，无法无损转换时不假装导入成功。新旧字段范围按底层 B0/B4，不在前端裁剪 JSON 伪造新格式。

### 4.5 Agent 选择与调用

- 输入框的预设切换直接选择完整 Agent 预设，不再先选 Profile、再选其使用的 Preset。
- 编辑预设时就配置它的编排、上下文策略和工具。功能类型/说明帮助调用者理解适用任务，不形成另一套需要绑定 Preset 的“写作 Agent Profile”。
- 程序性/被动调用展示其明确引用的 Agent 预设及可用状态，可跳转到同一详情；目标不存在时显示失效引用，不替换成同功能的其他预设。
- 未来主 Agent 分派子任务沿用同一目标身份；此计划不提前新增调度管理器、功能实现选择层或专用多 Agent 管理面板。
- 预设编辑与 Run/Session 查看分开；同一预设多次执行不产生多个 Profile，也不把会话私有数据显示为预设共有配置。

### 4.6 更新与已有 Timeline

更新选择发生在角色卡/扩展层。用户可不更新；更新成功后，旧 Timeline 后续使用新版资源，不再逐个存档确认。可展示新增、修改、移除及作者提供的兼容说明，但不虚构平台自动迁移承诺。

2026-09-27 已确认：默认采用新版覆盖包内作者资源，但执行前必须弹窗指出内容变化及本地编辑将被覆盖；取消不修改数据。本地模型绑定、State 和历史不覆盖。Diff 视图与另存副本是后续增强，不阻断首版；没有旧版原始基线时，不把内容差异标为“用户修改冲突”。

最小业务接线已实施：现有扩展面板提供全局安装的“更新资源”，采用现有原生确认弹窗模式，显示新旧版本及覆盖警告后调用显式更新 RPC。未实施完整 F4 包管理：此操作仅采用当前已发现包的资源，不下载、不更新模块代码，角色安装入口未开放；逐资源变化清单及 Diff/副本仍待后续。Client 类型检查通过，尚未人工视觉验收。

被移除的 Settings、代码或依赖显示为缺失/不可用，不回退到旧快照或同功能替代项。保留已有 State；作者迁移未执行或失败时显示真实状态，不能用“初始化完成”掩盖旧数据丢失。运行中代码切换和新权限授权按底层合同展示，不能把即时跟随解释成无授权热执行。

## 5. 运行检查不是一个空 Tab

检查视图必须区分“当前配置”“以指定输入试算”“某次实际 Run/Build 结果”，显示所用目标与版本；没有运行结果时不能拿静态目录冒充 trace。

| 检查对象 | Master 列表 | Detail 内容 | 行为边界 |
| --- | --- | --- | --- |
| Settings / 编排 | 候选资源、启用/排除/缺失状态 | 引用来源、Activation 结果、锚点及最终顺序；跳转作者内容 | 草稿预览不写使用关系；精确生效由 backend build 给出 |
| 宏 | 当前值及 unresolved/conflict/error | 同名来源候选、已选 source/option、默认原因、依赖与版本；跳转作者配置 | 计算值只读；显式切换候选走现有版本化保存，不能直接改动态结果 |
| 正则 / 提取器 | 指定阶段的有序执行链 | 来源、规则版本、命中范围、变换前后；测试输入 | 测试不改消息正文或 State；顺序调整明确作用于哪条使用/override 关系 |
| State | Global 或明确 Timeline/Branch 的实际路径树 | 当前值、Revision、定义/来源；有数据时显示变更记录 | 共享目标不按 Agent 复制；写入必须明确目标并使用 CAS；定义初始值是另一个视图 |
| 工具 | 当前 Agent 的请求工具和最终可用工具 | 启用配置、执行器状态、Provider 能力、暴露方式和权限导致的排除原因 | 不把“定义存在”展示为“可执行”，不复活第二份 override |

优先复用现有 Macro Inspector、Pipeline Workbench、State Panel、PromptBuild Inspector；缺少来源解释字段时由底层 B5 补齐，不在前端重新实现 resolver。预览的计算不能触发模型生成、安装、State 写入或额外模块激活。

## 6. 分阶段实施与文件边界

| 阶段 | 实施范围 | 前置与完成标准 |
| --- | --- | --- |
| F0 补齐真实宿主草稿 | `src/dev/preview/resource-registry/` 与必要的 preview 注册 | 补无代码衣物包、角色依赖、全局与角色范围、真实工作窗口宽度、运行检查代表结果；全部 fixture/local state。用户确认目录密度、Dock 收纳和工具入口位置 |
| F1 领域接线 | `src/entities/` 对应实体、`shared/api/studio-api.ts`、现有 `features/agent-profiles/` 的替换、`features/prompt-resources/`、`features/context-assets/` | 底层 Agent/归属查询可用；输入框和程序目标接同一预设身份；不保留第二份 Profile 状态；沿既有请求与草稿机制 |
| F2 导航与资源目录 | `app/studio-panel-registry.tsx`、`studio-resource-panels.tsx`、`studio-panel-modules.tsx`、`shared/studio-shell/studio-route.ts`、`use-studio-navigation.ts`、`studio-layout-store.ts`、对应 workbench | 合并独立 Preset 入口，按真实 ID 双入口定位；保留 Timeline/Branch；旧深链有明确映射，不跳到第一个资源 |
| F3 编辑器整合 | `widgets/agent-panel/`、`preset-workbench/`、`context-workbench/` 与现有 `features/context-assets/ui/`、Provider/State/Transform 详情 | 有序编排功能不缩水；未绑定模型可编辑；仅一份工具配置；失败/冲突不丢稿；不在 Detail 内再套完整工作台 |
| F4 包操作 | `features/extension-renderers/` 中包管理接线、`features/official-content/`、角色包入口与资源详情 | B1/B3/B4 对应能力可用；纯资源包没有无用运行面板；外部包预览零写入；安装/引用/复制/关闭互不混淆 |
| F5 检查与收尾 | `features/state-variables/`、`features/text-transforms/`、现有 Inspector、受影响导航/i18n | B5 inspection 可用；完成第 5 节场景，去除被本次替代的旧入口与孤儿代码，更新已实现 Architecture |

后端与前端分计划但不长时间脱节：每个可用数据切片接一条真实 UI 路径。F0 可以先做；F2-F5 不能靠 fixture 冒充后端完成。

正式布局继续由 Shell 的 Window/Column、AssetWorkbenchLayout 或 MasterDetailWorkbench 持有；共享控件不因本草稿需要被无关重构。只修改本计划列出的受影响消费者，不扩展为整个客户端重构。

## 7. 验收与停止条件

1. 在 reference 窄窗口、immersive 宽窗口与移动端下钻中，Agent/包/详情切换正确；只有 Shell 负责几何，长名称不挤出容器。
2. 从包定位 Agent 与从类型定位 Agent 为同一实体，未提交输入和保存基线不丢。A/B Agent 的工具配置互不串写。
3. 打开外部包前后比较业务请求与当前 Timeline/Branch：仅只读解析/读取，无 import、mount、enable、State 写入；关闭仍无业务副作用。
4. 衣物 Settings 安装到角色 A 不使角色 B 或全局自动生效；列表的当前使用和运行检查与后端结果一致。
5. 运行检查能解释一例同名宏冲突、一例正则未命中、一例共享 State 的旧 Revision 冲突，以及一例缺失工具执行器。
6. 旧 Preset 深链、布局恢复、失效引用、来源包卸载、草稿保存失败与 endpoint 切换不被新导航破坏。
7. 导出本体与打包分发的操作结果符合后端合同；不由 UI 自行裁剪危险内容。
8. 输入框直接切换 Agent 预设；程序调用目标与资源详情使用同一身份，没有 Profile → Preset 的第二次选择，也没有默认按功能替换失效目标。
9. 成功更新角色卡/扩展后，已有 Timeline 的资源视图与运行查询体现新版增删改，无逐存档 Apply；State 不因更新被重置，资源失效与作者迁移失败分别显示。

主要证据按切片选择：复用 `tests/unit/client/studio-workspace-navigation.test.ts`、`studio-history-navigation.test.ts`、`prompt-resource-command-failures.test.ts`、`macro-selection.test.ts`、`text-pipeline-runtime-catalog.test.ts` 中相关用例，新增内容只覆盖新行为。契约变化补 Client 类型检查；DOM/事件/网络诊断验证明确风险，不以全仓 build 代替操作验证。

主观布局、密度和操作手感由用户验收。没有真实后端结果时显示草稿/未接入，不虚构版本、诊断或成功通知；迁移语义未确认时返回底层计划，不让 UI 先形成永久兼容逻辑。

## 8. 本轮记录

- [x] 核对正式 Shell、路由、资源工作台与草稿差异。
- [x] 拆出 UI 工作包、后端依赖与运行检查内容。
- [x] 明确取消 Profile 层，补充输入框选择、程序调用与未来任务分派的统一预设入口。
- [x] 同步 Q2：更新后旧 Timeline 即时跟随资源，取消逐存档依赖更新 UI，区分作者迁移与平台数据安全。
- [ ] F0 补齐本轮讨论的代表场景并由用户确认。
- [ ] F1-F5 正式接线与验收。

本轮没有改动草稿或正式组件，也没有执行浏览器/业务测试。已有草稿验证不覆盖本计划新增的范围、安装或运行检查能力。本次涉及的 5 个文档共 95 个本地链接检查通过，两份新 Plan 的状态标记与空白检查、相关已跟踪文档 `git diff --check` 通过；不代表实施或人工视觉验收完成。
