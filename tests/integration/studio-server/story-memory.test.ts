import { describe, expect, it, vi } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createExtensionStorageContext } from '../../../packages/extension-sdk/extension-host/src/storage.js'
import { createExtensionNarrativeReader } from '../../../apps/studio-server/src/extensions/extension-narrative-reader.js'
import { createExtensionRecordArchiveParticipant } from '../../../apps/studio-server/src/extensions/extension-record-archive.js'
import { createStoryMemory, remapArchive } from '../../../official/extensions/story-memory/server.js'

async function setup(policy: Record<string, number> = {}) {
  const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
  const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, ...clock })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, promptResources: createPromptResourceStore({ engine, ...clock }) })
  const { card } = await runtime.createCard({ name: 'Memory behavior' })
  const story = await runtime.createNarrativeTimeline({ cardId: card.id })
  const target = { scope: 'timeline', timelineId: story.timeline.id, branchId: story.branch.id }
  type StorageArgs = Parameters<typeof createExtensionStorageContext>
  const storage = createExtensionStorageContext(
    { packageManifest: { id: 'official.story-memory', participation: 'timeline' }, target: { kind: 'global' } } as StorageArgs[0],
    { scope: { active: true } } as StorageArgs[1],
    { documents, validateStorageScope: async candidate => {
      if (candidate.kind !== 'timeline' || !await narratives.getTimeline(candidate.timelineId)) throw new Error('Invalid test Timeline')
    } } as StorageArgs[2], { kind: 'extension', id: 'official.story-memory' })
  const reader = createExtensionNarrativeReader(runtime, narratives)
  const invoke = vi.fn(async (_input: { sessionId: string; input: string; activationFacts: unknown }) => ({ state: 'completed', text: '压缩后的事件记忆' }))
  const cancel = vi.fn(async (_sessionId: string) => undefined)
  const acknowledge = vi.fn(async (_sessionId: string) => undefined)
  const taskRead = vi.fn(async (_sessionId: string): Promise<any> => ({ state: 'failed' }))
  const service = createStoryMemory({ storage,
    narrative: { read: (input: Parameters<typeof reader.read>[1]) => reader.read(target, input), validate: (source: Parameters<typeof reader.validate>[1]) => reader.validate(target, source) },
    agentTasks: { create: async () => ({ sessionId: crypto.randomUUID() }), invoke, cancel, read: taskRead, acknowledge, dispose: vi.fn(async () => undefined) },
    tokens: { countText: async () => ({ estimatedTokens: 60 }) },
  })
  await service.configure(target, { value: { batchFloors: 2, bufferFloors: 2, lv2Count: 2, lv2Tokens: 12000, ...policy }, expectedVersion: null })
  const append = async (content?: string) => {
    const branch = await narratives.getBranch(target.branchId)
    return runtime.appendNarrativeInput({ ...target, nodeId: crypto.randomUUID(), content: content ?? '原始事件', expectedHeadNodeId: branch!.headNodeId })
  }
  const appendMany = async (count: number) => { const nodes = []; for (let i = 0; i < count; i++) nodes.push((await append(`第${i + 1}段事实`)).node); return nodes }
  const activity = () => service.activity({ kind: 'input', ...target })
  const batches = async () => (await service.status(target)).batches
  const confirm = async (id: string) => { const batch = (await batches()).find((item: any) => item.id === id); return service.confirm(target, { id, version: batch.version }) }
  return { engine, documents, narratives, runtime, target, storage, service, invoke, cancel, acknowledge, taskRead, append, appendMany, activity, batches, confirm }
}

