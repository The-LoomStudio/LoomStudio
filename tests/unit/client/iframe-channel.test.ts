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

  it('retains timed-out work capacity and request IDs until actual settlement', async () => {
    vi.useFakeTimers()
    const channel = new MessageChannel()
    const work = Array.from({ length: 33 }, () => Promise.withResolvers<unknown>())
    const send = vi.spyOn(channel.port1, 'postMessage')
    const invalid = vi.fn()
    const handle = vi.fn((_method: string, params: unknown) => work[params as number]!.promise)
    const host = serveFrameRequests(channel.port1, { handle, onInvalidMessage: invalid })
    const request = (requestId: string, index: number) => channel.port1.dispatchEvent(new MessageEvent('message', {
      data: { type: 'loom:ctx.request', requestId, method: 'test', params: index },
    }))
    const expectBusy = () => expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      result: { ok: false, error: expect.objectContaining({ code: 'ctx.busy' }) },
    }))
    try {
      for (let index = 0; index < 32; index++) request(String(index), index)
      await vi.advanceTimersByTimeAsync(0)
      expect(handle).toHaveBeenCalledTimes(32)
      request('overflow', 32)
      expectBusy()
      request('0', 32)
      expect(invalid).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(send.mock.calls.filter(([message]) => message.result.error?.code === 'ctx.timeout')).toHaveLength(32)
      expect(vi.getTimerCount()).toBe(0)
      request('after-timeout', 32)
      expectBusy()
      request('0', 32)
      expect(invalid).toHaveBeenCalledTimes(2)
      expect(handle).toHaveBeenCalledTimes(32)

      const repliesAfterTimeout = send.mock.calls.length
      work[0]!.resolve('late')
      await vi.advanceTimersByTimeAsync(0)
      expect(send).toHaveBeenCalledTimes(repliesAfterTimeout)
      request('0', 32)
      await vi.advanceTimersByTimeAsync(0)
      expect(handle).toHaveBeenCalledTimes(33)
      request('still-full', 32)
      expectBusy()
      request('0', 32)
      expect(invalid).toHaveBeenCalledTimes(3)
      work[32]!.resolve('fresh')
      await vi.advanceTimersByTimeAsync(0)
      expect(send.mock.calls.filter(([message]) => message.requestId === '0').map(([message]) => message.result)).toEqual([
        { ok: false, error: { code: 'ctx.timeout', message: 'Host request timed out' } },
        { ok: true, value: 'fresh' },
      ])
      const repliesAfterReuse = send.mock.calls.length
      work[1]!.reject(new Error('late failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(send).toHaveBeenCalledTimes(repliesAfterReuse)
    } finally {
      host.dispose()
      for (const operation of work) operation.resolve('cleanup')
      await vi.advanceTimersByTimeAsync(0)
      channel.port1.close(); channel.port2.close()
    }
  })

  it('disposes timers and listeners without replying to already running work', async () => {
    vi.useFakeTimers()
    const channel = new MessageChannel()
    const work = [Promise.withResolvers<unknown>(), Promise.withResolvers<unknown>()]
    const send = vi.spyOn(channel.port1, 'postMessage')
    const removeListener = vi.spyOn(channel.port1, 'removeEventListener')
    const handle = vi.fn((_method: string, params: unknown) => work[params as number]!.promise)
    const host = serveFrameRequests(channel.port1, { handle, onInvalidMessage: vi.fn() })
    const request = (index: number) => channel.port1.dispatchEvent(new MessageEvent('message', {
      data: { type: 'loom:ctx.request', requestId: String(index), method: 'test', params: index },
    }))
    try {
      request(0); request(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(handle).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(2)
      host.dispose(); host.dispose()
      expect(removeListener).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
      work[0]!.resolve('late success')
      work[1]!.reject(new Error('late failure'))
      await vi.advanceTimersByTimeAsync(10_000)
      request(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(handle).toHaveBeenCalledTimes(2)
      expect(send).not.toHaveBeenCalled()
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
