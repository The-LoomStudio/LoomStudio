import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextAssets } from '../../../apps/studio-client/src/features/prompt-resources/model/use-context-assets.js'
import type { PromptResource, UpdatePromptResourceResult } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

function resource(version = 1, body = 'Saved'): PromptResource {
  return {
    id: 'resource', version, resourceKind: 'lore',
    rootNode: { id: 'root', kind: 'folder', label: 'Root', children: [{ id: 'entry', kind: 'entry', label: 'Entry', body }] },
    createdAt: '', updatedAt: '',
  }
}

function fixture(updateAsset = vi.fn()) {
  let upstream = [resource()]
  const updateAssets = vi.fn()
  const createAsset = vi.fn()
  const deleteAsset = vi.fn()
  const moveAsset = vi.fn()
  const get = vi.fn(async () => ({ resource: upstream[0]! }))
  const recordEdit = vi.fn()
  const onResourceChange = vi.fn((changed: PromptResource) => { upstream = [changed] })
  const render = () => {
    hooks.cursor = 0
    return useContextAssets({
      scope: '/rpc',
      resources: upstream, api: { promptResources: { get, updateAsset, updateAssets, createAsset, deleteAsset, moveAsset } } as unknown as StudioApi,
      onResourceChange,
      recordEdit, runAction: action => action(), t: createTranslator('en-US'),
    })
  }
  return {
    render, get, updateAsset, updateAssets, createAsset, deleteAsset, moveAsset, recordEdit, onResourceChange,
    refresh: (next: PromptResource[]) => {
      upstream = next
      render().setResources(next)
    },
  }
}

