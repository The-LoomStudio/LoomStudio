# Provider and Model Brand Icons Plan

> **状态**：Partial / Frontend Spike Complete
> **日期**：2026-08-05
> **边界**：本文规划 Provider Account 与 Model Profile 的品牌图标。当前不安装依赖、不修改 Schema，也不把启发式识别结果当作模型事实。

## 上游调研

Lobe Icons 官方提供：

- `@lobehub/icons`：React SVG 组件，支持具名导入、Mono、Color、Text、Combine 和部分 Avatar 变体；
- `@lobehub/icons-static-svg`：无运行时依赖的静态 SVG 资产；
- 两者均采用 MIT License；
- React 包声明 `sideEffects: false`，理论上支持 Tree Shaking；
- 当前 React 包同时声明 `@lobehub/ui`、`antd` 等 peer dependency，接入前必须确认只使用基础 SVG 组件时不会把不需要的 UI 栈带入 Studio Client。

官方 React 用法示例：

```tsx
import { Gemini, OpenAI } from '@lobehub/icons'

<OpenAI size={16} />
<Gemini.Color size={16} />
```

不是每个品牌都提供 `Color`，因此 UI 不能假设所有图标都有同一种变体。

## UI 决策

Provider Account 使用提供商品牌图标，Model Profile 优先使用模型家族图标。两者都必须保留通用 fallback，不能因识别失败出现空白或破图。

首批内建提供商只覆盖当前产品真正支持或即将支持的常见入口，不把图标库目录等同于 Provider 支持列表。候选首批：

- OpenAI / OpenAI-compatible；
- Anthropic；
- Google Gemini；
- OpenRouter；
- DeepSeek；
- Ollama。

图标只是表现层元数据，不代表 Provider Adapter 已实现。

## 模型图标解析

采用小型、有序的关键字匹配，不维护完整模型数据库：

```text
显式用户选择
  > 已知模型家族关键字
  > Provider 默认图标
  > 通用模型图标
```

候选关键字示例：

- `gpt-*`、`o1*`、`o3*`、`o4*` -> OpenAI；
- `claude-*` -> Claude；
- `gemini-*`、`gemma-*` -> Gemini / Gemma；
- `deepseek-*` -> DeepSeek；
- `grok-*` -> Grok；
- `llama-*` -> Meta / Llama；
- `qwen-*` -> Qwen；
- `mistral-*`、`mixtral-*` -> Mistral。

匹配只影响图标，不改变 Provider、能力或路由。字符串比较使用规范化的小写模型 ID，并按更具体的前缀优先。

用户手动选择后保存稳定的 `iconKey`，不要保存 React 组件名或第三方资源 URL。首期若后端 Schema 尚未提供该字段，只做前端预览，不借用其他配置字段偷存。

## 依赖策略

实施前做一个最小构建 Spike：

1. 仅安装并具名导入 5 至 8 个 `@lobehub/icons` 基础 SVG 组件；
2. 检查 pnpm peer dependency、TypeScript、Vite 产物和 gzip 增量；
3. 若必须引入 `antd` 或 `@lobehub/ui`，停止使用 React 包，改用官方 `@lobehub/icons-static-svg` 的有限资产；
4. 不通过 CDN 运行时加载品牌图标，避免离线、CSP、隐私和版本漂移问题。

## 2026-08-05 Spike 结果

直接安装 `@lobehub/icons@5.15.0` 会引入 `@lobehub/ui`、`antd` 等大量无关依赖，并产生 React peer dependency 警告，因此已放弃 React 包。

当前前端改用无运行时依赖的 `@lobehub/icons-static-svg@1.94.0`，只静态导入界面实际使用的品牌 SVG。已实现 Provider 提示、模型 ID 关键字识别、Provider fallback 和通用 fallback。用户自定义 `iconKey` 仍等待正式数据合同，不在现有配置中偷存。

## 验收条件

1. 已知 Provider 和模型家族能得到稳定图标；
2. 未知模型始终显示通用 fallback，并允许用户选择；
3. 三点菜单、状态灯和文本不会因图标加载改变位置；
4. 图标具备可访问名称或被正确标记为装饰；
5. 未实现的 Provider 不会因为存在图标而显示为可用；
6. 接入不会引入整套无关 UI 框架。
