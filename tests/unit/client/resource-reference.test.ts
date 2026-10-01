import { describe, expect, it, vi } from 'vitest'
import { formatEntityReference, formatResourceReference, parseEntityReference } from '@loom-studio/shared'
import { loadResourceReference } from '../../../apps/studio-client/src/features/resource-references/reference-model.js'
import { loadEntityReference } from '../../../apps/studio-client/src/features/resource-references/entity-reference-model.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { readStudioRoute } from '../../../apps/studio-client/src/shared/studio-shell/studio-route.js'
import { prepareLoomMarkdown } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-content-model.js'

function apiFixture() {
  const getResource = vi.fn().mockResolvedValue({ resource: {
    id: 'r', version: 2, resourceKind: 'setting',
    rootNode: { id: 'root', label: 'Root', kind: 'module', children: [{ id: 'n', label: 'Name', kind: 'entry', body: 'first\nsecond\nthird' }] },
  } })
  const getState = vi.fn().mockResolvedValue({ snapshot: { revisionId: 'rev', value: { inventory: ['key'] } } })
  const getScript = vi.fn().mockResolvedValue({ script: { id: 's', name: 'Script', version: 3 } })
  const exportScript = vi.fn().mockResolvedValue({ artifact: { source: 'throw new Error("never execute")' } })
  const api = { promptResources: { get: getResource }, states: { get: getState }, loomScripts: { get: getScript, export: exportScript } } as unknown as StudioApi
  return { api, getResource, getState, getScript, exportScript }
}

