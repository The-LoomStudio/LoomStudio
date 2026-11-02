# 作者设置与资源有效状态联动

状态：方向已确认，源码调研完成；尚未实施。日期：2026-11-02。
本轮范围：只调研、记录方案，不修改运行契约或用户数据。

## 已确认目标

作者定义系统开关和显示选项，绑定提示词条目、正则、工具及渲染贡献。用户修改设置值，不批量改写资源 enabled。资产不参与联动。系统未启用时，游玩中的提示词构建、AI 搜索、直接读取及 VFS 都不得暴露对应说明；作者编辑仍可见。启用条件与关键词等提示词触发条件分离。不新增内嵌提示词格式或专用 VFS 根目录。

## 当前源码事实

- extension-sdk/src/index.ts：ExtensionSettingContribution 已支持 boolean/select 等声明与 global/card/timeline/agent-session scope；不是所有设置都天然属于同一故事。
- shared/src/loom-script-metadata.ts：脚本已有 settings 与 $config 配置引用，规则 enabled 可由配置解析；尚不能跨资源统一绑定。
- application-runtime/src/scripts/loom-script-resolution.ts：采用版本与 adoptedSettings 是运行快照。不能让提示词读最新配置，而正则/代码仍使用旧采用配置。
- application-runtime/src/runtime/extension-resource-access.ts：已有扩展来源可用性检查，包含安装范围、Timeline participation 和 Prompt dependency lease；应保留并组合，不能仅检查已安装。
- application-runtime/src/agents/agent-turn.ts：先解析已采用资源，再生成提示词输入及 readableResourceIds。安装不等于被某个 Agent 采用。
- application-runtime/src/cards/workspace-codec.ts：资源树转换为原子贡献，适合接入节点级有效状态，但不能把此处当成唯一过滤点。
- application-runtime/src/agents/official-tools/search-prompt-resources.ts 与 read-prompt-resource.ts：独立搜索/读取入口已有扩展来源检查，需补同一资源有效状态判定。
- application-runtime/src/agents/codeact/context.ts：VFS 目前传递资源 IDs，access 回调固定 read；节点级联动必须接入实际访问判断。
- application-runtime/src/vfs/resource-filesystem.ts：已有 /resources 投影、enabled 过滤及 author/play 模式，无需新增根目录。直接路径读取也必须遵守有效状态，不能只隐藏目录。
- application-runtime/src/scripts/loom-script-text-pipeline.ts：正则/提取器按有效 Mount、采用配置、扩展可用性及 requiresCode readiness 解析，需组合作者设置约束。
- extensions/the-world/manifest.json：已有 weather-effects-enabled 设置及世界状态工具声明，适合作为首个跨资源验收案例，但天气效果开关不应自动等同整个世界系统开关。

## 建议的最小设计（尚非公共契约）

1. 在资源归属方声明设置与稳定贡献/条目引用的绑定，引用用 ID，不用显示名或 VFS 路径。首版限制在作者可管理的同一来源内，避免任意跨包依赖图。
2. 复用已有配置存储和设置 UI；补纯数据条件（开关、枚举选择），不执行任意 JS。复用现有条件求值器的逻辑，但有效状态与 Prompt activation 分开。
3. 产生统一的有效状态判定结果及原因。作为原有权限、采用、enabled、运行就绪检查的附加门槛，不能授予权限或自动采用资源。
4. Prompt、文本管线、工具暴露与调用、客户端渲染、搜索及 VFS 消费同一上下文中的判定。无需增加 PromptBuilder 对各资源 Schema 的扫描。
5. UI 显示原始开关和实际未生效原因；编辑模式保留资源。已有运行脚本应按现有刷新/释放契约处理，不能将配置保存隐式改成重启。

## 待收束的实施边界

- 作者设置宿主：扩展已有声明 UI，独立角色包是否首版新增同等声明？不能默认所有作品都必须包装成扩展。
- 设置作用域：沿用现有显式 scope，不推断新的全局→角色→故事继承链；作品级默认作用域待确认。
- 生效时机：本轮已构建提示词无法撤回；需要定义下一轮采用和运行中工具调用复核，保留现有取消/lease机制。同一轮提示词与能力不得混用不同配置版本。
- 引用粒度：需要资源根、文件夹/原子条目、具体贡献，防止关闭工具说明时误隐藏仍有用的世界设定。
- 条件不命中与禁用严格区分：前者按现有权限仍可读取，后者在 play 范围不可搜读。

## 分期与验收

先接入既有扩展设置与同来源提示词条目/正则贡献，打通提示词、搜索、直接读取及 VFS；再接工具与渲染生命周期。角色设置宿主能力另行明确，不把一期结论宣传为全作品系统已支持。

验收用同一作品的 A/B 系统：关闭 A 不改变条目原始 enabled；A 在注入、搜索及已知路径读取中不可见；B 不受影响；作者编辑可见 A；重新开启恢复。切换同一正则的渲染样式仅改变渲染，不关闭共用说明或规则。配置作用域、旧采用版本、卸载/缺失引用、运行中切换均需有明确结果。

成本判断：已有扩展内的联动属中等改造；覆盖独立角色设置、所有消费者、运行期一致性属于跨模块工作。格式和条件计算成本低，采用版本、作用域、运行生命周期及访问边界是主要成本。不建议新增持久化通用注册表或另一套提示词存储。
