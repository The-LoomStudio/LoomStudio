import { randomUUID } from 'node:crypto'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-runtime/data'
import { createSqliteDataEngine } from '@loom-studio/kernel/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/kernel/document-store'
import { applicationDocumentTypes, createApplicationRuntime } from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import { createExtensionRecordArchiveParticipant } from '../../../apps/studio-server/src/extensions/extension-record-archive.js'
import type { TimelineArchivePendingContent } from '../../../packages/application-runtime/src/archive/timeline-archive.js'

describe('Runtime extension record archive recovery', () => {
  it('retains failed and unknown payloads across export and remaps original references on a second import', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
    const documents = createSqliteDocumentStore({ engine })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents,
      narratives: createNarrativeStore({ engine }), promptResources: createPromptResourceStore({ engine }) })
    try {
      const { card } = await runtime.createCard({ name: 'Archived memories', opening: 'Original opening' })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id })
      const nodeId = story.branch.headNodeId!
      const timestamp = new Date().toISOString()
      for (const id of ['memory-one', 'memory-two']) await documents.write({ id, type: applicationDocumentTypes.extensionRecord,
        meta: { ownerExtensionId: 'example.memory' }, content: {
          scope: { kind: 'timeline', timelineId: story.timeline.id }, recordType: 'memory',
          data: { nodeId, recordId: 'memory-one', sourceDigest: 'stable-content-digest' },
          bindings: [{ kind: 'narrative-node', timelineId: story.timeline.id, nodeId }], createdAt: timestamp, updatedAt: timestamp,
        } })
      let fail = true
      const participant = createExtensionRecordArchiveParticipant({ documents, namespace: 'example.memory.records', version: 1, packageId: 'example.memory',
        remapData: ({ data, idMap, recordIds, sourceTimelineId }) => {
          if (fail) throw new Error('Adapter temporarily unavailable')
          expect(sourceTimelineId).toBe(story.timeline.id)
          const record = data as { nodeId: string; recordId: string; sourceDigest: string }
          return { ...record, nodeId: idMap.nodeIds[record.nodeId]!, recordId: recordIds[record.recordId]! }
        } })
      runtime.registerTimelineArchiveParticipant(participant)
      const original = (await runtime.exportTimelineArchive({ timelineId: story.timeline.id })).archive
      const originalPayload = original.participants[0]!.payload
      original.participants.push({ namespace: 'missing.extension', version: 3, payload: { nodeId, arbitrary: ['keep', 'exactly'] } })

      const first = await runtime.importTimelineArchive({ source: JSON.stringify(original) })
      expect(first.participantFailures).toEqual([{ namespace: participant.namespace, message: 'Adapter temporarily unavailable' }])
      expect(first.unknownParticipantNamespaces).toEqual(['missing.extension'])
      const pending = (await documents.get(`timeline-archive-pending:${first.timelineId}`))!.content as TimelineArchivePendingContent
      expect(pending.blocks).toHaveLength(2)
      expect(pending.blocks.find(block => block.namespace === participant.namespace)!.payload).toEqual(originalPayload)
      expect((await runtime.listExtensionRecords({ packageId: 'example.memory', scope: { kind: 'timeline', timelineId: first.timelineId } })).records).toEqual([])

      const secondArchive = (await runtime.exportTimelineArchive({ timelineId: first.timelineId })).archive
      expect(secondArchive.participants.map(block => block.namespace).sort()).toEqual(['example.memory.records', 'missing.extension'])
      expect(secondArchive.participants.find(block => block.namespace === participant.namespace)!.payload).toEqual(originalPayload)
      fail = false
      const second = await runtime.importTimelineArchive({ source: JSON.stringify(secondArchive) })
      expect(second.participantFailures).toEqual([])
      expect(second.unknownParticipantNamespaces).toEqual(['missing.extension'])
      const finalNodeId = second.idMap.nodeIds[first.idMap.nodeIds[nodeId]!]!
      const records = (await runtime.listExtensionRecords({ packageId: 'example.memory', scope: { kind: 'timeline', timelineId: second.timelineId } })).records
      expect(records).toHaveLength(2)
      const importedRecordId = (records[0]!.data as { recordId: string }).recordId
      expect(records.map(record => record.id)).toContain(importedRecordId)
      expect(importedRecordId).not.toBe('memory-one')
      for (const record of records) {
        expect(record.scope).toEqual({ kind: 'timeline', timelineId: second.timelineId })
        expect(record.data).toEqual({ nodeId: finalNodeId, recordId: importedRecordId, sourceDigest: 'stable-content-digest' })
        expect(record.bindings).toEqual([{ kind: 'narrative-node', timelineId: second.timelineId, nodeId: finalNodeId }])
      }
      const finalPending = (await documents.get(`timeline-archive-pending:${second.timelineId}`))!.content as TimelineArchivePendingContent
      expect(finalPending.blocks).toHaveLength(1)
      expect(finalPending.blocks[0]).toMatchObject({ namespace: 'missing.extension', version: 3,
        payload: { nodeId, arbitrary: ['keep', 'exactly'] }, idMap: { timelineId: second.timelineId, nodeIds: { [nodeId]: finalNodeId } } })
      const finalArchive = (await runtime.exportTimelineArchive({ timelineId: second.timelineId })).archive
      expect(finalArchive.participants.find(block => block.namespace === 'missing.extension')!.payload).toEqual(original.participants[1]!.payload)
    } finally { engine.close() }
  })
})
