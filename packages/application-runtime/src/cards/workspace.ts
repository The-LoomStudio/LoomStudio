import type { DocumentRecord, DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createId, nowIso } from '@loom-studio/shared'
import { normalizeOpening, normalizeOptionalString, normalizePreset, normalizeSettingLayer } from './card.js'
import { normalizeMacros } from './card.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
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
  PromptCompositionCapabilities,
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
  StateArtifact,
  StateDefinitionContent,
  StateDefinitionDraft,
  TimelineStateBinding,
} from '../types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

function requireSqliteDocumentParticipant(documents: DocumentStore): SqliteDocumentStore {
  const participant = documents as Partial<SqliteDocumentStore>
  if (typeof participant.participateTransaction !== 'function') {
    throw new Error('Shared Sqlite Document Store participant is required')
  }
  return documents as SqliteDocumentStore
}

export type CardBundleArtifact = {
  schemaVersion: 4
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
    macros?: Record<string, string>
    stateContributionIds?: string[]
  }
  contextAssets: PromptResourceNode[]
  externalContextAssetIds?: string[]
  state?: StateArtifact
  stateTemplates?: Array<{
    id: string
    templateVersion: number
    schema: JsonObject
    initial: JsonObject
    componentKey?: string
    targetEntityTypeIds?: string[]
    label?: string
  }>
  timelineStateBindings?: TimelineStateBinding[]
  extensionPayloads?: PortableExtensionPayloadArtifact[]
  scriptAttachments?: LoomScriptAttachmentArtifact[]
  textTransformRules?: Array<Omit<TextTransformRuleDraft, 'owner'>>
  textExtractors?: Array<Omit<TextExtractorDraft, 'owner'>>
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
  resourceOrigin?: 'card' | 'external'
}

export type PortableExtensionPayloadContent = Omit<PortableExtensionPayloadArtifact, 'id'> & {
  artifactPayloadId: string
  createdAt: string
  updatedAt: string
}

export type PromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt' | (string & {})

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
  macros?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type PromptResourceArtifact = {
  format: 'loom.promptResource'
  schemaVersion: 1 | 2
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  macros?: Record<string, string>
  scriptAttachments?: LoomScriptAttachmentArtifact[]
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
  category?: 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | (string & {})
  children?: PromptResourceNode[]
  configRows?: Array<{ label: string; value: string }>
  enabled?: boolean
  id: string
  isSection?: boolean
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'slot' | 'message' | (string & {})
  label: string
  meta?: string
  orderList?: string[]
  capabilities?: PromptResourceCompositionCapabilities
  projection?: {
    entryOrder?: number
    lifecycle?: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrder?: number
    sourceKind?: 'actual' | 'virtual'
    zoneId: string
  }
  extra?: JsonObject
}

export type PromptResourceCompositionCapabilities = PromptCompositionCapabilities & {
  activation?: PromptActivation
  lifecycle?: { lifecycle: 'always' | 'conditional' | 'fresh' | string }
  projection?: {
    entryOrderHint?: number
    bindingId?: string
    zoneId: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrderHint?: number
    sourceKind?: 'actual' | 'virtual'
  }
}

