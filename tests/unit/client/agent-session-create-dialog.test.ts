import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionCreateDialog } from '../../../apps/studio-client/src/features/sessions/ui/agent-session-create-dialog.js'
import type { AgentPreset } from '../../../apps/studio-client/src/entities/index.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value }]
  },
}))

type Element = ReactElement<Record<string, any>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as Element
  return [element, ...elements(element.props.children), ...elements(element.props.actions)]
}

function fixture() {
  const onCreate = vi.fn(async () => ({ id: 'session' })) as unknown as
    Parameters<typeof AgentSessionCreateDialog>[0]['onCreate'] & ReturnType<typeof vi.fn>
  const props = {
    t: createTranslator('zh-CN'),
    presets: [
      { id: 'preset-a', rootNode: { label: 'Writing' } },
      { id: 'preset-b', rootNode: { label: 'Summary' }, origin: { kind: 'extension-package', packageId: 'memory' } },
    ] as AgentPreset[], initialPresetId: 'preset-a',
    onCreate, onCreated: vi.fn(), onClose: vi.fn(),
  }
  const render = () => {
    hooks.cursor = 0
    return elements(AgentSessionCreateDialog(props))
  }
  const create = async () => {
    await render().find(element => element.props['aria-label'] === '创建对话')!.props.onClick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return { props, render, create }
}

beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

describe('Agent session creation dialog', () => {
  it('creates the chosen preset Session without implicitly making it primary', async () => {
    const f = fixture()
    f.render().find(element => element.props['aria-label'] === '选择预设：Summary')!.props.onClick()
    await f.create()
    expect(f.props.onCreate).toHaveBeenCalledExactlyOnceWith('preset-b')
    expect(f.props.onCreated).toHaveBeenCalledWith({ id: 'session' })
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it('keeps the chosen preset after failure and opens only the successful retry', async () => {
    const f = fixture()
    f.render().find(element => element.props['aria-label'] === '选择预设：Summary')!.props.onClick()
    f.props.onCreate.mockRejectedValueOnce(new Error('Preset is unavailable'))
    await f.create()
    expect(f.props.onClose).not.toHaveBeenCalled()
    expect(f.props.onCreated).not.toHaveBeenCalled()
    expect(f.render().find(element => element.props.role === 'alert')!.props.children).toBe('Preset is unavailable')
    await f.create()
    expect(f.props.onCreate.mock.calls).toEqual([['preset-b'], ['preset-b']])
    expect(f.props.onCreated).toHaveBeenCalledExactlyOnceWith({ id: 'session' })
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it('filters by source without losing the selected preset or creating a session', () => {
    const f = fixture()
    f.render().find(element => element.props['aria-label'] === '搜索 Agent 预设')!.props.onChange({ target: { value: 'memory' } })
    const tree = f.render()
    expect(tree.filter(element => String(element.props['aria-label']).startsWith('选择预设：'))
      .map(element => element.props['aria-label'])).toEqual(['选择预设：Summary'])
    expect(tree.find(element => element.props['aria-label'] === '创建对话')!.props.disabled).toBe(false)
    expect(f.props.onCreate).not.toHaveBeenCalled()
  })
})
