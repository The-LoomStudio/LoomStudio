import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionsPanel } from '../../../apps/studio-client/src/widgets/sessions-panel/sessions-panel.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { AgentSession, AgentTranscriptEntry, NarrativeNode, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    const next = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = next
    hooks.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect() || undefined })
  },
}))
vi.mock('../../../apps/studio-client/src/shared/lib/card-media.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../apps/studio-client/src/shared/lib/card-media.js')>(),
  useCardMediaRevision: () => 0,
}))

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })
afterEach(() => vi.unstubAllGlobals())

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

const timestamp = '2026-09-23T00:00:00.000Z'
const timeline: NarrativeTimeline = {
  id: 'same-timeline', activeBranchId: 'branch', promptResourceIds: [], createdAt: timestamp, updatedAt: timestamp,
}
const session: AgentSession = {
  id: 'same-session', agentPresetId: 'profile', title: 'Preview session', entryCount: 1, createdAt: timestamp, updatedAt: timestamp,
}

function source(label: string) {
  const api = createStudioApi({ call: async method => { throw new Error(`Unexpected RPC: ${method}`) } })
  const nodes: NarrativeNode[] = [{
    id: label, timelineId: timeline.id, body: { format: 'loom-markdown.v1', raw: label }, createdAt: timestamp,
  }]
  const entries: AgentTranscriptEntry[] = [{
    id: label, agentSessionId: session.id, sequence: 1, createdAt: timestamp,
    entry: { kind: 'message', role: 'user', content: label },
  }]
  const page = { timeline, branch: { id: 'branch', timelineId: timeline.id, createdAt: timestamp, updatedAt: timestamp }, nodes }
  const transcript = { session, entries }
  const getPage = vi.fn(async () => page)
  const getTranscript = vi.fn(async () => transcript)
  api.narratives.getPage = getPage
  api.agentSessions.getTranscript = getTranscript
  return { api, nodes, entries, page, transcript, getPage, getTranscript }
}

