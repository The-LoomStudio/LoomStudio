import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import {
  createAgentToolRegistry,
  createApplicationRuntime,
  createNarrativeContextRegistry,
  type NarrativeContextProjection,
  type ToolDefinition,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso, type ChatMessage } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
import { handleAgentsRpc } from '../../../apps/studio-server/src/rpc/handlers/application/agents.js'
import { readSessionHistory } from '../../../packages/application-runtime/src/agents/session-history.js'

const actor = { kind: 'system' as const, id: 'context-test' }
const narrativeText = (messages: ChatMessage[]) => messages.find(message => message.role === 'developer')?.content ?? ''
const empty: NarrativeContextProjection = { version: 'initial', memory: null, rawThroughNodeId: null }
const tool: ToolDefinition = {
  id: 'test/write', owner: { namespace: 'test' }, name: 'write_story', description: 'Write story',
  input: { kind: 'freeform', mediaType: 'text/plain' },
}

async function fixture(filename = ':memory:') {
  const clock = { createId, now: nowIso }
  const engine = createSqliteDataEngine({ filename, ...clock })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, ...clock })
  const agents = createAgentStore({ engine, ...clock })
  const registry = createNarrativeContextRegistry()
  let rejectHandoff = false
  const defaultProvider = registry.register({
    id: 'test.memory',
    resolve: async scope => {
      const record = await documents.get(`memory:${scope.timelineId}:${scope.branchId}`)
      if (!record) throw new Error('Memory source has not initialized this branch')
      return record.content as NarrativeContextProjection
    },
    onSessionHandoff: async scope => {
      if (rejectHandoff) throw new Error('SUMMARY_PUBLISH_FAILED')
      const candidate = await documents.get('pending-summary')
      if (!candidate) return
      await publish(scope, {
        version: `summary-${candidate.version}`,
        memory: candidate.content as NonNullable<NarrativeContextProjection['memory']>,
        rawThroughNodeId: scope.rawHeadNodeId,
      })
    },
  })
  let nextFloor = 1
  let finish = false
  const requests: ChatMessage[][] = []
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents, narratives, agents, narrativeContext: registry,
    promptResources: createPromptResourceStore({ engine, ...clock }),
    agentTools: createAgentToolRegistry([tool], [{
      toolId: tool.id,
      execute: async ({ invocation, scope }) => {
        const result = await scope!.narrative!.appendNode({ content: invocation.rawInput! })
        return {
          invocationId: invocation.id, toolId: tool.id, status: 'completed',
          content: [{ type: 'text', text: `SAVED:${invocation.rawInput}:${result.nodeId}` }],
        }
      },
    }]),
    gateway: {
      invokeChat: async ({ request }) => {
        requests.push(structuredClone(request.messages))
        const content = finish ? 'DONE' : `<loom_tool name="write_story"><metadata>{}</metadata><content>RAW:FLOOR_${nextFloor++}</content></loom_tool>`
        finish = !finish
        return { provider: 'test', model: 'test-model', finishReason: 'stop', text: content, message: { role: 'assistant', content } }
      },
    },
  })
  const publish = async (scope: { timelineId: string; branchId: string }, projection: NarrativeContextProjection) => {
    const id = `memory:${scope.timelineId}:${scope.branchId}`
    const existing = await documents.get(id)
    await documents.write({ id, type: 'test.memory', content: projection, expectedVersion: existing?.version ?? 'new', actor })
  }
  return { engine, documents, narratives, agents, runtime, registry, requests, publish, defaultProvider, failHandoff: () => { rejectHandoff = true } }
}

