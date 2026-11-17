// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ObservationEntry, ObservationSummary } from '../../../apps/studio-client/src/entities/observation.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { InspectorPanel } from '../../../apps/studio-client/src/widgets/inspector-panel/inspector-panel.js'

let root: ReturnType<typeof createRoot> | undefined
let client: QueryClient | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  client?.clear()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function flushUi() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  }
}

describe('InspectorPanel 3-ledger troubleshooting', () => {
  it('renders correlated Prompt Projection, Model Calls, and Diagnostics & Logs ledgers', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const runId = 'run-corr-1'
    const buildId = 'build-corr-1'
    const requestId = 'req-corr-1'
    const apiCallId = 'api-corr-2'
    const correlationId = 'corr-trace-1'

    const runSummary: ObservationSummary = {
      id: runId,
      kind: 'run',
      title: 'Agent Turn',
      status: 'completed',
      capturedAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T10:00:02.000Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      buildId,
      durationMs: 1240,
      availability: 'recorded',
      origin: { correlationId, callId: 'call-run-1' },
    }

    const buildSummary: ObservationSummary = {
      id: buildId,
      kind: 'build',
      parentId: runId,
      title: 'Prompt Build',
      status: 'completed',
      capturedAt: '2026-11-17T10:00:00.100Z',
      updatedAt: '2026-11-17T10:00:00.300Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      durationMs: 42,
      availability: 'recorded',
      origin: { correlationId, sourceRunId: runId },
    }

    const requestSummary: ObservationSummary = {
      id: requestId,
      kind: 'request',
      parentId: runId,
      providerStep: 1,
      title: 'Primary Model Request',
      status: 'completed',
      capturedAt: '2026-11-17T10:00:00.400Z',
      updatedAt: '2026-11-17T10:00:01.200Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      durationMs: 800,
      availability: 'recorded',
      modelId: 'gpt-4o-mini',
      origin: { correlationId, sourceRunId: runId },
    }

    const apiSummary: ObservationSummary = {
      id: apiCallId,
      kind: 'api',
      providerStep: 2,
      title: 'Tool Summary Call',
      status: 'failed',
      capturedAt: '2026-11-17T10:00:01.300Z',
      updatedAt: '2026-11-17T10:00:01.900Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      durationMs: 320,
      availability: 'recorded',
      diagnostic: 'Upstream rate limit hit',
      modelId: 'claude-3-5-haiku',
      origin: { correlationId, sourceRunId: runId },
    }

    const buildEntry: ObservationEntry = {
      ...buildSummary,
      build: {
        messages: [
          { role: 'system', content: 'You are a helpful guide.' },
          { role: 'user', content: 'Hello there' },
        ],
        sources: [
          {
            id: 'src-persona',
            title: 'System Persona',
            path: 'preset/persona',
            activationKind: 'always',
            active: true,
            reason: 'Included by preset root',
            rendered: 'You are a helpful guide.',
            fragmentIds: ['frag-1'],
          },
          {
            id: 'src-lore',
            title: 'Dormant Lorebook',
            path: 'lore/dormant',
            activationKind: 'keyword',
            active: false,
            reason: 'No keyword matched',
          },
        ],
        diagnostics: [
          { severity: 'warning', code: 'prompt.trimmed', message: 'History window trimmed 1 old turn' },
        ],
        promptBuildTrace: {
          status: 'ok',
          version: '2',
          messageFragmentCount: 2,
          initialFragmentCount: 3,
          finalFragmentCount: 2,
          stages: [],
          budget: { maxTokens: 4096 },
          diagnostics: [],
        } as unknown as NonNullable<ObservationEntry['build']>['promptBuildTrace'],
      },
    }

    const requestEntry: ObservationEntry = {
      ...requestSummary,
      request: {
        phase: 'completed',
        model: { providerProfileId: 'openai-main', modelId: 'gpt-4o-mini' },
        finishReason: 'stop',
        firstOutputMs: 180,
        usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 },
        response: { provider: 'openai', model: 'gpt-4o-mini' },
        toolExecutions: [{ id: 'tool-1', name: 'lookup', status: 'completed' }],
      },
    }

    const apiEntry: ObservationEntry = {
      ...apiSummary,
      request: {
        phase: 'failed',
        model: { providerProfileId: 'anthropic-main', modelId: 'claude-3-5-haiku' },
        finishReason: 'error',
        usage: { inputTokens: 80, outputTokens: 0, totalTokens: 80 },
        response: { provider: 'anthropic', model: 'claude-3-5-haiku' },
      },
    }

    const observationsList = vi.fn(async (input?: { kind?: 'run' | 'build' | 'api' }) => {
      if (input?.kind === 'api') {
        return { records: [apiSummary], dropped: 0 }
      }
      return { records: [runSummary], dropped: 0 }
    })
    const observationsGet = vi.fn(async (id: string) => {
      if (id === runId) return { record: runSummary, children: [buildSummary, requestSummary] }
      return null
    })
    const observationsGetBuild = vi.fn(async (id: string) => (id === buildId ? buildEntry : null))
    const observationsGetRequest = vi.fn(async (id: string) => {
      if (id === requestId) return requestEntry
      if (id === apiCallId) return apiEntry
      return null
    })
    const logsList = vi.fn(async () => ({
      items: [
        {
          timestamp: '2026-11-17T10:00:01.000Z',
          level: 'info' as const,
          service: 'studio-server',
          instanceId: 'srv-1',
          namespace: 'agent.runtime',
          message: 'Correlated turn log line',
          correlationId,
          data: { runId },
        },
        {
          timestamp: '2026-11-17T10:00:01.500Z',
          level: 'error' as const,
          service: 'studio-server',
          instanceId: 'srv-1',
          namespace: 'agent.runtime',
          message: 'Unrelated other run log',
          correlationId: 'corr-other',
          data: { runId: 'run-other' },
        },
      ],
      cursor: 'cursor-1',
      hasMore: false,
    }))
    const diagnosticsList = vi.fn(async () => ({
      items: [
        {
          id: 'diag-corr-1',
          severity: 'error' as const,
          code: 'provider.rate_limit',
          message: 'Correlated rate limit diagnostic',
          source: 'ai-gateway',
          correlationId,
          createdAt: '2026-11-17T10:00:01.400Z',
        },
        {
          id: 'diag-other',
          severity: 'warning' as const,
          code: 'other.code',
          message: 'Unrelated diagnostic message',
          source: 'kernel',
          correlationId: 'corr-other',
          createdAt: '2026-11-17T10:00:01.600Z',
        },
      ],
    }))

    const api = {
      observations: {
        list: observationsList,
        get: observationsGet,
        getBuild: observationsGetBuild,
        getRequest: observationsGetRequest,
      },
      logs: {
        list: logsList,
      },
      diagnostics: {
        list: diagnosticsList,
      },
    } as unknown as StudioApi

    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client: client! },
          createElement(InspectorPanel, {
            api,
            endpoint: 'test-endpoint',
            runId,
            buildId,
            agentTranscript: [],
            cardSnapshot: null,
            promptBuildSteps: [],
            promptBuildTrace: null,
            promptMessages: null,
            providerPayloadPreview: null,
            runDetails: null,
            t: createTranslator('zh-CN'),
          }),
        ),
      )
    })

    await flushUi()

    expect(observationsList).toHaveBeenCalled()
    expect(observationsGet).toHaveBeenCalledWith(runId)
    expect(observationsGetBuild).toHaveBeenCalledWith(buildId)
    expect(observationsGetRequest).toHaveBeenCalledWith(requestId)
    expect(observationsGetRequest).toHaveBeenCalledWith(apiCallId)
    expect(logsList).toHaveBeenCalled()
    expect(diagnosticsList).toHaveBeenCalled()

    const rootEl = container.querySelector('[data-loom-component="inspector-3-ledgers"]')!
    expect(rootEl).not.toBeNull()
    expect(rootEl.textContent).toContain(runId)
    expect(rootEl.textContent).toContain(correlationId)
    expect(rootEl.textContent).toContain(buildId)

    // Ledger 1: Prompt Projection
    const promptLedger = container.querySelector('[data-ledger="prompt"]')!
    expect(promptLedger.textContent).toContain('Prompt Projection')
    expect(promptLedger.textContent).toContain('2 sections')
    expect(promptLedger.textContent).toContain('System Persona')
    expect(promptLedger.textContent).toContain('Included by preset root')
    expect(promptLedger.textContent).toContain('Dormant Lorebook')
    expect(promptLedger.textContent).toContain('No keyword matched')

    // Ledger 2: Model Calls
    const callsLedger = container.querySelector('[data-ledger="calls"]')!
    expect(callsLedger.textContent).toContain('Model Calls')
    expect(callsLedger.textContent).toContain('2 calls')
    expect(callsLedger.textContent).toContain('gpt-4o-mini')
    expect(callsLedger.textContent).toContain('claude-3-5-haiku')
    expect(callsLedger.textContent).toContain('Upstream rate limit hit')
    expect(callsLedger.textContent).toContain('200 / 45')

    // Ledger 3: Diagnostics & Logs
    const diagnosticsLedger = container.querySelector('[data-ledger="diagnostics"]')!
    expect(diagnosticsLedger.textContent).toContain('Diagnostics & Logs')
    expect(diagnosticsLedger.textContent).toContain('History window trimmed 1 old turn')
    expect(diagnosticsLedger.textContent).toContain('Correlated rate limit diagnostic')
    expect(diagnosticsLedger.textContent).toContain('Correlated turn log line')
    expect(diagnosticsLedger.textContent).not.toContain('Unrelated other run log')
    expect(diagnosticsLedger.textContent).not.toContain('Unrelated diagnostic message')
  })

  it('renders empty states cleanly instead of eternal loading when there are 0 runs', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const api = {
      observations: {
        list: vi.fn(async () => ({ records: [], dropped: 0 })),
        get: vi.fn(async () => null),
        getBuild: vi.fn(async () => null),
        getRequest: vi.fn(async () => null),
      },
      logs: { list: vi.fn(async () => ({ items: [], cursor: undefined, hasMore: false })) },
      diagnostics: { list: vi.fn(async () => ({ items: [] })) },
    } as unknown as StudioApi

    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client: client! },
          createElement(InspectorPanel, {
            api,
            endpoint: 'empty-runs-endpoint',
            agentTranscript: [],
            cardSnapshot: null,
            promptBuildSteps: [],
            promptBuildTrace: null,
            promptMessages: null,
            providerPayloadPreview: null,
            runDetails: null,
            t: createTranslator('zh-CN'),
          }),
        ),
      )
    })

    await flushUi()

    const rootEl = container.querySelector('[data-loom-component="inspector-3-ledgers"]')!
    expect(rootEl.textContent).not.toContain('正在读取模型日志证据…')
    expect(container.querySelector('[data-ledger="prompt"]')!.textContent).toContain('No ObservationBuild projection recorded for this selection.')
    expect(container.querySelector('[data-ledger="calls"]')!.textContent).toContain('No correlated model calls recorded for this run.')
    expect(container.querySelector('[data-ledger="diagnostics"]')!.textContent).toContain('No correlated diagnostics or logs for this run.')
  })

  it('renders empty states cleanly when a run has missing buildId and 0 model calls', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const runId = 'run-no-build'
    const runSummary: ObservationSummary = {
      id: runId,
      kind: 'run',
      title: 'Run Without Build',
      status: 'completed',
      capturedAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T10:00:01.000Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      availability: 'recorded',
      origin: { correlationId: 'corr-no-build' },
    }

    const api = {
      observations: {
        list: vi.fn(async (input?: { kind?: string }) => (
          input?.kind === 'api' ? { records: [], dropped: 0 } : { records: [runSummary], dropped: 0 }
        )),
        get: vi.fn(async () => ({ record: runSummary, children: [] })),
        getBuild: vi.fn(async () => null),
        getRequest: vi.fn(async () => null),
      },
      logs: { list: vi.fn(async () => ({ items: [], cursor: undefined, hasMore: false })) },
      diagnostics: { list: vi.fn(async () => ({ items: [] })) },
    } as unknown as StudioApi

    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client: client! },
          createElement(InspectorPanel, {
            api,
            endpoint: 'missing-build-endpoint',
            runId,
            agentTranscript: [],
            cardSnapshot: null,
            promptBuildSteps: [],
            promptBuildTrace: null,
            promptMessages: null,
            providerPayloadPreview: null,
            runDetails: null,
            t: createTranslator('zh-CN'),
          }),
        ),
      )
    })

    await flushUi()

    const rootEl = container.querySelector('[data-loom-component="inspector-3-ledgers"]')!
    expect(rootEl.textContent).not.toContain('正在读取模型日志证据…')
    expect(api.observations.getBuild).not.toHaveBeenCalled()
    expect(api.observations.getRequest).not.toHaveBeenCalled()
    expect(container.querySelector('[data-ledger="prompt"]')!.textContent).toContain('No ObservationBuild projection recorded for this selection.')
    expect(container.querySelector('[data-ledger="calls"]')!.textContent).toContain('No correlated model calls recorded for this run.')
  })

  it.each(['runs', 'detail'] as const)('surfaces %s query errors in the ledger header', async kind => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const api = {
      observations: {
        list: kind === 'runs'
          ? vi.fn(async () => { throw new Error('Runs list failed') })
          : vi.fn(async () => ({ records: [], dropped: 0 })),
        get: kind === 'detail'
          ? vi.fn(async () => { throw new Error('Run detail failed') })
          : vi.fn(async () => null),
        getBuild: vi.fn(async () => null),
        getRequest: vi.fn(async () => null),
      },
      logs: { list: vi.fn(async () => ({ items: [], cursor: undefined, hasMore: false })) },
      diagnostics: { list: vi.fn(async () => ({ items: [] })) },
    } as unknown as StudioApi

    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client: client! },
          createElement(InspectorPanel, {
            api,
            endpoint: `error-${kind}-endpoint`,
            runId: kind === 'detail' ? 'run-err-1' : undefined,
            agentTranscript: [],
            cardSnapshot: null,
            promptBuildSteps: [],
            promptBuildTrace: null,
            promptMessages: null,
            providerPayloadPreview: null,
            runDetails: null,
            t: createTranslator('zh-CN'),
          }),
        ),
      )
    })

    await flushUi()

    const alert = container.querySelector('[data-loom-component="inspector-3-ledgers"] [role="alert"]')!
    expect(alert).not.toBeNull()
    expect(alert.textContent).toContain('读取模型日志失败，请重试。')
    expect(alert.textContent).toContain(kind === 'runs' ? 'Runs list failed' : 'Run detail failed')
  })

  it('refreshes build and call snapshots when a running observation transitions to terminal state', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const runId = 'run-transition-1'
    const buildId = 'build-transition-1'
    const requestId = 'req-transition-1'
    const correlationId = 'corr-transition-1'

    let currentStatus: ObservationSummary['status'] = 'running'

    const makeRunSummary = (status: ObservationSummary['status']): ObservationSummary => ({
      id: runId,
      kind: 'run',
      title: 'Transitioning Run',
      status,
      capturedAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T10:00:02.000Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      buildId,
      durationMs: status === 'running' ? 250 : 1200,
      availability: 'recorded',
      origin: { correlationId },
    })

    const buildSummary: ObservationSummary = {
      id: buildId,
      kind: 'build',
      parentId: runId,
      title: 'Prompt Build',
      status: 'completed',
      capturedAt: '2026-11-17T10:00:00.100Z',
      updatedAt: '2026-11-17T10:00:00.300Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      durationMs: 30,
      availability: 'recorded',
      origin: { correlationId, sourceRunId: runId },
    }

    const requestSummary: ObservationSummary = {
      id: requestId,
      kind: 'request',
      parentId: runId,
      providerStep: 1,
      title: 'Primary Model Request',
      status: 'running',
      capturedAt: '2026-11-17T10:00:00.400Z',
      updatedAt: '2026-11-17T10:00:01.200Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      durationMs: 400,
      availability: 'recorded',
      modelId: 'gpt-4o-mini',
      origin: { correlationId, sourceRunId: runId },
    }

    const observationsGetBuild = vi.fn(async (): Promise<ObservationEntry> => ({
      ...buildSummary,
      status: currentStatus,
      build: {
        messages: [{ role: 'user', content: 'Hello' }],
        sources: currentStatus === 'running'
          ? []
          : [{ id: 'src-final', title: 'Final Persona', path: 'preset/final', activationKind: 'always', active: true, reason: 'Finalized after turn' }],
        diagnostics: [],
      },
    }))

    const observationsGetRequest = vi.fn(async (): Promise<ObservationEntry> => ({
      ...requestSummary,
      status: currentStatus,
      request: {
        phase: currentStatus === 'running' ? 'invoking' : 'completed',
        model: { providerProfileId: 'openai-main', modelId: 'gpt-4o-mini' },
        ...(currentStatus === 'running' ? {} : { finishReason: 'stop', usage: { inputTokens: 111, outputTokens: 222, totalTokens: 333 } }),
      },
    }))

    const api = {
      observations: {
        list: vi.fn(async (input?: { kind?: string }) => (
          input?.kind === 'api' ? { records: [], dropped: 0 } : { records: [makeRunSummary(currentStatus)], dropped: 0 }
        )),
        get: vi.fn(async () => ({
          record: makeRunSummary(currentStatus),
          children: [buildSummary, { ...requestSummary, status: currentStatus }],
        })),
        getBuild: observationsGetBuild,
        getRequest: observationsGetRequest,
      },
      logs: { list: vi.fn(async () => ({ items: [], cursor: undefined, hasMore: false })) },
      diagnostics: { list: vi.fn(async () => ({ items: [] })) },
    } as unknown as StudioApi

    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client: client! },
          createElement(InspectorPanel, {
            api,
            endpoint: 'transition-endpoint',
            runId,
            buildId,
            agentTranscript: [],
            cardSnapshot: null,
            promptBuildSteps: [],
            promptBuildTrace: null,
            promptMessages: null,
            providerPayloadPreview: null,
            runDetails: null,
            t: createTranslator('zh-CN'),
          }),
        ),
      )
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(50) })

    expect(container.querySelector('[data-ledger="calls"]')!.textContent).toContain('invoking')
    expect(container.querySelector('[data-ledger="prompt"]')!.textContent).not.toContain('Final Persona')

    const buildCallsWhileRunning = observationsGetBuild.mock.calls.length
    const requestCallsWhileRunning = observationsGetRequest.mock.calls.length

    currentStatus = 'completed'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })

    expect(observationsGetBuild.mock.calls.length).toBeGreaterThan(buildCallsWhileRunning)
    expect(observationsGetRequest.mock.calls.length).toBeGreaterThan(requestCallsWhileRunning)
    expect(container.querySelector('[data-ledger="prompt"]')!.textContent).toContain('Final Persona')
    expect(container.querySelector('[data-ledger="calls"]')!.textContent).toContain('111 / 222')
    expect(container.querySelector('[data-ledger="calls"]')!.textContent).toContain('finish: stop')
  })
})
