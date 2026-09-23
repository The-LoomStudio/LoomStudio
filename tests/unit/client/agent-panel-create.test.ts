import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { AgentPanel } from '../../../apps/studio-client/src/widgets/agent-panel/agent-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
}))

beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

describe('Agent creation form', () => {
  it('shows an unavailable selection without editing another profile', () => {
    const t = createTranslator('en-US')
    const props = {
      selectedAgentProfileId: 'missing-profile',
      agentProfiles: [{ id: 'other-profile', name: 'Other', presetId: 'preset', model: {}, toolOverrides: {} }],
      presets: [], tools: [], toolMounts: [], modelProfiles: [], providerAccounts: [],
      busy: false, t, onCreate: vi.fn(), onDelete: vi.fn(), onSelect: vi.fn(), onUpdate: vi.fn(),
    } as unknown as ComponentProps<typeof AgentPanel>
    const tree = elements(AgentPanel(props))
    expect(tree.find(element => element.props.role === 'alert')?.props.children)
      .toBe(t('agent.profile.unavailable', { id: 'missing-profile' }))
    expect(tree.some(element => element.type === 'input' && element.props.defaultValue === 'Other')).toBe(false)
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure', 'rejection'] as const)('waits for %s and retains failed drafts', async outcome => {
    let resolve!: (success: boolean) => void
    let reject!: (error: Error) => void
    const onCreate = vi.fn(() => new Promise<boolean>((accept, fail) => { resolve = accept; reject = fail }))
    const t = createTranslator('en-US')
    const props = {
      presets: [{ id: 'preset', rootNode: { id: 'root', label: 'Preset' } }],
      agentProfiles: [], tools: [], toolMounts: [], busy: false,
      modelProfiles: [{ id: 'model-profile', providerAccountId: 'provider', providerModelId: 'model' }],
      providerAccounts: [], t, onCreate, onDelete: vi.fn(), onSelect: vi.fn(), onUpdate: vi.fn(),
    } as ComponentProps<typeof AgentPanel>
    const render = () => {
      hooks.cursor = 0
      return elements(AgentPanel(props))
    }
    const invoke = (element: Element, handler: string, event?: unknown) =>
      (element.props[handler] as (event?: unknown) => unknown)(event)
    let tree = render()
    invoke(tree.find(element => element.type === 'button' && elements(element.props.children).length > 0
      && Array.isArray(element.props.children) && element.props.children.includes(t('agent.profile.new')) )!, 'onClick')
    tree = render()
    invoke(tree.find(element => element.type === 'input' && element.props.autoFocus)!, 'onChange', { target: { value: 'Keep this draft' } })
    invoke(tree.find(element => element.type === 'select' && element.props.value === '')!, 'onChange', { target: { value: 'model-profile' } })
    tree = render()
    const form = tree.find(element => element.type === 'form')!
    const pending = invoke(form, 'onSubmit', { preventDefault() {} })
    await invoke(form, 'onSubmit', { preventDefault() {} })
    expect(onCreate).toHaveBeenCalledTimes(1)
    tree = render()
    expect(tree.find(element => element.type === 'input' && element.props.autoFocus)?.props).toMatchObject({
      value: 'Keep this draft', disabled: true,
    })
    expect(tree.find(element => element.props.type === 'submit')?.props.disabled).toBe(true)
    if (outcome === 'rejection') reject(new Error('Network failed'))
    else resolve(outcome === 'success')
    await pending
    tree = render()
    if (outcome === 'success') {
      expect(tree.some(element => element.type === 'form')).toBe(false)
    } else {
      expect(tree.find(element => element.type === 'input' && element.props.autoFocus)?.props).toMatchObject({
        value: 'Keep this draft', disabled: false,
      })
      expect(tree.find(element => element.type === 'select' && element.props.value === 'model-profile')).toBeDefined()
      if (outcome === 'rejection') expect(tree.find(element => element.props.role === 'alert')?.props.children).toBe('Network failed')
    }
  })
})
