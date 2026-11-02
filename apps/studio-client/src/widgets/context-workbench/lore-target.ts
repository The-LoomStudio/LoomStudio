import { findContextAssetPath } from '../../features/prompt-resources/model/context-asset-tree.js'
import type { ContextAssetNode, PromptResource } from '../../entities/index.js'

export function readLoreTreeMeta(node: ContextAssetNode): string | undefined {
  if (node.category === 'lore-root') return node.meta
  return node.kind === 'entry' ? node.capabilities?.targetAnchorId : undefined
}

export function resolveLoreScope(
  lore: readonly PromptResource[],
  globalMountIds: ReadonlySet<string>,
  cardResourceIds: ReadonlySet<string>,
  installations: readonly { id: string; target: { kind: string } }[],
  scope: 'current' | 'global',
): PromptResource[] {
  if (scope === 'current') return lore.filter(resource => cardResourceIds.has(resource.id))
  const globalInstallations = new Set(installations.filter(item => item.target.kind === 'global').map(item => item.id))
  return lore.filter(resource => globalMountIds.has(resource.id)
    || (resource.origin?.kind === 'extension-package' && resource.origin.installationId !== undefined
      && globalInstallations.has(resource.origin.installationId))
    || resource.origin?.kind === 'builtin')
}

export function resolveLoreTarget(
  collection: readonly PromptResource[],
  lore: readonly PromptResource[],
  resourceId?: string,
) {
  const target = resourceId ? lore.find(resource => resource.id === resourceId) : undefined
  const temporary = Boolean(resourceId && target && !collection.some(resource => resource.id === resourceId))
  return {
    target,
    temporary,
    resources: temporary && target ? [target] : collection,
    unavailable: Boolean(resourceId && !target),
  }
}

/** Opening a root reveals its first level; a deep link reveals the target's ancestors. */
export function loreRevealExpandedIds(root: ContextAssetNode, nodeId = root.id): string[] {
  const nodes = nodeId === root.id ? [root, ...(root.children ?? [])] : findContextAssetPath([root], nodeId)
  return nodes.filter(node => node.children?.length).map(node => node.id)
}
