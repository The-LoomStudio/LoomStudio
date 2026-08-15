import type { DocumentRecord, DocumentStore, DocumentTransaction } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { normalizeCardContent, normalizeOpening, normalizeOptionalString, normalizePreset, normalizeSettingLayer, renderMacros } from './card.js'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from './document-store.js'
import { isObject } from './json.js'
import type {
  AgentHistoryPolicy,
  CardPresetInput,
  CardMediaRefs,
  CardSourceContent,
  OpeningChatInput,
  RuntimeRequestContext,
  SettingLayerInput,
} from './types.js'
import type {
  CompositionSkeletonPatch,
  PromptCompositionCapabilities,
  PromptContribution,
  PromptLifecycle,
  ProjectionOrderProfile,
  SourceNode,
} from './prompt-builder.js'
import { defaultCompositionSkeleton } from './prompt-builder.js'
import { combineActivationGates, isPromptActivation, type PromptActivation } from './prompt-activation.js'

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
    media?: CardMediaRefs
  }
  contextAssets: PromptResourceNode[]
  metadata?: JsonObject
}

export type PromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'

export type PromptResourceContent = {
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  linkedSettingIds?: string[]
  historyPolicy?: AgentHistoryPolicy
  origin?: {
    kind: 'builtin'
    key: string
  }
  sourceArtifactRef?: CardBundleSourceArtifactRef
  createdAt: string
  updatedAt: string
}

export type PromptResourceArtifact = {
  format: 'loom.promptResource'
  schemaVersion: 1
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
}

export type CardBundleSourceArtifactRef = {
  artifactId: string
  displayName: string
  format: 'loom.cardBundle'
  importedAt: string
  schemaVersion: CardBundleArtifact['schemaVersion']
  sourceArtifactId?: string
  blobId?: string
  sha256?: string
  sizeBytes?: number
  originalFileName?: string
  mediaType?: string
}

export type CardBundleImportManifest = {
  artifactId: string
  bindingIds: string[]
  documentIds: string[]
  assetIds: string[]
  id: string
  importedAt: string
  sourceArtifactRef: CardBundleSourceArtifactRef
}

