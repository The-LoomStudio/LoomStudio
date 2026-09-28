import type { ActorRef, DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type {
  ExtensionActivationContext,
  ExtensionAssetCapability,
  ExtensionConfigEntry,
  ExtensionEntityRef,
  ExtensionInstallationTarget,
  ExtensionPortablePayload,
  ExtensionRecordEntry,
  ExtensionStorageScope,
} from '@loom-studio/extension-sdk'
import { extensionConfigDocumentId, extensionInstallationId, extensionStorageScopeKey } from '@loom-studio/extension-sdk'
import { createId } from '@loom-studio/shared'
import {
  extensionConfigDocumentType,
  extensionRecordDocumentType,
  extensionStorageTokenPattern,
  type ExtensionConfigContent,
  type ExtensionHostOptions,
  type ExtensionInstance,
  type ExtensionModuleRecord,
  type ExtensionRecordContent,
} from './types.js'

export function moduleKey(packageId: string, moduleId: string): string {
  return `${packageId}/${moduleId}`
}

export function storageInstallationId(record: ExtensionModuleRecord): string | undefined {
  return record.target.kind === 'global' ? undefined : extensionInstallationId(record.packageManifest.id, record.target)
}

export function assertScopeActive(instance: ExtensionInstance): void {
  if (!instance.scope.active) throw new Error(`Extension instance is stopping: ${instance.instanceId}`)
}

export function requirePortablePayloads(options: ExtensionHostOptions): NonNullable<ExtensionHostOptions['portablePayloads']> {
  if (!options.portablePayloads) throw new Error('Portable Extension Payloads are not available in this host')
  return options.portablePayloads
}

export function assertPortablePayloadOwner(packageId: string, payload: ExtensionPortablePayload, ownerInstallationId?: string): void {
  if (payload.packageId !== packageId || payload.ownerInstallationId !== ownerInstallationId) {
    throw new Error(`Extension package ${packageId} cannot access Portable Payload owned by another package or installation: ${payload.id}`)
  }
}

export function createExtensionStorageContext(
  record: ExtensionModuleRecord,
  instance: ExtensionInstance,
  options: ExtensionHostOptions,
  actor: ActorRef,
): ExtensionActivationContext['storage'] {
  const packageId = record.packageManifest.id
  return {
    configs: {
      list: async input => {
        assertScopeActive(instance)
        if (input?.scope) await validateStorageScope(options, input.scope, record.target)
        // ponytail: 首版按 package/type 分页读取后在内存中过滤 Scope；出现真实规模压力时再增加 Document 索引。
        const documents = await listOwnedExtensionDocuments<ExtensionConfigContent>(options.documents, record, extensionConfigDocumentType)
        if (record.target.kind === 'card') {
          for (const document of documents) await validateStorageScope(options, document.content.scope, record.target)
        }
        return documents
          .map(document => toExtensionConfigEntry(packageId, document))
          .filter(entry => !input?.scope || sameStorageScope(entry.scope, input.scope))
      },
      get: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.key, 'Extension Config key')
        await validateStorageScope(options, input.scope, record.target)
        const document = await options.documents.get(extensionConfigDocumentId(packageId, input.scope, input.key, record.target))
        if (!document) return null
        assertOwnedStorageDocument(record, document, extensionConfigDocumentType)
        return toExtensionConfigEntry(packageId, document as DocumentRecord<ExtensionConfigContent>)
      },
      upsert: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.key, 'Extension Config key')
        await validateStorageScope(options, input.scope, record.target)
        const id = extensionConfigDocumentId(packageId, input.scope, input.key, record.target)
        const existing = await options.documents.get(id, { includeTombstone: true }) as DocumentRecord<ExtensionConfigContent> | null
        if (existing) assertOwnedStorageDocument(record, existing, extensionConfigDocumentType)
        if (existing && !existing.meta.tombstone && input.expectedVersion === undefined) {
          throw new Error(`expectedVersion is required when updating Extension Config: ${input.key}`)
        }
        const timestamp = new Date().toISOString()
        const result = await options.documents.write({
          id,
          type: extensionConfigDocumentType,
          content: {
            scope: cloneStorageScope(input.scope),
            key: input.key,
            value: structuredClone(input.value),
            createdAt: existing?.content.createdAt ?? timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: existing
            ? (existing.meta.tombstone ? existing.version : input.expectedVersion!)
            : 'new',
          actor,
          reason: 'extension.storage.config.upsert',
          meta: { ownerExtensionId: packageId, ownerInstallationId: storageInstallationId(record) },
        })
        return toExtensionConfigEntry(packageId, result.documents[0] as DocumentRecord<ExtensionConfigContent>)
      },
      delete: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.key, 'Extension Config key')
        await validateStorageScope(options, input.scope, record.target)
        const id = extensionConfigDocumentId(packageId, input.scope, input.key, record.target)
        const existing = await options.documents.get(id)
        if (!existing) throw new Error(`Extension Config not found: ${input.key}`)
        assertOwnedStorageDocument(record, existing, extensionConfigDocumentType)
        await options.documents.delete({
          id,
          expectedVersion: input.expectedVersion,
          actor,
          reason: 'extension.storage.config.delete',
        })
      },
    },
    records: {
      list: async input => {
        assertScopeActive(instance)
        if (input?.scope) await validateStorageScope(options, input.scope, record.target)
        if (input?.recordType) assertStorageToken(input.recordType, 'Extension Record type')
        if (input?.binding) assertEntityRef(input.binding)
        // ponytail: 首版按 package/type 分页读取后在内存中过滤 Scope、Record Type 与 Binding；真实查询量出现后再补窄索引。
        const documents = await listOwnedExtensionDocuments<ExtensionRecordContent>(options.documents, record, extensionRecordDocumentType)
        if (record.target.kind === 'card') {
          for (const document of documents) await validateStorageScope(options, document.content.scope, record.target)
        }
        return documents
          .map(document => toExtensionRecordEntry(packageId, document))
          .filter(entry => (!input?.scope || sameStorageScope(entry.scope, input.scope))
            && (!input?.recordType || entry.recordType === input.recordType)
            && (!input?.binding || entry.bindings.some(binding => sameEntityRef(binding, input.binding!))))
      },
      get: async recordId => {
        assertScopeActive(instance)
        const document = await options.documents.get(recordId)
        if (!document) return null
        assertOwnedStorageDocument(record, document, extensionRecordDocumentType)
        await validateStorageScope(options, (document.content as ExtensionRecordContent).scope, record.target)
        return toExtensionRecordEntry(packageId, document as DocumentRecord<ExtensionRecordContent>)
      },
      create: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.recordType, 'Extension Record type')
        await validateStorageScope(options, input.scope, record.target)
        const bindings = await validateEntityRefs(options, input.bindings ?? [], record.target)
        const timestamp = new Date().toISOString()
        const result = await options.documents.write({
          id: createId('extension-record'),
          type: extensionRecordDocumentType,
          content: {
            scope: cloneStorageScope(input.scope),
            recordType: input.recordType,
            data: structuredClone(input.data),
            bindings,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
          actor,
          reason: 'extension.storage.record.create',
          meta: { ownerExtensionId: packageId, ownerInstallationId: storageInstallationId(record) },
        })
        return toExtensionRecordEntry(packageId, result.documents[0] as DocumentRecord<ExtensionRecordContent>)
      },
      update: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.recordType, 'Extension Record type')
        await validateStorageScope(options, input.scope, record.target)
        const existing = await options.documents.get(input.recordId) as DocumentRecord<ExtensionRecordContent> | null
        if (!existing) throw new Error(`Extension Record not found: ${input.recordId}`)
        assertOwnedStorageDocument(record, existing, extensionRecordDocumentType)
        await validateStorageScope(options, existing.content.scope, record.target)
        const bindings = await validateEntityRefs(options, input.bindings ?? [], record.target)
        const result = await options.documents.write({
          id: input.recordId,
          type: extensionRecordDocumentType,
          content: {
            scope: cloneStorageScope(input.scope),
            recordType: input.recordType,
            data: structuredClone(input.data),
            bindings,
            createdAt: existing.content.createdAt,
            updatedAt: new Date().toISOString(),
          },
          expectedVersion: input.expectedVersion,
          actor,
          reason: 'extension.storage.record.update',
          meta: { ownerExtensionId: packageId, ownerInstallationId: storageInstallationId(record) },
        })
        return toExtensionRecordEntry(packageId, result.documents[0] as DocumentRecord<ExtensionRecordContent>)
      },
      delete: async input => {
        assertScopeActive(instance)
        const existing = await options.documents.get(input.recordId)
        if (!existing) throw new Error(`Extension Record not found: ${input.recordId}`)
        assertOwnedStorageDocument(record, existing, extensionRecordDocumentType)
        await validateStorageScope(options, (existing.content as ExtensionRecordContent).scope, record.target)
        await options.documents.delete({
          id: input.recordId,
          expectedVersion: input.expectedVersion,
          actor,
          reason: 'extension.storage.record.delete',
        })
      },
    },
  }
}

