import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes, createTimelineArchiveParticipantRegistry } from '@loom-studio/application-runtime'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createExtensionRecordArchiveParticipant } from '../../../apps/studio-server/src/extensions/extension-record-archive.js'

const idMap = { timelineId: 'new', nodeIds: { oldNode: 'newNode' }, branchIds: {}, stateRevisionIds: {} }
const scope = { kind: 'timeline', timelineId: 'old' }
const timestamp = '2026-01-01T00:00:00Z'
const exportInput = { timelineId: 'old', nodeIds: ['oldNode'], branchIds: [], stateRevisionIds: [] }

async function fixture() {
  const documents = createInMemoryDocumentStore()
  onTestFinished(() => documents.close())
  for (const [id, owner, installation, recordScope] of [
    ['one', 'pkg', undefined, scope], ['two', 'pkg', undefined, scope],
    ['foreign', 'other', undefined, scope], ['card', 'pkg', 'card-installation', scope],
    ['global', 'pkg', undefined, { kind: 'global' }],
  ] as const) await documents.write({ id, type: applicationDocumentTypes.extensionRecord,
    meta: { ownerExtensionId: owner, ownerInstallationId: installation },
    content: { scope: recordScope, recordType: 'memory', data: { reference: 'one' },
      bindings: [{ kind: 'narrative-node', timelineId: 'old', nodeId: 'oldNode' }], createdAt: timestamp, updatedAt: timestamp } })
  const participant = createExtensionRecordArchiveParticipant({ documents, namespace: 'pkg.records', version: 1, packageId: 'pkg',
    remapData: ({ recordIds }) => ({ reference: recordIds.one! }) })
  return { documents, participant }
}

describe('Extension record archive host adapter', () => {
  it('isolates scope and installation, remaps node and cross-record references without extension execution', async () => {
    const { documents, participant } = await fixture()
    const payload = await participant.export(exportInput)
    expect(payload).toMatchObject({ records: [{ id: 'one' }, { id: 'two' }] })
    await participant.import({ timelineId: 'new', idMap, payload: payload! })
    const imported = (await documents.list({ type: applicationDocumentTypes.extensionRecord })).items.filter(doc => (doc.content as any).scope.timelineId === 'new')
    expect(imported).toHaveLength(2)
    expect(imported.every(doc => doc.meta.ownerExtensionId === 'pkg' && doc.meta.ownerInstallationId === undefined)).toBe(true)
    expect(imported.map(doc => (doc.content as any).data.reference)).toEqual([imported[0]!.id, imported[0]!.id])
    expect(imported[0]!.content).toMatchObject({ bindings: [{ timelineId: 'new', nodeId: 'newNode' }] })
  })
  it('rejects owner injection and commits nothing when remapping fails', async () => {
    const { documents, participant } = await fixture()
    const payload = await participant.export(exportInput)
    await expect(participant.import({ timelineId: 'new', idMap, payload: { ...(payload as object), packageId: 'foreign' } })).rejects.toThrow('owner')
    const failing = createExtensionRecordArchiveParticipant({ documents, namespace: 'pkg.records', version: 1, packageId: 'pkg',
      remapData: ({ recordId, data }) => { if (recordId === 'two') throw new Error('remap failed'); return data } })
    const registry = createTimelineArchiveParticipantRegistry([failing])
    expect(await registry.importParticipants({ timelineId: 'new', idMap, blocks: [{ namespace: 'pkg.records', version: 1, payload: payload! }] })).toMatchObject({ failures: [{ message: 'remap failed' }] })
    expect((await documents.list()).items).toHaveLength(5)
  })
  it('rejects bindings outside the archive before any writes', async () => {
    const { documents, participant } = await fixture()
    const payload = await participant.export(exportInput)
    await expect(participant.import({ timelineId: 'new', idMap: { ...idMap, nodeIds: {} }, payload: payload! })).rejects.toThrow('no node mapping')
    expect((await documents.list()).items).toHaveLength(5)
  })
})