type PromptContributionResourceNode = PromptResourceNode & {
  body: string
  capabilities: PromptResourceCompositionCapabilities & {
    targetAnchorId: NonNullable<PromptResourceCompositionCapabilities['targetAnchorId']>
  }
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
  const preparedScripts = await Promise.all(scriptAttachments.map(async attachment => ({
    attachment,
    metadata: parseLoomScriptSource(attachment.script.source),
    prepared: await input.blobs!.prepareWrite({
      source: new TextEncoder().encode(attachment.script.source),
      mediaType: 'text/javascript',
    }),
  })))

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

export function normalizePromptResourceArtifact(artifact: PromptResourceArtifact): PromptResourceArtifact {
  assertPromptResourceArtifact(artifact)
  return {
    ...structuredClone(artifact),
    schemaVersion: 2,
    scriptAttachments: structuredClone(artifact.scriptAttachments ?? []),
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

export function normalizeCardBundleArtifact(artifact: CardBundleArtifact): CardBundleArtifact {
  assertCardBundleArtifact(artifact)

  return {
    ...artifact,
    schemaVersion: 4,
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    description: artifact.description,
    card: artifact.card,
    contextAssets: artifact.contextAssets ?? [],
    extensionPayloads: structuredClone(artifact.extensionPayloads ?? []),
    scriptAttachments: structuredClone(artifact.scriptAttachments ?? []),
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
    ...(content.resourceOrigin !== undefined ? { resourceOrigin: content.resourceOrigin } : {}),
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
      kind: node.kind,
      ...(node.capabilities ? { capabilities: node.capabilities } : {}),
    })

    if (effectiveEnabled && category && isPromptContributionNode(node)) {
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
            ...(effectiveActivation ? { activation: effectiveActivation } : {}),
            ...(node.capabilities.targetAnchorId ? { targetAnchorId: node.capabilities.targetAnchorId } : {}),
            ...(node.capabilities.localDepth !== undefined ? { localDepth: node.capabilities.localDepth } : {}),
            ...(node.capabilities.roleHint ? { roleHint: node.capabilities.roleHint } : {}),
            ...(node.capabilities.lifecycle ? { lifecycle: node.capabilities.lifecycle } : {}),
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

function isPromptContributionNode(node: PromptResourceNode): node is PromptContributionResourceNode {
  return node.kind === 'entry'
    && node.enabled !== false
    && typeof node.body === 'string'
    && Boolean(node.capabilities?.targetAnchorId)
}

function readSourceKind(category: PromptResourceNode['category']): PromptContribution['sourceRef']['kind'] | undefined {
  if (category === 'preset') return 'preset'
  if (category === 'setting') return 'settingLayer'
  if (category === 'runtime') return 'runtime'
  if (category === 'history') return 'narrativeChat'
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

export function applyDefaultPromptProjection(asset: PromptResourceNode, resource: PromptResourceContent): PromptResourceNode {
  if (asset.kind !== 'entry' || asset.capabilities?.targetAnchorId) return asset
  if (resource.resourceKind !== 'preset' && resource.resourceKind !== 'setting') return asset

  const preset = resource.resourceKind === 'preset'
  const targetAnchorId = '@chat.system'
  const entryOrders = findNodes([resource.rootNode], node => node.capabilities?.targetAnchorId === targetAnchorId)
    .map(node => node.capabilities?.localDepth)
    .filter((value): value is number => typeof value === 'number')
  const localDepth = entryOrders.length ? Math.max(...entryOrders) + 10 : 10

  return {
    ...asset,
    capabilities: {
      ...asset.capabilities,
      ...(preset ? {} : { activation: asset.capabilities?.activation ?? { kind: 'always' as const } }),
      lifecycle: asset.capabilities?.lifecycle ?? { lifecycle: 'always' },
      targetAnchorId,
      localDepth,
      roleHint: 'system',
    },
  }
}


function assertPromptResourceArtifact(value: unknown): asserts value is PromptResourceArtifact {
  if (!isObject(value)) throw new Error('Prompt Resource artifact must be an object')
  if (value.format !== 'loom.promptResource') throw new Error(`Unsupported Prompt Resource artifact format: ${String(value.format)}`)
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new Error(`Unsupported Prompt Resource artifact schemaVersion: ${String(value.schemaVersion)}`)
  if (!isPromptResourceKind(value.resourceKind)) throw new Error(`Invalid Prompt Resource kind: ${String(value.resourceKind)}`)
  assertPromptResourceNode(value.rootNode, 'rootNode')
  assertUniquePromptResourceNodeIds(value.rootNode)
  assertLoomScriptAttachments(value.scriptAttachments)
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
  if (value.schemaVersion !== 4) throw new Error(`Unsupported card bundle schemaVersion: ${String(value.schemaVersion)}`)
  assertNonEmptyString(value.artifactId, 'Card bundle artifactId')
  assertNonEmptyString(value.displayName, 'Card bundle displayName')
  if (value.description !== undefined && typeof value.description !== 'string') throw new Error('Card bundle description must be a string')
  assertCardBundleCard(value.card)
  if (!Array.isArray(value.contextAssets)) throw new Error('Card bundle contextAssets must be an array')
  for (const [index, node] of value.contextAssets.entries()) {
    assertPromptResourceNode(node, `contextAssets[${index}]`)
    assertUniquePromptResourceNodeIds(node)
  }
  if (value.externalContextAssetIds !== undefined) {
    const rootIds = new Set(value.contextAssets.map(node => (node as JsonObject).id))
    if (!Array.isArray(value.externalContextAssetIds)
      || value.externalContextAssetIds.some(id => typeof id !== 'string'
        || !rootIds.has(id))
      || new Set(value.externalContextAssetIds).size !== value.externalContextAssetIds.length) {
      throw new Error('Invalid externalContextAssetIds')
    }
  }
  if (value.state !== undefined) parseStateArtifact(value.state)
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
        ...(typeof template.componentKey === 'string' ? { componentKey: template.componentKey } : {}),
        ...(Array.isArray(template.targetEntityTypeIds) ? { targetEntityTypeIds: template.targetEntityTypeIds as string[] } : {}),
        ...(typeof template.label === 'string' ? { label: template.label } : {}),
      })
    }
  }
  if (value.timelineStateBindings !== undefined) {
    if (!Array.isArray(value.timelineStateBindings)) throw new Error('Card bundle timelineStateBindings must be an array')
    for (const binding of value.timelineStateBindings) validateTimelineStateBinding(binding as TimelineStateBinding)
  }
  assertPortableExtensionPayloads(value.extensionPayloads)
  assertLoomScriptAttachments(value.scriptAttachments)
  assertCardTextPipeline(value.textTransformRules, false)
  assertCardTextPipeline(value.textExtractors, true)
  if (value.metadata !== undefined && !isObject(value.metadata)) throw new Error('Card bundle metadata must be an object')
}

function assertCardTextPipeline(value: unknown, extractor: boolean): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('Card text pipeline declarations must be an array')
  for (const item of value) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.enabled !== 'boolean'
      || !Number.isInteger(item.orderIndex) || !Array.isArray(item.targets)
      || item.targets.some(target => target !== 'narrative' && target !== 'agent-session')
      || !isObject(item.matcher) || item.matcher.kind !== 'regex'
      || typeof item.matcher.pattern !== 'string' || typeof item.matcher.flags !== 'string'
      || ['owner', 'origin', 'id', 'version', 'createdAt', 'updatedAt'].some(key => item[key] !== undefined)) {
      throw new Error('Invalid Card text pipeline declaration')
    }
    const draft = { ...item, owner: { kind: 'card' as const, cardId: 'bundle' } }
    if (extractor) {
      if ((item.strategy !== 'latest-valid' && item.strategy !== 'all-matches')
        || (item.parser !== 'text' && item.parser !== 'key-value-lines')
        || (item.artifactType !== undefined && typeof item.artifactType !== 'string')
        || (item.outputSchema !== undefined && !isObject(item.outputSchema))) {
        throw new Error('Invalid Card text extractor')
      }
      validateTextExtractorDraft(draft as TextExtractorDraft)
    } else {
      if (!Array.isArray(item.phases) || item.phases.some(phase => !['classify', 'prompt', 'display'].includes(String(phase)))
        || (item.range !== undefined && !isObject(item.range))
        || !isObject(item.effect)
        || !['replace', 'mark', 'promote-reasoning'].includes(String(item.effect.kind))
        || (item.effect.kind === 'replace' && typeof item.effect.replacement !== 'string')
        || (item.effect.kind === 'mark' && item.effect.markerType !== undefined && typeof item.effect.markerType !== 'string')
        || (item.effect.kind === 'promote-reasoning'
          && (!['collapsed', 'hidden', 'visible'].includes(String(item.effect.visibility))
            || !['omit', 'assistant-content'].includes(String(item.effect.replay))
            || (item.effect.dialect !== undefined && typeof item.effect.dialect !== 'string')))) {
        throw new Error('Invalid Card text transform rule')
      }
      validateTextTransformRuleDraft(draft as TextTransformRuleDraft)
    }
    const group = extractor ? item.matcher.contentGroup : (item.effect as Record<string, unknown>).contentGroup
    if (group !== undefined && typeof group !== 'string' && !(Number.isInteger(group) && Number(group) >= 0)) {
      throw new Error('Invalid Card text pipeline contentGroup')
    }
  }
}

