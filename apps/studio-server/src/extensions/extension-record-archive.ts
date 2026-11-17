import { applicationDocumentTypes, type TimelineArchiveIdMap, type TimelineArchiveParticipant } from '@loom-studio/application-runtime'
import type { DocumentStore } from '@loom-studio/kernel/document-store'
import type { ExtensionEntityRef } from '@loom-studio/kernel/extension-host'
import { createId, isRecord, type JsonValue } from '@loom-studio/shared'

export type ExtensionRecordArchiveRemapInput = {
  recordId: string
  recordType: string
  data: JsonValue
  sourceTimelineId: string
  recordIds: Record<string, string>
  idMap: TimelineArchiveIdMap
}

type ArchivedRecord = {
  id: string
  recordType: string
  data: JsonValue
  bindings: ExtensionEntityRef[]
  createdAt: string
  updatedAt: string
}

/** Host-owned I/O deliberately bypasses extension execution; no temporary storage grant is issued. */
export function createExtensionRecordArchiveParticipant(options: {
  namespace: string
  version: number
  packageId: string
  ownerInstallationId?: string
  documents: DocumentStore
  remapData(input: ExtensionRecordArchiveRemapInput): JsonValue | Promise<JsonValue>
}): TimelineArchiveParticipant {
  return {
    namespace: options.namespace,
    version: options.version,
    async export({ timelineId }) {
      const records: ArchivedRecord[] = []
      let cursor: string | undefined
      do {
        const page = await options.documents.list({ type: applicationDocumentTypes.extensionRecord,
          ownerExtensionId: options.packageId, ownerInstallationId: options.ownerInstallationId ?? null, limit: 200, cursor })
        for (const document of page.items) {
          const content = document.content
          if (!isRecord(content) || !isRecord(content.scope) || content.scope.kind !== 'timeline' || content.scope.timelineId !== timelineId) continue
          const record = { id: document.id, recordType: content.recordType, data: content.data,
            bindings: content.bindings, createdAt: content.createdAt, updatedAt: content.updatedAt }
          validateRecord(record)
          records.push(record)
        }
        cursor = page.nextCursor
      } while (cursor)
      if (!records.length) return undefined
      return { packageId: options.packageId, ...(options.ownerInstallationId ? { ownerInstallationId: options.ownerInstallationId } : {}),
        version: options.version, sourceTimelineId: timelineId, records }
    },
    async import({ timelineId, idMap, payload }) {
      if (!isRecord(payload) || payload.packageId !== options.packageId || payload.ownerInstallationId !== options.ownerInstallationId
        || payload.version !== options.version || typeof payload.sourceTimelineId !== 'string' || !payload.sourceTimelineId
        || !Array.isArray(payload.records)) throw new Error('Extension record archive owner or format mismatch')
      if (idMap.timelineId !== timelineId) throw new Error('Extension record archive target mismatch')
      const records = payload.records
      const recordIds: Record<string, string> = Object.create(null)
      for (const record of records) {
        validateRecord(record)
        if (recordIds[record.id]) throw new Error('Duplicate archived extension record ID')
        recordIds[record.id] = createId('extension-record')
      }
      const prepared: Array<{ id: string; content: { scope: { kind: 'timeline'; timelineId: string }; recordType: string; data: JsonValue; bindings: ExtensionEntityRef[]; createdAt: string; updatedAt: string } }> = []
      for (const value of records) {
        // Validation above establishes the archive boundary before invoking extension code.
        const record = value as ArchivedRecord
        const bindings = record.bindings.map(binding => remapBinding(binding, payload.sourceTimelineId as string, idMap))
        const data = await options.remapData({ recordId: record.id, recordType: record.recordType,
          data: structuredClone(record.data), sourceTimelineId: payload.sourceTimelineId,
          recordIds: structuredClone(recordIds), idMap: structuredClone(idMap) })
        if (data === undefined) throw new Error('Extension archive remap must return JSON data')
        prepared.push({ id: recordIds[record.id]!, content: { scope: { kind: 'timeline', timelineId },
          recordType: record.recordType, data, bindings, createdAt: record.createdAt, updatedAt: record.updatedAt } })
      }
      if (!prepared.length) return
      await options.documents.transact({ actor: { kind: 'system', id: 'timeline-archive' }, reason: 'extension.records.archive.import' }, async tx => {
        for (const record of prepared) await tx.write({ ...record, type: applicationDocumentTypes.extensionRecord,
          expectedVersion: 'new', meta: { ownerExtensionId: options.packageId, ownerInstallationId: options.ownerInstallationId } })
      })
    },
  }
}

function validateRecord(value: unknown): asserts value is ArchivedRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.recordType !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.recordType) || value.data === undefined || !Array.isArray(value.bindings)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid archived extension record')
  for (const binding of value.bindings) {
    if (!isRecord(binding)) throw new Error('Invalid archived extension binding')
    const valid = binding.kind === 'narrative-node' ? typeof binding.timelineId === 'string' && typeof binding.nodeId === 'string'
      : binding.kind === 'state-path' ? typeof binding.timelineId === 'string' && typeof binding.path === 'string'
        : binding.kind === 'asset' ? typeof binding.assetId === 'string'
          : binding.kind === 'agent-message' && typeof binding.agentSessionId === 'string' && typeof binding.messageId === 'string'
    if (!valid) throw new Error('Invalid archived extension binding')
  }
}

function remapBinding(binding: ExtensionEntityRef, sourceTimelineId: string, idMap: TimelineArchiveIdMap): ExtensionEntityRef {
  if (binding.kind === 'narrative-node' && binding.timelineId === sourceTimelineId) {
    const nodeId = idMap.nodeIds[binding.nodeId]
    if (!nodeId) throw new Error(`Archived extension binding has no node mapping: ${binding.nodeId}`)
    return { ...binding, timelineId: idMap.timelineId, nodeId }
  }
  if (binding.kind === 'state-path' && binding.timelineId === sourceTimelineId) return { ...binding, timelineId: idMap.timelineId }
  throw new Error('Archived extension binding has no portable mapping')
}
