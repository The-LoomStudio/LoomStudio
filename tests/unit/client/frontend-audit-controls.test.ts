import { isValidElement, type FunctionComponent, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRestorableScroll } from '../../../apps/studio-client/src/shared/hooks/use-restorable-scroll.js'
import { useStudioShortcuts } from '../../../apps/studio-client/src/pages/studio/use-studio-shortcuts.js'
import { ProviderAccountList } from '../../../apps/studio-client/src/widgets/model-panel/provider-account-list.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { AgentMutationApprovalDialog } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-mutation-approval-dialog.js'
import { NarrativeTimelineNavigator } from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline-navigator.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
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
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as unknown[] | undefined
    if (!previous || !deps.every((value, i) => Object.is(value, previous[i]))) {
      hooks.values[index] = deps
      hooks.effects.push(effect)
    }
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as unknown[] | undefined
    if (!previous || !deps.every((value, i) => Object.is(value, previous[i]))) {
      hooks.values[index] = deps
      hooks.effects.push(effect)
    }
  },
}))

type Element = ReactElement<Record<string, any>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, any>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}
function render<T>(fn: () => T) {
  hooks.cursor = 0
  const result = fn()
  for (const effect of hooks.effects.splice(0)) effect()
  return result
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })
afterEach(() => vi.unstubAllGlobals())

