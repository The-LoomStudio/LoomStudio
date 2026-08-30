import type { ActorRef, DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type {
  ExtensionActivationContext,
  ExtensionAssetCapability,
  ExtensionConfigEntry,
  ExtensionEntityRef,
  ExtensionPortablePayload,
  ExtensionRecordEntry,
  ExtensionStorageScope,
} from '@loom-studio/extension-sdk'
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

export function assertScopeActive(instance: ExtensionInstance): void {
  if (!instance.scope.active) throw new Error(`Extension instance is stopping: ${instance.instanceId}`)
}

export function requirePortablePayloads(options: ExtensionHostOptions): NonNullable<ExtensionHostOptions['portablePayloads']> {
  if (!options.portablePayloads) throw new Error('Portable Extension Payloads are not available in this host')
  return options.portablePayloads
}

export function assertPortablePayloadOwner(packageId: string, payload: ExtensionPortablePayload): void {
  if (payload.packageId !== packageId) {
    throw new Error(`Extension package ${packageId} cannot access Portable Payload owned by another package: ${payload.id}`)
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
        if (input?.scope) await validateStorageScope(options, input.scope)
        // ponytail: 首版按 package/type 分页读取后在内存中过滤 Scope；出现真实规模压力时再增加 Document 索引。
        const documents = await listOwnedExtensionDocuments<ExtensionConfigContent>(options.documents, packageId, extensionConfigDocumentType)
        return documents
          .map(document => toExtensionConfigEntry(packageId, document))
          .filter(entry => !input?.scope || sameStorageScope(entry.scope, input.scope))
      },
      get: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.key, 'Extension Config key')
        await validateStorageScope(options, input.scope)
        const document = await options.documents.get(configDocumentId(packageId, input.scope, input.key))
        if (!document) return null
        assertOwnedStorageDocument(packageId, document, extensionConfigDocumentType)
        return toExtensionConfigEntry(packageId, document as DocumentRecord<ExtensionConfigContent>)
      },
      upsert: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.key, 'Extension Config key')
        await validateStorageScope(options, input.scope)
        const id = configDocumentId(packageId, input.scope, input.key)
        const existing = await options.documents.get(id, { includeTombstone: true }) as DocumentRecord<ExtensionConfigContent> | null
        if (existing) assertOwnedStorageDocument(packageId, existing, extensionConfigDocumentType)
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
          meta: { ownerExtensionId: packageId },
        })
        return toExtensionConfigEntry(packageId, result.documents[0] as DocumentRecord<ExtensionConfigContent>)
      },
      delete: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.key, 'Extension Config key')
        await validateStorageScope(options, input.scope)
        const id = configDocumentId(packageId, input.scope, input.key)
        const existing = await options.documents.get(id)
        if (!existing) throw new Error(`Extension Config not found: ${input.key}`)
        assertOwnedStorageDocument(packageId, existing, extensionConfigDocumentType)
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
        if (input?.scope) await validateStorageScope(options, input.scope)
        if (input?.recordType) assertStorageToken(input.recordType, 'Extension Record type')
        if (input?.binding) assertEntityRef(input.binding)
        // ponytail: 首版按 package/type 分页读取后在内存中过滤 Scope、Record Type 与 Binding；真实查询量出现后再补窄索引。
        const documents = await listOwnedExtensionDocuments<ExtensionRecordContent>(options.documents, packageId, extensionRecordDocumentType)
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
        assertOwnedStorageDocument(packageId, document, extensionRecordDocumentType)
        return toExtensionRecordEntry(packageId, document as DocumentRecord<ExtensionRecordContent>)
      },
      create: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.recordType, 'Extension Record type')
        await validateStorageScope(options, input.scope)
        const bindings = await validateEntityRefs(options, input.bindings ?? [])
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
          meta: { ownerExtensionId: packageId },
        })
        return toExtensionRecordEntry(packageId, result.documents[0] as DocumentRecord<ExtensionRecordContent>)
      },
      update: async input => {
        assertScopeActive(instance)
        assertStorageToken(input.recordType, 'Extension Record type')
        await validateStorageScope(options, input.scope)
        const existing = await options.documents.get(input.recordId) as DocumentRecord<ExtensionRecordContent> | null
        if (!existing) throw new Error(`Extension Record not found: ${input.recordId}`)
        assertOwnedStorageDocument(packageId, existing, extensionRecordDocumentType)
        const bindings = await validateEntityRefs(options, input.bindings ?? [])
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
          meta: { ownerExtensionId: packageId },
        })
        return toExtensionRecordEntry(packageId, result.documents[0] as DocumentRecord<ExtensionRecordContent>)
      },
      delete: async input => {
        assertScopeActive(instance)
        const existing = await options.documents.get(input.recordId)
        if (!existing) throw new Error(`Extension Record not found: ${input.recordId}`)
        assertOwnedStorageDocument(packageId, existing, extensionRecordDocumentType)
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

export async function listOwnedExtensionDocuments<T>(
  documents: DocumentStore,
  packageId: string,
  type: string,
): Promise<Array<DocumentRecord<T>>> {
  const items: Array<DocumentRecord<T>> = []
  let cursor: string | undefined
  do {
    const page = await documents.list({ type, ownerExtensionId: packageId, cursor, limit: 200 })
    items.push(...page.items as Array<DocumentRecord<T>>)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

export async function validateStorageScope(options: ExtensionHostOptions, scope: ExtensionStorageScope): Promise<void> {
  assertStorageScope(scope)
  if (scope.kind !== 'global' && !options.validateStorageScope) {
    throw new Error(`Extension Storage Scope validation is not available for: ${scope.kind}`)
  }
  await options.validateStorageScope?.(cloneStorageScope(scope))
}

export async function validateEntityRefs(options: ExtensionHostOptions, refs: ExtensionEntityRef[]): Promise<ExtensionEntityRef[]> {
  if (refs.length > 0 && !options.validateEntityRef) {
    throw new Error('Extension Entity Ref validation is not available in this host')
  }
  const result: ExtensionEntityRef[] = []
  for (const ref of refs) {
    assertEntityRef(ref)
    await options.validateEntityRef?.(structuredClone(ref))
    result.push(structuredClone(ref))
  }
  return result
}

export function assertOwnedStorageDocument(packageId: string, document: DocumentRecord, type: string): void {
  if (document.type !== type) throw new Error(`Unexpected Extension Storage document type: ${document.type}`)
  if (document.meta.ownerExtensionId !== packageId) {
    throw new Error(`Extension package ${packageId} cannot access storage owned by another package: ${document.id}`)
  }
}

export function configDocumentId(packageId: string, scope: ExtensionStorageScope, key: string): string {
  return `extension-config:${encodeURIComponent(packageId)}:${encodeURIComponent(storageScopeKey(scope))}:${encodeURIComponent(key)}`
}

export function storageScopeKey(scope: ExtensionStorageScope): string {
  if (scope.kind === 'global') return 'global'
  if (scope.kind === 'card') return `card:${scope.cardId}`
  if (scope.kind === 'timeline') return `timeline:${scope.timelineId}`
  return `agent-session:${scope.agentSessionId}`
}

export function sameStorageScope(left: ExtensionStorageScope, right: ExtensionStorageScope): boolean {
  return storageScopeKey(left) === storageScopeKey(right)
}

export function sameEntityRef(left: ExtensionEntityRef, right: ExtensionEntityRef): boolean {
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

export function cloneStorageScope(scope: ExtensionStorageScope): ExtensionStorageScope {
  return structuredClone(scope)
}

export function assertStorageScope(scope: ExtensionStorageScope): void {
  if (!scope || typeof scope !== 'object') throw new Error('Extension Storage Scope must be an object')
  if (scope.kind === 'global') return
  if (scope.kind === 'card' && typeof scope.cardId === 'string' && scope.cardId.length > 0) return
  if (scope.kind === 'timeline' && typeof scope.timelineId === 'string' && scope.timelineId.length > 0) return
  if (scope.kind === 'agent-session' && typeof scope.agentSessionId === 'string' && scope.agentSessionId.length > 0) return
  throw new Error('Invalid Extension Storage Scope')
}

export function assertEntityRef(ref: ExtensionEntityRef): void {
  if (!ref || typeof ref !== 'object') throw new Error('Extension Entity Ref must be an object')
  if (ref.kind === 'narrative-node' && nonEmpty(ref.timelineId) && nonEmpty(ref.nodeId)) return
  if (ref.kind === 'agent-message' && nonEmpty(ref.agentSessionId) && nonEmpty(ref.messageId)) return
  if (ref.kind === 'asset' && nonEmpty(ref.assetId)) return
  if (ref.kind === 'state-path' && nonEmpty(ref.timelineId) && nonEmpty(ref.path)) return
  throw new Error('Invalid Extension Entity Ref')
}

export function assertStorageToken(value: string, label: string): void {
  if (!extensionStorageTokenPattern.test(value)) throw new Error(`${label} must be a stable token`)
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function toExtensionConfigEntry(
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

export function toExtensionRecordEntry(
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
  assertDeclaredDocumentType(record, document.type)
}
