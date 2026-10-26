import type { ContextAssetNode, PromptResource } from '../../../entities/index.js'
import { normalizeContextAssets } from './context-asset-normalization.js'

export function readPromptResourceWorkbenchRoot(resource: PromptResource): ContextAssetNode {
  return normalizeContextAssets([resource.rootNode])[0]!
}
