import type { ContextAssetNode, PromptResource } from '../../entities/index.js'

export function readSettingTreeMeta(node: ContextAssetNode): string | undefined {
  if (node.category === 'setting-root') return node.meta
  return node.kind === 'entry' ? node.capabilities?.targetAnchorId : undefined
}

export function resolveSettingScope(
  settings: readonly PromptResource[],
  globalMountIds: ReadonlySet<string>,
  cardResourceIds: ReadonlySet<string>,
  installations: readonly { id: string; target: { kind: string } }[],
  scope: 'current' | 'global',
): PromptResource[] {
  if (scope === 'current') return settings.filter(resource => cardResourceIds.has(resource.id))
  const globalInstallations = new Set(installations.filter(item => item.target.kind === 'global').map(item => item.id))
  return settings.filter(resource => globalMountIds.has(resource.id)
    || (resource.origin?.kind === 'extension-package' && resource.origin.installationId !== undefined
      && globalInstallations.has(resource.origin.installationId)))
}

export function resolveSettingTarget(
  collection: readonly PromptResource[],
  settings: readonly PromptResource[],
  resourceId?: string,
) {
  const target = resourceId ? settings.find(resource => resource.id === resourceId) : undefined
  const temporary = Boolean(resourceId && target && !collection.some(resource => resource.id === resourceId))
  return {
    target,
    temporary,
    resources: temporary && target ? [target] : collection,
    unavailable: Boolean(resourceId && !target),
  }
}
