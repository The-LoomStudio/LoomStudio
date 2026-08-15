import type { ContextAssetNode, PromptResource } from '../../../entities/index.js'
import { normalizeContextAssets } from './context-asset-normalization.js'

export function readPromptResourceWorkbenchRoot(resource: PromptResource): ContextAssetNode {
  const root = normalizeContextAssets([resource.rootNode])[0]!
  if (resource.origin?.kind !== 'builtin') return root
  return markReadOnly(root)
}

function markReadOnly(node: ContextAssetNode): ContextAssetNode {
  return {
    ...node,
    readOnly: true,
    ...(node.children ? { children: node.children.map(markReadOnly) } : {}),
  }
}
