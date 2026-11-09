// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentPresetPicker } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-preset-picker.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { AgentPreset, ProviderAccount } from '../../../apps/studio-client/src/entities/index.js'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const MOCK_PRESETS: AgentPreset[] = [
  {
    id: 'preset-1',
    version: 1,
    resourceKind: 'preset',
    rootNodeId: 'root-1',
    label: '我的故事助手',
    metadata: {},
    createdAt: '',
    updatedAt: '',
    origin: { kind: 'personal' },
    model: { providerProfileId: 'youzi', modelId: 'agnes-3.0-flash' },
    rootNode: {
      id: 'root-1',
      label: '我的故事助手',
      orderIndex: 0,
      kind: 'module',
      createdAt: '',
      updatedAt: '',
      body: '你是一位温柔敏锐的写作助理。',
    },
  },
  {
    id: 'preset-2',
    version: 1,
    resourceKind: 'preset',
    rootNodeId: 'root-2',
    label: '代码排错大师',
    metadata: {},
    createdAt: '',
    updatedAt: '',
    origin: { kind: 'builtin' },
    model: { providerProfileId: 'openai', modelId: 'gpt-6-sol' },
    rootNode: {
      id: 'root-2',
      label: '代码排错大师',
      orderIndex: 0,
      kind: 'module',
      createdAt: '',
      updatedAt: '',
      body: '专注于定位并发死锁与状态机异常。',
    },
  },
]

const MOCK_PROVIDERS: ProviderAccount[] = [
  {
    id: 'youzi',
    version: 1,
    providerExtensionId: 'official.openai-compatible',
    displayName: 'youzi',
    config: {},
    enabledModelIds: ['agnes-3.0-flash'],
    credential: { configured: true },
    createdAt: '',
    updatedAt: '',
  },
]

it('renders trigger button and opens compact 2-column preset popover on click', async () => {
  const onSelect = vi.fn()
  const onSaveModel = vi.fn()
  const t = createTranslator('zh-CN')

  await act(async () => {
    root.render(
      createElement(AgentPresetPicker, {
        disabled: false,
        profiles: MOCK_PRESETS,
        providers: MOCK_PROVIDERS,
        selectedId: 'preset-1',
        t,
        onSelect,
        onSaveModel,
      }),
    )
  })

  // 验证 Composer 触发按钮渲染
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
  expect(trigger).toBeTruthy()
  expect(trigger?.textContent).toContain('我的故事助手')

  // 点击触发按钮打开 Popover
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    trigger!.click()
  })

  // 验证 Popover 标题与紧凑两栏结构
  expect(document.body.textContent).toContain('选择预设')
  expect(document.body.querySelector('[data-loom-component="catalog-preset-popover"]')).toBeTruthy()

  // 验证列表项渲染（包含预设名称和模型标识）
  const options = document.body.querySelectorAll<HTMLElement>('[role="option"]')
  expect(options.length).toBe(2)
  expect(options[0].textContent).toContain('我的故事助手')
  expect(options[0].textContent).toContain('youzi · agnes-3.0-flash')
  expect(options[1].textContent).toContain('代码排错大师')

  // 点击第二个预设项触发选用
  await act(async () => {
    options[1].click()
  })
  expect(onSelect).toHaveBeenCalledWith('preset-2')
})