describe('Published Narrative context', () => {
  it('derives private provider visibility from the actual Timeline during preview and handoff', async () => {
    const f = await fixture()
    try {
      f.defaultProvider.dispose()
      const { card: a } = await f.runtime.createCard({ name: 'A' })
      const { card: b } = await f.runtime.createCard({ name: 'B' })
      const { card: c } = await f.runtime.createCard({ name: 'No memory provider' })
      const reads: Record<string, string[]> = { A: [], B: [] }
      const handoffs: string[] = []
      for (const [card, label] of [[a, 'A'], [b, 'B']] as const) {
        f.registry.register({
          id: `private-${label}`,
          resolve: async scope => { reads[label]!.push(scope.timelineId); return empty },
          onSessionHandoff: async scope => { handoffs.push(`${label}:${scope.agentSessionId}`) },
        }, { kind: 'card', cardId: card.id })
      }
      const { providerProfile } = await f.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentPreset } = await f.runtime.createAgentPreset({
        name: 'Writer', model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const sessions = []
      const timelines = []
      for (const card of [a, b, c]) {
        const created = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingNodes: [] })
        timelines.push(created.timeline.id)
        const { session } = await f.runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: created.timeline.id })
        sessions.push(session)
        await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' })
      }
      expect(reads).toEqual({ A: [timelines[0]], B: [timelines[1]] })
      const result = await f.runtime.completeAgentSessionHandoff({
        agentSessionId: sessions[0]!.id, expectedEntryCount: 0, summary: 'Prepared handoff',
      })
      expect(result.memoryNotification).toEqual({ status: 'notified' })
      expect(handoffs).toEqual([`A:${sessions[0]!.id}`])
      expect(reads).toEqual({ A: [timelines[0], timelines[0]], B: [timelines[1]] })
      expect(f.requests).toEqual([])
    } finally {
      await f.engine.close()
    }
  })

  it('keeps the 1-40 write history out of the prefix until the memory source publishes, then survives restart and a new Session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-narrative-context-'))
    const filename = join(directory, 'test.sqlite')
    let f = await fixture(filename)
    try {
      const { resource: preset } = await f.runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })
      await f.runtime.replacePresetToolMounts({
        presetId: preset.id, mounts: [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true }],
      })
      const { providerProfile } = await f.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentPreset } = await f.runtime.updateAgentPreset({
        name: 'Writer', agentPresetId: preset.id, expectedVersion: (await f.runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const { card } = await f.runtime.createCard({ name: 'Story', opening: '' })
      const created = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingNodes: [] })
      const scope = { timelineId: created.timeline.id, branchId: created.branch.id }
      await f.publish(scope, empty)
      const { session } = await f.runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: scope.timelineId })
      await f.runtime.upsertTextTransformRule({
        ruleId: 'narrative-context-prompt',
        rule: {
          name: 'Prompt view', owner: { kind: 'preset', presetId: preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'RAW:', flags: 'g' }, effect: { kind: 'replace', replacement: 'PROMPT:' },
          targets: ['narrative'], phases: ['prompt'],
        },
      })
      let candidate: NarrativeContextProjection['memory'] = null
      let candidateVersion = 0
      for (let floor = 1; floor <= 40; floor++) {
        await f.runtime.invokeAgentTurn({ agentSessionId: session.id, input: `CONTINUE_${floor}` })
        expect(narrativeText(f.requests.at(-1)!)).toBe('')
        expect(f.requests.at(-1)!.some(message => message.content?.includes(`SAVED:RAW:FLOOR_${floor}:`))).toBe(true)
        if (floor === 32) {
          const page = await f.narratives.getPage(scope)
          candidate = {
            coveredThroughNodeId: page.branch.headNodeId!,
            entries: [
              { id: 'plot', content: 'MEMORY_1_32: plot facts {{literal}}' },
              { id: 'entities', content: 'MEMORY_1_32: entity facts' },
            ],
          }
          const saved = await f.documents.write({
            id: 'pending-summary', type: 'test.memory-candidate', content: candidate, expectedVersion: 'new', actor,
          })
          candidateVersion = saved.documents[0]!.version
        }
      }
      const page = await f.narratives.getPage({ ...scope, limit: 100 })
      expect(page.nodes).toHaveLength(40)
      const before = await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'NEXT' })
      expect(narrativeText(before.messages)).toBe('')
      expect(JSON.stringify(before.messages)).toContain('CONTINUE_1')
      expect(JSON.stringify(before.messages)).toContain('SAVED:RAW:FLOOR_1:')
      expect(before.promptBuildTrace.narrativeContext).toMatchObject({ version: 'initial', rawThroughNodeId: null })
      expect((await f.documents.get('pending-summary'))?.version).toBe(candidateVersion)

      const beforeCount = (await f.agents.getSession(session.id))!.entryCount
      const handoff = await f.runtime.completeAgentSessionHandoff({
        agentSessionId: session.id, expectedEntryCount: beforeCount, branchId: scope.branchId,
        summary: 'WORK_MEMO: next reveal at 43; keep unresolved promise',
      })
      expect(handoff.memoryNotification.status).toBe('notified')
      expect(handoff.session.entryCount).toBe(beforeCount + 1)
      expect((await f.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })).entries.some(entry => entry.entry.kind === 'tool-invocation')).toBe(true)
      const expected = [
        ...candidate!.entries.map(entry => entry.content),
        ...page.nodes.slice(32).map(node => node.body.raw.replace('RAW:', 'PROMPT:')),
      ].join('\n\n')
      const adopted = await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'NEXT' })
      expect(narrativeText(adopted.messages)).toBe(expected)
      expect(JSON.stringify(adopted.messages)).toContain('WORK_MEMO:')
      expect(JSON.stringify(adopted.messages)).not.toMatch(/SAVED:|CONTINUE_1/)
      expect(adopted.promptBuildTrace.narrativeContext).toEqual({
        sourceId: 'test.memory', version: 'summary-1', coveredThroughNodeId: page.nodes[31]!.id, rawThroughNodeId: page.nodes[39]!.id,
      })
      expect(adopted.promptBuildTrace.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'narrative.context_unconfigured' }))
      // Publishing a different version with identical content must not change the rendered prefix.
      await f.publish(scope, { version: 'summary-1-republished', memory: candidate, rawThroughNodeId: page.branch.headNodeId! })
      const sameContent = await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'NEXT' })
      expect(narrativeText(sameContent.messages)).toBe(expected)
      await f.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'CONTINUE_41' })
      expect(narrativeText(f.requests.at(-1)!)).toBe(expected)

      f.engine.close()
      f = await fixture(filename)
      const resumed = await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'RESUMED' })
      expect(JSON.stringify(resumed.messages)).toContain('WORK_MEMO:')
      expect(JSON.stringify(resumed.messages)).toContain('SAVED:RAW:FLOOR_41:')
      expect(JSON.stringify(resumed.messages)).not.toContain('SAVED:RAW:FLOOR_40:')
      const { session: newSession } = await f.runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: scope.timelineId })
      const restarted = await f.runtime.previewAgentTurn({ agentSessionId: newSession.id, input: 'NEW_SESSION' })
      expect(narrativeText(restarted.messages)).toBe(expected)
      expect(JSON.stringify(restarted.messages)).not.toContain('SAVED:')
      expect(JSON.stringify(restarted.messages)).not.toContain('WORK_MEMO:')
      const activeRead = await f.runtime.sampleNarrative({ ...scope, selection: { kind: 'tail', count: 1 } })
      expect(activeRead.nodes[0]!.body.raw).toBe('RAW:FLOOR_41')
      expect((await f.narratives.getPage({ ...scope, limit: 100 })).nodes).toHaveLength(41)
      expect((await f.agents.getSession(session.id))!.entryCount).toBeGreaterThan(100)
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects foreign or reversed coverage, malformed output and competing default sources without overwriting the published record', async () => {
    const f = await fixture()
    try {
      const { resource: preset } = await f.runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })
      const { providerProfile } = await f.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentPreset } = await f.runtime.updateAgentPreset({
        name: 'Writer', agentPresetId: preset.id, expectedVersion: (await f.runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const { card } = await f.runtime.createCard({ name: 'Story' })
      const created = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingNodes: [{ content: 'FIRST' }, { content: 'SECOND' }] })
      const scope = { timelineId: created.timeline.id, branchId: created.branch.id }
      const { session } = await f.runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: scope.timelineId })
      const preview = () => f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'NEXT' })
      const good = { version: 'good', memory: null, rawThroughNodeId: created.branch.headNodeId! }
      await f.publish(scope, good)
      const before = await preview()
      expect(narrativeText(before.messages)).toBe('FIRST\n\nSECOND')
      const competitor = f.registry.register({ id: 'competing.memory', resolve: async () => empty })
      await expect(preview()).rejects.toThrow(/Conflicting Narrative context providers/)
      competitor.dispose()
      expect(narrativeText((await preview()).messages)).toBe('FIRST\n\nSECOND')

      const { branch: fork } = await f.runtime.forkNarrativeBranch({
        timelineId: scope.timelineId, fromBranchId: scope.branchId, fromNodeId: created.nodes[0]!.id,
      })
      const foreign = await f.narratives.appendNode({
        actor, timelineId: scope.timelineId, branchId: fork.id, expectedHeadNodeId: fork.headNodeId!,
        stateRevisionId: fork.stateHeadRevisionId, body: { format: 'loom-markdown.v1', raw: 'FORK_ONLY' },
      })
      for (const projection of [
        { ...good, rawThroughNodeId: foreign.node.id },
        { ...good, memory: { coveredThroughNodeId: foreign.node.id, entries: [{ id: 'summary', content: 'FOREIGN' }] }, rawThroughNodeId: null },
        { ...good, memory: { coveredThroughNodeId: created.nodes[1]!.id, entries: [{ id: 'summary', content: 'REVERSED' }] }, rawThroughNodeId: created.nodes[0]!.id },
      ]) {
        await f.publish(scope, projection)
        await expect(preview()).rejects.toThrow()
      }
      await f.publish(scope, good)
      const invalid = f.registry.register({
        id: 'invalid.memory',
        resolve: async () => ({ version: 'broken', memory: null } as NarrativeContextProjection),
      })
      await expect(preview()).rejects.toThrow(/explicit Raw endpoint/)
      invalid.dispose()
      expect(narrativeText((await preview()).messages)).toBe('FIRST\n\nSECOND')
      await f.publish(scope, { ...good, memory: { coveredThroughNodeId: created.nodes[1]!.id, entries: [{ id: 'all', content: 'SUMMARY_ONLY' }] }, rawThroughNodeId: null })
      expect(narrativeText((await preview()).messages)).toBe('SUMMARY_ONLY')
    } finally { f.engine.close() }
  })

  it('commits a Session handoff independently when the memory callback fails; rejects active work and stale handoffs', async () => {
    const f = await fixture()
    try {
      const { card } = await f.runtime.createCard({ name: 'Story' })
      const created = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingNodes: [] })
      const scope = { timelineId: created.timeline.id, branchId: created.branch.id }
      await f.publish(scope, empty)
      const { session } = await f.agents.createSession({ actor, agentPresetId: 'profile', timelineId: scope.timelineId })
      await f.agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 0,
        entries: [
          { runId: 'run', entry: { kind: 'message', role: 'user', content: 'OLD_FAILED_TASK' } },
          { runId: 'run', entry: { kind: 'run-state', state: 'running' } },
        ],
      })
      const complete = (count: number, summary = 'Saved work') => f.runtime.completeAgentSessionHandoff({
        agentSessionId: session.id, expectedEntryCount: count, summary,
      })
      await expect(complete(2)).rejects.toThrow(/active Run/)
      expect((await f.agents.getSession(session.id))!.entryCount).toBe(2)
      await f.agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 2,
        entries: [{ runId: 'run', entry: { kind: 'run-state', state: 'failed' } }],
      })
      await expect(complete(2)).rejects.toThrow(/count conflict/)
      await expect(complete(3, ' ')).rejects.toThrow(/cannot be empty/)
      f.failHandoff()
      const result = await complete(3)
      expect(result.memoryNotification).toEqual({ status: 'failed', error: 'SUMMARY_PUBLISH_FAILED' })
      expect(result.entries[0]?.entry).toEqual({ kind: 'work-summary', content: 'Saved work' })
      expect((await f.registry.resolve(scope))?.version).toBe('initial')
      await expect(complete(3)).rejects.toThrow(/count conflict/)
      expect((await f.agents.getLatestWorkSummary(session.id))?.id).toBe(result.entries[0]!.id)
      await expect(handleAgentsRpc(f.runtime, 'application.agent.run.resume', { agentSessionId: session.id }))
        .resolves.toMatchObject({ accepted: false })

      const next = await f.agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 4,
        entries: Array.from({ length: 110 }, (_, i) => ({
          entry: { kind: 'message' as const, role: 'user' as const, content: `NEW_${i}` },
        })),
      })
      const history = await readSessionHistory(f.agents, session.id)
      expect(history.entries).toHaveLength(111)
      expect(history.entries[0]!.entry).toEqual({ kind: 'work-summary', content: 'Saved work' })
      await complete(next.session.entryCount, 'Updated work')
      const replaced = await readSessionHistory(f.agents, session.id)
      expect(replaced.entries.map(entry => entry.entry)).toEqual([{ kind: 'work-summary', content: 'Updated work' }])
      expect((await f.agents.getSession(session.id))!.entryCount).toBe(115)

      const { session: unfinished } = await f.agents.createSession({ actor, agentPresetId: 'profile' })
      await f.agents.appendEntries({
        actor, agentSessionId: unfinished.id, expectedEntryCount: 0,
        entries: [
          { runId: 'unfinished', entry: { kind: 'tool-invocation', invocationId: 'unknown', toolId: tool.id, exposedName: tool.name, transport: 'content', rawInput: 'TEXT', status: 'running' } },
          { runId: 'unfinished', entry: { kind: 'run-state', state: 'failed' } },
        ],
      })
      await expect(f.runtime.completeAgentSessionHandoff({
        agentSessionId: unfinished.id, expectedEntryCount: 2, summary: 'Do not discard this unknown outcome',
      })).rejects.toThrow(/unfinished tool call/)
    } finally { f.engine.close() }
  })
})
