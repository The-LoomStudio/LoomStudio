// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { AgentTaskMenu } from '../../../apps/studio-client/src/features/narrative-runtime/ui/agent-task-menu.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { Translator } from '../../../apps/studio-client/src/shared/i18n/index.js'

it('refreshes task snapshots by SSE scope and restores them after reconnect', async () => {
  class TestEventSource extends EventTarget {
    static OPEN = 1
    readyState = 0
    close() { this.readyState = 2 }
  }
  const stream = new TestEventSource()
  vi.stubGlobal('EventSource', class { static OPEN = 1; constructor() { return stream } })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const client = new QueryClient()
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  type Result = Awaited<ReturnType<StudioApi['agentSessions']['listRuns']>>
  const initial = Promise.withResolvers<Result>()
  const listRuns = vi.fn<StudioApi['agentSessions']['listRuns']>().mockResolvedValue({ tasks: [] })
    .mockReturnValueOnce(initial.promise)
  const api = { agentSessions: { listRuns } } as unknown as StudioApi
  const tick = (milliseconds = 1) => act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
  const connect = () => act(async () => {
    stream.readyState = TestEventSource.OPEN
    stream.dispatchEvent(new Event('open'))
  })
  const changed = (timelineId: string | null) => act(async () => {
    stream.dispatchEvent(new MessageEvent('agent.run-list.changed', { data: JSON.stringify({ payload: { timelineId } }) }))
  })
  const readScopes = () => listRuns.mock.calls.map(([scope]) => scope?.timelineId ?? 'all')
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(AgentTaskMenu, {
      api, endpoint: '/trpc', timelineId: 'story', t: ((key: string) => key) as Translator,
      onOpen: vi.fn(), onResumed: vi.fn(), onAbandoned: vi.fn(),
    }))))
    expect(readScopes()).toEqual(['story'])
    await connect()
    expect(listRuns.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(readScopes()).toEqual(['story', 'story'])
    initial.resolve({ tasks: [] })
    await tick()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    await tick(11_000)
    expect(readScopes()).toEqual(['story', 'story'])
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'agentTasks.all')!.click())
    await tick(11_000)
    expect(readScopes()).toEqual(['story', 'story', 'all'])
    listRuns.mockClear()
    await changed('other-story')
    expect(readScopes()).toEqual(['all'])
    await changed('story')
    expect(readScopes().slice(1).sort()).toEqual(['all', 'story'])

    await act(async () => {
      stream.readyState = 0
      stream.dispatchEvent(new Event('error'))
    })
    listRuns.mockClear()
    await tick(2_001)
    expect(readScopes().sort()).toEqual(['all', 'story'])
    listRuns.mockClear()
    await connect()
    expect(readScopes().sort()).toEqual(['all', 'story'])
    await tick(11_000)
    expect(listRuns).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
