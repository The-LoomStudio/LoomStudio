import type {
  PromptResource as StoredPromptResource,
  PromptResourceNodeDraft as StoredPromptResourceNodeDraft,
  PromptResourceStore,
  PromptResourceTreeNode as StoredPromptResourceTreeNode,
} from '@loom-studio/prompt-resource-store'
import type { JsonObject } from '@loom-studio/shared'
import type {
  PromptResourceContent,
  PromptResourceNode,
  PromptResourceKind,
} from './workspace.js'

const legacyNodeKeys = ['configRows', 'isSection', 'orderList', 'skeletonPatch', 'slotRanks'] as const

type PromptResourceMetadata = JsonObject & {
  historyPolicy?: PromptResourceContent['historyPolicy']
  origin?: PromptResourceContent['origin']
  sourceArtifactRef?: PromptResourceContent['sourceArtifactRef']
}

export function toStoredResourceInput(input: {
  id?: string
  content: PromptResourceContent
}): {
  id?: string
  resourceKind: PromptResourceKind
  label: string
  metadata: JsonObject
  rootNode: StoredPromptResourceTreeNode
} {
  const metadata: PromptResourceMetadata = {}
  if (input.content.historyPolicy !== undefined) metadata.historyPolicy = input.content.historyPolicy
  if (input.content.origin !== undefined) metadata.origin = input.content.origin
  if (input.content.sourceArtifactRef !== undefined) metadata.sourceArtifactRef = input.content.sourceArtifactRef
  return {
    ...(input.id ? { id: input.id } : {}),
    resourceKind: input.content.resourceKind,
    label: input.content.rootNode.label,
    metadata,
    rootNode: toStoredNode(input.content.rootNode),
  }
}

export function toStoredNode(node: PromptResourceNode): StoredPromptResourceTreeNode {
  const extra: JsonObject = { ...(node.extra ?? {}) }
  for (const key of legacyNodeKeys) {
    const value = node[key]
    if (value !== undefined) extra[key] = value
  }
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.category === undefined ? {} : { category: node.category }),
    ...(node.meta === undefined ? {} : { meta: node.meta }),
    ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
    ...(node.body === undefined ? {} : { body: node.body }),
    ...(node.capabilities === undefined ? {} : { capabilities: node.capabilities }),
    ...(Object.keys(extra).length === 0 ? {} : { extra }),
    ...(node.children?.length ? { children: node.children.map(toStoredNode) } : {}),
  }
}

export function fromStoredResource(resource: StoredPromptResource): PromptResourceContent & { id: string; version: number } {
  const metadata = resource.metadata as PromptResourceMetadata
  return {
    resourceKind: resource.resourceKind,
    rootNode: fromStoredNode(resource.rootNode),
    ...(resource.resourceKind === 'preset' ? { historyPolicy: metadata.historyPolicy ?? 'persistent' } : {}),
    ...(metadata.origin ? { origin: metadata.origin } : {}),
    ...(metadata.sourceArtifactRef ? { sourceArtifactRef: metadata.sourceArtifactRef } : {}),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    id: resource.id,
    version: resource.version,
  }
}

export function fromStoredNode(node: StoredPromptResourceTreeNode): PromptResourceNode {
  const extra = node.extra ?? {}
  const known = new Set<string>(legacyNodeKeys)
  const unknownExtra = Object.fromEntries(Object.entries(extra).filter(([key]) => !known.has(key))) as JsonObject
  const result: PromptResourceNode = {
    ...(extra.configRows === undefined ? {} : { configRows: extra.configRows as PromptResourceNode['configRows'] }),
    ...(extra.isSection === undefined ? {} : { isSection: extra.isSection as boolean }),
    ...(extra.orderList === undefined ? {} : { orderList: extra.orderList as string[] }),
    ...(extra.skeletonPatch === undefined ? {} : { skeletonPatch: extra.skeletonPatch as PromptResourceNode['skeletonPatch'] }),
    ...(extra.slotRanks === undefined ? {} : { slotRanks: extra.slotRanks as PromptResourceNode['slotRanks'] }),
    ...(Object.keys(unknownExtra).length === 0 ? {} : { extra: unknownExtra }),
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.category === undefined || node.category === 'prompt' ? {} : { category: node.category }),
    ...(node.meta === undefined ? {} : { meta: node.meta }),
    ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
    ...(node.body === undefined ? {} : { body: node.body }),
    ...(node.capabilities === undefined ? {} : { capabilities: node.capabilities as PromptResourceNode['capabilities'] }),
    ...(node.children?.length ? { children: node.children.map(fromStoredNode) } : {}),
  }
  return result
}

export function toStoredNodeDraft(node: PromptResourceNode): StoredPromptResourceNodeDraft {
  const stored = toStoredNode(node)
  return stored
}

export async function readMappedResource(
  store: PromptResourceStore,
  resourceId: string,
): Promise<PromptResourceContent & { id: string; version: number }> {
  const resource = await store.getResource(resourceId)
  if (!resource) throw new Error(`Prompt resource not found: ${resourceId}`)
  return fromStoredResource(resource)
}

export async function listMappedResources(
  store: PromptResourceStore,
  resourceKind?: PromptResourceKind,
): Promise<Array<PromptResourceContent & { id: string; version: number }>> {
  const resources: StoredPromptResource[] = []
  let cursor: string | undefined
  do {
    const page = await store.listResources({ resourceKind, cursor, limit: 500 })
    resources.push(...page.resources)
    cursor = page.nextCursor
  } while (cursor)
  return resources
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(resource => fromStoredResource(resource))
}
