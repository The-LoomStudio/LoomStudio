import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore, type AgentTranscriptEntryData } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createApplicationRuntime, createOfficialAgentToolRegistry, type GatewayChatResult } from '@loom-studio/application-runtime'
import { callApplicationRpc } from '../../support/trpc-caller.js'
import { countText } from '@loom-studio/tokenizer'
import type { JsonObject } from '@loom-studio/shared'

const text = (content: string): GatewayChatResult => ({ provider: 'test', model: 'test', text: content, message: { role: 'assistant', content } })
const declare = (): GatewayChatResult => ({ provider: 'test', model: 'test', text: '', finishReason: 'tool_call',
  message: { role: 'assistant', tool_calls: [{ id: `declare-${randomUUID()}`, type: 'function', function: { name: 'declare_narrative', arguments: '{}' } }] } })

async function fixture(opening = true) {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const queue: Array<() => Promise<GatewayChatResult>> = []
  const requests: unknown[] = []
  const runtime = createApplicationRuntime({ dataEngine: engine, agents, narratives, agentTools: createOfficialAgentToolRegistry(),
    documents: createSqliteDocumentStore({ engine }), promptResources: createPromptResourceStore({ engine }),
    gateway: { invokeChat: async input => { requests.push(input.request.messages); return queue.shift()!() } },
  })
  await runtime.initialize()
  const { card } = await runtime.createCard({ name: 'Discussion retry' })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id, ...(opening ? { openingContent: 'OPENING' } : {}) })
  const target = { timelineId: timeline.id, branchId: branch.id }
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })).resource
  const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test'] })
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: preset.version, model: { providerProfileId: providerProfile.id, modelId: 'test' } })
  await runtime.updateAgentSession({ agentSessionId: timeline.id, agentPresetId: preset.id, narrativeMode: 'declared' })
  const invoke = (input: string, retry?: { entryId: string }) => runtime.invokeAgentTurn({ agentSessionId: timeline.id, input, narrativeTarget: target, retry })
  return { engine, agents, narratives, runtime, timeline, target, queue, requests, invoke }
}

async function appendLegacyFailure(f: Awaited<ReturnType<typeof fixture>>, effects: AgentTranscriptEntryData[] = [], recoveryPatch: JsonObject = {}) {
  const session = (await f.agents.getSession(f.timeline.id))!
  const recovery = { version: 1, phase: 'provider', nextProviderStep: 1, userEntryId: 'legacy-user', narrativeOutput: { declared: false }, ...recoveryPatch }
  const saved = await f.agents.appendEntries({ actor: { kind: 'system', id: 'test' }, agentSessionId: session.id, expectedEntryCount: session.entryCount,
    entries: [
      { id: 'legacy-user', roundId: 'legacy-round', runId: 'legacy-run', entry: { kind: 'message', role: 'user', content: 'LEGACY_INPUT' } },
      { runId: 'legacy-run', entry: { kind: 'run-state', state: 'running', recovery } },
      { runId: 'legacy-run', entry: { kind: 'request-measurement', measurementId: 'legacy-measurement', providerStep: 1, providerProfileId: 'legacy-provider',
        modelId: 'legacy-model', requestDigest: '0'.repeat(64), scope: 'canonical-content-v1', count: countText('LEGACY_INPUT'), uncounted: [] } },
      ...effects.map(entry => ({ runId: 'legacy-run', entry })),
      { runId: 'legacy-run', entry: { kind: 'run-state', state: 'failed', reason: '503 unavailable', recovery } },
    ] })
  await f.runtime.appendAgentTranscriptEntries({ agentSessionId: session.id, expectedEntryCount: saved.session.entryCount,
    entries: [{ runId: 'legacy-run', entry: { kind: 'run-state', state: 'discarded' } }] })
  return saved.entries[0]!
}

