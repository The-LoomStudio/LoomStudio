import { afterEach, beforeEach, vi } from 'vitest'
import { act, type FormEvent } from 'react'
import { renderHook } from './render-hook.js'
import { Window } from 'happy-dom'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { DataOperation } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'
import type { AgentSession, AgentTranscriptEntry, InvokeAgentTurnResult } from '../../../apps/studio-client/src/entities/index.js'

const events = vi.hoisted(() => ({ listeners: new Set<{ changed: (operations: DataOperation[]) => void; connected: () => void }>() }))
vi.mock('../../../apps/studio-client/src/shared/api/data-commit-events.js', () => ({
  subscribeDataCommits: (changed: (operations: DataOperation[]) => void, connected: () => void) => {
    const listener = { changed, connected }
    events.listeners.add(listener)
    return () => events.listeners.delete(listener)
  },
}))
export const hooks = {
  onCommit: (operations: DataOperation[]) => act(() => { for (const listener of [...events.listeners]) listener.changed(operations) }),
  narrativeConnected: () => act(() => { for (const listener of [...events.listeners]) listener.connected() }),
}
const mounted: Array<() => void> = []
beforeEach(() => {
  // HTTP/SSE integration keeps Node module transforms while mounting a real React root.
  if (typeof document === 'undefined') {
    const browser = new Window()
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', browser.document)
    vi.stubGlobal('localStorage', browser.localStorage)
  }
  localStorage.clear()
})
afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); events.listeners.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

export async function settle<T>(action: () => T | Promise<T>): Promise<T> {
  let result!: T
  await act(async () => { result = await action() })
  return result
}

