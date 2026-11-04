import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createBlobStore } from '@loom-studio/asset-store'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createNarrativeSampler } from '../../../packages/application-runtime/src/narrative/sampling.js'
import { createResourceVfs } from '../../../packages/application-runtime/src/vfs/resource-filesystem.js'
import type { VfsEntry } from '../../../packages/application-runtime/src/vfs/types.js'

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-timeline-workspace-'))
  const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const narratives = createNarrativeStore({ engine })
  const documents = createSqliteDocumentStore({ engine })
  const runtime = createApplicationRuntime({ dataEngine: engine, narratives,
    documents, promptResources: createPromptResourceStore({ engine }),
    blobs: createBlobStore({ engine, rootDirectory: directory, createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() }),
  })
  const { card } = await runtime.createCard({ name: 'Workspace' })
  const story = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'Opening' })
  const target = { timelineId: story.timeline.id, branchId: story.branch.id }
  const mutate = async (operations: Parameters<typeof runtime.mutateTimelineWorkspace>[0]['operations']) =>
    runtime.mutateTimelineWorkspace({ ...target, expectedRevisionId: (await runtime.getTimelineWorkspace(target)).id, operations })
  return { engine, documents, narratives, runtime, story, target, mutate, close: async () => { engine.close(); await rm(directory, { recursive: true, force: true }) } }
}

