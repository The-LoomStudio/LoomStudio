import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { AiCapabilityLab } from '../../../apps/studio-client/src/widgets/model-panel/ai-capability-lab.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as Array<() => void | (() => void)> }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (setup: () => void | (() => void)) => { hooks.effects.push(setup) },
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (current: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current }
    return hooks.values[index]
  },
}))

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('AI capability form submission', () => {
  it.each([
    ['account', false], ['account', true], ['profile', false], ['profile', true],
  ] as const)('publishes %s creation selection only while mounted (unmounted: %s)', async (kind, unmounted) => {
    const pending = Promise.withResolvers<string>()
    const onCreated = vi.fn()
    const capability = { id: 'chat', displayName: 'Chat' }
    const provider = { id: 'test', displayName: 'Test', capabilities: [capability], registeredBy: { kind: 'platform' as const } }
    hooks.values = ['test', 'chat', 'account', 'profile']
    const tree = elements(AiCapabilityLab({
      providers: [provider], providerAccounts: [], profiles: [],
      onCreateProviderAccount: () => pending.promise, onCreateProfile: () => pending.promise,
      onUpdateProviderAccount: async () => {}, onUpdateProfile: async () => {},
      onInvoke: async () => { throw new Error('Not invoked') },
      onRefresh: async () => {}, t: key => key,
    }))
    const child = tree.find(element => typeof element.type === 'function' && 'onCreated' in element.props
      && (kind === 'account' ? 'provider' in element.props : 'capability' in element.props))!
    hooks.cursor = 0
    hooks.values = []
    hooks.effects = []
    const formTree = elements((child.type as (props: Record<string, unknown>) => Element)({ ...child.props, onCreated }))
    const cleanups = hooks.effects.map(setup => setup())
    const submit = formTree.find(element => element.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>
    const request = submit({ preventDefault() {} })
    if (unmounted) cleanups.forEach(cleanup => cleanup?.())
    pending.resolve('committed-id')
    await request
    if (unmounted) expect(onCreated).not.toHaveBeenCalled()
    else expect(onCreated).toHaveBeenCalledWith('committed-id')
  })

  it.each(['account', 'profile', 'invoke'] as const)('deduplicates %s submission and unlocks retained drafts after failure', async kind => {
    const pending = Promise.withResolvers<never>()
    const action = vi.fn(() => pending.promise)
    const capability = { id: 'chat', displayName: 'Chat' }
    const provider = { id: 'test', displayName: 'Test', capabilities: [capability], registeredBy: { kind: 'platform' as const } }
    const props: ComponentProps<typeof AiCapabilityLab> = {
      providers: [provider],
      providerAccounts: [{
        id: 'account', version: 1, providerExtensionId: 'test', displayName: 'Account',
        config: {}, enabledModelIds: [], credential: { configured: false }, createdAt: '', updatedAt: '',
      }],
      profiles: [{
        id: 'profile', version: 1, providerProfileId: 'account', providerExtensionId: 'test',
        capabilityId: 'chat', displayName: 'Profile', config: {}, available: true, createdAt: '', updatedAt: '',
      }],
      onCreateProviderAccount: action, onCreateProfile: action, onInvoke: action,
      onUpdateProviderAccount: action, onUpdateProfile: action, onRefresh: async () => {},
      t: key => key,
    }
    // Select the account/profile so the real parent exposes each private form.
    hooks.values = ['test', 'chat', 'account', 'profile']
    const parent = elements(AiCapabilityLab(props))
    const child = parent.find(element => typeof element.type === 'function' && (
      kind === 'account' ? element.props.provider === provider && !element.props.account
        : kind === 'profile' ? element.props.capability === capability && 'onCreate' in element.props && !element.props.profile
          : 'onInvoke' in element.props
    ))!
    hooks.values = []
    const render = () => {
      hooks.cursor = 0
      return elements((child.type as (props: Record<string, unknown>) => Element)(child.props))
    }
    let tree = render()
    const editor = tree.find(element => 'raw' in element.props)!
    const changeDraft = editor.props.onRawChange as (value: string) => void
    changeDraft('{"draft":"keep"}')
    tree = render()
    const form = tree.find(element => element.type === 'form')!
    const submit = form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>
    const first = submit({ preventDefault() {} })
    const duplicate = submit({ preventDefault() {} })
    const inFlight = render().find(element => element.type === 'form')!
    pending.reject(new Error('Request failed'))
    await Promise.all([first, duplicate])
    expect(action).toHaveBeenCalledTimes(1)
    expect(inFlight.props.inert).toBe(true)
    tree = render()
    expect(tree.find(element => element.type === 'form')?.props.inert).toBe(false)
    expect(tree.find(element => 'raw' in element.props)?.props.raw).toBe('{"draft":"keep"}')
    expect(tree.some(element => element.type === 'p' && element.props.children === 'Request failed')).toBe(true)
    await (tree.find(element => element.type === 'form')!.props.onSubmit as typeof submit)({ preventDefault() {} })
    expect(action).toHaveBeenCalledTimes(2)
  })
})