export async function fixture() {
  const timeline = {
    id: 'timeline', activeBranchId: 'branch', promptResourceIds: [],
    createdAt: '2026-09-23', updatedAt: '2026-09-23',
  }
  const branch = {
    id: 'branch', timelineId: timeline.id, stateHeadRevisionId: 'state', workspaceHeadRevisionId: 'workspace',
    createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  const session: AgentSession = {
    id: 'session', kind: 'agent', timelineId: timeline.id, agentPresetId: 'profile',
    entryCount: 0, createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  const narrative: Awaited<ReturnType<StudioApi['narratives']['getPage']>> = { timeline, branch, nodes: [] }
  const result = {
    narrative, agentSession: session, runId: 'run',
    provider: { provider: 'test', model: 'test-model', finishReason: 'stop' },
    projection: { messages: [], editorProjection: { sourceRows: [], promptRows: [] } }, toolExposures: [], toolPromptBuildTrace: { sourceCount: 0, activeCount: 0, requestedOrder: [], effectiveOrder: [], activations: [], orders: [] },
    promptBuildTrace: { version: 'core-compact-1' as const, status: 'ok' as const, initialFragmentCount: 0, finalFragmentCount: 0, messageFragmentCount: 0, diagnostics: [], executions: [] }, macroInspection: { snapshot: { global: {}, computed: {}, aliases: {} }, entries: [], capturedAt: '' },
    mutation: { changesetId: 'turn-commit', scope: 'agent-session-transcript' as const },
    entries: {
      user: {
        id: 'user', agentSessionId: session.id, sequence: 1, createdAt: timeline.createdAt,
        entry: { kind: 'message' as const, role: 'user', content: 'Draft' },
      } satisfies AgentTranscriptEntry,
      assistant: {
        id: 'assistant', agentSessionId: session.id, sequence: 2, createdAt: timeline.createdAt,
        entry: { kind: 'message' as const, role: 'assistant', content: 'Reply' },
      } satisfies AgentTranscriptEntry,
    },
  } satisfies InvokeAgentTurnResult & { narrative: typeof narrative }
  const createTimeline = vi.fn(async () => narrative)
  const appendInput = vi.fn<StudioApi['narratives']['appendInput']>(async input => {
    const node = { id: input.nodeId, kind: 'user-input' as const, floor: 1, timelineId: timeline.id, stateRevisionId: 'state', workspaceRevisionId: 'workspace',
      body: { format: 'loom-markdown.v1' as const, raw: input.content }, createdAt: timeline.createdAt }
    Object.assign(branch, { headNodeId: node.id })
    Object.assign(narrative, { nodes: [node] })
    return { timeline, branch, node, mutation: { changesetId: 'input-commit' } }
  })
  const createSession = vi.fn<StudioApi['agentSessions']['create']>(async () => ({
    session, mutation: { changesetId: 'create-session' },
  }))
  const createRun = vi.fn<StudioApi['agentSessions']['createRun']>(async () => ({ runId: 'run' }))
  const submitInterjection = vi.fn<StudioApi['agentSessions']['submitInterjection']>(async request => {
    const entry: Awaited<ReturnType<StudioApi['agentSessions']['submitInterjection']>>['entry'] = { id: request.requestId, agentSessionId: request.agentSessionId, sequence: 1, createdAt: timeline.createdAt,
      entry: { kind: 'user-interjection', requestId: request.requestId, content: request.input, mode: request.mode, attachments: request.attachments, narrativeTarget: request.narrativeTarget } }
    // Model the server's accepted idle boundary; the client must not append a node itself.
    if (request.mode === 'narrative') {
      const node = { id: 'input-node', entryId: 'user', kind: 'user-input' as const, floor: 1, timelineId: timeline.id,
        stateRevisionId: 'state', workspaceRevisionId: 'workspace', body: { format: 'loom-markdown.v1' as const, raw: request.input.trim() }, createdAt: timeline.createdAt }
      Object.assign(branch, { headNodeId: node.id })
      Object.assign(narrative, { nodes: [node] })
    }
    return { runId: 'run', entry, pending: true }
  })
  const subscribeRun = vi.fn<StudioApi['agentSessions']['subscribeRun']>(async (_runId, _cursor, sessionId) => ({
    events: [{ type: 'completed', runId: 'run', result: sessionId === timeline.id ? rootResult : result }], nextCursor: 1, done: true, state: 'completed',
  }))
  const rootSession: AgentSession = { ...session, id: timeline.id, kind: 'timeline' }
  const rootResult = { ...result, agentSession: rootSession, entries: {
    user: { ...result.entries.user, agentSessionId: timeline.id, entry: { ...result.entries.user.entry, purpose: 'narrative' as const } },
    assistant: { ...result.entries.assistant, agentSessionId: timeline.id },
  } } satisfies InvokeAgentTurnResult & { narrative: typeof narrative }
  const rootEntries = [rootResult.entries.user, rootResult.entries.assistant]
  const rootGetTranscript = vi.fn<StudioApi['agentSessions']['getTranscript']>(async () => ({ session: rootSession, entries: [] }))
  const getTranscript = vi.fn<StudioApi['agentSessions']['getTranscript']>(async request => request.agentSessionId === timeline.id
    ? rootGetTranscript(request) : ({ session, entries: [result.entries.user, result.entries.assistant] }))
  const getPage = vi.fn<StudioApi['narratives']['getPage']>(async () => narrative)
  const resumeRun = vi.fn(async () => ({ runId: 'continued', accepted: true }))
  const acknowledgeRunCompletion = vi.fn(async (runId: string) => ({ runId, accepted: true }))
  const reportFailure = vi.fn<(error: unknown) => void>()
  const input: Parameters<typeof useNarrativeRuntime>[0] = {
    api: {
      narratives: {
        create: createTimeline, appendInput, getPage,
        getSwipes: vi.fn<StudioApi['narratives']['getSwipes']>(async () => ({})),
        list: vi.fn<StudioApi['narratives']['list']>(async () => ({ timelines: [] })),
      },
      agentSessions: {
        list: vi.fn(async () => ({ sessions: [] })), create: createSession, createRun, submitInterjection, subscribeRun, getTranscript, resumeRun, acknowledgeRunCompletion,
        update: vi.fn(async patch => { Object.assign(rootSession, patch); return { session: rootSession, mutation: { changesetId: 'configure-root' } } }),
        runState: vi.fn(async () => ({ runId: 'run', state: 'suspended' })),
      },
    } as unknown as StudioApi,
    storageScope: 'test', initialInput: '  Draft\n', selectedCardId: 'card', selectedAgentPresetId: 'profile',
    onSelectCard: vi.fn(), onSelectAgentPreset: vi.fn(),
    runAgentAction: async action => { try { await action() } catch (error) { reportFailure(error) } },
    // Same boolean completion contract as useStudioState's runReported adapter.
    runAction: async action => {
      try { await action(); return true } catch (error) { reportFailure(error); return false }
    },
    runLatestAction: action => action({ isCurrent: () => true } as never),
  }
  let rendered: ReturnType<typeof renderHook<ReturnType<typeof useNarrativeRuntime>>> | undefined
  const unmount = () => { rendered?.unmount(); rendered = undefined }
  mounted.push(unmount)
  const render = () => {
    if (!rendered) rendered = renderHook(() => useNarrativeRuntime(input))
    else rendered.rerender()
    return new Proxy(rendered.current, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          let result: unknown
          act(() => { result = value(...args) })
          return result
        }
      },
    })
  }
  const loadRoot = async () => { render(); await act(async () => {}); return render() }
  const event = { preventDefault: vi.fn() } as unknown as FormEvent
  await loadRoot()
  return { render, loadRoot, unmount, rootSession, rootEntries, rootGetTranscript, event, input, result, rootResult, appendInput, createTimeline, createSession, createRun, submitInterjection, subscribeRun, getTranscript, getPage, resumeRun, acknowledgeRunCompletion, reportFailure }
}

export async function primaryFixture() {
  const f = await fixture()
  await settle(() => f.render().createTimelineFromCard())
  await f.loadRoot()
  f.rootGetTranscript.mockResolvedValue({ session: f.rootSession, entries: f.rootEntries })
  const primary = await settle(() => f.render().createAgentSession('profile', true))
  f.input.api.agentSessions.list = vi.fn(async () => ({ sessions: [primary!] }))
  f.getTranscript.mockResolvedValueOnce({ session: primary!, entries: [] })
  await settle(() => f.render().activateAgentSession(primary!))
  f.getTranscript.mockClear()
  return f
}
