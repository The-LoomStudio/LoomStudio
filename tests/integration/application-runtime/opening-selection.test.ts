import { describe, expect, it } from 'vitest'
import { createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createNarrativeStore, createPromptResourceStore, createStateStore } from '@loom-studio/application-data'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { convertSillyTavernCard } from '../../../extensions/st-data-compat/src/normalizer/card.js'
import { encodeCardBundleZip, decodeCardBundleZip, loadCardBundleFiles } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { callApplicationRpc as handleTimelineRpc } from '../../support/trpc-caller.js'
import { callApplicationRpc as handleCardsRpc } from '../../support/trpc-caller.js'
import { unzipSync } from 'fflate'

describe('opening selection', () => {
  it('imports history as separate ordered nodes with original times and a locked Card association', async () => {
    let sequence = 0
    const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${++sequence}`, now: () => '2026-10-14T00:00:00.000Z' })
    const runtime = createApplicationRuntime({
      dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
      narratives: createNarrativeStore({ engine }), promptResources: createPromptResourceStore({ engine }),
    })
    try {
      const { card } = await runtime.createCard({ name: 'Imported story', opening: { id: 'default', content: 'Not imported' } })
      const messages = [
        { content: 'First message', createdAt: '2026-10-12T01:00:00.000Z' },
        { content: 'Second message', createdAt: '2026-10-13T02:00:00.000Z' },
      ]
      const imported = await handleTimelineRpc(runtime, 'application.importNarrativeHistory', {
        cardId: card.id, title: 'Old chat', messages,
      }) as Awaited<ReturnType<typeof runtime.importNarrativeHistory>>
      const target = { timelineId: imported.timeline.id, branchId: imported.branch.id }
      const page = await runtime.getNarrativePage(target)
      expect(page.nodes.map(node => ({ content: node.body.raw, createdAt: node.createdAt }))).toEqual(messages)
      expect(page.nodes[1]!.parentNodeId).toBe(page.nodes[0]!.id)
      expect(page.branch.headNodeId).toBe(page.nodes[1]!.id)
      expect(page.timeline).toMatchObject({ title: 'Old chat', opening: { locked: true }, createdFrom: { cardId: card.id, cardVersion: card.version } })
      expect(JSON.stringify(page.nodes)).not.toContain('authorId')
      expect((await runtime.listNarrativeTimelines({ createdFromCardId: card.id })).timelines.map(timeline => timeline.id)).toEqual([imported.timeline.id])
      await expect(runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: page.branch.headNodeId!, openingId: 'default' }))
        .rejects.toThrow('opening is locked')
    } finally { await engine.close() }
  })

  it('replaces a single opening without resetting State and persists the input lock across restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-opening-'))
    const filename = join(directory, 'studio.sqlite')
    let sequence = 0
    const createId = (prefix: string) => `${prefix}-${++sequence}`
    const now = () => new Date().toISOString()
    const open = () => {
      const engine = createSqliteDataEngine({ filename, createId, now })
      const narratives = createNarrativeStore({ engine })
      const states = createStateStore({ engine })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }), narratives, states,
        promptResources: createPromptResourceStore({ engine }),
      })
      return { engine, narratives, states, runtime }
    }
    let context = open()
    try {
      const { card } = await context.runtime.createCard({
        name: 'Hero', opening: {
          id: 'default', title: 'Default title', content: 'Default',
          alternatives: [{ id: 'arrival', title: 'Arrival', content: '{{char}} arrives' }],
        },
      })
      const created = await context.runtime.createNarrativeTimeline({ cardId: card.id })
      expect(created.timeline.opening).toEqual({ id: 'default', nodeId: created.nodes[0]!.id, locked: false })
      const target = { timelineId: created.timeline.id, branchId: created.branch.id }
      const scope = await context.states.getScope({ kind: 'timeline', ownerId: target.timelineId })
      const configured = await context.engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        const state = context.states.transaction(tx).createRevision({
          scopeId: scope!.id, parentRevisionId: created.branch.stateHeadRevisionId,
          snapshot: { configured: true }, operations: [],
        })
        return context.narratives.transaction(tx).setBranchStateHead({
          ...target, expectedStateHeadRevisionId: created.branch.stateHeadRevisionId, stateRevisionId: state.revision.id,
        })
      })
      const originalHead = created.branch.headNodeId!
      const selected = await context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: originalHead, openingId: 'arrival' })
      expect(selected.nodes.map(node => node.body.raw)).toEqual(['Hero arrives'])
      expect(selected.branch.stateHeadRevisionId).toBe(configured.value.stateHeadRevisionId)
      expect(selected.nodes.every(node => node.stateRevisionId === configured.value.stateHeadRevisionId)).toBe(true)
      expect((await context.states.getRevision(selected.branch.stateHeadRevisionId))?.snapshot).toEqual({ configured: true })
      await expect(context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: originalHead, openingContent: '' }))
        .rejects.toMatchObject({ code: 'narrative.head_conflict' })
      const edited = await context.runtime.editNarrativeNode({
        ...target, nodeId: selected.nodes[0]!.id, expectedHeadNodeId: selected.branch.headNodeId!,
        expectedRaw: selected.nodes[0]!.body.raw, raw: 'Edited opening',
      })
      expect(edited.timeline.opening).toEqual({ id: 'arrival', nodeId: edited.replacements[0]!.node.id, locked: false, custom: true })
      expect(edited.branch.stateHeadRevisionId).toBe(configured.value.stateHeadRevisionId)
      const head = edited.branch.headNodeId!
      await expect(context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: head, openingId: 'default', openingContent: '' }))
        .rejects.toThrow('not both')
      await expect(context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: head, openingId: 'missing' }))
        .rejects.toThrow('Opening not found')
      await expect(context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: head, expectedCardVersion: card.version + 1 }))
        .rejects.toThrow('Card changed')
      const blank = await context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: head, openingContent: '' })
      expect(blank.nodes).toEqual([])
      expect(blank.timeline.opening).toEqual({ locked: false })
      expect(blank.timeline.openingPreview).toBeUndefined()
      expect(blank.branch.stateHeadRevisionId).toBe(configured.value.stateHeadRevisionId)
      context.engine.close()
      context = open()
      expect((await context.runtime.getNarrativeTimeline(target)).timeline.opening).toEqual({ locked: false })
      const custom = await handleTimelineRpc(context.runtime, 'application.replaceNarrativeOpening', {
        ...target, expectedHeadNodeId: null, openingContent: 'Custom {{char}}',
      }) as Awaited<ReturnType<typeof context.runtime.replaceNarrativeOpening>>
      expect(custom.nodes[0]).toMatchObject({ body: { raw: 'Custom {{char}}' } })
      const identity = await context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: custom.branch.headNodeId!, openingId: 'arrival' })
      const archive = (await context.runtime.exportTimelineArchive(target)).archive
      const imported = await context.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      expect((await context.runtime.getNarrativeTimeline({ timelineId: imported.timelineId })).timeline.opening).toMatchObject({ id: 'arrival', locked: true, nodeId: expect.any(String) })
      await expect(context.runtime.appendNarrativeInput({ ...target, nodeId: 'failed-input', expectedHeadNodeId: null, content: 'Go' }))
        .rejects.toMatchObject({ code: 'narrative.head_conflict' })
      expect((await context.runtime.getNarrativeTimeline(target)).timeline.opening).toBeDefined()
      const input = { ...target, nodeId: 'first-input', expectedHeadNodeId: identity.branch.headNodeId!, content: 'Go' }
      const appended = await context.runtime.appendNarrativeInput(input)
      expect(appended.timeline.opening).toEqual({ id: 'arrival', nodeId: identity.nodes[0]!.id, locked: true })
      // No Agent request is needed to close the window; replay cannot reopen it.
      expect((await context.runtime.appendNarrativeInput(input)).timeline.opening).toEqual(appended.timeline.opening)
      context.engine.close()
      context = open()
      expect((await context.runtime.getNarrativeTimeline(target)).timeline.opening).toEqual(appended.timeline.opening)
      await expect(context.runtime.replaceNarrativeOpening({ ...target, expectedHeadNodeId: 'first-input', openingId: 'default' }))
        .rejects.toThrow('opening is locked')
    } finally {
      context.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves ST alternatives through ZIP and directory loading', async () => {
    const { artifact } = convertSillyTavernCard({
      spec: 'chara_card_v2', spec_version: '2.0',
      data: { name: 'Hero', first_mes: 'Default', alternate_greetings: ['Forest', 'Harbor'] },
    })
    expect(artifact.card.opening).toMatchObject({ content: 'Default',
      alternatives: [{ content: 'Forest' }, { content: 'Harbor' }],
    })
    artifact.card.opening = { id: 'default', title: 'Default title', content: 'Default', alternatives: [
      { id: 'forest', title: 'Forest title', content: 'Forest' },
      { id: 'harbor', title: 'Harbor title', content: 'Harbor' },
    ] }
    const archive = encodeCardBundleZip({ artifact, avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' } })
    const files = unzipSync(archive)
    expect(Buffer.from(files['opening/alternatives/1.md']!).toString()).toBe('Harbor')
    const decoded = await decodeCardBundleZip(archive)
    const loaded = await loadCardBundleFiles(async path => files[path]!)
    for (const card of [decoded.artifact.card, loaded.bundle.artifact.card]) {
      expect(card.opening).toEqual({
        id: 'default', title: 'Default title', content: 'Default',
        alternatives: [
          { id: 'forest', title: 'Forest title', content: 'Forest' },
          { id: 'harbor', title: 'Harbor title', content: 'Harbor' },
        ],
      })
    }
  })

  it('initializes only the selected opening, custom text or an explicitly empty opening', async () => {
    let sequence = 0
    const createId = (prefix: string) => `${prefix}-${++sequence}`
    const now = () => new Date().toISOString()
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const runtime = createApplicationRuntime({
      dataEngine: engine, documents,
      narratives: createNarrativeStore({ engine, createId, now }),
      promptResources: createPromptResourceStore({ engine, createId, now }),
    })
    try {
      await runtime.createUserProfile({ expectedVersion: 0, name: 'Player' })
      const created = await runtime.createCard({
        name: 'Hero', userName: 'Author', opening: {
          id: 'default', title: 'Default title', content: 'Default',
          alternatives: [{ id: 'meeting', title: 'Meeting', content: '{{char}} meets {{user}}' }, { id: 'harbor', title: 'Harbor', content: 'Harbor' }],
        },
      })
      const cardId = created.card.id
      const selected = await runtime.createNarrativeTimeline({ cardId, openingId: 'meeting' })
      expect(selected.nodes.map(node => node.body.raw)).toEqual(['Hero meets Player'])
      const defaults = await runtime.createNarrativeTimeline({ cardId })
      expect(defaults.nodes.map(node => node.body.raw)).toEqual(['Default'])
      const custom = await runtime.createNarrativeTimeline({ cardId, openingContent: 'My own start' })
      expect(custom.nodes.map(node => node.body.raw)).toEqual(['My own start'])
      const empty = await runtime.createNarrativeTimeline({ cardId, openingContent: '' })
      expect(empty.nodes).toEqual([])
      await expect(runtime.createNarrativeTimeline({ cardId, openingId: 'missing' })).rejects.toThrow('Opening not found')
      await expect(runtime.createNarrativeTimeline({ cardId, openingId: 'default', openingContent: '' })).rejects.toThrow('not both')
      await handleTimelineRpc(runtime, 'application.createNarrativeTimeline', { cardId, openingId: 'meeting' })
      await expect(handleTimelineRpc(runtime, 'application.createNarrativeTimeline', { cardId, openingContent: 42 }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', cause: { issues: [{ code: 'invalid_type', path: ['openingContent'], expected: 'string' }] } })
      await expect(handleCardsRpc(runtime, 'application.updateCard', {
        cardId, opening: { content: '', alternatives: [{ title: 'Missing content' }] },
      })).rejects.toThrow('Expected single opening content')
      await handleCardsRpc(runtime, 'application.updateCard', {
        cardId, expectedVersion: created.card.version,
        opening: { id: 'default', content: 'Changed default', alternatives: [{ id: 'harbor', title: 'Renamed harbor', content: 'Harbor' }, { id: 'meeting', title: 'Renamed meeting', content: 'Changed alternative' }] },
      })
      expect((await runtime.getCard({ cardId })).card.opening.alternatives?.[1]?.content).toBe('Changed alternative')
      await expect(runtime.createNarrativeTimeline({ cardId, openingId: 'meeting', expectedCardVersion: created.card.version }))
        .rejects.toThrow('Card changed while choosing an opening')
      expect((await runtime.getNarrativePage({ timelineId: selected.timeline.id })).nodes.map(node => node.body.raw))
        .toEqual(['Hero meets Player'])
      const reordered = await runtime.createNarrativeTimeline({ cardId, openingId: 'meeting' })
      expect(reordered.nodes.map(node => node.body.raw)).toEqual(['Changed alternative'])
      expect(reordered.timeline.opening).toEqual({ id: 'meeting', nodeId: reordered.nodes[0]!.id, locked: false })
      const exported = await runtime.exportCardBundle({ cardId })
      expect((exported.artifact as CardBundleArtifact).card.opening).toMatchObject({
        alternatives: [{ id: 'harbor', title: 'Renamed harbor', content: 'Harbor' }, { id: 'meeting', title: 'Renamed meeting', content: 'Changed alternative' }],
      })
    } finally {
      await engine.close()
    }
  })
})
