import { randomUUID } from 'node:crypto'
import { createAgentStore, createNarrativeStore, createNarrativeSwipeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createAgentToolRegistry, createApplicationRuntime, type ApplicationRuntimeOptions, type ToolDefinition, type ToolExecutionScope } from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import { callApplicationRpc } from '../../support/trpc-caller.js'

const tool: ToolDefinition = {
  id: 'official/swipe_probe', owner: { namespace: 'official' }, name: 'swipe_probe',
  description: 'Write a reply and its State.',
  input: { kind: 'structured', schema: { type: 'object', properties: {} } },
}

async function setup() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const scopes: ToolExecutionScope[] = []
  let content = 'CANDIDATE_A'
  let coins = 80
  let step = 0
  let edit = false
  let afterWrite: (() => Promise<void>) | undefined
  let beforeGenerate: ((input: Parameters<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>[0]) => Promise<void>) | undefined
  const runtime = createApplicationRuntime({
    dataEngine: engine, agents, narratives,
    documents: createSqliteDocumentStore({ engine }), promptResources: createPromptResourceStore({ engine }),
    agentTools: createAgentToolRegistry([tool], [{ toolId: tool.id, execute: async ({ invocation, scope }) => {
      scopes.push(scope!)
      if (edit) await scope!.narrative!.editNode({ nodeId: scope!.narrativeSource!.nodeId!, content })
      else await scope!.narrative!.appendNode({ content })
      const target = scope!.state!.defaultTarget
      if (!target) throw new Error('Missing default state target')
      const snapshot = await scope!.state!.read(target)
      await scope!.state!.update({ target, idempotencyKey: `${invocation.id}:coins`, expectedRevisionId: snapshot.revisionId, operations: [{ op: 'set', path: '/coins', value: coins }] })
      const files = await scope!.workspace!.snapshot()
      const memory = files.find(file => file.path === '/workspace/MEMORY.md')!
      if (memory.binding?.kind !== 'workspace') throw new Error('Workspace binding missing')
      await scope!.workspace!.mutate(memory.binding.revisionId, [{ kind: 'write', entryId: 'memory', content }])
      return { invocationId: invocation.id, toolId: tool.id, status: 'completed', content: [{ type: 'text', text: content }] }
    } }]),
    gateway: { invokeChat: async input => {
      if (++step % 2 === 1) {
        try { await beforeGenerate?.(input) } catch (error) { step -= 1; throw error }
        return { provider: 'test', model: 'test', text: '', finishReason: 'tool_call', message: {
          role: 'assistant', tool_calls: [{ id: `call-${step}`, type: 'function', function: { name: tool.name, arguments: '{}' } }],
        } }
      }
      await afterWrite?.()
      return { provider: 'test', model: 'test', text: 'Done.', message: { role: 'assistant', content: 'Done.' } }
    } },
  })
  await runtime.initialize()
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Swipe' })).resource
  const provider = (await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test'] })).providerProfile
  await runtime.replacePresetToolMounts({ expectedMountIds: (await runtime.listPresetToolMounts({ presetId: preset.id })).mounts.map(mount => mount.id), presetId: preset.id, mounts: [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true }] })
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: provider.id, modelId: 'test' } })
  const { card } = await runtime.createCard({ name: 'Swipe Card' })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
  const target = { timelineId: timeline.id, branchId: branch.id }
  const stateTarget = { scope: 'timeline' as const, ...target }
  const state = (await runtime.getStateSnapshot({ target: stateTarget })).snapshot
  await runtime.applyStateMutation({ target: stateTarget, expectedRevisionId: state.revisionId, operations: [{ op: 'set', path: '/coins', value: 100 }] })
  const { session } = await runtime.createAgentSession({ agentPresetId: preset.id, timelineId: timeline.id })
  const input = await runtime.appendNarrativeInput({ ...target, nodeId: 'input', expectedHeadNodeId: branch.headNodeId ?? null, content: 'Go on.' })
  const request = { agentSessionId: session.id, input: 'Go on.', narrativeTarget: { ...target, inputNodeId: input.node.id } }
  const read = async () => (await runtime.getNarrativeSwipes(target)).swipe!
  const generate = async (mode: 'swipe' | 'regenerate' | 'retry', input?: string) => {
    const group = await read()
    return runtime.invokeAgentTurn({ ...request, narrativeTarget: { ...request.narrativeTarget, swipe: { groupId: group.id, mode, expectedRevision: group.revision, input } } })
  }
  return { engine, runtime, agents, narratives, scopes, preset, provider, target, stateTarget, session, request, read, generate,
    configure(next: { content?: string; coins?: number; edit?: boolean; completeNext?: boolean; afterWrite?: typeof afterWrite; beforeGenerate?: typeof beforeGenerate }) {
      content = next.content ?? content; coins = next.coins ?? coins; beforeGenerate = next.beforeGenerate
      edit = next.edit ?? false; afterWrite = next.afterWrite
      if (next.completeNext) step = 1
    },
  }
}