async function listOwnedExtensionDocuments<T>(
  documents: DocumentStore,
  record: ExtensionModuleRecord,
  type: string,
): Promise<Array<DocumentRecord<T>>> {
  const items: Array<DocumentRecord<T>> = []
  let cursor: string | undefined
  do {
    const page = await documents.list({
      type, ownerExtensionId: record.packageManifest.id,
      ownerInstallationId: storageInstallationId(record) ?? null, cursor, limit: 200,
    })
    items.push(...page.items as Array<DocumentRecord<T>>)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

async function validateStorageScope(options: ExtensionHostOptions, scope: ExtensionStorageScope, target: ExtensionInstallationTarget): Promise<void> {
  assertStorageScope(scope)
  if (target.kind === 'card' && (scope.kind === 'global' || (scope.kind === 'card' && scope.cardId !== target.cardId))) {
    throw new Error('Extension Storage Scope is outside its Card installation')
  }
  if (scope.kind !== 'global' && !options.validateStorageScope) {
    throw new Error(`Extension Storage Scope validation is not available for: ${scope.kind}`)
  }
  await options.validateStorageScope?.(cloneStorageScope(scope), structuredClone(target))
}

async function validateEntityRefs(options: ExtensionHostOptions, refs: ExtensionEntityRef[], target: ExtensionInstallationTarget): Promise<ExtensionEntityRef[]> {
  if (refs.length > 0 && !options.validateEntityRef) {
    throw new Error('Extension Entity Ref validation is not available in this host')
  }
  const result: ExtensionEntityRef[] = []
  for (const ref of refs) {
    assertEntityRef(ref)
    await options.validateEntityRef?.(structuredClone(ref), structuredClone(target))
    result.push(structuredClone(ref))
  }
  return result
}

function assertOwnedStorageDocument(record: ExtensionModuleRecord, document: DocumentRecord, type: string): void {
  const packageId = record.packageManifest.id
  if (document.type !== type) throw new Error(`Unexpected Extension Storage document type: ${document.type}`)
  if (document.meta.ownerExtensionId !== packageId) {
    throw new Error(`Extension package ${packageId} cannot access storage owned by another package: ${document.id}`)
  }
  if (document.meta.ownerInstallationId !== storageInstallationId(record)) {
    throw new Error(`Extension installation cannot access storage owned by another installation: ${document.id}`)
  }
}

function sameStorageScope(left: ExtensionStorageScope, right: ExtensionStorageScope): boolean {
  return extensionStorageScopeKey(left) === extensionStorageScopeKey(right)
}

function sameEntityRef(left: ExtensionEntityRef, right: ExtensionEntityRef): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'narrative-node' && right.kind === 'narrative-node') {
    return left.timelineId === right.timelineId && left.nodeId === right.nodeId
  }
  if (left.kind === 'agent-message' && right.kind === 'agent-message') {
    return left.agentSessionId === right.agentSessionId && left.messageId === right.messageId
  }
  if (left.kind === 'asset' && right.kind === 'asset') return left.assetId === right.assetId
  if (left.kind === 'state-path' && right.kind === 'state-path') {
    return left.timelineId === right.timelineId && left.path === right.path
  }
  return false
}

