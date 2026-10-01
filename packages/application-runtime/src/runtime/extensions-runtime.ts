import type { DocumentRecord, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { JsonValue } from '@loom-studio/shared'
import { extensionConfigDocumentId, extensionStorageTokenPattern } from '@loom-studio/extension-sdk'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { collectPages } from '../foundation/pagination.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import { isObject } from '../foundation/json.js'
import { assertNonEmpty } from '../agents/agent.js'
import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'
import { createAgentToolRegistry, type ToolDefinition } from '../agents/tool-registry.js'
import { isPromptActivation } from '../prompt/prompt-activation.js'
import {
  validateTextExtractorDraft,
  validateTextTransformRuleDraft,
} from '../transforms/history-text.js'
import {
  isPromptResourceArtifact,
  normalizePortableExtensionPayloadArtifact,
} from '../cards/workspace-codec.js'
import type {
  PortableExtensionPayloadArtifact,
  PortableExtensionPayloadContent,
  PromptResourceArtifact,
} from '../cards/workspace-types.js'
import { normalizeCardContent, toCardSource } from '../cards/card.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import type { LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import {
  listMappedResources,
  toStoredResourceInput,
} from '../prompt/prompt-resource-mapper.js'
import type {
  AgentToolContent,
  CardSourceContent,
  CreatePortableExtensionPayloadInput,
  CreatePortableExtensionPayloadResult,
  DeletePortableExtensionPayloadInput,
  DeletePortableExtensionPayloadResult,
  ExtensionEntityRef,
  ExtensionConfigEntry,
  ExtensionRecordEntry,
  ExtensionInstallationContent,
  ExtensionInstallationTarget,
  ListExtensionInstallationsResult,
  ExtensionStorageScope,
  GetPortableExtensionPayloadInput,
  GetPortableExtensionPayloadResult,
  ImportExtensionPackageResourcesInput,
  ImportExtensionPackageResourcesResult,
  ListPortableExtensionPayloadsInput,
  ListPortableExtensionPayloadsResult,
  MutationReceipt,
  PortableExtensionPayloadEntry,
  RemoveExtensionPackageResourcesInput,
  RemoveExtensionPackageResourcesResult,
  ReplaceCardPortableExtensionPayloadsInput,
  ReplaceCardPortableExtensionPayloadsResult,
  RuntimeRequestContext,
  TextExtractorContent,
  TextExtractorDraft,
  TextTransformRuleContent,
  TextTransformRuleDraft,
  UpdatePortableExtensionPayloadInput,
  UpdatePortableExtensionPayloadResult,
} from '../types.js'
import {
  promptResourceWriteContext,
  requireDocumentParticipant,
} from './context.js'
import {
  listAgentToolEntries,
  refreshAgentToolRegistry,
  toAgentToolContent,
} from './agents-runtime.js'

type ExtensionsRuntimeContext = Pick<ApplicationRuntimeContext,
  'agentTools' | 'agents' | 'blobs' | 'createId' | 'dataEngine' | 'documents' | 'narratives' | 'now' | 'promptResources'
>

export function createExtensionsRuntimeMethods(ctx: ExtensionsRuntimeContext) {
  return {
    listExtensionInstallations: async (): Promise<ListExtensionInstallationsResult> => ({
      installations: (await listDocuments<ExtensionInstallationContent>(
        ctx.documents,
        applicationDocumentTypes.extensionInstallation,
      )).map(document => ({ ...document.content, id: document.id, version: document.version })),
    }),

    listPortableExtensionPayloads: async (input?: ListPortableExtensionPayloadsInput): Promise<ListPortableExtensionPayloadsResult> => ({
      payloads: (await listDocuments<PortableExtensionPayloadContent>(
        ctx.documents,
        applicationDocumentTypes.portableExtensionPayload,
      ))
        .map(toPortableExtensionPayloadEntry)
        .filter(payload => (input?.packageId === undefined || payload.packageId === input.packageId)
          && (input?.ownerInstallationId === undefined || payload.ownerInstallationId === (input.ownerInstallationId ?? undefined))),
    }),

    getPortableExtensionPayload: async (input: GetPortableExtensionPayloadInput): Promise<GetPortableExtensionPayloadResult> => ({
      payload: toPortableExtensionPayloadEntry(await readDocument<PortableExtensionPayloadContent>(
        ctx.documents,
        input.payloadId,
        applicationDocumentTypes.portableExtensionPayload,
      )),
    }),

    createPortableExtensionPayload: async (input: CreatePortableExtensionPayloadInput, requestContext?: RuntimeRequestContext): Promise<CreatePortableExtensionPayloadResult> => {
      const artifactPayloadId = input.artifactPayloadId ?? ctx.createId('payload')
      const payload = normalizePortableExtensionPayloadArtifact({ id: artifactPayloadId, ...input.payload })
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.createPortableExtensionPayload',
        async documents => {
          const timestamp = ctx.now()
          return await writeDocument<PortableExtensionPayloadContent>(documents, {
            id: ctx.createId('portable-payload'),
            type: applicationDocumentTypes.portableExtensionPayload,
            content: {
              ...portableExtensionPayloadFields(payload),
              artifactPayloadId,
              ...(input.ownerInstallationId ? { ownerInstallationId: input.ownerInstallationId } : {}),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            expectedVersion: 'new',
          })
        },
      )
      return { payload: toPortableExtensionPayloadEntry(mutation.value), mutation: mutation.mutation }
    },

    updatePortableExtensionPayload: async (input: UpdatePortableExtensionPayloadInput, requestContext?: RuntimeRequestContext): Promise<UpdatePortableExtensionPayloadResult> => {
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.updatePortableExtensionPayload',
        async documents => {
          const existing = await readDocument<PortableExtensionPayloadContent>(
            documents,
            input.payloadId,
            applicationDocumentTypes.portableExtensionPayload,
          )
          if (existing.version !== input.expectedVersion) {
            throw new Error(`Portable Extension Payload version conflict: ${input.payloadId}`)
          }
          const payload = normalizePortableExtensionPayloadArtifact({
            id: existing.content.artifactPayloadId,
            ...input.payload,
          })
          return await writeDocument<PortableExtensionPayloadContent>(documents, {
            id: existing.id,
            type: applicationDocumentTypes.portableExtensionPayload,
            content: {
              ...portableExtensionPayloadFields(payload),
              artifactPayloadId: existing.content.artifactPayloadId,
              ...(existing.content.ownerInstallationId ? { ownerInstallationId: existing.content.ownerInstallationId } : {}),
              createdAt: existing.content.createdAt,
              updatedAt: ctx.now(),
            },
            expectedVersion: existing.version,
          })
        },
      )
      return { payload: toPortableExtensionPayloadEntry(mutation.value), mutation: mutation.mutation }
    },

    deletePortableExtensionPayload: async (input: DeletePortableExtensionPayloadInput, requestContext?: RuntimeRequestContext): Promise<DeletePortableExtensionPayloadResult> => {
      const existing = await readDocument<PortableExtensionPayloadContent>(
        ctx.documents,
        input.payloadId,
        applicationDocumentTypes.portableExtensionPayload,
      )
      if (existing.version !== input.expectedVersion) {
        throw new Error(`Portable Extension Payload version conflict: ${input.payloadId}`)
      }
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.deletePortableExtensionPayload',
        async documents => {
          await documents.delete({ id: existing.id, expectedVersion: existing.version })
          return true as const
        },
      )
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    replaceCardPortableExtensionPayloads: async (input: ReplaceCardPortableExtensionPayloadsInput, requestContext?: RuntimeRequestContext): Promise<ReplaceCardPortableExtensionPayloadsResult> => {
      if (new Set(input.payloadIds).size !== input.payloadIds.length) {
        throw new Error('Duplicate Portable Extension Payload binding')
      }
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.replaceCardPortableExtensionPayloads',
        async documents => {
          const card = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
          if (card.version !== input.expectedVersion) throw new Error(`Card version conflict: ${input.cardId}`)
          const payloads = await Promise.all(input.payloadIds.map(payloadId => readDocument<PortableExtensionPayloadContent>(
            documents,
            payloadId,
            applicationDocumentTypes.portableExtensionPayload,
          )))
          const artifactPayloadIds = payloads.map(payload => payload.content.artifactPayloadId)
          if (new Set(artifactPayloadIds).size !== artifactPayloadIds.length) {
            throw new Error('Duplicate Artifact Payload id in Card bindings')
          }
          const updated = await writeDocument<CardSourceContent>(documents, {
            id: card.id,
            type: applicationDocumentTypes.cardSource,
            content: normalizeCardContent({
              ...card.content,
              portableExtensionPayloadIds: [...input.payloadIds],
              updatedAt: ctx.now(),
            }),
            expectedVersion: card.version,
          })
          return toCardSource(updated)
        },
      )
      return { card: mutation.value, mutation: mutation.mutation }
    },

    listExtensionRecords: async (input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<{ records: ExtensionRecordEntry[] }> => {
      if (input.scope && input.target?.kind === 'card') await validateApplicationExtensionStorageScope(ctx, input.scope, input.target)
      const records = await listApplicationExtensionRecords(ctx.documents, input)
      if (input.target?.kind === 'card') for (const record of records) await validateApplicationExtensionStorageScope(ctx, record.scope, input.target)
      return { records }
    },

    getExtensionRecord: async (input: { packageId: string; target?: ExtensionInstallationTarget; recordId: string }): Promise<{ record: ExtensionRecordEntry | null }> => {
      const record = await getApplicationExtensionRecord(ctx.documents, input.packageId, input.recordId, input.target)
      if (record && input.target?.kind === 'card') await validateApplicationExtensionStorageScope(ctx, record.scope, input.target)
      return { record }
    },

    listExtensionConfigs: async (input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope }): Promise<{ configs: ExtensionConfigEntry[] }> => {
      if (input.scope && input.target?.kind === 'card') await validateApplicationExtensionStorageScope(ctx, input.scope, input.target)
      const configs = await listApplicationExtensionConfigs(ctx.documents, input)
      if (input.target?.kind === 'card') for (const config of configs) await validateApplicationExtensionStorageScope(ctx, config.scope, input.target)
      return { configs }
    },

    getExtensionConfig: async (input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string }): Promise<{ config: ExtensionConfigEntry | null }> => {
      if (input.target?.kind === 'card') await validateApplicationExtensionStorageScope(ctx, input.scope, input.target)
      return { config: await getApplicationExtensionConfig(ctx.documents, input) }
    },

    upsertExtensionConfig: async (
      input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string; value: JsonValue; expectedVersion?: number },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ config: ExtensionConfigEntry; mutation: MutationReceipt }> => {
      if (!extensionStorageTokenPattern.test(input.key)) throw new Error(`Extension Config key must be a stable token: ${input.key}`)
      await validateApplicationExtensionStorageScope(ctx, input.scope, input.target)
      const id = extensionConfigDocumentId(input.packageId, input.scope, input.key, input.target)
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.upsertExtensionConfig',
        async documents => {
          const existing = await documents.get(id, { includeTombstone: true })
          if (existing) assertApplicationExtensionConfigOwner(input.packageId, existing, input.target)
          if (existing && !existing.meta.tombstone && input.expectedVersion === undefined) {
            throw new Error(`expectedVersion is required when updating Extension Config: ${input.key}`)
          }
          const timestamp = ctx.now()
          const createdAt = existing && !existing.meta.tombstone
            ? toApplicationExtensionConfig(input.packageId, existing, input.target).createdAt
            : timestamp
          const result = await documents.write({
            id,
            type: applicationDocumentTypes.extensionConfig,
            content: {
              scope: structuredClone(input.scope),
              key: input.key,
              value: structuredClone(input.value),
              createdAt,
              updatedAt: timestamp,
            },
            expectedVersion: existing
              ? existing.meta.tombstone ? existing.version : input.expectedVersion!
              : 'new',
            meta: { ownerExtensionId: input.packageId, ownerInstallationId: applicationStorageOwnerId(input.packageId, input.target) },
          })
          const document = result.documents[0]
          if (!document) throw new Error(`Extension Config write returned no document: ${input.key}`)
          return toApplicationExtensionConfig(input.packageId, document, input.target)
        },
      )
      return { config: mutation.value, mutation: mutation.mutation }
    },

    importExtensionPackageResources: (input: ImportExtensionPackageResourcesInput, requestContext?: RuntimeRequestContext): Promise<ImportExtensionPackageResourcesResult> =>
      importExtensionPackageResourcesInternal(ctx, input, requestContext, requireDocumentParticipant(ctx)),

    removeExtensionPackageResources: (input: RemoveExtensionPackageResourcesInput, requestContext?: RuntimeRequestContext): Promise<RemoveExtensionPackageResourcesResult> =>
      removeExtensionPackageResourcesInternal(ctx, input, requestContext, requireDocumentParticipant(ctx)),
  }
}

