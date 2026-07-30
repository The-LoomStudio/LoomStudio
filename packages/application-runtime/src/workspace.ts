import type { DocumentRecord, DocumentStore, DocumentTransaction } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { normalizeOpening, normalizeOptionalString, renderMacros } from './card.js'
import { applicationDocumentTypes } from './document-types.js'
import { readDocument, toVersioned, writeDocument } from './document-store.js'
import { isObject } from './json.js'
import type {
  CardPresetInput,
  CardSourceContent,
  OpeningChatInput,
  SettingLayerInput,
} from './types.js'
import type {
  CompositionSkeletonPatch,
  PromptCompositionCapabilities,
  PromptContribution,
  ProjectionOrderProfile,
  SourceNode,
} from './prompt-builder.js'
import { combineActivationGates, type PromptActivation } from './prompt-activation.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

export type CardBundleArtifact = {
  schemaVersion: 1
  artifactId: string
  displayName: string
  description?: string
  card: {
    name: string
    userName?: string
    description?: string
    preset?: CardPresetInput
    opening?: OpeningChatInput | string
    settingLayer?: SettingLayerInput
  }
  contextAssets: PromptResourceNode[]
  metadata?: JsonObject
}

export type PromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'

export type PromptResourceContent = {
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  sourceArtifactRef?: CardBundleSourceArtifactRef
  createdAt: string
  updatedAt: string
}

export type CardBundleSourceArtifactRef = {
  artifactId: string
  displayName: string
  format: 'loom.cardBundle'
  importedAt: string
  schemaVersion: CardBundleArtifact['schemaVersion']
}

export type CardBundleImportManifest = {
  artifactId: string
  bindingIds: string[]
  documentIds: string[]
  id: string
  importedAt: string
  sourceArtifactRef: CardBundleSourceArtifactRef
}

export type ImportBundleContent = {
  cardId: string
  documentIds: string[]
  sourceArtifact: CardBundleArtifact
  sourceArtifactRef: CardBundleSourceArtifactRef
  bindings: CardBundleSourceBinding[]
  importedAt: string
}

export type CardBundleSourceBinding = {
  createdAt: string
  from: CardBundleBindingEndpoint
  id: string
  relationship: 'recommends'
  to: CardBundleBindingEndpoint
}

export type CardBundleBindingEndpoint = {
  documentId: string
  documentType: string
  nodeId?: string
}

export type PromptResourceNode = {
  body?: string
  category?: 'preset' | 'setting' | 'logic' | 'runtime' | 'history'
  children?: PromptResourceNode[]
  configRows?: Array<{ label: string; value: string }>
  enabled?: boolean
  id: string
  isSection?: boolean
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'order'
  label: string
  meta?: string
  orderList?: string[]
  skeletonPatch?: CompositionSkeletonPatch
  slotRanks?: ProjectionOrderProfile['slotRanks']
  capabilities?: PromptResourceCompositionCapabilities
}

export type PromptResourceCompositionCapabilities = Omit<PromptCompositionCapabilities, 'activation' | 'lifecycle' | 'projection'> & {
  activation?: PromptActivation
  lifecycle?: { lifecycle: 'always' | 'conditional' | 'fresh' | string }
  projection?: {
    entryOrderHint?: number
    zoneId: string
    slotKey?: string
    slotOrderHint?: number
    sourceKind?: 'actual' | 'virtual'
  }
}

type PromptContributionResourceNode = PromptResourceNode & {
  body: string
  capabilities: PromptResourceCompositionCapabilities & {
    projection: NonNullable<PromptResourceCompositionCapabilities['projection']>
  }
}

