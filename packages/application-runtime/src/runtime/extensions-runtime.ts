import { createHash } from 'node:crypto'
import { resolvePackageIcon, assertPackageDependencyRevisions, resolveDeclaredPackageDependencies } from '../extensions/package-dependency.js'
import { resolveAgentToolReference, assertToolReferenceRevisions, assertToolDependencyConsumers, withToolDependencySnapshot, type ResolvedAgentToolReference } from '../extensions/tool-reference.js'
import { loomScriptMediaType } from '@loom-studio/shared/loom-scripts'
import type { DocumentRecord, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import { isDeepStrictEqual } from 'node:util'
import { validateApplicationExtensionStorageScope } from '../extensions/storage-scope.js'
import { parseExtensionInstallationSource } from '../extensions/installation-source.js'
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
} from '../cards/card-bundle-codec.js'
import type { PortableExtensionPayloadArtifact, PortableExtensionPayloadContent } from '../extensions/portable-payload-types.js'
import type { PromptResourceArtifact } from '../prompt/prompt-resource-types.js'
import { normalizeCardContent, toCardSource } from '../cards/card.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import { listScriptTextTransformRuleDocuments, prepareTextTransformScript, readPackagedTextRuleScript, writePreparedTextTransformScript } from '../scripts/script-text-resources.js'
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
  PreviewExtensionPackageResourcesInput,
  PreviewExtensionPackageResourcesResult,
  UninstallExtensionInstallationInput,
  UninstallExtensionInstallationResult,
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
} from '../agents/tool-catalog.js'

type ExtensionsRuntimeContext = Pick<ApplicationRuntimeContext,
  'agentTools' | 'agents' | 'blobs' | 'createId' | 'dataEngine' | 'documents' | 'narratives' | 'now' | 'promptResources' | 'validatePackageAsset'
>

export function createExtensionsRuntimeMethods(ctx: ExtensionsRuntimeContext) {
  return {
    checkExtensionDependencyConsumers: async (input: { packageId: string; target?: import('@loom-studio/extension-sdk').ExtensionInstallationTarget; nextVersion?: string }): Promise<void> => {
      await withToolDependencySnapshot(ctx, async (mounts, assertFresh, resources) => {
        await assertToolDependencyConsumers({ ...input, target: input.target ?? { kind: 'global' }, documents: ctx.documents, mounts, resources: input.nextVersion ? undefined : resources })
        assertFresh()
      })
    },
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
      const id = extensionConfigDocumentId(input.packageId, input.scope, input.key, input.target)
      const participant = requireDocumentParticipant(ctx)
      const mutation = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.upsertExtensionConfig',
      }, async dataTx => participant.participateTransaction(dataTx, async documents => {
        await validateApplicationExtensionStorageScope(ctx, input.scope, input.target, dataTx, documents)
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
      }))
      return { config: mutation.value.value, mutation: { changesetId: mutation.commit.changesetId } }
    },

    importExtensionPackageResources: (input: ImportExtensionPackageResourcesInput, requestContext?: RuntimeRequestContext): Promise<ImportExtensionPackageResourcesResult> =>
      importExtensionPackageResourcesInternal(ctx, input, requestContext, requireDocumentParticipant(ctx)),

    previewExtensionPackageResources: (input: PreviewExtensionPackageResourcesInput): Promise<PreviewExtensionPackageResourcesResult> =>
      importExtensionPackageResourcesInternal(ctx, input, undefined, requireDocumentParticipant(ctx), true),

    uninstallExtensionInstallation: async (input: UninstallExtensionInstallationInput, requestContext?: RuntimeRequestContext): Promise<UninstallExtensionInstallationResult> => {
      assertNonEmpty(input.packageId, 'packageId')
      const installationId = extensionInstallationId(input.packageId, input.target ?? { kind: 'global' })
      const result = await withToolDependencySnapshot(ctx, async (mounts, assertFresh, resources) => executeDocumentMutation(ctx.documents, requestContext, 'application.uninstallExtensionInstallation', async documents => {
        assertFresh()
        await readDocument<ExtensionInstallationContent>(documents, installationId, applicationDocumentTypes.extensionInstallation)
        await assertToolDependencyConsumers({ documents, mounts, resources, validatePackageAsset: ctx.validatePackageAsset, packageId: input.packageId, target: input.target ?? { kind: 'global' } })
        await documents.delete({ id: installationId, expectedVersion: input.expectedInstallationVersion })
      }))
      return { packageId: input.packageId, installationId, uninstalled: true, resourcesRetained: true, mutation: result.mutation }
    },

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
  const script = readPackagedTextRuleScript(value)
  if (script) return { ...script.rule, owner: { kind: 'extension', packageId } }
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

