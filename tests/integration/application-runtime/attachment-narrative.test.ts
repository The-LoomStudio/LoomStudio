import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import type { ChatAttachment } from '@loom-studio/shared'
import { expect, it, onTestFinished } from 'vitest'

it('preserves image-only Narrative attachments in canonical entries after text edits and branch suffix copies', async () => {
  let sequence = 0
  const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${++sequence}`, now: () => '2026-11-02T00:00:00.000Z' })
  onTestFinished(() => engine.close())
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const attachment: ChatAttachment = { assetId: 'picture-1', name: 'picture.png', kind: 'image', mediaType: 'image/png', sizeBytes: 12 }
  const runtime = createApplicationRuntime({ dataEngine: engine, agents, narratives,
    documents: createSqliteDocumentStore({ engine }), promptResources: createPromptResourceStore({ engine }),
    mediaAssets: { get: async id => ({ id, kind: 'session-attachment', mediaType: 'image/png', sizeBytes: 12 }), read: async () => new Uint8Array(12) },
  })
  const { card } = await runtime.createCard({ name: 'Attachments' })
  const story = await runtime.createNarrativeTimeline({ cardId: card.id })
  const target = { timelineId: story.timeline.id, branchId: story.branch.id }
  const first = await runtime.appendNarrativeInput({ ...target, nodeId: 'picture-input', expectedHeadNodeId: null, content: '', attachments: [attachment] })
  expect(first.node.body.raw).toBe('')
  expect((await agents.getEntry(first.node.entryId!))?.entry).toMatchObject({ role: 'user', content: '', attachments: [attachment] })
  const next = await runtime.appendNarrativeInput({ ...target, nodeId: 'following-picture', expectedHeadNodeId: first.node.id, content: 'Following picture', attachments: [attachment] })
  const fork = await runtime.forkNarrativeBranch({ timelineId: target.timelineId, fromBranchId: target.branchId, fromNodeId: next.node.id })
  const edited = await runtime.editNarrativeNode({ timelineId: target.timelineId, branchId: fork.branch.id, nodeId: first.node.id, expectedHeadNodeId: next.node.id, expectedRaw: '', raw: 'Caption added' })
  const copied = await narratives.getPage({ timelineId: target.timelineId, branchId: edited.branch.id, limit: 10 })
  expect(copied.nodes.map(node => node.body.raw)).toEqual(['Caption added', 'Following picture'])
  for (const node of copied.nodes) {
    expect((await agents.getEntry(node.entryId!))?.entry).toMatchObject({ role: 'user', content: node.body.raw, attachments: [attachment] })
  }
  expect((await narratives.getNode(first.node.id))?.body.raw).toBe('')
  const legacyEdit = await narratives.editNode({ actor: { kind: 'system', id: 'test' }, timelineId: target.timelineId, nodeId: first.node.id, body: { format: 'loom-markdown.v1', raw: 'Original branch caption' } })
  expect((await agents.getEntry(legacyEdit.node.entryId!))?.entry).toMatchObject({ content: 'Original branch caption', attachments: [attachment] })
})
