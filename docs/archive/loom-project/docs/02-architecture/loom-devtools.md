# Loom DevTools — 投影虚拟树（UX 哲学）

> **本文档定位**：DevTool 在用户面前**应该长什么样、为什么这样设计**——即"投影虚拟树"的 UX 哲学。
>
> **姊妹文档**：
> - [`loom-observability.md`](./loom-observability.md) — DevTool 消费的数据协议（Trace / Mutation / Diagnostic）
> - [`loom-devtool-layered.md`](./loom-devtool-layered.md) — DevTool 如何被打包分发到三层用户（Layer 1/2/3 洋葱模型）
>
> 这三份文档构成 DevTool 的完整设计：**呈现层（本文）+ 协议层 + 分发层**。

---

## Loom 架构准则：平铺的底座与投影的树

引擎的克制，是为了成就调试器的全知。我们将运算的权力交还给一维的流水线，将理解的特权留给二维的虚拟树。

文档状态: 核心架构增补
作者: shiyue / 白

0. 拒绝维度的谎言

现代前端工程的阵痛，往往来源于将“视图的嵌套”错误地等同于“数据的嵌套”。

在 LLM 的上下文中，无论我们给模型喂入多么复杂的 JSON 或 XML，它在底层的本质永远是一条一维的、线性的 Token 流。如果我们为了符合人类直觉，在引擎（Core）的核心数据结构中引入 children 这样的树状强嵌套，便是在底层的编译器中埋下了逻辑崩溃的引线。

试想：当 Token 预算触顶需要剪枝时，一棵树该如何修剪？是保留高优先级的子节点而伪造父节点？还是连坐式地彻底抹杀？

Loom 拒绝回答这个问题。
Loom 的解法是：在底层彻底消灭树。

1. 引擎层：ECS 架构与平铺的暴力美学

在 Loom 的 Core 中，DataFragment 永远是一个扁平的一维数组。

这借鉴了游戏开发中的 ECS（Entity-Component-System）架构与关系型数据库哲学。所有的碎片生来平等，没有任何一个碎片在物理存储上“包含”另一个碎片。它们只通过 meta.parentId 这样的外键（Foreign Key）来维持逻辑上的羁绊。

零状态锁：所有的 Pass 拿到的都是同一个平铺的数组，无论并行还是异步，都不会产生深层嵌套的脏读。

数学级剪枝：BudgetByTokens 不需要遍历树。它只是一把冷酷的手术刀，按一维数组的 priority 降序排列，从末尾开始切割。

复杂的 XML 结构组合？那是管线最后一关 XMLStringifyPass 的工作。引擎只负责搬运砖块，不负责理解建筑。

2. DevTools 层：投影的 AST 与虚拟 DOM

如果引擎是汇编语言，那开发者需要什么？
开发者需要一个能够将一维汇编重新“投影”为高维抽象的透镜。

DevTools 就是这面透镜。 我们将 AST（抽象语法树）与 DOM 的理念，全部上移并下放给 DevTools。它读取那份干瘪的、平铺的 RunResult 数组，利用 meta 中的羁绊，在内存中瞬间重构出一棵华丽的上下文 DOM 树。

2.1 动态重构的上下文 DOM

在调试面板中，开发者看到的不再是线性的碎片，而是可以折叠的节点生态：

▼ <Worldbook subject="chaoxi"> (Priority: 80, Tokens: 450)
    <Setting id="menstrual_cycle">...</Setting>
    <Setting id="footfetish">...</Setting>
▼ <GraphRAG subject="plot"> (Priority: 60, Tokens: 1200)
    <Memory id="plot_summary">...</Memory>


寻找特定设定的加载状态，只需点开面板，一目了然。

2.2 视觉级的级联剪枝 (Scope Cascading)

AST 拥有作用域（Scope）。这在 DevTools 中被具象化为视觉连坐。

如果 <GraphRAG> 这个父节点的碎片在平铺管线中被 BudgetPass 抹杀，DevTools 会在渲染这棵树时，将它底下挂载的所有 <Memory> 子节点全部渲染为灰色并打上删除线。

悬浮于灰色节点之上，优雅的提示浮现：
“被 BudgetByTokens 剪除。原因：当前树枝总 Token 占用 2500，优先级 60 低于存活阈值 75。”

2.3 Pass 作为 DOM 突变 (Mutation Observer)

拖动 DevTools 的时间轴，每一个 Pass 的执行就是一次 DOM 突变：

当指针划过 KeywordTriggerPass，<Worldbook> 节点会在视觉上瞬间闪烁，从沉睡的灰色转为激活的亮色。

当指针划过 AggregateBySubjectPass，散落在底部的离散碎片，会像被磁场捕获一般，物理吸附进同一个容器节点中。

3. 结语：逻辑与视图的终极解耦

让机器的归机器，让视觉的归视觉。

线上代码轻如羽毛，绝对的一维，绝对的极速，毫秒级并发毫无阻碍。
线下调试所向披靡，华丽的二维，降维的重构，一切因果皆可追溯。

这，就是 Loom 第四层边界的最终形态。