async function importExtensionPackageResourcesInternal(ctx: ExtensionsRuntimeContext, input: ImportExtensionPackageResourcesInput, requestContext: RuntimeRequestContext | undefined, documentParticipant: SqliteDocumentStore): Promise<ImportExtensionPackageResourcesResult>
async function importExtensionPackageResourcesInternal(ctx: ExtensionsRuntimeContext, input: PreviewExtensionPackageResourcesInput, requestContext: undefined, documentParticipant: SqliteDocumentStore, preview: true): Promise<PreviewExtensionPackageResourcesResult>
async function importExtensionPackageResourcesInternal(
  ctx: ExtensionsRuntimeContext,
  input: ImportExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
  preview = false,
): Promise<ImportExtensionPackageResourcesResult | PreviewExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  assertNonEmpty(input.packageVersion, 'packageVersion')
  const target = input.target ?? { kind: 'global' }
  const previewSnapshot = input.update && (preview || input.update.expectedPreviewFingerprint)
    ? await readExtensionPreviewSnapshot(ctx, input) : undefined
  if (input.update?.expectedPreviewFingerprint && previewSnapshot?.fingerprint !== input.update.expectedPreviewFingerprint) {
    throw new Error('Extension resources changed; preview the package update again')
  }
  const dependencyChecks = await resolveDeclaredPackageDependencies({ packageId: input.packageId, target, dependencies: input.dependencies, documents: ctx.documents })
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
  const source = input.source === undefined ? undefined : parseExtensionInstallationSource(input.source, target)
  if (input.participation !== undefined && input.participation !== 'timeline') {
    throw new Error('Extension participation must be timeline when declared')
  }
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
    if (!input.update && (installation.content as ExtensionInstallationContent).participation !== input.participation) {
      throw new Error('Extension participation declaration changed; use an explicit package update')
    }
    if (!input.update && !isDeepStrictEqual((installation.content as ExtensionInstallationContent).dependencies ?? [], input.dependencies ?? [])) throw new Error('Extension dependencies changed; use an explicit package update')
    if (!input.update && !isDeepStrictEqual((installation.content as ExtensionInstallationContent).source, source)) {
      throw new Error('Extension installation source changed; use an explicit package update')
    }
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
    if (!extensionStorageTokenPattern.test(item.contribution.id) || !(/\.(?:loom\.js|md)$/.test(item.contribution.source))) throw new Error('Invalid Loom Script contribution')
    return [item.contribution.id, parseLoomScriptSource(item.source)] as const
  }))
  if (scriptMetadata.size !== scripts.length) throw new Error('Duplicate Loom Script contribution')
  const scriptDocumentId = (id: string) => localId(`${input.packageId}/script/${id}`)
  const scriptMountId = (presetId: string, scriptId: string) => localId(`${input.packageId}/script-mount/${presetId}/${scriptId}`)
  const storedScripts = (await listDocumentsIncludingTombstones<LoomScriptContent>(ctx.documents, applicationDocumentTypes.loomScript))
    .filter(script => script.content.owner.kind === 'extension' && script.content.owner.packageId === input.packageId
      && script.content.owner.installationId === installationId)
  const storedScriptById = new Map(storedScripts.map(script => [script.id, script]))
  const storedScriptMounts = (await listDocumentsIncludingTombstones<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => owns(mount.content.origin))
  const isInstallationScriptMount = (mount: LoomScriptMountContent) => target.kind === 'card'
    ? mount.target.kind === 'card' && mount.target.cardId === target.cardId
    : mount.target.kind === 'user'
  const storedScriptMountById = new Map(storedScriptMounts.map(mount => [mount.id, mount]))
  const desiredScriptMountIds = new Set<string>()
  const packageScriptMountId = (id: string) => localId(`${input.packageId}/script-adoption/${id}`)
  for (const item of scripts) if (item.contribution.orderIndex !== undefined) desiredScriptMountIds.add(packageScriptMountId(item.contribution.id))
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

  const iconChecks: Array<{ id: string; version: number }> = []
  const resolvedToolMounts = new Map<string, ResolvedAgentToolReference[]>()
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
    if (artifact.metadata?.icon) {
      const resolved = await resolvePackageIcon({ icon: artifact.metadata.icon, consumerPackageId: input.packageId,
        consumerTarget: target, dependencies: input.dependencies, documents: ctx.documents, importingVersion: input.packageVersion })
      if (!resolved.sameInstallation) {
        if (!ctx.validatePackageAsset) throw new Error('Package asset validation is unavailable')
        await ctx.validatePackageAsset({ packageId: resolved.icon.packageId, packageVersion: resolved.packageVersion, target: resolved.icon.target, path: resolved.icon.path })
      }
      artifact.metadata.icon = resolved.icon
      iconChecks.push(...resolved.checks)
    }
    promptArtifacts.set(item.contribution.id, artifact)
    if (item.contribution.scriptMounts?.length && item.contribution.resourceKind !== 'preset') throw new Error('Loom Script mounts require an Agent preset')
    for (const mount of item.contribution.scriptMounts ?? []) {
      const id = scriptMountId(item.contribution.id, mount.scriptId)
      if (!scriptMetadata.has(mount.scriptId) || desiredScriptMountIds.has(id)) throw new Error('Unresolved or duplicate Loom Script mount')
      if (mount.orderIndex !== undefined && (!Number.isSafeInteger(mount.orderIndex) || mount.orderIndex < 0)) throw new Error('Invalid Loom Script mount order')
      desiredScriptMountIds.add(id)
    }
    for (const mount of item.contribution.loreMounts ?? []) {
      if (item.contribution.resourceKind !== 'preset') throw new Error('Lore mounts require an Agent preset')
      const reference = mount.reference ?? (mount.resourceId ? { kind: 'package' as const, contributionId: mount.resourceId } : undefined)
      if (!reference || (mount.reference && mount.resourceId)) throw new Error('Invalid extension Lore mount reference')
      if (reference.kind === 'package') {
        const linked = promptContributions.get(reference.contributionId)
        if (!linked || linked.contribution.resourceKind !== 'lore') throw new Error(`Extension Preset Lore mount is unresolved: ${reference.contributionId}`)
      } else if (reference.kind === 'external') {
        if (typeof reference.resourceId !== 'string' || !reference.resourceId.trim()) throw new Error('Invalid external Lore resource ID')
        const source = reference.origin
        if (source && (typeof source.packageId !== 'string' || !source.packageId.trim()
          || typeof source.contributionId !== 'string' || !source.contributionId.trim()
          || (source.target !== 'global' && source.target !== 'card')
          || (source.target === 'card' && target.kind !== 'card'))) throw new Error('Invalid external Lore origin')
      } else throw new Error('Invalid extension Lore mount reference')
    }
    const resolvedTools: ResolvedAgentToolReference[] = []
    for (const mount of item.contribution.toolMounts ?? []) {
      if (item.contribution.resourceKind !== 'preset') throw new Error('Tool mounts require an Agent preset')
      if ((mount.reference === undefined) === (mount.toolId === undefined)) throw new Error('Specify exactly one Tool mount reference')
      const reference = mount.reference ?? { kind: 'package' as const, contributionId: mount.toolId! }
      const resolved = await resolveAgentToolReference({ reference, packageId: input.packageId, target,
        dependencies: input.dependencies, localDefinitions: agentToolDefinitions, documents: ctx.documents, agentTools: ctx.agentTools })
      if (resolvedTools.some(previous => previous.toolId === resolved.toolId)) throw new Error(`Duplicate Tool mount: ${resolved.toolId}`)
      if (mount.activation !== undefined && !isPromptActivation(mount.activation)) throw new Error(`Extension Preset Tool activation is invalid: ${resolved.toolId}`)
      if (resolved.definition.input.kind === 'structured' && mount.content !== undefined) throw new Error(`Structured Tool cannot use Content placement: ${resolved.toolId}`)
      resolvedTools.push(resolved)
    }
    resolvedToolMounts.set(item.contribution.id, resolvedTools)
  }

  const existingPromptResources = await listMappedResources(ctx.promptResources, undefined, { includeTombstone: true })
  const existingPromptById = new Map(existingPromptResources.map(resource => [resource.id, resource]))
  const keptPromptIds = new Set(input.update?.keepPromptResourceIds ?? [])
  if (keptPromptIds.size) {
    if (!input.update?.expectedPreviewFingerprint) throw new Error('Keeping local resources requires a current update preview')
    for (const id of keptPromptIds) {
      const resource = existingPromptById.get(id)
      if (!resource || resource.tombstoned || !owns(resource.origin)) throw new Error(`Cannot keep a resource outside this installation: ${id}`)
    }
  }
  const keepsPresetMount = (mount: LoomScriptMountContent) => mount.target.kind === 'preset' && keptPromptIds.has(mount.target.presetId)
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
  if (input.update) {
    for (const [contributionId, resourceId] of promptResourceIds) {
      if (existingPromptById.get(resourceId)!.resourceKind !== promptArtifacts.get(contributionId)!.resourceKind) {
        throw new Error(`Extension resource kind changed: ${contributionId}`)
      }
    }
  }

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

  const storedRules = await listScriptTextTransformRuleDocuments(ctx.documents, true)
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

  const missingPromptResources = input.promptResources.filter(item => !keptPromptIds.has(promptResourceIds.get(item.contribution.id) ?? '') && (input.update || !promptResourceIds.has(item.contribution.id) || restorablePromptResourceVersions.has(item.contribution.id)))
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

  for (const mount of storedScriptMounts) {
    if (isInstallationScriptMount(mount.content) && storedRules.some(rule => rule.scriptDocumentId === mount.content.scriptDocumentId
      && rule.content.origin && transformRuleDrafts.has(rule.content.origin.contributionId))) desiredScriptMountIds.add(mount.id)
  }
  if (preview) {
    if (!input.update || !previewSnapshot) throw new Error('Extension resource preview requires an explicit update')
    const items: PreviewExtensionPackageResourcesResult['items'] = []
    const addPlan = (kind: string, desired: Array<{ id: string; name?: string }>, existing: Array<{ id: string; contributionId: string; name?: string; deleted?: boolean }>) => {
      for (const item of desired) {
        const previous = existing.find(record => record.contributionId === item.id)
        items.push({ kind, contributionId: item.id, ...(previous ? { resourceId: previous.id } : {}), name: item.name,
          action: previous && !previous.deleted ? 'update' : 'add', localChanges: previous ? 'unknown' : 'none' })
      }
      for (const previous of existing) if (!previous.deleted && !desired.some(item => item.id === previous.contributionId)) {
        items.push({ kind, contributionId: previous.contributionId, resourceId: previous.id, name: previous.name, action: 'remove', localChanges: 'unknown' })
      }
    }
    for (const kind of new Set([...input.promptResources.map(item => item.contribution.resourceKind), ...existingPromptResources.filter(item => owns(item.origin)).map(item => item.resourceKind)])) {
      addPlan(kind, input.promptResources.filter(item => item.contribution.resourceKind === kind).map(item => ({ id: item.contribution.id, name: promptArtifacts.get(item.contribution.id)?.rootNode.label })),
        existingPromptResources.filter(item => owns(item.origin) && item.resourceKind === kind).map(item => ({ id: item.id, contributionId: item.origin?.kind === 'extension-package' ? item.origin.contributionId : item.id, name: item.rootNode.label, deleted: item.tombstoned })))
    }
    addPlan('agent-tool', input.agentTools.map(item => ({ id: item.contribution.id, name: agentToolDefinitions.get(item.contribution.id)?.name })), storedAgentTools.filter(item => owns(item.origin)).map(item => ({ id: item.id, contributionId: item.origin?.kind === 'extension-package' ? item.origin.contributionId : item.id, name: item.name })))
    addPlan('text-transform-rule', input.transformRules.map(item => ({ id: item.contribution.id, name: transformRuleDrafts.get(item.contribution.id)?.name })), storedRules.filter(item => owns(item.content.origin)).map(item => ({ id: item.id, contributionId: item.content.origin!.contributionId, name: item.content.name, deleted: Boolean(item.meta.tombstone) })))
    addPlan('text-extractor', input.textExtractors.map(item => ({ id: item.contribution.id, name: textExtractorDrafts.get(item.contribution.id)?.name })), storedExtractors.filter(item => owns(item.content.origin)).map(item => ({ id: item.id, contributionId: item.content.origin!.contributionId, name: item.content.name, deleted: Boolean(item.meta.tombstone) })))
    addPlan('loom-script', scripts.map(item => ({ id: item.contribution.id })), storedScripts.filter(item => !storedRules.some(rule => rule.scriptDocumentId === item.id)).map(item => ({ id: item.id, contributionId: scripts.find(script => scriptDocumentId(script.contribution.id) === item.id)?.contribution.id ?? item.id, deleted: Boolean(item.meta.tombstone) })))
    addPlan('loom-script-mount', [...desiredScriptMountIds].map(id => ({ id })), storedScriptMounts.map(item => ({ id: item.id, contributionId: item.id, deleted: Boolean(item.meta.tombstone) })))
    for (const item of items) if (item.kind === 'loom-script-mount' && item.action === 'update' && storedRules.some(rule => storedScriptMountById.get(item.resourceId!)?.content.scriptDocumentId === rule.scriptDocumentId)) item.action = 'unchanged'
    for (const rule of input.transformRules) {
      const existing = storedRules.find(item => item.content.origin?.contributionId === rule.contribution.id && owns(item.content.origin))
      if (!existing || !storedScriptMounts.some(mount => mount.content.scriptDocumentId === existing.scriptDocumentId && isInstallationScriptMount(mount.content) && !mount.meta.tombstone)) {
        items.push({ kind: 'loom-script-mount', contributionId: rule.contribution.id, action: 'add', localChanges: 'none' })
      }
    }
    for (const item of items) {
      if (item.resourceId) item.references = previewSnapshot.references(item.resourceId)
      if (item.kind !== 'lore' && item.kind !== 'preset') continue
      const local = item.resourceId ? existingPromptById.get(item.resourceId) : undefined
      const incoming = promptArtifacts.get(item.contributionId)
      item.content = {
        ...(local && !local.tombstoned ? { localVersion: local.version, local: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: local.resourceKind,
          rootNode: structuredClone(local.rootNode), macros: structuredClone(local.macros ?? {}),
          macroOptions: structuredClone(local.macroOptions ?? {}),
        } } : {}),
        ...(incoming ? { incoming: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: incoming.resourceKind,
          rootNode: structuredClone(incoming.rootNode), macros: structuredClone(incoming.macros ?? {}),
          macroOptions: structuredClone(incoming.macroOptions ?? {}),
        } } : {}),
      }
      if (item.content.local && item.content.incoming && isDeepStrictEqual(item.content.local, item.content.incoming)) item.action = 'unchanged'
    }
    return { packageId: input.packageId, installationId, packageVersion: input.packageVersion,
      expectedInstallationVersion: input.update.expectedInstallationVersion, fingerprint: previewSnapshot.fingerprint, items,
      warnings: ['Local changes are unknown: no reliable author baseline is stored.', 'Historical removed Scripts and Script mounts may use their stored resource ID as contributionId because author IDs are not retained.', 'Reference inspection matches stored resource IDs in Documents and Prompt resources; matches may include textual mentions, and running or external consumers are not exhaustive.', 'Unselected resources use the package content; kept resources retain their current local content.'] }
  }
  if (input.update?.expectedPreviewFingerprint && (await readExtensionPreviewSnapshot(ctx, input)).fingerprint !== input.update.expectedPreviewFingerprint) throw new Error('Extension resources changed; preview the package update again')

  for (const id of keptPromptIds) {
    if (existingPromptById.get(id)?.resourceKind !== 'preset') continue
    for (const mount of await ctx.promptResources.listLoreMounts({ source: { kind: 'preset', id } })) {
      const referenced = existingPromptById.get(mount.resolvedLoreResourceId ?? mount.loreResourceId ?? '')
      if (referenced?.origin?.kind === 'extension-package' && owns(referenced.origin)
        && !promptContributions.has(referenced.origin.contributionId) && !keptPromptIds.has(referenced.id)) {
        throw new Error(`Kept preset references a removed Lore; keep that resource too: ${referenced.id}`)
      }
    }
    for (const mount of await ctx.promptResources.listPresetToolMounts({ presetResourceId: id })) {
      const tool = storedAgentTools.find(tool => tool.id === mount.toolId)
      if (tool?.origin && owns(tool.origin) && !agentToolDefinitions.has(tool.origin.contributionId)) throw new Error(`Kept preset references a removed tool: ${tool.id}`)
    }
    for (const mount of storedScriptMounts.filter(mount => !mount.meta.tombstone && mount.content.target.kind === 'preset' && mount.content.target.presetId === id)) {
      if (storedScripts.some(script => script.id === mount.content.scriptDocumentId)
        && !scripts.some(script => scriptDocumentId(script.contribution.id) === mount.content.scriptDocumentId)
        && !storedRules.some(rule => rule.scriptDocumentId === mount.content.scriptDocumentId && rule.content.origin && transformRuleDrafts.has(rule.content.origin.contributionId))) {
        throw new Error(`Kept preset references a removed script: ${mount.content.scriptDocumentId}`)
      }
    }
  }

  if ((missingScripts.length > 0 || missingTransformRules.length > 0) && !ctx.blobs) throw new Error('Blob Store is required for extension Loom Scripts')
  const preparedTransformRules = await Promise.all(missingTransformRules.map(async item => {
    const contributionId = item.contribution.id
    const ruleId = transformRuleIds.get(contributionId)!
    const existing = storedRules.find(rule => rule.id === ruleId)
    const rule = { ...transformRuleDrafts.get(contributionId)!, origin: origin(contributionId), createdAt: existing?.content.createdAt ?? timestamp, updatedAt: timestamp }
    const scriptId = existing?.scriptDocumentId ?? ctx.createId('loom-script')
    const mountId = storedScriptMounts.find(mount => mount.content.scriptDocumentId === scriptId && isInstallationScriptMount(mount.content))?.id ?? ctx.createId('loom-script-mount')
    const packaged = readPackagedTextRuleScript(item.artifact)
    const prepared = packaged ? { metadata: packaged.metadata,
      prepared: await ctx.blobs!.prepareWrite({ source: new TextEncoder().encode(packaged.source), mediaType: loomScriptMediaType(packaged.fileName) }),
    } : await prepareTextTransformScript(ctx.blobs!, rule)
    return { ruleId, scriptId, mountId, rule, expectedVersion: existing?.version,
      ...prepared, ...(packaged ? { fileName: packaged.fileName, primaryContributionId: packaged.primaryContributionId, settings: packaged.settings, groupOrder: packaged.groupOrder } : {}) }
  }))
  const preparation = await Promise.allSettled(missingScripts.map(async item => ({
    id: item.contribution.id,
    blob: await ctx.blobs!.prepareWrite({ source: new TextEncoder().encode(item.source), mediaType: loomScriptMediaType(item.contribution.source) }),
  })))
  const prepared = preparation.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failed = preparation.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    throw failed.reason
  }
  const transaction = await withToolDependencySnapshot(ctx, async (dependencyMounts, assertFresh, dependencyResources) => ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.importExtensionPackageResources',
  }, async dataTx => {
    assertFresh()
    const resourceTx = ctx.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async documents => {
      if (input.update?.expectedPreviewFingerprint && (await readExtensionPreviewSnapshot({ ...ctx, documents, promptResources: { ...ctx.promptResources, listResources: async input => resourceTx.listResources(input), listLoreMounts: async input => resourceTx.listLoreMounts(input), listPresetToolMounts: async input => resourceTx.listPresetToolMounts(input) } }, input)).fingerprint !== input.update.expectedPreviewFingerprint) throw new Error('Extension resources changed; preview the package update again')
      await assertToolReferenceRevisions(documents, [...resolvedToolMounts.values()].flat())
      await assertPackageDependencyRevisions(documents, [...iconChecks, ...dependencyChecks])
      if (input.update) await assertToolDependencyConsumers({ documents, mounts: dependencyMounts, resources: dependencyResources, validatePackageAsset: ctx.validatePackageAsset,
        packageId: input.packageId, target, nextVersion: input.packageVersion, nextContributions: new Set(agentToolDefinitions.keys()), nextPresetContributions: new Set([...promptContributions].filter(([, item]) => item.contribution.resourceKind === 'preset').map(([id]) => id)) })
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
            ...(input.participation ? { participation: input.participation } : {}),
            ...(input.dependencies ? { dependencies: structuredClone(input.dependencies) } : {}),
            ...(source ? { source } : {}),
            ...((archiveBlobId ?? previousArchiveBlobId) ? { archiveBlobId: archiveBlobId ?? previousArchiveBlobId } : {}),
            createdAt: installation ? (installation.content as ExtensionInstallationContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: installation?.version ?? 'new',
        })
      }
      if (input.update) {
        for (const resourceId of keptPromptIds) {
          const resource = existingPromptById.get(resourceId)!
          if (resource.origin?.kind !== 'extension-package') continue
          const kept = toStoredResourceInput({ content: { ...resource, origin: origin(resource.origin.contributionId), updatedAt: timestamp } })
          resourceTx.mutateResource({ resourceId, expectedVersion: resource.version,
            mutations: [{ kind: 'resource.update', patch: { metadata: kept.metadata } }] })
        }
        const desiredScriptIds = new Set(scripts.map(item => scriptDocumentId(item.contribution.id)))
        for (const rule of storedRules) {
          if (rule.content.origin && owns(rule.content.origin) && transformRuleDrafts.has(rule.content.origin.contributionId)) desiredScriptIds.add(rule.scriptDocumentId)
        }
        for (const script of storedScripts) {
          if (!script.meta.tombstone && !desiredScriptIds.has(script.id)) await documents.delete({ id: script.id, expectedVersion: script.version })
        }
        for (const mount of storedScriptMounts) {
          if (!mount.meta.tombstone && !keepsPresetMount(mount.content) && !desiredScriptMountIds.has(mount.id)) await documents.delete({ id: mount.id, expectedVersion: mount.version })
        }
        for (const resource of existingPromptResources) {
          if (!resource.tombstoned && !keptPromptIds.has(resource.id) && owns(resource.origin) && resource.origin?.kind === 'extension-package'
            && !promptContributions.has(resource.origin.contributionId)) {
            resourceTx.deleteResource({ resourceId: resource.id, expectedVersion: resource.version })
          }
        }
        for (const tool of storedAgentTools) {
          if (owns(tool.origin) && tool.origin && !agentToolDefinitions.has(tool.origin.contributionId)) {
            await documents.delete({ id: tool.id, expectedVersion: tool.version })
          }
        }
        for (const [records, contributions] of [[storedExtractors, textExtractorDrafts]] as const) {
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
        const metadata = structuredClone(artifact.metadata ?? {})
        const restorableVersion = restorablePromptResourceVersions.get(item.contribution.id)
        const resourceId = promptResourceIds.get(item.contribution.id) ?? ctx.createId('prompt-resource')
        const previous = existingPromptById.get(resourceId)
        if (input.update && previous) {
          const restored = previous.tombstoned
            ? resourceTx.restoreResource({ resourceId, expectedVersion: previous.version })
            : undefined
          const replacement = toStoredResourceInput({
            id: resourceId,
            content: {
              ...previous,
              rootNode: structuredClone(artifact.rootNode),
              metadata,
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
              metadata,
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
        const original = agentToolDefinitions.get(item.contribution.id)!
        const definition = original.prompt?.loreRefs ? { ...original, prompt: { ...original.prompt,
          loreRefs: original.prompt.loreRefs.map(ref => promptResourceIds.has(ref.resourceId)
            ? { resourceId: promptResourceIds.get(ref.resourceId)!, nodeId: localId(ref.nodeId) } : ref),
        } } : original
        await writeDocument<AgentToolContent>(documents, {
          id: definition.id,
          type: applicationDocumentTypes.agentTool,
          content: toAgentToolContent(definition, timestamp, timestamp, origin(item.contribution.id)),
          expectedVersion: (input.update ? agentToolVersions.get(definition.id) : restorableAgentToolVersions.get(definition.id)) ?? 'new',
        })
      }
      for (const item of preparedTransformRules) {
        await writePreparedTextTransformScript(documents, {
          scriptId: item.scriptId, mountId: item.mountId, ruleId: item.ruleId, rule: item.rule,
          blob: ctx.blobs!.participateWrite(dataTx, item.prepared).blob, metadata: item.metadata,
          expectedVersion: item.expectedVersion,
          mountTarget: target.kind === 'card' ? target : { kind: 'user' },
          fileName: item.fileName, primaryContributionId: item.primaryContributionId, settings: item.settings, groupOrder: item.groupOrder,
        })
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
            loreResourceReferences: Object.fromEntries(promptResourceIds),
            loreNodeReferences: Object.fromEntries([...nodeIds].map(id => [id, localId(id)])),
            source: { blobId: blob.id, mediaType: loomScriptMediaType(scripts.find(script => script.contribution.id === item.id)!.contribution.source), fileName: scripts.find(script => script.contribution.id === item.id)!.contribution.source.split('/').at(-1)! },
            sourceDigest: blob.sha256, createdAt: existing?.content.createdAt ?? timestamp, updatedAt: timestamp,
          },
        })
      }
      for (const item of scripts) {
        if (item.contribution.orderIndex === undefined) continue
        const id = packageScriptMountId(item.contribution.id)
        const existing = storedScriptMountById.get(id)
        if (existing && !existing.meta.tombstone && !input.update) continue
        await writeDocument<LoomScriptMountContent>(documents, {
          id, type: applicationDocumentTypes.loomScriptMount, expectedVersion: existing?.version ?? 'new',
          content: { target: target.kind === 'card' ? target : { kind: 'user' }, scriptDocumentId: scriptDocumentId(item.contribution.id),
            enabled: false, grantedCapabilities: [], runtimeRevision: 0, orderIndex: item.contribution.orderIndex,
            origin: { ...origin(item.contribution.id), orderOverride: true, ...(item.contribution.groupOrder !== undefined ? { groupOrder: item.contribution.groupOrder } : {}) },
            createdAt: existing?.content.createdAt ?? timestamp, updatedAt: timestamp,
          },
        })
      }
      for (const item of input.promptResources) {
        if (keptPromptIds.has(promptResourceIds.get(item.contribution.id) ?? '')) continue
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
              ...(existing && !existing.meta.tombstone ? {
                runtimeRevision: existing.content.runtimeRevision,
                settings: existing.content.settings,
                adoptedDocumentVersion: existing.content.adoptedDocumentVersion,
                adoptedSettings: existing.content.adoptedSettings,
              } : { runtimeRevision: 0 }),
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
          resourceTx.replaceLoreMounts({ expectedMountIds: resourceTx.listLoreMounts({ source: { kind: 'preset', id: presetResourceId } }).map(mount => mount.id), source: { kind: 'preset', id: presetResourceId }, mounts: [] })
          resourceTx.replacePresetToolMounts({ expectedMountIds: resourceTx.listPresetToolMounts({ presetResourceId }).map(mount => mount.id), presetResourceId, mounts: [] })
        }
        for (const [orderIndex, mount] of (item.contribution.loreMounts ?? []).entries()) {
          const reference = mount.reference ?? { kind: 'package' as const, contributionId: mount.resourceId! }
          const external = reference.kind === 'external' ? reference.origin : undefined
          const sameInstallation = external?.packageId === input.packageId && external.target === target.kind
            && promptContributions.get(external.contributionId)?.contribution.resourceKind === 'lore'
          const resolved = reference.kind === 'package' ? promptResourceIds.get(reference.contributionId)!
            : sameInstallation ? promptResourceIds.get(external!.contributionId)!
              : external ? existingPromptResources.find(resource => !resource.tombstoned
                && resource.resourceKind === 'lore'
                && resource.origin?.kind === 'extension-package'
                && resource.origin.packageId === external.packageId
                && resource.origin.contributionId === external.contributionId
                && resource.origin.installationId === extensionInstallationId(external.packageId,
                  external.target === 'global' ? { kind: 'global' } : target))?.id
                : undefined
          resourceTx.addLoreMount({
            source: { kind: 'preset', id: presetResourceId },
            loreResourceId: resolved ?? null,
            reference,
            orderIndex: mount.orderIndex ?? orderIndex,
            origin: origin(item.contribution.id),
          })
        }
        for (const [orderIndex, mount] of (item.contribution.toolMounts ?? []).entries()) {
          resourceTx.addPresetToolMount({
            presetResourceId,
            toolId: resolvedToolMounts.get(item.contribution.id)![orderIndex]!.toolId,
            orderIndex: mount.orderIndex ?? orderIndex,
            defaultEnabled: mount.defaultEnabled ?? false,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: { ...origin(item.contribution.id), toolReference: resolvedToolMounts.get(item.contribution.id)![orderIndex]!.reference },
          })
        }
      }
      return undefined
    }, { allowEmpty: true })
  }))
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
  const transformRules = (await listScriptTextTransformRuleDocuments(ctx.documents))
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

  if (scripts.length === 0 && scriptMounts.length === 0 && promptResources.length === 0 && agentTools.length === 0 && transformRules.length === 0 && textExtractors.length === 0) {
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
      }
      if ((input.target?.kind ?? 'global') === 'global') {
        for (const card of await listDocuments<CardSourceContent>(documents, applicationDocumentTypes.cardSource)) {
          if (card.content.defaultPreset?.packageId === input.packageId) {
            throw new Error(`Card ${card.content.name} (${card.id}) requires Preset ${card.content.defaultPreset.contributionId}; resources cannot be removed`)
          }
        }
      }
      for (const tool of agentTools) await documents.delete({ id: tool.id, expectedVersion: tool.version })
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
  const remap = (node: PromptResourceArtifact['rootNode']) => {
    node.id = localId(node.id)
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

async function readExtensionPreviewSnapshot(
  ctx: { documents: DocumentTransaction; promptResources: ExtensionsRuntimeContext['promptResources'] },
  input: ImportExtensionPackageResourcesInput,
) {
  const installationId = extensionInstallationId(input.packageId, input.target ?? { kind: 'global' })
  const documents = await collectPages(cursor => ctx.documents.list({ includeTombstone: true, cursor, limit: 100 }))
  const resources = await listMappedResources(ctx.promptResources, undefined, { includeTombstone: true })
  const owns = (value: unknown): boolean => {
    if (!isObject(value)) return false
    return matchesExtensionInstallation(value, input.packageId, installationId)
      || (value.kind === 'extension' && value.packageId === input.packageId && value.installationId === installationId)
  }
  const ownedDocuments = documents.filter(document => document.id === installationId || (isObject(document.content)
    && (owns(document.content.origin) || owns(document.content.owner) || owns(document.content.textResourceOrigin))))
  const ownedResources = resources.filter(resource => owns(resource.origin))
  const presetMounts = await Promise.all(ownedResources.filter(resource => resource.resourceKind === 'preset' && !resource.tombstoned).map(async resource => ({
    resourceId: resource.id,
    lore: await ctx.promptResources.listLoreMounts({ source: { kind: 'preset', id: resource.id } }),
    tools: await ctx.promptResources.listPresetToolMounts({ presetResourceId: resource.id }),
  })))
  const ids = new Set([...ownedDocuments.map(item => item.id), ...ownedResources.map(item => item.id),
    ...ownedDocuments.flatMap(item => isObject(item.content) && isObject(item.content.textResourceIds) ? Object.values(item.content.textResourceIds).filter((id): id is string => typeof id === 'string') : [])])
  const contains = (value: unknown, id: string): boolean => {
    if (value === id) return true
    if (Array.isArray(value)) return value.some(item => contains(item, id))
    return isObject(value) && Object.values(value).some(item => contains(item, id))
  }
  const consumers = [
    ...documents.map(document => ({ kind: document.type, id: document.id, version: document.version, content: document.content })),
    ...resources.map(resource => ({ kind: resource.resourceKind, id: resource.id, version: resource.version, content: resource })),
  ]
  const references = (id: string) => consumers.filter(item => item.id !== id && contains(item.content, id)).map(item => ({ kind: item.kind, id: item.id }))
  const relevantConsumers = consumers.filter(item => !ids.has(item.id) && [...ids].some(id => contains(item.content, id)))
  const { update, ...candidate } = input
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]))
    return value
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({
    candidate, expectedInstallationVersion: update?.expectedInstallationVersion, presetMounts,
    documents: ownedDocuments.sort((a, b) => a.id.localeCompare(b.id)),
    resources: ownedResources.sort((a, b) => a.id.localeCompare(b.id)),
    references: relevantConsumers.sort((a, b) => a.id.localeCompare(b.id)),
  }))).digest('hex')
  return { fingerprint, references }
}