function cloneStorageScope(scope: ExtensionStorageScope): ExtensionStorageScope {
  return structuredClone(scope)
}

function assertStorageScope(scope: ExtensionStorageScope): void {
  if (!scope || typeof scope !== 'object') throw new Error('Extension Storage Scope must be an object')
  if (scope.kind === 'global') return
  if (scope.kind === 'card' && typeof scope.cardId === 'string' && scope.cardId.length > 0) return
  if (scope.kind === 'timeline' && typeof scope.timelineId === 'string' && scope.timelineId.length > 0) return
  if (scope.kind === 'agent-session' && typeof scope.agentSessionId === 'string' && scope.agentSessionId.length > 0) return
  throw new Error('Invalid Extension Storage Scope')
}

function assertEntityRef(ref: ExtensionEntityRef): void {
  if (!ref || typeof ref !== 'object') throw new Error('Extension Entity Ref must be an object')
  if (ref.kind === 'narrative-node' && nonEmpty(ref.timelineId) && nonEmpty(ref.nodeId)) return
  if (ref.kind === 'agent-message' && nonEmpty(ref.agentSessionId) && nonEmpty(ref.messageId)) return
  if (ref.kind === 'asset' && nonEmpty(ref.assetId)) return
  if (ref.kind === 'state-path' && nonEmpty(ref.timelineId) && nonEmpty(ref.path)) return
  throw new Error('Invalid Extension Entity Ref')
}