describe('resource reference navigation model', () => {
  it('resolves character identity and avatar only on demand and propagates access failures', async () => {
    const get = vi.fn().mockResolvedValue({ card: { id: 'a/b', name: 'Private name', version: 2, media: { avatarAssetId: 'asset' } } })
    const api = { cards: { get } } as unknown as StudioApi
    const view = await loadEntityReference(api, { kind: 'entity', type: 'card', id: 'a/b' })
    expect(view).toEqual({ title: 'Private name', uri: formatEntityReference({ kind: 'entity', type: 'card', id: 'a/b' }), avatarUrl: '/cards/a%2Fb/media/avatar?asset=asset&revision=2' })
    get.mockRejectedValue(new Error('Access denied'))
    await expect(loadEntityReference(api, { kind: 'entity', type: 'card', id: 'a/b' })).rejects.toThrow('Access denied')
  })
  it('keeps timeline branch and node identities in its entity URI', async () => {
    const get = vi.fn().mockResolvedValue({ timeline: { id: 'timeline/1', title: 'User timeline' } })
    const api = { narratives: { get } } as unknown as StudioApi
    const reference = { kind: 'entity' as const, type: 'timeline' as const, id: 'timeline/1', branchId: 'branch/2', nodeId: 'node/3' }
    const view = await loadEntityReference(api, reference)
    expect(get).toHaveBeenCalledExactlyOnceWith('timeline/1')
    expect(parseEntityReference(view.uri!)).toEqual(reference)
    expect(view).not.toHaveProperty('href')
  })
  it.each(['setting', 'preset'])('returns a resource URI with the root node for %s', async resourceKind => {
    const get = vi.fn().mockResolvedValue({ resource: {
      id: 'resource/1', resourceKind, rootNode: { id: 'root/2', label: 'User resource' },
    } })
    const view = await loadEntityReference({ promptResources: { get } } as unknown as StudioApi, {
      kind: 'entity', type: 'resource', id: 'resource/1',
    })
    expect(parseEntityReference(view.uri!)).toEqual({ kind: 'entity', type: 'resource', id: 'resource/1', nodeId: 'root/2' })
    expect(view.title).toBe('User resource')
  })
  it('returns run, provider and extension URIs while keeping sessions non-navigable', async () => {
    const listProviders = vi.fn()
      .mockResolvedValueOnce({ providerProfiles: [], nextCursor: 'next' })
      .mockResolvedValueOnce({ providerProfiles: [{ id: 'provider/1', displayName: 'User provider' }] })
    const api = {
      extensions: { list: vi.fn().mockResolvedValue({ items: [{ packageId: 'example.ext', displayName: 'User extension' }] }) },
      providerProfiles: { list: listProviders },
      agentSessions: { get: vi.fn().mockResolvedValue({ session: { title: 'User session' } }) },
    } as unknown as StudioApi
    for (const reference of [
      { kind: 'entity', type: 'run', id: 'run/1' },
      { kind: 'entity', type: 'provider', id: 'provider/1' },
      { kind: 'entity', type: 'extension', id: 'example.ext' },
    ] as const) {
      expect(parseEntityReference((await loadEntityReference(api, reference)).uri!)).toEqual(reference)
    }
    expect(listProviders).toHaveBeenLastCalledWith({ cursor: 'next', limit: 100 })
    const session = await loadEntityReference(api, { kind: 'entity', type: 'session', id: 'session/1' })
    expect(session.uri).toBeUndefined()
    expect(session.note).toContain('暂不支持直接定位')
  })
  it('fetches the exact resource ID and highlights only the matching source version', async () => {
    const { api, getResource } = apiFixture()
    const ref = { kind: 'prompt-resource' as const, resourceId: 'r', nodeId: 'n', version: 2, startLine: 2, endLine: 3 }
    const view = await loadResourceReference(api, formatResourceReference(ref))
    expect(getResource).toHaveBeenCalledWith('r')
    expect(view).toMatchObject({
      exact: true, path: '资源 / Root / Name',
      range: { startLine: 2, endLine: 3 }, editor: { nodeId: 'n', resourceId: 'r' },
    })
    const changed = await loadResourceReference(api, formatResourceReference({ ...ref, version: 1 }))
    expect(changed.exact).toBe(false)
    expect(changed.range).toBeUndefined()
    const outside = await loadResourceReference(api, formatResourceReference({ ...ref, endLine: 99 }))
    expect(outside.range).toBeUndefined()
  })
  it('never substitutes a same-name node when an identity is gone', async () => {
    const { api } = apiFixture()
    await expect(loadResourceReference(api, formatResourceReference({
      kind: 'prompt-resource', resourceId: 'r', nodeId: 'missing', version: 2, startLine: 1, endLine: 1,
    }))).rejects.toThrow('已不存在')
  })
  it('reads the referenced State branch without issuing a branch switch or mutation', async () => {
    const { api, getState } = apiFixture()
    const target = { scope: 'timeline' as const, timelineId: 'original', branchId: 'old-branch' }
    const view = await loadResourceReference(api, formatResourceReference({
      kind: 'state', target, revisionId: 'rev', pointer: '/inventory', startLine: 1, endLine: 1,
    }))
    expect(getState).toHaveBeenCalledWith(target)
    expect(view.body).toBe('- key\n')
    expect(view.exact).toBe(true)
  })
  it('does not pretend a changed script is the pinned revision', async () => {
    const { api } = apiFixture()
    const view = await loadResourceReference(api, formatResourceReference({
      kind: 'script', documentId: 's', version: 1, startLine: 1, endLine: 1,
    }))
    expect(view.exact).toBe(false)
    expect(view.range).toBeUndefined()
  })
  it('rejects malformed links before any API access and preserves read errors', async () => {
    const { api, getResource } = apiFixture()
    await expect(loadResourceReference(api, 'loom-resource://invalid')).rejects.toThrow('无效')
    expect(getResource).not.toHaveBeenCalled()
    getResource.mockRejectedValue(new Error('Access denied'))
    await expect(loadResourceReference(api, formatResourceReference({
      kind: 'prompt-resource', resourceId: 'r', nodeId: 'n', version: 2, startLine: 1, endLine: 1,
    }))).rejects.toThrow('Access denied')
  })
  it('keeps links intact in Markdown and routes the editor without selecting a card', () => {
    const uri = formatResourceReference({ kind: 'prompt-resource', resourceId: 'r', nodeId: 'n', version: 2, startLine: 1, endLine: 1 })
    expect(prepareLoomMarkdown(`[人设](${uri})`)).toBe(`[人设](${uri})`)
    expect(readStudioRoute('/studio/resources/reference/r/node/n')).toEqual({ panel: 'resource', resourceId: 'r', assetId: 'n' })
  })
  it('preserves resource identity when navigating between resources with the same node ID', () => {
    for (const panel of ['resource', 'preset'] as const) {
      for (const resourceId of ['first', 'second', 'first']) {
        expect(readStudioRoute(`/studio/${panel === 'preset' ? 'presets' : 'resources'}/reference/${encodeURIComponent(resourceId)}/node/shared-node`)).toEqual({
          panel, resourceId, assetId: 'shared-node',
        })
      }
    }
  })
})
