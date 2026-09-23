import { describe, expect, it, vi } from 'vitest'
import { formatEntityReference, formatResourceReference, type EntityReference } from '@loom-studio/shared'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { buildStudioTargetLink, resolveStudioTarget } from '../../../apps/studio-client/src/shared/studio-shell/studio-target.js'

function fixture() {
  const card = vi.fn().mockResolvedValue({ card: { id: 'card' } })
  const timeline = vi.fn().mockResolvedValue({
    timeline: { id: 'timeline', activeBranchId: 'active' },
    branches: [{ id: 'active' }, { id: 'requested' }],
  })
  const resource = vi.fn().mockResolvedValue({
    resource: {
      id: 'resource', resourceKind: 'setting',
      rootNode: { id: 'root', label: 'Root', children: [
        { id: 'group', label: 'Group', children: [{ id: 'nested', label: 'Node' }] },
      ] },
    },
  })
  const extensions = vi.fn().mockResolvedValue({ items: [{ packageId: 'package /?&#' }] })
  const api = {
    cards: { get: card }, narratives: { get: timeline }, promptResources: { get: resource }, extensions: { list: extensions },
  } as unknown as StudioApi
  return { api, card, timeline, resource, extensions }
}
const uri = (reference: Omit<EntityReference, 'kind'>) => formatEntityReference({ kind: 'entity', ...reference } as EntityReference)

describe('Studio target URI entry', () => {
  it('encodes the whole URI as one target without leaking its query or anchor', () => {
    const reference = uri({ type: 'timeline', id: 't /?&#', branchId: 'b&x', nodeId: 'n#1' })
    const link = new URL(buildStudioTargetLink(reference), 'http://localhost')
    expect(link.pathname).toBe('/studio')
    expect([...link.searchParams]).toEqual([['target', reference]])
    expect(link.hash).toBe('')
  })

  it.each([
    'javascript:alert(1)',
    'loom-resource://entity?type=card&id=x&nodeId=n',
    formatResourceReference({ kind: 'script', documentId: 's', version: 2, startLine: 1, endLine: 3 }),
  ])('rejects malformed or snapshot targets before API access: %s', async reference => {
    const f = fixture()
    expect(() => buildStudioTargetLink(reference)).toThrow('Invalid Studio target URI')
    await expect(resolveStudioTarget(f.api, reference)).rejects.toThrow('Invalid Studio target URI')
    expect(f.card).not.toHaveBeenCalled()
    expect(f.timeline).not.toHaveBeenCalled()
    expect(f.resource).not.toHaveBeenCalled()
  })

  it('resolves the exact Card and propagates read failures', async () => {
    const f = fixture()
    await expect(resolveStudioTarget(f.api, uri({ type: 'card', id: 'card' }))).resolves.toEqual({ panel: 'character', cardId: 'card' })
    expect(f.card).toHaveBeenCalledWith('card')
    const failure = new Error('Access denied')
    f.card.mockRejectedValueOnce(failure)
    await expect(resolveStudioTarget(f.api, uri({ type: 'card', id: 'card' }))).rejects.toBe(failure)
  })

  it('preserves an explicit Timeline branch and node without switching branch or using assetId', async () => {
    const f = fixture()
    await expect(resolveStudioTarget(f.api, uri({ type: 'timeline', id: 'timeline', branchId: 'requested', nodeId: 'node' })))
      .resolves.toEqual({ panel: null, timelineId: 'timeline', branchId: 'requested', nodeId: 'node' })
    expect(f.timeline).toHaveBeenCalledWith('timeline')
    await expect(resolveStudioTarget(f.api, uri({ type: 'timeline', id: 'timeline' })))
      .resolves.toEqual({ panel: null, timelineId: 'timeline', branchId: 'active' })
    await expect(resolveStudioTarget(f.api, uri({ type: 'timeline', id: 'timeline', branchId: 'missing' })))
      .rejects.toThrow('Timeline branch not found: missing')
  })

  it.each(['preset', 'setting'])('resolves %s resources to their root or exact nested node', async resourceKind => {
    const f = fixture()
    const result = await f.resource()
    result.resource.resourceKind = resourceKind
    f.resource.mockResolvedValue(result)
    f.resource.mockClear()
    const panel = resourceKind === 'preset' ? 'preset' : 'resource'
    await expect(resolveStudioTarget(f.api, uri({ type: 'resource', id: 'resource' })))
      .resolves.toEqual({ panel, resourceId: 'resource', assetId: 'root' })
    await expect(resolveStudioTarget(f.api, uri({ type: 'resource', id: 'resource', nodeId: 'nested' })))
      .resolves.toEqual({ panel, resourceId: 'resource', assetId: 'nested' })
    expect(f.resource).toHaveBeenCalledWith('resource')
    await expect(resolveStudioTarget(f.api, uri({ type: 'resource', id: 'resource', nodeId: 'gone' })))
      .rejects.toThrow('Resource node not found: gone')
  })

  it('resolves a Run to its current log filter without claiming an available run snapshot', async () => {
    const f = fixture()
    const id = 'run /?&#'
    const route = await resolveStudioTarget(f.api, uri({ type: 'run', id }))
    expect(route.panel).toBe('logs')
    expect([...new URLSearchParams(route.search)]).toEqual([['logRun', id], ['logSource', 'all']])
    expect(route.search?.startsWith('?')).toBe(false)
    expect(f.card).not.toHaveBeenCalled()
    expect(f.timeline).not.toHaveBeenCalled()
    expect(f.resource).not.toHaveBeenCalled()
    expect(f.extensions).not.toHaveBeenCalled()
  })

  it('resolves the exact Extension package and rejects missing packages or read failures', async () => {
    const f = fixture()
    const id = 'package /?&#'
    const route = await resolveStudioTarget(f.api, uri({ type: 'extension', id }))
    expect(route.panel).toBe('extensions')
    expect([...new URLSearchParams(route.search)]).toEqual([['packageId', id]])
    expect(route.search?.startsWith('?')).toBe(false)
    await expect(resolveStudioTarget(f.api, uri({ type: 'extension', id: 'missing' })))
      .rejects.toThrow('Extension not found: missing')
    const failure = new Error('Access denied')
    f.extensions.mockRejectedValueOnce(failure)
    await expect(resolveStudioTarget(f.api, uri({ type: 'extension', id }))).rejects.toBe(failure)
  })

  it('opens model management for a Provider without claiming row-level identity or querying it again', async () => {
    await expect(resolveStudioTarget({} as StudioApi, uri({ type: 'provider', id: 'provider' })))
      .resolves.toEqual({ panel: 'model' })
  })

  it('explicitly rejects Session targets without a direct navigation entry', async () => {
    const f = fixture()
    await expect(resolveStudioTarget(f.api, uri({ type: 'session', id: 'id' })))
      .rejects.toThrow('Studio target type does not support direct navigation: session')
    expect(f.card).not.toHaveBeenCalled()
    expect(f.timeline).not.toHaveBeenCalled()
    expect(f.resource).not.toHaveBeenCalled()
  })
})
