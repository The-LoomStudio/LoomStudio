import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeDataCommits } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'

class TestEventSource extends EventTarget {
  static OPEN = 1
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

it('reassembles interleaved commits and refreshes instead of delivering incomplete batches', () => {
  vi.stubGlobal('EventSource', TestEventSource)
  const commit = vi.fn(), refresh = vi.fn()
  const stop = subscribeDataCommits(commit, refresh)
  const stream = TestEventSource.instances[0]!
  const send = (id: string, index: number, count = 2) => stream.emit('data.changed', JSON.stringify({ payload: {
    changesetId: id, chunk: { index, count }, operations: [{ entityType: 'test', entityId: `${id}-${index}` }],
  } }))
  send('a', 0); send('b', 0); send('a', 1); send('b', 1)
  expect(commit.mock.calls.map(call => call[0].map((op: { entityId: string }) => op.entityId))).toEqual([['a-0', 'a-1'], ['b-0', 'b-1']])
  send('late', 1)
  expect(refresh).toHaveBeenCalledOnce()
  send('gap', 0, 3); send('gap', 2, 3)
  expect(refresh).toHaveBeenCalledTimes(2)
  send('duplicate', 0); send('duplicate', 0)
  expect(refresh).toHaveBeenCalledTimes(3)
  send('disconnect', 0); stream.emit('error')
  expect(refresh).toHaveBeenCalledTimes(4)
  send('ok', 0); send('ok', 1)
  expect(commit).toHaveBeenCalledTimes(3)
  stop()
})

it('bounds pending bytes and expires missing tails without reading on unmount', () => {
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', TestEventSource)
  const commit = vi.fn(), refresh = vi.fn()
  const stop = subscribeDataCommits(commit, refresh)
  const stream = TestEventSource.instances[0]!
  const send = (id: string, index: number, entityId = id) => stream.emit('data.changed', JSON.stringify({ payload: {
    changesetId: id, chunk: { index, count: 2 }, operations: [{ entityType: 'test', entityId }],
  } }))
  send('large', 0, 'x'.repeat(4 * 1024 * 1024)); send('large', 1)
  expect(refresh).toHaveBeenCalledOnce()
  send('missing', 0)
  vi.advanceTimersByTime(10_000)
  expect(refresh).toHaveBeenCalledTimes(2)
  send('unmount', 0); stop()
  vi.advanceTimersByTime(10_000)
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(commit).not.toHaveBeenCalled()
  vi.useRealTimers()
})
