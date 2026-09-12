# 会话恢复与历史导入导出计划

> **Status**：Complete
> **日期**：2026-09-12
> **授权**：用户确认先写计划并开始实施。先修复会话恢复与选择，再推进独立的历史移植能力；不依赖 CLI/MCP。

## 目标

打开 Timeline 后能恢复最近活动的 Agent Session，在右侧选择已有会话或开始新会话；随后为 Timeline 提供有明确保真范围的导入导出能力，供 UI 与 ST 兼容扩展共同消费。

## 已确认事实

- `packages/agent-store/src/store.ts` 的 `readSession` 漏读 `timeline_id`，列表查询没有遗漏；列表已经按最近活动排序。
- `apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts` 打开 Timeline 时清空 Session；发送时直接新建，不查询历史；读取失败可能保留旧消息。
- `packages/application-runtime/src/runtime/agents-runtime.ts` 目前只从显式 `narrativeTarget` 装配上下文，不解析 Session 的默认绑定。
- Narrative Store 和 Agent Store 只有领域读写与分页接口，没有正式历史导入导出合同。
- Timeline 的节点和分支引用 State Revision；Session Transcript 包含推理、工具调用与结果，不只是聊天正文。
- ST 兼容计划首阶段明确排除聊天记录迁移，当前扩展没有聊天转换实现。

## 决策

1. Timeline Binding 是默认上下文，不是所有权或授权。延续 [Session Context 计划](./agent-session-context-and-workspace-capability-plan.md)，不新增分支绑定字段。
2. 打开 Timeline 恢复按 `updatedAt` 排序的最近会话，并同步 Agent Profile；没有历史时不创建空 Session。新建按钮先进入草稿，发送时创建。
3. 会话选择器只显示当前 Timeline 的会话；独立上下文只显示独立会话。打开历史会话时同步其绑定目标，不把其他 Timeline 的消息混进当前页面。
4. 绑定 Session 未指定 Target 时，读取绑定 Timeline 的当前活动分支；默认不提交叙事。显式跨 Timeline Target 拒绝。Workspace Session 的显式 Target 不形成绑定。
5. 导入不携带 Agent Session、Transcript、账号凭据或运行中任务；导入后在目标环境新建 Session。
6. ST 扩展只负责外部格式转换。平台拥有规范输入校验、ID/引用映射和一致性写入，不把 ST 解析逻辑放进主应用。
7. 外部聊天迁移与原生完整存档必须标清保真范围。缺失 State 历史时不得声称恢复原始回滚能力；不以正文导出冒充完整存档。
8. **已确认：游玩会话的原生导出单位是完整 Timeline 存档包。** 第一版只保证 Timeline、全部分支、节点和每条分支/节点引用到的 State Revision 链；不打包资源和二进制附件。
9. 记忆不是 Timeline 核心字段。未来由记忆插件通过可选的 Archive Participant 自己序列化和恢复；平台只负责在存档中承载带命名空间和版本的可选数据块，不解释插件私有内容。

## 非目标

- 不启动完整游玩导航重构、CLI/MCP、CodeAct、Workspace Capability 或数据目录开发模式。
- 不新增最近选中 Session 的持久化配置；使用现有活动时间。
- 不自动解绑失效 Timeline，不迁移或删除用户现有历史。
- 不自动恢复执行中任务，不从外部记录推断工具执行事实。

## 工作包与文件边界

### WP1：恢复、选择与默认上下文

主 Agent 直接实施与验收。

- `packages/agent-store/src/store.ts`：修正单项 Binding 读取。
- `packages/application-runtime/src/runtime/agents-runtime.ts`：统一默认上下文、显式目标冲突检查；复用已有 PromptBuild 和 Tool Scope。
- `apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts`：列表/恢复、Profile 同步、新会话草稿、首次发送绑定正确性与过期请求隔离。
- `apps/studio-client/src/app/{app.tsx,use-studio-state.ts}`、现有布局 Props 转发、`widgets/agent-chat-panel/`：复用现有选择器和图标工具栏，不另建管理页面。
- 相邻 i18n、定向测试。

