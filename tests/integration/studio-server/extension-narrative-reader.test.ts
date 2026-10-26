import { expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createExtensionNarrativeReader } from '../../../apps/studio-server/src/extensions/extension-narrative-reader.js'

it('binds source validity to its exact path and text, not later activity or caller-supplied targets', async () => {
  const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
  const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
  try {
    const narratives = createNarrativeStore({ engine, ...clock })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
      narratives, promptResources: createPromptResourceStore({ engine, ...clock }) })
    const { card } = await runtime.createCard({ name: 'Source' })
    const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
    const target = { timelineId: timeline.id, branchId: branch.id }
    const activity: string[] = []
    runtime.subscribeNarrativeActivity(event => { activity.push(event.kind) })
    const a = await runtime.appendNarrativeInput({ ...target, nodeId: 'a', content: '城池尚存', expectedHeadNodeId: branch.headNodeId ?? null })
    const reader = createExtensionNarrativeReader(runtime, narratives)
    const sample = await reader.read(target, { selection: { kind: 'tail', count: 1 },
      ...{ timelineId: 'foreign', branchId: 'foreign' } })
    expect(sample.nodes.map(node => node.id)).toEqual([a.node.id])
    const b = await runtime.appendNarrativeInput({ ...target, nodeId: 'b', content: '前往城池', expectedHeadNodeId: a.node.id })
    expect(activity).toEqual(['changed', 'input', 'changed', 'input'])
    await expect(reader.validate(target, sample.source)).resolves.toBe(true)
    await expect(reader.validate({ ...target, branchId: 'other' }, sample.source)).resolves.toBe(false)
    await runtime.editNarrativeNode({ ...target, nodeId: a.node.id, expectedHeadNodeId: b.node.id,
      expectedRaw: '城池尚存', raw: '城池已毁' })
    await expect(reader.validate(target, sample.source)).resolves.toBe(false)
    const controller = new AbortController(); controller.abort()
    await expect(reader.read(target, { selection: { kind: 'tail', count: 1 } }, controller.signal)).rejects.toThrow()
  } finally { engine.close() }
})
