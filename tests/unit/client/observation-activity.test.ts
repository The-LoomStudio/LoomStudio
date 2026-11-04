// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { useObservations } from '../../../apps/studio-client/src/features/observability/model/use-observations.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

it('pauses hidden observation reads and resumes the retained record on activation', async () => {
  vi.useFakeTimers()
  const observations = {
    persistence: vi.fn(async () => ({ enabled: false, available: true })),
    list: vi.fn(async () => ({ records: [] })),
    get: vi.fn(async () => null),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  const root = createRoot(host)
  let selected: string | undefined
  function Probe({ active }: { active: boolean }) {
    const state = useObservations({ observations } as unknown as StudioApi, 'activity-test', 'record-1', active)
    selected = state.recordId
    return null
  }
  const render = (active: boolean) => act(async () => {
    root.render(h(QueryClientProvider, { client }, h(Probe, { active })))
    await vi.advanceTimersByTimeAsync(0)
  })
  try {
    await render(false)
    expect(observations.list).not.toHaveBeenCalled()
    await render(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(observations.list.mock.calls.length).toBeGreaterThan(1)
    expect(observations.get).toHaveBeenCalledWith('record-1')
    await render(false)
    const reads = [observations.list, observations.persistence, observations.get].map(fn => fn.mock.calls.length)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect([observations.list, observations.persistence, observations.get].map(fn => fn.mock.calls.length)).toEqual(reads)
    expect(selected).toBe('record-1')
    await render(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(observations.get.mock.calls.length).toBeGreaterThan(reads[2]!)
    expect(selected).toBe('record-1')
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.useRealTimers()
  }
})
