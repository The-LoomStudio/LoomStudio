// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useDashboard } from '../../../apps/studio-client/src/features/dashboard/model/use-dashboard.js'
import { StudioDashboard } from '../../../apps/studio-client/src/app/studio-dashboard.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

let root: ReturnType<typeof createRoot> | undefined
let client: QueryClient | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  client?.clear()
  document.body.replaceChildren()
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-11-04T01:00:00Z')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const dashboard = {
    usage: vi.fn(async (_range: Parameters<StudioApi['dashboard']['usage']>[0]) => ({
      totals: { unreported: 0, reported: 1, totalReported: 1 }, days: [],
      providers: [{ id: 'provider', name: 'Provider', modelId: 'model', input: 1, output: 1, total: 2,
        inputReported: 1, outputReported: 1, totalReported: 1, requests: 1, unreported: 0 }],
    })),
    play: vi.fn(async () => ({ rows: [] })), resources: vi.fn(async () => ({ items: [] })),
    storage: vi.fn(async () => ({ groups: [], volumes: [], errors: [], asOf: '2026-11-04T01:00:00Z' })),
    database: vi.fn(async () => ({ tables: [], freeBytes: 0 })),
    usageRequests: vi.fn(async () => ({ items: [], nextCursor: undefined })),
  }
  const api = { dashboard } as unknown as StudioApi
  const render = async (element: ReturnType<typeof createElement>) => {
    await act(async () => root!.render(createElement(QueryClientProvider, { client: client! }, element)))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  return { api, dashboard, render }
}

it('retains closed range keys, then captures current time for reopening, period changes and refresh', async () => {
  const { api, dashboard, render } = setup()
  let value!: ReturnType<typeof useDashboard>
  function Harness(props: { open: boolean; endpoint: string }) {
    value = useDashboard(api, props.endpoint, props.open)
    return null
  }
  const show = (open: boolean, endpoint = 'one') => render(createElement(Harness, { open, endpoint }))
  await show(true)
  const openedRange = value.range
  const openedQueries = client!.getQueryCache().getAll().map(query => query.queryHash)
  expect(dashboard.usage).toHaveBeenCalledTimes(1)
  vi.setSystemTime('2026-11-04T02:00:00Z')
  await show(false)
  expect(value.range).toBe(openedRange)
  expect(client!.getQueryCache().getAll().map(query => query.queryHash)).toEqual(openedQueries)
  await act(async () => { value.refresh(); value.setPeriod('7') })
  expect(value.range).toBe(openedRange)
  expect(client!.getQueryCache().getAll().map(query => query.queryHash)).toEqual(openedQueries)
  expect(dashboard.usage).toHaveBeenCalledTimes(1)
  expect(dashboard.play).toHaveBeenCalledTimes(1)

  vi.setSystemTime('2026-11-04T03:00:00Z')
  await show(true)
  expect(dashboard.usage).toHaveBeenCalledTimes(2)
  expect(dashboard.usage.mock.calls[1]![0].to).toBe('2026-11-04T03:00:00.000Z')
  expect(value.period).toBe('7')
  expect(dashboard.resources).toHaveBeenCalledTimes(2)

  vi.setSystemTime('2026-11-04T04:00:00Z')
  await act(async () => value.setPeriod('all'))
  expect(dashboard.usage).toHaveBeenCalledTimes(3)
  expect(dashboard.usage.mock.calls[2]![0]).toMatchObject({ to: '2026-11-04T04:00:00.000Z' })
  expect(dashboard.usage.mock.calls[2]![0]).not.toHaveProperty('from')
  await act(async () => value.setPeriod('all'))
  expect(dashboard.usage).toHaveBeenCalledTimes(3)

  vi.setSystemTime('2026-11-04T05:00:00Z')
  await act(async () => value.refresh())
  expect(dashboard.usage).toHaveBeenCalledTimes(4)
  expect(dashboard.usage.mock.calls[3]![0].to).toBe('2026-11-04T05:00:00.000Z')
  expect(dashboard.resources).toHaveBeenCalledTimes(3)
  const firstEndpointData = client!.getQueryCache().findAll({ queryKey: ['dashboard', 'one', 'usage'] }).map(query => query.state.data)
  await show(true, 'two')
  expect(dashboard.usage).toHaveBeenCalledTimes(5)
  expect(client!.getQueryCache().findAll({ queryKey: ['dashboard', 'one', 'usage'] }).map(query => query.state.data)).toEqual(firstEndpointData)
  expect(client!.getQueryCache().findAll({ queryKey: ['dashboard', 'two', 'usage'] })).toHaveLength(1)
})

it('creates calls queries only after choosing a provider and keeps their cached data on return', async () => {
  const { api, dashboard, render } = setup()
  const show = (open: boolean) => render(createElement(StudioDashboard, { api, endpoint: 'one', open, onClose: vi.fn(), onAction: vi.fn() }))
  await show(true)
  const calls = () => client!.getQueryCache().findAll({ queryKey: ['dashboard', 'one', 'calls'] })
  expect(calls()).toHaveLength(0)
  vi.setSystemTime('2026-11-04T02:00:00Z')
  const keys = client!.getQueryCache().getAll().map(query => query.queryHash)
  await show(false)
  expect(client!.getQueryCache().getAll().map(query => query.queryHash)).toEqual(keys)
  await show(true)
  expect(calls()).toHaveLength(0)
  const period = document.querySelector<HTMLSelectElement>('[aria-label="统计时间范围"]')!
  await act(async () => { period.value = '7'; period.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(calls()).toHaveLength(0)
  expect(dashboard.usageRequests).not.toHaveBeenCalled()

  const provider = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Provider') && button.textContent.includes('model'))!
  await act(async () => provider.click())
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('查看调用记录'))!.click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(dashboard.usageRequests).toHaveBeenCalledTimes(1)
  expect(calls()).toHaveLength(1)
  const cached = calls()[0]!.state.data
  const selectedKeys = client!.getQueryCache().getAll().map(query => query.queryHash)
  vi.setSystemTime('2026-11-04T02:30:00Z')
  await show(false)
  expect(client!.getQueryCache().getAll().map(query => query.queryHash)).toEqual(selectedKeys)
  expect(dashboard.usageRequests).toHaveBeenCalledTimes(1)
  vi.setSystemTime('2026-11-04T02:45:00Z')
  await show(true)
  expect(calls()).toHaveLength(2)
  expect(dashboard.usageRequests).toHaveBeenCalledTimes(2)
  expect(calls()[0]!.state.data).toBe(cached)
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('返回用量明细'))!.click())
  expect(calls()).toHaveLength(2)
  expect(calls()[0]!.state.data).toBe(cached)
  vi.setSystemTime('2026-11-04T03:00:00Z')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="刷新统计"]')!.click())
  expect(calls()).toHaveLength(2)
  expect(dashboard.usageRequests).toHaveBeenCalledTimes(2)
})
