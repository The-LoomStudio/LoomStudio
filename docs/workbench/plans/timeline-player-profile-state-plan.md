# Timeline 玩家资料 State 接线

状态：已接入，待界面与真实 Provider 验收。2026-10-28。下文保留执行设计；当前合同以架构文档为准。

## 实施结果

- 固定玩家 Entity 与基础资料组件已接入初始 State / Runtime Context；作者可引用内置实体，Card / Artifact 边界拒绝覆盖内置定义与资料路径。
- 启动 Dialog 已接模板选择、本次名称和描述编辑、头像引用复制；编辑与取消不写回模板。
- 故事内宏、开场、扩展初始化、本地宏上下文与消息头读取同一 Branch 资料；手动保存与 Branch 修订会刷新资料查询。无故事 Agent 继续用全局模板。
- 运行态编辑复用现有 State 面板，作者面板显示只读内置玩家候选及空白装配预览，保存仍只包含作者声明。
- 后续接入：“我的”增加当前故事资料快捷入口，保留当前 Timeline / Branch，直接展开并定位运行态描述字段；跳转前提交模板草稿，失败时不离开原页。
- 为维持新故事归档后的资料识别，Timeline 归档新增可选 Runtime Context；导入在校验玩家 Schema 和各修订资料后恢复声明。不增加头像媒体字节打包。
- 用户已授权旧 Timeline 暂不迁移、头像引用随副本复制；旧故事保留全局模板语义，文案已区分。
- 验证：客户端及其依赖项目 TypeScript 构建、测试类型检查通过；启动 UI 6 项、作者 UI / 来源 17 项、Timeline / 扩展 40 项，以及模板 / 宏 / 会话 / 归档定向检查通过。最终交付记录注明实际数量和未验收边界。
- 扩展检查：开场选择、Definition、State Runtime 与 State Content 四文件共 37 项，35 项通过；State Content 的两项既有脚本附件 fixture 缺少 `content.contributions`，在 `loom-script-text-pipeline.ts:40` 报错，未修改无关脚本合同。

## 目标

新 Timeline 启动时选择用户模板，并允许调整名称和描述；确认后的内容初始化为固定玩家 Entity 的资料组件。故事内编辑、宏与消息头读取当前 Branch 的同一份 State，不再跟随全局模板切换。

## 实施前已核对事实

- `profiles/user-profiles.ts` 保存全局模板和当前选择；`runtime/narrative-runtime.ts:readAgentTurnVariables` 每轮读取全局配置，即使调用者传入 Timeline State。
- `shared/src/macros.ts` 已将 `user`、`user.description` 映射到 `computed.user`；默认预设已经显式引用描述。不需要新增宏机制。
- State EC 以 `typeId + entityId` 标识实体，以组件路径分别物化和校验；重复声明会报错，不自动合并。
- `runtime/cards-runtime.ts` 保存作者配置前会独立物化 Card Contribution；State Artifact 导入、导出也会校验引用。仅在 Timeline 创建时添加内置 Entity，无法支持作者直接挂载组件。
- `new-story-extensions.tsx` 已有启动确认窗口；当前故事内变量可通过 `StateVariablesPanel` 编辑，并有 `onStateMutated` 回调。
- `use-studio-state.ts` 当前向消息头及本地宏渲染提供全局用户资料。客户端尚不能直接复用一份已有的故事用户资料查询。
- Timeline 归档包含 State 修订；Runtime Context 保存实体、组件与 Schema。新增组件应进入这条既有链路。

以上路径相对各自包的 `src`；当前事实来自源码阅读，未执行运行验证。

## 已确认方向

- 应用提供固定玩家 Entity 和基础资料组件，不提供统一血量、关系等玩家模型。
- 作者可往内置 Entity 挂组件，也可另建自己的主角 Entity；两者并存，不按名称推断关系，不自动合并或同步。
- 全局用户资料保留为可复用模板；初始化复制内容，不建立实时联动。
- 用户名和描述通过既有宏被预设显式读取，不因存在 State 就自动追加 Prompt。
- 资料值跟随 Timeline / Branch State，沿用修订、分支和恢复机制。
- 本轮不增加 AI 优化模板、描述解析或作者变量自动初始化映射。

## 最小设计

### 内置声明与存储

在 shared 中集中定义玩家 Entity 引用、组件路径和基础资料类型；在 Application Runtime 增加内置 Contribution 工厂。已采用：typeId `loom-player`，collectionPath `$loom.players`，entityId `User`，组件键 `loom_profile`，模板 ID `loom.player-profile`。

`$loom.players.User.components.loom_profile` 保存 `name`、`description`。这些名称应通过常量引用，不在各消费者中手写路径。Entity ID 不随用户名改变。头像是否同行见未决项。

应用提供实体声明和资料组件 Schema；作者仅声明自己的模板和挂载。保留标识不可被作者重复定义，原始路径 Binding 也不能覆盖资料组件或其父对象；作者在玩家实体的其他组件路径正常挂载。复用现有冲突错误，不允许“后写覆盖”。

校验时认识内置实体，与把内置内容写进作者资源是两件事：Card / State Artifact 可以引用内置实体，但导出只包含作者声明，不夹带当前用户资料。对缺失引用仍保持严格校验，不启用宽泛的允许外部引用来绕过。