function fixture(kind: 'timeline' | 'session') {
  const a = source('A')
  const b = source('B')
  const props: ComponentProps<typeof SessionsPanel> = {
    api: a.api, timelines: kind === 'timeline' ? [timeline] : [], allAgentSessions: [session],
    branches: [], agentPresets: [], t: createTranslator('en-US'), onOpenTimeline: vi.fn(),
  }
  function render() {
    hooks.cursor = 0
    const tree = elements(SessionsPanel(props))
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  if (kind === 'session') {
    const select = render().find(element => element.type === 'button'
      && elements(element.props.children).some(child => child.type === 'strong'
        && (Array.isArray(child.props.children) ? child.props.children.includes(session.title) : child.props.children === session.title)))
    if (!select) throw new Error('Missing Session selection button')
    const selectSession = select.props.onClick as () => void
    selectSession()
  }
  const preview = (tree = render()) => {
    const key = kind === 'timeline' ? 'nodes' : 'entries'
    const detail = tree.find(element => key in element.props)
    if (!detail) throw new Error('Missing preview detail')
    return detail.props[key]
  }
  return { a, b, props, render, preview }
}

function confirmDeletion(f: ReturnType<typeof fixture>) {
  const dialog = f.render().find(element => element.props.role === 'alertdialog' && element.props.open)
  if (!dialog) throw new Error('Missing deletion dialog')
  const button = elements(dialog.props.actions).find(element => element.props['data-tone'] === 'danger')
  if (!button) throw new Error('Missing confirmation action')
  ;(button.props.onClick as () => void)()
}

describe('Session panel preview source isolation', () => {
  it('keeps the creation choice on failure and opens the created Session only after success', async () => {
    const f = fixture('timeline')
    const created = { ...session, id: 'new-session' }
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce(created)
    const open = vi.fn()
    f.props.agentPresets = [{ id: 'profile', rootNode: { label: 'Writer' } } as typeof f.props.agentPresets[number]]
    f.props.onCreateAgentSession = create
    f.props.onOpenAgentSessionInSidebar = open
    const click = (label: string) => {
      const button = f.render().find(element => element.props['aria-label'] === label)
      if (!button) throw new Error(`Missing ${label}`)
      ;(button.props.onClick as () => void)()
    }
    click('新建 Agent 对话')
    const createDialog = () => f.render().find(element => element.props.title === '新建 Agent 对话'
      && 'actions' in element.props)!
    let dialog = createDialog()
    const controls = elements(dialog.props.children)
    ;(controls.find(element => element.type === 'select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'profile' } })
    ;(controls.find(element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } })
    dialog = createDialog()
    const submit = () => {
      const button = elements(dialog.props.actions).find(element => element.props.children === '创建对话')!
      ;(button.props.onClick as () => void)()
    }
    submit()
    await vi.waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith('profile', true))
    dialog = createDialog()
    expect(dialog.props.open).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(elements(dialog.props.children).some(element => element.props.role === 'alert'
      && element.props.children === 'create failed')).toBe(true)
    submit()
    await vi.waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(created))
    expect(createDialog().props.open).toBe(false)
  })

  it('uses the application dialog and does not delete a Timeline before confirmation', async () => {
    const f = fixture('timeline')
    const remove = vi.fn(async () => true)
    f.props.onDeleteTimeline = remove
    const detail = f.render().find(element => Array.isArray(element.props.nodes))!
    ;(detail.props.onDelete as () => void)()
    const dialog = f.render().find(element => element.props.role === 'alertdialog' && element.props.open)!
    expect(dialog.props.description).toContain('all its linked sessions')
    expect(remove).not.toHaveBeenCalled()
    ;(dialog.props.onClose as () => void)()
    expect(remove).not.toHaveBeenCalled()
    ;(detail.props.onDelete as () => void)()
    confirmDeletion(f)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith(timeline.id))
  })

  it('does not delete a bound Session twice when it and its Timeline are selected together', async () => {
    const f = fixture('timeline')
    const bound = { ...session, id: 'bound', timelineId: timeline.id }
    f.props.allAgentSessions = [bound, session]
    f.props.onDeleteTimeline = vi.fn(async () => true)
    f.props.onDeleteAgentSession = vi.fn(async () => true)
    const click = (element: Element | undefined) => {
      if (!element) throw new Error('Missing selection control')
      ;(element.props.onClick as (event: { stopPropagation(): void }) => void)({ stopPropagation() {} })
    }
    click(f.render().find(element => element.props['aria-label'] === f.props.t('sessions.batchManage')))
    click(f.render().find(element => element.props.role === 'button'
      && elements(element.props.children).some(child => child.props.children === f.props.t('sessions.selectAll'))))
    click(f.render().find(element => element.type === 'button'
      && elements(element.props.children).some(child => child.props.children === f.props.t('sessions.batchDelete', { count: 3 }))))
    confirmDeletion(f)
    await vi.waitFor(() => expect(f.props.onDeleteTimeline).toHaveBeenCalledExactlyOnceWith(timeline.id))
    expect(f.props.onDeleteAgentSession).toHaveBeenCalledExactlyOnceWith(session.id)
  })

  it('renders historical tools as a collapsible group without runtime telemetry', async () => {
    const f = fixture('session')
    const entries: AgentTranscriptEntry[] = [
      { id: 'state', agentSessionId: session.id, sequence: 1, createdAt: timestamp, entry: { kind: 'run-state', state: 'running' } },
      { id: 'user', agentSessionId: session.id, sequence: 2, createdAt: timestamp, entry: { kind: 'message', role: 'user', content: 'Hello' } },
      { id: 'call', agentSessionId: session.id, sequence: 3, createdAt: timestamp, entry: { kind: 'tool-invocation', invocationId: 'invoke-1', toolId: 'official/read', exposedName: 'read' } },
      { id: 'observation', agentSessionId: session.id, sequence: 4, createdAt: timestamp, entry: { kind: 'provider-observation', provider: 'test' } },
      { id: 'result', agentSessionId: session.id, sequence: 5, createdAt: timestamp, entry: { kind: 'tool-result', invocationId: 'invoke-1', status: 'completed', content: [{ type: 'text', text: 'Read complete' }] } },
    ]
    f.a.getTranscript.mockResolvedValue({ session, entries })
    f.render()
    await Promise.resolve()
    const detail = f.render().find(element => Array.isArray(element.props.entries))
    if (!detail) throw new Error('Missing Session detail')
    const content = elements((detail.type as (props: Record<string, unknown>) => Element)(detail.props))
    const group = content.find(element => Array.isArray(element.props.tools))
    expect(group?.props.tools).toMatchObject([{ label: '已read', detailContent: 'Read complete' }])
    expect(content.some(element => element.type === 'p' && element.props.children === 'Hello')).toBe(true)
    expect(content.some(element => element.key === 'state' || element.key === 'observation' || element.key === 'result')).toBe(false)
  })

  it('lists timeline-bound Agent sessions in the Sessions filter', () => {
    const f = fixture('timeline')
    f.props.allAgentSessions = [{ ...session, timelineId: timeline.id }]
    const tabs = f.render().find(element => element.props.ariaLabel === f.props.t('sessions.views')
      && Array.isArray(element.props.items))
    if (!tabs) throw new Error('Missing history filters')
    ;(tabs.props.onChange as (filter: string) => void)('sessions')
    const sessionButton = f.render().find(element => element.type === 'button'
      && elements(element.props.children).some(child => child.type === 'strong' && child.props.children === session.title))
    expect(sessionButton).toBeDefined()
  })

  it.each(['false', 'rejected'] as const)('retains only failed batch selections for retry (%s)', async failure => {
    const f = fixture('session')
    const failedSession = { ...session, id: 'failed-session', title: 'Failed session' }
    f.props.allAgentSessions = [session, failedSession]
    const remove = vi.fn(async (id: string) => {
      if (id === failedSession.id) {
        if (failure === 'rejected') throw new Error('Delete failed')
        return false
      }
      f.props.allAgentSessions = f.props.allAgentSessions.filter(item => item.id !== id)
      return true
    })
    f.props.onDeleteAgentSession = remove
    const click = (element: Element | undefined) => {
      if (!element) throw new Error('Missing batch control')
      const onClick = element.props.onClick as (event: { stopPropagation: () => void }) => void
      onClick({ stopPropagation() {} })
    }
    click(f.render().find(element => element.props['aria-label'] === f.props.t('sessions.batchManage')))
    click(f.render().find(element => element.props.role === 'button'
      && elements(element.props.children).some(child => child.props.children === f.props.t('sessions.selectAll'))))
    const deleteButton = (count: number) => f.render().find(element => element.type === 'button'
      && elements(element.props.children).some(child => child.props.children === f.props.t('sessions.batchDelete', { count })))
    click(deleteButton(2))
    confirmDeletion(f)
    await vi.waitFor(() => expect(deleteButton(1)).toBeDefined())
    expect(remove.mock.calls.map(([id]) => id)).toEqual([session.id, failedSession.id])
    expect(f.props.allAgentSessions).toEqual([failedSession])
    const failedRow = f.render().find(element => element.props['data-selected'] === 'true'
      && elements(element.props.children).some(child => child.type === 'strong' && child.props.children === failedSession.title))
    expect(failedRow).toBeDefined()
    remove.mockImplementation(async id => {
      f.props.allAgentSessions = f.props.allAgentSessions.filter(item => item.id !== id)
      return true
    })
    click(deleteButton(1))
    confirmDeletion(f)
    await vi.waitFor(() => expect(f.render().some(element => element.props['aria-label'] === f.props.t('sessions.batchManage'))).toBe(true))
    expect(remove.mock.calls.map(([id]) => id)).toEqual([session.id, failedSession.id, failedSession.id])
    expect(f.props.allAgentSessions).toEqual([])
  })

  it.each(['timeline', 'session'] as const)('does not reuse a cached %s preview for the same ID on another API', async kind => {
    const f = fixture(kind)
    f.render()
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.a.nodes : f.a.entries)
    f.props.api = f.b.api
    expect(f.preview(f.render())).toEqual([])
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.b.nodes : f.b.entries)
    expect(kind === 'timeline' ? f.b.getPage : f.b.getTranscript).toHaveBeenCalledOnce()
    f.render()
    expect(kind === 'timeline' ? f.b.getPage : f.b.getTranscript).toHaveBeenCalledOnce()
  })

  it.each(['timeline', 'session'] as const)('ignores an older %s response after the API changes', async kind => {
    const f = fixture(kind)
    const pending = Promise.withResolvers<void>()
    if (kind === 'timeline') f.a.getPage.mockImplementationOnce(async () => { await pending.promise; return f.a.page })
    else f.a.getTranscript.mockImplementationOnce(async () => { await pending.promise; return f.a.transcript })
    f.render()
    f.props.api = f.b.api
    f.render()
    await Promise.resolve()
    pending.resolve()
    await pending.promise
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.b.nodes : f.b.entries)
  })

  it.each(['timeline', 'session'] as const)('does not fall back to the previous API when the new %s preview fails', async kind => {
    const f = fixture(kind)
    f.render()
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.a.nodes : f.a.entries)
    if (kind === 'timeline') f.b.getPage.mockRejectedValueOnce(new Error('Unavailable'))
    else f.b.getTranscript.mockRejectedValueOnce(new Error('Unavailable'))
    f.props.api = f.b.api
    expect(f.preview(f.render())).toEqual([])
    await Promise.resolve()
    await Promise.resolve()
    expect(f.preview()).toEqual([])
    expect(kind === 'timeline' ? f.b.getPage : f.b.getTranscript).toHaveBeenCalledOnce()
  })
})