describe('frontend audit controls', () => {
  it('measures and observes the navigator after an initially empty timeline receives content', () => {
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect() {} })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '9px' }))
    const props = { items: [] as Array<{ id: string; meta: string; preview: string; role: string }>, label: 'Timeline', onNavigate: vi.fn() }
    expect(render(() => NarrativeTimelineNavigator(props))).toBeNull()
    expect(observe).not.toHaveBeenCalled()
    props.items = Array.from({ length: 80 }, (_, i) => ({ id: String(i), meta: '', preview: '', role: 'user' }))
    hooks.cursor = 0
    const tree = NarrativeTimelineNavigator(props)!
    const element = { clientHeight: 300 }
    ;(tree.props.ref as { current: unknown }).current = element
    for (const effect of hooks.effects.splice(0)) effect()
    expect(observe).toHaveBeenCalledExactlyOnceWith(element)
    const measured = render(() => NarrativeTimelineNavigator(props))
    expect(elements(measured).some(item => item.props.style?.height === '234px')).toBe(true)
  })

  it('keeps failed approval reasons, blocks duplicate submissions, and configures a non-dismissible dialog', async () => {
    const pending = Promise.withResolvers<boolean>()
    const onApprove = vi.fn(() => pending.promise)
    const props: Parameters<typeof AgentMutationApprovalDialog>[0] = {
      approval: { requestId: 'request', preview: { action: 'replace', path: '/test', kind: 'state', before: '1', after: '2' } },
      onApprove, t: createTranslator('en-US'),
    }
    const dialog = () => render(() => AgentMutationApprovalDialog(props))
    const controls = () => elements(dialog())
    expect(dialog().props.dismissible).toBe(false)
    dialog().props.onClose()
    expect(onApprove).not.toHaveBeenCalled()
    controls().find(element => element.type === 'input')!.props.onChange({ target: { value: 'Keep my reason' } })
    const deny = controls().find(element => element.props.children === 'Deny')!
    deny.props.onClick()
    deny.props.onClick()
    expect(onApprove).toHaveBeenCalledExactlyOnceWith(false, 'Keep my reason')
    expect(controls().find(element => element.type === 'input')!.props.disabled).toBe(true)
    pending.reject(new Error('Approval failed'))
    await vi.waitFor(() => expect(controls().find(element => element.props.role === 'alert')?.props.children).toBe('Approval failed'))
    expect(controls().find(element => element.type === 'input')!.props.value).toBe('Keep my reason')
    onApprove.mockResolvedValueOnce(true)
    controls().find(element => element.props.children === 'Deny')!.props.onClick()
    await vi.waitFor(() => expect(controls().find(element => element.type === 'input')!.props.value).toBe(''))
  })
  it('restores scroll on a late mount and again after returning to the list', () => {
    const scroll = render(() => useRestorableScroll<HTMLDivElement>('late-mount-test'))
    expect(scroll.ref.current).toBeNull()
    const first = { scrollLeft: 5, scrollTop: 140, scrollTo: vi.fn() } as unknown as HTMLDivElement
    const detach = scroll.attach(first)
    expect(scroll.ref.current).toBe(first)
    detach?.()
    const next = { scrollLeft: 0, scrollTop: 0, scrollTo: vi.fn() } as unknown as HTMLDivElement
    const detachNext = scroll.attach(next)
    expect(next.scrollTo).toHaveBeenCalledWith({ left: 5, top: 140 })
    detachNext?.()
    expect(scroll.ref.current).toBeNull()
  })

  it('does not turn unavailable redo into undo', () => {
    const addEventListener = vi.fn()
    vi.stubGlobal('window', { addEventListener, removeEventListener: vi.fn() })
    vi.stubGlobal('document', { querySelector: () => null })
    vi.stubGlobal('HTMLElement', class {})
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(() => useStudioShortcuts({
      mobileDrawerOpen: false, closeMobileDrawer: vi.fn(),
      activePanel: null, assetMetadataOpen: false, busy: false, canRedo: false, canUndo: true,
      dockOpen: false, isImmersive: false, onRedo, onUndo, closeDock: vi.fn(), closePanel: vi.fn(),
      setAssetMetadataOpen: vi.fn(), togglePanelWindowMode: vi.fn(),
    }))
    const keydown = addEventListener.mock.calls[0]![1]
    const event = { key: 'z', metaKey: true, ctrlKey: false, shiftKey: true, target: null, preventDefault: vi.fn() }
    keydown(event)
    expect(onUndo).not.toHaveBeenCalled()
    expect(onRedo).not.toHaveBeenCalled()
    keydown({ ...event, shiftKey: false })
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'] as const)('ignores old model catalog %s after saving the connection', async outcome => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const pending = Promise.withResolvers<string[]>()
    const onListModels = vi.fn(() => pending.promise)
    const props: Parameters<typeof ProviderAccountList>[0] = {
      accounts: [{
        id: 'account', version: 1, displayName: 'Provider', providerExtensionId: 'official.openai-compatible',
        config: { baseUrl: 'https://old.test' }, enabledModelIds: [], credential: { configured: true },
        createdAt: '', updatedAt: '',
      }],
      modelProfiles: [], busy: false, onListModels,
      onUpdateConnection: vi.fn(async () => true),
      onCreateModel: vi.fn(), onDelete: vi.fn(), onDeleteModel: vi.fn(), t: createTranslator('en-US'),
    }
    const item = elements(ProviderAccountList(props)).find(element => typeof element.type === 'function'
      && element.type.name === 'ProviderAccountItem')!
    hooks.values = []; hooks.effects = []
    const view = () => elements(render(() => (item.type as FunctionComponent<Record<string, unknown>>)(item.props)))
    const first = view()
    const picker = first.find(element => element.props.onFocus)!
    picker.props.onFocus()
    expect(onListModels).toHaveBeenCalledTimes(1)
    const forms = view().filter(element => element.type === 'form')
    await forms[0]!.props.onSubmit({ preventDefault() {} })
    if (outcome === 'resolve') pending.resolve(['stale-model'])
    else pending.reject(new Error('Old connection failed'))
    await Promise.resolve()
    await Promise.resolve()
    const next = view()
    expect(JSON.stringify(next.map(element => element.props.children))).not.toContain('stale-model')
    next.find(element => element.props.onFocus)!.props.onFocus()
    expect(onListModels).toHaveBeenCalledTimes(2)
  })
})