function assertResourceOrigin(value: unknown): void {
  if (value !== undefined && value !== 'card' && value !== 'external') throw new Error('Invalid resourceOrigin')
}

function assertLoomScriptAttachments(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error('Loom Script attachments must be an array')
  const metadataIds = new Set<string>()
  for (const [index, attachment] of value.entries()) {
    if (!isObject(attachment) || !Number.isSafeInteger(attachment.orderIndex)) throw new Error(`Invalid Loom Script attachment: ${index}`)
    assertResourceOrigin(attachment.resourceOrigin)
    if (!isObject(attachment.script)
      || attachment.script.format !== 'loom.script'
      || attachment.script.schemaVersion !== 1
      || typeof attachment.script.fileName !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.loom\.js$/.test(attachment.script.fileName)
      || typeof attachment.script.source !== 'string') {
      throw new Error(`Invalid Loom Script attachment artifact: ${index}`)
    }
    const metadata = parseLoomScriptSource(attachment.script.source)
    if (metadataIds.has(metadata.metadataId)) throw new Error(`Duplicate Loom Script Metadata id in artifact: ${metadata.metadataId}`)
    metadataIds.add(metadata.metadataId)
  }
}

const portablePayloadTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const portablePayloadFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const maxPortablePayloadCount = 64
const maxPortablePayloadBytes = 8 * 1024 * 1024
const maxPortablePayloadTotalBytes = 32 * 1024 * 1024

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
    assertResourceOrigin(payload.resourceOrigin)
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
    && value.componentKey === definition.componentKey
    && JSON.stringify(value.targetEntityTypeIds) === JSON.stringify(definition.targetEntityTypeIds)
    && value.label === definition.label
}

