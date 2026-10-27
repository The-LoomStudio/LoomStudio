import { AgentModelSelection } from '../../../apps/studio-client/src/features/provider-settings/ui/agent-model-selection.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { AgentModelEditor } from '../../../apps/studio-client/src/features/prompt-resources/ui/agent-model-editor.js'
import { AgentModelPicker } from '../../../apps/studio-client/src/features/provider-settings/ui/agent-model-picker.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
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
function fixture() {
  const props: ComponentProps<typeof AgentModelEditor> = {
    preset: { id: 'preset', version: 2, resourceKind: 'preset', rootNode: { id: 'root', kind: 'module', label: 'Agent' },
      model: { providerProfileId: 'provider', modelId: 'original' }, createdAt: '', updatedAt: '' },
    t: createTranslator('en-US'),
    renderModelPicker: input => AgentModelSelection({ ...input, modelProfiles: [], providerAccounts: [], t: props.t, onListModels: async () => [] }),
    onCreateModel: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockImplementation(async input => ({ ...props.preset, version: props.preset.version + 1, model: input.model, approvalPolicy: input.approvalPolicy })),
  }
  const render = () => { hooks.cursor = 0; return elements(AgentModelEditor(props)) }
  const picker = () => render().find(element => element.type === AgentModelPicker)!.props as ComponentProps<typeof AgentModelPicker>
  const open = () => {
    const trigger = render().find(element => element.type === 'button' && element.props['aria-haspopup'] === 'dialog')!
    ;(trigger.props.onClick as () => void)()
  }
  open()
  return { props, render, picker }
}

describe('Agent model slot', () => {
  it('closes an unchanged selection without submitting a no-op mutation', async () => {
    const f = fixture()
    await f.picker().onSelect({ ...f.props.preset.model! }, false)
    expect(f.props.onSave).not.toHaveBeenCalled()
    expect(f.picker()).toMatchObject({ open: false, current: f.props.preset.model })
  })

  it('saves approval scopes without changing the model binding', async () => {
    const f = fixture()
    const scope = f.render().find(element => element.type === 'select' && element.props['aria-label'] === 'Shared workspace writes')!
    expect(scope.props.value).toBe('ask')
    ;(scope.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'deny' } })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(f.props.onSave).toHaveBeenCalledWith({ agentPresetId: 'preset', expectedVersion: 2,
      model: f.props.preset.model, delivery: 'stream', approvalPolicy: { workspaceWrite: 'deny' } })
    const updated = f.render().find(element => element.type === 'select' && element.props['aria-label'] === 'Shared workspace writes')!
    expect(updated.props.value).toBe('deny')
  })

  it('keeps rejected bindings and retries a version conflict using the latest preset', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<never>()
    vi.mocked(f.props.onSave).mockReturnValueOnce(pending.promise)
    const selection = { providerProfileId: 'provider', modelId: 'new' }
    const saving = f.picker().onSelect(selection, false)
    expect(f.picker().pending).toBe(true)
    f.props.preset = { ...f.props.preset, version: 3 }
    pending.reject(new Error('Version conflict'))
    await saving
    expect(f.picker()).toMatchObject({ open: true, error: 'Version conflict', current: { modelId: 'original' } })
    await f.picker().onSelect(selection, false)
    expect(f.props.onSave).toHaveBeenLastCalledWith({ agentPresetId: 'preset', expectedVersion: 3, model: selection, delivery: 'stream' })
    expect(f.props.onCreateModel).not.toHaveBeenCalled()
    expect(f.picker()).toMatchObject({ open: false, current: selection })
  })

  it('waits for account enablement before binding and prevents duplicate submissions', async () => {
    const f = fixture()
    const enable = Promise.withResolvers<void>()
    vi.mocked(f.props.onCreateModel).mockReturnValueOnce(enable.promise)
    const selection = { providerProfileId: 'provider', modelId: 'new' }
    const saving = f.picker().onSelect(selection, true)
    await f.picker().onSelect(selection, true)
    expect(f.props.onCreateModel).toHaveBeenCalledExactlyOnceWith('provider', 'new')
    expect(f.props.onSave).not.toHaveBeenCalled()
    enable.resolve()
    await saving
    expect(f.props.onSave).toHaveBeenCalledOnce()
    expect(f.picker()).toMatchObject({ open: false, current: selection })
  })

  it('does not bind when adding a model fails', async () => {
    const f = fixture()
    vi.mocked(f.props.onCreateModel).mockRejectedValueOnce(new Error('Account offline'))
    await f.picker().onSelect({ providerProfileId: 'provider', modelId: 'new' }, true)
    expect(f.props.onSave).not.toHaveBeenCalled()
    expect(f.picker()).toMatchObject({ open: true, error: 'Account offline', current: { modelId: 'original' } })
  })

  it('reports partial success and retries only the binding after adding the model', async () => {
    const f = fixture()
    vi.mocked(f.props.onSave).mockRejectedValueOnce(new Error('Version conflict'))
    const selection = { providerProfileId: 'provider', modelId: 'new' }
    await f.picker().onSelect(selection, true)
    expect(f.picker().error).toContain(f.props.t('agent.model.addedButNotBound'))
    expect(f.picker().current?.modelId).toBe('original')
    await f.picker().onSelect(selection, false)
    expect(f.props.onCreateModel).toHaveBeenCalledOnce()
    expect(f.props.onSave).toHaveBeenCalledTimes(2)
    expect(f.picker()).toMatchObject({ open: false, current: selection })
  })
})

