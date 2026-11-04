import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { callApplicationRpc } from '../../support/trpc-caller.js'
import { createApplicationRuntime, createOfficialAgentToolRegistry, type GatewayChatResult } from '@loom-studio/application-runtime'

const text = (content: string): GatewayChatResult => ({ provider: 'test', model: 'test', text: content, message: { role: 'assistant', content } })
const call = (name: string, content = ''): GatewayChatResult => ({ provider: 'test', model: 'test', text: content, finishReason: 'tool_call',
  message: { role: 'assistant', content, tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: '{}' } }] } })

async function fixture(mode: 'declared' | 'automatic' = 'automatic', openingContent = '') {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const queue: GatewayChatResult[] = []
  const requests: Array<Array<{ role: string; content?: unknown }>> = []
  let beforeRequest: (() => Promise<void>) | undefined
  const runtime = createApplicationRuntime({ dataEngine: engine, agents, narratives, agentTools: createOfficialAgentToolRegistry(),
    documents: createSqliteDocumentStore({ engine }), promptResources: createPromptResourceStore({ engine }),
    gateway: { invokeChat: async input => {
      requests.push(input.request.messages)
      await beforeRequest?.()
      const result = queue.shift()
      if (!result) throw new Error('Unexpected extra Provider call')
      return result
    } },
  })
  await runtime.initialize()
  const { card } = await runtime.createCard({ name: 'Timeline Session' })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent })
  const target = { timelineId: timeline.id, branchId: branch.id }
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Timeline writer' })).resource
  const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test'] })
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: preset.version,
    model: { providerProfileId: providerProfile.id, modelId: 'test' } })
  await runtime.replacePresetToolMounts({ expectedMountIds: (await runtime.listPresetToolMounts({ presetId: preset.id })).mounts.map(mount => mount.id), presetId: preset.id, mounts: [{ toolId: 'official/read_state', orderIndex: 0, defaultEnabled: true }] })
  await callApplicationRpc(runtime, 'application.updateAgentSession', { agentSessionId: timeline.id, agentPresetId: preset.id, narrativeMode: mode })
  const append = async (content: string) => {
    const current = (await narratives.getBranch(target.branchId))!
    return runtime.appendNarrativeInput({ ...target, nodeId: `input-${content}`, expectedHeadNodeId: current.headNodeId ?? null, content })
  }
  const roleplay = async (content: string, outputs: GatewayChatResult[]) => {
    const { node } = await append(content)
    queue.push(...outputs)
    await runtime.invokeAgentTurn({ agentSessionId: timeline.id, input: content, narrativeTarget: { ...target, inputNodeId: node.id } })
    return node
  }
  const discuss = async (content: string, output: string) => {
    queue.push(text(output))
    await runtime.invokeAgentTurn({ agentSessionId: timeline.id, input: content, narrativeTarget: target })
  }
  return { engine, runtime, agents, narratives, timeline, target, preset, queue, requests, append, roleplay, discuss,
    beforeRequest(callback?: () => Promise<void>) { beforeRequest = callback },
  }
}

