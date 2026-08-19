import type { ContextAssetNode } from '../../../entities/index.js'

export function normalizeContextAssets(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.map(node => normalizeContextAssetNode(node))
}

function normalizeContextAssetNode(node: ContextAssetNode): ContextAssetNode {
  const children = node.children ? normalizeContextAssets(node.children) : undefined
  const projection = node.projection ?? readProjectionFromCapabilities(node.capabilities)
  const capabilities = projection ? writeProjectionCapability(node.capabilities, projection) : node.capabilities

  return {
    ...node,
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
    lifecycle: { lifecycle: projection.lifecycle },
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