describe('Timeline Workspace foundation', () => {
  it('receives opaque participant data in the core import transaction and rolls both back on failure', async () => {
    const f = await setup()
    try {
      const { archive } = await f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })
      archive.participants.push({ namespace: 'future.data', version: 1, payload: { value: 'preserve' } })
      const participate = f.documents.participateTransaction.bind(f.documents)
      let sawPending = false
      const spy = vi.spyOn(f.documents, 'participateTransaction').mockImplementation((tx, action, options) =>
        participate(tx, documents => action(new Proxy(documents, { get(target, key, receiver) {
          if (key === 'write') return async (input: Parameters<typeof documents.write>[0]) => {
            if (input.type === 'airp.timelineArchivePending') { sawPending = true; throw new Error('Pending storage unavailable') }
            return documents.write(input)
          }
          return Reflect.get(target, key, receiver)
        } })), options))
      await expect(f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })).rejects.toThrow('Pending storage unavailable')
      spy.mockRestore()
      expect(sawPending).toBe(true)
      expect((await f.runtime.listNarrativeTimelines()).timelines.map(t => t.id)).toEqual([f.target.timelineId])
    } finally { vi.restoreAllMocks(); await f.close() }
  })

  it('returns the committed Timeline when participant receipt cleanup fails without replaying the participant', async () => {
    const f = await setup()
    try {
      const { archive } = await f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })
      archive.participants.push({ namespace: 'known.data', version: 1, payload: { value: 'known' } },
        { namespace: 'future.data', version: 1, payload: { value: 'opaque' } })
      const imported = vi.fn()
      const handle = f.runtime.registerTimelineArchiveParticipant({ namespace: 'known.data', version: 1,
        export: () => undefined, import: imported })
      const transact = f.documents.transact.bind(f.documents)
      vi.spyOn(f.documents, 'transact').mockImplementation((input, action) => {
        if (input.reason === 'application.importTimelineArchive.pendingParticipants') throw new Error('Receipt unavailable')
        return transact(input, action)
      })
      const result = await f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      expect(imported).toHaveBeenCalledTimes(1)
      expect(result.participantFailures.some(failure => failure.message.includes('Do not repeat'))).toBe(true)
      handle.unregister()
      const exported = await f.runtime.exportTimelineArchive({ timelineId: result.timelineId })
      expect(exported.archive.participants.map(block => block.namespace)).toEqual(['known.data', 'future.data'])
      expect((await f.runtime.listNarrativeTimelines()).timelines).toHaveLength(2)
    } finally { vi.restoreAllMocks(); await f.close() }
  })

  it('exports a consistent archive while a node edit waits behind the read snapshot', async () => {
    const f = await setup()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const handle = f.runtime.registerTimelineArchiveParticipant({ namespace: 'snapshot-test', version: 1,
      export: async () => { entered.resolve(); await release.promise; return undefined }, import: () => {},
    })
    try {
      const exporting = f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })
      await entered.promise
      const node = f.story.nodes[0]!
      const editing = f.narratives.editBranchNode({ actor: { kind: 'system', id: 'test' }, ...f.target,
        nodeId: node.id, expectedHeadNodeId: node.id, expectedBody: node.body,
        body: { format: 'loom-markdown.v1', raw: 'Edited after snapshot' } })
      release.resolve()
      const { archive } = await exporting
      await editing
      expect(archive.nodes.map(item => item.body.raw)).toEqual(['Opening'])
      expect(archive.recoveryPoints?.every(point => archive.nodes.some(item => item.id === point.nodeId))).toBe(true)
      await expect(f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })).resolves.toBeDefined()
      expect((await f.narratives.getPage(f.target)).nodes[0]?.body.raw).toBe('Edited after snapshot')
    } finally { handle.unregister(); await f.close() }
  })

  it('commits the deduplicated Blob ID for equal binary writes and their copies', async () => {
    const f = await setup()
    try {
      const bytes = new Uint8Array([10, 20, 30])
      await f.mutate([
        ...['a', 'b'].map(id => ({ kind: 'create' as const, entry: { id, kind: 'file' as const, name: `${id}.bin`, content: { text: '' } } })),
        ...['a', 'b'].map(entryId => ({ kind: 'write' as const, entryId, content: bytes })),
        { kind: 'copy', entryId: 'b', name: 'copy.bin' },
      ])
      const revision = await f.runtime.getTimelineWorkspace(f.target)
      const binaries = revision.entries.filter(entry => entry.kind === 'file' && 'blobId' in entry.content)
      expect(binaries).toHaveLength(3)
      for (const entry of binaries) expect(Array.from((await f.runtime.readWorkspaceFile({ ...f.target, entryId: entry.id })).bytes)).toEqual(Array.from(bytes))
      expect(new Set(binaries.map(entry => entry.kind === 'file' && 'blobId' in entry.content ? entry.content.blobId : null)).size).toBe(1)
      const archive = (await f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })).archive
      await expect(f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })).resolves.toBeDefined()
    } finally { await f.close() }
  })

  it('recovers the complete tree at a departed floor, isolates forks, and rejects stale writes and deleted targets', async () => {
    const f = await setup()
    try {
      const initial = await f.runtime.getTimelineWorkspace(f.target)
      expect(initial.entries[0]).toMatchObject({ name: 'MEMORY.md' })
      await f.mutate([{ kind: 'create', entry: { id: 'drafts', kind: 'directory', name: 'drafts' } },
        { kind: 'create', entry: { id: 'script', parentId: 'drafts', name: 'helper.js', kind: 'file', content: { text: 'return 1' } } }])
      const stateTarget = { scope: 'timeline' as const, ...f.target }
      const state = (await f.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      await f.runtime.applyStateMutation({ target: stateTarget, expectedRevisionId: state.revisionId, operations: [{ op: 'set', path: '/phase', value: 1 }] })
      const atOne = await f.runtime.getTimelineWorkspace(f.target)
      const input = await f.runtime.appendNarrativeInput({ ...f.target, nodeId: 'two', expectedHeadNodeId: f.story.nodes[0]!.id, content: 'Continue' })
      await f.mutate([{ kind: 'delete', entryId: 'drafts' }, { kind: 'write', entryId: 'memory', content: 'Later' }])
      const stateAfter = (await f.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      await f.runtime.applyStateMutation({ target: stateTarget, expectedRevisionId: stateAfter.revisionId, operations: [{ op: 'set', path: '/phase', value: 2 }] })
      const fork = await f.runtime.forkNarrativeBranch({ timelineId: f.target.timelineId, fromBranchId: f.target.branchId, fromNodeId: f.story.nodes[0]!.id })
      expect((await f.runtime.getTimelineWorkspace({ ...f.target, branchId: fork.branch.id })).entries).toEqual(atOne.entries)
      expect((await f.runtime.getStateSnapshot({ target: { ...stateTarget, branchId: fork.branch.id } })).snapshot.value).toMatchObject({ phase: 1 })
      expect(input.node.floor).toBe(2)
      const scoped = createNarrativeSampler(f.narratives, { ...f.target, afterNodeId: f.story.nodes[0]!.id, throughNodeId: input.node.id })
      await expect(scoped.sample({ ...f.target, selection: { kind: 'floors', from: 1, through: 2 } })).rejects.toMatchObject({ code: 'narrative.read_out_of_range' })
      expect((await scoped.sample({ ...f.target, selection: { kind: 'floors', from: 2, through: 2 } })).nodes[0]!.id).toBe(input.node.id)
      const replacement = await f.runtime.appendNarrativeInput({ timelineId: f.target.timelineId, branchId: fork.branch.id, expectedHeadNodeId: f.story.nodes[0]!.id, nodeId: 'fork-two', content: 'Other' })
      expect(replacement.node.floor).toBe(2)
      await expect(f.runtime.mutateTimelineWorkspace({ ...f.target, expectedRevisionId: atOne.id, operations: [{ kind: 'write', entryId: 'memory', content: 'stale' }] })).rejects.toThrow('changed')
      const before = await f.runtime.getTimelineWorkspace(f.target)
      await expect(f.mutate([{ kind: 'create', entry: { id: 'bad', parentId: 'bad', kind: 'directory', name: 'bad' } }])).rejects.toThrow('parent or cycle')
      expect(await f.runtime.getTimelineWorkspace(f.target)).toEqual(before)
      const edited = await f.runtime.editNarrativeNode({ ...f.target, nodeId: f.story.nodes[0]!.id, expectedHeadNodeId: input.node.id, expectedRaw: 'Opening', raw: 'Edited opening' })
      expect(edited.replacements.map(item => item.node.floor)).toEqual([1, 2])
      const editedArchive = await f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })
      await expect(f.runtime.importTimelineArchive({ source: JSON.stringify(editedArchive.archive) })).resolves.toMatchObject({ participantFailures: [] })
      await f.runtime.deleteNarrativeTimeline({ timelineId: f.target.timelineId })
      await expect(f.runtime.getTimelineWorkspace(f.target)).rejects.toThrow('unavailable')
    } finally { await f.close() }
  })

  it('carries historical binary bytes and recovery points through an archive and preserves gaps in floor reads', async () => {
    const f = await setup()
    try {
      await f.mutate([{ kind: 'create', entry: { id: 'image', name: 'oc.png', kind: 'file', content: { text: '' } } },
        { kind: 'write', entryId: 'image', content: new Uint8Array([0, 255, 128, 42]), mediaType: 'image/png' }])
      const beforeOversize = await f.runtime.getTimelineWorkspace(f.target)
      await expect(f.mutate([{ kind: 'write', entryId: 'image', content: new Uint8Array(32 * 1024 * 1024 + 1) }])).rejects.toThrow()
      expect(await f.runtime.getTimelineWorkspace(f.target)).toEqual(beforeOversize)
      await f.runtime.appendNarrativeInput({ ...f.target, expectedHeadNodeId: f.story.nodes[0]!.id, nodeId: 'next', content: 'Next' })
      await f.mutate([{ kind: 'delete', entryId: 'image' }])
      const { archive } = await f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })
      const imported = await f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      const importedStory = await f.runtime.getNarrativeTimeline({ timelineId: imported.timelineId })
      const original = (await f.runtime.getNarrativePage({ timelineId: imported.timelineId })).nodes[0]!
      const fork = await f.runtime.forkNarrativeBranch({ timelineId: imported.timelineId, fromBranchId: importedStory.timeline.activeBranchId, fromNodeId: original.id })
      const binary = await f.runtime.readWorkspaceFile({ timelineId: imported.timelineId, branchId: fork.branch.id, entryId: 'image' })
      expect([...binary.bytes]).toEqual([0, 255, 128, 42])
      const legacy = JSON.parse(JSON.stringify(archive))
      delete legacy.workspace
      delete legacy.recoveryPoints
      for (const node of legacy.nodes) { delete node.floor; delete node.workspaceRevisionId }
      for (const branch of legacy.branches) delete branch.workspaceHeadRevisionId
      await expect(f.runtime.importTimelineArchive({ source: JSON.stringify(legacy) })).rejects.toThrow('Workspace block is missing')
      // A pruned archive can carry sparse stable positions; it never renumbers surviving nodes.
      archive.nodes[0]!.floor = 728
      archive.nodes[1]!.floor = 730
      const sparse = await f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      const sample = await createNarrativeSampler(f.narratives).sample({ timelineId: sparse.timelineId, selection: { kind: 'floors', from: 728, through: 730 } })
      expect(sample.nodes.map(node => node.floor)).toEqual([728, 730])
      expect(sample.missingFloors).toEqual([729])
      await expect(createNarrativeSampler(f.narratives).sample({ timelineId: sparse.timelineId, selection: { kind: 'floors', from: 729, through: 729 } })).rejects.toThrow('unavailable')
    } finally { await f.close() }
  })

  it('uses the regular VFS for text operations and preserves read-version checks', async () => {
    const f = await setup()
    try {
      const fs = createResourceVfs({ projections: [], workspace: {
        snapshot: async () => {
          const revision = await f.runtime.getTimelineWorkspace(f.target)
          const paths = new Map<string, string>()
          const pathOf = (id: string): string => {
            const entry = revision.entries.find(entry => entry.id === id)!
            const path = `${entry.parentId ? paths.get(entry.parentId) ?? pathOf(entry.parentId) : '/workspace'}/${entry.name}`
            paths.set(id, path); return path
          }
          return [{ path: '/workspace', kind: 'directory', binding: { kind: 'workspace', entryId: '', revisionId: revision.id } }, ...revision.entries.map(entry => ({
            path: pathOf(entry.id), kind: entry.kind, content: entry.kind === 'file' && 'text' in entry.content ? entry.content.text : undefined,
            binding: { kind: 'workspace', entryId: entry.id, revisionId: revision.id },
          }))] as VfsEntry[]
        },
        mutate: async (expectedRevisionId, operations) => (await f.runtime.mutateTimelineWorkspace({ ...f.target, expectedRevisionId, operations })).mutation,
      } })
      const signal = new AbortController().signal
      await fs.create(['/workspace', { name: 'drafts', kind: 'directory' }], signal)
      await fs.create(['/workspace/drafts', { name: 'test.js', kind: 'file', content: 'const a = 1;\n' }], signal)
      await fs.read(['/workspace/drafts/test.js'], signal)
      await fs.patch(['/workspace/drafts/test.js', '--- /workspace/drafts/test.js\n+++ /workspace/drafts/test.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n'], signal)
      await expect(fs.write(['/workspace/drafts/test.js', 'stale'], signal)).rejects.toMatchObject({ code: 'vfs.baseline_changed' })
      await fs.move(['/workspace/drafts/test.js', '/workspace/helper.js'], signal)
      expect((await fs.read(['/workspace/helper.js'], signal)).text).toBe('const a = 2;\n')
      await fs.copy(['/workspace/helper.js', '/workspace/copy.js'], signal)
      await fs.delete(['/workspace/drafts'], signal)
      expect(await fs.ls(['/workspace'], signal)).toContain('copy.js')
      const copied = (await f.runtime.getTimelineWorkspace(f.target)).entries.find(entry => entry.name === 'copy.js')!
      await f.mutate([{ kind: 'delete', entryId: copied.id }, { kind: 'create', entry: { id: 'replacement', name: 'copy.js', kind: 'file', content: { text: 'Other work' } } }])
      await expect(fs.delete(['/workspace/copy.js'], signal)).rejects.toMatchObject({ code: 'vfs.path_rebound' })
    } finally { await f.close() }
  })
})