function pickerFixture() {
  const editor = fixture()
  const account = { id: 'provider', version: 1, providerExtensionId: 'openai', displayName: 'My OpenAI', config: {},
    enabledModelIds: ['saved'], credential: { configured: true }, createdAt: '', updatedAt: '' }
  const props: ComponentProps<typeof AgentModelPicker> = {
    ...editor.picker(), providerAccounts: [account, { ...account, id: 'other', displayName: 'Other account', enabledModelIds: [] }],
    modelProfiles: [{ id: 'saved', providerAccountId: 'provider', providerModelId: 'saved', displayName: 'saved', version: 1 }],
    onSelect: vi.fn().mockResolvedValue(undefined), onListModels: vi.fn().mockResolvedValue(['saved', 'fresh']),
  }
  const render = () => { hooks.cursor = 100; return elements(AgentModelPicker(props)) }
  const fetch = () => render().find(element => element.props.children instanceof Array
    && element.props.children.includes(props.t('agent.model.fetch')) && typeof element.props.onClick === 'function')!
  return { props, render, fetch }
}

describe('Agent model picker', () => {
  it('fetches without saving, merges saved IDs, and selects fetched models with enablement', async () => {
    const f = pickerFixture()
    ;(f.fetch().props.onClick as () => void)()
    await vi.waitFor(() => expect(f.render().some(element => element.type === 'button' && element.props.children
      && elements(element.props.children).some(child => child.props.children === 'fresh'))).toBe(true))
    expect(f.props.onSelect).not.toHaveBeenCalled()
    const rows = f.render().filter(element => element.type === 'button' && 'aria-pressed' in element.props)
    expect(rows).toHaveLength(2)
    ;(rows.find(element => elements(element.props.children).some(child => child.props.children === 'fresh'))!.props.onClick as () => void)()
    expect(f.props.onSelect).toHaveBeenCalledWith({ providerProfileId: 'provider', modelId: 'fresh' }, true)
  })

  it('searches account names and model IDs, and allows a manual ID for each account', () => {
    const f = pickerFixture()
    const search = () => f.render().find(element => element.props.clearLabel === f.props.t('agent.clearSearch'))!
    ;(search().props.onChange as (event: unknown) => void)({ target: { value: '  MY OPENAI  ' } })
    expect(f.render().filter(element => element.type === 'button' && 'aria-pressed' in element.props)).toHaveLength(1)
    ;(search().props.onChange as (event: unknown) => void)({ target: { value: '  custom/model  ' } })
    expect(f.render().filter(element => element.type === 'button' && 'aria-pressed' in element.props)).toHaveLength(0)
    const manual = f.render().filter(element => element.props.children === f.props.t('agent.model.manual', { id: 'custom/model' }))
    expect(manual).toHaveLength(2)
    ;(manual[1].props.onClick as () => void)()
    expect(f.props.onSelect).toHaveBeenCalledWith({ providerProfileId: 'other', modelId: 'custom/model' }, true)
  })

  it('keeps saved models when catalog loading fails and supports retry', async () => {
    const f = pickerFixture()
    vi.mocked(f.props.onListModels).mockRejectedValueOnce(new Error('Catalog offline'))
    ;(f.fetch().props.onClick as () => void)()
    await vi.waitFor(() => expect(f.render().some(element => element.props.role === 'alert' && element.props.children === 'Catalog offline')).toBe(true))
    expect(f.render().filter(element => element.type === 'button' && 'aria-pressed' in element.props)).toHaveLength(1)
    ;(f.fetch().props.onClick as () => void)()
    await vi.waitFor(() => expect(f.render().some(element => element.props.role === 'alert')).toBe(false))
    expect(f.props.onListModels).toHaveBeenCalledTimes(2)
    expect(f.props.onSelect).not.toHaveBeenCalled()
  })
})