describe('Timeline discussion retry', () => {
  it('replaces the latest input and restores its story, State and Workspace while retaining old facts', async () => {
    const f = await fixture()
    try {
      const baseline = (await f.narratives.getBranch(f.target.branchId))!
      f.queue.push(async () => {
        const stateTarget = { scope: 'timeline' as const, ...f.target }
        const state = (await f.runtime.getStateSnapshot({ target: stateTarget })).snapshot
        await f.runtime.applyStateMutation({ target: stateTarget, expectedRevisionId: state.revisionId, operations: [{ op: 'set', path: '/phase', value: 1 }] })
        const workspace = await f.runtime.getTimelineWorkspace(f.target)
        await f.runtime.mutateTimelineWorkspace({ ...f.target, expectedRevisionId: workspace.id,
          operations: [{ kind: 'create', entry: { id: 'old-draft', kind: 'file', name: 'old.txt', content: { text: 'old' } } }] })
        return declare()
      })
      f.queue.push(async () => text('OLD_BODY'), async () => text('OLD_WORK'))
      const original = await f.invoke('ORIGINAL_GUIDANCE')
      const before = (await f.agents.getSession(f.timeline.id))!
      f.queue.push(async () => {
        const branch = (await f.narratives.getBranch(f.target.branchId))!
        expect(branch.stateHeadRevisionId).toBe(baseline.stateHeadRevisionId)
        expect(branch.workspaceHeadRevisionId).toBe(baseline.workspaceHeadRevisionId)
        expect((await f.narratives.getPage(f.target)).nodes.map(node => node.body.raw)).toEqual(['OPENING'])
        return declare()
      })
      f.queue.push(async () => text('NEW_BODY'), async () => text('NEW_WORK'))
      const replacement = await f.invoke('EDITED_GUIDANCE', { entryId: original.entries.user.id })
      const prompt = JSON.stringify(f.requests.at(-1))
      expect(prompt).toContain('EDITED_GUIDANCE')
      expect(prompt).not.toContain('ORIGINAL_GUIDANCE')
      expect(prompt).not.toContain('OLD_BODY')
      expect(replacement.entries.user.parentEntryId).toBe(original.entries.user.parentEntryId)
      expect(replacement.entries.user.roundId).toBe(original.entries.user.roundId)
      const adopted = (await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries
      expect(adopted.some(entry => entry.id === original.entries.user.id)).toBe(false)
      expect((await f.narratives.getPage(f.target)).nodes.map(node => node.body.raw)).toEqual(['OPENING', 'NEW_BODY'])
      expect((await f.agents.listEntries(f.timeline.id)).some(entry => entry.id === original.entries.user.id)).toBe(true)
      expect((await f.agents.getSession(f.timeline.id))!.entryCount).toBeGreaterThan(before.entryCount)
      const swipe = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      expect(swipe.canGenerate).toBe(true)
      f.queue.push(async () => text('SWIPED_BODY'))
      await f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: '', narrativeTarget: { ...f.target,
        swipe: { groupId: swipe.id, expectedRevision: swipe.revision, mode: 'swipe' } } })
      expect(JSON.stringify(f.requests.at(-1))).toContain('EDITED_GUIDANCE')
      expect(JSON.stringify(f.requests.at(-1))).not.toContain('ORIGINAL_GUIDANCE')
    } finally { f.engine.close() }
  })

  it('supports original-text retry through RPC and rejects superseded inputs', async () => {
    const f = await fixture()
    try {
      f.queue.push(async () => text('FIRST'))
      const original = await f.invoke('GUIDANCE')
      f.queue.push(async () => text('RETRY'))
      const retried = await callApplicationRpc(f.runtime, 'application.invokeAgentTurn', {
        agentSessionId: f.timeline.id, input: 'GUIDANCE', narrativeTarget: f.target, retry: { entryId: original.entries.user.id },
      })
      expect(retried).toMatchObject({ entries: { user: { entry: { content: 'GUIDANCE' } } } })
      await expect(f.invoke('STALE', { entryId: original.entries.user.id })).rejects.toMatchObject({ code: 'agent.retry_superseded' })
      expect(f.requests).toHaveLength(2)
    } finally { f.engine.close() }
  })

  it('rejects older records without a durable baseline without changing adopted material', async () => {
    const f = await fixture()
    try {
      const session = (await f.agents.getSession(f.timeline.id))!
      const saved = await f.agents.appendEntries({ actor: { kind: 'system', id: 'test' }, agentSessionId: session.id, expectedEntryCount: session.entryCount,
        entries: [{ runId: 'legacy', entry: { kind: 'message', role: 'user', content: 'LEGACY' } }, { runId: 'legacy', entry: { kind: 'run-state', state: 'completed' } }] })
      const branch = await f.narratives.getBranch(f.target.branchId)
      await expect(f.invoke('EDIT', { entryId: saved.entries[0]!.id })).rejects.toMatchObject({ code: 'agent.retry_baseline_missing' })
      expect(await f.narratives.getBranch(f.target.branchId)).toEqual(branch)
      expect(f.requests).toHaveLength(0)
    } finally { f.engine.close() }
  })

  it.each([false, true])('retries a just-abandoned input after canonical history is restored (prior reply: %s)', async priorReply => {
    const f = await fixture(priorReply)
    try {
      if (priorReply) {
        f.queue.push(async () => text('PREVIOUS_WORK'))
        await f.invoke('PREVIOUS_INPUT')
      }
      f.queue.push(async () => { throw new Error('503 unavailable') })
      await expect(f.invoke('FAILED_INPUT')).rejects.toThrow('503 unavailable')
      const page = await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })
      const user = page.entries.findLast(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')!
      await f.runtime.appendAgentTranscriptEntries({ agentSessionId: f.timeline.id, expectedEntryCount: page.session.entryCount,
        entries: [{ runId: user.runId, entry: { kind: 'run-state', state: 'discarded' } }] })
      expect((await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries.some(entry => entry.id === user.id)).toBe(false)
      f.queue.push(async () => text('RECOVERED_WORK'))
      const recovered = await f.invoke('EDITED_FAILED_INPUT', { entryId: user.id })
      expect(recovered.entries.user.entry).toMatchObject({ content: 'EDITED_FAILED_INPUT' })
      expect(recovered.entries.user.roundId).toBe(user.roundId)
      expect(JSON.stringify(f.requests.at(-1))).not.toContain('"content":"FAILED_INPUT"')
    } finally { f.engine.close() }
  })

  it('retries the original user input after its interrupted Run was continued successfully', async () => {
    const f = await fixture()
    try {
      f.queue.push(async () => { throw new Error('interrupted') })
      await expect(f.invoke('ORIGINAL')).rejects.toThrow('interrupted')
      const recovery = (await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.timeline.id }))!
      f.queue.push(async () => text('CONTINUED_WORK'))
      await f.runtime.invokeAgentTurn(recovery.request, { agentRun: { runId: 'continued', onEvent: () => {}, continuation: recovery.continuation } })
      f.queue.push(async () => text('REPLACEMENT_WORK'))
      await f.invoke('REPLACEMENT', { entryId: recovery.continuation.userEntry.id })
      expect(JSON.stringify(f.requests.at(-1))).not.toContain('CONTINUED_WORK')
    } finally { f.engine.close() }
  })

  it('retries after a continuation fails and is abandoned, using the original user baseline', async () => {
    const f = await fixture(false)
    try {
      f.queue.push(async () => { throw new Error('interrupted') })
      await expect(f.invoke('ORIGINAL')).rejects.toThrow('interrupted')
      const recovery = (await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.timeline.id }))!
      f.queue.push(async () => { throw new Error('continuation interrupted') })
      await expect(f.runtime.invokeAgentTurn(recovery.request, { agentRun: { runId: 'continued-failed', onEvent: () => {}, continuation: recovery.continuation } }))
        .rejects.toThrow('continuation interrupted')
      const session = (await f.agents.getSession(f.timeline.id))!
      await f.runtime.appendAgentTranscriptEntries({ agentSessionId: session.id, expectedEntryCount: session.entryCount,
        entries: [{ runId: 'continued-failed', entry: { kind: 'run-state', state: 'discarded' } }] })
      f.queue.push(async () => text('REPLACEMENT_WORK'))
      const replacement = await f.invoke('REPLACEMENT', { entryId: recovery.continuation.userEntry.id })
      expect(replacement.entries.user.entry).toMatchObject({ content: 'REPLACEMENT' })
      expect(replacement.entries.user.parentEntryId).toBe(recovery.continuation.userEntry.parentEntryId)
    } finally { f.engine.close() }
  })

  it('preserves concurrent material changes and candidate metadata when retry preparation conflicts', async () => {
    const f = await fixture()
    try {
      f.queue.push(async () => text('ORIGINAL_WORK'))
      const original = await f.invoke('ORIGINAL')
      const swipe = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      const readPage = f.narratives.getPage.bind(f.narratives)
      let reads = 0
      let concurrentRevision: string | undefined
      const probe = vi.spyOn(f.narratives, 'getPage').mockImplementation(async input => {
        const page = await readPage(input)
        if (++reads === 2) {
          const target = { scope: 'timeline' as const, ...f.target }
          const state = (await f.runtime.getStateSnapshot({ target })).snapshot
          const changed = await f.runtime.applyStateMutation({ target, expectedRevisionId: state.revisionId,
            operations: [{ op: 'set', path: '/concurrent', value: true }] })
          concurrentRevision = changed.snapshot.revisionId
        }
        return page
      })
      await expect(f.invoke('EDITED', { entryId: original.entries.user.id })).rejects.toMatchObject({ code: 'narrative.state_head_conflict' })
      probe.mockRestore()
      const branch = (await f.narratives.getBranch(f.target.branchId))!
      expect(branch.stateHeadRevisionId).toBe(concurrentRevision)
      expect((await f.runtime.getNarrativeSwipes(f.target)).swipe).toMatchObject({ revision: swipe.revision, selectedCandidateId: swipe.selectedCandidateId, active: false })
      expect((await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries.some(entry => entry.id === original.entries.user.id)).toBe(true)
      expect(f.requests).toHaveLength(1)
    } finally { vi.restoreAllMocks(); f.engine.close() }
  })

  it.each(['LEGACY_INPUT', 'EDITED_LEGACY_INPUT'])('retries an effect-free legacy first Provider failure with input %s and keeps Swipe clean', async input => {
    const f = await fixture(input !== 'LEGACY_INPUT')
    try {
      const user = await appendLegacyFailure(f)
      const target = { scope: 'timeline' as const, ...f.target }
      const state = (await f.runtime.getStateSnapshot({ target })).snapshot
      await f.runtime.applyStateMutation({ target, expectedRevisionId: state.revisionId, operations: [{ op: 'set', path: '/current', value: true }] })
      const workspace = await f.runtime.getTimelineWorkspace(f.target)
      await f.runtime.mutateTimelineWorkspace({ ...f.target, expectedRevisionId: workspace.id,
        operations: [{ kind: 'create', entry: { id: 'current-file', kind: 'file', name: 'current.txt', content: { text: 'keep' } } }] })
      const before = (await f.narratives.getBranch(f.target.branchId))!
      f.queue.push(async () => text('RECOVERED_WORK'))
      const result = await f.invoke(input, { entryId: user.id })
      expect(result.entries.user.parentEntryId).toBe(user.parentEntryId)
      expect(result.entries.user.roundId).toBe(user.roundId)
      let branch = (await f.narratives.getBranch(f.target.branchId))!
      expect(branch.stateHeadRevisionId).toBe(before.stateHeadRevisionId)
      expect(branch.workspaceHeadRevisionId).toBe(before.workspaceHeadRevisionId)
      const checkpoint = (await f.agents.findRunCheckpoint({ agentSessionId: f.timeline.id, runId: result.runId }))!
      expect(checkpoint.entry.kind === 'run-state' && checkpoint.entry.recovery?.materialBaseline).toMatchObject({
        headEntryId: user.parentEntryId ?? null, stateRevisionId: before.stateHeadRevisionId, workspaceRevisionId: before.workspaceHeadRevisionId,
      })
      const swipe = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      expect(swipe).toMatchObject({ id: user.roundId, canGenerate: true })
      f.queue.push(async () => text('SWIPED_WORK'))
      await f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: '', narrativeTarget: { ...f.target,
        swipe: { groupId: swipe.id, expectedRevision: swipe.revision, mode: 'swipe' } } })
      const messages = f.requests.at(-1) as Array<{ role: string; content?: unknown }>
      expect(messages.filter(message => message.role === 'user' && message.content === input)).toHaveLength(1)
      if (input !== 'LEGACY_INPUT') expect(JSON.stringify(messages)).not.toContain('"content":"LEGACY_INPUT"')
      const canonical = (await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries
      expect(canonical.some(entry => entry.runId === 'legacy-run')).toBe(false)
      expect((await f.agents.listEntries(f.timeline.id)).some(entry => entry.id === user.id)).toBe(true)
      branch = (await f.narratives.getBranch(f.target.branchId))!
      expect(branch.stateHeadRevisionId).toBe(before.stateHeadRevisionId)
      expect(branch.workspaceHeadRevisionId).toBe(before.workspaceHeadRevisionId)
    } finally { f.engine.close() }
  })

  it.each(['tool', 'assistant', 'declared', 'accepted', 'later-provider', 'narrative'] as const)('rejects legacy %s effects without a material baseline', async effect => {
    const f = await fixture()
    try {
      const entries: AgentTranscriptEntryData[] = effect === 'tool' ? [
        { kind: 'tool-invocation', invocationId: 'legacy-call', toolId: 'official/read_state', exposedName: 'read_state', transport: 'native-function', arguments: {}, status: 'completed' },
        { kind: 'tool-result', invocationId: 'legacy-call', toolId: 'official/read_state', status: 'completed', content: [] },
      ] : effect === 'assistant' ? [{ kind: 'message', role: 'assistant', content: 'already answered' }] : []
      const patch: JsonObject = effect === 'declared' ? { narrativeOutput: { declared: true } }
        : effect === 'accepted' ? { acceptedContent: {} } : effect === 'later-provider' ? { nextProviderStep: 2 } : {}
      const user = await appendLegacyFailure(f, entries, patch)
      if (effect === 'narrative') {
        const branch = (await f.narratives.getBranch(f.target.branchId))!
        await f.narratives.appendNode({ actor: { kind: 'system', id: 'other-agent' }, ...f.target,
          expectedHeadNodeId: branch.headNodeId ?? null, stateRevisionId: branch.stateHeadRevisionId,
          body: { format: 'loom-markdown.v1', raw: 'OTHER_AGENT_STORY' } })
      }
      const before = await f.narratives.getBranch(f.target.branchId)
      await expect(f.invoke('EDIT', { entryId: user.id })).rejects.toMatchObject({ code: 'agent.retry_baseline_missing' })
      expect(await f.narratives.getBranch(f.target.branchId)).toEqual(before)
      expect(f.requests).toHaveLength(0)
    } finally { f.engine.close() }
  })
})