describe('Context Asset editing drafts', () => {
  it.each(['entry', 'folder', 'zone', 'copy'] as const)('submits only the %s node and publishes the authoritative response', async kind => {
    const state = fixture()
    let resolve!: (value: UpdatePromptResourceResult) => void
    state.createAsset.mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    const editor = state.render()
    const pending = kind === 'entry' ? editor.addContextAsset('root')
      : kind === 'folder' ? editor.addContextAssetFolder('root')
        : kind === 'zone' ? editor.addContextAssetInZone('resource', 'lore.lower')
          : editor.duplicateContextAsset('entry')
    await vi.waitFor(() => expect(state.createAsset).toHaveBeenCalledOnce())
    const request = state.createAsset.mock.calls[0]![0] as Parameters<StudioApi['promptResources']['createAsset']>[0]
    expect(request).toMatchObject({ resourceId: 'resource', targetAssetId: 'entry', position: kind === 'copy' ? 'after' : 'before' })
    expect(request.asset.id).not.toBe('entry')
    expect(request.asset.kind).toBe(kind === 'folder' ? 'folder' : 'entry')
    if (kind === 'zone') expect(request.asset.capabilities?.projection).toMatchObject({ zoneId: 'lore.lower', entryOrderHint: 100 })
    if (kind === 'copy') expect(request.asset).toMatchObject({ label: 'Entry Copy', body: 'Saved' })
    expect(state.onResourceChange).not.toHaveBeenCalled()
    expect(state.recordEdit).not.toHaveBeenCalled()
    expect(state.render().nodes[0]?.children?.map(node => node.id)).toEqual(['entry'])
    const saved = resource(2)
    saved.rootNode.children = [{ ...request.asset, meta: 'server response' }]
    resolve({ resource: saved, mutation: { changesetId: kind } })
    await expect(pending).resolves.toBe(request.asset.id)
    expect(state.render().nodes).toEqual([saved.rootNode])
    expect(state.onResourceChange).toHaveBeenCalledExactlyOnceWith(saved)
    expect(state.recordEdit).toHaveBeenCalledWith(expect.objectContaining({ changesetId: kind,
      anchor: { documentId: 'resource', subjectId: request.asset.id } }))
  })

  it.each(['message', 'history'] as const)('places a %s beside its containing Message', async kind => {
    const state = fixture()
    const initial = resource()
    initial.resourceKind = 'preset'
    initial.rootNode = { id: 'root', kind: 'module', category: 'preset', label: 'Preset', children: [
      { id: 'message', kind: 'message', label: 'System', children: [{ id: 'entry', kind: 'entry', label: 'Text' }] },
    ] }
    state.refresh([initial])
    state.createAsset.mockResolvedValue({ resource: { ...initial, version: 2 }, mutation: { changesetId: kind } })
    const pending = kind === 'message' ? state.render().addContextAssetMessageBlock('entry', 'assistant')
      : state.render().addContextAssetMessageSequence('entry')
    await pending
    expect(state.createAsset).toHaveBeenCalledWith(expect.objectContaining({ targetAssetId: 'message', position: 'after',
      asset: expect.objectContaining(kind === 'message' ? { kind: 'message', capabilities: { roleHint: 'assistant' } }
        : { kind: 'virtual', capabilities: { targetAnchorId: '@chat.session' } }) }))
  })

  it('returns the parent selection after deletion and publishes only the server tree', async () => {
    const state = fixture()
    const saved = resource(2)
    saved.rootNode.children = []
    state.deleteAsset.mockResolvedValue({ resource: saved, mutation: { changesetId: 'deleted' } })
    await expect(state.render().deleteContextAsset('entry', 'entry')).resolves.toBe('root')
    expect(state.deleteAsset).toHaveBeenCalledExactlyOnceWith({ resourceId: 'resource', assetId: 'entry' })
    expect(state.render().nodes).toEqual([saved.rootNode])
  })

  it.each(['add', 'copy', 'delete', 'move'] as const)('does not publish or record a failed structural %s', async kind => {
    const state = fixture()
    const initial = resource()
    initial.rootNode.children!.push({ id: 'target', kind: 'folder', label: 'Target', children: [] })
    state.refresh([initial])
    const failure = new Error('Write rejected')
    state.createAsset.mockRejectedValue(failure)
    state.deleteAsset.mockRejectedValue(failure)
    state.moveAsset.mockRejectedValue(failure)
    const editor = state.render()
    const pending = kind === 'add' ? editor.addContextAsset('root')
      : kind === 'copy' ? editor.duplicateContextAsset('entry')
        : kind === 'delete' ? editor.deleteContextAsset('entry', 'entry')
          : editor.moveContextAsset('entry', 'target', 'inside')
    await expect(pending).rejects.toBe(failure)
    expect(state.render().nodes).toEqual([initial.rootNode])
    expect(state.onResourceChange).not.toHaveBeenCalled()
    expect(state.recordEdit).not.toHaveBeenCalled()
    if (kind === 'move') expect(state.moveAsset).toHaveBeenCalledExactlyOnceWith({ resourceId: 'resource', assetId: 'entry', targetAssetId: 'target', position: 'inside' })
  })

  it('captures the version actually displayed even when the first input races a remote refresh', async () => {
    const state = fixture()
    const displayedEditor = state.render()
    state.refresh([resource(2, 'New remote text')])
    displayedEditor.previewContextAsset('entry', { body: 'Typed into the old view' })
    expect(state.render().resources[0]?.version).toBe(1)
    await expect(state.render().updateContextAsset('entry', { body: 'Typed into the old view' })).rejects.toThrow('changed elsewhere')
    expect(state.updateAsset).not.toHaveBeenCalled()
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Typed into the old view')
  })

  it('isolates same-ID drafts and queues by endpoint, including late replies and edit history', async () => {
    let finishA!: (result: UpdatePromptResourceResult) => void
    const apiA = { promptResources: { updateAsset: vi.fn(() => new Promise(resolve => { finishA = resolve })) } } as unknown as StudioApi
    const apiB = { promptResources: { updateAsset: vi.fn().mockResolvedValue({
      resource: resource(2, 'B saved'), mutation: { changesetId: 'B' },
    }) } } as unknown as StudioApi
    const recordEdit = vi.fn()
    const remote = new Map([['A', [resource(1, 'A saved')]], ['B', [resource(1, 'B initial')]]])
    const render = (scope: 'A' | 'B') => {
      hooks.cursor = 0
      return useContextAssets({
        scope, api: scope === 'A' ? apiA : apiB, resources: remote.get(scope)!,
        onResourceChange: changed => { remote.set(scope, [changed]) },
        recordEdit, runAction: action => action(), t: createTranslator('en-US'),
      })
    }
    const a = render('A')
    const pendingA = a.updateContextAsset('entry', { body: 'A submitted' })
    await vi.waitFor(() => expect(apiA.promptResources.updateAsset).toHaveBeenCalledTimes(1))
    a.previewContextAsset('entry', { body: 'A still typing' })
    const b = render('B')
    expect(b.nodes[0]?.children?.[0]?.body).toBe('B initial')
    expect(b.draftResourceIds).toEqual([])
    await b.updateContextAsset('entry', { body: 'B saved' })
    expect(apiB.promptResources.updateAsset).toHaveBeenCalledTimes(1)
    finishA({ resource: resource(2, 'A submitted'), mutation: { changesetId: 'A' } })
    await pendingA
    expect(render('B').nodes[0]?.children?.[0]?.body).toBe('B saved')
    expect(recordEdit).toHaveBeenCalledTimes(1)
    expect(recordEdit).toHaveBeenCalledWith(expect.objectContaining({ changesetId: 'B' }))
    expect(render('A').nodes[0]?.children?.[0]?.body).toBe('A still typing')
    expect(render('A').resources[0]?.version).toBe(2)
  })

  it('preserves the editing baseline and text across an Agent update, then stops stale autosave', async () => {
    const state = fixture()
    state.render().previewContextAsset('entry', { body: 'User draft' })
    state.refresh([resource(2, 'Agent saved')])
    expect(state.render().resources[0]?.version).toBe(1)
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('User draft')
    await expect(state.render().updateContextAsset('entry', { body: 'User draft' })).rejects.toThrow('changed elsewhere')
    await expect(state.render().updateContextAsset('entry', { body: 'Continued draft' })).rejects.toThrow('changed elsewhere')
    expect(state.updateAsset).not.toHaveBeenCalled()
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Continued draft')
    state.updateAssets.mockResolvedValue({ resource: resource(3, 'Continued draft'), mutation: { changesetId: 'reapply' } })
    await state.render().retryDraft('resource')
    expect(state.get).toHaveBeenCalledExactlyOnceWith('resource')
    expect(state.updateAssets).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 }))
    expect(state.render().resources[0]?.version).toBe(3)
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Continued draft')
  })

  it('reapplies only edited fields to the latest remote node and retains input typed during the read', async () => {
    const state = fixture()
    state.render().previewContextAsset('entry', { label: 'Local label' })
    let resolve!: (value: { resource: PromptResource }) => void
    state.get.mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    const saved = resource(3, 'Remote body')
    saved.rootNode.children![0]!.label = 'Local label'
    state.updateAssets.mockResolvedValue({ resource: saved, mutation: { changesetId: 'reapply' } })
    const pending = state.render().retryDraft('resource')
    await vi.waitFor(() => expect(state.get).toHaveBeenCalledOnce())
    state.render().previewContextAsset('entry', { label: 'Later input' })
    resolve({ resource: resource(2, 'Remote body') })
    await pending
    expect(state.updateAssets).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 2,
      updates: [expect.objectContaining({ label: 'Local label', body: 'Remote body' })],
    }))
    expect(state.render().nodes[0]?.children?.[0]?.label).toBe('Later input')
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Remote body')
    expect(state.render().draftResourceIds).toEqual(['resource'])
  })

  it('does not resurrect a remotely deleted node while reapplying its draft', async () => {
    const state = fixture()
    state.render().previewContextAsset('entry', { body: 'Kept draft' })
    const latest = resource(2)
    latest.rootNode.children = []
    state.get.mockResolvedValueOnce({ resource: latest })
    await expect(state.render().retryDraft('resource')).rejects.toThrow('Prompt asset not found: entry')
    expect(state.updateAssets).not.toHaveBeenCalled()
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Kept draft')
  })

  it('does not write a discarded draft after its latest-version read completes', async () => {
    const state = fixture()
    state.render().previewContextAsset('entry', { body: 'Discarded draft' })
    let resolve!: (value: { resource: PromptResource }) => void
    state.get.mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    const pending = state.render().retryDraft('resource')
    await vi.waitFor(() => expect(state.get).toHaveBeenCalledOnce())
    state.render().discardDraft('resource')
    resolve({ resource: resource(2, 'Remote body') })
    await pending
    expect(state.updateAssets).not.toHaveBeenCalled()
    expect(state.render().draftResourceIds).toEqual([])
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Saved')
  })

  it('keeps a draft when the server rejects a baseline not yet refreshed by the client', async () => {
    const conflict = new Error('Server version conflict')
    const state = fixture(vi.fn().mockRejectedValue(conflict))
    await expect(state.render().updateContextAsset('entry', { body: 'Unsaved' })).rejects.toBe(conflict)
    expect(state.updateAsset).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 1, resourceId: 'resource', assetId: 'entry', body: 'Unsaved',
    }))
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Unsaved')
    await expect(state.render().updateContextAsset('entry', { body: 'Unsaved' })).rejects.toBe(conflict)
    expect(state.updateAsset).toHaveBeenCalledTimes(1)
    expect(state.onResourceChange).not.toHaveBeenCalled()
    expect(state.recordEdit).not.toHaveBeenCalled()
  })

  it('advances only its own successful baseline and retains input typed while saves are pending', async () => {
    let finishFirst!: (result: UpdatePromptResourceResult) => void
    let finishSecond!: (result: UpdatePromptResourceResult) => void
    const state = fixture(vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve })))
    const first = state.render().updateContextAsset('entry', { body: 'First' })
    await vi.waitFor(() => expect(state.updateAsset).toHaveBeenCalledTimes(1))
    const second = state.render().updateContextAsset('entry', { body: 'Second' })
    finishFirst({ resource: resource(2, 'First'), mutation: { changesetId: 'first' } })
    await first
    await vi.waitFor(() => expect(state.updateAsset).toHaveBeenCalledTimes(2))
    expect(state.updateAsset.mock.calls[1]![0]).toMatchObject({ expectedVersion: 2, body: 'Second' })
    state.render().previewContextAsset('entry', { body: 'Still typing' })
    finishSecond({ resource: resource(3, 'Second'), mutation: { changesetId: 'second' } })
    await second
    expect(state.render().resources[0]?.version).toBe(3)
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Still typing')
    expect(state.render().draftResourceIds).toEqual(['resource'])
  })

  it('keeps remotely deleted drafts visible until explicitly discarded', async () => {
    const state = fixture()
    state.render().previewContextAsset('entry', { label: 'Keep my title' })
    state.refresh([])
    expect(state.render().nodes[0]?.children?.[0]?.label).toBe('Keep my title')
    await expect(state.render().updateContextAsset('entry', { label: 'Keep my title' })).rejects.toThrow('changed elsewhere')
    state.render().discardDraft('resource')
    expect(state.render().nodes).toEqual([])
  })

  it('sends the captured version for a batch and clears only successful drafts', async () => {
    const state = fixture()
    state.updateAssets.mockResolvedValue({ resource: resource(2, 'Batch'), mutation: { changesetId: 'batch' } })
    await state.render().updateContextAssets([{ id: 'entry', partial: { body: 'Batch' } }])
    expect(state.updateAssets).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: 'resource', expectedVersion: 1, updates: [expect.objectContaining({ assetId: 'entry', body: 'Batch' })],
    }))
    expect(state.render().draftResourceIds).toEqual([])
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Batch')
  })

  it('allows an explicit retry after network failure without changing the editing baseline', async () => {
    const state = fixture(vi.fn().mockRejectedValue(new Error('Network failure')))
    await expect(state.render().updateContextAsset('entry', { body: 'Retained' })).rejects.toThrow('Network failure')
    expect(state.onResourceChange).not.toHaveBeenCalled()
    expect(state.recordEdit).not.toHaveBeenCalled()
    state.updateAssets.mockResolvedValue({ resource: resource(2, 'Retained'), mutation: { changesetId: 'retry' } })
    await state.render().retryDraft('resource')
    expect(state.updateAssets).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }))
    expect(state.render().draftResourceIds).toEqual([])
    expect(state.render().nodes[0]?.children?.[0]?.body).toBe('Retained')
    expect(state.recordEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ changesetId: 'retry' }))
  })

  it('updates the root node label when renaming a resource root asset', async () => {
    const updateAsset = vi.fn().mockResolvedValue({
      resource: {
        ...resource(2),
        rootNode: { ...resource().rootNode, label: 'Renamed Root' },
      },
      mutation: { changesetId: 'rename' },
    })
    const state = fixture(updateAsset)
    await state.render().updateContextAsset('root', { label: 'Renamed Root' })
    expect(updateAsset).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: 'resource',
      assetId: 'root',
      label: 'Renamed Root',
    }))
    expect(state.render().nodes[0]?.label).toBe('Renamed Root')
  })
})
