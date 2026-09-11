import { describe, expect, it, vi } from 'vitest'
import { resolveLoomSandboxCapability } from '../../../apps/studio-client/src/features/loom-scripts/runtime/sandbox-renderer-protocol.js'

describe('Loom Sandbox Renderer protocol', () => {
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
