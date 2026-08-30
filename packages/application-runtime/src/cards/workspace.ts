import type { DocumentRecord, DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createId, nowIso } from '@loom-studio/shared'
import { normalizeOpening, normalizeOptionalString, normalizePreset, normalizeSettingLayer } from './card.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { isObject } from '../foundation/json.js'
import type {
  AgentHistoryPolicy,
  CardPresetInput,
  CardMediaRefs,
  CardSourceContent,
  OpeningChatInput,
  RuntimeRequestContext,
  SettingLayerInput,
} from '../types.js'
import type {
  CompositionSkeletonPatch,
  PromptCompositionCapabilities,
  PromptContribution,
  PromptLifecycle,
  ProjectionOrderProfile,
  SourceNode,
} from '../prompt/prompt-builder.js'
import { combineActivationGates, isPromptActivation, type PromptActivation } from '../prompt/prompt-activation.js'
import { fromStoredResource } from '../prompt/prompt-resource-mapper.js'
import { renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import { validateStateDefinitionDraft, validateTimelineStateBinding } from '../state/state-definition.js'
import type { StateDefinitionContent, StateDefinitionDraft, TimelineStateBinding } from '../types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

function requireSqliteDocumentParticipant(documents: DocumentStore): SqliteDocumentStore {
  const participant = documents as Partial<SqliteDocumentStore>
  if (typeof participant.participateTransaction !== 'function') {
    throw new Error('Shared Sqlite Document Store participant is required')
  }
  return documents as SqliteDocumentStore
}

export type CardBundleArtifact = {
  schemaVersion: 2
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
  stateTemplates?: Array<{
    id: string
    templateVersion: number
    schema: JsonObject
    initial: JsonObject
    label?: string
  }>
  timelineStateBindings?: TimelineStateBinding[]
  extensionPayloads?: PortableExtensionPayloadArtifact[]
  metadata?: JsonObject
}

export type PortableExtensionPayloadArtifact = {
  id: string
  packageId: string
  fileName: string
  format: string
  mediaType: string
  schemaVersion?: number
  requirement?: {
    versionRange?: string
  }
  metadata?: JsonObject
  content: string
}

export type PortableExtensionPayloadContent = Omit<PortableExtensionPayloadArtifact, 'id'> & {
  artifactPayloadId: string
  createdAt: string
  updatedAt: string
}

export type PromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'

export type PromptResourceContent = {
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  historyPolicy?: AgentHistoryPolicy
  origin?: {
    kind: 'builtin'
    key: string
  } | {
    kind: 'extension-package'
    packageId: string
    packageVersion: string
    contributionId: string
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
  promptResourceIds: string[]
  assetIds: string[]
  id: string
  importedAt: string
  sourceArtifactRef: CardBundleSourceArtifactRef
}

export type ImportBundleContent = {
  cardId: string
  documentIds: string[]
  promptResourceIds: string[]
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
  documentId?: string
  documentType?: string
  resourceId?: string
  resourceKind?: PromptResourceKind
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
  extra?: JsonObject
}

export type PromptResourceCompositionCapabilities = Omit<PromptCompositionCapabilities, 'activation' | 'lifecycle' | 'projection'> & {
  activation?: PromptActivation
  lifecycle?: { lifecycle: 'always' | 'conditional' | 'fresh' | string }
  projection?: {
    entryOrderHint?: number
    zoneId: string
    bindingId?: string
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
  promptResources: PromptResourceStore
  dataEngine: import('@loom-studio/data-engine').SqliteDataEngine
  now?: string
}): Promise<{
  card: CardSourceContent & { id: string; version: number }
  importBundle: ImportBundleContent & { id: string; version: number }
}> {
  const artifact = normalizeCardBundleArtifact(input.artifact)
  const timestamp = input.now ?? nowIso()
  const sourceArtifactRef = createSourceArtifactRef(artifact, timestamp, input.storedSourceArtifact)
  const contextAssets = await cloneConflictingPromptNodes(input.promptResources, artifact.contextAssets)

  const documentParticipant = requireSqliteDocumentParticipant(input.documents)
  const transaction = await input.dataEngine.transact({
    actor: input.context?.actor
      ?? (input.context?.clientId ? { kind: 'client', id: input.context.clientId } : applicationActor),
    reason: 'application.importCardBundle',
    correlationId: input.context?.correlationId,
    callId: input.context?.callId,
    parentCallId: input.context?.parentCallId,
  }, async dataTx => {
    const resourceTx = input.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async tx => {
      const cardId = createId('card')
      const importBundleId = createId('import-bundle')
      const storedResources = contextAssets.map(node => resourceTx.createResource({
        id: createId('prompt-resource'),
        resourceKind: node.category ?? 'prompt',
        label: node.label,
        metadata: { sourceArtifactRef },
        rootNode: node,
      }))
      const resourceIds = storedResources.map(resource => resource.id)
      const portablePayloadDocuments: DocumentRecord<PortableExtensionPayloadContent>[] = []
      for (const payload of artifact.extensionPayloads ?? []) {
        const { id: artifactPayloadId, ...portablePayload } = payload
        portablePayloadDocuments.push(await writeDocument<PortableExtensionPayloadContent>(tx, {
          id: createId('portable-payload'),
          type: applicationDocumentTypes.portableExtensionPayload,
          content: {
            ...structuredClone(portablePayload),
            artifactPayloadId,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        }))
      }
      const portableExtensionPayloadIds = portablePayloadDocuments.map(document => document.id)
      const stateDefinitionIds: string[] = []
      for (const template of artifact.stateTemplates ?? []) {
        const definition = {
          kind: 'timeline-template' as const,
          templateVersion: template.templateVersion,
          schema: template.schema,
          initial: template.initial,
          ...(template.label !== undefined ? { label: template.label } : {}),
        }
        validateStateDefinitionDraft(definition)
        const existing = await tx.get(template.id)
        if (existing) {
          if (existing.type !== applicationDocumentTypes.stateDefinition
            || !sameTimelineTemplate(existing.content, definition)) {
            throw new Error(`State template identity conflict: ${template.id}`)
          }
        } else {
          await writeDocument<StateDefinitionContent>(tx, {
            id: template.id,
            type: applicationDocumentTypes.stateDefinition,
            content: { ...definition, createdAt: timestamp, updatedAt: timestamp },
            expectedVersion: 'new',
          })
        }
        stateDefinitionIds.push(template.id)
      }
      const artifactTemplates = new Map((artifact.stateTemplates ?? []).map(template => [template.id, template]))
      for (const binding of artifact.timelineStateBindings ?? []) {
        validateTimelineStateBinding(binding)
        const template = artifactTemplates.get(binding.templateId)
        if (!template) throw new Error(`Timeline State Binding template is missing from Card Bundle: ${binding.templateId}`)
        if (template.templateVersion !== binding.templateVersion) {
          throw new Error(`Timeline State Binding template version mismatch: ${binding.templateId}`)
        }
      }
      const card = await writeDocument<CardSourceContent>(tx, {
        id: cardId,
        type: applicationDocumentTypes.cardSource,
        content: {
          name: artifact.card.name,
          userName: normalizeOptionalString(artifact.card.userName),
          description: artifact.card.description,
          media: artifact.card.media,
          importBundleId,
          portableExtensionPayloadIds,
          promptResourceIds: resourceIds,
          stateDefinitionIds,
          timelineStateBindings: structuredClone(artifact.timelineStateBindings ?? []),
          preset: normalizePreset(artifact.card.preset),
          opening: normalizeOpening(artifact.card.opening),
          settingLayer: normalizeSettingLayer(artifact.card.settingLayer, undefined),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      const bindings = storedResources.filter(resource => resource.rootNode.kind === 'module' && (resource.rootNode.category === 'setting' || resource.rootNode.category === 'preset')).map(resource => ({
        id: `binding.${resource.id}.${resource.rootNode.id}`,
        relationship: 'recommends' as const,
        createdAt: timestamp,
        from: { documentId: card.id, documentType: applicationDocumentTypes.cardSource },
        to: { resourceId: resource.id, resourceKind: resource.resourceKind, nodeId: resource.rootNode.id },
      }))
      const importBundle = await writeDocument<ImportBundleContent>(tx, {
        id: importBundleId,
        type: applicationDocumentTypes.importBundle,
        content: {
          cardId: card.id,
          documentIds: [card.id, importBundleId, ...stateDefinitionIds, ...portableExtensionPayloadIds],
          promptResourceIds: resourceIds,
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
  })

  return {
    card: toVersioned(transaction.value.value.card),
    importBundle: toVersioned(transaction.value.value.importBundle),
  }
}

export function isPromptResourceArtifact(value: JsonValue | undefined): value is PromptResourceArtifact {
  try {
    assertPromptResourceArtifact(value)
    return true
  } catch {
    return false
  }
}

export async function exportCardArtifact(input: {
  cardId: string
  documents: DocumentStore
  promptResources: PromptResourceStore
}): Promise<CardBundleArtifact> {
  const card = await readDocument<CardSourceContent>(input.documents, input.cardId, applicationDocumentTypes.cardSource)
  const importBundle = await readOptionalCardImportBundle(input.documents, card)
  const contextAssets = await Promise.all((card.content.promptResourceIds ?? []).map(async resourceId => {
        const resource = await input.promptResources.getResource(resourceId)
        if (!resource) throw new Error(`Prompt resource not found: ${resourceId}`)
        return fromStoredResource(resource).rootNode
      }))
  const stateTemplates = await Promise.all((card.content.stateDefinitionIds ?? []).map(async definitionId => {
    const definition = await readDocument<StateDefinitionContent>(input.documents, definitionId, applicationDocumentTypes.stateDefinition)
    if (definition.content.kind !== 'timeline-template') throw new Error(`Card State Definition is not a timeline template: ${definitionId}`)
    return {
      id: definition.id,
      templateVersion: definition.content.templateVersion,
      schema: definition.content.schema,
      initial: definition.content.initial,
      ...(definition.content.label !== undefined ? { label: definition.content.label } : {}),
    }
  }))
  const extensionPayloads = await Promise.all((card.content.portableExtensionPayloadIds ?? []).map(async payloadId => {
    const payload = await readDocument<PortableExtensionPayloadContent>(
      input.documents,
      payloadId,
      applicationDocumentTypes.portableExtensionPayload,
    )
    return toPortableExtensionPayloadArtifact(payload.content)
  }))

  return buildExportArtifact({ card, contextAssets, stateTemplates, extensionPayloads, importBundle })
}

function buildExportArtifact(input: {
  card: DocumentRecord<CardSourceContent>
  contextAssets: PromptResourceNode[]
  stateTemplates: NonNullable<CardBundleArtifact['stateTemplates']>
  extensionPayloads: PortableExtensionPayloadArtifact[]
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
    schemaVersion: 2,
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
    stateTemplates: input.stateTemplates,
    timelineStateBindings: structuredClone(cardContent.timelineStateBindings ?? []),
    extensionPayloads: input.extensionPayloads.map(payload => structuredClone(payload)),
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
    promptResourceIds: importBundle.content.promptResourceIds,
    assetIds: importBundle.content.assetIds ?? [],
    bindingIds: importBundle.content.bindings.map(binding => binding.id),
  }
}

function readCardAssetIds(media: CardMediaRefs | undefined): string[] {
  return [...new Set([media?.avatarAssetId, media?.coverAssetId].filter((value): value is string => Boolean(value)))]
}

async function cloneConflictingPromptNodes(
  store: PromptResourceStore,
  nodes: PromptResourceNode[],
): Promise<PromptResourceNode[]> {
  const existingNodeIds = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await store.listResources({ cursor, limit: 500 })
    for (const resource of page.resources) {
      for (const node of findNodes([fromStoredResource(resource).rootNode], () => true)) existingNodeIds.add(node.id)
    }
    cursor = page.nextCursor
  } while (cursor)

  return nodes.map(node => {
    const nodeIds = findNodes([node], () => true).map(item => item.id)
    return nodeIds.some(id => existingNodeIds.has(id)) ? clonePromptResourceNode(node) : node
  })
}

function clonePromptResourceNode(rootNode: PromptResourceNode): PromptResourceNode {
  const idMap = new Map(findNodes([rootNode], () => true).map(node => [node.id, createId('prompt-node')]))
  const replaceId = (value: string): string => idMap.get(value) ?? value
  const clone = (node: PromptResourceNode): PromptResourceNode => ({
    ...node,
    id: idMap.get(node.id) ?? createId('prompt-node'),
    ...(node.orderList ? { orderList: node.orderList.map(replaceId) } : {}),
    ...(node.slotRanks ? { slotRanks: node.slotRanks.map(rank => ({ ...rank, slotKey: replaceId(rank.slotKey) })) } : {}),
    ...(node.capabilities?.projection?.slotKey ? {
      capabilities: {
        ...node.capabilities,
        projection: { ...node.capabilities.projection, slotKey: replaceId(node.capabilities.projection.slotKey) },
      },
    } : {}),
    ...(node.children ? { children: node.children.map(clone) } : {}),
  })
  return clone(rootNode)
}

async function readOptionalCardImportBundle(
  documents: DocumentTransaction,
  card: DocumentRecord<CardSourceContent>,
): Promise<DocumentRecord<ImportBundleContent> | undefined> {
  if (!card.content.importBundleId) return undefined
  return await readDocument<ImportBundleContent>(documents, card.content.importBundleId, applicationDocumentTypes.importBundle)
}

export async function readPromptResourceInputs(input: {
  promptResources: PromptResourceStore
  resourceIds: string[]
  variables: VariableRenderContext
}): Promise<{
  orderProfile: ProjectionOrderProfile
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
}> {
  if (!input.promptResources) throw new Error('Prompt Resource Store is required')
  if (new Set(input.resourceIds).size !== input.resourceIds.length) throw new Error('Duplicate prompt resource id')
  const resources = []
  for (const resourceId of input.resourceIds) {
    const resource = await input.promptResources.getResource(resourceId)
    if (!resource) throw new Error(`Prompt resource not found: ${resourceId}`)
    resources.push(fromStoredResource(resource))
  }
  return collectPromptInputsFromNodes(resources.map(resource => resource.rootNode), input.variables)
}

function collectPromptInputsFromNodes(
  contextAssets: PromptResourceNode[],
  variables: VariableRenderContext,
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
    variables,
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
    schemaVersion: 2,
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    description: artifact.description,
    card: artifact.card,
    contextAssets: artifact.contextAssets ?? [],
    extensionPayloads: structuredClone(artifact.extensionPayloads ?? []),
    metadata: artifact.metadata ?? {},
  }
}

function toPortableExtensionPayloadArtifact(content: PortableExtensionPayloadContent): PortableExtensionPayloadArtifact {
  return {
    id: content.artifactPayloadId,
    packageId: content.packageId,
    fileName: content.fileName,
    format: content.format,
    mediaType: content.mediaType,
    ...(content.schemaVersion !== undefined ? { schemaVersion: content.schemaVersion } : {}),
    ...(content.requirement !== undefined ? { requirement: structuredClone(content.requirement) } : {}),
    ...(content.metadata !== undefined ? { metadata: structuredClone(content.metadata) } : {}),
    content: content.content,
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

function collectPromptInputs(input: {
  contributions: PromptContribution[]
  inheritedCategory: PromptResourceNode['category'] | undefined
  inheritedSourceId: string | undefined
  variables: VariableRenderContext
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
          content: renderVariableMacros(node.body, input.variables),
          capabilities: {
            content: { kind: 'text' },
            ...(effectiveActivation ? { activation: effectiveActivation } : {}),
            lifecycle: { lifecycle: readPromptLifecycle(node.capabilities.lifecycle?.lifecycle) },
            projection: {
              zoneId: node.capabilities.projection.zoneId,
              ...(node.capabilities.projection.bindingId ? { bindingId: node.capabilities.projection.bindingId } : {}),
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

function findNodes(nodes: PromptResourceNode[], predicate: (node: PromptResourceNode) => boolean): PromptResourceNode[] {
  const results: PromptResourceNode[] = []
  for (const node of nodes) {
    if (predicate(node)) results.push(node)
    if (node.children) results.push(...findNodes(node.children, predicate))
  }
  return results
}

export function applyDefaultPromptProjection(asset: PromptResourceNode, resource: PromptResourceContent): PromptResourceNode {
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
  if (value.schemaVersion !== 2) throw new Error(`Unsupported card bundle schemaVersion: ${String(value.schemaVersion)}`)
  assertNonEmptyString(value.artifactId, 'Card bundle artifactId')
  assertNonEmptyString(value.displayName, 'Card bundle displayName')
  if (value.description !== undefined && typeof value.description !== 'string') throw new Error('Card bundle description must be a string')
  assertCardBundleCard(value.card)
  if (!Array.isArray(value.contextAssets)) throw new Error('Card bundle contextAssets must be an array')
  for (const [index, node] of value.contextAssets.entries()) {
    assertPromptResourceNode(node, `contextAssets[${index}]`)
    assertUniquePromptResourceNodeIds(node)
  }
  if (value.stateTemplates !== undefined) {
    if (!Array.isArray(value.stateTemplates)) throw new Error('Card bundle stateTemplates must be an array')
    const ids = new Set<string>()
    for (const [index, template] of value.stateTemplates.entries()) {
      if (!isObject(template)) throw new Error(`Card bundle state template must be an object: ${index}`)
      assertNonEmptyString(template.id, `Card bundle state template id: ${index}`)
      if (ids.has(template.id)) throw new Error(`Duplicate State template id: ${template.id}`)
      ids.add(template.id)
      validateStateDefinitionDraft({
        kind: 'timeline-template',
        templateVersion: template.templateVersion as number,
        schema: template.schema as JsonObject,
        initial: template.initial as JsonObject,
        ...(typeof template.label === 'string' ? { label: template.label } : {}),
      })
    }
  }
  if (value.timelineStateBindings !== undefined) {
    if (!Array.isArray(value.timelineStateBindings)) throw new Error('Card bundle timelineStateBindings must be an array')
    for (const binding of value.timelineStateBindings) validateTimelineStateBinding(binding as TimelineStateBinding)
  }
  assertPortableExtensionPayloads(value.extensionPayloads)
  if (value.metadata !== undefined && !isObject(value.metadata)) throw new Error('Card bundle metadata must be an object')
}

const portablePayloadTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const portablePayloadFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const maxPortablePayloadCount = 64
const maxPortablePayloadBytes = 1024 * 1024
const maxPortablePayloadTotalBytes = 8 * 1024 * 1024

function assertPortableExtensionPayloads(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('Card bundle extensionPayloads must be an array')
  if (value.length > maxPortablePayloadCount) {
    throw new Error(`Card bundle extensionPayloads exceed ${maxPortablePayloadCount} entries`)
  }

  const ids = new Set<string>()
  let totalBytes = 0
  for (const [index, payload] of value.entries()) {
    if (!isObject(payload)) throw new Error(`Card bundle Extension Payload must be an object: ${index}`)
    assertPortablePayloadToken(payload.id, `Card bundle Extension Payload id: ${index}`)
    if (ids.has(payload.id)) throw new Error(`Duplicate Extension Payload id: ${payload.id}`)
    ids.add(payload.id)
    assertPortablePayloadToken(payload.packageId, `Card bundle Extension Payload packageId: ${index}`)
    if (typeof payload.fileName !== 'string' || !portablePayloadFileNamePattern.test(payload.fileName)) {
      throw new Error(`Card bundle Extension Payload fileName is invalid: ${index}`)
    }
    assertBoundedNonEmptyString(payload.format, `Card bundle Extension Payload format: ${index}`, 128)
    assertBoundedNonEmptyString(payload.mediaType, `Card bundle Extension Payload mediaType: ${index}`, 255)
    if (payload.schemaVersion !== undefined
      && (typeof payload.schemaVersion !== 'number'
        || !Number.isSafeInteger(payload.schemaVersion)
        || payload.schemaVersion < 1)) {
      throw new Error(`Card bundle Extension Payload schemaVersion is invalid: ${index}`)
    }
    if (payload.requirement !== undefined) {
      if (!isObject(payload.requirement)) throw new Error(`Card bundle Extension Payload requirement is invalid: ${index}`)
      if (payload.requirement.versionRange !== undefined) {
        assertBoundedNonEmptyString(
          payload.requirement.versionRange,
          `Card bundle Extension Payload requirement.versionRange: ${index}`,
          128,
        )
      }
    }
    if (payload.metadata !== undefined && !isObject(payload.metadata)) {
      throw new Error(`Card bundle Extension Payload metadata is invalid: ${index}`)
    }
    if (typeof payload.content !== 'string') throw new Error(`Card bundle Extension Payload content must be a string: ${index}`)
    // ponytail: 首版只运输 UTF-8 JSON/text；需要任意二进制时改为 Blob-backed Payload，不引入 Base64。
    const contentBytes = new TextEncoder().encode(payload.content).byteLength
    if (contentBytes > maxPortablePayloadBytes) {
      throw new Error(`Card bundle Extension Payload exceeds ${maxPortablePayloadBytes} bytes: ${payload.id}`)
    }
    totalBytes += contentBytes
    if (totalBytes > maxPortablePayloadTotalBytes) {
      throw new Error(`Card bundle Extension Payloads exceed ${maxPortablePayloadTotalBytes} total bytes`)
    }
  }
}

export function normalizePortableExtensionPayloadArtifact(
  payload: PortableExtensionPayloadArtifact,
): PortableExtensionPayloadArtifact {
  assertPortableExtensionPayloads([payload])
  return structuredClone(payload)
}

function assertPortablePayloadToken(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !portablePayloadTokenPattern.test(value)) throw new Error(`${label} is invalid`)
}

function assertBoundedNonEmptyString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`)
  }
}

function sameTimelineTemplate(value: JsonValue, definition: Extract<StateDefinitionDraft, { kind: 'timeline-template' }>): boolean {
  if (!isObject(value) || value.kind !== 'timeline-template') return false
  return value.templateVersion === definition.templateVersion
    && JSON.stringify(value.schema) === JSON.stringify(definition.schema)
    && JSON.stringify(value.initial) === JSON.stringify(definition.initial)
    && value.label === definition.label
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
    if (value.render.roleHint !== undefined && !['system', 'developer', 'assistant', 'user'].includes(String(value.render.roleHint))) throw new Error(`Prompt resource render roleHint is invalid: ${path}`)
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
      || typeof zone.orderIndex !== 'number') {
      throw new Error(`Prompt resource skeleton zone is invalid: ${path}`)
    }
    if (zone.renderHint !== undefined) {
      if (!isObject(zone.renderHint)
        || (zone.renderHint.providerRoleHint !== undefined && !['system', 'developer', 'assistant', 'user'].includes(String(zone.renderHint.providerRoleHint)))
        || (zone.renderHint.wrapper !== undefined && !['section', 'message'].includes(String(zone.renderHint.wrapper)))) {
        throw new Error(`Prompt resource skeleton zone renderHint is invalid: ${path}`)
      }
    }
    if (zone.accepts !== undefined && (!Array.isArray(zone.accepts) || !zone.accepts.every(kind => ['preset', 'settingLayer', 'narrativeChat', 'narrativeHistory', 'sessionHistory', 'runtime'].includes(String(kind))))) {
      throw new Error(`Prompt resource skeleton zone accepts are invalid: ${path}`)
    }
  }
}

function assertCompositionItem(value: JsonValue, path: string): void {
  if (!isObject(value)
    || typeof value.id !== 'string'
    || typeof value.displayName !== 'string'
    || typeof value.orderIndex !== 'number'
    || (value.kind !== 'message' && value.kind !== 'zone' && value.kind !== 'slot' && value.kind !== 'entry')) {
    throw new Error(`Prompt resource composition item is invalid: ${path}`)
  }
  if (value.kind === 'message') {
    if (!['system', 'developer', 'assistant', 'user'].includes(String(value.role))) {
      throw new Error(`Prompt resource message block role is invalid: ${path}`)
    }
    if (!Array.isArray(value.items)) throw new Error(`Prompt resource message block items are invalid: ${path}`)
    value.items.forEach((item, index) => {
      if (isObject(item) && item.kind === 'message') {
        throw new Error(`Nested Prompt resource message blocks are not supported: ${path}.items[${index}]`)
      }
      assertCompositionItem(item, `${path}.items[${index}]`)
    })
    return
  }
  if (value.kind === 'slot' && typeof value.bindingId !== 'string') {
    throw new Error(`Prompt resource slot bindingId is invalid: ${path}`)
  }
  if (value.kind === 'slot' && value.zoneId !== undefined && typeof value.zoneId !== 'string') {
    throw new Error(`Prompt resource slot zoneId is invalid: ${path}`)
  }
  if (value.kind === 'slot' && value.messageMode !== undefined && value.messageMode !== 'context' && value.messageMode !== 'native') {
    throw new Error(`Prompt resource slot messageMode is invalid: ${path}`)
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
