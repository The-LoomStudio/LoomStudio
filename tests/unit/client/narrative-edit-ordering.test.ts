import { describe, expect, it, vi } from 'vitest'
import { fixture, hooks } from '../../support/client/narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

describe('Narrative edit and read ordering', () => {

  it.each(['older', 'terminal'] as const)('rejects a %s page crossing a successful local edit', async readKind => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    const original = { id: 'original', kind: 'narrative' as const, floor: 1, timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
      body: { format: 'loom-markdown.v1' as const, raw: 'Original' }, createdAt: '' }
    const page = { ...f.result.narrative, branch: { ...f.result.narrative.branch, headNodeId: original.id }, nodes: [original] }
    f.createTimeline.mockResolvedValue(page)
    await f.render().createTimelineFromCard()
    await f.loadRoot()
    await f.render().createAgentSession('profile', true)
    if (readKind === 'older') {
      f.getPage.mockResolvedValueOnce({ ...page, nextCursor: 'older' })
      f.render()
      hooks.commitEffect?.()
      hooks.narrativeConnected?.()
      await vi.waitFor(() => expect(f.render().olderCursor).toBe('older'))
    }
    const readStarted = Promise.withResolvers<void>()
    const readResult = Promise.withResolvers<Awaited<ReturnType<StudioApi['narratives']['getPage']>>>()
    f.getPage.mockImplementationOnce(() => { readStarted.resolve(); return readResult.promise })
    const pending = readKind === 'older' ? f.render().loadOlderNodes() : f.render().submitTurn(f.event)
    await readStarted.promise
    const target = f.render().nodes.at(-1)!
    const edited = { ...target, stateRevisionId: 'state', workspaceRevisionId: 'workspace', id: 'edited', body: { ...target.body, raw: 'Edited' } }
    f.input.api.narratives.editNode = async () => ({
      timeline: page.timeline, branch: { ...page.branch, headNodeId: edited.id },
      replacements: [{ previousNodeId: target.id, node: edited }], mutation: { changesetId: 'edit' },
    })
    await f.render().editNarrativeNode(target.id, 'Edited')
    readResult.resolve({ ...page, nodes: [{ ...original, id: 'stale' }] })
    await pending
    expect(f.render().nodes.at(-1)?.body.raw).toBe('Edited')
    expect(f.render().branch?.headNodeId).toBe(edited.id)
    expect(f.render().nodes.some(item => item.id === 'stale')).toBe(false)
    if (readKind === 'older') expect(f.render().olderCursor).toBe('older')
    expect(f.reportFailure).not.toHaveBeenCalled()
  })

  it('allows an authoritative pending read to publish after an edit conflict', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    const original = { id: 'original', kind: 'narrative' as const, floor: 1, timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
      body: { format: 'loom-markdown.v1' as const, raw: 'Original' }, createdAt: '' }
    const page = { ...f.result.narrative, branch: { ...f.result.narrative.branch, headNodeId: original.id }, nodes: [original] }
    f.createTimeline.mockResolvedValue(page)
    await f.render().createTimelineFromCard()
    await f.loadRoot()
    await f.render().createAgentSession('profile', true)
    const readResult = Promise.withResolvers<Awaited<ReturnType<StudioApi['narratives']['getPage']>>>()
    f.getPage.mockReturnValueOnce(readResult.promise)
    f.input.api.narratives.editNode = async () => { throw new Error('Head conflict') }
    f.render()
    const dispose = hooks.commitEffect?.()
    hooks.narrativeConnected?.()
    await expect(f.render().editNarrativeNode(original.id, 'Unsaved')).rejects.toThrow('Head conflict')
    const external = { ...original, id: 'external', body: { ...original.body, raw: 'External' } }
    readResult.resolve({ ...page, branch: { ...page.branch, headNodeId: external.id }, nodes: [external] })
    await vi.waitFor(() => expect(f.render().nodes[0]?.body.raw).toBe('External'))
    expect(f.render().branch?.headNodeId).toBe(external.id)
    dispose?.()
  })
})
