import type { ContextAssetNode } from '../../../entities/index.js'

export function normalizeContextAssets(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.map(node => normalizeContextAssetNode(node))
}

function normalizeContextAssetNode(node: ContextAssetNode): ContextAssetNode {
  const children = node.children ? normalizeContextAssets(node.children) : undefined
  const authorCapabilities = node.capabilities?.roleHint === 'developer' ? { ...node.capabilities, roleHint: 'system' as const } : node.capabilities
  const capabilities = authorCapabilities?.projection
    ? authorCapabilities
    : node.projection ? writeProjectionCapability(authorCapabilities, node.projection) : authorCapabilities
  const projection = readProjectionFromCapabilities(capabilities)

  return {
    ...node,
    ...(node.meta === 'message.developer' ? { meta: 'message.system' } : {}),
    ...(children ? { children } : {}),
    ...(projection ? { projection } : {}),
    ...(capabilities ? { capabilities } : {}),
  }
}

function readProjectionFromCapabilities(capabilities: ContextAssetNode['capabilities']): ContextAssetNode['projection'] | undefined {
  const projection = capabilities?.projection
  if (!projection) return undefined

  return {
    entryOrder: projection.entryOrderHint,
    zoneId: projection.zoneId,
    lifecycle: capabilities.lifecycle?.lifecycle ?? 'always',
    order: projection.order ?? (typeof projection.entryOrderHint === 'number' ? `entry: ${projection.entryOrderHint}` : 'entry: 500'),
    reason: projection.reason,
    slotKey: projection.slotKey,
    slotOrder: projection.slotOrderHint,
    sourceKind: projection.sourceKind,
  }
}

export function writeProjectionCapability(
  capabilities: ContextAssetNode['capabilities'],
  projection: NonNullable<ContextAssetNode['projection']>,
): ContextAssetNode['capabilities'] {
  return {
    ...capabilities,
    lifecycle: { lifecycle: projection.lifecycle ?? capabilities?.lifecycle?.lifecycle ?? 'always' },
    projection: {
      ...capabilities?.projection,
      entryOrderHint: projection.entryOrder,
      zoneId: projection.zoneId,
      order: projection.order,
      reason: projection.reason,
      slotKey: projection.slotKey,
      slotOrderHint: projection.slotOrder,
      sourceKind: projection.sourceKind,
    },
  }
}