export type ImportBundleContent = {
  cardId: string
  documentIds: string[]
  assetIds: string[]
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
  storedSourceArtifact?: Pick<
    CardBundleSourceArtifactRef,
    'sourceArtifactId' | 'blobId' | 'sha256' | 'sizeBytes' | 'originalFileName' | 'mediaType'
  >
  context?: RuntimeRequestContext
  documents: DocumentStore
  now?: string
}): Promise<{
  card: CardSourceContent & { id: string; version: number }
  importBundle: ImportBundleContent & { id: string; version: number }
}> {
  const artifact = normalizeCardBundleArtifact(input.artifact)
  const timestamp = input.now ?? nowIso()
  const sourceArtifactRef = createSourceArtifactRef(artifact, timestamp, input.storedSourceArtifact)

  const transaction = await input.documents.transact({
    actor: input.context?.clientId
      ? { kind: 'client', id: input.context.clientId }
      : applicationActor,
    reason: 'application.importCardBundle',
    correlationId: input.context?.correlationId,
    callId: input.context?.callId,
    parentCallId: input.context?.parentCallId,
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
        media: artifact.card.media,
        importBundleId,
        promptResourceIds: resources.map(resource => resource.id),
        preset: normalizePreset(artifact.card.preset),
        opening: normalizeOpening(artifact.card.opening),
        settingLayer: normalizeSettingLayer(artifact.card.settingLayer, undefined),
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
        assetIds: readCardAssetIds(artifact.card.media),
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

export async function listPromptResources(input: {
  documents: DocumentTransaction
  resourceKind?: PromptResourceKind
}): Promise<Array<PromptResourceContent & { id: string; version: number }>> {
  const resources = await listDocuments<PromptResourceContent>(input.documents, applicationDocumentTypes.promptResource)
  return resources
    .filter(resource => !input.resourceKind || resource.content.resourceKind === input.resourceKind)
    .sort((left, right) => left.content.rootNode.label.localeCompare(right.content.rootNode.label))
    .map(toVersioned)
}

export async function createPromptResource(input: {
  createId(prefix: string): string
  documents: DocumentTransaction
  name: string
  now?: string
  resourceKind: PromptResourceKind
}): Promise<PromptResourceContent & { id: string; version: number }> {
  const name = input.name.trim()
  if (!name) throw new Error('Prompt resource name cannot be empty')
  const timestamp = input.now ?? nowIso()
  const rootId = input.createId('prompt-node')
  const rootNode: PromptResourceNode = {
    id: rootId,
    label: name,
    meta: input.resourceKind === 'preset' ? 'Composition Preset' : input.resourceKind === 'setting' ? 'Setting Layer' : 'Prompt Resource',
    category: readPromptResourceCategory(input.resourceKind),
    kind: 'module',
    body: '',
    children: input.resourceKind === 'preset'
      ? [{
          id: input.createId('prompt-node'),
          label: '主排序',
          meta: 'Projection Order Profile',
          category: 'preset',
          kind: 'order',
          body: '',
          skeletonPatch: {
            zones: defaultCompositionSkeleton.zones.map(zone => ({ ...zone })),
            items: defaultCompositionSkeleton.items.map(item => ({ ...item })),
            fallbackZoneId: defaultCompositionSkeleton.fallbackZoneId,
          },
          orderList: [],
          slotRanks: [],
        }]
      : [],
  }
  const resource = await writeDocument<PromptResourceContent>(input.documents, {
    id: input.createId('prompt-resource'),
    type: applicationDocumentTypes.promptResource,
    content: {
      resourceKind: input.resourceKind,
      rootNode,
      ...(input.resourceKind === 'preset' ? { linkedSettingIds: [], historyPolicy: 'persistent' as const } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    expectedVersion: 'new',
  })
  return toVersioned(resource)
}

export async function duplicatePromptResource(input: {
  createId(prefix: string): string
  documents: DocumentTransaction
  name?: string
  now?: string
  resourceId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  const source = await readPromptResourceDocument(input.documents, input.resourceId)
  const timestamp = input.now ?? nowIso()
  const rootNode = clonePromptResourceRoot(source.content.rootNode, input.createId)
  rootNode.label = input.name?.trim() || `${source.content.rootNode.label} Copy`
  const resource = await writeDocument<PromptResourceContent>(input.documents, {
    id: input.createId('prompt-resource'),
    type: applicationDocumentTypes.promptResource,
    content: {
      resourceKind: source.content.resourceKind,
      rootNode,
      ...(source.content.resourceKind === 'preset' ? {
        linkedSettingIds: [...(source.content.linkedSettingIds ?? [])],
        historyPolicy: source.content.historyPolicy ?? 'persistent',
      } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    expectedVersion: 'new',
  })
  return toVersioned(resource)
}

export async function deletePromptResource(input: {
  documents: DocumentTransaction
  resourceId: string
}): Promise<void> {
  const resource = await readPromptResourceDocument(input.documents, input.resourceId)
  assertPromptResourceWritable(resource)
  await input.documents.delete({ id: resource.id, expectedVersion: resource.version })
}

export async function exportPromptResourceArtifact(input: {
  documents: DocumentTransaction
  resourceId: string
}): Promise<PromptResourceArtifact> {
  const resource = await readPromptResourceDocument(input.documents, input.resourceId)
  return {
    format: 'loom.promptResource',
    schemaVersion: 1,
    resourceKind: resource.content.resourceKind,
    rootNode: resource.content.rootNode,
  }
}

export async function importPromptResourceArtifact(input: {
  artifact: PromptResourceArtifact
  createId(prefix: string): string
  documents: DocumentTransaction
  now?: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  assertPromptResourceArtifact(input.artifact)
  const timestamp = input.now ?? nowIso()
  const resource = await writeDocument<PromptResourceContent>(input.documents, {
    id: input.createId('prompt-resource'),
    type: applicationDocumentTypes.promptResource,
    content: {
      resourceKind: input.artifact.resourceKind,
      rootNode: clonePromptResourceRoot(input.artifact.rootNode, input.createId),
      ...(input.artifact.resourceKind === 'preset' ? { linkedSettingIds: [], historyPolicy: 'persistent' as const } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    expectedVersion: 'new',
  })
  return toVersioned(resource)
}

export function isPromptResourceArtifact(value: JsonValue | undefined): value is PromptResourceArtifact {
  try {
    assertPromptResourceArtifact(value)
    return true
  } catch {
    return false
  }
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

export async function updateCardPromptResources(input: {
  cardId: string
  documents: DocumentTransaction
  now?: string
  promptResourceIds: string[]
}): Promise<CardSourceContent & { id: string; version: number }> {
  const card = await readDocument<CardSourceContent>(input.documents, input.cardId, applicationDocumentTypes.cardSource)
  await readPromptResourceDocumentsByIds(input.documents, input.promptResourceIds)
  const updated = await writeDocument<CardSourceContent>(input.documents, {
    id: card.id,
    type: applicationDocumentTypes.cardSource,
    content: normalizeCardContent({
      ...card.content,
      promptResourceIds: [...input.promptResourceIds],
      updatedAt: input.now ?? nowIso(),
    }),
    expectedVersion: card.version,
  })
  return toVersioned(updated)
}

export async function updatePresetSettingLinks(input: {
  documents: DocumentTransaction
  linkedSettingIds: string[]
  now?: string
  presetId: string
}): Promise<PromptResourceContent & { id: string; version: number }> {
  const preset = await readPromptResourceDocument(input.documents, input.presetId)
  if (preset.content.resourceKind !== 'preset') throw new Error(`Prompt Resource is not a Preset: ${input.presetId}`)
  assertPromptResourceWritable(preset)
  const linkedSettingIds = await validateLinkedSettingIds(input.documents, input.linkedSettingIds)
  const updated = await writeDocument<PromptResourceContent>(input.documents, {
    id: preset.id,
    type: applicationDocumentTypes.promptResource,
    content: {
      ...preset.content,
      linkedSettingIds,
      updatedAt: input.now ?? nowIso(),
    },
    expectedVersion: preset.version,
  })
  return toVersioned(updated)
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
  assertPromptResourceWritable(resource)
  const asset = applyDefaultPromptProjection(input.asset, resource.content)
  if (findNode([resource.content.rootNode], node => node.id === asset.id)) {
    throw new Error(`Prompt asset already exists: ${asset.id}`)
  }
  const result = insertPromptAssetNode([resource.content.rootNode], input.targetAssetId, input.position, asset)
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
  assertPromptResourceWritable(resource)
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
  assertPromptResourceWritable(resource)
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
  assertPromptResourceWritable(resource)
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
    ...sourceArtifact,
    schemaVersion: 1,
    artifactId: sourceArtifact?.artifactId ?? input.card.id,
    displayName: sourceArtifact?.displayName ?? cardContent.name,
    description: sourceArtifact?.description ?? cardContent.description,
    card: {
      ...sourceArtifact?.card,
      name: cardContent.name,
      userName: cardContent.userName,
      description: cardContent.description,
      preset: cardContent.preset,
      opening: cardContent.opening,
      settingLayer: cardContent.settingLayer,
      media: cardContent.media,
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
    assetIds: importBundle.content.assetIds ?? [],
    bindingIds: importBundle.content.bindings.map(binding => binding.id),
  }
}

function readCardAssetIds(media: CardMediaRefs | undefined): string[] {
  return [...new Set([media?.avatarAssetId, media?.coverAssetId].filter((value): value is string => Boolean(value)))]
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
    parentEnabled: true,
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
  const orderNodes = findNodes(nodes, node => node.kind === 'order')
  if (orderNodes.length > 1) {
    throw new Error(`Prompt Build requires exactly one main order profile; received ${orderNodes.length}`)
  }
  const orderNode = orderNodes[0]

  return {
    id: orderNode?.id ?? 'profile.resources',
    scope: 'global',
    ...(orderNode?.skeletonPatch ? { skeletonPatch: orderNode.skeletonPatch } : {}),
    slotRanks: orderNode?.slotRanks ?? [],
  }
}

export function normalizeCardBundleArtifact(artifact: CardBundleArtifact): CardBundleArtifact {
  assertCardBundleArtifact(artifact)

  return {
    ...artifact,
    schemaVersion: 1,
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    description: artifact.description,
    card: artifact.card,
    contextAssets: artifact.contextAssets ?? [],
    metadata: artifact.metadata ?? {},
  }
}

function createSourceArtifactRef(
  artifact: CardBundleArtifact,
  importedAt: string,
  stored?: Pick<
    CardBundleSourceArtifactRef,
    'sourceArtifactId' | 'blobId' | 'sha256' | 'sizeBytes' | 'originalFileName' | 'mediaType'
  >,
): CardBundleSourceArtifactRef {
  return {
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    format: 'loom.cardBundle',
    importedAt,
    schemaVersion: artifact.schemaVersion,
    ...stored,
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
  parentEnabled: boolean
  parentId: string | null
  sourceNodes: SourceNode[]
}): void {
  for (const [index, node] of input.nodes.entries()) {
    const category = node.category ?? input.inheritedCategory
    const sourceId = node.kind === 'module' ? node.id : input.inheritedSourceId ?? node.id
    const effectiveEnabled = input.parentEnabled && node.enabled !== false
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

    if (effectiveEnabled && category && isPromptContributionNode(node, category)) {
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
            lifecycle: { lifecycle: readPromptLifecycle(node.capabilities.lifecycle?.lifecycle) },
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
        parentEnabled: effectiveEnabled,
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

function readPromptLifecycle(value: string | undefined): PromptLifecycle {
  return value === 'conditional' || value === 'fresh' ? value : 'always'
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
  assertUniquePromptResourceNodeIds(rootNode)
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

async function validateLinkedSettingIds(
  documents: DocumentTransaction,
  settingIds: string[],
): Promise<string[]> {
  const normalized = [...new Set(settingIds)]
  if (normalized.length !== settingIds.length) throw new Error('Preset linked Setting ids cannot contain duplicates')
  const settings = await readPromptResourceDocumentsByIds(documents, normalized)
  const invalid = settings.find(setting => setting.content.resourceKind !== 'setting')
  if (invalid) throw new Error(`Preset can only link Setting resources: ${invalid.id}`)
  return normalized
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

function readPromptResourceCategory(resourceKind: PromptResourceKind): PromptResourceNode['category'] | undefined {
  if (resourceKind === 'preset' || resourceKind === 'setting' || resourceKind === 'logic' || resourceKind === 'runtime' || resourceKind === 'history') {
    return resourceKind
  }
  return undefined
}

function applyDefaultPromptProjection(asset: PromptResourceNode, resource: PromptResourceContent): PromptResourceNode {
  if (asset.kind !== 'entry' || asset.capabilities?.projection) return asset
  if (resource.resourceKind !== 'preset' && resource.resourceKind !== 'setting') return asset

  const preset = resource.resourceKind === 'preset'
  const zoneId = preset ? 'preset.system' : 'setting.stable'
  const slotKey = `${preset ? 'preset' : 'setting-layer'}:${resource.rootNode.id}@${zoneId}`
  const entryOrders = findNodes([resource.rootNode], node => node.capabilities?.projection?.slotKey === slotKey)
    .map(node => node.capabilities?.projection?.entryOrderHint)
    .filter((value): value is number => typeof value === 'number')
  const entryOrderHint = entryOrders.length ? Math.max(...entryOrders) + 10 : 10

  return {
    ...asset,
    capabilities: {
      ...asset.capabilities,
      ...(preset ? {} : { activation: asset.capabilities?.activation ?? { kind: 'always' as const } }),
      lifecycle: asset.capabilities?.lifecycle ?? { lifecycle: 'always' },
      projection: {
        zoneId,
        slotKey,
        entryOrderHint,
        slotOrderHint: preset ? 100 : 200,
      },
    },
  }
}

function assertPromptResourceWritable(resource: DocumentRecord<PromptResourceContent>): void {
  if (resource.content.origin?.kind === 'builtin') {
    throw new Error(`Built-in Prompt Resource is read-only; duplicate it before editing: ${resource.id}`)
  }
}

function clonePromptResourceRoot(
  rootNode: PromptResourceNode,
  createNodeId: (prefix: string) => string,
): PromptResourceNode {
  const idMap = new Map(findNodes([rootNode], () => true).map(node => [node.id, createNodeId('prompt-node')]))
  const replaceNodeIds = (value: string): string => {
    let next = value
    for (const [sourceId, targetId] of [...idMap.entries()].sort((left, right) => right[0].length - left[0].length)) {
      next = next.split(sourceId).join(targetId)
    }
    return next
  }
  const cloneNode = (node: PromptResourceNode): PromptResourceNode => ({
    ...node,
    id: idMap.get(node.id)!,
    ...(node.orderList ? { orderList: node.orderList.map(id => idMap.get(id) ?? id) } : {}),
    ...(node.slotRanks ? {
      slotRanks: node.slotRanks.map(rank => ({ ...rank, slotKey: replaceNodeIds(rank.slotKey) })),
    } : {}),
    ...(node.capabilities?.projection?.slotKey ? {
      capabilities: {
        ...node.capabilities,
        projection: {
          ...node.capabilities.projection,
          slotKey: replaceNodeIds(node.capabilities.projection.slotKey),
        },
      },
    } : {}),
    ...(node.children ? { children: node.children.map(cloneNode) } : {}),
  })

  return cloneNode(rootNode)
}

function assertPromptResourceArtifact(value: unknown): asserts value is PromptResourceArtifact {
  if (!isObject(value)) throw new Error('Prompt Resource artifact must be an object')
  if (value.format !== 'loom.promptResource') throw new Error(`Unsupported Prompt Resource artifact format: ${String(value.format)}`)
  if (value.schemaVersion !== 1) throw new Error(`Unsupported Prompt Resource artifact schemaVersion: ${String(value.schemaVersion)}`)
  if (!isPromptResourceKind(value.resourceKind)) throw new Error(`Invalid Prompt Resource kind: ${String(value.resourceKind)}`)
  assertPromptResourceNode(value.rootNode, 'rootNode')
  assertUniquePromptResourceNodeIds(value.rootNode)
}

function isPromptResourceKind(value: unknown): value is PromptResourceKind {
  return value === 'preset'
    || value === 'setting'
    || value === 'logic'
    || value === 'runtime'
    || value === 'history'
    || value === 'prompt'
}

export function isCardBundleArtifact(value: JsonValue | undefined): value is CardBundleArtifact {
  try {
    assertCardBundleArtifact(value)
    return true
  } catch {
    return false
  }
}

function assertCardBundleArtifact(value: unknown): asserts value is CardBundleArtifact {
  if (!isObject(value)) throw new Error('Card bundle must be an object')
  if (value.schemaVersion !== 1) throw new Error(`Unsupported card bundle schemaVersion: ${String(value.schemaVersion)}`)
  assertNonEmptyString(value.artifactId, 'Card bundle artifactId')
  assertNonEmptyString(value.displayName, 'Card bundle displayName')
  if (value.description !== undefined && typeof value.description !== 'string') throw new Error('Card bundle description must be a string')
  assertCardBundleCard(value.card)
  if (!Array.isArray(value.contextAssets)) throw new Error('Card bundle contextAssets must be an array')
  for (const [index, node] of value.contextAssets.entries()) {
    assertPromptResourceNode(node, `contextAssets[${index}]`)
    assertUniquePromptResourceNodeIds(node)
  }
  if (value.metadata !== undefined && !isObject(value.metadata)) throw new Error('Card bundle metadata must be an object')
}

function assertCardBundleCard(value: unknown): asserts value is CardBundleArtifact['card'] {
  if (!isObject(value)) throw new Error('Card bundle card must be an object')
  assertNonEmptyString(value.name, 'Card bundle card.name')
  assertOptionalString(value.userName, 'Card bundle card.userName')
  assertOptionalString(value.description, 'Card bundle card.description')

  if (value.preset !== undefined) {
    if (!isObject(value.preset)) throw new Error('Card bundle card.preset must be an object')
    assertOptionalString(value.preset.system, 'Card bundle card.preset.system')
  }

  if (value.opening !== undefined && typeof value.opening !== 'string') {
    if (!isObject(value.opening)) throw new Error('Card bundle card.opening must be a string or object')
    if (value.opening.entries !== undefined && !Array.isArray(value.opening.entries)) {
      throw new Error('Card bundle card.opening.entries must be an array')
    }
    for (const [index, entry] of (value.opening.entries ?? []).entries()) {
      if (!isObject(entry) || typeof entry.content !== 'string') {
        throw new Error(`Card bundle opening entry must contain string content: ${index}`)
      }
      if (entry.role !== undefined && entry.role !== 'user' && entry.role !== 'assistant') {
        throw new Error(`Card bundle opening entry role is invalid: ${index}`)
      }
    }
  }

  if (value.settingLayer !== undefined) {
    if (!isObject(value.settingLayer)) throw new Error('Card bundle card.settingLayer must be an object')
    if (value.settingLayer.entries !== undefined && !Array.isArray(value.settingLayer.entries)) {
      throw new Error('Card bundle card.settingLayer.entries must be an array')
    }
    for (const [index, entry] of (value.settingLayer.entries ?? []).entries()) {
      if (!isObject(entry) || typeof entry.content !== 'string') {
        throw new Error(`Card bundle setting entry must contain string content: ${index}`)
      }
      assertOptionalString(entry.id, `Card bundle setting entry id: ${index}`)
      assertOptionalString(entry.path, `Card bundle setting entry path: ${index}`)
      assertOptionalString(entry.title, `Card bundle setting entry title: ${index}`)
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
        throw new Error(`Card bundle setting entry enabled must be boolean: ${index}`)
      }
      if (entry.activation !== undefined && !isPromptActivation(entry.activation)) {
        throw new Error(`Card bundle setting entry activation is invalid: ${index}`)
      }
      if (entry.tags !== undefined && (!Array.isArray(entry.tags) || !entry.tags.every(tag => typeof tag === 'string'))) {
        throw new Error(`Card bundle setting entry tags must be strings: ${index}`)
      }
    }
  }
}

function assertPromptResourceNode(value: unknown, path: string): asserts value is PromptResourceNode {
  if (!isObject(value)) throw new Error(`Prompt resource node must be an object: ${path}`)
  assertNonEmptyString(value.id, `Prompt resource node id: ${path}`)
  if (typeof value.label !== 'string') throw new Error(`Prompt resource node label must be a string: ${path}`)
  if (!isPromptResourceNodeKind(value.kind)) throw new Error(`Prompt resource node kind is invalid: ${path}`)
  if (value.category !== undefined && !isPromptResourceNodeCategory(value.category)) {
    throw new Error(`Prompt resource node category is invalid: ${path}`)
  }
  assertOptionalString(value.body, `Prompt resource node body: ${path}`)
  assertOptionalString(value.meta, `Prompt resource node meta: ${path}`)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error(`Prompt resource node enabled must be boolean: ${path}`)
  if (value.isSection !== undefined && typeof value.isSection !== 'boolean') throw new Error(`Prompt resource node isSection must be boolean: ${path}`)

  if (value.configRows !== undefined) {
    if (!Array.isArray(value.configRows) || !value.configRows.every(row => isObject(row) && typeof row.label === 'string' && typeof row.value === 'string')) {
      throw new Error(`Prompt resource node configRows are invalid: ${path}`)
    }
  }
  assertOptionalStringArray(value.orderList, `Prompt resource node orderList: ${path}`)
  assertSlotRanks(value.slotRanks, path)
  assertSkeletonPatch(value.skeletonPatch, path)
  assertPromptResourceCapabilities(value.capabilities, path)

  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) throw new Error(`Prompt resource node children must be an array: ${path}`)
    value.children.forEach((child, index) => assertPromptResourceNode(child, `${path}.children[${index}]`))
  }
}

function assertUniquePromptResourceNodeIds(rootNode: PromptResourceNode): void {
  const ids = new Set<string>()
  const visit = (node: PromptResourceNode): void => {
    if (ids.has(node.id)) throw new Error(`Duplicate prompt resource node id: ${node.id}`)
    ids.add(node.id)
    node.children?.forEach(visit)
  }
  visit(rootNode)
}

function assertPromptResourceCapabilities(value: JsonValue | undefined, path: string): void {
  if (value === undefined) return
  if (!isObject(value)) throw new Error(`Prompt resource capabilities must be an object: ${path}`)
  if (value.activation !== undefined && !isPromptActivation(value.activation)) throw new Error(`Prompt resource activation is invalid: ${path}`)
  if (value.content !== undefined && (!isObject(value.content) || value.content.kind !== 'text')) throw new Error(`Prompt resource content capability is invalid: ${path}`)
  if (value.lifecycle !== undefined && (!isObject(value.lifecycle) || typeof value.lifecycle.lifecycle !== 'string')) throw new Error(`Prompt resource lifecycle is invalid: ${path}`)
  if (value.projection !== undefined) {
    if (!isObject(value.projection) || typeof value.projection.zoneId !== 'string') throw new Error(`Prompt resource projection is invalid: ${path}`)
    assertOptionalString(value.projection.slotKey, `Prompt resource projection slotKey: ${path}`)
    assertOptionalNumber(value.projection.entryOrderHint, `Prompt resource projection entryOrderHint: ${path}`)
    assertOptionalNumber(value.projection.slotOrderHint, `Prompt resource projection slotOrderHint: ${path}`)
    if (value.projection.sourceKind !== undefined && value.projection.sourceKind !== 'actual' && value.projection.sourceKind !== 'virtual') {
      throw new Error(`Prompt resource projection sourceKind is invalid: ${path}`)
    }
  }
  if (value.resolution !== undefined) {
    if (!isObject(value.resolution) || typeof value.resolution.semanticSlotKey !== 'string') throw new Error(`Prompt resource resolution is invalid: ${path}`)
    if (!['append', 'merge', 'replace', 'single'].includes(String(value.resolution.policy))) throw new Error(`Prompt resource resolution policy is invalid: ${path}`)
    assertOptionalNumber(value.resolution.priorityHint, `Prompt resource resolution priorityHint: ${path}`)
  }
  if (value.render !== undefined) {
    if (!isObject(value.render)) throw new Error(`Prompt resource render capability is invalid: ${path}`)
    if (value.render.wrapper !== undefined && !['section', 'message', 'inline'].includes(String(value.render.wrapper))) throw new Error(`Prompt resource render wrapper is invalid: ${path}`)
    if (value.render.roleHint !== undefined && !['system', 'assistant', 'user'].includes(String(value.render.roleHint))) throw new Error(`Prompt resource render roleHint is invalid: ${path}`)
    assertOptionalString(value.render.label, `Prompt resource render label: ${path}`)
  }
}

function assertSlotRanks(value: JsonValue | undefined, path: string): void {
  if (value === undefined) return
  if (!Array.isArray(value) || !value.every(rank => isObject(rank) && typeof rank.zoneId === 'string' && typeof rank.slotKey === 'string' && typeof rank.rankKey === 'string')) {
    throw new Error(`Prompt resource slotRanks are invalid: ${path}`)
  }
}

function assertSkeletonPatch(value: JsonValue | undefined, path: string): void {
  if (value === undefined) return
  if (!isObject(value)) throw new Error(`Prompt resource skeletonPatch must be an object: ${path}`)
  assertOptionalString(value.fallbackZoneId, `Prompt resource fallbackZoneId: ${path}`)
  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) throw new Error(`Prompt resource composition items must be an array: ${path}`)
    value.items.forEach((item, index) => assertCompositionItem(item, `${path}.items[${index}]`))
  }
  if (value.zones === undefined) return
  if (!Array.isArray(value.zones)) throw new Error(`Prompt resource skeleton zones must be an array: ${path}`)
  for (const zone of value.zones) {
    if (!isObject(zone)
      || typeof zone.id !== 'string'
      || (zone.parentId !== null && typeof zone.parentId !== 'string')
      || typeof zone.displayName !== 'string'
      || !['stable-prefix', 'narrative', 'lower-context', 'current-turn', 'fresh-tail'].includes(String(zone.band))
      || typeof zone.orderIndex !== 'number'
      || !isObject(zone.renderHint)
      || !['system', 'assistant', 'user'].includes(String(zone.renderHint.providerRoleHint))
      || !['section', 'message'].includes(String(zone.renderHint.wrapper))) {
      throw new Error(`Prompt resource skeleton zone is invalid: ${path}`)
    }
    if (zone.accepts !== undefined && (!Array.isArray(zone.accepts) || !zone.accepts.every(kind => ['preset', 'settingLayer', 'narrativeChat', 'runtime'].includes(String(kind))))) {
      throw new Error(`Prompt resource skeleton zone accepts are invalid: ${path}`)
    }
  }
}

function assertCompositionItem(value: JsonValue, path: string): void {
  if (!isObject(value)
    || typeof value.id !== 'string'
    || typeof value.displayName !== 'string'
    || typeof value.orderIndex !== 'number'
    || (value.kind !== 'zone' && value.kind !== 'slot' && value.kind !== 'entry')) {
    throw new Error(`Prompt resource composition item is invalid: ${path}`)
  }
  if (value.kind === 'slot' && typeof value.bindingId !== 'string') {
    throw new Error(`Prompt resource slot bindingId is invalid: ${path}`)
  }
  if (value.kind === 'entry') {
    if (!isObject(value.source)
      || (value.source.kind !== 'preset' && value.source.kind !== 'binding')
      || typeof (value.source.kind === 'preset' ? value.source.nodeId : value.source.bindingId) !== 'string') {
      throw new Error(`Prompt resource entry source is invalid: ${path}`)
    }
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string`)
}

function assertOptionalNumber(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'number') throw new Error(`${label} must be a number`)
}

function assertOptionalStringArray(value: unknown, label: string): void {
  if (value !== undefined && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))) {
    throw new Error(`${label} must be a string array`)
  }
}

function isPromptResourceNodeKind(value: unknown): value is PromptResourceNode['kind'] {
  return value === 'module' || value === 'folder' || value === 'entry' || value === 'script' || value === 'virtual' || value === 'order'
}

function isPromptResourceNodeCategory(value: unknown): value is NonNullable<PromptResourceNode['category']> {
  return value === 'preset' || value === 'setting' || value === 'logic' || value === 'runtime' || value === 'history'
}
