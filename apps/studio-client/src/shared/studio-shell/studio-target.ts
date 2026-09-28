import { parseEntityReference } from '@loom-studio/shared'
import type { StudioApi } from '../api/studio-api.js'
import { findNodeById } from '../ui/file-tree/file-tree-model.js'
import type { StudioRoute } from './studio-route.js'

export function buildStudioTargetLink(uri: string): string {
  if (!parseEntityReference(uri)) throw new Error('Invalid Studio target URI')
  return `/studio?${new URLSearchParams({ target: uri })}`
}

export async function resolveStudioTarget(api: StudioApi, uri: string): Promise<StudioRoute> {
  const reference = parseEntityReference(uri)
  if (!reference) throw new Error('Invalid Studio target URI')
  if (reference.type === 'card') {
    const { card } = await api.cards.get(reference.id)
    return { panel: 'character', cardId: card.id }
  }
  if (reference.type === 'timeline') {
    const { timeline, branches } = await api.narratives.get(reference.id)
    const branchId = reference.branchId ?? timeline.activeBranchId
    if (!branches.some(branch => branch.id === branchId)) throw new Error(`Timeline branch not found: ${branchId}`)
    return {
      panel: null, timelineId: timeline.id, branchId,
      ...(timeline.createdFrom?.cardId ? { cardId: timeline.createdFrom.cardId } : {}),
      ...(reference.nodeId !== undefined ? { nodeId: reference.nodeId } : {}),
    }
  }
  if (reference.type === 'resource') {
    const { resource } = await api.promptResources.get(reference.id)
    const nodeId = reference.nodeId ?? resource.rootNode.id
    if (!findNodeById([resource.rootNode], nodeId)) throw new Error(`Resource node not found: ${nodeId}`)
    return {
      panel: resource.resourceKind === 'preset' ? 'agent' : 'resource',
      resourceId: resource.id, assetId: nodeId,
    }
  }
  if (reference.type === 'provider') return { panel: 'model' }
  if (reference.type === 'run') {
    return { panel: 'logs', search: new URLSearchParams({ logRun: reference.id, logSource: 'all' }).toString() }
  }
  if (reference.type === 'extension') {
    const { items } = await api.extensions.list()
    if (!items.some(item => item.packageId === reference.id)) throw new Error(`Extension not found: ${reference.id}`)
    return { panel: 'extensions', search: new URLSearchParams({ packageId: reference.id }).toString() }
  }
  throw new Error(`Studio target type does not support direct navigation: ${reference.type}`)
}
