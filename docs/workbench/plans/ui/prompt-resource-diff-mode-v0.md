# Prompt Resource Diff Mode v0

> **状态**：Planned / Blocked by Revision and Tokenizer Contracts
> **日期**：2026-08-05
> **主题**：为提示词资源编辑器定义按需 Diff 模式、Token 变化指标、文件树变更入口及前后端协作边界。
> **计划边界**：本文记录已经接受的实施方向、依赖和分阶段交付顺序。Revision、Tokenizer 与前后端合同未确定前，不开始代码实现。

---

## 1. 决策摘要

提示词资源的 Diff 不作为编辑器常驻区域，而作为按需进入的第三种查看模式：

```text
Edit Mode
Render Mode
Diff Mode
```

Diff Mode 只在用户主动进入时加载比较基线、Tokenizer 与差异结果。普通编辑状态只维护低成本的 dirty / revision 状态，不持续计算完整 Diff。

桌面宽屏下，Diff 默认采用左旧右新的双栏结构：

```text
Base Revision                 Current Draft
原版本                         当前版本
```

窄窗口或移动端退化为 Unified Diff，避免自然语言长行被双栏压缩。

文件树最右侧的 trailing 区域保留给新建、已修改、保存中、失败或冲突等临时状态。生命周期等资源固有属性继续显示在路径元信息附近。点击变更状态可作为进入该资源 Diff Mode 的快捷入口。

---

## 2. 为什么 Diff 是模式

Diff 不是日常写作的默认界面。将它常驻在现有编辑器旁边会带来以下问题：

1. 持续挤压自然语言正文的阅读宽度；
2. 诱导前端对每个打开资源持续计算差异与 Token；
3. 在比较基线不明确时展示似是而非的结果；
4. 历史 Revision、当前草稿、外部同步版本和冲突版本会争夺同一块常驻 UI；
5. 插件资源与第一方资源难以共享一致的性能边界。

因此采用以下原则：

> 变更状态常驻，完整 Diff 按需；普通编辑保持轻量，比较行为显式进入。

---

## 3. Diff Mode 的界面职责

Diff Mode 至少回答四个问题：

1. 当前内容与哪个版本比较；
2. 哪些内容被增加、删除或修改；
3. 当前草稿的 Token 规模发生了什么变化；
4. 用户可以执行哪些恢复、审阅或版本切换操作。

### 3.1 Header

候选信息：

```text
Base: Opening Revision
Tokenizer: <tokenizer-id>
+128 Tokens / -42 Tokens
```

候选动作：

- 返回编辑；
- 切换比较基线；
- 恢复到基线；
- 审阅或接受当前草稿；
- 在资源变更总览中定位该条目。

首版不要求同时实现全部动作。

### 3.2 Diff Body

宽屏默认：

- 左侧展示只读基线；
- 右侧展示当前草稿；
- 两侧滚动位置联动；
- 当前草稿是否允许直接编辑，实施前再决定。

窄屏默认：

- 使用 Unified Diff；
- 不强行保留左右双栏；
- Token 摘要仍位于 Header。

---

## 4. Token 指标不是通用常量

提示词资源比代码行数更关心 Token，但 Token 数依赖具体 Tokenizer。同一段文本在不同模型或 Provider 下可能得到不同结果。

因此禁止在缺少 Tokenizer 身份时展示伪精确 Token 数。

指标必须区分：

```text
Exact Token Count:
  已知 tokenizerId，并使用对应实现计算。

Estimated Token Count:
  未知精确 Tokenizer，只能展示估算并明确标记。
```

精确 Token Diff 至少需要：

- 相同的 `tokenizerId`；
- 明确的 base content 与 current content；
- 可复现的 Tokenizer 版本；
- 对 Tokenizer 缺失、加载失败和版本变化的降级策略。

需要注意：一次很小的文字修改也可能改变邻近 Token 的切分。因此 `+N / -M Tokens` 是同一 Tokenizer 下两组 Token 序列的差异，不等同于字符级增加与删除。

---

## 5. 状态与计算分层

