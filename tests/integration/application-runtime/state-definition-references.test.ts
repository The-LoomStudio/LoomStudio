import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

const definitionId = 'template.health'
const template = {
  kind: 'timeline-template' as const,
  templateVersion: 1,
  schema: { type: 'object', properties: { hp: { type: 'number', minimum: 0 } }, required: ['hp'] },
  initial: { hp: 10 },
}

function fixture() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-09-23T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents,
    narratives: createNarrativeStore({ engine, createId, now }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
  })
  return { engine, runtime }
}

describe('State Definition dangling references', () => {
  it.each([false, true])('preserves Card references and existing State after deletion (inline template: %s)', async inline => {
    const { engine, runtime } = fixture()
    try {
      const { definition } = await runtime.upsertStateDefinition({ definitionId, definition: template })
      const { card } = await runtime.createCard({ name: 'State reference control' })
      await runtime.updateCard({
        cardId: card.id,
        stateDefinitionIds: [definitionId],
        timelineStateBindings: [{ path: 'hero', templateId: definitionId, templateVersion: 1 }],
        ...(inline ? { stateTemplates: [{ id: definitionId, ...template, initial: { hp: 20 } }] } : {}),
      })
      const cardBefore = await runtime.getCard({ cardId: card.id })
      expect(cardBefore.card.stateDefinitionIds).toEqual([definitionId])
      expect(cardBefore.card.timelineStateBindings).toEqual([{ path: 'hero', templateId: definitionId, templateVersion: 1 }])
      const created = await runtime.createNarrativeTimeline({ cardId: card.id })
      const target = { scope: 'timeline' as const, timelineId: created.timeline.id, branchId: created.branch.id }
      const before = await runtime.getStateSnapshot({ target })
      expect(before.snapshot.value).toEqual({ hero: { hp: inline ? 20 : 10 } })
      const pageBefore = await runtime.getNarrativePage({ timelineId: created.timeline.id, branchId: created.branch.id })

      await expect(runtime.deleteStateDefinition({ definitionId, expectedVersion: definition.version })).resolves.toMatchObject({ deleted: true })
      await expect(runtime.getStateDefinition({ definitionId })).rejects.toThrow(`Document not found: ${definitionId}`)
      expect((await runtime.listStateDefinitions()).definitions).toEqual([])
      expect(await runtime.getCard({ cardId: card.id })).toEqual(cardBefore)
      expect(await runtime.getStateSnapshot({ target })).toEqual(before)
      expect(await runtime.getNarrativePage({ timelineId: created.timeline.id, branchId: created.branch.id })).toEqual(pageBefore)

      await expect(runtime.applyStateMutation({
        target, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/hero/hp', value: 'invalid' }],
      })).rejects.toMatchObject({ code: 'state.schema_type' })
      const changed = await runtime.applyStateMutation({
        target, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/hero/hp', value: 7 }],
      })
      expect(changed.snapshot.value).toEqual({ hero: { hp: 7 } })
      await expect(runtime.applyStateMutation({
        target, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/hero/hp', value: 8 }],
      })).rejects.toMatchObject({ code: 'state.head_conflict' })
      expect((await runtime.getStateSnapshot({ target })).snapshot).toEqual(changed.snapshot)

      if (inline) {
        const next = await runtime.createNarrativeTimeline({ cardId: card.id })
        await expect(runtime.getStateSnapshot({
          target: { scope: 'timeline', timelineId: next.timeline.id, branchId: next.branch.id },
        })).resolves.toMatchObject({ snapshot: { value: { hero: { hp: 20 } } } })
      } else {
        const timelinesBefore = await runtime.listNarrativeTimelines()
        await expect(runtime.createNarrativeTimeline({ cardId: card.id }))
          .rejects.toMatchObject({ code: 'state.template_not_found' })
        expect(await runtime.listNarrativeTimelines()).toEqual(timelinesBefore)
        expect((await runtime.getStateSnapshot({ target })).snapshot).toEqual(changed.snapshot)
      }
    } finally { await engine.close() }
  })

  it('rejects deletion with a stale definition version without deleting the current definition', async () => {
    const { engine, runtime } = fixture()
    try {
      const first = await runtime.upsertStateDefinition({ definitionId, definition: template })
      const current = await runtime.upsertStateDefinition({
        definitionId, expectedVersion: first.definition.version, definition: { ...template, label: 'Updated' },
      })
      await expect(runtime.deleteStateDefinition({ definitionId, expectedVersion: first.definition.version }))
        .rejects.toThrow(`State Definition version conflict: ${definitionId}`)
      expect((await runtime.getStateDefinition({ definitionId })).definition).toEqual(current.definition)
      await expect(runtime.deleteStateDefinition({ definitionId, expectedVersion: current.definition.version }))
        .resolves.toMatchObject({ deleted: true })
    } finally { await engine.close() }
  })
})
