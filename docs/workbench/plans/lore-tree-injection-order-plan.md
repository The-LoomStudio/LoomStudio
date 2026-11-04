# Lore 树顺序与锚点投影

状态：已实现，待用户视觉验收。2026-11-03，用户确认。

## Goal

作者只在文件树排序一次；每本 Lore 根节点的 Context Menu 提供“按锚点查看”只读对话框。

## Verified facts

资源树已有持久化 orderIndex 和 DFS 收集入口；作者目录通用 capabilities 会保留旧 localDepth。相同字段还属于工具、SDK 扩展与运行时贡献，不能全局删除。工作区已有多条并行修改，按现状增量编辑。

## Inherited decisions

树是唯一作者排序权威；旧作者节点 localDepth 可直接删除。每个锚点保留树中相对次序；锚点组按本书首次出现顺序展示，不代表预设布局。不增加第二份可编辑排序。

## Minimal design

shared 提供作者深度清理函数；数据层迁移清除当前节点 KV，并在节点读写边界避免旧版本恢复带回；历史事实不重写。Runtime 的公共收集路径按资源采用顺序与树 DFS 派生贡献深度。工具、扩展与历史贡献继续使用自身合同。

作者 Schema、Artifact 和文件化边界使用同一清理规则。Explorer 持有打开的根节点 ID，从当前树解析内容；仅 Lore 资源根节点出现菜单入口。对话框展示目标锚点、来源路径、条件与继承禁用状态，不推测本轮激活或预设位置。

## Work packages

1. shared/prompt-resource-contracts、authoring contracts；application-data/prompt-resource 迁移与节点边界；Runtime mapper、workspace-codec、authoring Runtime。
2. ST normalizer 与官方 Lore 移除作者深度；作者文件往返保持树顺序。
3. client/prompt-resources 增加只读投影与菜单对话框，移除作者深度输入，补四语文案。
4. 更新 Architecture，完成定向验证并记录结果。

## Acceptance and validation

定向行为检查覆盖移动 Alice/Bob 文件夹、两个目标锚点、条件/禁用、多本资源不交错、旧字段迁移/恢复与作者文件往返。复用 Store、Runtime 和 Client 现有测试；重要新合同补最少用例。相关 TypeScript 检查验证跨层集成。无计费 Provider、用户数据修改、浏览器纯视觉巡检；视觉由用户验收。

## Open questions or blockers

None。

## 实施结果

- 已接入每本世界书根目录菜单、只读分组对话框与四语文案；根节点 ID 绑定当前树，不缓存旧对象。组内展示路径、条件候选和继承禁用；普通子文件夹不显示入口。
- 数据层 v9 清理现存 Preset/Lore 节点 localDepth；新写入和撤销恢复均清理，保留不可变历史记录。作者 Artifact、Schema、CLI 文件化与 ST 转换停止保留该字段；工具与扩展 Runtime 深度合同不变。
- ST 三个 normalizer 与 The World Lore 的本地源文件已更新；这些 extensions 文件被当前仓库 Git 忽略，未改变忽略规则或强制加入版本控制。
- 7文件57项定向测试通过；追加的 Runtime、Tool、CLI HTTP/Watch 三文件27项通过，ST importer 4项通过，共88项。Store套件首轮出现与随机挂载 ID 排序有关的既有断言失败，后续原断言通过；未修改该断言。
- post-session-anchor 两项旧失败在 HEAD 编译器的临时只读替换运行中原样复现，未修改测试或相关 fallback；这不是本次修复目标。Client及依赖链 TypeScript构建通过。全测试 TypeScript检查未通过，错误位于本次未改的 session-attachments、narrative-runtime、markdown-rule、use-timeline-session、workbench-view-state 等测试/支撑文件；本次新增测试没有报类型错误。
- 未操作用户数据库、调用Provider或启动视觉巡检。迁移在应用下次打开相应数据库时执行；旧CLI目录可能因摘要变化冲突，需保留原编辑文件并导出到新目录重新建立基线。主观布局、移动端与键盘体验仍需用户验收。