function assertStorageToken(value: string, label: string): void {
  if (!extensionStorageTokenPattern.test(value)) throw new Error(`${label} must be a stable token`)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function toExtensionConfigEntry(
  packageId: string,
  document: DocumentRecord<ExtensionConfigContent>,
): ExtensionConfigEntry {
  assertStorageScope(document.content.scope)
  assertStorageToken(document.content.key, 'Extension Config key')
  return {
    id: document.id,
    packageId,
    scope: cloneStorageScope(document.content.scope),
    key: document.content.key,
    value: structuredClone(document.content.value),
    version: document.version,
    createdAt: document.content.createdAt,
    updatedAt: document.content.updatedAt,
  }
}

function toExtensionRecordEntry(
  packageId: string,
  document: DocumentRecord<ExtensionRecordContent>,
): ExtensionRecordEntry {
  assertStorageScope(document.content.scope)
  assertStorageToken(document.content.recordType, 'Extension Record type')
  for (const binding of document.content.bindings) assertEntityRef(binding)
  return {
    id: document.id,
    packageId,
    scope: cloneStorageScope(document.content.scope),
    recordType: document.content.recordType,
    data: structuredClone(document.content.data),
    bindings: structuredClone(document.content.bindings),
    version: document.version,
    createdAt: document.content.createdAt,
    updatedAt: document.content.updatedAt,
  }
}

export function assertDeclaredDocumentType(record: ExtensionModuleRecord, type: unknown): asserts type is string {
  if (typeof type !== 'string' || !record.moduleManifest.contributes?.documentTypes?.some(item => item.type === type)) {
    throw new Error(`Extension module ${moduleKey(record.packageManifest.id, record.moduleManifest.id)} did not declare document type: ${String(type)}`)
  }
}

export function assertAssetCapability(instance: ExtensionInstance, capability: ExtensionAssetCapability): void {
  if (!instance.grantedAssetCapabilities.includes(capability)) {
    throw new Error(`Extension instance ${instance.instanceId} was not granted ${capability}`)
  }
}

export function assertDocumentAccess(
  record: ExtensionModuleRecord,
  document: DocumentRecord,
  operation: 'read' | 'write' | 'delete',
): void {
  if (document.meta.ownerExtensionId !== record.packageManifest.id) {
    throw new Error(`Extension module ${moduleKey(record.packageManifest.id, record.moduleManifest.id)} cannot ${operation} document owned by another package: ${document.id}`)
  }
  if (document.meta.ownerInstallationId !== storageInstallationId(record)) {
    throw new Error(`Extension installation cannot ${operation} document owned by another installation: ${document.id}`)
  }
  assertDeclaredDocumentType(record, document.type)
}