export async function importCardBundle(input: {
  artifact: CardBundleArtifact
  documents: DocumentStore
  now?: string
}): Promise<{
  card: CardSourceContent & { id: string; version: number }
  importBundle: ImportBundleContent & { id: string; version: number }
}> {
  const artifact = normalizeCardBundleArtifact(input.artifact)
  const timestamp = input.now ?? nowIso()
  const sourceArtifactRef = createSourceArtifactRef(artifact, timestamp)

  const transaction = await input.documents.transact({
    actor: applicationActor,
    reason: 'application.importCardBundle',
  }, async tx => {
    const cardId = createId('card')
    const importBundleId = createId('import-bundle')
    const resources = await writePromptResources({
      documents: tx,
      nodes: artifact.contextAssets,
      sourceArtifactRef,
      timestamp,
    })
    const card = await writeDocument<CardSourceContent>(tx, {
      id: cardId,
      type: applicationDocumentTypes.cardSource,
      content: {
        name: artifact.card.name,
        userName: normalizeOptionalString(artifact.card.userName),
        description: artifact.card.description,
        importBundleId,
        promptResourceIds: resources.map(resource => resource.id),
        preset: {},
        opening: normalizeOpening(artifact.card.opening),
        settingLayer: { entries: [] },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      expectedVersion: 'new',
    })
    const bindings = createCardBundleBindings({
      cardId: card.id,
      resources,
      timestamp,
    })
    const importBundle = await writeDocument<ImportBundleContent>(tx, {
      id: importBundleId,
      type: applicationDocumentTypes.importBundle,
      content: {
        cardId: card.id,
        documentIds: [card.id, ...resources.map(resource => resource.id)],
        sourceArtifact: artifact,
        sourceArtifactRef,
        bindings,
        importedAt: timestamp,
      },
      expectedVersion: 'new',
    })
    return { card, importBundle }
  })

  return {
    card: toVersioned(transaction.value.card),
    importBundle: toVersioned(transaction.value.importBundle),
  }
}

export async function getPromptResource(input: {
  documents: DocumentStore
  resourceId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  return toVersioned(await readDocument<PromptResourceContent>(
    input.documents,
    input.resourceId,
    applicationDocumentTypes.promptResource,
  ))
}

export async function getImportBundle(input: {
  documents: DocumentStore
  importBundleId: string
}): Promise<ImportBundleContent & { id: string; version: number }> {
  return toVersioned(await readDocument<ImportBundleContent>(
    input.documents,
    input.importBundleId,
    applicationDocumentTypes.importBundle,
  ))
}

export async function listCardPromptResources(input: {
  cardId: string
  documents: DocumentStore
}): Promise<Array<PromptResourceContent & { id: string; version: number }>> {
  const card = await readDocument<CardSourceContent>(input.documents, input.cardId, applicationDocumentTypes.cardSource)
  const resourceIds = card.content.promptResourceIds ?? []
  return (await readPromptResourceDocumentsByIds(input.documents, resourceIds)).map(toVersioned)
}

export async function createPromptResourceAsset(input: {
  asset: PromptResourceNode
  documents: DocumentTransaction
  now?: string
  position: 'before' | 'inside' | 'after'
  resourceId: string
  targetAssetId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  const resource = await readPromptResourceDocument(input.documents, input.resourceId)
  if (findNode([resource.content.rootNode], node => node.id === input.asset.id)) {
    throw new Error(`Prompt asset already exists: ${input.asset.id}`)
  }
  const result = insertPromptAssetNode([resource.content.rootNode], input.targetAssetId, input.position, input.asset)
  if (!result.found) throw new Error(`Prompt asset target not found in resource ${input.resourceId}: ${input.targetAssetId}`)
  return await writePromptResourceRoot(input.documents, resource, readSingleResourceRoot(result.nodes, input.resourceId), input.now)
}

export async function updatePromptResourceAssets(input: {
  documents: DocumentTransaction
  now?: string
  resourceId: string
  updates: Array<{
    assetId: string
    body?: string
    capabilities?: PromptResourceCompositionCapabilities
    enabled?: boolean
    label?: string
    meta?: string
    orderList?: string[]
    skeletonPatch?: CompositionSkeletonPatch
    slotRanks?: ProjectionOrderProfile['slotRanks']
  }>
}): Promise<PromptResourceContent & { id: string; version: number }> {
  if (input.updates.length === 0) throw new Error('Prompt asset updates cannot be empty')
  if (new Set(input.updates.map(update => update.assetId)).size !== input.updates.length) {
    throw new Error('Prompt asset updates cannot contain duplicate asset ids')
  }

  const resource = await readPromptResourceDocument(input.documents, input.resourceId)
  let rootNode = resource.content.rootNode
  for (const update of input.updates) {
    const result = updateNode([rootNode], update.assetId, node => {
      const updatesOrderProfile = update.orderList !== undefined || update.skeletonPatch !== undefined || update.slotRanks !== undefined
      if (updatesOrderProfile && node.kind !== 'order') {
        throw new Error(`Prompt node is not an order profile: ${update.assetId}`)
      }
      return applyPromptAssetPatch(node, update)
    })
    if (!result.found) throw new Error(`Prompt asset not found in resource ${input.resourceId}: ${update.assetId}`)
    rootNode = readSingleResourceRoot(result.nodes, input.resourceId)
  }

  return await writePromptResourceRoot(input.documents, resource, rootNode, input.now)
}

export async function updatePromptResourceAsset(input: {
  assetId: string
  body?: string
  capabilities?: PromptResourceCompositionCapabilities
  documents: DocumentTransaction
  enabled?: boolean
  label?: string
  meta?: string
  now?: string
  resourceId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  return await updatePromptResourceAssets({
    documents: input.documents,
    now: input.now,
    resourceId: input.resourceId,
    updates: [{
      assetId: input.assetId,
      body: input.body,
      capabilities: input.capabilities,
      enabled: input.enabled,
      label: input.label,
      meta: input.meta,
    }],
  })
}

export async function movePromptResourceAsset(input: {
  assetId: string
  documents: DocumentTransaction
  now?: string
  position: 'before' | 'inside' | 'after'
  resourceId: string
  targetAssetId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  if (input.assetId === input.targetAssetId) throw new Error('Cannot move prompt asset onto itself')
  const resource = await readPromptResourceDocument(input.documents, input.resourceId)
  const nodes = [resource.content.rootNode]
  const asset = findNode(nodes, node => node.id === input.assetId)
  if (!asset) throw new Error(`Prompt asset not found in resource ${input.resourceId}: ${input.assetId}`)
  // ponytail: 当前资源编辑保证单 Document changeset；需要跨资源移动时再升级为显式多资源事务。
  if (!findNode(nodes, node => node.id === input.targetAssetId)) {
    throw new Error(`Cross-resource prompt asset move is not supported: ${input.targetAssetId}`)
  }
  if (asset.kind === 'module' || asset.kind === 'order') throw new Error(`Prompt asset cannot be moved: ${input.assetId}`)
  if (findNode(asset.children ?? [], node => node.id === input.targetAssetId)) {
    throw new Error('Cannot move prompt asset inside its own subtree')
  }

  const removed = removePromptAssetNode(nodes, input.assetId)
  const inserted = insertPromptAssetNode(removed.nodes, input.targetAssetId, input.position, asset)
  if (!inserted.found) throw new Error(`Prompt asset target not found in resource ${input.resourceId}: ${input.targetAssetId}`)
  return await writePromptResourceRoot(
    input.documents,
    resource,
    readSingleResourceRoot(inserted.nodes, input.resourceId),
    input.now,
  )
}

export async function deletePromptResourceAsset(input: {
  assetId: string
  documents: DocumentTransaction
  now?: string
  resourceId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  const resource = await readPromptResourceDocument(input.documents, input.resourceId)
  const nodes = [resource.content.rootNode]
  const asset = findNode(nodes, node => node.id === input.assetId)
  if (!asset) throw new Error(`Prompt asset not found in resource ${input.resourceId}: ${input.assetId}`)
  if (asset.kind === 'module' || asset.kind === 'order') throw new Error(`Prompt asset cannot be deleted: ${input.assetId}`)

  const removed = removePromptAssetNode(nodes, input.assetId)
  const pruned = pruneProjectionOrderRefs(removed.nodes, removed.removedIds, removed.removedSlotKeys)
  return await writePromptResourceRoot(
    input.documents,
    resource,
    readSingleResourceRoot(pruned, input.resourceId),
    input.now,
  )
}

export async function exportCardArtifact(input: {
  cardId: string
  documents: DocumentStore
}): Promise<CardBundleArtifact> {
  const card = await readDocument<CardSourceContent>(input.documents, input.cardId, applicationDocumentTypes.cardSource)
  const importBundle = await readOptionalCardImportBundle(input.documents, card)
  const contextAssets = (await readPromptResourceDocumentsByIds(
    input.documents,
    card.content.promptResourceIds ?? [],
  )).map(resource => resource.content.rootNode)

  return buildExportArtifact({ card, contextAssets, importBundle })
}

function buildExportArtifact(input: {
  card: DocumentRecord<CardSourceContent>
  contextAssets: PromptResourceNode[]
  importBundle?: DocumentRecord<ImportBundleContent>
}): CardBundleArtifact {
  const cardContent = input.card.content
  const importBundleContent = input.importBundle?.content
  const sourceArtifact = importBundleContent?.sourceArtifact
  const sourceArtifactRef = importBundleContent?.sourceArtifactRef
  const bindings = importBundleContent?.bindings
  const importBundle = input.importBundle ? toCardBundleImportManifest(input.importBundle) : undefined

  return {
    schemaVersion: 1,
    artifactId: sourceArtifact?.artifactId ?? input.card.id,
    displayName: sourceArtifact?.displayName ?? cardContent.name,
    description: sourceArtifact?.description ?? cardContent.description,
    card: {
      name: cardContent.name,
      userName: cardContent.userName,
      description: cardContent.description,
      preset: cardContent.preset,
      opening: cardContent.opening,
      settingLayer: cardContent.settingLayer,
    },
    contextAssets: input.contextAssets,
    metadata: {
      ...(sourceArtifact?.metadata ?? {}),
      ...(sourceArtifactRef ? { sourceArtifactRef } : {}),
      ...(importBundle ? { importBundle } : {}),
      ...(bindings ? { bindings } : {}),
      exportedFromCardId: input.card.id,
      exportedAt: nowIso(),
    },
  }
}

function toCardBundleImportManifest(importBundle: DocumentRecord<ImportBundleContent>): CardBundleImportManifest {
  return {
    id: importBundle.id,
    artifactId: importBundle.content.sourceArtifactRef.artifactId,
    importedAt: importBundle.content.importedAt,
    sourceArtifactRef: importBundle.content.sourceArtifactRef,
    documentIds: importBundle.content.documentIds,
    bindingIds: importBundle.content.bindings.map(binding => binding.id),
  }
}

async function readOptionalCardImportBundle(
  documents: DocumentTransaction,
  card: DocumentRecord<CardSourceContent>,
): Promise<DocumentRecord<ImportBundleContent> | undefined> {
  if (!card.content.importBundleId) return undefined
  return await readDocument<ImportBundleContent>(documents, card.content.importBundleId, applicationDocumentTypes.importBundle)
}

export async function readPromptResourceInputs(input: {
  documents: DocumentStore
  resourceIds: string[]
  macroContext: { user: string }
}): Promise<{
  orderProfile: ProjectionOrderProfile
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
}> {
  const resources = await readPromptResourceDocumentsByIds(input.documents, input.resourceIds)
  return collectPromptInputsFromNodes(resources.map(resource => resource.content.rootNode), input.macroContext)
}

function collectPromptInputsFromNodes(
  contextAssets: PromptResourceNode[],
  macroContext: { user: string },
): {
  orderProfile: ProjectionOrderProfile
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
} {
  const orderProfile = readPromptResourceOrderProfile(contextAssets)
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []

  collectPromptInputs({
    parentActivationGates: [],
    contributions,
    macroContext,
    nodes: contextAssets,
    parentId: null,
    inheritedCategory: undefined,
    inheritedSourceId: undefined,
    sourceNodes,
  })

  return { orderProfile, sourceNodes, contributions }
}

export function readPromptResourceOrderProfile(nodes: PromptResourceNode[]): ProjectionOrderProfile {
  const orderNode = findNode(nodes, node => node.kind === 'order')

  return {
    id: orderNode?.id ?? 'profile.resources',
    scope: 'global',
    ...(orderNode?.skeletonPatch ? { skeletonPatch: orderNode.skeletonPatch } : {}),
    slotRanks: orderNode?.slotRanks ?? [],
  }
}

export function normalizeCardBundleArtifact(artifact: CardBundleArtifact): CardBundleArtifact {
  if (artifact.schemaVersion !== 1) throw new Error(`Unsupported card bundle schemaVersion: ${artifact.schemaVersion}`)
  if (!artifact.artifactId || !artifact.displayName) throw new Error('Card bundle requires artifactId and displayName')
  if (!artifact.card?.name) throw new Error('Card bundle requires card.name')

  return {
    schemaVersion: 1,
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    description: artifact.description,
    card: artifact.card,
    contextAssets: artifact.contextAssets ?? [],
    metadata: artifact.metadata ?? {},
  }
}

function createSourceArtifactRef(artifact: CardBundleArtifact, importedAt: string): CardBundleSourceArtifactRef {
  return {
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    format: 'loom.cardBundle',
    importedAt,
    schemaVersion: artifact.schemaVersion,
  }
}

async function writePromptResources(input: {
  documents: DocumentTransaction
  nodes: PromptResourceNode[]
  sourceArtifactRef: CardBundleSourceArtifactRef
  timestamp: string
}): Promise<Array<DocumentRecord<PromptResourceContent>>> {
  const resources: Array<DocumentRecord<PromptResourceContent>> = []

  for (const node of input.nodes) {
    resources.push(await writeDocument<PromptResourceContent>(input.documents, {
      id: createId('prompt-resource'),
      type: applicationDocumentTypes.promptResource,
      content: {
        resourceKind: node.category ?? 'prompt',
        rootNode: node,
        sourceArtifactRef: input.sourceArtifactRef,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      },
      expectedVersion: 'new',
    }))
  }

  return resources
}

function createCardBundleBindings(input: {
  cardId: string
  resources: Array<DocumentRecord<PromptResourceContent>>
  timestamp: string
}): CardBundleSourceBinding[] {
  const sourceResources = input.resources.filter(resource =>
    resource.content.rootNode.kind === 'module'
    && (resource.content.rootNode.category === 'setting' || resource.content.rootNode.category === 'preset'))

  return sourceResources.map(resource => ({
    id: `binding.${resource.id}.${resource.content.rootNode.id}`,
    relationship: 'recommends',
    createdAt: input.timestamp,
    from: {
      documentId: input.cardId,
      documentType: applicationDocumentTypes.cardSource,
    },
    to: {
      documentId: resource.id,
      documentType: applicationDocumentTypes.promptResource,
      nodeId: resource.content.rootNode.id,
    },
  }))
}

function collectPromptInputs(input: {
  contributions: PromptContribution[]
  inheritedCategory: PromptResourceNode['category'] | undefined
  inheritedSourceId: string | undefined
  macroContext: { user: string }
  nodes: PromptResourceNode[]
  parentActivationGates: PromptActivation[]
  parentId: string | null
  sourceNodes: SourceNode[]
}): void {
  for (const [index, node] of input.nodes.entries()) {
    const category = node.category ?? input.inheritedCategory
    const sourceId = node.kind === 'module' ? node.id : input.inheritedSourceId ?? node.id
    const activationGates = node.capabilities?.activation
      ? [...input.parentActivationGates, node.capabilities.activation]
      : input.parentActivationGates
    input.sourceNodes.push({
      id: node.id,
      sourceId,
      parentId: input.parentId,
      displayName: node.label,
      orderIndex: index + 1,
    })

    if (category && isPromptContributionNode(node, category)) {
      const kind = readSourceKind(category)
      if (kind) {
        const effectiveActivation = combineActivationGates(activationGates)
        input.contributions.push({
          id: `resource.${node.id}`,
          sourceRef: {
            kind,
            sourceId,
            sourceNodeId: node.id,
          },
          content: renderMacros(node.body, input.macroContext),
          capabilities: {
            content: { kind: 'text' },
            ...(effectiveActivation ? { activation: effectiveActivation } : {}),
            lifecycle: { lifecycle: 'always' },
            projection: {
              zoneId: node.capabilities.projection.zoneId,
              ...(node.capabilities.projection.slotKey ? { joinSlotKey: node.capabilities.projection.slotKey } : {}),
              ...(node.capabilities.projection.entryOrderHint !== undefined ? { entryOrderHint: node.capabilities.projection.entryOrderHint } : {}),
              ...(node.capabilities.projection.slotOrderHint !== undefined ? { slotOrderHint: node.capabilities.projection.slotOrderHint } : {}),
            },
          },
        })
      }
    }

    if (node.children) {
      collectPromptInputs({
        ...input,
        parentActivationGates: activationGates,
        nodes: node.children,
        parentId: node.id,
        inheritedCategory: category,
        inheritedSourceId: sourceId,
      })
    }
  }
}

function isPromptContributionNode(node: PromptResourceNode, category: PromptResourceNode['category']): node is PromptContributionResourceNode {
  return node.kind === 'entry'
    && node.enabled !== false
    && typeof node.body === 'string'
    && Boolean(node.capabilities?.projection)
    && node.capabilities?.projection?.sourceKind !== 'virtual'
    && (node.capabilities?.projection?.zoneId !== 'chat.history' || category === 'history')
}

function readSourceKind(category: PromptResourceNode['category']): PromptContribution['sourceRef']['kind'] | undefined {
  if (category === 'preset') return 'preset'
  if (category === 'setting') return 'settingLayer'
  if (category === 'runtime') return 'runtime'
  if (category === 'history') return 'narrativeChat'
  return undefined
}

function updateNode(
  nodes: PromptResourceNode[],
  id: string,
  update: (node: PromptResourceNode) => PromptResourceNode,
): { found: boolean; nodes: PromptResourceNode[] } {
  let found = false
  const nextNodes = nodes.map(node => {
    if (node.id === id) {
      found = true
      return update(node)
    }
    if (!node.children) return node
    const childResult = updateNode(node.children, id, update)
    if (!childResult.found) return node
    found = true
    return { ...node, children: childResult.nodes }
  })

  return { found, nodes: nextNodes }
}

function applyPromptAssetPatch(
  node: PromptResourceNode,
  update: {
    body?: string
    capabilities?: PromptResourceCompositionCapabilities
    enabled?: boolean
    label?: string
    meta?: string
    orderList?: string[]
    skeletonPatch?: CompositionSkeletonPatch
    slotRanks?: ProjectionOrderProfile['slotRanks']
  },
): PromptResourceNode {
  return {
    ...node,
    ...(update.body !== undefined ? { body: update.body } : {}),
    ...(update.capabilities !== undefined ? { capabilities: update.capabilities } : {}),
    ...(update.label !== undefined ? { label: update.label } : {}),
    ...(update.meta !== undefined ? { meta: update.meta } : {}),
    ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
    ...(update.orderList !== undefined ? { orderList: update.orderList } : {}),
    ...(update.skeletonPatch !== undefined ? { skeletonPatch: update.skeletonPatch } : {}),
    ...(update.slotRanks !== undefined ? { slotRanks: update.slotRanks } : {}),
  }
}

async function readPromptResourceDocument(
  documents: DocumentTransaction,
  resourceId: string,
): Promise<DocumentRecord<PromptResourceContent>> {
  return await readDocument<PromptResourceContent>(documents, resourceId, applicationDocumentTypes.promptResource)
}

async function writePromptResourceRoot(
  documents: DocumentTransaction,
  resource: DocumentRecord<PromptResourceContent>,
  rootNode: PromptResourceNode,
  now?: string,
): Promise<PromptResourceContent & { id: string; version: number }> {
  const updated = await writeDocument<PromptResourceContent>(documents, {
    id: resource.id,
    type: applicationDocumentTypes.promptResource,
    content: {
      ...resource.content,
      rootNode,
      updatedAt: now ?? nowIso(),
    },
    expectedVersion: resource.version,
  })
  return toVersioned(updated)
}

function readSingleResourceRoot(nodes: PromptResourceNode[], resourceId: string): PromptResourceNode {
  const rootNode = nodes[0]
  if (!rootNode || nodes.length !== 1) throw new Error(`Prompt resource root cannot be replaced or split: ${resourceId}`)
  return rootNode
}

async function readPromptResourceDocumentsByIds(
  documents: DocumentTransaction,
  resourceIds: string[],
): Promise<Array<DocumentRecord<PromptResourceContent>>> {
  const seen = new Set<string>()
  for (const resourceId of resourceIds) {
    if (seen.has(resourceId)) throw new Error(`Duplicate prompt resource id: ${resourceId}`)
    seen.add(resourceId)
  }

  return await Promise.all(resourceIds.map(resourceId =>
    readDocument<PromptResourceContent>(documents, resourceId, applicationDocumentTypes.promptResource)))
}

function insertPromptAssetNode(
  nodes: PromptResourceNode[],
  targetId: string,
  position: 'before' | 'inside' | 'after',
  asset: PromptResourceNode,
): { found: boolean; nodes: PromptResourceNode[] } {
  let found = false
  const nextNodes = nodes.flatMap(node => {
    if (node.id === targetId) {
      found = true
      if (position === 'before') return [asset, node]
      if (position === 'after') return [node, asset]
      if (node.kind !== 'module' && node.kind !== 'folder') {
        throw new Error(`Prompt asset cannot contain children: ${targetId}`)
      }
      return [{ ...node, children: [...(node.children ?? []), asset] }]
    }
    if (!node.children) return [node]
    const childResult = insertPromptAssetNode(node.children, targetId, position, asset)
    if (!childResult.found) return [node]
    found = true
    return [{ ...node, children: childResult.nodes }]
  })

  return { found, nodes: nextNodes }
}

function removePromptAssetNode(nodes: PromptResourceNode[], id: string): {
  nodes: PromptResourceNode[]
  removedIds: Set<string>
  removedSlotKeys: Set<string>
} {
  const removedIds = new Set<string>()
  const removedSlotKeys = new Set<string>()

  function removeInner(currentNodes: PromptResourceNode[]): PromptResourceNode[] {
    return currentNodes.flatMap(node => {
      if (node.id === id) {
        collectRemovedRefs(node, removedIds, removedSlotKeys)
        return []
      }
      if (!node.children) return [node]
      return [{ ...node, children: removeInner(node.children) }]
    })
  }

  return {
    nodes: removeInner(nodes),
    removedIds,
    removedSlotKeys,
  }
}

function collectRemovedRefs(node: PromptResourceNode, removedIds: Set<string>, removedSlotKeys: Set<string>): void {
  removedIds.add(node.id)
  if (node.capabilities?.projection?.slotKey) {
    removedSlotKeys.add(node.capabilities.projection.slotKey)
  }
  for (const child of node.children ?? []) {
    collectRemovedRefs(child, removedIds, removedSlotKeys)
  }
}

function pruneProjectionOrderRefs(nodes: PromptResourceNode[], removedIds: Set<string>, removedSlotKeys: Set<string>): PromptResourceNode[] {
  const liveSlotKeys = new Set(findNodes(nodes, node => Boolean(node.capabilities?.projection?.slotKey))
    .map(node => node.capabilities?.projection?.slotKey)
    .filter((slotKey): slotKey is string => Boolean(slotKey)))

  return nodes.map(node => ({
    ...node,
    ...(node.orderList ? { orderList: node.orderList.filter(id => !removedIds.has(id)) } : {}),
    ...(node.slotRanks ? { slotRanks: node.slotRanks.filter(rank => !removedSlotKeys.has(rank.slotKey) || liveSlotKeys.has(rank.slotKey)) } : {}),
    ...(node.children ? { children: pruneProjectionOrderRefs(node.children, removedIds, removedSlotKeys) } : {}),
  }))
}

function findNode(nodes: PromptResourceNode[], predicate: (node: PromptResourceNode) => boolean): PromptResourceNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node
    const child = node.children ? findNode(node.children, predicate) : undefined
    if (child) return child
  }
  return undefined
}

function findNodes(nodes: PromptResourceNode[], predicate: (node: PromptResourceNode) => boolean): PromptResourceNode[] {
  const results: PromptResourceNode[] = []
  for (const node of nodes) {
    if (predicate(node)) results.push(node)
    if (node.children) results.push(...findNodes(node.children, predicate))
  }
  return results
}

export function isCardBundleArtifact(value: JsonValue | undefined): value is CardBundleArtifact {
  return isObject(value)
    && value.schemaVersion === 1
    && typeof value.artifactId === 'string'
    && typeof value.displayName === 'string'
    && isObject(value.card)
    && Array.isArray(value.contextAssets)
}