### 5.1 常驻的低成本状态

普通编辑期间只维护：

- `clean`；
- `new`；
- `modified`；
- `saving`；
- `save-failed`；
- `conflicted`。

dirty 判断优先依赖 revision、content hash 或已有草稿状态，不运行完整文本 Diff。

### 5.2 按需的高成本状态

进入 Diff Mode 后才执行：

1. 解析比较基线；
2. 获取基线内容；
3. 解析 Tokenizer 身份；
4. 加载 Diff / Tokenizer 实现；
5. 计算文本差异与 Token 摘要；
6. 缓存结果并渲染。

候选缓存键：

```text
resourceId
baseRevisionId
currentContentHash
tokenizerId
tokenizerVersion
```

仅在 Diff Mode 内继续编辑时，才需要对重新计算做防抖。普通编辑模式不承担该成本。

---

## 6. 前后端责任边界

### 6.1 后端候选职责

- 提供权威 Revision 身份与基线内容；
- 提供可比较版本列表；
- 声明模型或 Provider 对应的 `tokenizerId`；
- 在需要时提供 Tokenizer 能力或标准化 Token 统计结果；
- 处理服务端版本冲突、历史 Revision 与恢复写入；
- 保证比较基线不会在无提示的情况下漂移。

### 6.2 前端候选职责

- 管理 Edit / Render / Diff 视图模式；
- 展示文件树的低成本变更状态；
- 保存当前草稿的编辑器状态与滚动位置；
- 按需请求基线和 Tokenizer 信息；
- 渲染双栏或 Unified Diff；
- 缓存当前客户端会话内的 Diff 结果；
- 在信息不足时明确显示估算或不可用状态。

前端不应自行假设一个全局通用 Tokenizer，后端也不应强制所有资源都绑定同一种模型。

---

## 7. 与现有编辑体验的关系

当前长文本编辑器已经具备打开时基线、行级修改痕迹、撤销和恢复打开时版本。这些能力不等于完整 Diff Mode：

```text
Edit change trace:
  为当前写作提供即时、低成本反馈。

Diff Mode:
  显式比较两个版本，承担审阅、Token 分析和版本恢复。
```

两者可以共享基线与 Diff 基础设施，但不应共享全部 UI 状态。关闭 Diff Mode 后，编辑器应恢复原来的光标、选区和滚动位置。

---

## 8. 建议的分阶段实现

### Phase 0：当前阶段

- 只保留设计文档；
- 文件树 trailing 区域保持可扩展；
- 不引入 Tokenizer 或后端 RPC；
- 不增加 Diff Mode 空壳按钮。

### Phase 1：本地草稿比较

- 比较打开时版本与当前草稿；
- 使用现有前端基线；
- 实现宽屏双栏与窄屏 Unified Diff；
- Token 信息可以暂时缺席。

### Phase 2：Revision 与 Tokenizer 合同

- 后端提供 Revision 基线；
- 模型配置提供 Tokenizer 身份；
- 展示精确或明确标记的估算 Token；
- 支持切换比较基线。

### Phase 3：资源变更总览

- 汇总多个已修改资源；
- 展示每个资源的 Token 增减；
- 支持逐项审阅、恢复和冲突处理；
- 与独立窗口和横向工作区集成。

---

## 9. 实施前必须回答的问题

1. 默认基线是打开时内容、最近保存 Revision，还是用户选择的历史 Revision？
2. 当前草稿是否已经进入 Document Store，还是只存在于客户端？
3. Tokenizer 身份由资源、模型配置、Provider 还是当前会话决定？
4. Diff Mode 的右侧当前版本是否允许直接编辑？
5. 恢复操作是本地草稿替换，还是创建新的 Revision？
6. Extension Document 如何声明自己的文本字段与 Diff 能力？
7. 文件树状态是客户端 dirty 状态，还是后端权威 Changeset 状态？
8. 多资源变更总览属于当前资源窗口、独立 Window，还是 Base Desktop？

这些问题未形成合同前，不开始实现完整 Diff Mode。