describe('Story Memory using Runtime Narrative and Extension Record storage', () => {
  it('manually summarizes a short tail and merges two LV1 batches without lowering automatic thresholds', async () => {
    const f = await setup({ batchFloors: 32, bufferFloors: 0, lv2Count: 12 })
    try {
      await f.appendMany(3)
      await f.activity()
      expect(f.invoke).not.toHaveBeenCalled()
      const first = await f.service.prepare(f.target, 1)
      expect(first.data).toMatchObject({ fromFloor: 1, throughFloor: 3, status: 'draft' })
      expect(first.data.sessionId).toBeUndefined()
      await expect(f.service.prepare(f.target, 1)).rejects.toThrow('已有待处理批次')
      await f.confirm(first.id)
      await expect(f.service.prepare(f.target, 2)).rejects.toThrow('至少两份')
      await f.append('第四楼')
      await f.activity()
      expect(f.invoke).toHaveBeenCalledTimes(1)
      const second = await f.service.prepare(f.target, 1)
      expect(second.data).toMatchObject({ fromFloor: 4, throughFloor: 4 })
      await f.confirm(second.id)
      await f.activity()
      expect(f.invoke).toHaveBeenCalledTimes(2)
      const promoted = await f.service.prepare(f.target, 2)
      expect(promoted.data).toMatchObject({ level: 2, fromFloor: 1, throughFloor: 4, inputs: [{ id: first.id }, { id: second.id }] })
      await f.confirm(promoted.id)
      expect((await f.service.status(f.target)).batches.filter((b: any) => b.resident).map((b: any) => b.level)).toEqual([2])
      await expect(f.service.prepare(f.target, 1)).rejects.toThrow('没有尚未总结')
    } finally { f.engine.close() }
  })

  it('freezes the first batch, requires approval and first-adoption buffer, then keeps it resident after a one-floor retreat', async () => {
    const f = await setup()
    try {
      const nodes = await f.appendMany(3)
      await f.activity()
      expect(f.invoke).toHaveBeenCalledOnce()
      const input = f.invoke.mock.calls[0]![0]
      expect(input.input).toContain('原文第 1 楼')
      expect(input.input).toContain('原文第 2 楼')
      expect(input.input).not.toContain('原文第 3 楼')
      expect(input.activationFacts).toEqual({ summary: { level: 1 } })
      const draft = (await f.batches())[0]
      expect(draft.source.nodeIds).toEqual(nodes.slice(0, 2).map(node => node.id))
      expect((await f.service.projection(f.target)).memory).toBeNull()
      await expect(f.service.confirm(f.target, { id: draft.id, version: draft.version - 1 })).rejects.toThrow('摘要已变化')
      await f.confirm(draft.id)
      expect((await f.service.projection(f.target)).memory).toBeNull()
      await f.append('缓冲达到四楼')
      await f.service.activity({ kind: 'run-completed', ...f.target })
      expect((await f.service.projection(f.target)).memory.entries).toHaveLength(1)
      const fork = await f.runtime.forkNarrativeBranch({ timelineId: f.target.timelineId, fromBranchId: f.target.branchId, fromNodeId: nodes[2]!.id })
      f.target.branchId = fork.branch.id
      expect((await f.service.projection(f.target)).memory.entries).toHaveLength(1)
      await f.activity()
      expect(f.invoke).toHaveBeenCalledOnce()
      const head = (await f.narratives.getBranch(f.target.branchId))!.headNodeId
      await f.runtime.editNarrativeNode({ ...f.target, nodeId: nodes[2]!.id, expectedHeadNodeId: head, expectedRaw: nodes[2]!.body.raw, raw: '后段改写' })
      await f.service.activity({ kind: 'run-completed', ...f.target })
      expect(f.invoke).toHaveBeenCalledOnce()
      expect((await f.batches())[0].valid).toBe(true)
      await f.runtime.editNarrativeNode({ ...f.target, nodeId: nodes[0]!.id, expectedHeadNodeId: (await f.narratives.getBranch(f.target.branchId))!.headNodeId, expectedRaw: nodes[0]!.body.raw, raw: '来源事实变化' })
      expect((await f.batches())[0].valid).toBe(false)
      expect((await f.service.projection(f.target)).memory).toBeNull()
    } finally { f.engine.close() }
  })

  it.each([{ lv2Count: 2, lv2Tokens: 12000 }, { lv2Count: 10, lv2Tokens: 100 }])('promotes on either threshold, retaining lower files and remapping the published archive: %j', async policy => {
    const f = await setup({ bufferFloors: 0, ...policy })
    try {
      await f.appendMany(3)
      await f.activity()
      const first = (await f.batches())[0]
      await f.confirm(first.id)
      await f.appendMany(2)
      await f.activity()
      const second = (await f.batches()).find((item: any) => item.status === 'draft')
      await f.confirm(second.id)
      await f.activity()
      const higher = (await f.batches()).find((item: any) => item.level === 2)
      expect(higher.status).toBe('draft')
      expect(higher.inputs.map((ref: any) => ref.id)).toEqual([first.id, second.id])
      expect((await f.service.projection(f.target)).memory.entries).toHaveLength(2)
      expect(f.invoke.mock.calls.at(-1)![0].activationFacts).toEqual({ summary: { level: 2 } })
      await f.confirm(higher.id)
      expect((await f.service.projection(f.target)).memory.entries.map((entry: any) => entry.id)).toEqual([higher.id])
      const files = await f.service.files(f.target)
      expect(files.map((file: any) => file.path)).toEqual(expect.arrayContaining(['/story-memory/LV1/1-2.md', '/story-memory/LV1/3-4.md', '/story-memory/LV2/1-4.md']))
      expect(files.find((file: any) => file.path === '/story-memory/LV2/1-4.md').content).toContain(first.id)
      f.runtime.registerTimelineArchiveParticipant(createExtensionRecordArchiveParticipant({ namespace: 'official.story-memory.archive', version: 1,
        packageId: 'official.story-memory', documents: f.documents, remapData: remapArchive }))
      const archive = (await f.runtime.exportTimelineArchive({ timelineId: f.target.timelineId })).archive
      const imported = await f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      expect(imported.participantFailures).toEqual([])
      f.target.timelineId = imported.timelineId
      f.target.branchId = imported.idMap.branchIds[f.target.branchId]!
      const restored = await f.batches()
      expect(restored.filter((item: any) => item.resident)).toHaveLength(1)
      const restoredHigher = restored.find((item: any) => item.level === 2)
      expect(restoredHigher.resident).toBe(true)
      expect(restoredHigher.inputs.every((ref: any) => restored.some((item: any) => item.id === ref.id && item.version === ref.version))).toBe(true)
      expect(restored.filter((item: any) => item.level === 1).every((item: any) => item.source.timelineId === imported.timelineId && item.valid)).toBe(true)
    } finally { f.engine.close() }
  })

  it('rejects confirmation when fixed sources change while the model is running', async () => {
    const f = await setup({ bufferFloors: 0 })
    try {
      const nodes = await f.appendMany(3)
      let resolve!: (result: { state: string; text: string }) => void
      let entered!: () => void
      const invoked = new Promise<void>(done => { entered = done })
      f.invoke.mockImplementationOnce(async () => { entered(); return new Promise(done => { resolve = done }) })
      const preparation = f.activity()
      await invoked
      await f.runtime.editNarrativeNode({ ...f.target, nodeId: nodes[0]!.id, expectedHeadNodeId: nodes[2]!.id,
        expectedRaw: nodes[0]!.body.raw, raw: '生成期间改写来源' })
      resolve({ state: 'completed', text: '依据旧来源完成的草稿' })
      await preparation
      const draft = (await f.batches())[0]
      expect(draft.valid).toBe(false)
      await expect(f.confirm(draft.id)).rejects.toThrow('来源已变化')
      expect((await f.service.projection(f.target)).memory).toBeNull()
    } finally { f.engine.close() }
  })

  it('does not publish failed or cancelled runs', async () => {
    const f = await setup({ bufferFloors: 0 })
    try {
      await f.appendMany(3)
      f.invoke.mockRejectedValueOnce(new Error('Model unavailable'))
      await f.activity()
      const failed = (await f.batches())[0]
      expect(failed.status).toBe('failed')
      await expect(f.confirm(failed.id)).rejects.toThrow('只能确认')
      let resolve!: (result: { state: string; text: string }) => void
      let entered!: () => void
      const invoked = new Promise<void>(done => { entered = done })
      f.invoke.mockImplementationOnce(async () => { entered(); return new Promise(done => { resolve = done }) })
      const revision = f.service.revise(f.target, { id: failed.id, version: failed.version, input: '重试总结' })
      await invoked
      await f.service.cancel(f.target, { id: failed.id })
      resolve({ state: 'completed', text: '取消后的迟到结果' })
      await revision
      expect(f.cancel).toHaveBeenCalledOnce()
      expect((await f.batches())[0].status).toBe('cancelled')
      await expect(f.confirm(failed.id)).rejects.toThrow('只能确认')
      expect((await f.service.projection(f.target)).memory).toBeNull()
    } finally { f.engine.close() }
  })
  it('does not acknowledge a result until draft storage succeeds and recovers it before revision', async () => {
    const f = await setup({ bufferFloors: 0 })
    try {
      await f.appendMany(3)
      const update = f.storage.records.update.bind(f.storage.records)
      let failDraft = true
      vi.spyOn(f.storage.records, 'update').mockImplementation(async input => {
        if (failDraft && (input.data as { status?: string }).status === 'draft') {
          failDraft = false
          throw new Error('Draft storage unavailable')
        }
        return update(input)
      })
      await f.activity()
      const failed = (await f.batches())[0]
      expect(failed.status).toBe('failed')
      expect(failed.sessionId).toBeTruthy()
      expect(f.acknowledge).not.toHaveBeenCalled()
      f.taskRead.mockResolvedValueOnce({ result: { state: 'completed', text: '恢复的摘要结果' } })
      await f.service.revise(f.target, { id: failed.id, version: failed.version, input: '补充因果' })
      expect(f.acknowledge).toHaveBeenCalledWith(failed.sessionId)
      expect(f.invoke.mock.calls.at(-1)?.[0].input).toContain('恢复的摘要结果')
      expect((await f.batches())[0]).toMatchObject({ status: 'draft', text: '压缩后的事件记忆' })
      expect((await f.batches())[0].sessionId).toBeUndefined()
    } finally { f.engine.close() }
  })

})