describe('unified Timeline Session', () => {
  it('returns distinct exchange identities on repeated transcript reads', async () => {
    const f = await fixture('declared')
    try {
      await f.discuss('First input', 'Same reply')
      await f.discuss('Second input', 'Same reply')
      const read = () => f.runtime.getAgentTranscriptPage({ agentSessionId: f.timeline.id, limit: 100 })
      const page = await read()
      const messages = page.entries.filter(item => item.entry.kind === 'message')
      const inputs = messages.filter(item => item.entry.kind === 'message' && item.entry.role === 'user')
      const replies = messages.filter(item => item.entry.kind === 'message' && item.entry.role === 'assistant')
      expect(replies.map(item => item.timelinePosition?.exchangeId)).toEqual(inputs.map(item => item.id))
      expect(replies.every(item => !!item.entry.streamId)).toBe(true)
      expect(new Set(replies.map(item => item.entry.streamId)).size).toBe(2)
      expect((await read()).entries).toEqual(page.entries)
    } finally { f.engine.close() }
  })

  it('keeps accepted discussion input visible after a provider failure without material changes', async () => {
    const f = await fixture('declared')
    try {
      await f.discuss('First input', 'First reply')
      f.beforeRequest(async () => { throw new Error('Provider unavailable') })
      await expect(f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: 'Keep my latest input',
        narrativeTarget: f.target })).rejects.toThrow('Provider unavailable')
      const session = (await f.agents.getSession(f.timeline.id))!
      const entries = await f.agents.listEntries(f.timeline.id)
      const reachable = []
      let cursor = session.headEntryId
      while (cursor) {
        const entry = entries.find(item => item.id === cursor)!
        reachable.push(entry)
        cursor = entry.parentEntryId
      }
      expect(reachable.some(item => item.entry.kind === 'message' && item.entry.role === 'user'
        && item.entry.content === 'Keep my latest input')).toBe(true)
    } finally { f.engine.close() }
  })

  it.each(['OPENING', ''])('retries communication Narrative without a roleplay input after %j, preserving all adopted heads', async opening => {
    const f = await fixture('declared', opening)
    try {
      const baseline = (await f.narratives.getBranch(f.target.branchId))!
      const stateTarget = { scope: 'timeline' as const, ...f.target }
      f.queue.push(call('declare_narrative'), text('COMMUNICATION_STORY'), call('read_state'), text('WORK_AFTER_STORY'))
      await f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: 'Tell the story from this guidance', narrativeTarget: f.target })
      const original = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      expect(original).toMatchObject({ inputKind: 'communication', inputNodeId: baseline.headNodeId, canGenerate: true, inputs: [] })
      const originalCandidate = original.selectedCandidateId!
      const state = (await f.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      await f.runtime.applyStateMutation({ target: stateTarget, expectedRevisionId: state.revisionId, operations: [{ op: 'set', path: '/choice', value: 'original' }] })
      const workspace = await f.runtime.getTimelineWorkspace(f.target)
      await f.runtime.mutateTimelineWorkspace({ ...f.target, expectedRevisionId: workspace.id, operations: [{ kind: 'write', entryId: 'memory', content: 'ORIGINAL MEMORY' }] })
      const originalHead = (await f.narratives.getBranch(f.target.branchId))!
      f.beforeRequest(async () => {
        f.beforeRequest()
        const restored = (await f.narratives.getBranch(f.target.branchId))!
        expect(restored).toMatchObject({ headNodeId: baseline.headNodeId, stateHeadRevisionId: baseline.stateHeadRevisionId,
          workspaceHeadRevisionId: baseline.workspaceHeadRevisionId })
        const history = (await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries
        expect(history.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
        expect(history.find(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')!.entry)
          .toEqual({ kind: 'message', role: 'user', content: 'Tell the story from this guidance' })
      })
      f.queue.push(call('declare_narrative'), text('ALTERNATIVE_STORY'), call('read_state'), text('ALTERNATIVE_WORK'))
      await f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: '', narrativeTarget: { ...f.target,
        swipe: { groupId: original.id, expectedRevision: original.revision, mode: 'swipe' } } })
      f.beforeRequest()
      expect(JSON.stringify(f.requests.at(-4))).toContain('Tell the story from this guidance')
      expect(JSON.stringify(f.requests.at(-4))).not.toContain('COMMUNICATION_STORY')
      expect(JSON.stringify(f.requests.at(-4))).not.toContain('WORK_AFTER_STORY')
      const alternativeHead = (await f.narratives.getBranch(f.target.branchId))!
      const latest = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      const selected = await f.runtime.selectNarrativeSwipe({ ...f.target, groupId: latest.id, expectedRevision: latest.revision,
        expectedHeadNodeId: alternativeHead.headNodeId ?? null, candidateId: originalCandidate })
      expect(selected.page.branch).toMatchObject({ headNodeId: originalHead.headNodeId, headEntryId: originalHead.headEntryId,
        stateHeadRevisionId: originalHead.stateHeadRevisionId, workspaceHeadRevisionId: originalHead.workspaceHeadRevisionId })
      expect((await f.agents.getSession(f.timeline.id))!.headEntryId).toBe(originalHead.headEntryId)
      const history = JSON.stringify((await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries)
      expect(history).toContain('WORK_AFTER_STORY')
      expect(history).not.toContain('ALTERNATIVE_WORK')
      expect(selected.page.nodes.map(node => node.body.raw)).toEqual([...(opening ? [opening] : []), 'COMMUNICATION_STORY'])
      expect(selected.page.nodes.every(node => node.kind === 'narrative')).toBe(true)
      expect((await f.runtime.getTimelineWorkspace(f.target)).entries[0]).toMatchObject({ content: { text: 'ORIGINAL MEMORY' } })
      await expect(f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: '', narrativeTarget: { ...f.target,
        swipe: { groupId: latest.id, expectedRevision: selected.swipe.revision, mode: 'swipe', input: 'Edited guidance' } } }))
        .rejects.toMatchObject({ code: 'narrative.swipe_invalid_input' })
      const exported = await f.runtime.exportTimelineArchive({ timelineId: f.timeline.id })
      const imported = await f.runtime.importTimelineArchive({ source: JSON.stringify(exported.archive) })
      const clone = { timelineId: imported.timelineId, branchId: imported.idMap.branchIds[f.target.branchId]! }
      const cloneSwipe = (await f.runtime.getNarrativeSwipes(clone)).swipe!
      expect(cloneSwipe).toMatchObject({ inputKind: 'communication', canGenerate: true, canSelect: true, inputs: [] })
      expect(cloneSwipe.inputNodeId).toBe(baseline.headNodeId ? imported.idMap.nodeIds[baseline.headNodeId] : undefined)
      const clonePage = await f.narratives.getPage({ ...clone, limit: 100 })
      expect(clonePage.nodes.map(node => node.body.raw)).toEqual([...(opening ? [opening] : []), 'COMMUNICATION_STORY'])
      expect(clonePage.nodes.every(node => node.kind === 'narrative')).toBe(true)
      expect((await f.agents.getSession(imported.timelineId))!.headEntryId).toBe(clonePage.branch.headEntryId)
    } finally { f.engine.close() }
  })

  it('adopts ordinary text after declaration and keeps subsequent work outside the story', async () => {
    const f = await fixture('declared')
    try {
      await f.roleplay('draw sword', [call('declare_narrative'), { ...text('ST'), finishReason: 'length' }, text('ORY'), call('read_state'), text('WORK DONE')])
      const page = await f.narratives.getPage({ ...f.target, limit: 100 })
      expect(page.nodes.map(node => node.body.raw)).toEqual(['draw sword', 'STORY'])
      const history = await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })
      expect(history.entries.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
      expect(page.nodes[1]!.entryId).toBe(history.entries.find(entry => entry.entry.kind === 'message' && entry.entry.content === 'STORY')!.id)
      expect(history.entries.some(entry => entry.entry.kind === 'tool-result')).toBe(true)
      expect(history.entries.at(-1)!.entry).toMatchObject({ kind: 'run-state', state: 'completed' })
    } finally { f.engine.close() }
  })

  it('retries a complete multi-output round including discussion, then restores its whole adopted history', async () => {
    const f = await fixture()
    try {
      await f.roleplay('act', [call('read_state', 'FIRST_A'), text('FIRST_B')])
      await f.discuss('GUIDANCE', 'WORK_GUIDANCE')
      const original = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      expect(original.canSelect).toBe(true)
      const originalCandidate = original.selectedCandidateId!
      f.queue.push(text('ALTERNATIVE'))
      await f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: '', narrativeTarget: { ...f.target,
        swipe: { groupId: original.id, expectedRevision: original.revision, mode: 'swipe' } } })
      const replay = JSON.stringify(f.requests.at(-1))
      expect(replay).not.toContain('FIRST_A')
      expect(replay).not.toContain('WORK_GUIDANCE')
      let current = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      const branch = (await f.narratives.getBranch(f.target.branchId))!
      await f.runtime.selectNarrativeSwipe({ ...f.target, groupId: current.id, expectedRevision: current.revision,
        candidateId: originalCandidate, expectedHeadNodeId: branch.headNodeId! })
      const adopted = (await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries
      expect(JSON.stringify(adopted)).toContain('WORK_GUIDANCE')
      expect(JSON.stringify(adopted)).not.toContain('ALTERNATIVE')
      expect((await f.narratives.getPage({ ...f.target, limit: 100 })).nodes.map(node => node.body.raw)).toEqual(['act', 'FIRST_A', 'FIRST_B'])
      current = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      expect(current.canGenerate).toBe(true)
      const firstBody = (await f.narratives.getPage({ ...f.target, limit: 100 })).nodes.find(node => node.body.raw === 'FIRST_A')!
      const fork = await f.runtime.forkNarrativeBranch({ timelineId: f.timeline.id, fromBranchId: f.target.branchId, fromNodeId: firstBody.id })
      await f.runtime.switchNarrativeBranch({ timelineId: f.timeline.id, branchId: fork.branch.id })
      f.target.branchId = fork.branch.id
      const prefix = (await f.agents.getEntryPage({ agentSessionId: f.timeline.id, limit: 100 })).entries
      expect(JSON.stringify(prefix)).not.toContain('FIRST_B')
      const runId = prefix.findLast(entry => entry.entry.kind === 'run-state')!.runId!
      await expect(f.runtime.inspectAgentRunState({ agentSessionId: f.timeline.id, runId })).resolves.toMatchObject({ state: 'cancelled' })
      await expect(f.runtime.prepareAgentRunRecovery({ agentSessionId: f.timeline.id })).resolves.toBeUndefined()
      await f.roleplay('fork act', [text('FORK_STORY')])
      expect((await f.narratives.getPage({ ...f.target, limit: 100 })).nodes.at(-1)!.body.raw).toBe('FORK_STORY')
    } finally { f.engine.close() }
  })

  it('retains unsummarized canonical story across work retirement, preset changes and old forks', async () => {
    const f = await fixture()
    try {
      await f.roleplay('ACT_ONE', [text('STORY_ONE')])
      await f.discuss('GUIDANCE_ONE', 'WORK_ONE')
      const first = (await f.narratives.getPage({ ...f.target, limit: 100 })).nodes.at(-1)!
      await f.roleplay('ACT_TWO', [text('STORY_TWO')])
      const before = (await f.agents.getSession(f.timeline.id))!
      await f.runtime.completeAgentSessionHandoff({ agentSessionId: before.id, expectedEntryCount: before.entryCount, summary: 'WORK SUMMARY', branchId: f.target.branchId })
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: before.id, input: 'NEXT', narrativeTarget: f.target })
      const messages = preview.projection.messages
      expect(messages.filter(message => message.content === 'STORY_ONE')).toHaveLength(1)
      expect(messages.filter(message => message.content === 'STORY_TWO')).toHaveLength(1)
      expect(messages.some(message => message.role === 'assistant' && message.content === 'STORY_ONE')).toBe(true)
      expect(JSON.stringify(messages)).toContain('WORK SUMMARY')
      const replacement = (await f.runtime.createAgentPreset({ name: 'Replacement', model: (await f.runtime.getAgentPreset({ agentPresetId: f.preset.id })).agentPreset.model })).agentPreset
      const changed = await f.runtime.updateAgentSession({ agentSessionId: before.id, agentPresetId: replacement.id })
      expect(changed.session.id).toBe(before.id)
      expect(changed.session.headEntryId).toBe((await f.agents.getSession(before.id))!.headEntryId)
      const fork = await f.runtime.forkNarrativeBranch({ timelineId: f.timeline.id, fromBranchId: f.target.branchId, fromNodeId: first.id })
      await f.runtime.switchNarrativeBranch({ timelineId: f.timeline.id, branchId: fork.branch.id })
      const history = await f.agents.getEntryPage({ agentSessionId: before.id, limit: 100 })
      expect(JSON.stringify(history.entries)).toContain('WORK_ONE')
      expect(JSON.stringify(history.entries)).not.toContain('STORY_TWO')
      expect(history.session.entryCount).toBeGreaterThan(history.entries.at(-1)!.sequence)
      expect((await f.runtime.listAgentSessions({ timelineId: before.id })).sessions).toHaveLength(0)
      await expect(f.runtime.deleteAgentSession({ agentSessionId: before.id })).rejects.toThrow('through its story')
    } finally { f.engine.close() }
  })

  it('rejects old side-work summaries and private context after changing the source candidate', async () => {
    const f = await fixture()
    try {
      await f.roleplay('act', [text('ORIGINAL_STORY')])
      const { session } = await f.runtime.createAgentSession({ agentPresetId: f.preset.id, timelineId: f.timeline.id })
      await expect(callApplicationRpc(f.runtime, 'application.updateAgentSession', { agentSessionId: session.id, title: 'Side work' }))
        .resolves.toMatchObject({ session: { title: 'Side work' } })
      f.queue.push(text('SIDE_PRIVATE_WORK'))
      await f.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'inspect', narrativeTarget: f.target })
      const current = (await f.agents.getSession(session.id))!
      await f.runtime.completeAgentSessionHandoff({ agentSessionId: session.id, branchId: f.target.branchId,
        expectedEntryCount: current.entryCount, summary: 'SIDE_SUMMARY' })
      const group = (await f.runtime.getNarrativeSwipes(f.target)).swipe!
      f.queue.push(text('REPLACEMENT_STORY'))
      await f.runtime.invokeAgentTurn({ agentSessionId: f.timeline.id, input: '', narrativeTarget: { ...f.target,
        swipe: { groupId: group.id, expectedRevision: group.revision, mode: 'swipe' } } })
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'inspect again', narrativeTarget: f.target })
      expect(JSON.stringify(preview.projection.messages)).toContain('REPLACEMENT_STORY')
      expect(JSON.stringify(preview.projection.messages)).not.toContain('SIDE_PRIVATE_WORK')
      expect(JSON.stringify(preview.projection.messages)).not.toContain('SIDE_SUMMARY')
      expect(JSON.stringify((await f.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })).entries)).toContain('SIDE_PRIVATE_WORK')
    } finally { f.engine.close() }
  })

})

it('creates a new story with the chosen preset already bound to its main Session', async () => {
  const f = await fixture()
  try {
    const { card } = await f.runtime.createCard({ name: 'Next story' })
    const created = await callApplicationRpc(f.runtime, 'application.createNarrativeTimeline', { cardId: card.id, agentPresetId: f.preset.id })
    if (!created || typeof created !== 'object' || Array.isArray(created) || !('timeline' in created)) throw new Error('Expected created Timeline')
    const timeline = created.timeline
    if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline) || typeof timeline.id !== 'string') throw new Error('Expected Timeline ID')
    const session = await f.agents.getSession(timeline.id)
    expect(session?.agentPresetId).toBe(f.preset.id)
    await expect(callApplicationRpc(f.runtime, 'application.createNarrativeTimeline', { cardId: card.id, agentPresetId: 'missing-preset' })).rejects.toThrow('Selected Agent Preset is unavailable')
  } finally { f.engine.close() }
})
