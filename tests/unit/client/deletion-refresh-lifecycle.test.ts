// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settle, fixture, hooks } from '../../support/client/narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { DataOperation } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { notify } from '../../../apps/studio-client/src/shared/notifications/index.js'

const deleted: DataOperation[] = [
  { entityType: 'narrative.timeline', entityId: 'timeline', kind: 'delete' },
  { entityType: 'narrative.branch', entityId: 'branch', kind: 'delete' },
]
async function watchingTimeline() {
  const f = await fixture()
  await settle(() => f.render().createTimelineFromCard())
  f.render()
  const cleanup = f.unmount
  await Promise.resolve()
  await Promise.resolve()
  vi.mocked(f.input.api.narratives.getSwipes).mockClear()
  f.getPage.mockClear()
  return { ...f, cleanup: () => { if (typeof cleanup === 'function') cleanup() } }
}
afterEach(() => vi.restoreAllMocks())

describe('Deletion refresh lifecycle', () => {
  it('does not read a removed branch on its deletion event or a queued reconnect', async () => {
    const f = await watchingTimeline()
    hooks.onCommit?.(deleted)
    hooks.narrativeConnected?.()
    expect(f.getPage).not.toHaveBeenCalled()
    expect(f.input.api.narratives.getSwipes).not.toHaveBeenCalled()
    expect(f.reportFailure).not.toHaveBeenCalled()
    f.cleanup()
  })

  it('discards in-flight page and swipe errors invalidated by deletion', async () => {
    const f = await watchingTimeline()
    const page = Promise.withResolvers<Awaited<ReturnType<StudioApi['narratives']['getPage']>>>()
    const swipes = Promise.withResolvers<Awaited<ReturnType<StudioApi['narratives']['getSwipes']>>>()
    f.getPage.mockReturnValueOnce(page.promise)
    vi.mocked(f.input.api.narratives.getSwipes).mockReturnValueOnce(swipes.promise)
    hooks.narrativeConnected?.()
    hooks.onCommit?.(deleted)
    page.reject(new Error('Narrative branch not found: branch'))
    swipes.reject(new Error('Narrative branch not found: branch'))
    await Promise.allSettled([page.promise, swipes.promise])
    await Promise.resolve()
    expect(f.reportFailure).not.toHaveBeenCalled()
    f.cleanup()
  })

  it('still reports a live branch read failure', async () => {
    const f = await watchingTimeline()
    const failure = new Error('Connection refused')
    f.getPage.mockRejectedValueOnce(failure)
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.reportFailure).toHaveBeenCalledWith(failure))
    f.cleanup()
  })

  it('reports successful deletion when its commit arrives before the RPC response', async () => {
    const success = vi.spyOn(notify, 'success').mockImplementation(() => '')
    const f = await watchingTimeline()
    f.input.t = createTranslator('zh-CN')
    f.input.api.narratives.delete = vi.fn(async () => {
      hooks.onCommit?.(deleted)
      return { deleted: true as const, mutation: { changesetId: 'delete' } }
    })
    expect(await settle(() => f.render().deleteTimeline('timeline'))).toBe(true)
    expect(f.render().timeline).toBeUndefined()
    expect(f.getPage).not.toHaveBeenCalled()
    expect(f.reportFailure).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith(f.input.t('notify.success.deleted'))
    f.cleanup()
  })

  it('keeps the current story and reports an actual delete failure', async () => {
    const success = vi.spyOn(notify, 'success').mockImplementation(() => '')
    const f = await watchingTimeline()
    f.input.t = createTranslator('zh-CN')
    const failure = new Error('Permission denied')
    f.input.api.narratives.delete = vi.fn().mockRejectedValue(failure)
    expect(await settle(() => f.render().deleteTimeline('timeline'))).toBe(false)
    expect(f.render().timeline?.id).toBe('timeline')
    expect(f.reportFailure).toHaveBeenCalledWith(failure)
    expect(success).not.toHaveBeenCalled()
    f.cleanup()
  })

  it('discards a pending Session update read superseded by its deletion', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = await fixture()
    await settle(() => f.render().createTimelineFromCard())
    await settle(() => f.render().createAgentSession('profile', true))
    f.render()
    const read = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['get']>>>()
    f.input.api.agentSessions.get = vi.fn(() => read.promise)
    f.input.api.agentSessions.list = vi.fn(async () => ({ sessions: [] }))
    const cleanup = f.unmount
    const operation = (kind: string): DataOperation[] => [{ entityType: 'agent.session', entityId: 'session', kind,
      scope: { store: 'agents', entityType: 'narrative.timeline', entityId: 'timeline' } }]
    hooks.onCommit(operation('update'))
    hooks.onCommit(operation('delete'))
    read.reject(new Error('Session not found'))
    await Promise.allSettled([read.promise])
    await Promise.resolve()
    expect(f.reportFailure).not.toHaveBeenCalled()
    if (typeof cleanup === 'function') cleanup()
  })
})
