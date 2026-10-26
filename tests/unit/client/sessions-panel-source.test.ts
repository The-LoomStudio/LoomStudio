import { createStudioTrpcClient } from '../../../apps/studio-client/src/shared/api/trpc-client.js'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionsPanel } from '../../../apps/studio-client/src/widgets/sessions-panel/sessions-panel.js'
import { AgentSessionCreateDialog } from '../../../apps/studio-client/src/features/sessions/ui/agent-session-create-dialog.js'
import { createStudioApi, type StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { AgentSession, AgentTranscriptEntry, NarrativeNode, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (compute: () => unknown) => compute(),
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

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).join('')
  return isValidElement<Record<string, unknown>>(value) ? text(value.props.children) : ''
}

const timestamp = '2026-09-23T00:00:00.000Z'
const timeline: NarrativeTimeline = {
  id: 'same-timeline', activeBranchId: 'branch', promptResourceIds: [], createdAt: timestamp, updatedAt: timestamp,
}
const session: AgentSession = { kind: 'agent' as const,
  id: 'same-session', agentPresetId: 'profile', title: 'Preview session', entryCount: 1, createdAt: timestamp, updatedAt: timestamp,
}

function source(label: string) {
  const api = createStudioApi(createStudioTrpcClient({ fetch: async () => { throw new Error('Unexpected RPC in rendering test') } }))
  const nodes: Awaited<ReturnType<StudioApi['narratives']['getPage']>>['nodes'] = [{
    id: label, kind: 'narrative', floor: 1, timelineId: timeline.id, stateRevisionId: 'state', workspaceRevisionId: 'workspace', body: { format: 'loom-markdown.v1', raw: label }, createdAt: timestamp,
  }]
  const entries: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>['entries'] = [{
    id: label, agentSessionId: session.id, sequence: 1, createdAt: timestamp,
    entry: { kind: 'message', role: 'user', content: label },
  }]
  const page = { timeline, branch: { id: 'branch', timelineId: timeline.id, stateHeadRevisionId: 'state', workspaceHeadRevisionId: 'workspace', createdAt: timestamp, updatedAt: timestamp }, nodes }
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
    api: a.api, activeTimeline: timeline, timelines: kind === 'timeline' ? [timeline] : [], allAgentSessions: [session],
    branches: [], agentPresets: [], t: createTranslator('en-US'), onOpenTimeline: vi.fn(),
  }
  function render() {
    hooks.cursor = 0
    const tree = elements(SessionsPanel(props))
    for (const effect of hooks.effects.splice(0)) effect()
    return tree
  }
  const allButton = render().find(element => text(element.props.children) === '显示全部' && typeof element.props.onClick === 'function')!
  ;(allButton.props.onClick as () => void)()
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
  it.each(['timelines', 'sessions'] as const)('marks current use and the primary writer in the %s tab', view => {
    const t = createTranslator('en-US')
    const viewed = { ...session, id: 'viewed', title: 'VIEWED_SESSION', timelineId: timeline.id }
    const writer = { ...session, id: 'writer', title: 'WRITER_SESSION', timelineId: timeline.id }
    const props: ComponentProps<typeof SessionsPanel> = {
      view, activeTimeline: { ...timeline, title: 'CURRENT_STORY', createdFrom: { cardId: 'current-card', cardVersion: 1 } }, agentChatSession: viewed, narrativeAgentSession: writer,
      timelines: [{ ...timeline, title: 'CURRENT_STORY', createdFrom: { cardId: 'current-card', cardVersion: 1 } }], allAgentSessions: [viewed, writer],
      agentPresets: [], branches: [], t, onOpenTimeline: vi.fn(),
    }
    function render() {
      hooks.cursor = 0
      const tree = elements(SessionsPanel(props))
      for (const effect of hooks.effects.splice(0)) effect()
      return tree
    }
    render()
    if (view === 'timelines') {
      const expand = render().find(element => element.props['aria-label'] === t('sessions.expandRelated'))!
      if (!expand.props['aria-expanded']) {
        ;(expand.props.onClick as (event: unknown) => void)({ stopPropagation: vi.fn() })
      }
    }
    const rows = render().filter(element => element.type === 'div' && 'data-active' in element.props)
    const viewedRow = rows.find(element => text(element.props.children).includes('VIEWED_SESSION'))!
    const writerRow = rows.find(element => text(element.props.children).includes('WRITER_SESSION'))!
    expect(viewedRow.props['aria-current']).toBe('true')
    expect(writerRow.props['aria-current']).toBeUndefined()
    expect(elements(viewedRow.props.children).some(element => element.props['aria-label'] === t('agent.primarySession'))).toBe(false)
    expect(elements(writerRow.props.children).find(element => element.props.fill === 'currentColor')?.props['aria-label']).toBe(t('agent.primarySession'))
    if (view === 'timelines') {
      expect(rows.find(element => text(element.props.children).includes('CURRENT_STORY'))?.props['aria-current']).toBe('true')
    }
  })

  it.each(['timelines', 'sessions'] as const)('shows only the current character in %s until all history is explicitly requested', view => {
    const props: ComponentProps<typeof SessionsPanel> = {
      view, selectedCardId: 'current-card', branches: [], agentPresets: [],
      allAgentSessions: [
        { ...session, id: 'current-session', title: 'CURRENT_SESSION', timelineId: 'current-timeline' },
        { ...session, id: 'other-session', title: 'OTHER_SESSION', timelineId: 'other-timeline' },
        { ...session, id: 'standalone-session', title: 'STANDALONE_SESSION', timelineId: undefined },
      ],
      t: createTranslator('en-US'), onOpenTimeline: vi.fn(),
      timelines: [
        { ...timeline, id: 'current-timeline', title: 'CURRENT_STORY', createdFrom: { cardId: 'current-card', cardVersion: 1 } },
        { ...timeline, id: 'other-timeline', title: 'OTHER_STORY', createdFrom: { cardId: 'other-card', cardVersion: 1 } },
      ],
    }
    const render = () => {
      hooks.cursor = 0
      const result = elements(SessionsPanel(props))
      for (const effect of hooks.effects.splice(0)) effect()
      return result
    }
    const current = render()
    const currentTitle = view === 'timelines' ? 'CURRENT_STORY' : 'CURRENT_SESSION'
    const otherTitle = view === 'timelines' ? 'OTHER_STORY' : 'OTHER_SESSION'
    const currentText = current.map(element => text(element.props.children)).join(' ')
    expect(currentText).toContain(currentTitle)
    expect(currentText).not.toContain(otherTitle)
    expect(currentText).not.toContain('STANDALONE_SESSION')
    const toggle = current.find(element => text(element.props.children) === '显示全部' && typeof element.props.onClick === 'function')!
    ;(toggle.props.onClick as () => void)()
    const allText = render().map(element => text(element.props.children)).join(' ')
    expect(allText).toContain(otherTitle)
    if (view === 'sessions') expect(allText).toContain('STANDALONE_SESSION')
  })

  it.each(['archive', 'chat'] as const)('retains a committed %s and retries only its post-import completion', async kind => {
    const f = fixture('timeline')
    const finish = vi.fn().mockRejectedValueOnce(new Error('Catalog offline')).mockResolvedValue(undefined)
    f.props.onArchiveImported = finish
    const imported = { timelineId: 'imported', unknownParticipantNamespaces: ['missing-extension'], participantFailures: [] }
    const importArchive = vi.spyOn(f.a.api.narratives, 'importArchive').mockResolvedValue(imported as never)
    const importHistory = vi.spyOn(f.a.api.narratives, 'importHistory').mockResolvedValue({ timeline: { id: 'imported' } } as never)
    vi.spyOn(f.a.api.extensionRuntime, 'call').mockResolvedValue({ title: 'Imported', messages: [{ content: 'Hello' }] })
    const detail = f.render().find(element => 'nodes' in element.props)!
    for (let i = 0; i < 4; i++) await Promise.resolve()
    hooks.values = []; hooks.effects = []
    const renderDetail = () => {
      hooks.cursor = 0
      return elements((detail.type as (props: Record<string, unknown>) => unknown)({
        ...detail.props, card: { id: 'card', name: 'Character' },
      }))
    }
    const input = renderDetail().find(element => element.type === 'input'
      && element.props.accept === (kind === 'archive' ? 'application/json,.json' : '.jsonl,application/x-ndjson'))!
    ;(input.props.onChange as (event: unknown) => void)({ target: { files: [new File(['{}'], 'archive.json')], value: 'archive.json' } })
    await vi.waitFor(() => expect(renderDetail().find(element => element.props.role === 'alert')?.props.children)
      .toBe('Import completed, but refresh or navigation failed: Catalog offline'))
    const notice = renderDetail().find(element => element.props.role === 'status' && text(element.props.children).includes('imported'))!
    expect(text(notice.props.children)).toContain(kind === 'archive' ? 'missing-extension' : 'Imported 1 ST messages')
    const retry = renderDetail().find(element => text(element.props.children) === 'Refresh and open the imported Timeline')!
    ;(retry.props.onClick as () => void)()
    await vi.waitFor(() => expect(finish).toHaveBeenCalledTimes(2))
    expect(finish.mock.calls[1]?.[0]).toBe('imported')
    expect(importArchive).toHaveBeenCalledTimes(kind === 'archive' ? 1 : 0)
    expect(importHistory).toHaveBeenCalledTimes(kind === 'chat' ? 1 : 0)
  })

  it.each(['timeline', 'session'] as const)('refreshes the same %s after its content revision changes', async kind => {
    const f = fixture(kind)
    f.render()
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.a.nodes : f.a.entries)
    if (kind === 'timeline') {
      f.props.timelines = [{ ...timeline, activeBranchId: 'other-branch', updatedAt: 'later' }]
      f.a.getPage.mockResolvedValueOnce(f.b.page)
    } else {
      f.props.allAgentSessions = [{ ...session, entryCount: 2, updatedAt: 'later' }]
      f.a.getTranscript.mockResolvedValueOnce(f.b.transcript)
    }
    expect(f.preview(f.render())).toEqual([])
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.b.nodes : f.b.entries)
    if (kind === 'timeline') expect(f.a.getPage).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'other-branch' }))
  })

  it.each(['timeline', 'session'] as const)('exposes %s preview errors and retries only on request', async kind => {
    const f = fixture(kind)
    if (kind === 'timeline') f.a.getPage.mockRejectedValueOnce(new Error('Preview unavailable'))
    else f.a.getTranscript.mockRejectedValueOnce(new Error('Preview unavailable'))
    const detail = () => f.render().find(element => 'onRetryPreview' in element.props)!
    expect(detail().props.previewLoading).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(detail().props.previewError).toBe('Preview unavailable')
    detail()
    expect(kind === 'timeline' ? f.a.getPage : f.a.getTranscript).toHaveBeenCalledOnce()
    ;(detail().props.onRetryPreview as () => void)()
    detail()
    await Promise.resolve()
    expect(f.preview()).toEqual(kind === 'timeline' ? f.a.nodes : f.a.entries)
    expect(detail().props.previewError).toBeUndefined()
  })

  it('delegates creation to the shared dialog and opens its created Session', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const f = fixture('timeline')
    const created = { ...session, id: 'new-session' }
    const create = vi.fn(async () => created)
    const open = vi.fn()
    f.props.agentPresets = [{ id: 'profile', rootNode: { label: 'Writer' } } as typeof f.props.agentPresets[number]]
    f.props.onCreateAgentSession = create
    f.props.onOpenAgentSessionInSidebar = open
    const click = (label: string) => {
      const button = f.render().find(element => element.props['aria-label'] === label)
      if (!button) throw new Error(`Missing ${label}`)
      ;(button.props.onClick as () => void)()
    }
    click(f.props.t('agent.createSession'))
    const createDialog = () => f.render().find(element => element.type === AgentSessionCreateDialog)
    const dialog = createDialog()!
    expect(dialog.props.presets).toBe(f.props.agentPresets)
    expect(dialog.props.onCreate).toBe(create)
    expect(create).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    ;(dialog.props.onCreated as (session: AgentSession) => void)(created)
    expect(open).toHaveBeenCalledExactlyOnceWith(created)
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'loom:open-agent-chat', detail: { sessionId: created.id },
    }))
    ;(dialog.props.onClose as () => void)()
    expect(createDialog()).toBeUndefined()
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
    const entries: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>['entries'] = [
      { id: 'state', agentSessionId: session.id, sequence: 1, createdAt: timestamp, entry: { kind: 'run-state', state: 'running' } },
      { id: 'user', agentSessionId: session.id, sequence: 2, createdAt: timestamp, entry: { kind: 'message', role: 'user', content: 'Hello' } },
      { id: 'call', agentSessionId: session.id, sequence: 3, createdAt: timestamp, entry: { kind: 'tool-invocation', invocationId: 'invoke-1', toolId: 'official/read', exposedName: 'read', transport: 'native-function', status: 'completed' } },
      { id: 'observation', agentSessionId: session.id, sequence: 4, createdAt: timestamp, entry: { kind: 'provider-observation', provider: 'test', model: 'model' } },
      { id: 'result', agentSessionId: session.id, sequence: 5, createdAt: timestamp, entry: { kind: 'tool-result', invocationId: 'invoke-1', toolId: 'official/read', status: 'completed', content: [{ type: 'text', text: 'Read complete' }] } },
    ]
    f.a.getTranscript.mockResolvedValue({ session, entries })
    f.render()
    await Promise.resolve()
    const detail = f.render().find(element => Array.isArray(element.props.entries))
    if (!detail) throw new Error('Missing Session detail')
    const content = elements((detail.type as (props: Record<string, unknown>) => Element)(detail.props))
    const group = content.find(element => Array.isArray(element.props.tools))
    expect(group?.props.tools).toMatchObject([{ label: '已read', resultContent: 'Read complete', status: 'success' }])
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
      && elements(element.props.children).some(child => child.type === 'strong' && text(child).includes(session.title!)))
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
      && elements(element.props.children).some(child => child.type === 'strong' && text(child).includes(failedSession.title)))
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
