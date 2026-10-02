import { createNarrativeStore, createPromptResourceStore, createAgentStore } from '@loom-studio/application-data'
import { createApplicationRuntime, type HistorySource, type TextTransformRuleDraft } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it, vi } from 'vitest'

function fixture() {
  let next = 0
  const engine = createSqliteDataEngine({
    filename: ':memory:', createId: prefix => `${prefix}-${++next}`, now: () => '2026-10-02T00:00:00.000Z',
  })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const agents = createAgentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, agents, promptResources })
  return { engine, documents, narratives, agents, runtime }
}

const rule: TextTransformRuleDraft = {
  name: 'Depth boundary', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
  matcher: { kind: 'regex', pattern: 'raw', flags: 'g' },
  effect: { kind: 'replace', replacement: 'display' },
  targets: ['narrative', 'agent-session'], phases: ['display'], range: { minDepth: 1, maxDepth: 2 },
}
const actor = { kind: 'system' as const, id: 'test' }

describe('API history and directory subsets', () => {
  it('preserves complete Narrative depth, sequence and match positions across pages and edits', async () => {
    const f = fixture()
    try {
      await f.runtime.upsertTextTransformRule({ ruleId: 'depth', rule })
      const created = await f.narratives.createTimeline({
        actor, stateRevisionId: 'state',
        openingNodes: Array.from({ length: 220 }, (_, index) => ({
          id: `node-${index}`, body: { format: 'loom-markdown.v1', raw: `raw ${index}` },
        })),
      })
      const source: HistorySource = { kind: 'narrative', timelineId: created.timeline.id, branchId: created.branch.id }
      const full = (await f.runtime.projectHistory({ source, phase: 'display' })).snapshot
      const entryIds = ['node-219', 'node-217', 'node-0', 'node-217', 'missing']
      const subset = (await f.runtime.projectHistory({ source, phase: 'display', entryIds })).snapshot
      expect(subset).toEqual({
        ...full,
        entries: full.entries.filter(entry => entryIds.includes(entry.id)),
        matches: full.matches.filter(match => entryIds.includes(match.entryId)),
      })
      expect(subset.entries.map(entry => [entry.id, entry.depth, entry.sequence, entry.text])).toEqual([
        ['node-0', 219, 1, 'raw 0'],
        ['node-217', 2, 218, 'display 217'],
        ['node-219', 0, 220, 'raw 219'],
      ])
      expect(subset.matches).toHaveLength(1)
      expect(subset.matches[0]).toMatchObject({ inputRange: { start: 0, end: 3 }, depth: 2 })
      const empty = (await f.runtime.projectHistory({ source, phase: 'display', entryIds: [] })).snapshot
      expect(empty.entries).toEqual([])
      expect(empty.matches).toEqual([])
      await f.narratives.editNode({
        actor, timelineId: source.timelineId, nodeId: 'node-217',
        body: { format: 'loom-markdown.v1', raw: 'edited' },
      })
      const edited = (await f.runtime.projectHistory({ source, phase: 'display', entryIds: ['node-217'] })).snapshot
      expect(edited.entries).toMatchObject([{ id: 'node-217', originalText: 'edited', text: 'edited', depth: 2, sequence: 218 }])
      const replaced = await f.narratives.editBranchNode({
        actor, timelineId: source.timelineId, branchId: source.branchId, nodeId: 'node-217',
        expectedHeadNodeId: created.branch.headNodeId!,
        expectedBody: { format: 'loom-markdown.v1', raw: 'edited' },
        body: { format: 'loom-markdown.v1', raw: 'replacement raw' },
      })
      expect((await f.runtime.projectHistory({ source, phase: 'display', entryIds: ['node-217'] })).snapshot.entries).toEqual([])
      const replacementIds = replaced.replacements.map(item => item.node.id)
      const replacementFull = (await f.runtime.projectHistory({ source, phase: 'display' })).snapshot
      const replacementSubset = (await f.runtime.projectHistory({ source, phase: 'display', entryIds: replacementIds })).snapshot
      expect(replacementSubset.entries).toEqual(replacementFull.entries.filter(entry => replacementIds.includes(entry.id)))
      expect(replacementSubset.entries[0]).toMatchObject({ originalText: 'replacement raw', text: 'replacement display', depth: 2 })
    } finally {
      await f.engine.close()
    }
  })

  it('keeps fixed-Head Session semantics and bounds response bytes when N grows with K fixed', async () => {
    const f = fixture()
    try {
      await f.runtime.upsertTextTransformRule({
        ruleId: 'all', rule: { ...rule, range: undefined },
      })
      const session = (await f.agents.createSession({ actor, agentPresetId: 'preset' })).session
      const content = `raw ${'x'.repeat(1000)}`
      const appended = await f.agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 0,
        entries: Array.from({ length: 20 }, () => ({ runId: 'run', entry: { kind: 'message' as const, role: 'assistant' as const, content } })),
      })
      const entryIds = appended.entries.slice(0, 2).map(entry => entry.id)
      const source: HistorySource = { kind: 'agent-session', sessionId: session.id }
      const fixedSource = { ...source, headEntryId: appended.entries.at(-1)!.id }
      const before = (await f.runtime.projectHistory({ source, phase: 'display', entryIds })).snapshot
      const fixed = (await f.runtime.projectHistory({ source: fixedSource, phase: 'display', entryIds })).snapshot
      await f.agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 20,
        entries: Array.from({ length: 200 }, () => ({ runId: 'run', entry: { kind: 'message' as const, role: 'assistant' as const, content } })),
      })
      const after = (await f.runtime.projectHistory({ source, phase: 'display', entryIds })).snapshot
      const full = (await f.runtime.projectHistory({ source, phase: 'display' })).snapshot
      expect(after.entries).toEqual(full.entries.filter(entry => entryIds.includes(entry.id)))
      expect(after.matches).toEqual(full.matches.filter(match => entryIds.includes(match.entryId)))
      expect(after.entries.map(entry => entry.depth)).toEqual([219, 218])
      expect(JSON.stringify(after).length).toBeLessThan(JSON.stringify(before).length + 100)
      expect(JSON.stringify(full).length).toBeGreaterThan(JSON.stringify(after).length * 50)
      expect((await f.runtime.projectHistory({ source: fixedSource, phase: 'display', entryIds })).snapshot).toEqual(fixed)
    } finally {
      await f.engine.close()
    }
  })

  it('filters authoritative documents before decoding, with isolation, stable order, tombstones and empty IDs', async () => {
    const f = fixture()
    try {
      const own = await f.runtime.upsertTextTransformRule({ ruleId: 'own', rule: { ...rule, owner: { kind: 'card', cardId: 'a' } } })
      const first = await f.runtime.upsertStateDefinition({
        definitionId: 'first', definition: { kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: {} },
      })
      const second = await f.runtime.upsertStateDefinition({
        definitionId: 'second', definition: { kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: {} },
      })
      const deleted = await f.runtime.upsertStateDefinition({
        definitionId: 'deleted', definition: { kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: {} },
      })
      await f.runtime.deleteStateDefinition({ definitionId: deleted.definition.id })
      const beforeRules = await f.runtime.listTextTransformRules({ owner: { kind: 'card', cardId: 'a' } })
      const ids = ['second', 'first', 'first', 'missing', 'deleted', 'own']
      const beforeStates = await f.runtime.listStateDefinitions({ ids })
      await f.documents.transact({ actor }, async tx => {
        for (let index = 0; index < 220; index++) {
          await tx.write({
            id: `other-rule-${index}`, type: 'airp.textTransformRule', expectedVersion: 'new',
            content: { ...rule, owner: { kind: 'card', cardId: 'b' }, name: 'x'.repeat(1000) },
          })
          await tx.write({
            id: `other-state-${index}`, type: 'airp.stateDefinition', expectedVersion: 'new',
            content: { kind: 'global', path: `global.other${index}`, schema: { description: 'x'.repeat(1000) } },
          })
        }
      })
      const parse = vi.spyOn(JSON, 'parse')
      const get = vi.spyOn(f.documents, 'get')
      const list = vi.spyOn(f.documents, 'list')
      const read = vi.spyOn(f.engine, 'read')
      try {
        expect(await f.runtime.listTextTransformRules({ owner: { kind: 'card', cardId: 'a' } })).toEqual({ rules: [own.rule] })
        expect(parse).toHaveBeenCalledTimes(1)
        expect(read).toHaveBeenCalledTimes(1)
        parse.mockClear()
        read.mockClear()
        expect(await f.runtime.listStateDefinitions({ ids })).toEqual({ definitions: [first.definition, second.definition] })
        expect(parse).toHaveBeenCalledTimes(2)
        expect(read).toHaveBeenCalledTimes(1)
        parse.mockClear()
        read.mockClear()
        expect(await f.runtime.listStateDefinitions({ ids: [] })).toEqual({ definitions: [] })
        expect(parse).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
        expect(get).not.toHaveBeenCalled()
        expect(list).not.toHaveBeenCalled()
      } finally {
        parse.mockRestore()
        get.mockRestore()
        list.mockRestore()
        read.mockRestore()
      }
      expect(await f.runtime.listTextTransformRules({ owner: { kind: 'card', cardId: 'a' } })).toEqual(beforeRules)
      expect(await f.runtime.listStateDefinitions({ ids })).toEqual(beforeStates)
      expect((await f.runtime.listStateDefinitions({ ids, kind: 'global' })).definitions).toEqual([])
      expect((await f.runtime.listStateDefinitions()).definitions).toHaveLength(222)
      expect((await f.runtime.listTextTransformRules()).rules).toHaveLength(221)
      expect((await f.runtime.listTextTransformRules({ owner: { kind: 'card', cardId: 'missing' } })).rules).toEqual([])
    } finally {
      await f.engine.close()
    }
  })
})
