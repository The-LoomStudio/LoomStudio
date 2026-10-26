import type { ContextAssetNode } from '../../../entities/index.js'
import { applyTokenMultiplier } from '@loom-studio/tokenizer/contracts'

export function collectTokenEntries(roots: readonly ContextAssetNode[]) {
  const entries: Array<{ id: string; body: string }> = []
  function visit(node: ContextAssetNode) {
    if (node.kind === 'entry') entries.push({ id: node.id, body: node.body ?? '' })
    node.children?.forEach(visit)
  }
  roots.forEach(visit)
  return entries
}

export function aggregateTokenCounts(roots: readonly ContextAssetNode[], counts: ReadonlyMap<string, number>, multiplier = 1) {
  const nodes = new Map<string, { total: number; enabled: number; resident: number; nonresident: number }>()
  function visit(node: ContextAssetNode, parentEnabled: boolean, parentResident: boolean) {
    const enabled = parentEnabled && node.enabled !== false
    const resident = parentResident && isResidentTokenNode(node)
    let base = node.kind === 'entry' ? counts.get(node.id) ?? 0 : 0
    let enabledBase = enabled ? base : 0
    let residentBase = resident ? enabledBase : 0
    for (const child of node.children ?? []) {
      const result = visit(child, enabled, resident)
      base += result.base
      enabledBase += result.enabledBase
      residentBase += result.residentBase
    }
    nodes.set(node.id, {
      total: applyTokenMultiplier(base, multiplier).estimatedTokens,
      enabled: applyTokenMultiplier(enabledBase, multiplier).estimatedTokens,
      resident: applyTokenMultiplier(residentBase, multiplier).estimatedTokens,
      nonresident: applyTokenMultiplier(enabledBase - residentBase, multiplier).estimatedTokens,
    })
    return { base, enabledBase, residentBase }
  }
  let total = 0
  let enabled = 0
  let resident = 0
  for (const root of roots) {
    const result = visit(root, true, true)
    total += result.base
    enabled += result.enabledBase
    resident += result.residentBase
  }
  return {
    nodes,
    total: applyTokenMultiplier(total, multiplier).estimatedTokens,
    enabled: applyTokenMultiplier(enabled, multiplier).estimatedTokens,
    resident: applyTokenMultiplier(resident, multiplier).estimatedTokens,
    nonresident: applyTokenMultiplier(enabled - resident, multiplier).estimatedTokens,
  }
}

function isResidentTokenNode(node: ContextAssetNode): boolean {
  function isAlways(activation: NonNullable<ContextAssetNode['capabilities']>['activation']): boolean {
    return activation === undefined || activation.kind === 'always'
      || (activation.kind === 'all' && (activation.activations ?? []).every(isAlways))
  }
  const lifecycle = node.projection?.lifecycle ?? node.capabilities?.lifecycle?.lifecycle
  return (lifecycle === undefined || lifecycle === 'always') && isAlways(node.capabilities?.activation)
}