describe('runtime Narrative Swipe', () => {
  it('keeps reply choices under each input and restores their State and Session after switching', async () => {
    const f = await setup()
    try {
      await f.runtime.invokeAgentTurn(f.request)
      f.configure({ content: 'A_SECOND_REPLY', coins: 70 })
      await f.generate('swipe')
      const a = await f.read()
      f.configure({ content: 'B_FIRST_REPLY', coins: 50, beforeGenerate: async input => {
        expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 100 })
        expect((await f.runtime.getTimelineWorkspace(f.target)).entries[0]).toMatchObject({ content: { text: expect.stringContaining('暂无共同工作记录') } })
        expect(JSON.stringify(input.request.messages)).not.toContain('A_SECOND_REPLY')
        expect(JSON.stringify(input.request.messages)).not.toContain('Go on.')
        expect(JSON.stringify(input.request.messages)).toContain('Try the other road.')
      } })
      await f.generate('swipe', 'Try the other road.')
      f.configure({ content: 'B_SECOND_REPLY', coins: 40 })
      await f.generate('swipe')
      const b = await f.read()
      expect(b.inputs).toHaveLength(2)
      expect(b.inputs?.[0]).toMatchObject({ nodeId: a.inputNodeId, selectedCandidateId: a.selectedCandidateId })
      expect(b.inputs?.[1]).toMatchObject({ nodeId: b.inputNodeId, selectedCandidateId: b.selectedCandidateId })
      expect(b.candidates.filter(candidate => candidate.inputNodeId === a.inputNodeId)).toHaveLength(2)
      expect(b.candidates.filter(candidate => candidate.inputNodeId === b.inputNodeId)).toHaveLength(2)
      const select = async (candidateId: string) => {
        const latest = await f.read()
        return f.runtime.selectNarrativeSwipe({ ...f.target, groupId: latest.id, candidateId,
          expectedRevision: latest.revision, expectedHeadNodeId: (await f.narratives.getBranch(f.target.branchId))!.headNodeId! })
      }
      const selectedA = await select(a.selectedCandidateId!)
      expect(selectedA.page.nodes.slice(-2).map(node => node.body.raw)).toEqual(['Go on.', 'A_SECOND_REPLY'])
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 70 })
      const transcriptA = await f.runtime.getAgentTranscriptPage({ agentSessionId: f.session.id, selectedCandidates: true, limit: 100 })
      expect(JSON.stringify(transcriptA.entries)).toContain('A_SECOND_REPLY')
      expect(JSON.stringify(transcriptA.entries)).not.toContain('Try the other road.')
      const selectedB = await select(b.selectedCandidateId!)
      expect(selectedB.page.nodes.slice(-2).map(node => node.body.raw)).toEqual(['Try the other road.', 'B_SECOND_REPLY'])
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 40 })
      expect((await f.runtime.getTimelineWorkspace(f.target)).entries[0]).toMatchObject({ content: { text: 'B_SECOND_REPLY' } })
      f.configure({ completeNext: true })
      await f.generate('swipe', 'Try the other road.')
      const empty = await f.read()
      expect(empty.inputs).toHaveLength(3)
      expect(empty.candidates.at(-1)).toMatchObject({ status: 'failed', inputNodeId: empty.inputNodeId })
      expect(empty.inputNodeId).not.toBe(b.inputNodeId)
      await select(a.selectedCandidateId!)
      await select(empty.selectedCandidateId!)
      expect((await f.narratives.getBranch(f.target.branchId))!.headNodeId).toBe(empty.inputNodeId)
      f.configure({ content: 'RESET_INPUT_RESULT', coins: 30 })
      await f.generate('retry')
      const reset = await f.read()
      expect(reset.inputs).toHaveLength(1)
      expect(reset.candidates.filter(candidate => candidate.status !== 'discarded')).toHaveLength(1)
      const head = (await f.narratives.getBranch(f.target.branchId))!.headNodeId!
      await f.runtime.appendNarrativeInput({ ...f.target, nodeId: 'next-turn', expectedHeadNodeId: head, content: 'Continue.' })
      expect(await f.read()).toBeUndefined()
      await expect(f.runtime.selectNarrativeSwipe({ ...f.target, groupId: reset.id, candidateId: reset.selectedCandidateId!,
        expectedRevision: reset.revision, expectedHeadNodeId: 'next-turn' })).rejects.toMatchObject({ code: 'narrative.swipe_unavailable' })
    } finally { f.engine.close() }
  })
  it('preserves a candidate checkpoint after preparation failure and recovers a stopped running candidate', async () => {
    const f = await setup()
    try {
      f.configure({ afterWrite: async () => { throw new Error('Interrupted') } })
      await expect(f.runtime.invokeAgentTurn(f.request)).rejects.toThrow('Interrupted')
      const recovery = await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.session.id })
      const head = (await f.narratives.getBranch(f.target.branchId))!.headNodeId
      await f.runtime.updateProviderProfile({ expectedVersion: (await f.runtime.listProviderProfiles()).providerProfiles.find(profile => profile.id === f.provider.id)!.version, providerProfileId: f.provider.id, enabledModelIds: [] })
      await expect(f.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'preparation-failure', onEvent: () => {}, continuation: recovery!.continuation },
      })).rejects.toThrow('Provider model is not enabled')
      expect(await f.read()).toMatchObject({ suspended: true })
      expect((await f.narratives.getBranch(f.target.branchId))!.headNodeId).toBe(head)
      const store = createNarrativeSwipeStore({ engine: f.engine })
      await f.engine.transact({ actor: { kind: 'kernel', id: 'simulate-stopped-process' } }, async tx => {
        const group = store.transaction(tx).getLatest(f.target.branchId)!
        group.candidates.find(candidate => candidate.id === group.activeCandidateId)!.status = 'running'
        store.transaction(tx).save(group, { expectedRevision: group.revision })
      })
      await f.runtime.updateProviderProfile({ expectedVersion: (await f.runtime.listProviderProfiles()).providerProfiles.find(profile => profile.id === f.provider.id)!.version, providerProfileId: f.provider.id, enabledModelIds: ['test'] })
      const beforeResume = await f.agents.getSession(f.session.id)
      await expect(f.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'transcript-failure', onEvent: () => {}, continuation: {
          ...recovery!.continuation,
          recovery: { ...recovery!.continuation.recovery, toolContract: 'changed-contract' },
        } },
      })).rejects.toThrow('Agent tool contract changed')
      expect(await f.read()).toMatchObject({ suspended: true })
      expect(await f.agents.getSession(f.session.id)).toMatchObject({
        headEntryId: beforeResume!.headEntryId, entryCount: beforeResume!.entryCount,
      })
      expect((await f.narratives.getBranch(f.target.branchId))!.headNodeId).toBe(head)
      f.configure({ completeNext: true })
      await f.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'cold-resume', onEvent: () => {}, continuation: recovery!.continuation },
      })
      expect(await f.read()).toMatchObject({ active: false, suspended: false, canGenerate: true })
      expect((await f.narratives.getBranch(f.target.branchId))!.headNodeId).toBe(head)
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 80 })
    } finally { f.engine.close() }
  })

  it('binds independent work before a selection group exists and keeps its source across continuation', async () => {
    const f = await setup()
    try {
      f.configure({ afterWrite: async () => { throw new Error('Background interrupted') } })
      await expect(f.runtime.invokeAgentTurn({ ...f.request, narrativeTarget: f.target })).rejects.toThrow('Background interrupted')
      const recovery = await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.session.id })
      expect(recovery?.continuation.recovery.narrativeSource?.cursorNodeId).toBe((await f.narratives.getBranch(f.target.branchId))?.headNodeId)
      const head = (await f.narratives.getBranch(f.target.branchId))!.headNodeId!
      await f.runtime.appendNarrativeInput({ ...f.target, nodeId: 'next-input', expectedHeadNodeId: head, content: 'A different direction.' })
      await expect(f.scopes[0]!.state!.read(f.stateTarget)).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
      await expect(f.scopes[0]!.workspace!.snapshot()).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
      const workspace = await f.runtime.getTimelineWorkspace(f.target)
      await expect(f.scopes[0]!.workspace!.mutate(workspace.id, [{ kind: 'write', entryId: 'memory', content: 'Late memory' }])).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
      await expect(f.scopes[0]!.narrative!.appendNode({ content: 'Late background reply' })).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
      f.configure({})
      await expect(f.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'background-resume', onEvent: () => {}, continuation: recovery!.continuation },
      })).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
      expect((await f.narratives.getBranch(f.target.branchId))?.headNodeId).toBe('next-input')
    } finally { f.engine.close() }
  })

  it('reuses the input baseline, excludes old tool history, adopts both heads and rejects late old-source writes', async () => {
    const f = await setup()
    try {
      await f.runtime.invokeAgentTurn(f.request)
      f.configure({ edit: true, content: 'CANDIDATE_A_EDITED', coins: 75 })
      await f.runtime.invokeAgentTurn({ ...f.request, input: 'Polish the reply.', narrativeTarget: f.target })
      const a = await f.read()
      expect(a.canGenerate).toBe(true)
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 75 })
      const lore = (await f.runtime.createPromptResource({ resourceKind: 'lore', name: 'Current world' })).resource
      await f.runtime.createPromptResourceAsset({ resourceId: lore.id, targetAssetId: lore.rootNode.id, position: 'inside',
        asset: { id: 'current-rules', kind: 'entry', label: 'Current rules', body: 'CURRENT_RESOURCE_AFTER_A', capabilities: { targetAnchorId: '@lore.stable' } },
      })
      await f.runtime.replaceLoreMounts({ expectedMountIds: (await f.runtime.listLoreMounts({ source: { kind: 'preset', id: f.preset.id } })).mounts.map(mount => mount.id), source: { kind: 'preset', id: f.preset.id }, loreResourceIds: [lore.id] })
      f.configure({ content: 'CANDIDATE_B', coins: 60, beforeGenerate: async input => {
        expect((await f.narratives.getBranch(f.target.branchId))?.headNodeId).toBe('input')
        expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 100 })
        expect(JSON.stringify(input.request.messages)).not.toContain('CANDIDATE_A')
        expect(JSON.stringify(input.request.messages)).toContain('CURRENT_RESOURCE_AFTER_A')
        expect((await f.read()).active).toBe(true)
        await expect(f.scopes[0]!.narrative!.appendNode({ content: 'Late result from A' })).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
        await expect(f.scopes[0]!.state!.read(f.stateTarget)).rejects.toMatchObject({ code: 'narrative.swipe_source_changed' })
      } })
      await f.generate('swipe')
      const b = await f.read()
      expect(b.candidates.filter(item => item.status === 'completed')).toHaveLength(2)
      const raw = await f.runtime.getAgentTranscriptPage({ agentSessionId: f.session.id, limit: 100 })
      expect(JSON.stringify(raw.entries)).toContain('CANDIDATE_A_EDITED')
      expect(JSON.stringify(raw.entries)).toContain('CANDIDATE_B')
      const displayB = await f.runtime.getAgentTranscriptPage({ agentSessionId: f.session.id, limit: 100, selectedCandidates: true })
      expect(JSON.stringify(displayB.entries)).not.toContain('CANDIDATE_A')
      expect(JSON.stringify(displayB.entries)).toContain('CANDIDATE_B')
      expect(displayB.entries.filter(item => item.entry.kind === 'message' && item.entry.role === 'user')).toHaveLength(1)
      const selected = await f.runtime.selectNarrativeSwipe({ ...f.target, groupId: b.id, candidateId: a.selectedCandidateId!, expectedRevision: b.revision, expectedHeadNodeId: (await f.narratives.getBranch(f.target.branchId))!.headNodeId! })
      const displayA = await f.runtime.getAgentTranscriptPage({ agentSessionId: f.session.id, limit: 100, selectedCandidates: true })
      expect(JSON.stringify(displayA.entries)).toContain('CANDIDATE_A_EDITED')
      expect(JSON.stringify(displayA.entries)).not.toContain('CANDIDATE_B')
      expect(displayA.session.entryCount).toBe(raw.session.entryCount)
      expect(selected.page.nodes.at(-1)?.body.raw).toBe('CANDIDATE_A_EDITED')
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 75 })
      expect(JSON.stringify((await f.runtime.getPromptResource({ resourceId: lore.id })).resource)).toContain('CURRENT_RESOURCE_AFTER_A')
      f.configure({ content: 'CANDIDATE_C', coins: 40 })
      await f.generate('regenerate')
      const c = await f.read()
      expect(c.candidates.find(item => item.id === a.selectedCandidateId)?.status).toBe('discarded')
      expect(c.candidates.filter(item => item.status === 'completed')).toHaveLength(1)
    } finally { f.engine.close() }
  })

  it('keeps reset candidates discarded after abandoning a replacement that already wrote a partial result', async () => {
    const f = await setup()
    try {
      await f.runtime.invokeAgentTurn(f.request)
      const a = await f.read()
      f.configure({ content: 'PARTIAL_B', coins: 5, afterWrite: async () => { throw new Error('Interrupted after writes') } })
      await expect(f.generate('regenerate')).rejects.toThrow('Interrupted after writes')
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 5 })
      expect(await f.read()).toMatchObject({ suspended: true, canSelect: false })
      const recovery = await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.session.id })
      const coldTarget = { runId: recovery!.continuation.sourceRunId, agentSessionId: f.session.id }
      expect(await callApplicationRpc(f.runtime, 'application.agent.run.state', coldTarget)).toMatchObject({ state: 'suspended' })
      expect(await callApplicationRpc(f.runtime, 'application.agent.run.abandon', coldTarget)).toMatchObject({ accepted: true })
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 100 })
      const reset = await f.read()
      expect(reset.canSelect).toBe(true)
      expect(reset.selectedCandidateId).not.toBe(a.selectedCandidateId)
      expect(reset.candidates.find(candidate => candidate.id === a.selectedCandidateId)?.status).toBe('discarded')
      expect((await f.narratives.getBranch(f.target.branchId))!.headNodeId).toBe('input')
    } finally { f.engine.close() }
  })

  it('keeps a suspended attempt until abandonment and retries even without an initial reply', async () => {
    const f = await setup()
    try {
      f.configure({ beforeGenerate: async () => { throw new Error('Gateway unavailable') } })
      await expect(f.runtime.invokeAgentTurn(f.request, { agentRun: { runId: 'failed-original', onEvent: () => {} } })).rejects.toThrow('Gateway unavailable')
      const suspended = await f.read()
      expect(suspended).toMatchObject({ suspended: true, canGenerate: false })
      await f.agents.appendEntries({ actor: { kind: 'kernel', id: 'test' }, agentSessionId: f.session.id,
        expectedEntryCount: (await f.agents.getSession(f.session.id))!.entryCount,
        entries: [{ runId: 'failed-original', entry: { kind: 'run-state', state: 'discarded' } }],
      })
      for (const settled of await Promise.all([f.read(), f.read()]))
        expect(settled).toMatchObject({ canGenerate: true, selectedCandidateId: suspended.activeCandidateId })
      f.configure({ beforeGenerate: undefined })
      await f.generate('retry')
      expect((await f.read()).candidates.filter(item => item.status === 'completed')).toHaveLength(1)
    } finally { f.engine.close() }
  })

  it('persists an empty third candidate, switches its State and transcript, and resets all candidates before generating', async () => {
    const f = await setup()
    try {
      await f.runtime.invokeAgentTurn(f.request)
      f.configure({ content: 'CANDIDATE_B', coins: 60 })
      await f.generate('swipe')
      const b = await f.read()
      f.configure({ completeNext: true })
      await f.generate('swipe')
      const empty = await f.read()
      expect(empty.candidates).toHaveLength(3)
      expect(empty.candidates.at(-1)).toMatchObject({ id: empty.selectedCandidateId, status: 'failed', preview: '' })
      expect(empty.candidates.at(-1)?.nodeId).toBeUndefined()
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 100 })
      const transcript = await f.runtime.getAgentTranscriptPage({ agentSessionId: f.session.id, selectedCandidates: true, limit: 100 })
      expect(JSON.stringify(transcript.entries)).not.toContain('CANDIDATE_B')
      expect(transcript.entries.some(entry => entry.entry.kind === 'message' && entry.entry.role === 'assistant')).toBe(true)
      const selected = await f.runtime.selectNarrativeSwipe({ ...f.target, groupId: empty.id,
        candidateId: b.selectedCandidateId!, expectedRevision: empty.revision, expectedHeadNodeId: 'input' })
      expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 60 })
      const restored = await f.runtime.selectNarrativeSwipe({ ...f.target, groupId: empty.id,
        candidateId: empty.selectedCandidateId!, expectedRevision: selected.swipe.revision, expectedHeadNodeId: selected.page.branch.headNodeId! })
      expect(restored.page.branch.headNodeId).toBe('input')
      expect(restored.swipe.canGenerate).toBe(true)
      f.configure({ content: 'RESET_RESULT', beforeGenerate: async input => {
        const resetting = await f.read()
        expect(resetting.candidates.filter(candidate => candidate.status !== 'discarded')).toHaveLength(1)
        expect(JSON.stringify(input.request.messages)).not.toContain('CANDIDATE_B')
        expect((await f.runtime.getStateSnapshot({ target: f.stateTarget })).snapshot.value).toMatchObject({ coins: 100 })
      } })
      await f.generate('retry')
      const reset = await f.read()
      expect(reset.candidates.filter(candidate => candidate.status !== 'discarded')).toHaveLength(1)
      await expect(f.runtime.selectNarrativeSwipe({ ...f.target, groupId: reset.id, candidateId: b.selectedCandidateId!,
        expectedRevision: reset.revision, expectedHeadNodeId: (await f.narratives.getBranch(f.target.branchId))!.headNodeId! })).rejects.toMatchObject({ code: 'narrative.swipe_candidate_missing' })
    } finally { f.engine.close() }
  })
})
