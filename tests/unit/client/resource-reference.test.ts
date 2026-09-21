import { describe, expect, it, vi } from 'vitest'
import { formatResourceReference } from '@loom-studio/shared'
import { loadResourceReference } from '../../../apps/studio-client/src/features/resource-references/reference-model.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { buildStudioResourcePath, readStudioRoute } from '../../../apps/studio-client/src/pages/studio/model/studio-route.js'
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
  it('fetches the exact resource ID and highlights only the matching source version', async () => {
    const { api, getResource } = apiFixture()
    const ref = { kind: 'prompt-resource' as const, resourceId: 'r', nodeId: 'n', version: 2, startLine: 2, endLine: 3 }
    const view = await loadResourceReference(api, formatResourceReference(ref))
    expect(getResource).toHaveBeenCalledWith('r')
    expect(view).toMatchObject({ exact: true, range: { startLine: 2, endLine: 3 }, editor: { nodeId: 'n', resourceId: 'r' } })
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
    expect(readStudioRoute(buildStudioResourcePath('resource', 'r', 'n'))).toEqual({ panel: 'resource', assetId: 'n' })
  })
})
