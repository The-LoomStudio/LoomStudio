import type { DocumentRecord, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import { isObject } from '../foundation/json.js'
import { assertNonEmpty } from '../agents/agent.js'
import { createAgentToolRegistry, type ToolDefinition } from '../agents/tool-registry.js'
import { isPromptActivation } from '../prompt/prompt-activation.js'
import {
  isPromptResourceArtifact,
  normalizePortableExtensionPayloadArtifact,
  type PortableExtensionPayloadArtifact,
  type PortableExtensionPayloadContent,
  type PromptResourceArtifact,
} from '../cards/workspace.js'
import { normalizeCardContent, toCardSource } from '../cards/card.js'
import {
  listMappedResources,
  toStoredResourceInput,
} from '../prompt/prompt-resource-mapper.js'
import type {
  AgentProfileContent,
  AgentToolContent,
  CardSourceContent,
  CreatePortableExtensionPayloadInput,
  CreatePortableExtensionPayloadResult,
  DeletePortableExtensionPayloadInput,
  DeletePortableExtensionPayloadResult,
  ExtensionEntityRef,
  ExtensionRecordEntry,
  ExtensionStorageScope,
  GetPortableExtensionPayloadInput,
  GetPortableExtensionPayloadResult,
  ImportExtensionPackageResourcesInput,
  ImportExtensionPackageResourcesResult,
  ListPortableExtensionPayloadsInput,
  ListPortableExtensionPayloadsResult,
  PortableExtensionPayloadEntry,
  RemoveExtensionPackageResourcesInput,
  RemoveExtensionPackageResourcesResult,
  ReplaceCardPortableExtensionPayloadsInput,
  ReplaceCardPortableExtensionPayloadsResult,
  RuntimeRequestContext,
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
import { findTimelinePromptResourceReferences } from './prompt-runtime.js'

export function createExtensionsRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    listPortableExtensionPayloads: async (input?: ListPortableExtensionPayloadsInput): Promise<ListPortableExtensionPayloadsResult> => ({
      payloads: (await listDocuments<PortableExtensionPayloadContent>(
        ctx.documents,
        applicationDocumentTypes.portableExtensionPayload,
      ))
        .map(toPortableExtensionPayloadEntry)
        .filter(payload => input?.packageId === undefined || payload.packageId === input.packageId),
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
      const cards = await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource)
      const referencingCard = cards.find(card => card.content.portableExtensionPayloadIds?.includes(input.payloadId))
      if (referencingCard) {
        throw new Error(`Portable Extension Payload is still bound to Card: ${referencingCard.id}`)
      }
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

    listExtensionRecords: async (input: { packageId: string; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<{ records: ExtensionRecordEntry[] }> => ({
      records: await listApplicationExtensionRecords(ctx.documents, input),
    }),

    getExtensionRecord: async (input: { packageId: string; recordId: string }): Promise<{ record: ExtensionRecordEntry | null }> => ({
      record: await getApplicationExtensionRecord(ctx.documents, input.packageId, input.recordId),
    }),

    importExtensionPackageResources: (input: ImportExtensionPackageResourcesInput, requestContext?: RuntimeRequestContext): Promise<ImportExtensionPackageResourcesResult> =>
      importExtensionPackageResourcesInternal(ctx, input, requestContext, requireDocumentParticipant(ctx)),

    removeExtensionPackageResources: (input: RemoveExtensionPackageResourcesInput, requestContext?: RuntimeRequestContext): Promise<RemoveExtensionPackageResourcesResult> =>
      removeExtensionPackageResourcesInternal(ctx, input, requestContext, requireDocumentParticipant(ctx)),
  }
}

export function portableExtensionPayloadFields(
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

export function toPortableExtensionPayloadEntry(
  document: DocumentRecord<PortableExtensionPayloadContent>,
): PortableExtensionPayloadEntry {
  return {
    id: document.id,
    artifactPayloadId: document.content.artifactPayloadId,
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

export async function listApplicationExtensionRecords(
  documents: DocumentTransaction,
  input: { packageId: string; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef },
): Promise<ExtensionRecordEntry[]> {
  const records: ExtensionRecordEntry[] = []
  let cursor: string | undefined
  do {
    const page = await documents.list({
      type: applicationDocumentTypes.extensionRecord,
      ownerExtensionId: input.packageId,
      cursor,
      limit: 100,
    })
    for (const document of page.items) {
      const record = toApplicationExtensionRecord(input.packageId, document)
      if (input.scope && !sameExtensionStorageScope(record.scope, input.scope)) continue
      if (input.recordType && record.recordType !== input.recordType) continue
      if (input.binding && !record.bindings.some(binding => sameExtensionEntityRef(binding, input.binding!))) continue
      records.push(record)
    }
    cursor = page.nextCursor
  } while (cursor)
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export async function getApplicationExtensionRecord(
  documents: DocumentTransaction,
  packageId: string,
  recordId: string,
): Promise<ExtensionRecordEntry | null> {
  const document = await documents.get(recordId)
  if (!document) return null
  if (document.type !== applicationDocumentTypes.extensionRecord || document.meta.ownerExtensionId !== packageId) {
    throw new Error(`Extension Record is not owned by package ${packageId}: ${recordId}`)
  }
  return toApplicationExtensionRecord(packageId, document)
}

export function toApplicationExtensionRecord(packageId: string, document: DocumentRecord): ExtensionRecordEntry {
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

export function isExtensionStorageScope(value: unknown): value is ExtensionStorageScope {
  if (!isObject(value)) return false
  const obj = value as Record<string, unknown>
  return (
    obj.kind === 'global'
    || (obj.kind === 'card' && typeof obj.cardId === 'string' && Boolean(obj.cardId))
    || (obj.kind === 'timeline' && typeof obj.timelineId === 'string' && Boolean(obj.timelineId))
    || (obj.kind === 'agent-session' && typeof obj.agentSessionId === 'string' && Boolean(obj.agentSessionId))
  )
}

export function isExtensionEntityRef(value: unknown): value is ExtensionEntityRef {
  if (!isObject(value)) return false
  const obj = value as Record<string, unknown>
  return (
    (obj.kind === 'narrative-node' && typeof obj.timelineId === 'string' && typeof obj.nodeId === 'string')
    || (obj.kind === 'agent-message' && typeof obj.agentSessionId === 'string' && typeof obj.messageId === 'string')
    || (obj.kind === 'asset' && typeof obj.assetId === 'string')
    || (obj.kind === 'state-path' && typeof obj.timelineId === 'string' && typeof obj.path === 'string')
  )
}

export function sameExtensionStorageScope(left: ExtensionStorageScope, right: ExtensionStorageScope): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'global') return true
  if (left.kind === 'card' && right.kind === 'card') return left.cardId === right.cardId
  if (left.kind === 'timeline' && right.kind === 'timeline') return left.timelineId === right.timelineId
  return left.kind === 'agent-session' && right.kind === 'agent-session' && left.agentSessionId === right.agentSessionId
}

export function sameExtensionEntityRef(left: ExtensionEntityRef, right: ExtensionEntityRef): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'narrative-node' && right.kind === 'narrative-node') return left.timelineId === right.timelineId && left.nodeId === right.nodeId
  if (left.kind === 'agent-message' && right.kind === 'agent-message') return left.agentSessionId === right.agentSessionId && left.messageId === right.messageId
  if (left.kind === 'asset' && right.kind === 'asset') return left.assetId === right.assetId
  return left.kind === 'state-path' && right.kind === 'state-path' && left.timelineId === right.timelineId && left.path === right.path
}

export function readExtensionAgentToolDefinition(packageId: string, toolId: string, value: JsonValue): ToolDefinition {
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

export function validateExtensionPromptNodeIds(packageId: string, node: PromptResourceArtifact['rootNode'], seen: Set<string>): void {
  if (!node.id.startsWith(`${packageId}.`)) throw new Error(`Extension Prompt Resource node id must use package namespace: ${node.id}`)
  if (seen.has(node.id)) throw new Error(`Extension Prompt Resource node id must be unique: ${node.id}`)
  seen.add(node.id)
  for (const child of node.children ?? []) validateExtensionPromptNodeIds(packageId, child, seen)
}

async function importExtensionPackageResourcesInternal(
  ctx: ApplicationRuntimeContext,
  input: ImportExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
): Promise<ImportExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  assertNonEmpty(input.packageVersion, 'packageVersion')
  const timestamp = ctx.now()
  const origin = (contributionId: string) => ({
    kind: 'extension-package' as const,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    contributionId,
  })

  const promptContributions = new Map(input.promptResources.map(item => [item.contribution.id, item]))
  if (promptContributions.size !== input.promptResources.length) throw new Error('Extension Prompt Resource contribution ids must be unique')
  const agentToolDefinitions = new Map<string, ToolDefinition>()
  for (const item of input.agentTools) {
    if (agentToolDefinitions.has(item.contribution.id)) throw new Error(`Extension Agent Tool contribution is duplicated: ${item.contribution.id}`)
    agentToolDefinitions.set(item.contribution.id, readExtensionAgentToolDefinition(input.packageId, item.contribution.id, item.definition))
  }

  const promptArtifacts = new Map<string, PromptResourceArtifact>()
  const nodeIds = new Set<string>()
  for (const item of input.promptResources) {
    if (!isPromptResourceArtifact(item.artifact)) throw new Error(`Extension Prompt Resource artifact is invalid: ${item.contribution.id}`)
    if (item.artifact.resourceKind !== item.contribution.resourceKind) {
      throw new Error(`Extension Prompt Resource kind does not match its manifest: ${item.contribution.id}`)
    }
    validateExtensionPromptNodeIds(input.packageId, item.artifact.rootNode, nodeIds)
    promptArtifacts.set(item.contribution.id, structuredClone(item.artifact))
    for (const mount of item.contribution.settingMounts ?? []) {
      const target = promptContributions.get(mount.resourceId)
      if (!target || target.contribution.resourceKind !== 'setting') throw new Error(`Extension Preset Setting mount is unresolved: ${mount.resourceId}`)
    }
    for (const mount of item.contribution.toolMounts ?? []) {
      const definition = agentToolDefinitions.get(mount.toolId)
      if (!definition) throw new Error(`Extension Preset Tool mount is unresolved: ${mount.toolId}`)
      if (mount.activation !== undefined && !isPromptActivation(mount.activation)) throw new Error(`Extension Preset Tool activation is invalid: ${mount.toolId}`)
      if (definition.input.kind === 'structured' && mount.content !== undefined) throw new Error(`Structured Tool cannot use Content placement: ${mount.toolId}`)
    }
  }

  const existingPromptResources = await listMappedResources(ctx.promptResources, undefined, { includeTombstone: true })
  const promptResourceIds = new Map<string, string>()
  const restorablePromptResourceVersions = new Map<string, number>()
  for (const resource of existingPromptResources) {
    const resourceOrigin = resource.origin
    if (resourceOrigin?.kind !== 'extension-package' || resourceOrigin.packageId !== input.packageId) continue
    if (resourceOrigin.packageVersion !== input.packageVersion) {
      throw new Error(`Extension Prompt Resource update requires an explicit migration: ${resourceOrigin.contributionId}`)
    }
    if (!promptContributions.has(resourceOrigin.contributionId)) continue
    if (promptResourceIds.has(resourceOrigin.contributionId)) throw new Error(`Extension Prompt Resource origin is duplicated: ${resourceOrigin.contributionId}`)
    promptResourceIds.set(resourceOrigin.contributionId, resource.id)
    if (resource.tombstoned) restorablePromptResourceVersions.set(resourceOrigin.contributionId, resource.version)
  }

  for (const tool of await listAgentToolEntries(ctx)) {
    if (tool.origin?.kind !== 'extension-package' || tool.origin.packageId !== input.packageId) continue
    if (tool.origin.packageVersion !== input.packageVersion) {
      throw new Error(`Extension Agent Tool update requires an explicit migration: ${tool.origin.contributionId}`)
    }
  }

  const existingAgentTools = new Set<string>()
  const restorableAgentToolVersions = new Map<string, number>()
  for (const [toolId] of agentToolDefinitions) {
    const document = await ctx.documents.get(toolId, { includeTombstone: true })
    if (!document) continue
    if (document.type !== applicationDocumentTypes.agentTool) throw new Error(`Extension Agent Tool id conflicts with another Document: ${toolId}`)
    const content = document.content as AgentToolContent
    if (content.origin?.kind !== 'extension-package' || content.origin.packageId !== input.packageId || content.origin.contributionId !== toolId) {
      throw new Error(`Extension Agent Tool id is already owned by another source: ${toolId}`)
    }
    if (content.origin.packageVersion !== input.packageVersion) {
      throw new Error(`Extension Agent Tool update requires an explicit migration: ${toolId}`)
    }
    if (document.meta.tombstone) {
      restorableAgentToolVersions.set(toolId, document.version)
      continue
    }
    existingAgentTools.add(toolId)
  }

  const missingPromptResources = input.promptResources.filter(item => !promptResourceIds.has(item.contribution.id) || restorablePromptResourceVersions.has(item.contribution.id))
  const missingAgentTools = input.agentTools.filter(item => !existingAgentTools.has(item.contribution.id))
  if (missingPromptResources.length === 0 && missingAgentTools.length === 0) {
    return {
      promptResources: input.promptResources.map(item => ({
        contributionId: item.contribution.id,
        resourceId: promptResourceIds.get(item.contribution.id)!,
        resourceKind: item.contribution.resourceKind,
      })),
      agentTools: input.agentTools.map(item => ({ contributionId: item.contribution.id, toolId: item.contribution.id })),
    }
  }

  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.importExtensionPackageResources',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async documents => {
      const newlyCreatedPromptIds = new Set<string>()
      for (const item of missingPromptResources) {
        const artifact = promptArtifacts.get(item.contribution.id)!
        const restorableVersion = restorablePromptResourceVersions.get(item.contribution.id)
        const resourceId = promptResourceIds.get(item.contribution.id) ?? ctx.createId('prompt-resource')
        if (restorableVersion === undefined) {
          resourceTx.createResource(toStoredResourceInput({
            id: resourceId,
            content: {
              resourceKind: artifact.resourceKind,
              rootNode: structuredClone(artifact.rootNode),
              ...(artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
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
          expectedVersion: restorableAgentToolVersions.get(definition.id) ?? 'new',
        })
      }
      for (const item of input.promptResources) {
        if (!newlyCreatedPromptIds.has(item.contribution.id) || item.contribution.resourceKind !== 'preset') continue
        const presetResourceId = promptResourceIds.get(item.contribution.id)!
        for (const [orderIndex, mount] of (item.contribution.settingMounts ?? []).entries()) {
          resourceTx.addSettingMount({
            source: { kind: 'preset', id: presetResourceId },
            settingResourceId: promptResourceIds.get(mount.resourceId)!,
            orderIndex: mount.orderIndex ?? orderIndex,
            origin: origin(item.contribution.id),
          })
        }
        for (const [orderIndex, mount] of (item.contribution.toolMounts ?? []).entries()) {
          resourceTx.addPresetToolMount({
            presetResourceId,
            toolId: mount.toolId,
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
  })
  await refreshAgentToolRegistry(ctx)
  return {
    promptResources: input.promptResources.map(item => ({
      contributionId: item.contribution.id,
      resourceId: promptResourceIds.get(item.contribution.id)!,
      resourceKind: item.contribution.resourceKind,
    })),
    agentTools: input.agentTools.map(item => ({ contributionId: item.contribution.id, toolId: item.contribution.id })),
    mutation: { changesetId: transaction.commit.changesetId },
  }
}

async function removeExtensionPackageResourcesInternal(
  ctx: ApplicationRuntimeContext,
  input: RemoveExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
): Promise<RemoveExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  const promptResources = (await listMappedResources(ctx.promptResources))
    .filter(resource => resource.origin?.kind === 'extension-package' && resource.origin.packageId === input.packageId)
  const promptResourceIds = new Set(promptResources.map(resource => resource.id))
  const presetResourceIds = new Set(promptResources.filter(resource => resource.resourceKind === 'preset').map(resource => resource.id))
  const agentTools = (await listAgentToolEntries(ctx))
    .filter(tool => tool.origin?.kind === 'extension-package' && tool.origin.packageId === input.packageId)
  const agentToolIds = new Set(agentTools.map(tool => tool.id))

  if (promptResources.length === 0 && agentTools.length === 0) {
    return {
      packageId: input.packageId,
      promptResourceIds: [],
      agentToolIds: [],
      detachedReferences: { cards: 0, timelines: 0, agentProfiles: 0, presetToolMounts: 0 },
    }
  }

  const profiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
  const blockingProfiles = profiles.filter(profile => presetResourceIds.has(profile.content.presetId))
  if (blockingProfiles.length > 0) {
    throw new Error(`Extension Package resources are still referenced by Agent Profiles: ${blockingProfiles.map(profile => profile.id).join(', ')}`)
  }
  const profilesWithToolOverrides = profiles.filter(profile => Object.keys(profile.content.toolOverrides ?? {}).some(toolId => agentToolIds.has(toolId)))
  const cards = (await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource))
    .filter(card => card.content.promptResourceIds?.some(resourceId => promptResourceIds.has(resourceId)))
  const timelineReferences = new Map<string, { id: string; promptResourceIds: string[] }>()
  for (const resourceId of promptResourceIds) {
    for (const timeline of await findTimelinePromptResourceReferences(ctx, resourceId)) timelineReferences.set(timeline.id, timeline)
  }

  const toolMounts = await ctx.promptResources.listPresetToolMounts()
  const removedToolMounts = toolMounts.filter(mount => presetResourceIds.has(mount.presetResourceId) || agentToolIds.has(mount.toolId))
  const affectedPresetIds = new Set(removedToolMounts
    .filter(mount => !presetResourceIds.has(mount.presetResourceId))
    .map(mount => mount.presetResourceId))

  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.removeExtensionPackageResources',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    const narrativeTx = ctx.narratives?.transaction(dataTx)
    for (const timeline of timelineReferences.values()) {
      narrativeTx?.updatePromptResources({
        timelineId: timeline.id,
        promptResourceIds: timeline.promptResourceIds.filter(resourceId => !promptResourceIds.has(resourceId)),
        expectedPromptResourceIds: timeline.promptResourceIds,
      })
    }
    for (const presetResourceId of affectedPresetIds) {
      resourceTx.replacePresetToolMounts({
        presetResourceId,
        mounts: toolMounts
          .filter(mount => mount.presetResourceId === presetResourceId && !agentToolIds.has(mount.toolId))
          .map(mount => ({
            toolId: mount.toolId,
            orderIndex: mount.orderIndex,
            defaultEnabled: mount.defaultEnabled,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: structuredClone(mount.origin),
          })),
      })
    }
    return documentParticipant.participateTransaction(dataTx, async documents => {
      for (const card of cards) {
        await writeDocument<CardSourceContent>(documents, {
          id: card.id,
          type: applicationDocumentTypes.cardSource,
          content: {
            ...card.content,
            promptResourceIds: card.content.promptResourceIds?.filter(resourceId => !promptResourceIds.has(resourceId)),
            updatedAt: ctx.now(),
          },
          expectedVersion: card.version,
        })
      }
      for (const profile of profilesWithToolOverrides) {
        await writeDocument<AgentProfileContent>(documents, {
          id: profile.id,
          type: applicationDocumentTypes.agentProfile,
          content: {
            ...profile.content,
            toolOverrides: Object.fromEntries(Object.entries(profile.content.toolOverrides ?? {}).filter(([toolId]) => !agentToolIds.has(toolId))),
            updatedAt: ctx.now(),
          },
          expectedVersion: profile.version,
        })
      }
      for (const tool of agentTools) await documents.delete({ id: tool.id, expectedVersion: tool.version })
      for (const resource of promptResources) resourceTx.deleteResource({ resourceId: resource.id, expectedVersion: resource.version })
      return undefined
    }, { allowEmpty: true })
  })
  await refreshAgentToolRegistry(ctx)
  return {
    packageId: input.packageId,
    promptResourceIds: [...promptResourceIds].sort(),
    agentToolIds: [...agentToolIds].sort(),
    detachedReferences: {
      cards: cards.length,
      timelines: timelineReferences.size,
      agentProfiles: profilesWithToolOverrides.length,
      presetToolMounts: removedToolMounts.length,
    },
    mutation: { changesetId: transaction.commit.changesetId },
  }
}
