import { afterEach, beforeEach, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { DataOperation } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'
import type { AgentSession, AgentTranscriptEntry, InvokeAgentTurnResult } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  rootEffectSeen: false,
  swipeEffect: undefined as (() => void) | undefined,
  swipeDeps: undefined as unknown[] | undefined,
  nextSwipeDeps: undefined as unknown[] | undefined,
  rootDeps: undefined as unknown[] | undefined,
  rootDispose: undefined as (() => void) | undefined,
  rootEffect: undefined as (() => void | (() => void)) | undefined,
  values: [] as unknown[],
  commitEffect: undefined as (() => void | (() => void)) | undefined,
  onCommit: undefined as ((operations: Array<{ entityType: string; entityId: string }>) => void) | undefined,
  narrativeConnected: undefined as (() => void) | undefined,
  sessionEffect: undefined as (() => void | (() => void)) | undefined,
  sessionCommit: undefined as ((operations: DataOperation[]) => void) | undefined,
  connected: undefined as (() => void) | undefined,
  subscribingSessions: false,
  mountEffects: [] as Array<() => void>,
}))
export { hooks }
vi.mock('../../../apps/studio-client/src/shared/api/data-commit-events.js', () => ({
  subscribeDataCommits: (onCommit: typeof hooks.sessionCommit, connected: () => void) => {
    if (hooks.subscribingSessions) {
      hooks.sessionCommit = onCommit
      hooks.connected = connected
      return () => { hooks.sessionCommit = undefined }
    }
    hooks.onCommit = onCommit
    hooks.narrativeConnected = connected
    return () => { hooks.onCommit = undefined }
  },
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    if (deps?.length === 0) hooks.mountEffects.push(effect)
    if (deps?.length === 3) {
      if (!hooks.rootEffectSeen) { hooks.rootEffectSeen = true; hooks.rootEffect = effect }
      else if (typeof deps[1] === 'string' && typeof deps[2] === 'string') hooks.commitEffect = effect
    }
    if (deps?.length === 2 && deps[1] === 'timeline') hooks.sessionEffect = effect
    if (deps?.length === 2 && (deps[0] === undefined || typeof deps[0] === 'string')) {
      hooks.swipeEffect = effect
      hooks.nextSwipeDeps = deps
    }
  },
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

beforeEach(() => { hooks.swipeEffect = undefined; hooks.swipeDeps = undefined; hooks.nextSwipeDeps = undefined; hooks.rootDispose?.(); hooks.rootDispose = undefined; hooks.rootDeps = undefined; hooks.rootEffect = undefined; hooks.rootEffectSeen = false; hooks.cursor = 0; hooks.values = []; hooks.commitEffect = undefined; hooks.onCommit = undefined
  hooks.narrativeConnected = undefined
  hooks.sessionEffect = undefined; hooks.sessionCommit = undefined; hooks.connected = undefined; hooks.subscribingSessions = false })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

export function fixture() {
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
    const entry: AgentTranscriptEntry = { id: request.requestId, agentSessionId: request.agentSessionId, sequence: 1, createdAt: timeline.createdAt,
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
        create: createSession, createRun, submitInterjection, subscribeRun, getTranscript, resumeRun, acknowledgeRunCompletion,
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
  const render = () => {
    hooks.cursor = 0; hooks.mountEffects = []; hooks.rootEffectSeen = false
    const current = useNarrativeRuntime(input)
    const deps = [input.api, current.timeline?.id, current.branch?.id]
    if (!hooks.rootDeps || deps.some((value, index) => value !== hooks.rootDeps![index])) {
      hooks.rootDispose?.()
      hooks.rootDeps = deps
      hooks.rootDispose = hooks.rootEffect?.() || undefined
    }
    const swipeDeps = hooks.nextSwipeDeps
    if (swipeDeps && (!hooks.swipeDeps || swipeDeps.some((value, index) => value !== hooks.swipeDeps![index]))) {
      hooks.swipeDeps = swipeDeps
      hooks.swipeEffect?.()
    }
    return current
  }
  const loadRoot = async () => { render(); for (let i = 0; i < 12; i++) await Promise.resolve(); return render() }
  const event = { preventDefault: vi.fn() } as unknown as FormEvent
  return { render, loadRoot, rootSession, rootEntries, rootGetTranscript, event, input, result, rootResult, appendInput, createTimeline, createSession, createRun, submitInterjection, subscribeRun, getTranscript, getPage, resumeRun, acknowledgeRunCompletion, reportFailure }
}

export async function primaryFixture() {
  const f = fixture()
  await f.render().createTimelineFromCard()
  await f.loadRoot()
  f.rootGetTranscript.mockResolvedValue({ session: f.rootSession, entries: f.rootEntries })
  const primary = await f.render().createAgentSession('profile', true)
  f.input.api.agentSessions.list = vi.fn(async () => ({ sessions: [primary!] }))
  f.getTranscript.mockResolvedValueOnce({ session: primary!, entries: [] })
  await f.render().activateAgentSession(primary!)
  f.getTranscript.mockClear()
  return f
}
