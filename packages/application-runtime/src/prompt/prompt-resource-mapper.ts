import { PromptResourceStoreError } from '@loom-studio/application-data'
import type { ListPromptResourcesResult } from '../types.js'
import type {
  PromptResource as StoredPromptResource,
  PromptResourceNodeDraft as StoredPromptResourceNodeDraft,
  PromptResourceStore,
  PromptResourceTreeNode as StoredPromptResourceTreeNode,
} from '@loom-studio/application-data'
import type { JsonObject } from '@loom-studio/shared'
import { stripPromptAuthorDepth, normalizeMacroOptions, canPlacePromptNode, promptAnchorOutput } from '@loom-studio/shared'
import type { PromptResourceContent, PromptResourceNode, PromptResourceKind } from './prompt-resource-types.js'
import { normalizeMacros } from '../cards/card.js'

type PromptResourceMetadata = JsonObject & {
  icon?: NonNullable<PromptResourceContent['metadata']>['icon']
  historyPolicy?: PromptResourceContent['historyPolicy']
  model?: PromptResourceContent['model']
  delivery?: PromptResourceContent['delivery']
  approvalPolicy?: PromptResourceContent['approvalPolicy']
  origin?: PromptResourceContent['origin']
  sourceArtifactRef?: PromptResourceContent['sourceArtifactRef']
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
  useCardLore?: boolean
  useCardText?: boolean
  useGlobalLore?: boolean
  useGlobalText?: boolean
  textUses?: PromptResourceContent['textUses']
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
  for (const child of input.content.rootNode.children ?? []) {
    if (!canPlacePromptNode(input.content.rootNode, input.content.rootNode.id, child))
      throw new Error('Invalid Prompt tree: message sequences and Message blocks cannot be nested inside Message blocks')
  }
  const metadata: PromptResourceMetadata = {}
  if (input.content.metadata?.icon) metadata.icon = structuredClone(input.content.metadata.icon)
  if (input.content.historyPolicy !== undefined) metadata.historyPolicy = input.content.historyPolicy
  if (input.content.useCardLore !== undefined) metadata.useCardLore = input.content.useCardLore
  if (input.content.useCardText !== undefined) metadata.useCardText = input.content.useCardText
  if (input.content.useGlobalLore !== undefined) metadata.useGlobalLore = input.content.useGlobalLore
  if (input.content.useGlobalText !== undefined) metadata.useGlobalText = input.content.useGlobalText
  if (input.content.textUses !== undefined) metadata.textUses = input.content.textUses
  if (input.content.resourceKind === 'preset') {
    if (input.content.model !== undefined) metadata.model = input.content.model
    if (input.content.delivery !== undefined) metadata.delivery = input.content.delivery
    if (input.content.approvalPolicy !== undefined) metadata.approvalPolicy = input.content.approvalPolicy
  }
  if (input.content.origin !== undefined) metadata.origin = input.content.origin
  if (input.content.sourceArtifactRef !== undefined) metadata.sourceArtifactRef = input.content.sourceArtifactRef
  if (input.content.macros !== undefined) metadata.macros = normalizeMacros(input.content.macros, 'Preset')
  if (input.content.macroOptions !== undefined) metadata.macroOptions = normalizeMacroOptions(input.content.macroOptions)
  return {
    ...(input.id ? { id: input.id } : {}),
    resourceKind: input.content.resourceKind,
    label: input.content.rootNode.label,
    metadata,
    rootNode: toStoredNode(input.content.rootNode),
  }
}

export function toStoredNode(node: PromptResourceNode): StoredPromptResourceTreeNode {
  if (node.kind !== 'virtual' && node.capabilities?.targetAnchorId && promptAnchorOutput(node.capabilities.targetAnchorId) === 'messages')
    throw new Error('Text contributions cannot target a message sequence')
  const extra: JsonObject = { ...(node.extra ?? {}) }
  const capabilities = normalizeAuthorCapabilities(node.capabilities)
  if (node.meta === 'message.developer') throw new Error('Unsupported Prompt message role: developer')
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.category === undefined ? {} : { category: node.category }),
    ...(node.meta === undefined ? {} : { meta: node.meta }),
    ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
    ...(node.body === undefined ? {} : { body: node.body }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(Object.keys(extra).length === 0 ? {} : { extra }),
    ...(node.children?.length ? { children: node.children.map(toStoredNode) } : {}),
  }
}

