import { setTimeout as delay } from 'node:timers/promises'
import { defaultSessionSummaryPolicy, type ApplicationRuntime, type AgentRunEvent } from '@loom-studio/application-runtime'
import { AgentStoreError } from '@loom-studio/application-data'
import { extensionInstallationId, type ExtensionAgentTaskCreate, type ExtensionAgentTaskInvoke,
  type ExtensionAgentTaskResult, type ExtensionAgentTaskSnapshot, type ExtensionAgentTaskProgress,
  type ExtensionAgentTaskProgressEvent } from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { getAgentRunService } from '../agents/agent-run-service.js'

type Owner = { packageId: string; installationId: string }
type Target = { timelineId: string; branchId: string }
type Ownership = Owner & Target & { sessionId: string; presetId: string; title?: string;
  lifecycle?: 'persistent' | 'temporary'; runId?: string; result?: ExtensionAgentTaskResult;
  acknowledged?: boolean; sessionReleased?: boolean }
const documentType = 'application.extension-agent-task'
const documentId = (sessionId: string) => `extension-agent-task:${sessionId}`

export function createExtensionAgentTasks({ runtime, documents }: { runtime: ApplicationRuntime; documents: DocumentStore }) {
  const runs = getAgentRunService(runtime)
  const invoking = new Set<string>()
  async function requireTask(owner: Owner, target: Target, sessionId: string, signal?: AbortSignal, includeTombstone = false) {
    signal?.throwIfAborted()
    const document = await documents.get(documentId(sessionId), { includeTombstone }) as DocumentRecord<Ownership> | null
    const record = document?.content
    if (document?.type !== documentType || document.meta.ownerExtensionId !== undefined || document.meta.ownerInstallationId !== undefined || !record || record.sessionId !== sessionId
      || record.packageId !== owner.packageId || record.installationId !== owner.installationId
      || record.timelineId !== target.timelineId || record.branchId !== target.branchId) {
      throw new Error('Extension Agent task does not belong to this installation and Timeline branch')
    }
    if (!record.sessionReleased && !record.acknowledged) {
      const { session } = await runtime.getAgentSession({ agentSessionId: sessionId })
      if (session.deletedAt || session.timelineId !== target.timelineId || session.agentPresetId !== record.presetId)
        throw new Error('Extension Agent task Session binding is unavailable')
    }
    signal?.throwIfAborted()
    return document
  }
  async function save(document: DocumentRecord<Ownership>, changes: Partial<Ownership>) {
    await documents.write({ id: document.id, type: documentType, expectedVersion: document.version,
      content: { ...document.content, ...changes } as JsonValue })
  }
  async function releaseSession(sessionId: string) {
    try { await runtime.deleteAgentSession({ agentSessionId: sessionId }) }
    catch (error) {
      // A crash can occur between Session deletion and recording the release.
      if (!(error instanceof AgentStoreError) || error.code !== 'agent.session_not_found') throw error
    }
  }
  async function transcriptSnapshot(record: Ownership): Promise<ExtensionAgentTaskSnapshot> {
    let cursor: string | undefined
    let lastOutput: string | undefined
    let state: ExtensionAgentTaskSnapshot['state'] = 'idle'
    let runId = record.runId
    let outputSequence = -1
    let stateSequence = -1
    do {
      const page = await runtime.getAgentTranscriptPage({ agentSessionId: record.sessionId, cursor, limit: 100 })
      for (const item of page.entries) {
        if (record.runId && item.runId !== record.runId) continue
        if (item.entry.kind === 'message' && item.entry.role === 'assistant' && item.sequence > outputSequence) {
          lastOutput = item.entry.content
          outputSequence = item.sequence
        }
        if (item.entry.kind === 'run-state' && item.sequence > stateSequence) {
          stateSequence = item.sequence
          runId = item.runId
          const saved = item.entry.state
          state = saved === 'created' || saved === 'running' ? 'interrupted'
            : saved === 'aborted' || saved === 'discarded' ? 'cancelled' : saved
        }
      }
      cursor = page.nextCursor
    } while (cursor)
    return { sessionId: record.sessionId, presetId: record.presetId, ...(record.title === undefined ? {} : { title: record.title }),
      state, ...(runId ? { runId } : {}), ...(lastOutput === undefined ? {} : { lastOutput }) }
  }
  async function read(owner: Owner, target: Target, sessionId: string, signal?: AbortSignal): Promise<ExtensionAgentTaskSnapshot> {
    const { content: record } = await requireTask(owner, target, sessionId, signal)
    if (record.result) return { sessionId, presetId: record.presetId, ...(record.title === undefined ? {} : { title: record.title }),
      state: record.result.state, runId: record.result.runId, result: record.result,
      ...(record.result.state === 'completed' ? { lastOutput: record.result.text } : {}) }
    const snapshot: ExtensionAgentTaskSnapshot = record.runId
      ? { sessionId, presetId: record.presetId, ...(record.title === undefined ? {} : { title: record.title }), runId: record.runId, state: 'running' }
      : await transcriptSnapshot(record)
    if (record.runId) {
      const page = await runs.subscribe(record.runId, 0, sessionId)
      snapshot.state = page.pendingApprovals?.length ? 'waiting-approval' : page.state
    } else {
      const task = (await runs.list({ timelineId: target.timelineId })).tasks.find(task => task.agentSessionId === sessionId)
      if (task) snapshot.state = task.state === 'discarded' ? 'cancelled' : task.state
    }
    signal?.throwIfAborted()
    return snapshot
  }
  async function finish(record: Ownership, runId: string): Promise<ExtensionAgentTaskResult> {
    const page = await runs.subscribe(runId, 0, record.sessionId)
    const base = { sessionId: record.sessionId, runId }
    for (const event of [...page.events].reverse()) {
      if (event.type === 'completed') {
        const assistant = event.result.entries.assistant.entry
        if (assistant.kind !== 'message') throw new Error('Agent task completed without an assistant message')
        return { ...base, state: 'completed', text: assistant.content,
          ...(event.result.provider.usage === undefined ? {} : { usage: event.result.provider.usage }) }
      }
      if (event.type === 'failed') return { ...base, state: 'failed', error: { code: event.error.name, message: event.error.message } }
      if (event.type === 'cancelled' || event.type === 'suspended') return { ...base, state: event.type,
        ...(event.reason === undefined ? {} : { reason: event.reason }) }
    }
    const snapshot = await transcriptSnapshot({ ...record, runId })
    if (snapshot.state === 'completed' && snapshot.lastOutput !== undefined) return { ...base, state: 'completed', text: snapshot.lastOutput }
    if (snapshot.state === 'failed') return { ...base, state: 'failed', error: { code: 'agent.task_failed', message: 'Agent task failed; detailed event replay is unavailable' } }
    return { ...base, state: snapshot.state === 'cancelled' || snapshot.state === 'suspended' ? snapshot.state : 'interrupted' }
  }
  async function deleteTask(document: DocumentRecord<Ownership>) {
    if (document.meta.tombstone) return
    await save(document, { acknowledged: true })
    await releaseSession(document.content.sessionId)
    const latest = await documents.get(document.id)
    if (latest) await documents.delete({ id: latest.id, expectedVersion: latest.version })
  }
  return {
    // Called before extension activation. Results survive recovery until explicitly acknowledged.
    async recover() {
      let cursor: string | undefined
      do {
        const page = await documents.list({ type: documentType, limit: 100, cursor })
        for (const raw of page.items) {
          // Extension-owned Documents may reuse a type string, never host task authority.
          if (raw.meta.ownerExtensionId !== undefined || raw.meta.ownerInstallationId !== undefined) continue
          const document = raw as DocumentRecord<Ownership>
          const record = document.content
          if (document.id !== documentId(record.sessionId) || record.lifecycle !== 'temporary') continue
          if (record.acknowledged) { await deleteTask(document); continue }
          if (record.sessionReleased) continue
          const task = (await runs.list({ timelineId: record.timelineId })).tasks.find(task => task.agentSessionId === record.sessionId)
          if (task?.state === 'running') continue
          let result = record.result
          if (!result) {
            try {
              const recoveredRunId = record.runId ?? (await transcriptSnapshot(record)).runId
              result = recoveredRunId ? await finish(record, recoveredRunId)
                : { sessionId: record.sessionId, runId: '', state: 'interrupted', reason: 'Server restarted before task execution' }
            } catch (error) {
              if (!(error instanceof AgentStoreError) || error.code !== 'agent.session_not_found') throw error
              result = { sessionId: record.sessionId, runId: record.runId ?? '', state: 'interrupted', reason: 'Task Session was deleted before its result was recorded' }
            }
          }
          await save(document, { result })
          await releaseSession(record.sessionId)
          const latest = await documents.get(document.id) as DocumentRecord<Ownership>
          await save(latest, { sessionReleased: true })
        }
        cursor = page.nextCursor
      } while (cursor)
    },
    async create(owner: Owner, target: Target, input: ExtensionAgentTaskCreate, signal?: AbortSignal) {
      signal?.throwIfAborted()
      let presetId: string
      if ('presetId' in input) {
        presetId = input.presetId
        if (!presetId.trim()) throw new Error('Agent task presetId is required')
      } else {
        if (!input.presetContributionId.trim()) throw new Error('Agent task presetContributionId is required')
        const matches: string[] = []
        let cursor: string | undefined
        do {
          signal?.throwIfAborted()
          const page = await runtime.listAgentPresets({ limit: 100, cursor })
          for (const preset of page.agentPresets) {
            const origin = preset.origin
            if (origin?.kind === 'extension-package' && origin.packageId === owner.packageId
              && (origin.installationId ?? extensionInstallationId(origin.packageId, { kind: 'global' })) === owner.installationId
              && origin.contributionId === input.presetContributionId) matches.push(preset.id)
          }
          cursor = page.nextCursor
        } while (cursor)
        if (matches.length !== 1) throw new Error(`Agent task preset contribution must resolve to exactly one owned Preset: ${input.presetContributionId}`)
        presetId = matches[0]!
      }
      signal?.throwIfAborted()
      const { session } = await runtime.createAgentSession({ agentPresetId: presetId, timelineId: target.timelineId,
        ...(input.title === undefined ? {} : { title: input.title }) }, { abortSignal: signal })
      await runtime.updateAgentSession({ agentSessionId: session.id, summaryPolicy: { ...defaultSessionSummaryPolicy, enabled: false } }, { abortSignal: signal })
      await documents.write({ id: documentId(session.id), type: documentType, expectedVersion: 'new',
        content: { ...owner, ...target, sessionId: session.id, presetId, lifecycle: input.lifecycle ?? 'persistent', ...(input.title === undefined ? {} : { title: input.title }) } })
      return read(owner, target, session.id, signal)
    },
    read,
    async invoke(owner: Owner, target: Target, input: ExtensionAgentTaskInvoke, signal?: AbortSignal, observation?: import('@loom-studio/extension-host').ExtensionObservationContext): Promise<ExtensionAgentTaskResult> {
      const document = await requireTask(owner, target, input.sessionId, signal)
      if (!input.input.trim()) throw new Error('Agent task input is required')
      if (invoking.has(input.sessionId)) throw new Error('Agent task is already running')
      if (document.content.lifecycle === 'temporary' && (document.content.runId || document.content.result)) throw new Error('Temporary Agent task can only be invoked once')
      invoking.add(input.sessionId)
      let runId: string | undefined
      const abort = () => { if (runId) runs.cancel(runId, 'extension-scope-ended') }
      try {
        const started = await runs.create({ agentSessionId: input.sessionId, input: input.input, contextMode: 'isolated',
          ...(input.activationFacts === undefined ? {} : { activationFacts: structuredClone(input.activationFacts) }) }, {
          actor: { kind: 'extension', id: owner.packageId }, observationOrigin: { ...observation, ...owner },
        })
        runId = started.runId
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        const { result: _previous, ...record } = document.content
        await documents.write({ id: document.id, type: documentType, expectedVersion: document.version, content: { ...record, runId } as JsonValue })
        while (!(await runs.subscribe(runId, 0, input.sessionId)).done) await delay(50)
        const result = await finish(record, runId)
        const latest = await documents.get(document.id) as DocumentRecord<Ownership>
        await save(latest, { result })
        runs.acknowledgeCompletion(runId)
        return result
      } finally {
        signal?.removeEventListener('abort', abort)
        invoking.delete(input.sessionId)
      }
    },
    async subscribe(owner: Owner, target: Target, input: { sessionId: string; cursor?: number }, signal?: AbortSignal): Promise<ExtensionAgentTaskProgress> {
      const snapshot = await read(owner, target, input.sessionId, signal)
      if (!snapshot.runId) return { snapshot, events: [], nextCursor: 0, replayExpired: false, pendingApprovals: [], done: snapshot.state !== 'idle' }
      const document = await requireTask(owner, target, input.sessionId, signal)
      if (document.content.sessionReleased) return { snapshot, events: [], nextCursor: input.cursor ?? 0, replayExpired: true, pendingApprovals: [], done: true }
      const page = await runs.subscribe(snapshot.runId, input.cursor, input.sessionId)
      signal?.throwIfAborted()
      return { snapshot, events: page.events.flatMap(progressEvents), nextCursor: page.nextCursor,
        replayExpired: page.replayExpired ?? false, ...(page.partialText === undefined ? {} : { partialText: page.partialText }),
        pendingApprovals: (page.pendingApprovals ?? []).flatMap(event => event.type === 'mutation-approval-requested' || event.type === 'history-read-approval-requested'
          ? [{ requestId: event.requestId, kind: event.type === 'mutation-approval-requested' ? 'mutation' as const : 'history-read' as const }] : []), done: page.done }
    },
    async acknowledge(owner: Owner, target: Target, sessionId: string, signal?: AbortSignal) {
      const document = await requireTask(owner, target, sessionId, signal, true)
      if (document.meta.tombstone) return
      if (!document.content.result) throw new Error('Agent task has no durable result to acknowledge')
      if (document.content.lifecycle === 'temporary') await deleteTask(document)
    },
    async dispose(owner: Owner, target: Target, sessionId: string, signal?: AbortSignal) {
      let document = await requireTask(owner, target, sessionId, signal, true)
      if (document.meta.tombstone) return
      while (invoking.has(sessionId) && !document.content.runId) {
        await delay(50)
        document = await requireTask(owner, target, sessionId, signal, true)
      }
      if (document.content.runId && !document.content.sessionReleased) {
        const page = await runs.subscribe(document.content.runId, 0, sessionId)
        if (!page.done) runs.cancel(document.content.runId, 'extension-task-disposed')
        while (invoking.has(sessionId) || !(await runs.subscribe(document.content.runId, 0, sessionId)).done) await delay(50)
      }
      const latest = await documents.get(document.id) as DocumentRecord<Ownership>
      await deleteTask(latest)
    },
    async cancel(owner: Owner, target: Target, sessionId: string, signal?: AbortSignal) {
      const document = await requireTask(owner, target, sessionId, signal)
      if (!document.content.runId || document.content.result) return { sessionId, accepted: false }
      const page = await runs.subscribe(document.content.runId, 0, sessionId)
      if (page.done) return { sessionId, accepted: false }
      return { sessionId, ...runs.cancel(document.content.runId, 'extension-task-cancelled') }
    },
  }
}

