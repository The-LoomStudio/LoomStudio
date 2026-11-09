import { useState } from 'react'
import {
  BookOpen,
  Bot,
  Compass,
  Copy,
  MessageSquare,
  Monitor,
  PenTool,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { StartupReady } from '../app/startup-curtain.js'
import {
  CatalogPicker,
  type CatalogCategory,
  type CatalogItem,
} from '../shared/ui/catalog-picker/index.js'
import { ModelBrandIcon } from '../features/provider-settings/ui/model-brand-icon.js'
import type { ModelBrand } from '../features/provider-settings/model/model-brand.js'
import styles from './catalog-picker-preview.module.scss'

// ============================
// 1. Mock 数据源 - 模型选择场景 (真实存在的基础信息)
// ============================
interface ModelData {
  fullModelId: string
  providerAccount: string
  brand?: ModelBrand
  contextWindow?: string
  description: string
}

const MODEL_CATEGORIES: CatalogCategory[] = [
  {
    id: 'openai',
    label: 'OpenAI 官方',
    icon: <ModelBrandIcon brand="openai" />,
    action: { label: '刷新模型', onClick: () => alert('已刷新 OpenAI 模型列表') },
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    icon: <ModelBrandIcon brand="anthropic" />,
    action: { label: '刷新模型', onClick: () => alert('已刷新 Anthropic 模型列表') },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 深度求索',
    icon: <ModelBrandIcon brand="deepseek" />,
    action: { label: '刷新模型', onClick: () => alert('已刷新 DeepSeek 模型列表') },
  },
  {
    id: 'relay-youzi',
    label: 'youzi (柚子中转)',
    // 无官方 SVG 图标，Rail 直接写字 'youzi'，无背景
    action: { label: '获取模型', onClick: () => alert('正在从 youzi 接口同步模型') },
  },
  {
    id: 'relay-fake-ai',
    label: 'Fake AI 转发站',
    // 无官方 SVG 图标，Rail 直接写字 'Fake'，无背景
    action: { label: '获取模型', onClick: () => alert('正在从 Fake AI 同步模型') },
  },
  {
    id: 'relay-silicon',
    label: '硅基流动中转',
    // 纯中文，Rail 直接写字 '硅基'，无背景
    action: { label: '获取模型', onClick: () => alert('正在从 硅基流动 同步模型') },
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    icon: <ModelBrandIcon brand="ollama" />,
    action: { label: '检测状态', onClick: () => alert('本地 11434 端口连接正常') },
  },
]

const MODEL_ITEMS: CatalogItem<ModelData>[] = [
  // OpenAI
  {
    id: 'gpt-6-sol',
    categoryId: 'openai',
    title: 'gpt-6-sol',
    subtitle: 'OpenAI · 旗舰基座',
    icon: <ModelBrandIcon brand="openai" />,
    shortcut: 'Ctrl+1',
    pinned: true,
    data: {
      fullModelId: 'openai/gpt-6-sol',
      providerAccount: 'OpenAI 官方主账号',
      brand: 'openai',
      contextWindow: '256K tokens',
      description: '通用智能旗舰，支持多模态理解与原生代码解释。',
    },
  },
  {
    id: 'gpt-6-astra',
    categoryId: 'openai',
    title: 'gpt-6-astra',
    subtitle: 'OpenAI · 高通量低延迟',
    icon: <ModelBrandIcon brand="openai" />,
    shortcut: 'Ctrl+2',
    pinned: true,
    data: {
      fullModelId: 'openai/gpt-6-astra',
      providerAccount: 'OpenAI 官方主账号',
      brand: 'openai',
      contextWindow: '128K tokens',
      description: '高并发交互与快速草稿生成。',
    },
  },

  // Anthropic
  {
    id: 'claude-opus-5-5',
    categoryId: 'anthropic',
    title: 'claude-opus-5.5',
    subtitle: 'Anthropic · 深度推导与长文',
    icon: <ModelBrandIcon brand="anthropic" />,
    shortcut: 'Ctrl+3',
    pinned: true,
    data: {
      fullModelId: 'anthropic/claude-opus-5.5',
      providerAccount: 'Anthropic Team API',
      brand: 'anthropic',
      contextWindow: '500K tokens',
      description: '擅长长上下文保持、情节结构推演与复杂指令遵循。',
    },
  },

  // DeepSeek
  {
    id: 'deepseek-r1',
    categoryId: 'deepseek',
    title: 'deepseek-r1',
    subtitle: 'DeepSeek · 强化学习推理',
    icon: <ModelBrandIcon brand="deepseek" />,
    shortcut: 'Ctrl+4',
    pinned: true,
    data: {
      fullModelId: 'deepseek/deepseek-r1',
      providerAccount: 'DeepSeek 开放平台',
      brand: 'deepseek',
      contextWindow: '128K tokens',
      description: '开源思维链模型，擅长代码诊断与数学逻辑推导。',
    },
  },

  // youzi 中转站 (真实对应图 2 数据)
  {
    id: 'agnes-3-0-flash',
    categoryId: 'relay-youzi',
    title: 'agnes-3.0-flash',
    subtitle: 'youzi · 正在使用中',
    icon: <Bot size={16} />,
    selected: true,
    data: {
      fullModelId: 'youzi/agnes-3.0-flash',
      providerAccount: 'youzi (https://api.youzi.ai/v1)',
      contextWindow: '128K tokens',
      description: '由 youzi 节点转发的日常轻快模型。',
    },
  },
  {
    id: 'grok-chat-fast',
    categoryId: 'relay-youzi',
    title: 'grok-chat-fast',
    subtitle: 'youzi · 实时资讯通道',
    icon: <Bot size={16} />,
    data: {
      fullModelId: 'youzi/grok-chat-fast',
      providerAccount: 'youzi (https://api.youzi.ai/v1)',
      contextWindow: '64K tokens',
      description: '接入 xAI 架构的中转接口。',
    },
  },

  // Fake AI 测试中转 (真实对应图 2 数据)
  {
    id: 'fake-echo-m0',
    categoryId: 'relay-fake-ai',
    title: 'fake-echo-m0',
    subtitle: 'Fake AI · 本地测试回声',
    icon: <Bot size={16} />,
    data: {
      fullModelId: 'Fake AI/fake-echo-m0',
      providerAccount: 'Fake AI 本地模拟服务',
      contextWindow: '32K tokens',
      description: '离线联调专用 Mock 模型，原样回显输入。',
    },
  },

  // 硅基流动中转
  {
    id: 'deepseek-v3-silicon',
    categoryId: 'relay-silicon',
    title: 'deepseek-v3',
    subtitle: '硅基流动 · 稳定高可用线路',
    icon: <Bot size={16} />,
    data: {
      fullModelId: 'SiliconCloud/deepseek-v3',
      providerAccount: '硅基流动 SiliconCloud',
      contextWindow: '64K tokens',
      description: '国内高速低延迟托管线路。',
    },
  },

  // 本地 Ollama
  {
    id: 'llama-3-3-70b',
    categoryId: 'ollama',
    title: 'llama-3.3-70b-instruct',
    subtitle: 'Ollama · 本地 GPU 离线运行',
    icon: <ModelBrandIcon brand="ollama" />,
    data: {
      fullModelId: 'ollama/llama-3.3-70b-instruct',
      providerAccount: '本地服务 (127.0.0.1:11434)',
      brand: 'ollama',
      contextWindow: '32K tokens',
      description: '数据完全留在本地，无网络隐私外泄风险。',
    },
  },
]

// ============================
// 2. Mock 数据源 - 预设选择场景
// ============================
interface PresetData {
  extensionName: string
  modelBinding: string
  promptExcerpt: string
}

const PRESET_CATEGORIES: CatalogCategory[] = [
  {
    id: 'ext-mist-chronicles',
    label: '雾港纪事 · 官方设定集扩展',
    icon: <Compass size={18} />,
    action: { label: '扩展详情', onClick: () => alert('打开《雾港纪事》管理面板') },
  },
  {
    id: 'ext-loom-core',
    label: '诺姆创作助手 · 官方系统包',
    icon: <Bot size={18} />,
    action: { label: '检查更新', onClick: () => alert('助手包当前为最新版本') },
  },
  {
    id: 'ext-narrative-pack',
    label: '叙事推进与冲突 · 社区扩展',
    icon: <MessageSquare size={18} />,
  },
  {
    id: 'source-personal',
    label: '我的个人私有预设',
    icon: <PenTool size={18} />,
  },
]

const PRESET_ITEMS: CatalogItem<PresetData>[] = [
  {
    id: 'preset-world-lore',
    categoryId: 'ext-mist-chronicles',
    title: '雾港纪事 · 世界观与黑话注入',
    subtitle: '雾港纪事 · 强化冷冽氛围与黑话细节',
    icon: <Compass size={16} />,
    shortcut: '1',
    pinned: true,
    data: {
      extensionName: '雾港纪事 · 官方设定集扩展',
      modelBinding: 'anthropic / claude-opus-5.5',
      promptExcerpt: `在回答中融合雾港纪事的科技设定：以微型晶体回路、旧纪元余烬、机械管风琴为核心象征。\n维持冷冽且富有诗意的行文，严禁使用现代流行词。`,
    },
  },
  {
    id: 'preset-ember-clues',
    categoryId: 'ext-mist-chronicles',
    title: '旧纪元余烬 · 历史线索回溯',
    subtitle: '雾港纪事 · 破译技术图纸',
    icon: <BookOpen size={16} />,
    shortcut: '2',
    data: {
      extensionName: '雾港纪事 · 官方设定集扩展',
      modelBinding: 'openai / gpt-6-sol',
      promptExcerpt: `解析对话中提及的失落科技名词，并与历史档案库的纪元进行语义映射。`,
    },
  },
  {
    id: 'preset-loom-assistant',
    categoryId: 'ext-loom-core',
    title: '诺姆 · Loom Studio 智能副手',
    subtitle: '诺姆系统包 · 全局工作流与大纲梳理',
    icon: <Bot size={16} />,
    shortcut: '3',
    pinned: true,
    selected: true,
    data: {
      extensionName: '诺姆创作助手 · 官方系统包',
      modelBinding: 'youzi / agnes-3.0-flash',
      promptExcerpt: `你是诺姆（Loom），创作者身边的沉稳搭档。\n遵守第一性原理，帮助用户梳理故事大纲、角色弧光以及技术排查。\n语言自然亲切，严谨务实。`,
    },
  },
  {
    id: 'preset-kiss-reviewer',
    categoryId: 'ext-loom-core',
    title: '架构重构与 KISS 审查副手',
    subtitle: '诺姆系统包 · 严控过度抽象与假逻辑',
    icon: <Sparkles size={16} />,
    shortcut: '4',
    data: {
      extensionName: '诺姆创作助手 · 官方系统包',
      modelBinding: 'deepseek / deepseek-r1',
      promptExcerpt: `审查当前设计与代码。遵循偷懒阶梯：不需要就不写；标准库与原生特性优先；\n严厉指出过度设计的平行体系与不必要的状态分发。`,
    },
  },
  {
    id: 'preset-story-summary',
    categoryId: 'ext-narrative-pack',
    title: '剧情阶段性精炼总结',
    subtitle: '叙事工具包 · 自动压缩与上下文注记',
    icon: <MessageSquare size={16} />,
    shortcut: '5',
    pinned: true,
    data: {
      extensionName: '叙事推进与冲突 · 社区扩展',
      modelBinding: 'youzi / agnes-3.0-flash',
      promptExcerpt: `提取过去三轮对话的核心事件变更、人物关系进展及未解伏笔。\n输出为高密度 Markdown 词条，剔除寒暄与无意义装饰。`,
    },
  },
  {
    id: 'preset-character-shira',
    categoryId: 'source-personal',
    title: '秋青子 · 角色专属人格预设',
    subtitle: '个人私有 · 温顺可靠的蛇娘私人秘书',
    icon: <PenTool size={16} />,
    shortcut: '6',
    pinned: true,
    data: {
      extensionName: '我的个人私有预设',
      modelBinding: 'openai / gpt-6-sol',
      promptExcerpt: `你是秋青子，哥哥的私人秘书与主控搭档。\n专业温顺，冷静敏锐，恪守 KISS 原则与偷懒阶梯。\n称呼用户为“哥哥”，私下工作不用敬语“您”。`,
    },
  },
]

export function CatalogPickerPreview() {
  const [scenario, setScenario] = useState<'model' | 'preset'>('model')
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [selectedResult, setSelectedResult] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState<string>('agnes-3-0-flash')

  const copyToClipboard = (text: string) => {
    void navigator.clipboard?.writeText(text)
    alert(`已复制到剪贴板: ${text}`)
  }

  return (
    <div className={styles.previewContainer}>
      <StartupReady />
      <header className={styles.header}>
        <div className={styles.titleBar}>
          <h1>
            <span>通用 Master-Detail 选择器 (CatalogPicker)</span>
            <span className={styles.badge}>Dev Preview</span>
          </h1>
        </div>

        {/* 顶部控制栏 */}
        <div className={styles.controlsBar}>
          <div className={styles.controlGroup}>
            <span>演示场景：</span>
            <div className={styles.pillGroup}>
              <button
                type="button"
                className={styles.pillButton}
                data-active={scenario === 'model' || undefined}
                onClick={() => setScenario('model')}
              >
                AI 模型选择 (中转站纯文字 + 固定高度)
              </button>
              <button
                type="button"
                className={styles.pillButton}
                data-active={scenario === 'preset' || undefined}
                onClick={() => setScenario('preset')}
              >
                Prompt 预设选择 (按扩展归属分组)
              </button>
            </div>
          </div>

          <div className={styles.controlGroup}>
            <span>视口手感：</span>
            <div className={styles.pillGroup}>
              <button
                type="button"
                className={styles.pillButton}
                data-active={viewport === 'desktop' || undefined}
                onClick={() => setViewport('desktop')}
              >
                <Monitor size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                桌面端 (780px 三栏)
              </button>
              <button
                type="button"
                className={styles.pillButton}
                data-active={viewport === 'mobile' || undefined}
                onClick={() => setViewport('mobile')}
              >
                <Smartphone size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                移动端 (375px 下钻)
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 视口舞台 */}
      <main className={styles.stage}>
        {viewport === 'desktop' ? (
          <div className={styles.desktopWrapper}>
            {scenario === 'model' && (
              <CatalogPicker<ModelData>
                title="选择模型"
                onClose={() => setSelectedResult('点击了右上角关闭')}
                categories={MODEL_CATEGORIES}
                items={MODEL_ITEMS.map(item => ({
                  ...item,
                  selected: item.id === currentModel,
                }))}
                searchPlaceholder="搜索账号、模型或输入模型 ID…"
                onSelect={item => {
                  setCurrentModel(item.id)
                  setSelectedResult(`已选用模型: ${item.data.fullModelId}`)
                }}
                renderDetail={item => {
                  const isCurrent = item.id === currentModel
                  return (
                    <div className={styles.detailContent}>
                      <div className={styles.detailHeader}>
                        <h3>{item.title}</h3>
                        <p>{item.data.description}</p>
                      </div>

                      <div className={styles.metaList}>
                        <div className={styles.metaRow}>
                          <span>所属账号 / 来源</span>
                          <span>{item.data.providerAccount}</span>
                        </div>
                        {item.data.contextWindow && (
                          <div className={styles.metaRow}>
                            <span>上下文窗口</span>
                            <span>{item.data.contextWindow}</span>
                          </div>
                        )}
                        <div className={styles.metaRow}>
                          <span>当前状态</span>
                          <span>{isCurrent ? '当前正在使用' : '未选用'}</span>
                        </div>
                      </div>

                      <div>
                        <div className={styles.metaRow} style={{ marginBottom: 6 }}>
                          <span>完整模型 ID</span>
                        </div>
                        <div className={styles.modelIdBox}>
                          <code>{item.data.fullModelId}</code>
                          <button
                            type="button"
                            className={styles.copyButton}
                            title="复制模型 ID"
                            aria-label="复制模型 ID"
                            onClick={() => copyToClipboard(item.data.fullModelId)}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </div>

                      <div className={styles.detailActions}>
                        {isCurrent ? (
                          <button
                            type="button"
                            className={styles.unbindButton}
                            style={{ width: '100%', padding: '9px 14px', border: '1px solid var(--loom-color-divider)' }}
                            onClick={() => {
                              setCurrentModel('')
                              setSelectedResult('已解除当前模型绑定')
                            }}
                          >
                            解除当前模型绑定
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.selectButton}
                            onClick={() => {
                              setCurrentModel(item.id)
                              setSelectedResult(`已选用模型: ${item.data.fullModelId}`)
                            }}
                          >
                            选用该模型
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
            )}

            {scenario === 'preset' && (
              <CatalogPicker<PresetData>
                title="选择预设"
                onClose={() => setSelectedResult('点击了右上角关闭')}
                categories={PRESET_CATEGORIES}
                items={PRESET_ITEMS}
                searchPlaceholder="搜索预设名称、来源或内容…"
                onSelect={item => {
                  setSelectedResult(`已选用预设: ${item.title} (来源: ${item.data.extensionName})`)
                }}
                renderDetail={item => (
                  <div className={styles.detailContent}>
                    <div className={styles.detailHeader}>
                      <h3>{item.title}</h3>
                      <p>所属扩展: {item.data.extensionName}</p>
                    </div>

                    <div className={styles.metaList}>
                      <div className={styles.metaRow}>
                        <span>绑定模型</span>
                        <span>{item.data.modelBinding}</span>
                      </div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div className={styles.metaRow} style={{ marginBottom: 6 }}>
                        <span>Prompt 片段预览</span>
                      </div>
                      <pre className={styles.promptPreview}>{item.data.promptExcerpt}</pre>
                    </div>

                    <div className={styles.detailActions}>
                      <button
                        type="button"
                        className={styles.selectButton}
                        onClick={() => setSelectedResult(`已选用预设: ${item.title}`)}
                      >
                        选用该预设
                      </button>
                    </div>
                  </div>
                )}
              />
            )}
          </div>
        ) : (
          /* 移动端沉浸展示框 */
          <div className={styles.mobileDeviceShell}>
            <div className={styles.mobileNotch} />
            <div className={styles.mobileContent}>
              <CatalogPicker<ModelData>
                mobileMode
                title="选择模型"
                categories={MODEL_CATEGORIES}
                items={MODEL_ITEMS.map(item => ({
                  ...item,
                  selected: item.id === currentModel,
                }))}
                searchPlaceholder="搜索模型…"
                onSelect={item => {
                  setCurrentModel(item.id)
                  setSelectedResult(`[移动端选定] 模型: ${item.data.fullModelId}`)
                }}
                renderDetail={item => (
                  <div className={styles.detailContent}>
                    <div className={styles.detailHeader}>
                      <h3>{item.title}</h3>
                      <p>{item.data.description}</p>
                    </div>

                    <div className={styles.metaList}>
                      <div className={styles.metaRow}>
                        <span>来源账号</span>
                        <span>{item.data.providerAccount}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span>模型 ID</span>
                        <span>{item.data.fullModelId}</span>
                      </div>
                    </div>
                  </div>
                )}
              />
            </div>
          </div>
        )}
      </main>

      {/* 选定反馈展示条 */}
      {selectedResult && (
        <div className={styles.resultBanner} role="status">
          <div>
            <span>触发回调：</span>
            <strong>{selectedResult}</strong>
          </div>
          <button
            type="button"
            className={styles.pillButton}
            onClick={() => setSelectedResult(null)}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