完成条件：A/B Timeline 快速切换不串消息；进入 Timeline 恢复最新会话；选择旧会话同步 Profile；空列表和新建草稿不写数据库；首次叙事发送绑定刚创建的 Timeline；绑定上下文进入 PromptBuild，跨 Timeline 显式目标明确失败。

### WP2：Timeline 原生存档合同与实现

入口：Narrative Store、State Store、Application Runtime、Studio RPC 与 Timeline UI。导出包使用版本化格式，收集所有分支、节点和 State Revision 链；不引入资源/附件闭包，也不依赖 Artifact/Blob。数据库 ID 只作为导入时的临时映射键。

完成条件：原生 Timeline 导出后可在临时数据库导入为新 Timeline；分支拓扑、节点顺序和 State Revision 链保持；外来 ID 不覆盖本地数据；损坏输入不产生半份 Timeline；导入不执行工具或授权副作用。资源和附件不属于第一版存档保证范围。

### 后续边界：记忆参与者与 ST 聊天接入

入口：Narrative Store、State Store、Application Runtime、Studio RPC、Session/Timeline UI、`official/extensions/st-data-compat/src/`。

未来记忆插件通过类似下列边界参与，不把记忆字段塞进 Narrative Store：

```ts
type TimelineArchiveParticipant = {
  namespace: string
  version: number
  export(input: { timelineId: string; nodeIds: string[] }): Promise<unknown>
  import(input: { timelineId: string; nodeIdMap: Record<string, string>; payload: unknown }): Promise<void>
}
```

插件不可用时，核心 Timeline 仍可导入；未知记忆块保留为待处理数据并显示警告，不能静默丢弃。ST 扩展只负责把外部聊天转换成平台规范输入；外部数据没有 State/Agent 执行事实时不得编造。

## 验证预算

- WP1：Agent Store 定向测试证明 Create/Get/List/Transcript Binding 一致；Application Runtime 定向测试证明默认上下文与跨目标拒绝；Client 定向验证恢复与请求竞争。Props/调用类型改变时运行相关 Client 类型检查。
- WP2：使用临时数据库验证往返、未知 Participant 保留、失败原子性和分支恢复；不写用户真实卡或会话。
- 不默认全仓测试或浏览器视觉巡检。视觉与交互手感由用户验收。

## 停止条件与开放问题

- 记忆插件的迁移、版本升级和未知命名空间处理需要在记忆模块落地时补充正式合同；当前不实现记忆存储。
- Session Transcript 不属于 Timeline 存档；导入后由用户在目标环境新建 Session。
- 不因为导入导出需要而添加自动执行、自动授权、跨库非原子写入或另一套运行时。
- 以上开放问题不阻塞 WP1；WP1 不宣称完成旧 Session Context 计划中的解绑与 Capability 工作包。

## 当前结果

- WP1 已实施：`Agent Store` 单项读取保留 `timeline_id`；Timeline 进入时恢复最近会话；顶部可选择、新建和刷新会话；失败恢复不会保留旧消息或静默创建重复会话；绑定 Timeline 作为默认 Prompt 上下文；首次发送使用刚创建的 Timeline；过期异步请求不会覆盖新选择。
- 已先落地 Timeline Archive Participant 注册合同：插件以稳定 `namespace` 和格式 `version` 注册，导出返回自己的数据块，导入收到新 Timeline 与 Node/State ID 映射；未知命名空间保留为未处理结果，不会静默丢失。
- WP2 已完成核心 JSON 合同、分支/节点/State Revision 导出导入、Participant 注册和 Timeline UI 导入导出入口；坏存档原子性、多分支/空分支恢复和 UI 导入结果提示已补齐。Session/Transcript 明确排除，导入后由用户在目标环境新建 Session。Timeline 全量分支与 State 存档范围已确认，资源/二进制已明确排除；记忆只保留未来插件参与点。
- 相关验证：Agent Store 与 Application Runtime 定向用例通过；Timeline Archive participant 用例 `3 passed`；Timeline Archive 导出/导入、坏存档原子性与分支恢复用例 `3 passed`；Client TypeScript 检查通过；packages TypeScript 检查通过；独立内存浏览器探针 `9 PASS`；原有 Application Runtime 测试存在一项与本次无关的官方预设初始化失败。
