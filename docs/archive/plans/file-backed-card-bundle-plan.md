# 文件化角色包与 PNG 分发

> **Status**：Completed / Archived
> **日期**：2026-09-11
> **授权**：用户确认目录化作者资源、ZIP 打包、PNG 元数据携带 Base64 ZIP，要求先形成正式计划并开始实施。
>
> **用户验收后修订**：原基线未覆盖真实 ST 大卡的重复文本与封面载荷问题，后缀和文件目录也需调整。修复与实测结果见[后续修复计划](./card-bundle-size-and-layout-fix-plan.md)，该修复已另行通过用户验收。

## 目标与实施前事实

让角色包解包后得到可编辑的 Markdown、JavaScript、State JSON 与资源索引；重新打包后能够导入。ZIP 与 PNG 使用同一份 Bundle，不维护第二套 PNG 资源格式。

- 当前 `codecs/card-bundle-zip.ts` 使用 ZIP v1，核心 Card Artifact 内嵌在 manifest；媒体、脚本和扩展载荷已经分文件。
- 当前 `codecs/card-png.ts` 使用压缩 iTXt 保存旧 JSON Artifact；另有 PNG 尾部附加 ZIP 的 Polyglot 入口。
- Card Artifact v3 未携带角色自有 Rule / Extractor，是官方完整样例的已知缺口。
- ST 转换已经通过 Host RPC 调用，不依赖 Loom 自身运输容器。此次不修改 ST 扩展。

## 已确认决策

1. ZIP v2 的 manifest 只负责格式与文件引用；Card 配置、Prompt 节点索引、正文、State、宏、脚本、文本规则和媒体分文件。
2. Prompt 索引保留稳定 ID、节点顺序、父子关系与元数据，正文保存为独立 `.md`。文件路径不是资源身份。
3. State 保存作者声明而非 Timeline 运行快照；模板、实体类型、实体初始化等允许通过索引分文件维护。复用既有 State Artifact，不新建 State 数据引擎。
4. PNG 新出口将同一 ZIP 编为 Base64 存入专用 iTXt；导入提取后直接复用 ZIP 解码。保留旧 JSON PNG、ZIP v1 和现存 Polyglot 的读取兼容。
5. 新格式显式识别后损坏必须报错，不降级为 ST 导入。封面剥离已有 Loom 载荷，避免导出反复嵌套旧角色包。
6. 补齐角色自有 Rule / Extractor 的导入导出，导入后重新绑定到新 Card；不携带外部 Owner、Session 或运行覆盖。脚本仍默认未授权、未启用。
7. SQLite 继续是应用权威存储；文件只是编辑与分发表示。现有依赖足够，不新增依赖或另建通用 Codec 注册平台。

## 工作包与边界

- [x] WP1：主 Agent，补齐 Card Artifact 文本管线数据及事务导入导出。范围：`packages/application-runtime/src/cards/workspace.ts` 与定向测试；只增加必需公共字段，不迁移数据库。Artifact 升至 v4，读取 v2/v3。
- [x] WP2：主 Agent，实现角色文件投影与 ZIP v2；保留 ZIP v1 解码。范围：`apps/studio-server/src/codecs/card-bundle-files.ts`、`card-bundle-zip.ts` 和相关测试。
- [x] WP3：主 Agent，PNG 元数据 ZIP 封装、原生格式识别、Server 正式导出/导入接线与尺寸边界。范围：`card-png.ts`、`main.ts`、`http/http-server.ts` 和相关测试。
- [x] WP4：主 Agent，真实文件编辑往返、跨实例导入验证、ST 回归与文档交付。范围：相关定向测试、格式说明、计划索引与官方内容计划的交接记录。

## 完成条件与验证预算

- ZIP 解包可直接看到正文 `.md`、脚本 `.loom.js`、宏与 State JSON；编辑正文再 ZIP 打包导入后读取到新内容，稳定节点 ID/排序/引用保留。
- 包含多个实体初始化的 State 可往返；Card Rule / Extractor 重新归属导入的新 Card；脚本源码字节不变且不自动授权。
- 新 PNG 可独立恢复完整 ZIP，含背景等媒体；普通 PNG 仍由 ST 扩展尝试转换，旧 Loom PNG/ZIP 可读。
- 路径越界、重复 ZIP 路径、丢失引用、非法 JSON/UTF-8、过量条目和超限解压明确拒绝；写入前完成文件解析与领域校验。
- 运行 Card Bundle/PNG 定向测试、Card Artifact 领域测试、Server 导入集成测试；公共合同与导出接线改变，补 Application Runtime 和 Server 构建。不运行全仓测试。
- 浏览器主观验收由用户负责；没有执行不得标记通过。

## 非目标与停止条件

不实现 CLI、文件监听、自动合并、双向同步、远程安装、通用 Package 依赖图、ST 格式改造或进程沙箱。不把本计划完成视为所有官方样例已交付。

若需要改变权限、现有身份、数据库迁移或覆盖用户数据，停止并确认。旧格式只读兼容；不通过静默丢字段实现所谓兼容。

## 结果

已完成文件化 ZIP v2、PNG `loom.bundle` Base64 ZIP、旧容器读取以及 Artifact v4 的 Card 自有文本规则/提取器携带。ST 扩展本轮无需改动，ST 格式导入回归通过。

实际补充：修复共享 State 模板导出遗漏 `componentKey` / `targetEntityTypeIds`；支持 ZIP 数据描述符、实际解压计数、重复路径拒绝及流式输入分块，保持既有总大小预算。统一 State 存在时不重复导出旧模板副本；旧字段由统一 State 恢复。没有修改数据库格式、扩展授权或运行 State。

验证：

- `pnpm exec vitest run tests/unit/studio-server/card-bundle-zip.test.ts tests/unit/studio-server/card-png.test.ts tests/unit/application-runtime/workspace-artifact-boundary.test.ts tests/integration/studio-server/assets-http.test.ts tests/integration/studio-server/sillytavern-silent-import.test.ts`：5 文件、38 项通过。覆盖 60 个实体的投影/物化、旧格式、路径/缺失文件/重复项/条目超限、非法 UTF-8/JSON、磁盘编辑跨工作区往返、背景、宏、State 挂载、脚本源码、文本规则归属和 ST 生命周期。
- `pnpm --filter @loom-studio/studio-server build`：通过，包含 Application Runtime 项目引用的构建。
- `pnpm check:docs:links`：285 个 Markdown 文件链接检查通过；`git diff --check` 通过。
- 未运行全仓测试或浏览器验收；未进行社交平台上传保真测试。未用超大真实媒体包作内存压力测试。

实现事实已写入 [Architecture](../../architecture/application/card-bundle-files.md)。本轮没有提供 GUI 解包或 CLI 命令；作者可导出 `.loomcard`，用 ZIP 工具解压和重打包。后续 CLI / Dev Workspace 复用这些 Codec。

[官方内容计划](../../workbench/plans/official-content-installation-and-release-plan.md)的完整样例仍需继续制作；其 Rule / Extractor 打包阻塞已解除，远程部分仍延期，不视为该总计划已完成。
