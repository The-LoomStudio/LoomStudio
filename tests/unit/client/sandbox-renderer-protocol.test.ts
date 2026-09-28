import { describe, expect, it, vi } from 'vitest'
import { resolveLoomSandboxCapability } from '../../../apps/studio-client/src/features/loom-scripts/runtime/sandbox-renderer-protocol.js'

describe('Loom Sandbox Renderer protocol', () => {
  it.each([null, [], {}, { capability: 'state.read' }, { capability: 'state.read', input: { target: { scope: 'timeline' } } }])('rejects malformed input without a host side effect: %j', async request => {
    const stateRead = vi.fn()
    const result = await resolveLoomSandboxCapability(request, ['state.read'], stateRead)
    expect(result).toMatchObject({ ok: false, error: { code: 'capability.invalid_request' } })
    expect(stateRead).not.toHaveBeenCalled()
  })

  it('requires a notification grant and validates the payload before dispatch', async () => {
    const notify = vi.fn()
    const request = { capability: 'ui.notify', input: { message: 'Ready', level: 'success' } }
    expect(await resolveLoomSandboxCapability(request, [], vi.fn(), notify)).toMatchObject({ ok: false })
    expect(await resolveLoomSandboxCapability({ ...request, input: { message: 'Ready', html: '<b>unsafe</b>' } }, ['ui.notify'], vi.fn(), notify)).toMatchObject({ ok: false })
    expect(notify).not.toHaveBeenCalled()
    expect(await resolveLoomSandboxCapability(request, ['ui.notify'], vi.fn(), notify)).toEqual({ ok: true, value: null })
    expect(notify).toHaveBeenCalledWith(request.input)
  })
  it('rejects state.read without a grant and does not call the API', async () => {
    const stateRead = vi.fn()
    await expect(resolveLoomSandboxCapability(
      { capability: 'state.read', input: { target: { scope: 'global' } } }, [], stateRead,
    )).resolves.toEqual({ ok: false, error: expect.objectContaining({ code: 'capability.denied' }) })
    expect(stateRead).not.toHaveBeenCalled()
  })

  it('passes the requested target to the granted state API', async () => {
    const stateRead = vi.fn().mockResolvedValue({ revisionId: 'revision-1' })
    const target = { scope: 'timeline' as const, timelineId: 'timeline-1', branchId: 'branch-1' }
    await expect(resolveLoomSandboxCapability(
      { capability: 'state.read', input: { target } }, ['state.read'], stateRead,
    )).resolves.toEqual({ ok: true, value: { revisionId: 'revision-1' } })
    expect(stateRead).toHaveBeenCalledWith(target)
  })
})