function portableExtensionPayloadFields(
  payload: PortableExtensionPayloadArtifact,
): Omit<PortableExtensionPayloadArtifact, 'id'> {
  return {
    packageId: payload.packageId,
    fileName: payload.fileName,
    format: payload.format,
    mediaType: payload.mediaType,
    ...(payload.schemaVersion !== undefined ? { schemaVersion: payload.schemaVersion } : {}),
    ...(payload.requirement !== undefined ? { requirement: structuredClone(payload.requirement) } : {}),
    ...(payload.metadata !== undefined ? { metadata: structuredClone(payload.metadata) } : {}),
    content: payload.content,
  }
}

function toPortableExtensionPayloadEntry(
  document: DocumentRecord<PortableExtensionPayloadContent>,
): PortableExtensionPayloadEntry {
  return {
    id: document.id,
    artifactPayloadId: document.content.artifactPayloadId,
    ...(document.content.ownerInstallationId ? { ownerInstallationId: document.content.ownerInstallationId } : {}),
    ...portableExtensionPayloadFields({
      id: document.content.artifactPayloadId,
      packageId: document.content.packageId,
      fileName: document.content.fileName,
      format: document.content.format,
      mediaType: document.content.mediaType,
      ...(document.content.schemaVersion !== undefined ? { schemaVersion: document.content.schemaVersion } : {}),
      ...(document.content.requirement !== undefined ? { requirement: document.content.requirement } : {}),
      ...(document.content.metadata !== undefined ? { metadata: document.content.metadata } : {}),
      content: document.content.content,
    }),
    version: document.version,
    createdAt: document.content.createdAt,
    updatedAt: document.content.updatedAt,
  }
}

type ApplicationExtensionRecordContent = {
  scope: ExtensionStorageScope
  recordType: string
  data: JsonValue
  bindings: ExtensionEntityRef[]
  createdAt: string
  updatedAt: string
}

type ApplicationExtensionConfigContent = {
  scope: ExtensionStorageScope
  key: string
  value: JsonValue
  createdAt: string
  updatedAt: string
}

async function listApplicationExtensionConfigs(
  documents: DocumentTransaction,
  input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope },
): Promise<ExtensionConfigEntry[]> {
  const documentsFound = await collectPages(cursor => documents.list({
    type: applicationDocumentTypes.extensionConfig,
    ownerExtensionId: input.packageId,
    ownerInstallationId: applicationStorageOwnerId(input.packageId, input.target) ?? null,
    cursor,
    limit: 100,
  }))
  return documentsFound
    .map(document => toApplicationExtensionConfig(input.packageId, document, input.target))
    .filter(config => !input.scope || sameExtensionStorageScope(config.scope, input.scope))
    .sort((left, right) => left.key.localeCompare(right.key))
}

async function getApplicationExtensionConfig(
  documents: DocumentTransaction,
  input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string },
): Promise<ExtensionConfigEntry | null> {
  if (!extensionStorageTokenPattern.test(input.key)) throw new Error(`Extension Config key must be a stable token: ${input.key}`)
  const document = await documents.get(extensionConfigDocumentId(input.packageId, input.scope, input.key, input.target))
  if (!document) return null
  return toApplicationExtensionConfig(input.packageId, document, input.target)
}

