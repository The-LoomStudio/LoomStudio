import type { AgentTranscriptEntry, NarrativeNode } from '../../../entities/index.js'
import type { ActiveAgentRun } from './agent-run-observer.js'
import type { NarrativeSessionExecution } from './narrative-execution-view.js'

export type TimelineSessionCommunication = {
  id: string
  anchorNodeId?: string
  execution: NarrativeSessionExecution
  discussions: NarrativeSessionExecution[]
}

export type TimelineSessionRound = {
  id: string
  number: number
  candidateId?: string
  inputNode?: NarrativeNode
  nodes: NarrativeNode[]
  execution: NarrativeSessionExecution
  discussions: NarrativeSessionExecution[]
  communications: TimelineSessionCommunication[]
}

/** Reading order comes from adopted prose; work keeps its canonical position inside each round. */
export function projectTimelineRounds(entries: AgentTranscriptEntry[], nodes: NarrativeNode[], preset: string, activeRun?: ActiveAgentRun, narrativeMode: 'declared' | 'automatic' = 'declared'): TimelineSessionRound[] {
  const byEntry = new Map(entries.map(entry => [entry.id, entry]))
  const byNodeEntry = new Map(nodes.flatMap(node => node.entryId ? [[node.entryId, node] as const] : []))
  const continued = new Set(entries.flatMap(item => item.entry.kind === 'message' && typeof item.entry.continuesEntryId === 'string' ? [item.entry.continuesEntryId] : []))
  const results = new Map(entries.flatMap(item => item.entry.kind === 'tool-result' ? [[item.entry.invocationId, item] as const] : []))
  const firstNarrativeEntries = new Map<string, AgentTranscriptEntry>()
  for (const item of entries) if (item.entry.kind === 'message' && item.entry.purpose === 'narrative'
    && typeof item.entry.narrativeId === 'string' && !firstNarrativeEntries.has(item.entry.narrativeId)) firstNarrativeEntries.set(item.entry.narrativeId, item)
  const originalEntry = (node: NarrativeNode) => (node.source?.agentMessageId ? byEntry.get(node.source.agentMessageId) : undefined)
    ?? firstNarrativeEntries.get(node.id) ?? (node.entryId ? byEntry.get(node.entryId) : undefined)
  const roundNumbers = new Map<string, number>()
  let number = 0
  for (const item of entries) if (item.entry.kind === 'message' && item.entry.role === 'user' && item.entry.purpose === 'narrative') {
    if (typeof item.entry.narrativeId === 'string' && firstNarrativeEntries.get(item.entry.narrativeId) !== item) continue
    roundNumbers.set(item.roundId ?? item.id, ++number)
  }
  const makeExecution = (id: string): NarrativeSessionExecution => ({ id, preset, state: 'completed', steps: [] })
  const rounds: TimelineSessionRound[] = []
  const nodeRounds = new Map<string, TimelineSessionRound>()
  let current: TimelineSessionRound | undefined
  let fallbackNumber = 0
  for (const node of nodes) {
    const record = originalEntry(node)
    const key = record?.roundId
    if (!current || node.kind === 'user-input') {
      if (node.kind === 'user-input') fallbackNumber++
      const id = key ?? node.id
      current = { id, number: roundNumbers.get(id) ?? fallbackNumber, nodes: [],
        execution: makeExecution(`${id}:writing`), discussions: [], communications: [] }
      rounds.push(current)
    }
    current.nodes.push(node)
    if (node.kind === 'user-input') current.inputNode = node
    nodeRounds.set(node.id, current)
  }
  const byRound = new Map(rounds.map(round => [round.id, round]))
  for (const node of nodes) {
    const record = originalEntry(node)
    if (record?.roundId && !byRound.has(record.roundId)) byRound.set(record.roundId, nodeRounds.get(node.id)!)
  }
  // A branch-local revision has a new content Entry while retaining its original
  // writer Run. Use that Run's positions only when the whole set is loaded.
  const nodesByRun = new Map<string, NarrativeNode[]>()
  for (const node of nodes) if (node.kind === 'narrative' && node.source?.runId) {
    const group = nodesByRun.get(node.source.runId) ?? []
    group.push(node)
    nodesByRun.set(node.source.runId, group)
  }
  const messagesByRun = new Map<string, AgentTranscriptEntry[]>()
  for (const item of entries) if (item.runId && item.entry.kind === 'message' && item.entry.role === 'assistant'
    && item.entry.purpose === 'narrative' && item.entry.state !== 'partial' && !continued.has(item.id)) {
    const group = messagesByRun.get(item.runId) ?? []
    group.push(item)
    messagesByRun.set(item.runId, group)
  }
  const originNodes = new Map<string, NarrativeNode>()
  for (const [runId, runNodes] of nodesByRun) {
    const messages = messagesByRun.get(runId) ?? []
    if (messages.length === runNodes.length) messages.forEach((entry, index) => originNodes.set(entry.id, runNodes[index]!))
  }
  for (const node of nodes) {
    const original = originalEntry(node)
    if (original) originNodes.set(original.id, node)
  }
  const rendered = new Set<string>()
  const executionsByRun = new Map<string, NarrativeSessionExecution>()
  const declared = new Set<string>()
  const latestUserEntryId = entries.findLast(item => item.entry.kind === 'message' && item.entry.role === 'user')?.id
  const latestNodes = new Map<TimelineSessionRound, string>()
  // A discussion keeps the adopted position at its input, even if that Run appends prose.
  const discussionAnchors = new Map<NarrativeSessionExecution, string | undefined>()
  const replyAnchors = new Map<string, string | undefined>()
  current = undefined
  const preparation = (): TimelineSessionRound => {
    let round = rounds.find(item => item.id === 'preparation')
    if (!round) {
      round = { id: 'preparation', number: 0, nodes: [], execution: makeExecution('preparation:writing'), discussions: [], communications: [] }
      rounds.unshift(round)
      byRound.set(round.id, round)
    }
    return round
  }
  for (const item of entries) {
    if (continued.has(item.id)) continue
    const data = item.entry
    const node = originNodes.get(item.id) ?? byNodeEntry.get(item.id)
    if (node) {
      if (rendered.has(node.id)) continue
      current = nodeRounds.get(node.id)!
      latestNodes.set(current, node.id)
      if (item.candidateId) current.candidateId = item.candidateId
      if (item.runId && node.kind === 'narrative') declared.delete(item.runId)
      if (node.kind === 'narrative') {
        current.execution.steps.push({ id: node.id, kind: 'narrative', title: '正文', content: node.body.raw, state: 'completed' })
      }
      rendered.add(node.id)
      continue
    }
    if (item.roundId) {
      const matching = byRound.get(item.roundId)
      // A first communication attempt may start after an opening, before it has prose of its own.
      if (!matching && current && data.kind === 'message' && data.role === 'user') byRound.set(item.roundId, current)
      else current = matching
    }
    if (data.kind === 'message' && data.purpose === 'narrative' && data.state !== 'partial') continue
    if (!current) {
      if (item.roundId || !['message', 'reasoning', 'tool-invocation', 'tool-input'].includes(data.kind)) continue
      current = preparation()
    }
    if (item.candidateId) current.candidateId = item.candidateId
    const runKey = item.runId ?? current.execution.id
    let execution = executionsByRun.get(runKey)
    if (!execution && data.kind === 'run-state' && typeof data.sourceRunId === 'string') {
      execution = executionsByRun.get(data.sourceRunId)
      if (execution) executionsByRun.set(runKey, execution)
    }
    if (data.kind === 'message' && data.role === 'user' && typeof data.content === 'string') {
      execution = { ...makeExecution(runKey), input: data.content, inputEntryId: item.id, retryable: item.id === latestUserEntryId }
      current.discussions.push(execution)
      discussionAnchors.set(execution, latestNodes.get(current))
      executionsByRun.set(runKey, execution)
    }
    if (!execution) {
      execution = current.execution
      executionsByRun.set(runKey, execution)
    }
    if (item.runId) execution.runId = item.runId
    if (data.kind === 'run-state') {
      const checkpoint = data.recovery && typeof data.recovery === 'object' && !Array.isArray(data.recovery) ? data.recovery : undefined
      if (data.state === 'failed') (execution.failures ??= []).push({ id: item.id, message: typeof data.reason === 'string' ? data.reason : '请求失败，未收到完整输出' })
      execution.resumable = (data.state === 'suspended' || data.state === 'failed') && !!checkpoint
      execution.state = data.state === 'running' || data.state === 'created' ? 'running'
        : execution.resumable ? 'paused' : data.state === 'failed' ? 'failed'
        : data.state === 'aborted' || data.state === 'discarded' ? 'cancelled' : 'completed'
      if (typeof data.reason === 'string' && data.reason !== 'user-pause') execution.error = data.reason
    }
    if (activeRun && activeRun.runId === item.runId) {
      execution.state = activeRun.status === 'running' ? 'running' : activeRun.status === 'suspended' ? 'paused' : activeRun.status
      execution.resumable = activeRun.status === 'suspended'
      execution.error = activeRun.error ?? execution.error
    }
    if (data.kind === 'reasoning' && data.visibility !== 'hidden' && typeof data.content === 'string' && data.content) execution.steps.push({
      id: item.presentationId ?? item.id, kind: 'thinking', title: '思考', content: data.content,
      state: item.id.startsWith('streaming-') && data.state !== 'completed' && activeRun?.runId === item.runId && activeRun?.status === 'running' ? 'running' : 'completed',
    })
    if (data.kind === 'tool-invocation' || data.kind === 'tool-input') {
      const result = results.get(data.invocationId)
      const live = activeRun && activeRun.runId === item.runId && activeRun.status === 'running'
      execution.steps.push({ id: item.presentationId ?? item.id, kind: 'tool', title: String(data.exposedName ?? data.toolId ?? '工具'),
        content: [data.rawInput ?? JSON.stringify(data.arguments, null, 2), result ? JSON.stringify(result.entry.content, null, 2) : undefined].filter(Boolean).join('\n\n'),
        state: live && (data.kind === 'tool-input' || !result) ? 'running' : 'completed' })
    }
    if (data.kind === 'tool-result' && data.toolId === 'official/declare_narrative' && data.status === 'completed') declared.add(runKey)
    if (data.kind === 'message' && data.role === 'assistant' && typeof data.content === 'string' && data.content) {
      const streaming = item.id.startsWith('streaming-') || data.state === 'partial'
      const narrative = data.purpose === 'narrative' || streaming && (declared.has(runKey) || narrativeMode === 'automatic' && execution === current.execution)
      const output = narrative ? current.execution : execution
      if (narrative && activeRun && activeRun.runId === item.runId) output.state = activeRun.status === 'running' ? 'running' : activeRun.status === 'suspended' ? 'paused' : 'completed'
      output.steps.push({ id: item.id, kind: narrative ? 'narrative' : 'reply', role: 'assistant', title: narrative ? '正文' : 'Agent 回复',
        content: data.content, state: streaming && (activeRun?.status === 'running' || activeRun?.status === 'suspended') ? 'running' : 'completed' })
      if (!narrative) replyAnchors.set(item.id, latestNodes.get(current))
      if (!streaming) declared.delete(runKey)
    }
  }
  for (const round of rounds) {
    for (const node of round.nodes) if (node.kind === 'narrative' && !rendered.has(node.id)) {
      round.execution.steps.push({ id: node.id, kind: 'narrative', title: '正文', content: node.body.raw, state: 'completed' })
    }
  }
  if (activeRun && ['running', 'suspended'].includes(activeRun.status) && !executionsByRun.has(activeRun.runId)) {
    const round = rounds.at(-1) ?? preparation()
    const execution = makeExecution(activeRun.runId)
    execution.state = activeRun.status === 'running' ? 'running' : 'paused'
    if (round.execution.steps.length) {
      round.discussions.push(execution)
      discussionAnchors.set(execution, latestNodes.get(round))
    } else round.execution = execution
  }
  for (const round of rounds) {
    const groups = new Map<string | undefined, TimelineSessionCommunication>()
    const groupAt = (anchorNodeId: string | undefined) => {
      let group = groups.get(anchorNodeId)
      if (!group) {
        group = { id: anchorNodeId ?? round.id, anchorNodeId,
          execution: { ...round.execution, steps: [] }, discussions: [] }
        groups.set(anchorNodeId, group)
      }
      return group
    }
    for (const node of round.nodes) groupAt(node.id)
    for (const step of round.execution.steps) if (step.kind === 'reply') groupAt(replyAnchors.get(step.id)).execution.steps.push(step)
    for (const discussion of round.discussions) groupAt(discussionAnchors.get(discussion)).discussions.push(discussion)
    if (!round.nodes.length && !groups.size) groupAt(undefined)
    round.communications = [...groups.values()]
  }
  return rounds
}
