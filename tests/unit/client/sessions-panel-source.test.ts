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
      && elements(element.props.children).some(child => child.type === 'strong' && child.props.children === session.title))
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

describe('Session panel preview source isolation', () => {
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
    vi.stubGlobal('window', { confirm: () => true })
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