function toApplicationExtensionConfig(packageId: string, document: DocumentRecord, target?: ExtensionInstallationTarget): ExtensionConfigEntry {
  assertApplicationExtensionConfigOwner(packageId, document, target)
  if (!isObject(document.content)) throw new Error(`Extension Config content must be an object: ${document.id}`)
  const content = document.content as unknown as Partial<ApplicationExtensionConfigContent>
  if (!isExtensionStorageScope(content.scope) || typeof content.key !== 'string' || !extensionStorageTokenPattern.test(content.key)) {
    throw new Error(`Extension Config content is invalid: ${document.id}`)
  }
  if (content.value === undefined || typeof content.createdAt !== 'string' || typeof content.updatedAt !== 'string') {
    throw new Error(`Extension Config metadata is invalid: ${document.id}`)
  }
  return {
    id: document.id,
    packageId,
    scope: structuredClone(content.scope),
    key: content.key,
    value: structuredClone(content.value),
    version: document.version,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  }
}

function applicationStorageOwnerId(packageId: string, target?: ExtensionInstallationTarget): string | undefined {
  return target?.kind === 'card' ? extensionInstallationId(packageId, target) : undefined
}

function assertApplicationExtensionConfigOwner(packageId: string, document: DocumentRecord, target?: ExtensionInstallationTarget): void {
  if (document.type !== applicationDocumentTypes.extensionConfig || document.meta.ownerExtensionId !== packageId
    || document.meta.ownerInstallationId !== applicationStorageOwnerId(packageId, target)) {
    throw new Error(`Extension Config is not owned by package ${packageId}: ${document.id}`)
  }
}