function progressEvents(event: AgentRunEvent): ExtensionAgentTaskProgressEvent[] {
  switch (event.type) {
    case 'text-delta': case 'reasoning-delta': return [{ type: event.type, delta: event.delta }]
    case 'tool-input-delta': return [{ type: event.type, delta: event.delta, toolCallId: event.toolCallId, ...(event.toolName === undefined ? {} : { toolName: event.toolName }) }]
    case 'usage': return [{ type: 'usage', usage: event.usage }]
    case 'transcript-appended': return event.entries.flatMap(({ entry }) => entry.kind === 'tool-invocation' || entry.kind === 'tool-result'
      ? [{ type: 'tool' as const, invocationId: entry.invocationId, toolId: entry.toolId, phase: entry.kind === 'tool-invocation' ? 'invocation' as const : 'result' as const, status: entry.status }] : [])
    case 'mutation-approval-requested': case 'history-read-approval-requested': return [{ type: 'state', state: 'waiting-approval' }]
    case 'started': return [{ type: 'state', state: 'running' }]
    case 'completed': return [{ type: 'state', state: 'completed' }]
    case 'failed': return [{ type: 'state', state: 'failed', message: event.error.message }]
    case 'cancelled': case 'suspended': return [{ type: 'state', state: event.type, ...(event.reason === undefined ? {} : { message: event.reason }) }]
  }
}
