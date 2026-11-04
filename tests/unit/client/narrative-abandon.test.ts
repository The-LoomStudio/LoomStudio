// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { settle, hooks, primaryFixture } from '../../support/client/narrative-runtime.js'
import type { NarrativeSwipeView } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import { RunRecoveryControls } from '../../../apps/studio-client/src/features/narrative-runtime/ui/run-recovery-controls.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

function swipe(suspended = false): NarrativeSwipeView {
  return {
    id: 'group', timelineId: 'timeline', branchId: 'branch', revision: suspended ? 5 : 6,
    inputNodeId: 'input', sourceAgentSessionId: 'timeline', activeCandidateId: suspended ? 'candidate' : undefined,
    active: false, suspended, canSelect: false, canGenerate: !suspended,
    candidates: [{ id: 'candidate', preview: '', status: suspended ? 'suspended' : 'failed' }],
  }
}

async function suspendedFixture() {
  const f = await primaryFixture()
  const getSwipes = vi.fn(async () => ({ swipe: swipe() }))
  f.input.api.narratives.getSwipes = getSwipes
  f.render()
  const dispose = f.unmount
  hooks.narrativeConnected()
  await f.loadRoot()
  getSwipes.mockResolvedValue({ swipe: swipe(true) })
  f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 1, done: true, state: 'suspended' })
  await settle(() => f.render().generateSwipe('retry'))
  await f.loadRoot()
  const state = vi.fn(async () => ({ runId: 'run', state: 'suspended' as const }))
  const abandon = vi.fn<StudioApi['agentSessions']['abandonRun']>(async () => ({ runId: 'run', accepted: true, state: 'suspended' as const }))
  f.input.api.agentSessions.runState = state
  f.input.api.agentSessions.abandonRun = abandon
  return { ...f, getSwipes, state, abandon, dispose }
}

describe('Explicit suspended attempt abandonment', () => {
  it('abandons through the authoritative API, refreshes Swipe before the page, and waits for manual retry', async () => {
    const f = await suspendedFixture()
    const order: string[] = []
    f.state.mockImplementation(async () => { order.push('state'); return { runId: 'run', state: 'suspended' } })
    f.abandon.mockImplementation(async () => { order.push('abandon'); return { runId: 'run', accepted: true, state: 'suspended' } })
    f.getSwipes.mockImplementation(async () => { order.push('swipe'); return { swipe: swipe() } })
    f.getPage.mockImplementation(async () => { order.push('page'); return f.result.narrative })
    f.render().setAgentInput('Agent draft')
    await settle(() => f.render().abandonRootRun())
    expect(order).toEqual(['abandon', 'swipe', 'page'])
    expect(f.state).not.toHaveBeenCalled()
    expect(f.abandon).toHaveBeenCalledExactlyOnceWith('run', 'timeline')
    expect(f.render().rootActiveRun).toBeUndefined()
    expect(f.render().rootRecovery).toBeUndefined()
    expect(f.render().swipe?.canGenerate).toBe(true)
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.render().agentComposerInput).toBe('Agent draft')
    expect(f.render().primarySession?.id).toBe('timeline')
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.appendInput).not.toHaveBeenCalled()
    await settle(() => f.render().generateSwipe('retry'))
    expect(f.createRun).toHaveBeenCalledTimes(2)
    expect(f.appendInput).not.toHaveBeenCalled()
    f.dispose?.()
  })

  it('retains the attempt when the authoritative API rejects an executor that is still running', async () => {
    const f = await suspendedFixture()
    f.abandon.mockResolvedValueOnce({ runId: 'run', accepted: false, state: 'running' })
    await settle(() => f.render().abandonRootRun())
    expect(f.abandon).toHaveBeenCalledExactlyOnceWith('run', 'timeline')
    expect(f.state).not.toHaveBeenCalled()
    expect(f.render().rootActiveRun?.status).toBe('suspended')
    expect(f.render().rootRecovery?.status).toBe('suspended')
    expect(f.render().rootRecovery?.error).toBe('故事执行未能放弃')
    expect(f.render().swipe?.suspended).toBe(true)
    await settle(() => f.render().generateSwipe('retry'))
    expect(f.createRun).toHaveBeenCalledOnce()
    f.dispose?.()
  })

  it('keeps the attempt and surfaces a rejected abandonment', async () => {
    const f = await suspendedFixture()
    f.abandon.mockResolvedValueOnce({ runId: 'run', accepted: false, state: 'suspended' })
    await settle(() => f.render().abandonRootRun())
    expect(f.render().rootActiveRun?.status).toBe('suspended')
    expect(f.render().rootRecovery?.error).toBe('故事执行未能放弃')
    expect(f.render().runRecoveryBusy).toBe(false)
    expect(f.reportFailure).toHaveBeenCalledOnce()
    f.dispose?.()
  })

  it('exposes refresh recovery when abandonment succeeds but refreshing fails', async () => {
    const f = await suspendedFixture()
    f.getSwipes.mockResolvedValue({ swipe: swipe() })
    f.getPage.mockRejectedValueOnce(new Error('Refresh offline'))
    await settle(() => f.render().abandonRootRun())
    expect(f.render().rootActiveRun).toBeUndefined()
    expect(f.render().rootRecovery).toMatchObject({ status: 'refresh-failed', refreshFailed: true, error: 'Refresh offline' })
    f.getSwipes.mockResolvedValue({ swipe: swipe() })
    await settle(() => f.render().reconnectRootRun())
    expect(f.abandon).toHaveBeenCalledOnce()
    expect(f.render().swipe?.suspended).toBe(false)
    expect(f.render().rootRecovery?.refreshFailed).not.toBe(true)
    f.dispose?.()
  })

  it('can abandon a suspended attempt restored from the transcript without an observed Run', async () => {
    const f = await primaryFixture()
    f.rootGetTranscript.mockResolvedValueOnce({ session: f.rootSession, entries: [{
      id: 'suspension', agentSessionId: 'timeline', runId: 'restored-run', sequence: 1, createdAt: '',
      entry: { kind: 'run-state', state: 'suspended' },
    }] })
    f.input.api.agentSessions.runState = vi.fn(async () => ({ runId: 'restored-run', state: 'suspended' as const }))
    await settle(() => f.render().refreshTaskSession('timeline'))
    expect(f.render().rootRecovery).toMatchObject({ target: 'narrative', status: 'suspended' })
    const abandon = vi.fn<StudioApi['agentSessions']['abandonRun']>(async () => ({ runId: 'restored-run', accepted: true, state: 'suspended' as const }))
    f.input.api.agentSessions.abandonRun = abandon
    await settle(() => f.render().abandonRootRun())
    expect(f.input.api.agentSessions.runState).toHaveBeenCalledExactlyOnceWith('restored-run', 'timeline')
    expect(abandon).toHaveBeenCalledExactlyOnceWith('restored-run', 'timeline')
    expect(f.render().rootActiveRun).toBeUndefined()
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.createRun).not.toHaveBeenCalled()
  })

  it('renders the explicit abandon control with its tooltip and disables it during recovery', () => {
    const markup = renderToStaticMarkup(createElement(RunRecoveryControls, {
      runRecovery: { target: 'narrative', status: 'suspended' }, runRecoveryBusy: true,
      canRestoreRunInput: false, restoreRunInput: vi.fn(), reconnectAgentRun: vi.fn(),
      abandonAgentRun: vi.fn(), t: createTranslator('en-US'),
    }))
    expect(markup).toContain('title="Abandon this attempt"')
    expect(markup).toContain('aria-label="Abandon this attempt"')
    expect(markup).toContain('disabled=""')
  })
})
