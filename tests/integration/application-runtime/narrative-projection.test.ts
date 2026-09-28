import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime, composeAgentTurnPrompt } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

async function fixture(count = 3) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-24T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
    narratives, promptResources, agents: createAgentStore({ engine, createId, now }),
  })
  const created = await narratives.createTimeline({
    actor: { kind: 'system', id: 'test' }, stateRevisionId: 'initial',
    openingNodes: Array.from({ length: count }, (_, index) => ({
      body: { format: 'loom-markdown.v1' as const, raw: `RAW ${index + 1} {{timeline.value}}` },
    })),
  })
  const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Consumer' })
  return { engine, runtime, narratives, promptResources, preset, ...created }
}

describe('shared Narrative projection', () => {
  it('uses current card rules in every phase without changing State or raw history', async () => {
    const f = await fixture(1)
    try {
      const { card } = await f.runtime.createCard({ name: 'Live display' })
      await f.runtime.updateCard({ cardId: card.id, opening: { entries: [{ content: 'RAW' }] } })
      const draft = {
        name: 'Card rule', owner: { kind: 'card' as const, cardId: card.id }, enabled: true, orderIndex: 0,
        matcher: { kind: 'regex' as const, pattern: 'RAW', flags: 'g' },
        effect: { kind: 'replace' as const, replacement: 'OLD' },
        targets: ['narrative' as const], phases: ['display' as const, 'prompt' as const, 'classify' as const],
      }
      const first = await f.runtime.upsertTextTransformRule({ ruleId: 'live-card', rule: draft })
      const created = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const source = { kind: 'narrative' as const, timelineId: created.timeline.id, branchId: created.branch.id }
      const stateTarget = { scope: 'timeline' as const, timelineId: created.timeline.id, branchId: created.branch.id }
      const initialState = await f.runtime.getStateSnapshot({ target: stateTarget })
      const project = async (phase: 'display' | 'classify') =>
        (await f.runtime.projectHistory({ source, phase })).snapshot
      const prompt = async () => (await f.runtime.sampleNarrative({
        timelineId: source.timelineId, branchId: source.branchId,
        selection: { kind: 'tail', count: 1 }, processing: { phase: 'prompt', presetId: f.preset.id },
      })).text
      expect((await project('display')).entries[0]?.text).toBe('OLD')
      const saved = await f.runtime.upsertTextTransformRule({
        ruleId: 'live-card', expectedVersion: first.rule.version,
        rule: { ...draft, effect: { kind: 'replace', replacement: 'NEW RAW' } },
      })
      expect((await project('display')).entries[0]).toMatchObject({ text: 'NEW RAW', originalText: 'RAW', appliedRuleIds: ['live-card'] })
      expect(await prompt()).toBe('NEW RAW')
      expect((await project('classify')).entries[0]?.text).toBe('NEW RAW')
      const override = await f.runtime.upsertTextPipelineOverride({ source, phase: 'display', disabledRuleIds: ['live-card'], orderedRuleIds: [] })
      expect((await project('display')).entries[0]?.text).toBe('RAW')
      await f.runtime.upsertTextPipelineOverride({ source, phase: 'display', expectedVersion: override.override.version, disabledRuleIds: [], orderedRuleIds: [] })
      const disabled = await f.runtime.upsertTextTransformRule({
        ruleId: 'live-card', expectedVersion: saved.rule.version, rule: { ...draft, enabled: false },
      })
      expect((await project('display')).entries[0]?.text).toBe('RAW')
      expect(await prompt()).toBe('RAW')
      expect((await project('classify')).entries[0]?.text).toBe('RAW')
      await f.runtime.deleteTextTransformRule({ ruleId: 'live-card', expectedVersion: disabled.rule.version })
      expect((await project('display')).entries[0]?.text).toBe('RAW')
      expect(await prompt()).toBe('RAW')
      expect((await project('classify')).entries[0]?.text).toBe('RAW')
      await f.runtime.upsertTextTransformRule({
        ruleId: 'new-card-rule', rule: { ...draft, effect: { kind: 'replace', replacement: 'ADDED' } },
      })
      expect((await project('display')).entries[0]?.text).toBe('ADDED')
      expect(await prompt()).toBe('ADDED')
      expect((await project('classify')).entries[0]?.text).toBe('ADDED')
      expect((await f.narratives.getPage({ timelineId: source.timelineId, branchId: source.branchId, limit: 10 })).nodes[0]?.body.raw).toBe('RAW')
      expect(await f.runtime.getStateSnapshot({ target: stateTarget })).toEqual(initialState)
    } finally { f.engine.close() }
  })

  it('uses current extractors after a Timeline was created, including removal', async () => {
    const f = await fixture(1)
    try {
      const { card } = await f.runtime.createCard({ name: 'Live extraction' })
      const draft = {
        name: 'Clothes', owner: { kind: 'card' as const, cardId: card.id }, enabled: true, orderIndex: 0,
        targets: ['narrative' as const], matcher: { kind: 'regex' as const, pattern: '<clothes>(.*?)</clothes>', flags: 'g', contentGroup: 1 },
        strategy: 'latest-valid' as const, parser: 'key-value-lines' as const,
      }
      const { extractor } = await f.runtime.upsertTextExtractor({ extractorId: 'clothes', extractor: draft })
      const { timeline, branch } = await f.runtime.createNarrativeTimeline({
        cardId: card.id, openingNodes: [{ content: '<clothes>color: blue</clothes>' }],
      })
      const inspect = () => f.runtime.inspectTextPipeline({
        source: { kind: 'narrative', timelineId: timeline.id, branchId: branch.id }, phase: 'display',
      })
      expect((await inspect()).extractors.map(item => item.id)).toEqual(['clothes'])
      const updated = await f.runtime.upsertTextExtractor({
        extractorId: extractor.id, expectedVersion: extractor.version,
        extractor: { ...draft, name: 'Current clothes' },
      })
      expect((await inspect()).extractors).toMatchObject([{ name: 'Current clothes', version: updated.extractor.version }])
      await f.runtime.deleteTextExtractor({ extractorId: extractor.id, expectedVersion: updated.extractor.version })
      expect((await inspect()).extractors).toEqual([])
    } finally { await f.engine.close() }
  })

  it('processes a range without a Session and shares ordered rules with Prompt composition', async () => {
    const f = await fixture()
    try {
      for (const [ruleId, pattern, replacement, orderIndex] of [
        ['finish', 'MID', 'FINAL', 0],
        ['start', 'RAW', 'MID', 1],
      ] as const) {
        await f.runtime.upsertTextTransformRule({
          ruleId, rule: {
            name: ruleId, owner: { kind: 'preset', presetId: f.preset.id }, enabled: true, orderIndex,
            matcher: { kind: 'regex', pattern, flags: 'g' }, effect: { kind: 'replace', replacement },
            targets: ['narrative'], phases: ['prompt'],
          },
        })
      }
      const source = { kind: 'narrative' as const, timelineId: f.timeline.id, branchId: f.branch.id }
      await f.runtime.upsertTextPipelineOverride({
        source, phase: 'prompt', disabledRuleIds: [], orderedRuleIds: ['start', 'finish'],
      })
      const request = {
        timelineId: f.timeline.id, branchId: f.branch.id,
        selection: { kind: 'tail' as const, count: 2 },
      }
      const raw = await f.runtime.sampleNarrative(request)
      const processed = await f.runtime.sampleNarrative({
        ...request, processing: { phase: 'prompt', presetId: f.preset.id },
      })
      expect(raw.text).toBe('RAW 2 {{timeline.value}}\n\nRAW 3 {{timeline.value}}')
      expect(processed.text).toBe('FINAL 2 {{timeline.value}}\n\nFINAL 3 {{timeline.value}}')
      expect(processed.nodes.map(node => node.body.raw)).toEqual(raw.nodes.map(node => node.body.raw))
      expect(processed.processing?.rules.map(rule => rule.id)).toEqual(['start', 'finish'])
      const { rules } = await f.runtime.listTextTransformRules()
      const prompt = await composeAgentTurnPrompt({
        preset: f.preset, promptResources: f.promptResources, agentMessages: [], userInput: 'INPUT',
        contextResourceIds: [],
        narrative: { timeline: f.timeline, branchId: f.branch.id, nodes: raw.nodes },
        historyRules: { narrative: ['start', 'finish'].map(id => rules.find(rule => rule.id === id)!), session: [] },
      })
      const narrativeText = prompt.messages.filter(message =>
        'fragmentIds' in message && (message.fragmentIds as string[]).some(id => id.startsWith('runtime.narrative:')),
      ).map(message => message.content).join('\n\n')
      expect(narrativeText).toBe(processed.text)
      expect((await f.runtime.listAgentSessions()).sessions).toEqual([])
      expect((await f.narratives.getNode(f.nodes[1]!.id))!.body.raw).toBe('RAW 2 {{timeline.value}}')
      const other = await f.runtime.createPromptResource({ resourceKind: 'preset', name: 'Other' })
      expect((await f.runtime.sampleNarrative({
        ...request, processing: { phase: 'prompt', presetId: other.resource.id },
      })).text).toBe(raw.text)
      await expect(f.runtime.sampleNarrative({
        ...request, processing: { phase: 'prompt', presetId: 'missing' },
      })).rejects.toThrow(/Preset not found/)
      await expect(f.runtime.sampleNarrative({
        ...request, processing: { phase: 'prompt', presetId: f.preset.id, consumerAgentSessionId: 'other' },
      })).rejects.toThrow(/mutually exclusive/)
    } finally { f.engine.close() }
  })

  it('preserves chronological order across history pages and matches raw sampling', async () => {
    const f = await fixture(205)
    try {
      const snapshot = (await f.runtime.projectHistory({
        source: { kind: 'narrative', timelineId: f.timeline.id, branchId: f.branch.id }, phase: 'display',
      })).snapshot
      const sample = await f.runtime.sampleNarrative({
        timelineId: f.timeline.id, selection: { kind: 'tail', count: 205 },
      })
      expect(snapshot.entries.map(entry => entry.id)).toEqual(f.nodes.map(node => node.id))
      expect(snapshot.entries.map(entry => entry.text)).toEqual(sample.nodes.map(node => node.body.raw))
      expect(snapshot.entries[0]!.depth).toBe(204)
      expect(snapshot.entries.at(-1)!.depth).toBe(0)
    } finally { f.engine.close() }
  })

  it('enforces processed-output budgets without changing canonical text', async () => {
    const f = await fixture(1)
    try {
      await f.runtime.upsertTextTransformRule({
        ruleId: 'expand', rule: {
          name: 'expand', owner: { kind: 'preset', presetId: f.preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'RAW', flags: 'g' },
          effect: { kind: 'replace', replacement: 'x'.repeat(100) }, targets: ['narrative'], phases: ['prompt'],
        },
      })
      await expect(f.runtime.sampleNarrative({
        timelineId: f.timeline.id, selection: { kind: 'tail', count: 1 }, maxCharacters: 50,
        processing: { phase: 'prompt', presetId: f.preset.id },
      })).rejects.toThrow(/output budget exceeded/)
      expect((await f.narratives.getNode(f.nodes[0]!.id))!.body.raw).toContain('RAW')
    } finally { f.engine.close() }
  })
})