export function fromStoredResource(resource: StoredPromptResource): PromptResourceContent & { id: string; version: number; tombstoned?: boolean } {
  const metadata = resource.metadata as PromptResourceMetadata
  return {
    ...(metadata.icon ? { metadata: { icon: structuredClone(metadata.icon) } } : {}),
    resourceKind: resource.resourceKind,
    rootNode: fromStoredNode(resource.rootNode),
    ...(resource.resourceKind === 'preset' ? { historyPolicy: metadata.historyPolicy ?? 'persistent' } : {}),
    ...(resource.resourceKind === 'preset' && metadata.model !== undefined ? { model: metadata.model } : {}),
    ...(resource.resourceKind === 'preset' && metadata.delivery !== undefined ? { delivery: metadata.delivery } : {}),
    ...(resource.resourceKind === 'preset' && metadata.approvalPolicy !== undefined ? { approvalPolicy: metadata.approvalPolicy } : {}),
    ...(resource.resourceKind === 'preset' && metadata.useCardLore !== undefined ? { useCardLore: metadata.useCardLore } : {}),
    ...(resource.resourceKind === 'preset' && metadata.useCardText !== undefined ? { useCardText: metadata.useCardText } : {}),
    ...(resource.resourceKind === 'preset' && metadata.useGlobalLore !== undefined ? { useGlobalLore: metadata.useGlobalLore } : {}),
    ...(resource.resourceKind === 'preset' && metadata.useGlobalText !== undefined ? { useGlobalText: metadata.useGlobalText } : {}),
    ...(resource.resourceKind === 'preset' && metadata.textUses !== undefined ? { textUses: metadata.textUses } : {}),
    ...(metadata.origin ? { origin: metadata.origin } : {}),
    ...(metadata.sourceArtifactRef ? { sourceArtifactRef: metadata.sourceArtifactRef } : {}),
    ...(metadata.macros ? { macros: normalizeMacros(metadata.macros, 'Preset') } : {}),
    ...(metadata.macroOptions ? { macroOptions: normalizeMacroOptions(metadata.macroOptions) } : {}),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    id: resource.id,
    version: resource.version,
    ...(resource.tombstoned ? { tombstoned: true } : {}),
  }
}

function fromStoredNode(node: StoredPromptResourceTreeNode): PromptResourceNode {
  const capabilities = normalizeAuthorCapabilities(node.capabilities as PromptResourceNode['capabilities'])
  if (node.meta === 'message.developer') throw new Error('Unsupported Prompt message role: developer')
  const result: PromptResourceNode = {
    ...(node.extra === undefined ? {} : { extra: node.extra }),
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(node.category === undefined || node.category === 'prompt' ? {} : { category: node.category }),
    ...(node.meta === undefined ? {} : { meta: node.meta }),
    ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
    ...(node.body === undefined ? {} : { body: node.body }),
    ...(capabilities === undefined ? {} : { capabilities }),
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
  options?: { includeTombstone?: boolean },
): Promise<Array<PromptResourceContent & { id: string; version: number; tombstoned?: boolean }>> {
  const resources: StoredPromptResource[] = []
  let cursor: string | undefined
  do {
    const page = await store.listResources({ resourceKind, includeTombstone: options?.includeTombstone, cursor, limit: 500, order: 'id' })
    resources.push(...page.resources)
    cursor = page.nextCursor
  } while (cursor)
  return resources
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(resource => fromStoredResource(resource))
}

/** Management listing keeps unreadable identities separate from executable resources. */
export async function listResourceCatalog(store: PromptResourceStore, resourceKind?: PromptResourceKind): Promise<ListPromptResourcesResult> {
  const resources: ListPromptResourcesResult['resources'] = []
  const invalidResources: NonNullable<ListPromptResourcesResult['invalidResources']> = []
  let cursor: string | undefined
  do {
    const page = await store.listResourceHeaders({ resourceKind, cursor, limit: 500, order: 'id' })
    for (const header of page.resources) {
      let stored: StoredPromptResource | null
      try {
        stored = await store.getResource(header.id)
      } catch (error) {
        if (!(error instanceof PromptResourceStoreError) || !['prompt_resource.json_invalid', 'prompt_resource.root_missing'].includes(error.code)) throw error
        invalidResources.push({ id: header.id, resourceKind: header.resourceKind, label: header.label, version: header.version, error: error.message })
        continue
      }
      if (!stored) continue // Deleted between the header page and the strict read.
      try {
        resources.push(fromStoredResource(stored))
      } catch (error) {
        invalidResources.push({ id: stored.id, resourceKind: stored.resourceKind, label: stored.label, version: stored.version, error: error instanceof Error ? error.message : String(error) })
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  resources.sort((a, b) => a.rootNode.label.localeCompare(b.rootNode.label))
  return { resources, ...(invalidResources.length ? { invalidResources } : {}) }
}

export function normalizeAuthorCapabilities(capabilities: PromptResourceNode['capabilities']): PromptResourceNode['capabilities'] {
  if (capabilities?.roleHint !== undefined && !['system', 'user', 'assistant'].includes(capabilities.roleHint))
    throw new Error(`Unsupported Prompt role: ${capabilities.roleHint}`)
  return stripPromptAuthorDepth(capabilities)
}
