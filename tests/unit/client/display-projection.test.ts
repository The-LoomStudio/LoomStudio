import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { displayText, isTransientAgentEntryId, useDisplayProjection, useOpeningDisplayProjection } from '../../../apps/studio-client/src/features/message-content/model/use-display-projection.js'
import type { HistoryProjectionSnapshot } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

const clients: QueryClient[] = []
afterEach(() => clients.splice(0).forEach(client => client.clear()))
const source = { kind: 'agent-session', sessionId: 'a' } as const
const snapshot: HistoryProjectionSnapshot = {
  source, phase: 'display', ruleIds: [], matches: [], diagnostics: [],
  entries: [{ id: '1', originalText: 'raw', text: '<p>Display</p>', depth: 0, appliedRuleIds: [], promotedReasoning: [] }],
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const project = vi.fn(async () => ({ snapshot }))
  const initial = {
    api: { project } as unknown as StudioApi['textTransforms'],
    endpoint: '/rpc-a', source, entries: [{ id: '1', text: 'raw' }], refreshToken: 0, revision: 'preset-a',
  }
  function render(overrides: Partial<Parameters<typeof useDisplayProjection>[0]> = {}) {
    let state!: ReturnType<typeof useDisplayProjection>
    function Consumer() { state = useDisplayProjection({ ...initial, ...overrides }); return null }
    renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
    return { state, query: client.getQueryCache().getAll().at(-1)! }
  }
  return { client, project, render }
}

describe('Display projection lifecycle', () => {
  it('keeps optimistic and streaming Agent entries raw until persisted IDs replace them', () => {
    expect(isTransientAgentEntryId('optimistic-agent-entry-1')).toBe(true)
    expect(isTransientAgentEntryId('streaming-agent-entry-2')).toBe(true)
    expect(isTransientAgentEntryId('persisted-entry')).toBe(false)
    const projection = { entries: new Map(), pending: false, error: 'stale' }
    expect(displayText(projection, 'optimistic-agent-entry-1', 'draft', true)).toBe('draft')
    expect(displayText(projection, 'persisted-entry', 'saved')).toBeUndefined()
  })

  it('isolates opening previews by endpoint, card, preset and text, and rejects stale baselines', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    const previewCardOpening = vi.fn(async () => ({ text: '<div>Ready</div>', originalText: 'raw', diagnostics: [] }))
    const initial = {
      api: { previewCardOpening } as unknown as StudioApi['textTransforms'],
      endpoint: '/rpc', opening: { cardId: 'card-a', presetId: 'preset-a', text: 'raw' }, refreshToken: 0,
    }
    function render(overrides: Partial<Parameters<typeof useOpeningDisplayProjection>[0]> = {}) {
      let state!: ReturnType<typeof useOpeningDisplayProjection>
      function Consumer() { state = useOpeningDisplayProjection({ ...initial, ...overrides }); return null }
      renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
      return { state, query: client.getQueryCache().getAll().at(-1)! }
    }
    await render().query.fetch()
    expect(previewCardOpening).toHaveBeenCalledWith(initial.opening)
    expect(render().state?.text).toBe('<div>Ready</div>')
    for (const overrides of [
      { endpoint: '/other' },
      { opening: { ...initial.opening, cardId: 'card-b' } },
      { opening: { ...initial.opening, presetId: 'preset-b' } },
    ]) {
      expect(render(overrides).state?.text).toBeUndefined()
      expect(render(overrides).state?.pending).toBe(true)
    }
    const changed = { opening: { ...initial.opening, text: 'edited' } }
    await expect(render(changed).query.fetch()).rejects.toThrow('current text')
    expect(render(changed).state?.text).toBeUndefined()
    expect(render(changed).state?.error).toContain('current text')
    expect(render({ opening: undefined }).state).toBeUndefined()
  })

  it('uses the display API and rejects missing or stale raw-text baselines', async () => {
    const { project, render } = setup()
    const first = render()
    await first.query.fetch()
    expect(project).toHaveBeenCalledWith({ source, phase: 'display', entryIds: ['1'] })
    expect(render().state?.entries.get('1')?.text).toBe('<p>Display</p>')
    const changed = render({ entries: [{ id: '1', text: 'edited' }] })
    await expect(changed.query.fetch()).rejects.toThrow('current message')
    expect(render({ entries: [{ id: '1', text: 'edited' }] }).state?.error).toContain('current message')
  })

  it('retains a valid previous snapshot during same-source refresh, but never across scopes', async () => {
    const { client, project, render } = setup()
    const original = render().query
    await original.fetch()
    const observer = new QueryObserver(client, original.options)
    const unsubscribe = observer.subscribe(() => undefined)
    const pending = Promise.withResolvers<{ snapshot: HistoryProjectionSnapshot }>()
    project.mockImplementation(() => pending.promise)
    const refreshed = render({ refreshToken: 1 }).query
    observer.setOptions(refreshed.options)
    expect(observer.getCurrentResult().data).toEqual(snapshot)
    expect(observer.getCurrentResult().isPlaceholderData).toBe(true)
    for (const overrides of [
      { endpoint: '/rpc-b' },
      { source: { kind: 'agent-session' as const, sessionId: 'b' } },
      { source: { kind: 'narrative' as const, timelineId: 't', branchId: 'b' } },
      { consumerAgentSessionId: 'different-consumer' },
      { revision: 'preset-b' },
    ]) {
      observer.setOptions(render(overrides).query.options)
      expect(observer.getCurrentResult().data).toBeUndefined()
    }
    pending.resolve({ snapshot })
    unsubscribe()
  })

  it('exposes transport failures without silently treating raw text as a projection', async () => {
    const { project, render } = setup()
    project.mockRejectedValue(new Error('offline'))
    await expect(render().query.fetch()).rejects.toThrow('offline')
    const state = render().state
    expect(state?.error).toBe('offline')
    expect(state?.entries.size).toBe(0)
  })

  it('keeps successful output available when the runtime reports a nonfatal rule diagnostic', async () => {
    const { project, render } = setup()
    project.mockResolvedValue({ snapshot: { ...snapshot, diagnostics: [{ code: 'text.rule.invalid', message: 'invalid rule' }] } })
    await render().query.fetch()
    const state = render().state
    expect(state?.error).toBeUndefined()
    expect(state?.warning).toBe('invalid rule')
    expect(state?.entries.get('1')?.text).toBe('<p>Display</p>')
  })
})
