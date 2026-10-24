# The World 空值初始化

2026-10-21：用户确认初始化是建立 null 字段结构，不要求作者预填事实。首次用户输入后由 AI 按已知叙事填值；变量定义的统一 AI 可见性另议。

实施范围：固定 world 挂载 world、worldTime、calendar、weather，未知字段为 null，不填系统时间或晴天。不创建虚构地点/场景；currentSceneId 初值为 null。现有世界工具可按 revision 更新这些字段，维护 Lore 明确首次输入后的填写规则。无用户输入不自动调用模型。已有 Timeline 不因重载自动改写。

必要平台配合只限 State Schema 标准 type 数组（如 number/null）校验；不新增初始化钩子、权限、UI 或变量系统投影。非空数据保持原有引用、日期范围与并发校验。

验证：真实 State Runtime 新 Timeline 初值、首次工具写入与回滚；未知值表现；非法非空日期/天气；Schema nullable 类型合同。

状态：已实施，待用户新故事验收。

结果：初值集中在扩展 worldInitialComponents，createWorldRoot 与 State Contribution 共用。现有时间/天气投影过滤尚未知值；不把 null 当 0 或晴天。The World 维护 Lore 明确首次输入后按事实填写、保留未知、使用最小 patch。旧数据与升级路径不自动补值。

验证：Runtime 包构建、The World typecheck / 客户端构建、扩展测试 typecheck 均通过。State Schema 定向测试 7 项通过；The World 合同、真实 State Service、Client、实际 Server 工具桥与资源采用测试 26 项通过，包含首轮填值、部分填值、零点、回滚与旧检查点升级。

交付边界：扩展仍位于主仓库忽略的 extensions/the-world/ 本地目录，客户端产物已重建；未推送独立扩展仓库或更新用户现有安装/已导入 Lore。需同步更新宿主（nullable Schema 支持）、扩展和维护 Lore；新建故事生效，不静默覆盖旧故事。

