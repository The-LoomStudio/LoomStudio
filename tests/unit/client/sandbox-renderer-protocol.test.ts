import { describe, expect, it, vi } from 'vitest'
import { resolveLoomSandboxCapability } from '../../../apps/studio-client/src/features/loom-scripts/runtime/sandbox-renderer-protocol.js'
import { serveFrameRequests } from '../../../apps/studio-client/src/shared/iframe-runtime/frame-channel.js'
import { createFrameRequestClient } from '../../../packages/extension-sdk/src/iframe-context.js'

describe('Loom Sandbox Renderer protocol', () => {
  it.each([null, [], {}, { capability: 'state.read' }, { capability: 'state.read', input: { target: { scope: 'timeline' } } }])('rejects malformed input without a host side effect: %j', async request => {
    const stateRead = vi.fn()
    await expect(resolveLoomSandboxCapability(request, ['state.read'], stateRead)).rejects.toMatchObject({ code: 'capability.invalid_request' })
    expect(stateRead).not.toHaveBeenCalled()
  })

  it('requires a notification grant and validates the payload before dispatch', async () => {
    const notify = vi.fn()
    const request = { capability: 'ui.notify', input: { message: 'Ready', level: 'success' } }
    await expect(resolveLoomSandboxCapability(request, [], vi.fn(), notify)).rejects.toMatchObject({ code: 'capability.denied' })
    await expect(resolveLoomSandboxCapability({ ...request, input: { message: 'Ready', html: '<b>unsafe</b>' } }, ['ui.notify'], vi.fn(), notify)).rejects.toMatchObject({ code: 'ctx.invalid_request' })
    expect(notify).not.toHaveBeenCalled()
    expect(await resolveLoomSandboxCapability(request, ['ui.notify'], vi.fn(), notify)).toBeNull()
    expect(notify).toHaveBeenCalledWith(request.input)
  })
  it('rejects state.read without a grant and does not call the API', async () => {
    const stateRead = vi.fn()
    await expect(resolveLoomSandboxCapability(
      { capability: 'state.read', input: { target: { scope: 'global' } } }, [], stateRead,
    )).rejects.toMatchObject({ code: 'capability.denied' })
    expect(stateRead).not.toHaveBeenCalled()
  })

  it('passes the requested target to the granted state API', async () => {
    const stateRead = vi.fn().mockResolvedValue({ revisionId: 'revision-1' })
    const target = { scope: 'timeline' as const, timelineId: 'timeline-1', branchId: 'branch-1' }
    await expect(resolveLoomSandboxCapability(
      { capability: 'state.read', input: { target } }, ['state.read'], stateRead,
    )).resolves.toEqual({ revisionId: 'revision-1' })
    expect(stateRead).toHaveBeenCalledWith(target)
  })

  it.each([
    { error: new Error('host failed'), code: 'capability.failed', message: 'host failed' },
    { error: Object.assign(new Error('scope denied'), { code: 'state.scope_denied' }), code: 'state.scope_denied', message: 'scope denied' },
    { error: 'host unavailable', code: 'capability.failed', message: 'host unavailable' },
  ])('encodes host errors once with their capability code: $code', async ({ error, code, message }) => {
    const channel = new MessageChannel()
    const send = vi.spyOn(channel.port1, 'postMessage')
    const host = serveFrameRequests(channel.port1, {
      handle: (_method, params) => resolveLoomSandboxCapability({ capability: 'state.read', input: params }, ['state.read'], async () => { throw error }),
      onInvalidMessage: vi.fn(),
    })
    const client = createFrameRequestClient(channel.port2)
    try {
      await expect(client.request('state.read', { target: { scope: 'global' } })).rejects.toMatchObject({ code, message })
      expect(send).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledWith({ type: 'loom:ctx.result', requestId: expect.any(String), result: { ok: false, error: { code, message } } })
    } finally {
      client.dispose()
      host.dispose()
      channel.port1.close()
      channel.port2.close()
    }
  })
})
