import type { DocumentRecord, DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/application-data'
import { createId, nowIso } from '@loom-studio/shared'
import { normalizeOpening, normalizeOptionalString, normalizePreset, normalizeSettingLayer } from './card.js'
import { normalizeMacros } from './card.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { isObject } from '../foundation/json.js'
import type {
  CardMediaRefs,
  CardSourceContent,
  RuntimeRequestContext,
} from '../types.js'
import type {
  PromptContribution,
  SourceNode,
} from '../prompt/prompt-builder.js'
import { combineActivationGates, isPromptActivation, type PromptActivation } from '../prompt/prompt-activation.js'
import { fromStoredResource } from '../prompt/prompt-resource-mapper.js'
import { renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import { validateStateDefinitionDraft, validateTimelineStateBinding } from '../state/state-definition.js'
import { createStateArtifact, parseStateArtifact } from '../state/state-contribution.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import {
  validateTextExtractorDraft, validateTextTransformRuleDraft,
  type TextExtractorContent, type TextExtractorDraft,
  type TextTransformRuleContent, type TextTransformRuleDraft,
} from '../transforms/history-text.js'
import type { LoomScriptAttachmentArtifact, LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import type {
  BlobStorage,
  StateDefinitionContent,
  StateDefinitionDraft,
  TimelineStateBinding,
} from '../types.js'
import type {
  CardBundleArtifact,
  CardBundleImportManifest,
  CardBundleSourceArtifactRef,
  ImportBundleContent,
  PortableExtensionPayloadArtifact,
  PortableExtensionPayloadContent,
  PromptResourceArtifact,
  PromptResourceCompositionCapabilities,
  PromptResourceContent,
  PromptResourceKind,
  PromptResourceNode,
} from './workspace-types.js'
import {
  collectPromptInputs,
  createSourceArtifactRef,
  findNodes,
  normalizeCardBundleArtifact,
  sameTimelineTemplate,
  toPortableExtensionPayloadArtifact,
} from './workspace-codec.js'

export {
  applyDefaultPromptProjection,
  isCardBundleArtifact,
  isPromptResourceArtifact,
  normalizeCardBundleArtifact,
  normalizePortableExtensionPayloadArtifact,
  normalizePromptResourceArtifact,
} from './workspace-codec.js'

export type { CardBundleArtifact } from './workspace-types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

function requireSqliteDocumentParticipant(documents: DocumentStore): SqliteDocumentStore {
  const participant = documents as Partial<SqliteDocumentStore>
  if (typeof participant.participateTransaction !== 'function') {
    throw new Error('Shared Sqlite Document Store participant is required')
  }
  return documents as SqliteDocumentStore
}

export async function importCardBundle(input: {
  newCardId?: string
  artifact: CardBundleArtifact
  storedSourceArtifact?: Pick<
    CardBundleSourceArtifactRef,
    'sourceArtifactId' | 'blobId' | 'sha256' | 'sizeBytes' | 'originalFileName' | 'mediaType'
  >
  context?: RuntimeRequestContext
  documents: DocumentStore
  promptResources: PromptResourceStore
  dataEngine: import('@loom-studio/data-engine').SqliteDataEngine
  blobs?: BlobStorage
  now?: string
}): Promise<{
  card: CardSourceContent & { id: string; version: number }
  importBundle: ImportBundleContent & { id: string; version: number }
}> {
  const artifact = normalizeCardBundleArtifact(input.artifact)
  const stateContribution = artifact.state?.contribution
  const artifactStateTemplates = stateContribution?.templates ?? artifact.stateTemplates ?? []
  const artifactStateBindings = stateContribution?.bindings ?? artifact.timelineStateBindings ?? []
  const timestamp = input.now ?? nowIso()
  const sourceArtifactRef = createSourceArtifactRef(artifact, timestamp, input.storedSourceArtifact)
  const contextAssets = await cloneConflictingPromptNodes(input.promptResources, artifact.contextAssets)
  const scriptAttachments = artifact.scriptAttachments ?? []
  if (scriptAttachments.length > 0 && !input.blobs) throw new Error('Blob Store is required to import Loom Script attachments')
  const preparedScriptResults = await Promise.allSettled(scriptAttachments.map(async attachment => ({
    attachment,
    metadata: parseLoomScriptSource(attachment.script.source),
    prepared: await input.blobs!.prepareWrite({
      source: new TextEncoder().encode(attachment.script.source),
      mediaType: 'text/javascript',
    }),
  })))
  const preparedScripts = preparedScriptResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failedPreparation = preparedScriptResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failedPreparation) {
    await Promise.all(preparedScripts.map(item => input.blobs!.discardPreparedWrite(item.prepared)))
    throw failedPreparation.reason
  }

  const documentParticipant = requireSqliteDocumentParticipant(input.documents)
  let transaction: {
    value: { value: { card: DocumentRecord<CardSourceContent>; importBundle: DocumentRecord<ImportBundleContent> } }
  } | undefined
  try {
    transaction = await input.dataEngine.transact({
      actor: input.context?.actor
        ?? (input.context?.clientId ? { kind: 'client', id: input.context.clientId } : applicationActor),
      reason: 'application.importCardBundle',
      correlationId: input.context?.correlationId,
      callId: input.context?.callId,
      parentCallId: input.context?.parentCallId,
    }, async dataTx => {
    const resourceTx = input.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async tx => {
      const cardId = input.newCardId ?? createId('card')
      if (!/^card-[A-Za-z0-9-]+$/.test(cardId)) throw new Error('Invalid new Card ID')
      const importBundleId = createId('import-bundle')
      const textPipelineDocumentIds: string[] = []
      for (const [index, rule] of (artifact.textTransformRules ?? []).entries()) {
        const document = await writeDocument<TextTransformRuleContent>(tx, {
          id: `${importBundleId}.rule.${String(index).padStart(6, '0')}`,
          type: applicationDocumentTypes.textTransformRule,
          content: { ...structuredClone(rule), owner: { kind: 'card', cardId }, createdAt: timestamp, updatedAt: timestamp },
          expectedVersion: 'new',
        })
        textPipelineDocumentIds.push(document.id)
      }
      for (const [index, extractor] of (artifact.textExtractors ?? []).entries()) {
        const document = await writeDocument<TextExtractorContent>(tx, {
          id: `${importBundleId}.extractor.${String(index).padStart(6, '0')}`,
          type: applicationDocumentTypes.textExtractor,
          content: { ...structuredClone(extractor), owner: { kind: 'card', cardId }, createdAt: timestamp, updatedAt: timestamp },
          expectedVersion: 'new',
        })
        textPipelineDocumentIds.push(document.id)
      }
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
      const scriptDocumentIds: string[] = []
      const scriptMountIds: string[] = []
      for (const item of preparedScripts) {
        const blob = input.blobs!.participateWrite(dataTx, item.prepared).blob
        const script = await writeDocument<LoomScriptContent>(tx, {
          id: createId('loom-script'),
          type: applicationDocumentTypes.loomScript,
          content: {
            owner: { kind: 'card', cardId },
            ...item.metadata,
            source: {
              blobId: blob.id,
              mediaType: 'text/javascript',
              fileName: item.attachment.script.fileName,
            },
            sourceDigest: blob.sha256,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        const mount = await writeDocument<LoomScriptMountContent>(tx, {
          id: createId('loom-script-mount'),
          type: applicationDocumentTypes.loomScriptMount,
          content: {
            target: { kind: 'card', cardId },
            scriptDocumentId: script.id,
            enabled: false,
            orderIndex: item.attachment.orderIndex,
            grantedCapabilities: [],
            origin: {
              kind: 'card-bundle-import', artifactId: artifact.artifactId,
              ...(item.attachment.resourceOrigin !== undefined ? { resourceOrigin: item.attachment.resourceOrigin } : {}),
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        scriptDocumentIds.push(script.id)
        scriptMountIds.push(mount.id)
      }
      const stateDefinitionIds: string[] = []
      for (const template of artifactStateTemplates) {
        const definition = {
          kind: 'timeline-template' as const,
          templateVersion: template.templateVersion,
          schema: template.schema,
          initial: template.initial,
          ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
          ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
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
      const artifactTemplates = new Map(artifactStateTemplates.map(template => [template.id, template]))
      for (const binding of artifactStateBindings) {
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
          ...(artifact.externalContextAssetIds !== undefined ? {
            externalPromptResourceIds: resourceIds.filter((_, index) =>
              artifact.externalContextAssetIds!.includes(artifact.contextAssets[index]!.id)),
          } : {}),
          stateDefinitionIds,
          ...(stateContribution ? { stateEntityTypes: structuredClone(stateContribution.entityTypes) } : {}),
          ...(stateContribution ? { timelineStateEntities: structuredClone(stateContribution.entities) } : {}),
          ...(stateContribution ? { timelineComponentMounts: structuredClone(stateContribution.componentMounts) } : {}),
          timelineStateBindings: structuredClone(artifactStateBindings),
          preset: normalizePreset(artifact.card.preset),
          opening: normalizeOpening(artifact.card.opening),
          settingLayer: normalizeSettingLayer(artifact.card.settingLayer, undefined),
          ...(artifact.card.macros !== undefined ? { macros: normalizeMacros(artifact.card.macros, 'Card') } : {}),
          ...(artifact.card.stateContributionIds !== undefined ? { stateContributionIds: [...artifact.card.stateContributionIds] } : {}),
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
          documentIds: [card.id, importBundleId, ...stateDefinitionIds, ...portableExtensionPayloadIds, ...scriptDocumentIds, ...scriptMountIds, ...textPipelineDocumentIds],
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
  } catch (error) {
    await Promise.all(preparedScripts.map(item => input.blobs?.discardPreparedWrite(item.prepared)))
    throw error
  }

  return {
    card: toVersioned(transaction.value.value.card),
    importBundle: toVersioned(transaction.value.value.importBundle),
  }
}

export async function exportCardArtifact(input: {
  cardId: string
  documents: DocumentStore
  promptResources: PromptResourceStore
  blobs?: BlobStorage
}): Promise<CardBundleArtifact> {
  const card = await readDocument<CardSourceContent>(input.documents, input.cardId, applicationDocumentTypes.cardSource)
  const importBundle = await readOptionalCardImportBundle(input.documents, card)
  const contextAssets = await Promise.all((card.content.promptResourceIds ?? []).map(async resourceId => {
        const resource = await input.promptResources.getResource(resourceId)
        if (!resource) throw new Error(`Prompt resource not found: ${resourceId}`)
        return fromStoredResource(resource).rootNode
      }))
  const inlineTemplates = structuredClone(card.content.stateTemplates ?? [])
  const inlineTemplateIds = new Set(inlineTemplates.map(template => template.id))
  const sharedTemplates = await Promise.all((card.content.stateDefinitionIds ?? [])
    .filter(definitionId => !inlineTemplateIds.has(definitionId))
    .map(async definitionId => {
      const definition = await readDocument<StateDefinitionContent>(input.documents, definitionId, applicationDocumentTypes.stateDefinition)
      if (definition.content.kind !== 'timeline-template') throw new Error(`Card State Definition is not a timeline template: ${definitionId}`)
      return {
        id: definition.id,
        templateVersion: definition.content.templateVersion,
        schema: definition.content.schema,
        initial: definition.content.initial,
        ...(definition.content.componentKey !== undefined ? { componentKey: definition.content.componentKey } : {}),
        ...(definition.content.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...definition.content.targetEntityTypeIds] } : {}),
        ...(definition.content.label !== undefined ? { label: definition.content.label } : {}),
      }
    }))
  const stateTemplates = [...inlineTemplates, ...sharedTemplates]
  const extensionPayloads = await Promise.all((card.content.portableExtensionPayloadIds ?? []).map(async payloadId => {
    const payload = await readDocument<PortableExtensionPayloadContent>(
      input.documents,
      payloadId,
      applicationDocumentTypes.portableExtensionPayload,
    )
    return toPortableExtensionPayloadArtifact(payload.content)
  }))
  const mounts = (await listDocuments<LoomScriptMountContent>(input.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => mount.content.target.kind === 'card' && mount.content.target.cardId === input.cardId)
    .sort((left, right) => left.content.orderIndex - right.content.orderIndex || left.id.localeCompare(right.id))
  if (mounts.length > 0 && !input.blobs) throw new Error('Blob Store is required to export Loom Script attachments')
  const scriptAttachments = await Promise.all(mounts.map(async (mount): Promise<LoomScriptAttachmentArtifact> => {
    const script = await readLoomScriptRevision(input.documents, mount.content.scriptDocumentId, mount.content.pinnedDocumentVersion)
    if (script.content.owner.kind !== 'card' || script.content.owner.cardId !== input.cardId) {
      throw new Error(`Card Loom Script Mount references a non-owned Script: ${mount.id}`)
    }
    const bytes = await input.blobs!.read(script.content.source.blobId)
    return {
      script: {
        format: 'loom.script' as const,
        schemaVersion: 1 as const,
        fileName: script.content.source.fileName,
        source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      },
      orderIndex: mount.content.orderIndex,
      ...(mount.content.origin.resourceOrigin === 'card' || mount.content.origin.resourceOrigin === 'external'
        ? { resourceOrigin: mount.content.origin.resourceOrigin } : {}),
    }
  }))

  const textTransformRules = (await listDocuments<TextTransformRuleContent>(input.documents, applicationDocumentTypes.textTransformRule))
    .filter(document => document.content.owner.kind === 'card' && document.content.owner.cardId === input.cardId)
    .sort((a, b) => a.content.orderIndex - b.content.orderIndex || a.id.localeCompare(b.id))
    .map(document => stripDocumentMetadata(document.content))
  const textExtractors = (await listDocuments<TextExtractorContent>(input.documents, applicationDocumentTypes.textExtractor))
    .filter(document => document.content.owner.kind === 'card' && document.content.owner.cardId === input.cardId)
    .sort((a, b) => a.content.orderIndex - b.content.orderIndex || a.id.localeCompare(b.id))
    .map(document => stripDocumentMetadata(document.content))
  return {
    ...buildExportArtifact({ card, contextAssets, stateTemplates, extensionPayloads, scriptAttachments, importBundle }),
    ...(card.content.externalPromptResourceIds !== undefined ? {
      externalContextAssetIds: contextAssets.filter((_, index) =>
        card.content.externalPromptResourceIds!.includes(card.content.promptResourceIds![index]!)).map(node => node.id),
    } : {}),
    textTransformRules,
    textExtractors,
  }
}

async function readLoomScriptRevision(
  documents: DocumentStore,
  scriptDocumentId: string,
  version?: number,
): Promise<DocumentRecord<LoomScriptContent>> {
  const script = await documents.get(scriptDocumentId, version === undefined ? undefined : { version })
  if (!script) throw new Error(`Loom Script revision not found: ${scriptDocumentId}${version === undefined ? '' : `@${version}`}`)
  if (script.type !== applicationDocumentTypes.loomScript) throw new Error(`Unexpected document type for ${scriptDocumentId}: ${script.type}`)
  return script as DocumentRecord<LoomScriptContent>
}

function buildExportArtifact(input: {
  card: DocumentRecord<CardSourceContent>
  contextAssets: PromptResourceNode[]
  stateTemplates: NonNullable<CardBundleArtifact['stateTemplates']>
  extensionPayloads: PortableExtensionPayloadArtifact[]
  scriptAttachments: LoomScriptAttachmentArtifact[]
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
    schemaVersion: 4,
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
      macros: cardContent.macros,
      stateContributionIds: cardContent.stateContributionIds,
    },
    contextAssets: input.contextAssets,
    // Current Card bindings, not the import snapshot, own resource provenance.
    externalContextAssetIds: undefined,
    state: createStateArtifact({
      id: `card:${input.card.id}`,
      entityTypes: structuredClone(cardContent.stateEntityTypes ?? []),
      templates: structuredClone(input.stateTemplates),
      entities: structuredClone(cardContent.timelineStateEntities ?? []),
      componentMounts: structuredClone(cardContent.timelineComponentMounts ?? []),
      bindings: structuredClone(cardContent.timelineStateBindings ?? []),
    }),
    stateTemplates: input.stateTemplates,
    timelineStateBindings: structuredClone(cardContent.timelineStateBindings ?? []),
    extensionPayloads: input.extensionPayloads.map(payload => structuredClone(payload)),
    scriptAttachments: input.scriptAttachments.map(attachment => structuredClone(attachment)),
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
    ...(node.orderList ? { orderList: node.orderList.map(replaceId) } : {}),
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
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
} {
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

  return { sourceNodes, contributions }
}




function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
}

function stripDocumentMetadata<T extends Record<string, unknown>>(content: T): Omit<T, 'owner' | 'origin' | 'createdAt' | 'updatedAt'> {
  return Object.fromEntries(Object.entries(content).filter(([key]) => !['owner', 'origin', 'createdAt', 'updatedAt'].includes(key))) as Omit<T, 'owner' | 'origin' | 'createdAt' | 'updatedAt'>
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
  return typeof value === 'string' && value.trim().length > 0
}

function isPromptResourceNodeCategory(value: unknown): value is NonNullable<PromptResourceNode['category']> {
  return typeof value === 'string' && value.trim().length > 0
}
