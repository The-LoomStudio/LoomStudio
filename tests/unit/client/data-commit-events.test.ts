import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeDataCommits } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'

class TestEventSource {
  static instances: TestEventSource[] = []
  listeners = new Map<string, (event: MessageEvent) => void>()
  closed = false
  constructor(readonly url: string) { TestEventSource.instances.push(this) }
  addEventListener(name: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(name, listener as (event: MessageEvent) => void)
  }
  emit(name: string, data = '') {
    this.listeners.get(name)?.({ data } as MessageEvent)
  }
  close() { this.closed = true }
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
