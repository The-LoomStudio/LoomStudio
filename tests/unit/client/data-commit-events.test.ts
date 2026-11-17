import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeDataCommits } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'

class TestEventSource extends EventTarget {
  static OPEN = 1
  static CLOSED = 2
  static instances: TestEventSource[] = []
  readyState = 0
  closed = false
  constructor(readonly url: string) { super(); TestEventSource.instances.push(this) }
  emit(name: string, data = '') {
    if (name === 'open') this.readyState = 1
    this.dispatchEvent(new MessageEvent(name, { data }))
  }
  close() { this.closed = true; this.readyState = 2 }
}

afterEach(() => {
  vi.unstubAllGlobals()
  TestEventSource.instances = []
})

describe('data commit subscription', () => {
  it('uses the authenticated event stream, parses operation identities and refreshes on reconnect', () => {
    vi.stubGlobal('EventSource', TestEventSource)
    const onCommit = vi.fn()
    const onConnected = vi.fn()
    const unsubscribe = subscribeDataCommits(onCommit, onConnected)
    const stream = TestEventSource.instances[0]!
    expect(stream.url).toBe('/extensions/events')
    stream.emit('open')
    stream.emit('data.changed', JSON.stringify({ payload: { operations: [
      { entityType: 'narrative.branch', entityId: 'branch-1', store: 'narrative', kind: 'update',
        scope: { store: 'narrative', entityType: 'narrative.timeline', entityId: 'timeline-1' } },
      { entityType: 2, entityId: 'invalid' },
    ] } }))
    stream.emit('data.changed', '{')
    stream.emit('open')
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith([{ entityType: 'narrative.branch', entityId: 'branch-1', kind: 'update',
      scope: { store: 'narrative', entityType: 'narrative.timeline', entityId: 'timeline-1' } }])
    expect(onConnected).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(stream.closed).toBe(true)
  })
})

it('shares transport, synchronizes late subscribers and retires only the last subscription', async () => {
  vi.stubGlobal('EventSource', TestEventSource)
  const first = vi.fn()
  const second = vi.fn()
  const connected = vi.fn()
  const stopFirst = subscribeDataCommits(first, vi.fn())
  const stream = TestEventSource.instances[0]!
  stream.emit('open')
  const stopSecond = subscribeDataCommits(second, connected)
  await Promise.resolve()
  expect(connected).toHaveBeenCalledOnce()
  expect(TestEventSource.instances).toHaveLength(1)
  stopFirst()
  stopFirst()
  expect(stream.closed).toBe(false)
  stream.emit('data.changed', JSON.stringify({ payload: { operations: [{ entityType: 'agent.session', entityId: 'a' }] } }))
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
  stream.emit('open')
  expect(connected).toHaveBeenCalledTimes(2)
  stopSecond()
  expect(stream.closed).toBe(true)
  const late = vi.fn()
  const stop = subscribeDataCommits(vi.fn(), late)
  expect(TestEventSource.instances).toHaveLength(2)
  TestEventSource.instances[1]!.emit('open')
  late.mockClear()
  const stopBeforeSync = subscribeDataCommits(vi.fn(), late)
  stopBeforeSync()
  await Promise.resolve()
  expect(late).not.toHaveBeenCalled()
  stop()
})

it('refreshes the session and restores one shared stream after a terminal EventSource failure', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', TestEventSource)
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const commit = vi.fn()
  const first = vi.fn()
  const second = vi.fn()
  const stopFirst = subscribeDataCommits(commit, first)
  const stopSecond = subscribeDataCommits(vi.fn(), second)
  try {
    const old = TestEventSource.instances[0]!
    old.emit('open')
    old.readyState = 0
    old.emit('error')
    await vi.advanceTimersByTimeAsync(6000)
    expect(fetch).not.toHaveBeenCalled()
    old.close()
    old.emit('error')
    old.emit('error')
    await vi.advanceTimersByTimeAsync(1500)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(TestEventSource.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith('/auth/session', { method: 'POST', credentials: 'same-origin' })
    expect(TestEventSource.instances).toHaveLength(2)
    const restored = TestEventSource.instances[1]!
    first.mockClear()
    second.mockClear()
    old.emit('open')
    expect(first).not.toHaveBeenCalled()
    restored.emit('open')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    restored.emit('data.changed', JSON.stringify({ payload: { operations: [{ entityType: 'agent.session', entityId: 'session' }] } }))
    expect(commit).toHaveBeenCalledOnce()
    restored.close()
    restored.emit('error')
    stopFirst()
    stopSecond()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally {
    stopFirst()
    stopSecond()
    vi.useRealTimers()
  }
})

it('delivers single-frame commits and triggers refresh on overflow without delivering empty commits', () => {
  vi.stubGlobal('EventSource', TestEventSource)
  const commit = vi.fn(), refresh = vi.fn()
  const stop = subscribeDataCommits(commit, refresh)
  const stream = TestEventSource.instances[0]!
  stream.emit('data.changed', JSON.stringify({ payload: {
    changesetId: 'a', operations: [{ entityType: 'test', entityId: 'a-0' }, { entityType: 'test', entityId: 'a-1' }],
  } }))
  expect(commit.mock.calls.map(call => call[0].map((op: { entityId: string }) => op.entityId))).toEqual([['a-0', 'a-1']])
  stream.emit('data.changed', JSON.stringify({ payload: {
    changesetId: 'overflow-1', overflow: true, operations: [],
  } }))
  expect(refresh).toHaveBeenCalledOnce()
  expect(commit).toHaveBeenCalledOnce()
  stream.emit('data.changed', JSON.stringify({ payload: {
    changesetId: 'empty', overflow: false, operations: [],
  } }))
  expect(refresh).toHaveBeenCalledOnce()
  expect(commit).toHaveBeenCalledTimes(2)
  expect(commit).toHaveBeenLastCalledWith([])
  stop()
})

it('ignores overflow after unsubscribe and skips malformed payloads cleanly', () => {
  vi.stubGlobal('EventSource', TestEventSource)
  const commit = vi.fn(), refresh = vi.fn()
  const stop = subscribeDataCommits(commit, refresh)
  const stream = TestEventSource.instances[0]!
  stream.emit('data.changed', JSON.stringify({ payload: null }))
  stream.emit('data.changed', JSON.stringify({ payload: { operations: 'bad' } }))
  expect(commit).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  stop()
  stream.emit('data.changed', JSON.stringify({ payload: { overflow: true, operations: [] } }))
  stream.emit('data.changed', JSON.stringify({ payload: { operations: [{ entityType: 'test', entityId: 'late' }] } }))
  expect(refresh).not.toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()
})
