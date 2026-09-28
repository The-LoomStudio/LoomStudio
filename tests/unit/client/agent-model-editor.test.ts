import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { AgentModelEditor } from '../../../apps/studio-client/src/widgets/agent-panel/agent-model-editor.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

describe('Agent model slot', () => {
  it('retains unavailable binding and the edited version after a save conflict', async () => {
    const props: ComponentProps<typeof AgentModelEditor> = {
      preset: { id: 'preset', version: 2, resourceKind: 'preset',
        rootNode: { id: 'root', kind: 'module', label: 'Agent' },
        model: { providerProfileId: 'missing', modelId: 'missing-model' }, createdAt: '', updatedAt: '' },
      modelProfiles: [{ id: 'model', version: 1, displayName: 'Model', providerAccountId: 'provider', providerModelId: 'model' }],
      providerAccounts: [], t: createTranslator('en-US'),
      onSave: vi.fn().mockRejectedValue(new Error('Version conflict')),
    }
    const render = () => { hooks.cursor = 0; return elements(AgentModelEditor(props)) }
    let tree = render()
    expect(tree.filter(element => element.type === 'select')).toHaveLength(1)
    expect(tree.find(element => element.type === 'select')?.props.value).toBe('__unavailable__')
    expect(tree.find(element => element.type === 'option' && element.props.value === '__unavailable__')?.props.disabled).toBe(true)
    ;(tree.find(element => element.type === 'select')!.props.onChange as (event: unknown) => void)({ target: { value: 'model' } })
    props.preset = { ...props.preset, version: 3 }
    tree = render()
    await (tree.find(element => element.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} })
    expect(props.onSave).toHaveBeenCalledWith({
      agentPresetId: 'preset', expectedVersion: 2,
      model: { providerProfileId: 'provider', modelId: 'model' }, delivery: 'stream',
    })
    tree = render()
    expect(tree.find(element => element.type === 'select')?.props.value).toBe('model')
    expect(tree.find(element => element.props.role === 'alert')?.props.children).toBe('Version conflict')
    expect(props.onSave).toHaveBeenCalledTimes(1)
  })
})