### 初始化与消费

启动窗口返回扩展选择和本次最终资料内容。选模板仅填充本次草稿，不切换全局当前模板，也不修改模板正文。提交的是草稿值，服务端不能在提交后重新按全局当前选择解析。

创建流程先合成内置、Card 和扩展声明，使用本次资料展开开场及初始化 Lore，再调用扩展初始化，最后在既有事务内保存完整初始 State 和 Runtime Context。初始化失败不留下半成品故事。

`readAgentTurnVariables` 有故事上下文时从该 Branch State 派生 `computed.user`；宏别名保持不变。无故事上下文的普通 Agent / 作者预览继续使用全局选中模板，isolated Agent 保持隔离。已声明内置资料的故事若组件丢失应报错，不能退回全局掩盖损坏。

客户端按 endpoint、Timeline、Branch 读取玩家资料，消息头、本地宏渲染与服务端使用同一取值约定。State 保存、分支切换、恢复和 Run 后刷新应更新该查询；旧请求不能覆盖新目标。复用已有 Query、刷新回调与生命周期，不新增独立资料存储或推送协议。

### 编辑入口

“我的”继续管理模板，更新“所有故事一起使用”等旧语义文案。现有启动 Dialog 增加模板选择和本次名称、描述编辑，复用现有输入组件。故事内首版复用运行态 State 面板编辑这两个字段，不增加第二套资料编辑器。

作者初始化配置的实体、类型和挂载选择器显示只读的内置玩家候选；装配预览也包括内置声明。内置声明不保存回 Card 的作者配置。运行态来源检查应能说明这是应用内置组件，不能伪装成某个扩展的声明。

## 有序工作包

主 Agent 负责 State / Runtime / 消费集成，启动窗口与作者候选 UI 采用互不重叠的委派写集，分别提供定向验证。

1. **内置合同与作者引用**：新增 `packages/shared/src/player-state.ts`、`packages/application-runtime/src/profiles/player-state.ts`；接入 shared 导出、`state/state-contribution.ts`、`runtime/cards-runtime.ts`、`cards/workspace.ts` / `workspace-codec.ts` 的校验。验收作者仅引用内置实体也能保存、导出和导入，且不能覆盖内置定义。
2. **初始化与服务端宏**：修改 `types.ts` 的 `CreateNarrativeTimelineInput`、`runtime/narrative-runtime.ts`、`apps/studio-server/src/rpc/trpc/application/timeline.ts`。将内置组件完整纳入 Runtime Context；核对 `runtime/agents-runtime.ts`、`runtime/macros-runtime.ts` 及扩展中途采用 / 初始化的既有消费者。不要重建 State Store 或另设资料 RPC。
3. **启动及客户端消费**：修改 `features/extension-renderers/ui/new-story-extensions.tsx`、`features/narrative-runtime/model/use-narrative-runtime.ts`、`app/use-studio-state.ts` 和消息头接线；增加一份故事资料查询。本地宏渲染复用既有 `user` / 快照输入，无需修改渲染器。区分绑定故事的聊天与无故事聊天，避免全局替换所有消息头身份。
4. **作者入口和说明收口**：修改 `features/state-variables/ui/state-authoring-panel.tsx` 的内置候选及装配预览、状态来源展示、四语言用户资料文案；更新 `docs/architecture/application/user-profiles.md`、`state-and-variables.md`。State 编辑完成后刷新同一资料查询。

上述客户端路径相对 `apps/studio-client/src`，Runtime 路径相对 `packages/application-runtime/src`。现有文件有其他任务修改，实施时按当前内容增量修改，不覆盖工作区。

## 验收与验证

- 模板 A 创建两个故事后，各自的名称、描述可以独立修改；修改或删除模板不改变已有故事值。
- 开场、初始化 Lore、宏检查及实际构建读取同一次确认的资料；消息头与本地展开保持一致。
- 作者往内置玩家挂自己的组件可完成 Card 保存和 Bundle 往返；另建 `User` / “主角”等实体不被自动绑定；保留身份及资料路径冲突明确失败。
- State 修改只作用于目标 Branch；分支切换、历史恢复与归档往返沿用对应资料值。资料修订不重新展开已保存正文。
- 无故事 Agent、isolated Agent 和作者预览分别保持前述语义。
- 复用并调整 `default-preset.test.ts`、`card-bundle-roundtrip.test.ts` 和 `new-story-extensions.test.ts` 中相关用例；重要的分支隔离 / 路径冲突行为可补最小用例。按跨包类型变化选择相关类型检查，不自动执行全仓检查矩阵。
- UI 人工验收关注启动草稿、模板与故事值的区分、运行态编辑入口；不以静态或测试结果代替浏览器和真实 Provider 验收。

## 已确认边界与剩余验收

- **旧 Timeline**：保留现有全局读取，不回填历史。后续如需隔离，应另定初始化值来源、触发方式及历史分支范围。
- **头像**：启动时复制所选模板的 `avatarAssetId`，不新增图片上传流程或媒体打包能力，不能据此声称 Timeline 归档已携带媒体字节。
- **剩余验收**：启动窗口布局、模板副本操作与运行态编辑入口由用户人工验收；未执行真实 Provider 或完整用户数据验收。
