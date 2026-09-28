import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrameRequestClient } from '../../../packages/extension-sdk/src/iframe-context.js'
import { serveFrameRequests } from '../../../apps/studio-client/src/shared/iframe-runtime/frame-channel.js'
import { createRendererNotifications } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/renderer-notifications.js'

afterEach(() => vi.useRealTimers())

describe('Iframe capability channel', () => {
  it('routes replies on private ports and rejects pending requests on disposal', async () => {
    const a = new MessageChannel()
    const b = new MessageChannel()
    const slow = Promise.withResolvers<unknown>()
    const hostA = serveFrameRequests(a.port1, { handle: async () => slow.promise, onInvalidMessage: vi.fn() })
    const hostB = serveFrameRequests(b.port1, { handle: async () => 'B', onInvalidMessage: vi.fn() })
    const clientA = createFrameRequestClient(a.port2)
    const clientB = createFrameRequestClient(b.port2)
    try {
      const pending = clientA.request('test', {})
      const rejected = expect(pending).rejects.toMatchObject({ code: 'ctx.disposed' })
      await expect(clientB.request('test', {})).resolves.toBe('B')
      clientA.dispose()
      await rejected
      slow.resolve('late')
    } finally {
      clientA.dispose(); clientB.dispose(); hostA.dispose(); hostB.dispose()
      a.port1.close(); a.port2.close(); b.port1.close(); b.port2.close()
    }
  })

  it('bounds host waits and does not publish late results', async () => {
    vi.useFakeTimers()
    const channel = new MessageChannel()
    const slow = Promise.withResolvers<unknown>()
    const send = vi.spyOn(channel.port1, 'postMessage')
    const handle = vi.fn(async () => slow.promise)
    const host = serveFrameRequests(channel.port1, { handle, onInvalidMessage: vi.fn() })
    try {
      channel.port1.dispatchEvent(new MessageEvent('message', { data: { type: 'loom:ctx.request', requestId: 'slow', method: 'test' } }))
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: { ok: false, error: expect.objectContaining({ code: 'ctx.timeout' }) } }))
      slow.resolve('too late')
      await Promise.resolve()
      await Promise.resolve()
      expect(send).toHaveBeenCalledOnce()
    } finally { host.dispose(); channel.port1.close(); channel.port2.close() }
  })

  it('rejects malformed envelopes and cancels queued work when the host is disposed', async () => {
    const channel = new MessageChannel()
    const handle = vi.fn()
    const invalid = vi.fn()
    const host = serveFrameRequests(channel.port1, { handle, onInvalidMessage: invalid })
    channel.port1.dispatchEvent(new MessageEvent('message', { data: { type: 'loom:ctx.request', requestId: [], method: 'notifications.show' } }))
    channel.port1.dispatchEvent(new MessageEvent('message', { data: { type: 'loom:ctx.request', requestId: '1', method: 'notifications.show' } }))
    host.dispose()
    await Promise.resolve()
    expect(invalid).toHaveBeenCalledOnce()
    expect(handle).not.toHaveBeenCalled()
    channel.port1.close(); channel.port2.close()
  })
})

describe('Renderer notification budget', () => {
  it('shares limits across an owner, isolates other owners and validates plain-text fields', () => {
    vi.useFakeTimers()
    const sink = vi.fn()
    const notifications = createRendererNotifications(sink)
    for (let i = 0; i < 3; i++) notifications.show('extension:a', { message: 'Ready' })
    expect(() => notifications.show('extension:a', { message: 'Fourth' })).toThrow('rate limit')
    notifications.show('extension:b', { message: 'Other owner' })
    expect(() => notifications.show('extension:b', { message: 'Unsafe', html: '<b>test</b>' })).toThrow('Invalid')
    expect(() => notifications.show('extension:b', { message: 'Unsafe', level: ['info'] })).toThrow('Invalid')
    vi.advanceTimersByTime(10_000)
    notifications.show('extension:a', { message: 'Next window' })
    expect(sink).toHaveBeenCalledTimes(5)
  })
})