async function validateApplicationExtensionStorageScope(ctx: ExtensionsRuntimeContext, scope: ExtensionStorageScope, target?: ExtensionInstallationTarget): Promise<void> {
  if (target?.kind === 'card' && (scope.kind === 'global' || (scope.kind === 'card' && scope.cardId !== target.cardId))) throw new Error('Storage scope is outside this Card installation')
  if (scope.kind === 'global') return
  if (scope.kind === 'card') {
    const card = await ctx.documents.get(scope.cardId)
    if (!card || card.type !== applicationDocumentTypes.cardSource || card.meta.tombstone) throw new Error(`Card not found: ${scope.cardId}`)
    return
  }
  if (scope.kind === 'timeline') {
    const timeline = await ctx.narratives?.getTimeline(scope.timelineId)
    if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${scope.timelineId}`)
    if (target?.kind === 'card' && timeline.createdFrom?.cardId !== target.cardId) throw new Error('Timeline is outside this Card installation')
    return
  }
  const session = await ctx.agents?.getSession(scope.agentSessionId)
  if (!session || session.deletedAt) throw new Error(`Agent Session not found: ${scope.agentSessionId}`)
  if (target?.kind === 'card') {
    const timeline = session.timelineId ? await ctx.narratives?.getTimeline(session.timelineId) : undefined
    if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) throw new Error('Session is outside this Card installation')
  }
}

async function listApplicationExtensionRecords(
  documents: DocumentTransaction,
  input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef },
): Promise<ExtensionRecordEntry[]> {
  const documentsFound = await collectPages(cursor => documents.list({
      type: applicationDocumentTypes.extensionRecord,
      ownerExtensionId: input.packageId,
      ownerInstallationId: applicationStorageOwnerId(input.packageId, input.target) ?? null,
      cursor,
      limit: 100,
  }))
  const records: ExtensionRecordEntry[] = []
  for (const document of documentsFound) {
      const record = toApplicationExtensionRecord(input.packageId, document)
      if (input.scope && !sameExtensionStorageScope(record.scope, input.scope)) continue
      if (input.recordType && record.recordType !== input.recordType) continue
      if (input.binding && !record.bindings.some(binding => sameExtensionEntityRef(binding, input.binding!))) continue
      records.push(record)
  }
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

async function getApplicationExtensionRecord(
  documents: DocumentTransaction,
  packageId: string,
  recordId: string,
  target?: ExtensionInstallationTarget,
): Promise<ExtensionRecordEntry | null> {
  const document = await documents.get(recordId)
  if (!document) return null
  if (document.type !== applicationDocumentTypes.extensionRecord || document.meta.ownerExtensionId !== packageId
    || document.meta.ownerInstallationId !== applicationStorageOwnerId(packageId, target)) {
    throw new Error(`Extension Record is not owned by package ${packageId}: ${recordId}`)
  }
  return toApplicationExtensionRecord(packageId, document)
}

function toApplicationExtensionRecord(packageId: string, document: DocumentRecord): ExtensionRecordEntry {
  if (!isObject(document.content)) throw new Error(`Extension Record content must be an object: ${document.id}`)
  const content = document.content as unknown as Partial<ApplicationExtensionRecordContent>
  if (!isExtensionStorageScope(content.scope) || typeof content.recordType !== 'string' || !content.recordType) {
    throw new Error(`Extension Record content is invalid: ${document.id}`)
  }
  if (!Array.isArray(content.bindings) || !content.bindings.every(isExtensionEntityRef)) {
    throw new Error(`Extension Record bindings are invalid: ${document.id}`)
  }
  if (typeof content.createdAt !== 'string' || typeof content.updatedAt !== 'string' || content.data === undefined) {
    throw new Error(`Extension Record metadata is invalid: ${document.id}`)
  }
  return {
    id: document.id,
    packageId,
    scope: structuredClone(content.scope),
    recordType: content.recordType,
    data: structuredClone(content.data),
    bindings: structuredClone(content.bindings),
    version: document.version,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  }
}

function isExtensionStorageScope(value: unknown): value is ExtensionStorageScope {
  if (!isObject(value)) return false
  const obj = value as Record<string, unknown>
  return (
    obj.kind === 'global'
    || (obj.kind === 'card' && typeof obj.cardId === 'string' && Boolean(obj.cardId))
    || (obj.kind === 'timeline' && typeof obj.timelineId === 'string' && Boolean(obj.timelineId))
    || (obj.kind === 'agent-session' && typeof obj.agentSessionId === 'string' && Boolean(obj.agentSessionId))
  )
}

function isExtensionEntityRef(value: unknown): value is ExtensionEntityRef {
  if (!isObject(value)) return false
  const obj = value as Record<string, unknown>
  return (
    (obj.kind === 'narrative-node' && typeof obj.timelineId === 'string' && typeof obj.nodeId === 'string')
    || (obj.kind === 'agent-message' && typeof obj.agentSessionId === 'string' && typeof obj.messageId === 'string')
    || (obj.kind === 'asset' && typeof obj.assetId === 'string')
    || (obj.kind === 'state-path' && typeof obj.timelineId === 'string' && typeof obj.path === 'string')
  )
}

function sameExtensionStorageScope(left: ExtensionStorageScope, right: ExtensionStorageScope): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'global') return true
  if (left.kind === 'card' && right.kind === 'card') return left.cardId === right.cardId
  if (left.kind === 'timeline' && right.kind === 'timeline') return left.timelineId === right.timelineId
  return left.kind === 'agent-session' && right.kind === 'agent-session' && left.agentSessionId === right.agentSessionId
}

function sameExtensionEntityRef(left: ExtensionEntityRef, right: ExtensionEntityRef): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'narrative-node' && right.kind === 'narrative-node') return left.timelineId === right.timelineId && left.nodeId === right.nodeId
  if (left.kind === 'agent-message' && right.kind === 'agent-message') return left.agentSessionId === right.agentSessionId && left.messageId === right.messageId
  if (left.kind === 'asset' && right.kind === 'asset') return left.assetId === right.assetId
  return left.kind === 'state-path' && right.kind === 'state-path' && left.timelineId === right.timelineId && left.path === right.path
}

function readExtensionAgentToolDefinition(packageId: string, toolId: string, value: JsonValue): ToolDefinition {
  if (!isObject(value)) throw new Error(`Extension Agent Tool definition must be an object: ${toolId}`)
  if ('id' in value || 'owner' in value) throw new Error(`Extension Agent Tool definition cannot override id or owner: ${toolId}`)
  if (typeof value.name !== 'string' || typeof value.description !== 'string' || !isObject(value.input)) {
    throw new Error(`Extension Agent Tool definition is incomplete: ${toolId}`)
  }
  if (value.prompt !== undefined && !isObject(value.prompt)) throw new Error(`Extension Agent Tool prompt must be an object: ${toolId}`)
  const definition: ToolDefinition = {
    id: toolId,
    owner: { namespace: packageId },
    name: value.name,
    description: value.description,
    input: structuredClone(value.input) as ToolDefinition['input'],
    ...(value.prompt === undefined ? {} : { prompt: structuredClone(value.prompt) as ToolDefinition['prompt'] }),
  }
  createAgentToolRegistry([definition])
  return definition
}

function readExtensionTextTransformRule(
  packageId: string,
  contributionId: string,
  value: JsonValue,
): TextTransformRuleDraft {
  if (!isObject(value)) throw new Error(`Extension Text Transform Rule artifact must be an object: ${contributionId}`)
  assertExtensionTextArtifactCannotOwnResource(value, 'Text Transform Rule', contributionId)
  const rule = {
    ...(structuredClone(value) as unknown as Omit<TextTransformRuleDraft, 'owner'>),
    owner: { kind: 'extension' as const, packageId },
  }
  try {
    validateTextTransformRuleDraft(rule)
  } catch (error) {
    throw new Error(`Extension Text Transform Rule artifact is invalid: ${contributionId}`, { cause: error })
  }
  return rule
}

function readExtensionTextExtractor(
  packageId: string,
  contributionId: string,
  value: JsonValue,
): TextExtractorDraft {
  if (!isObject(value)) throw new Error(`Extension Text Extractor artifact must be an object: ${contributionId}`)
  assertExtensionTextArtifactCannotOwnResource(value, 'Text Extractor', contributionId)
  const extractor = {
    ...(structuredClone(value) as unknown as Omit<TextExtractorDraft, 'owner'>),
    owner: { kind: 'extension' as const, packageId },
  }
  try {
    validateTextExtractorDraft(extractor)
  } catch (error) {
    throw new Error(`Extension Text Extractor artifact is invalid: ${contributionId}`, { cause: error })
  }
  return extractor
}

function assertExtensionTextArtifactCannotOwnResource(value: Record<string, JsonValue>, label: string, contributionId: string): void {
  for (const field of ['id', 'version', 'owner', 'origin', 'createdAt', 'updatedAt']) {
    if (field in value) throw new Error(`Extension ${label} artifact cannot override ${field}: ${contributionId}`)
  }
}

function validateExtensionPromptNodeIds(packageId: string, node: PromptResourceArtifact['rootNode'], seen: Set<string>): void {
  if (!node.id.startsWith(`${packageId}.`)) throw new Error(`Extension Prompt Resource node id must use package namespace: ${node.id}`)
  if (seen.has(node.id)) throw new Error(`Extension Prompt Resource node id must be unique: ${node.id}`)
  seen.add(node.id)
  for (const child of node.children ?? []) validateExtensionPromptNodeIds(packageId, child, seen)
}

async function importExtensionPackageResourcesInternal(
  ctx: ExtensionsRuntimeContext,
  input: ImportExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
): Promise<ImportExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  assertNonEmpty(input.packageVersion, 'packageVersion')
  const target = input.target ?? { kind: 'global' }
  let archiveBlobId: string | undefined
  if (target.kind === 'card') {
    const card = await readDocument<CardSourceContent>(ctx.documents, target.cardId, applicationDocumentTypes.cardSource)
    if (input.expectedCardVersion !== undefined) {
      if (card.version !== input.expectedCardVersion) throw new Error('Card archive changed before resource installation')
      const archive = card.content.extensionPackages?.find(item => item.packageId === input.packageId)
      if (!archive || archive.version !== input.packageVersion) throw new Error('Card extension archive does not match the imported package')
      archiveBlobId = archive.blobId
    }
  }
  const installationId = extensionInstallationId(input.packageId, target)
  const installation = await ctx.documents.get(installationId, { includeTombstone: true })
  if (input.update && (!installation || installation.meta.tombstone || installation.version !== input.update.expectedInstallationVersion)) {
    throw new Error(`Extension installation changed before update: ${installationId}`)
  }
  if (installation && installation.type !== applicationDocumentTypes.extensionInstallation) {
    throw new Error(`Extension installation id conflicts with another Document: ${installationId}`)
  }
  const owns = (candidate: ExtensionResourceOriginCandidate | undefined) =>
    matchesExtensionInstallation(candidate, input.packageId, installationId)
  const localId = (authoredId: string) => installedExtensionContributionId(input.packageId, target, authoredId)
  const timestamp = ctx.now()
  const origin = (contributionId: string) => ({
    kind: 'extension-package' as const,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    contributionId,
    installationId,
  })
  const assertPackageVersion = (packageVersion: string | undefined, contributionId: string, label: string) => {
    if (!input.update && packageVersion !== input.packageVersion) {
      throw new Error(`Extension ${label} update requires an explicit migration: ${contributionId}`)
    }
  }
  if (installation && !installation.meta.tombstone) {
    assertPackageVersion((installation.content as ExtensionInstallationContent).packageVersion, installationId, 'installation')
  }
  const previousArchiveBlobId = installation && !installation.meta.tombstone
    ? (installation.content as ExtensionInstallationContent).archiveBlobId : undefined
  if (input.update && previousArchiveBlobId && !archiveBlobId) {
    throw new Error('Updating an archived Card installation requires its current Card archive')
  }
  if (!input.update && previousArchiveBlobId && archiveBlobId && previousArchiveBlobId !== archiveBlobId) {
    throw new Error('Card extension archive changed; use an explicit package update')
  }
  const bindsArchive = archiveBlobId !== undefined && archiveBlobId !== previousArchiveBlobId

  const promptContributions = new Map(input.promptResources.map(item => [item.contribution.id, item]))
  if (promptContributions.size !== input.promptResources.length) throw new Error('Extension Prompt Resource contribution ids must be unique')
  const scripts = input.loomScripts ?? []
  const scriptMetadata = new Map(scripts.map(item => {
    if (!extensionStorageTokenPattern.test(item.contribution.id) || !item.contribution.source.endsWith('.loom.js')) throw new Error('Invalid Loom Script contribution')
    return [item.contribution.id, parseLoomScriptSource(item.source)] as const
  }))
  if (scriptMetadata.size !== scripts.length) throw new Error('Duplicate Loom Script contribution')
  if (new Set([...scriptMetadata.values()].map(metadata => metadata.metadataId)).size !== scripts.length) throw new Error('Duplicate Loom Script metadata id')
  const scriptDocumentId = (id: string) => localId(`${input.packageId}/script/${id}`)
  const scriptMountId = (presetId: string, scriptId: string) => localId(`${input.packageId}/script-mount/${presetId}/${scriptId}`)
  const storedScripts = (await listDocumentsIncludingTombstones<LoomScriptContent>(ctx.documents, applicationDocumentTypes.loomScript))
    .filter(script => script.content.owner.kind === 'extension' && script.content.owner.packageId === input.packageId
      && script.content.owner.installationId === installationId)
  const storedScriptById = new Map(storedScripts.map(script => [script.id, script]))
  const storedScriptMounts = (await listDocumentsIncludingTombstones<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => owns(mount.content.origin))
  const storedScriptMountById = new Map(storedScriptMounts.map(mount => [mount.id, mount]))
  const desiredScriptMountIds = new Set<string>()
  for (const item of scripts) {
    if (storedScripts.some(script => !script.meta.tombstone && script.id !== scriptDocumentId(item.contribution.id)
      && script.content.metadataId === scriptMetadata.get(item.contribution.id)!.metadataId)) throw new Error('Loom Script metadata identity conflicts with an existing script')
  }
  const agentToolDefinitions = new Map<string, ToolDefinition>()
  for (const item of input.agentTools) {
    if (agentToolDefinitions.has(item.contribution.id)) throw new Error(`Extension Agent Tool contribution is duplicated: ${item.contribution.id}`)
    agentToolDefinitions.set(item.contribution.id, readExtensionAgentToolDefinition(input.packageId, localId(item.contribution.id), item.definition))
  }
  const transformRuleDrafts = new Map<string, TextTransformRuleDraft>()
  for (const item of input.transformRules) {
    if (transformRuleDrafts.has(item.contribution.id)) throw new Error(`Extension Text Transform Rule contribution is duplicated: ${item.contribution.id}`)
    transformRuleDrafts.set(item.contribution.id, readExtensionTextTransformRule(input.packageId, item.contribution.id, item.artifact))
  }
  const textExtractorDrafts = new Map<string, TextExtractorDraft>()
  for (const item of input.textExtractors) {
    if (textExtractorDrafts.has(item.contribution.id)) throw new Error(`Extension Text Extractor contribution is duplicated: ${item.contribution.id}`)
    textExtractorDrafts.set(item.contribution.id, readExtensionTextExtractor(input.packageId, item.contribution.id, item.artifact))
  }

  const promptArtifacts = new Map<string, PromptResourceArtifact>()
  const nodeIds = new Set<string>()
  for (const item of input.promptResources) {
    if (!isPromptResourceArtifact(item.artifact)) throw new Error(`Extension Prompt Resource artifact is invalid: ${item.contribution.id}`)
    if (item.artifact.scriptAttachments?.length || item.artifact.textTransformRules?.length) {
      throw new Error(`Extension Prompt Resource must not contain nested scripts or rules; declare them as package contributions: ${item.contribution.id}`)
    }
    if (item.artifact.resourceKind !== item.contribution.resourceKind) {
      throw new Error(`Extension Prompt Resource kind does not match its manifest: ${item.contribution.id}`)
    }
    validateExtensionPromptNodeIds(input.packageId, item.artifact.rootNode, nodeIds)
    const artifact = structuredClone(item.artifact)
    if (target.kind === 'card') remapInstalledPromptNodeIds(artifact.rootNode, localId)
    promptArtifacts.set(item.contribution.id, artifact)
    if (item.contribution.scriptMounts?.length && item.contribution.resourceKind !== 'preset') throw new Error('Loom Script mounts require an Agent preset')
    for (const mount of item.contribution.scriptMounts ?? []) {
      const id = scriptMountId(item.contribution.id, mount.scriptId)
      if (!scriptMetadata.has(mount.scriptId) || desiredScriptMountIds.has(id)) throw new Error('Unresolved or duplicate Loom Script mount')
      if (mount.orderIndex !== undefined && (!Number.isSafeInteger(mount.orderIndex) || mount.orderIndex < 0)) throw new Error('Invalid Loom Script mount order')
      desiredScriptMountIds.add(id)
    }
    for (const mount of item.contribution.settingMounts ?? []) {
      if (item.contribution.resourceKind !== 'preset') throw new Error('Setting mounts require an Agent preset')
      const reference = mount.reference ?? (mount.resourceId ? { kind: 'package' as const, contributionId: mount.resourceId } : undefined)
      if (!reference || (mount.reference && mount.resourceId)) throw new Error('Invalid extension Setting mount reference')
      if (reference.kind === 'package') {
        const linked = promptContributions.get(reference.contributionId)
        if (!linked || linked.contribution.resourceKind !== 'setting') throw new Error(`Extension Preset Setting mount is unresolved: ${reference.contributionId}`)
      } else if (reference.kind === 'external') {
        if (typeof reference.resourceId !== 'string' || !reference.resourceId.trim()) throw new Error('Invalid external Setting resource ID')
        const source = reference.origin
        if (source && (typeof source.packageId !== 'string' || !source.packageId.trim()
          || typeof source.contributionId !== 'string' || !source.contributionId.trim()
          || (source.target !== 'global' && source.target !== 'card')
          || (source.target === 'card' && target.kind !== 'card'))) throw new Error('Invalid external Setting origin')
      } else throw new Error('Invalid extension Setting mount reference')
    }
    for (const mount of item.contribution.toolMounts ?? []) {
      const definition = agentToolDefinitions.get(mount.toolId)
      if (!definition) throw new Error(`Extension Preset Tool mount is unresolved: ${mount.toolId}`)
      if (mount.activation !== undefined && !isPromptActivation(mount.activation)) throw new Error(`Extension Preset Tool activation is invalid: ${mount.toolId}`)
      if (definition.input.kind === 'structured' && mount.content !== undefined) throw new Error(`Structured Tool cannot use Content placement: ${mount.toolId}`)
    }
  }

  const existingPromptResources = await listMappedResources(ctx.promptResources, undefined, { includeTombstone: true })
  const existingPromptById = new Map(existingPromptResources.map(resource => [resource.id, resource]))
  const promptResourceIndex = indexExtensionResourceOrigins(
    existingPromptResources,
    resource => ({
      id: resource.id,
      version: resource.version,
      tombstoned: resource.tombstoned === true,
      origin: resource.origin,
    }),
    owns,
    promptContributions,
    'Prompt Resource',
    assertPackageVersion,
  )
  const promptResourceIds = promptResourceIndex.ids
  const restorablePromptResourceVersions = promptResourceIndex.restorableVersions

  const storedAgentTools = await listAgentToolEntries(ctx)
  for (const tool of storedAgentTools) {
    if (!tool.origin || !owns(tool.origin)) continue
    assertPackageVersion(tool.origin.packageVersion, tool.origin.contributionId, 'Agent Tool')
  }

  const existingAgentTools = new Set<string>()
  const agentToolVersions = new Map<string, number>()
  const restorableAgentToolVersions = new Map<string, number>()
  for (const [contributionId, definition] of agentToolDefinitions) {
    const toolId = definition.id
    const document = await ctx.documents.get(toolId, { includeTombstone: true })
    if (!document) continue
    if (document.type !== applicationDocumentTypes.agentTool) throw new Error(`Extension Agent Tool id conflicts with another Document: ${toolId}`)
    const content = document.content as AgentToolContent
    if (!owns(content.origin) || content.origin?.contributionId !== contributionId) {
      throw new Error(`Extension Agent Tool id is already owned by another source: ${toolId}`)
    }
    assertPackageVersion(content.origin.packageVersion, toolId, 'Agent Tool')
    agentToolVersions.set(toolId, document.version)
    if (document.meta.tombstone) {
      restorableAgentToolVersions.set(toolId, document.version)
      continue
    }
    existingAgentTools.add(toolId)
  }

  const storedRules = await listDocumentsIncludingTombstones<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)
  const transformRuleIndex = indexExtensionResourceOrigins(
    storedRules,
    document => ({
      id: document.id,
      version: document.version,
      tombstoned: Boolean(document.meta.tombstone),
      origin: document.content.origin,
    }),
    owns,
    transformRuleDrafts,
    'Text Transform Rule',
    assertPackageVersion,
  )
  const transformRuleIds = transformRuleIndex.ids
  const restorableTransformRuleVersions = transformRuleIndex.restorableVersions

  const storedExtractors = await listDocumentsIncludingTombstones<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor)
  const textExtractorIndex = indexExtensionResourceOrigins(
    storedExtractors,
    document => ({
      id: document.id,
      version: document.version,
      tombstoned: Boolean(document.meta.tombstone),
      origin: document.content.origin,
    }),
    owns,
    textExtractorDrafts,
    'Text Extractor',
    assertPackageVersion,
  )
  const textExtractorIds = textExtractorIndex.ids
  const restorableTextExtractorVersions = textExtractorIndex.restorableVersions
  const missingTransformRules = input.transformRules.filter(item => input.update || !transformRuleIds.has(item.contribution.id) || restorableTransformRuleVersions.has(item.contribution.id))
  const missingTextExtractors = input.textExtractors.filter(item => input.update || !textExtractorIds.has(item.contribution.id) || restorableTextExtractorVersions.has(item.contribution.id))
  for (const contributionId of transformRuleDrafts.keys()) {
    if (!transformRuleIds.has(contributionId)) transformRuleIds.set(contributionId, ctx.createId('text-transform-rule'))
  }
  for (const contributionId of textExtractorDrafts.keys()) {
    if (!textExtractorIds.has(contributionId)) textExtractorIds.set(contributionId, ctx.createId('text-extractor'))
  }
  const resolveTextUses = (item: typeof input.promptResources[number]) => {
    if (item.contribution.textUses?.length && item.contribution.resourceKind !== 'preset') {
      throw new Error('Text use configuration requires an Agent preset')
    }
    const seen = new Set<string>()
    return item.contribution.textUses?.map(use => {
      if (!use || (use.kind !== 'rule' && use.kind !== 'extractor')
        || !use.reference || (use.reference.kind !== 'package' && use.reference.kind !== 'external')
        || typeof use.enabled !== 'boolean'
        || (use.orderIndex !== undefined && (!Number.isSafeInteger(use.orderIndex) || use.orderIndex < 0))) {
        throw new Error('Invalid extension Text use')
      }
      const identity = `${use.kind}:${JSON.stringify(use.reference)}`
      if (seen.has(identity)) throw new Error('Duplicate extension Text use')
      seen.add(identity)
      const local = use.kind === 'rule' ? transformRuleIds : textExtractorIds
      const declared = use.kind === 'rule' ? transformRuleDrafts : textExtractorDrafts
      if (use.reference.kind === 'package') {
        if (typeof use.reference.contributionId !== 'string' || !declared.has(use.reference.contributionId)) {
          throw new Error(`Unresolved package Text use: ${use.reference.contributionId}`)
        }
      } else {
        if (typeof use.reference.resourceId !== 'string' || !use.reference.resourceId.trim()) throw new Error('Invalid external Text use resource ID')
        const origin = use.reference.origin
        if (origin && (typeof origin.packageId !== 'string' || !origin.packageId.trim()
          || typeof origin.contributionId !== 'string' || !origin.contributionId.trim()
          || (origin.target !== 'card' && origin.target !== 'global'))) throw new Error('Invalid external Text use origin')
      }
      const external = use.reference.kind === 'external' ? use.reference.origin : undefined
      if (external && external.target === 'card' && target.kind !== 'card') {
        throw new Error('External Text use requires a Card installation target')
      }
      const records = use.kind === 'rule' ? storedRules : storedExtractors
      const sameInstallation = external?.packageId === input.packageId && external.target === target.kind
        && external.contributionId && declared.has(external.contributionId)
      const matching = external && records.find(record => !record.meta.tombstone
        && record.content.origin?.packageId === external.packageId
        && record.content.origin.contributionId === external.contributionId
        && record.content.origin.installationId === extensionInstallationId(external.packageId,
          external.target === 'global' ? { kind: 'global' } : target))
      const id = use.reference.kind === 'package'
        ? local.get(use.reference.contributionId)!
        : sameInstallation ? local.get(external!.contributionId)! : matching?.id ?? use.reference.resourceId
      return { id, kind: use.kind, enabled: use.enabled,
        ...(use.orderIndex === undefined ? {} : { orderIndex: use.orderIndex }),
        reference: structuredClone(use.reference) }
    })
  }

  const missingPromptResources = input.promptResources.filter(item => input.update || !promptResourceIds.has(item.contribution.id) || restorablePromptResourceVersions.has(item.contribution.id))
  const textUsesByContribution = new Map(input.promptResources.map(item => [item.contribution.id, resolveTextUses(item)]))
  const missingAgentTools = input.agentTools.filter(item => input.update || !existingAgentTools.has(localId(item.contribution.id)))
  const missingScripts = scripts.filter(item => input.update || !storedScriptById.has(scriptDocumentId(item.contribution.id)) || storedScriptById.get(scriptDocumentId(item.contribution.id))!.meta.tombstone)
  const missingScriptMounts = [...desiredScriptMountIds].some(id => !storedScriptMountById.has(id) || storedScriptMountById.get(id)!.meta.tombstone)
  const scriptResult = scripts.length ? { loomScripts: scripts.map(item => ({ contributionId: item.contribution.id, scriptId: scriptDocumentId(item.contribution.id) })) } : {}
  if (!input.update && !bindsArchive && !missingScriptMounts && missingScripts.length === 0 && installation && !installation.meta.tombstone && missingPromptResources.length === 0 && missingAgentTools.length === 0 && missingTransformRules.length === 0 && missingTextExtractors.length === 0) {
    return {
      ...scriptResult,
      installationId,
      promptResources: input.promptResources.map(item => ({
        contributionId: item.contribution.id,
        resourceId: promptResourceIds.get(item.contribution.id)!,
        resourceKind: item.contribution.resourceKind,
      })),
      agentTools: input.agentTools.map(item => ({ contributionId: item.contribution.id, toolId: localId(item.contribution.id) })),
      transformRules: input.transformRules.map(item => ({ contributionId: item.contribution.id, ruleId: transformRuleIds.get(item.contribution.id)! })),
      textExtractors: input.textExtractors.map(item => ({ contributionId: item.contribution.id, extractorId: textExtractorIds.get(item.contribution.id)! })),
    }
  }

  if (missingScripts.length > 0 && !ctx.blobs) throw new Error('Blob Store is required for extension Loom Scripts')
  const preparation = await Promise.allSettled(missingScripts.map(async item => ({
    id: item.contribution.id,
    blob: await ctx.blobs!.prepareWrite({ source: new TextEncoder().encode(item.source), mediaType: 'text/javascript' }),
  })))
  const prepared = preparation.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failed = preparation.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    await Promise.all(prepared.map(item => ctx.blobs!.discardPreparedWrite(item.blob)))
    throw failed.reason
  }
  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.importExtensionPackageResources',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async documents => {
      if (target.kind === 'card' && input.expectedCardVersion !== undefined) {
        const card = await readDocument<CardSourceContent>(documents, target.cardId, applicationDocumentTypes.cardSource)
        if (card.version !== input.expectedCardVersion) throw new Error('Card archive changed before resource installation')
      }
      if (!installation || installation.meta.tombstone || input.update || bindsArchive) {
        await writeDocument<ExtensionInstallationContent>(documents, {
          id: installationId,
          type: applicationDocumentTypes.extensionInstallation,
          content: {
            packageId: input.packageId, packageVersion: input.packageVersion, target,
            ...((archiveBlobId ?? previousArchiveBlobId) ? { archiveBlobId: archiveBlobId ?? previousArchiveBlobId } : {}),
            createdAt: installation ? (installation.content as ExtensionInstallationContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: installation?.version ?? 'new',
        })
      }
      if (input.update) {
        const desiredScriptIds = new Set(scripts.map(item => scriptDocumentId(item.contribution.id)))
        for (const script of storedScripts) {
          if (!script.meta.tombstone && !desiredScriptIds.has(script.id)) await documents.delete({ id: script.id, expectedVersion: script.version })
        }
        for (const mount of storedScriptMounts) {
          if (!mount.meta.tombstone && !desiredScriptMountIds.has(mount.id)) await documents.delete({ id: mount.id, expectedVersion: mount.version })
        }
        for (const resource of existingPromptResources) {
          if (!resource.tombstoned && owns(resource.origin) && resource.origin?.kind === 'extension-package'
            && !promptContributions.has(resource.origin.contributionId)) {
            resourceTx.deleteResource({ resourceId: resource.id, expectedVersion: resource.version })
          }
        }
        for (const tool of storedAgentTools) {
          if (owns(tool.origin) && tool.origin && !agentToolDefinitions.has(tool.origin.contributionId)) {
            await documents.delete({ id: tool.id, expectedVersion: tool.version })
          }
        }
        for (const [records, contributions] of [[storedRules, transformRuleDrafts], [storedExtractors, textExtractorDrafts]] as const) {
          for (const record of records) {
            if (!record.meta.tombstone && owns(record.content.origin) && record.content.origin
              && !contributions.has(record.content.origin.contributionId)) {
              await documents.delete({ id: record.id, expectedVersion: record.version })
            }
          }
        }
      }
      const newlyCreatedPromptIds = new Set<string>()
      for (const item of missingPromptResources) {
        const artifact = promptArtifacts.get(item.contribution.id)!
        const restorableVersion = restorablePromptResourceVersions.get(item.contribution.id)
        const resourceId = promptResourceIds.get(item.contribution.id) ?? ctx.createId('prompt-resource')
        const previous = existingPromptById.get(resourceId)
        if (input.update && previous) {
          if (previous.resourceKind !== artifact.resourceKind) throw new Error(`Extension resource kind changed: ${item.contribution.id}`)
          const restored = previous.tombstoned
            ? resourceTx.restoreResource({ resourceId, expectedVersion: previous.version })
            : undefined
          const replacement = toStoredResourceInput({
            id: resourceId,
            content: {
              ...previous,
              rootNode: structuredClone(artifact.rootNode),
              macros: structuredClone(artifact.macros ?? {}),
              macroOptions: structuredClone(artifact.macroOptions ?? {}),
              ...(textUsesByContribution.get(item.contribution.id) ? { textUses: textUsesByContribution.get(item.contribution.id) } : {}),
              origin: origin(item.contribution.id),
              updatedAt: timestamp,
            },
          })
          resourceTx.mutateResource({
            resourceId, expectedVersion: restored?.version ?? previous.version,
            mutations: [
              { kind: 'tree.replace', rootNode: replacement.rootNode },
              { kind: 'resource.update', patch: { label: replacement.label, metadata: replacement.metadata } },
            ],
          })
        } else if (restorableVersion === undefined) {
          resourceTx.createResource(toStoredResourceInput({
            id: resourceId,
            content: {
              resourceKind: artifact.resourceKind,
              rootNode: structuredClone(artifact.rootNode),
              ...(artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
              ...(artifact.macros !== undefined ? { macros: structuredClone(artifact.macros) } : {}),
              ...(artifact.macroOptions !== undefined ? { macroOptions: structuredClone(artifact.macroOptions) } : {}),
              ...(textUsesByContribution.get(item.contribution.id) ? { textUses: textUsesByContribution.get(item.contribution.id) } : {}),
              origin: origin(item.contribution.id),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          }))
        } else {
          resourceTx.restoreResource({ resourceId, expectedVersion: restorableVersion })
        }
        promptResourceIds.set(item.contribution.id, resourceId)
        newlyCreatedPromptIds.add(item.contribution.id)
      }
      for (const item of missingAgentTools) {
        const definition = agentToolDefinitions.get(item.contribution.id)!
        await writeDocument<AgentToolContent>(documents, {
          id: definition.id,
          type: applicationDocumentTypes.agentTool,
          content: toAgentToolContent(definition, timestamp, timestamp, origin(item.contribution.id)),
          expectedVersion: (input.update ? agentToolVersions.get(definition.id) : restorableAgentToolVersions.get(definition.id)) ?? 'new',
        })
      }
      for (const item of missingTransformRules) {
        const contributionId = item.contribution.id
        const draft = transformRuleDrafts.get(contributionId)!
        const ruleId = transformRuleIds.get(contributionId) ?? ctx.createId('text-transform-rule')
        await writeDocument<TextTransformRuleContent>(documents, {
          id: ruleId,
          type: applicationDocumentTypes.textTransformRule,
          content: {
            ...structuredClone(draft),
            origin: origin(contributionId),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: (input.update ? transformRuleIndex.versions.get(contributionId) : restorableTransformRuleVersions.get(contributionId)) ?? 'new',
        })
        transformRuleIds.set(contributionId, ruleId)
      }
      for (const item of missingTextExtractors) {
        const contributionId = item.contribution.id
        const draft = textExtractorDrafts.get(contributionId)!
        const extractorId = textExtractorIds.get(contributionId) ?? ctx.createId('text-extractor')
        await writeDocument<TextExtractorContent>(documents, {
          id: extractorId,
          type: applicationDocumentTypes.textExtractor,
          content: {
            ...structuredClone(draft),
            origin: origin(contributionId),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: (input.update ? textExtractorIndex.versions.get(contributionId) : restorableTextExtractorVersions.get(contributionId)) ?? 'new',
        })
        textExtractorIds.set(contributionId, extractorId)
      }
      for (const item of prepared) {
        const id = scriptDocumentId(item.id)
        const existing = storedScriptById.get(id)
        const blob = ctx.blobs!.participateWrite(dataTx, item.blob).blob
        await writeDocument<LoomScriptContent>(documents, {
          id, type: applicationDocumentTypes.loomScript, expectedVersion: existing?.version ?? 'new',
          content: {
            owner: { kind: 'extension', packageId: input.packageId, installationId },
            ...scriptMetadata.get(item.id)!,
            source: { blobId: blob.id, mediaType: 'text/javascript', fileName: scripts.find(script => script.contribution.id === item.id)!.contribution.source.split('/').at(-1)! },
            sourceDigest: blob.sha256, createdAt: existing?.content.createdAt ?? timestamp, updatedAt: timestamp,
          },
        })
      }
      for (const item of input.promptResources) {
        for (const [orderIndex, mount] of (item.contribution.scriptMounts ?? []).entries()) {
          const id = scriptMountId(item.contribution.id, mount.scriptId)
          const existing = storedScriptMountById.get(id)
          if (existing && !existing.meta.tombstone && !input.update) continue
          const scriptId = scriptDocumentId(mount.scriptId)
          const previousScript = storedScriptById.get(scriptId)
          const metadata = scriptMetadata.get(mount.scriptId)!
          const sameCapabilities = previousScript && !previousScript.meta.tombstone
            && JSON.stringify(previousScript.content.requestedCapabilities) === JSON.stringify(metadata.requestedCapabilities)
          await writeDocument<LoomScriptMountContent>(documents, {
            id, type: applicationDocumentTypes.loomScriptMount, expectedVersion: existing?.version ?? 'new',
            content: {
              target: { kind: 'preset', presetId: promptResourceIds.get(item.contribution.id)! },
              scriptDocumentId: scriptId, enabled: Boolean(existing && !existing.meta.tombstone && sameCapabilities && existing.content.enabled),
              orderIndex: mount.orderIndex ?? orderIndex,
              grantedCapabilities: existing && !existing.meta.tombstone
                ? existing.content.grantedCapabilities.filter(capability => metadata.requestedCapabilities.includes(capability)) : [],
              origin: origin(item.contribution.id), createdAt: existing?.content.createdAt ?? timestamp, updatedAt: timestamp,
            },
          })
        }
      }
      for (const item of input.promptResources) {
        if (!newlyCreatedPromptIds.has(item.contribution.id) || item.contribution.resourceKind !== 'preset') continue
        const presetResourceId = promptResourceIds.get(item.contribution.id)!
        if (input.update) {
          resourceTx.replaceSettingMounts({ source: { kind: 'preset', id: presetResourceId }, mounts: [] })
          resourceTx.replacePresetToolMounts({ presetResourceId, mounts: [] })
        }
        for (const [orderIndex, mount] of (item.contribution.settingMounts ?? []).entries()) {
          const reference = mount.reference ?? { kind: 'package' as const, contributionId: mount.resourceId! }
          const external = reference.kind === 'external' ? reference.origin : undefined
          const sameInstallation = external?.packageId === input.packageId && external.target === target.kind
            && promptContributions.get(external.contributionId)?.contribution.resourceKind === 'setting'
          const resolved = reference.kind === 'package' ? promptResourceIds.get(reference.contributionId)!
            : sameInstallation ? promptResourceIds.get(external!.contributionId)!
              : external ? existingPromptResources.find(resource => !resource.tombstoned
                && resource.resourceKind === 'setting'
                && resource.origin?.kind === 'extension-package'
                && resource.origin.packageId === external.packageId
                && resource.origin.contributionId === external.contributionId
                && resource.origin.installationId === extensionInstallationId(external.packageId,
                  external.target === 'global' ? { kind: 'global' } : target))?.id
                : undefined
          resourceTx.addSettingMount({
            source: { kind: 'preset', id: presetResourceId },
            settingResourceId: resolved ?? null,
            reference,
            orderIndex: mount.orderIndex ?? orderIndex,
            origin: origin(item.contribution.id),
          })
        }
        for (const [orderIndex, mount] of (item.contribution.toolMounts ?? []).entries()) {
          resourceTx.addPresetToolMount({
            presetResourceId,
            toolId: localId(mount.toolId),
            orderIndex: mount.orderIndex ?? orderIndex,
            defaultEnabled: mount.defaultEnabled ?? false,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: origin(item.contribution.id),
          })
        }
      }
      return undefined
    }, { allowEmpty: true })
  }).catch(async error => {
    await Promise.all(prepared.map(item => ctx.blobs!.discardPreparedWrite(item.blob)))
    throw error
  })
  await refreshAgentToolRegistry(ctx)
  return {
    ...scriptResult,
    installationId,
    promptResources: input.promptResources.map(item => ({
      contributionId: item.contribution.id,
      resourceId: promptResourceIds.get(item.contribution.id)!,
      resourceKind: item.contribution.resourceKind,
    })),
    agentTools: input.agentTools.map(item => ({ contributionId: item.contribution.id, toolId: localId(item.contribution.id) })),
    transformRules: input.transformRules.map(item => ({ contributionId: item.contribution.id, ruleId: transformRuleIds.get(item.contribution.id)! })),
    textExtractors: input.textExtractors.map(item => ({ contributionId: item.contribution.id, extractorId: textExtractorIds.get(item.contribution.id)! })),
    mutation: { changesetId: transaction.commit.changesetId },
  }
}

async function removeExtensionPackageResourcesInternal(
  ctx: ExtensionsRuntimeContext,
  input: RemoveExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
): Promise<RemoveExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  const installationId = extensionInstallationId(input.packageId, input.target ?? { kind: 'global' })
  if (input.uninstall && input.expectedInstallationVersion === undefined) throw new Error('Uninstall requires the expected installation version')
  if (input.expectedInstallationVersion !== undefined) {
    const installation = await readDocument<ExtensionInstallationContent>(ctx.documents, installationId, applicationDocumentTypes.extensionInstallation)
    if (installation.version !== input.expectedInstallationVersion) throw new Error('Extension installation changed before resource removal')
  }
  const owns = (candidate: ExtensionResourceOriginCandidate | undefined) =>
    matchesExtensionInstallation(candidate, input.packageId, installationId)
  const promptResources = (await listMappedResources(ctx.promptResources))
    .filter(resource => owns(resource.origin))
  const promptResourceIds = new Set(promptResources.map(resource => resource.id))
  const agentTools = (await listAgentToolEntries(ctx))
    .filter(tool => owns(tool.origin))
  const agentToolIds = new Set(agentTools.map(tool => tool.id))
  const transformRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
    .filter(rule => owns(rule.content.origin))
  const textTransformRuleIds = new Set(transformRules.map(rule => rule.id))
  const textExtractors = (await listDocuments<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor))
    .filter(extractor => owns(extractor.content.origin))
  const textExtractorIds = new Set(textExtractors.map(extractor => extractor.id))
  const scripts = (await listDocuments<LoomScriptContent>(ctx.documents, applicationDocumentTypes.loomScript))
    .filter(script => script.content.owner.kind === 'extension' && script.content.owner.packageId === input.packageId
      && script.content.owner.installationId === installationId)
  const scriptMounts = (await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => owns(mount.content.origin))
  const scriptRemoval = scripts.length || scriptMounts.length ? {
    loomScriptIds: scripts.map(script => script.id), loomScriptMountIds: scriptMounts.map(mount => mount.id),
  } : {}

  if (!input.uninstall && scripts.length === 0 && scriptMounts.length === 0 && promptResources.length === 0 && agentTools.length === 0 && transformRules.length === 0 && textExtractors.length === 0) {
    return {
      packageId: input.packageId,
      promptResourceIds: [],
      agentToolIds: [],
      textTransformRuleIds: [],
      textExtractorIds: [],
      detachedReferences: { cards: 0, timelines: 0, presetToolMounts: 0 },
    }
  }

  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.removeExtensionPackageResources',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async documents => {
      if (input.expectedInstallationVersion !== undefined) {
        const installation = await readDocument<ExtensionInstallationContent>(documents, installationId, applicationDocumentTypes.extensionInstallation)
        if (installation.version !== input.expectedInstallationVersion) throw new Error('Extension installation changed before resource removal')
        if (input.uninstall) await documents.delete({ id: installationId, expectedVersion: installation.version })
      }
      for (const tool of agentTools) await documents.delete({ id: tool.id, expectedVersion: tool.version })
      for (const rule of transformRules) await documents.delete({ id: rule.id, expectedVersion: rule.version })
      for (const extractor of textExtractors) await documents.delete({ id: extractor.id, expectedVersion: extractor.version })
      for (const mount of scriptMounts) await documents.delete({ id: mount.id, expectedVersion: mount.version })
      for (const script of scripts) await documents.delete({ id: script.id, expectedVersion: script.version })
      for (const resource of promptResources) resourceTx.deleteResource({ resourceId: resource.id, expectedVersion: resource.version })
      return undefined
    }, { allowEmpty: true })
  })
  await refreshAgentToolRegistry(ctx)
  return {
    packageId: input.packageId,
    ...scriptRemoval,
    promptResourceIds: [...promptResourceIds].sort(),
    agentToolIds: [...agentToolIds].sort(),
    textTransformRuleIds: [...textTransformRuleIds].sort(),
    textExtractorIds: [...textExtractorIds].sort(),
    detachedReferences: {
      cards: 0,
      timelines: 0,
      presetToolMounts: 0,
    },
    mutation: { changesetId: transaction.commit.changesetId },
  }
}

async function listDocumentsIncludingTombstones<T extends JsonValue>(
  documents: DocumentTransaction,
  type: string,
): Promise<Array<DocumentRecord<T>>> {
  return await collectPages(cursor => documents.list({ type, includeTombstone: true, cursor, limit: 100 })) as Array<DocumentRecord<T>>
}

type ExtensionResourceOriginCandidate = {
  kind?: string
  packageId?: string
  packageVersion?: string
  contributionId?: string
  installationId?: string
}

function matchesExtensionInstallation(
  origin: ExtensionResourceOriginCandidate | undefined,
  packageId: string,
  installationId: string,
): boolean {
  return origin?.kind === 'extension-package' && origin.packageId === packageId
    && (origin.installationId ?? extensionInstallationId(packageId, { kind: 'global' })) === installationId
}

function remapInstalledPromptNodeIds(
  root: PromptResourceArtifact['rootNode'],
  localId: (id: string) => string,
): void {
  const ids = new Set<string>()
  const collect = (node: PromptResourceArtifact['rootNode']) => {
    ids.add(node.id)
    node.children?.forEach(collect)
  }
  collect(root)
  const remap = (node: PromptResourceArtifact['rootNode']) => {
    node.id = localId(node.id)
    if (node.orderList) node.orderList = node.orderList.map(id => ids.has(id) ? localId(id) : id)
    node.children?.forEach(remap)
  }
  remap(root)
}

type ExtensionResourceOriginRecord = {
  id: string
  version: number
  tombstoned: boolean
  origin?: ExtensionResourceOriginCandidate
}

function indexExtensionResourceOrigins<T>(
  records: readonly T[],
  readRecord: (record: T) => ExtensionResourceOriginRecord,
  owns: (origin: ExtensionResourceOriginCandidate | undefined) => boolean,
  contributionIds: ReadonlyMap<string, unknown>,
  label: string,
  assertPackageVersion: (packageVersion: string | undefined, contributionId: string, label: string) => void,
): { ids: Map<string, string>; restorableVersions: Map<string, number>; versions: Map<string, number> } {
  const ids = new Map<string, string>()
  const versions = new Map<string, number>()
  const restorableVersions = new Map<string, number>()
  for (const record of records) {
    const resource = readRecord(record)
    const resourceOrigin = resource.origin
    if (!resourceOrigin || !owns(resourceOrigin)) continue
    const contributionId = resourceOrigin.contributionId
    if (!contributionId) continue
    assertPackageVersion(resourceOrigin.packageVersion, contributionId, label)
    if (!contributionIds.has(contributionId)) continue
    if (ids.has(contributionId)) throw new Error(`Extension ${label} origin is duplicated: ${contributionId}`)
    ids.set(contributionId, resource.id)
    versions.set(contributionId, resource.version)
    if (resource.tombstoned) restorableVersions.set(contributionId, resource.version)
  }
  return { ids, restorableVersions, versions }
}