function assertCardBundleCard(value: unknown): asserts value is CardBundleArtifact['card'] {
  if (!isObject(value)) throw new Error('Card bundle card must be an object')
  assertNonEmptyString(value.name, 'Card bundle card.name')
  assertOptionalString(value.userName, 'Card bundle card.userName')
  assertOptionalString(value.description, 'Card bundle card.description')
  if (value.macros !== undefined) validateBundleMacros(value.macros)
  if (value.stateContributionIds !== undefined
    && (!Array.isArray(value.stateContributionIds) || !value.stateContributionIds.every(id => typeof id === 'string' && id.trim().length > 0))) {
    throw new Error('Card bundle card.stateContributionIds must be non-empty strings')
  }

  if (value.preset !== undefined) {
    if (!isObject(value.preset)) throw new Error('Card bundle card.preset must be an object')
    assertOptionalString(value.preset.system, 'Card bundle card.preset.system')
    if (value.preset.macros !== undefined) validateBundleMacros(value.preset.macros)
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

function validateBundleMacros(value: unknown): void {
  if (!isObject(value)) throw new Error('Card bundle macros must be an object')
  for (const [name, macroValue] of Object.entries(value)) {
    if (typeof macroValue !== 'string') throw new Error(`Card bundle macro value must be a string: ${name}`)
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
    if (!isObject(value.projection)) throw new Error(`Prompt resource projection is invalid: ${path}`)
    assertOptionalString(value.projection.targetAnchorId, `Prompt resource projection targetAnchorId: ${path}`)
    assertOptionalNumber(value.projection.localDepth, `Prompt resource projection localDepth: ${path}`)
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
