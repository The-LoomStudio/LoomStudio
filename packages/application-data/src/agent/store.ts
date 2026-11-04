import type {
  DataCommitOperation,
  SqliteDataEngine,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'
import { readChatAttachments, createId, isRecord, nowIso, optionalString } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentSummaryTask,
  AgentSession,
  AgentSessionPage,
  AgentSessionRunSummary,
  AgentStore,
  AgentTransaction,
  AgentTranscriptEntry,
  AgentTranscriptEntryData,
  AgentTranscriptPage,
  AgentWriteContext,
  ListAgentSessionsInput,
} from './types.js'

const migrationNamespace = 'application.agent'
const defaultPageLimit = 50
const maximumPageLimit = 100

export class AgentStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AgentStoreError'
  }
}

export type CreateAgentStoreOptions = {
  engine: SqliteDataEngine
  createId?(prefix: string): string
  now?(): string
}

export function createAgentStore(options: CreateAgentStoreOptions): AgentStore {
  const { engine } = options
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso
  engine.initializeSchema({ namespace: migrationNamespace, version: 9, initialize: initializeAgentSchema })

  function transaction(tx: SqliteDataTransaction): AgentTransaction {
    const { database } = tx
    return {
      writeSummaryTask: input => {
        requireSession(database, input.agentSessionId)
        validateId(input.taskId, 'taskId')
        const existing = database.prepare('SELECT agent_session_id FROM agent_summary_tasks WHERE task_id = ?').get(input.taskId)
        if (existing && existing.agent_session_id !== input.agentSessionId) throw new AgentStoreError('agent.summary_owner_invalid', 'Summary task owner cannot change')
        const timestamp = now()
        database.prepare(`INSERT INTO agent_summary_tasks VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(task_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`)
          .run(input.taskId, input.agentSessionId, JSON.stringify(input), timestamp, timestamp)
        tx.recordOperations([operation(existing ? 'update' : 'create', input.taskId, 'agent.summary-task')])
      },
      reviseInterjection: input => {
        const current = requireEntry(database, input.entryId)
        if (current.entry.kind !== 'user-interjection' || input.replacement.kind !== 'user-interjection'
          || JSON.stringify(current.entry) !== JSON.stringify(input.expected)) throw new Error('Input changed; reopen the editor')
        validateTranscriptEntry(input.replacement)
        database.prepare('UPDATE agent_transcript_entries SET entry_json = ? WHERE id = ?').run(JSON.stringify(input.replacement), current.id)
        tx.recordOperations([operation('update', current.id, 'agent.transcript-entry', current.agentSessionId)])
        return { ...current, entry: input.replacement }
      },
      rewindStandalone: input => {
        const session = requireSession(database, input.agentSessionId)
        if (session.kind === 'timeline' || session.headEntryId !== input.expectedHeadEntryId) throw new Error('Session history changed')
        if (input.headEntryId && requireEntry(database, input.headEntryId).agentSessionId !== session.id) throw new Error('Invalid Session head')
        database.prepare('UPDATE agent_sessions SET head_entry_id = ?, updated_at = ? WHERE id = ?').run(input.headEntryId ?? null, now(), session.id)
        tx.recordOperations([operation('update', session.id, 'agent.session', session.timelineId)])
      },
      restoreTimelineEntries: input => {
        const session = requireSession(database, input.agentSessionId)
        if (session.kind !== 'timeline' || session.entryCount !== 0)
          throw new AgentStoreError('agent.archive_target_invalid', 'History restoration requires an empty Timeline Session')
        const entries = [...input.entries].sort((a, b) => a.sequence - b.sequence)
        const saved = new Map<string, AgentTranscriptEntry>()
        let sequence = 0
        for (const entry of entries) {
          validateId(entry.id, 'id')
          validateTranscriptEntry(entry.entry)
          if (entry.agentSessionId !== session.id || !Number.isSafeInteger(entry.sequence) || entry.sequence <= sequence
            || saved.has(entry.id) || entry.parentEntryId !== undefined && !saved.has(entry.parentEntryId))
            throw new AgentStoreError('agent.archive_entry_invalid', 'Invalid archived Entry identity, sequence or parent')
          const path: AgentTranscriptEntry[] = []
          let parent = entry.parentEntryId ? saved.get(entry.parentEntryId) : undefined
          while (parent) { path.push(parent); parent = parent.parentEntryId ? saved.get(parent.parentEntryId) : undefined }
          const calls: ToolInvocationState = new Map()
          for (const ancestor of path.reverse()) {
            if (ancestor.entry.kind === 'tool-invocation') calls.set(ancestor.entry.invocationId, { toolId: ancestor.entry.toolId, hasResult: false })
            if (ancestor.entry.kind === 'tool-result') calls.set(ancestor.entry.invocationId, { toolId: ancestor.entry.toolId, hasResult: true })
          }
          validateTranscriptEntry(entry.entry, calls)
          if (entry.entry.kind === 'message' && entry.entry.continuesEntryId) {
            const continued = saved.get(entry.entry.continuesEntryId)
            if (!continued || continued.entry.kind !== 'message' || !path.some(ancestor => ancestor.id === continued.id))
              throw new AgentStoreError('agent.archive_entry_invalid', 'Archived continuation is outside its parent path')
          }
          insertEntry(database, entry)
          updateToolInvocationState(database, entry, calls)
          saved.set(entry.id, entry)
          sequence = entry.sequence
        }
        if (!Number.isSafeInteger(input.entryCount) || input.entryCount < sequence || input.headEntryId !== undefined && !saved.has(input.headEntryId))
          throw new AgentStoreError('agent.archive_head_invalid', 'Invalid archived Session head or write count')
        database.prepare('UPDATE agent_sessions SET head_entry_id = ?, entry_count = ?, updated_at = ? WHERE id = ?')
          .run(input.headEntryId ?? null, input.entryCount, now(), session.id)
        tx.recordOperations([...entries.map(entry => operation('create', entry.id, 'agent.transcript-entry', session.id)), operation('update', session.id, 'agent.session', session.id)])
        return requireSession(database, session.id)
      },
      getEntry: id => readEntry(database, id),
      createTimelineSession: input => {
        validateId(input.id, 'id')
        validateOptionalId(input.agentPresetId, 'agentPresetId')
        validateOptionalText(input.title, 'title')
        const timestamp = now()
        database.prepare(`INSERT INTO agent_sessions
          (id, kind, agent_preset_id, timeline_id, title, narrative_mode, entry_count, created_at, updated_at)
          VALUES (?, 'timeline', ?, ?, ?, 'declared', 0, ?, ?)`)
          .run(input.id, input.agentPresetId ?? null, input.id, input.title ?? null, timestamp, timestamp)
        tx.recordOperations([operation('create', input.id, 'agent.session', input.id)])
        return requireSession(database, input.id)
      },
      setTimelineHead: input => {
        const session = requireSession(database, input.agentSessionId)
        if (session.kind !== 'timeline') throw new AgentStoreError('agent.timeline_session_required', 'Only Timeline Sessions can change adopted history')
        if (input.headEntryId !== null && requireEntry(database, input.headEntryId).agentSessionId !== session.id)
          throw new AgentStoreError('agent.head_session_mismatch', 'Head belongs to another Session')
        database.prepare('UPDATE agent_sessions SET head_entry_id = ?, updated_at = ? WHERE id = ?').run(input.headEntryId, now(), session.id)
        syncTimelineBranch(database, tx, session.id, input.headEntryId)
        tx.recordOperations([operation('update', session.id, 'agent.session', session.id)])
        return requireSession(database, session.id)
      },
      getSession: id => readSession(database, id),
      getLatestWorkSummary: id => readLatestWorkSummary(database, id),
      createSession: (input) => {
        validateId(input.agentPresetId, 'agentPresetId')
        validateOptionalText(input.title, 'title')
        validateOptionalId(input.timelineId, 'timelineId')
        const timestamp = now()
        const session: AgentSession = {
          id: input.id ?? nextId('agent-session'),
          kind: 'agent',
          agentPresetId: input.agentPresetId,
          timelineId: input.timelineId,
          title: input.title,
          entryCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        database
          .prepare(
            `INSERT INTO agent_sessions (
          id, agent_preset_id, timeline_id, title, head_entry_id, entry_count, created_at, updated_at, tombstoned
        ) VALUES (?, ?, ?, ?, NULL, 0, ?, ?, 0)`,
          )
          .run(
            session.id,
            session.agentPresetId!,
            session.timelineId ?? null,
            session.title ?? null,
            timestamp,
            timestamp,
          )
        tx.recordOperations([operation('create', session.id, 'agent.session', session.timelineId)])
        return session
      },
      listSessions: (input) => readSessions(database, input),
      appendEntries: (input, options) => {
        const session = requireSession(database, input.agentSessionId)
        for (const item of input.entries) {
          if (item.entry.kind !== 'run-state' || item.entry.state !== 'running') continue
          const active = database.prepare(`
            SELECT 1 FROM agent_transcript_entries e
            WHERE e.agent_session_id = ? AND e.run_id IS NOT ?
              AND json_extract(e.entry_json, '$.kind') = 'run-state'
              AND json_extract(e.entry_json, '$.state') IN ('created', 'running')
              AND NOT EXISTS (
                SELECT 1 FROM agent_transcript_entries later
                WHERE later.agent_session_id = e.agent_session_id AND later.run_id IS e.run_id
                  AND later.sequence > e.sequence AND json_extract(later.entry_json, '$.kind') = 'run-state'
              )
            LIMIT 1
          `).get(session.id, item.runId ?? null)
          if (active)
            throw new AgentStoreError('agent.session_busy', 'Agent Session already has an executing Run')
        }
        if (
          !Number.isInteger(input.expectedEntryCount) ||
          input.expectedEntryCount < 0
        )
          throw new AgentStoreError(
            'agent.expected_count_invalid',
            'Expected entry count must be a non-negative integer',
          )
        if (session.entryCount !== input.expectedEntryCount)
          throw new AgentStoreError(
            'agent.entry_count_conflict',
            `Agent session entry count conflict: ${session.id}`,
          )
        if (input.entries.length === 0)
          throw new AgentStoreError(
            'agent.entries_empty',
            'Agent append requires at least one entry',
          )
        const appended: AgentTranscriptEntry[] = []
        const toolInvocations = readToolInvocationState(database, session.id)
        let parentEntryId = session.headEntryId
        let sequence = session.entryCount
        for (const item of input.entries) {
          validateOptionalId(item.runId, 'runId')
          if (item.entry.kind === 'work-summary') {
            const boundary = item.entry.boundary
            if (boundary) {
              if (!Number.isSafeInteger(boundary.sourceThroughSequence)
                || !Number.isSafeInteger(boundary.retiredThroughSequence)
                || boundary.retiredThroughSequence < 0
                || boundary.sourceThroughSequence < boundary.retiredThroughSequence
                || boundary.sourceThroughSequence > session.entryCount) {
                throw new AgentStoreError('agent.summary_boundary_invalid', 'Invalid summary source or retirement boundary')
              }
              for (const cutoff of [boundary.sourceThroughSequence, boundary.retiredThroughSequence]) {
                const crossingRun = database.prepare(`
                  SELECT 1 FROM agent_transcript_entries before
                  JOIN agent_transcript_entries after ON after.agent_session_id = before.agent_session_id
                    AND after.run_id = before.run_id
                  WHERE before.agent_session_id = ? AND before.sequence <= ? AND after.sequence > ?
                  LIMIT 1
                `).get(session.id, cutoff, cutoff)
                if (crossingRun) throw new AgentStoreError('agent.summary_boundary_invalid', 'Summary boundary splits a Run')
                const crossingTool = database.prepare(`
                  SELECT 1 FROM agent_transcript_entries call JOIN agent_transcript_entries result
                    ON result.agent_session_id = call.agent_session_id
                    AND json_extract(result.entry_json, '$.invocationId') = json_extract(call.entry_json, '$.invocationId')
                  WHERE call.agent_session_id = ? AND call.sequence <= ? AND result.sequence > ?
                    AND json_extract(call.entry_json, '$.kind') = 'tool-invocation'
                    AND json_extract(result.entry_json, '$.kind') = 'tool-result'
                  LIMIT 1
                `).get(session.id, cutoff, cutoff)
                if (crossingTool) throw new AgentStoreError('agent.summary_boundary_invalid', 'Summary boundary splits a tool protocol')
              }
            }
            if (input.entries.length !== 1 || item.runId !== undefined) {
              throw new AgentStoreError('agent.summary_boundary_invalid', 'A work summary must be committed separately after a Run')
            }
            const activeRun = database.prepare(`
              SELECT 1 FROM agent_transcript_entries e
              WHERE e.agent_session_id = ? AND json_extract(e.entry_json, '$.kind') = 'run-state'
                AND json_extract(e.entry_json, '$.state') IN ('created', 'running', 'suspended')
                AND NOT EXISTS (
                  SELECT 1 FROM agent_transcript_entries later
                  WHERE later.agent_session_id = e.agent_session_id
                    AND later.sequence > e.sequence AND json_extract(later.entry_json, '$.kind') = 'run-state'
                    AND (later.run_id IS e.run_id OR (
                      json_extract(e.entry_json, '$.state') = 'suspended'
                      AND json_extract(later.entry_json, '$.state') = 'running'
                      AND json_extract(later.entry_json, '$.sourceRunId') = e.run_id
                    ))
                )
              LIMIT 1
            `).get(session.id)
            if (activeRun || [...toolInvocations.values()].some(call => !call.hasResult)) {
              throw new AgentStoreError('agent.summary_boundary_invalid', 'Cannot summarize an active Run or an unfinished tool call')
            }
          }
          validateTranscriptEntry(
            item.entry,
            toolInvocations,
            database,
            session.id,
          )
          sequence += 1
          const entryId = item.id ?? nextId('agent-entry')
          const entry: AgentTranscriptEntry = {
            id: entryId,
            agentSessionId: session.id,
            parentEntryId,
            sequence,
            runId: item.runId,
            ...timelineEntryIdentity(database, { ...session, headEntryId: parentEntryId }, item, entryId),
            entry: structuredClone(item.entry) as AgentTranscriptEntryData,
            createdAt: now(),
          }
          insertEntry(database, entry)
          updateToolInvocationState(database, entry, toolInvocations)
          appended.push(entry)
          parentEntryId = entry.id
        }
        const updatedAt = now()
        database
          .prepare(
            'UPDATE agent_sessions SET head_entry_id = ?, entry_count = ?, updated_at = ? WHERE id = ?',
          )
          .run(parentEntryId ?? null, sequence, updatedAt, session.id)
        if (session.kind === 'timeline') syncTimelineBranch(database, tx, session.id, parentEntryId ?? null, options?.timelineBranchId)
        tx.recordOperations([
          ...appended.map((entry) =>
            operation('create', entry.id, 'agent.transcript-entry', session.timelineId),
          ),
          operation('update', session.id, 'agent.session', session.timelineId),
        ])
        return {
          session: requireSession(database, session.id),
          entries: appended,
        }
      },
      deleteSession: (input) => {
        const session = requireSession(database, input.agentSessionId)
        const deletedAt = now()
        database
          .prepare(
            `UPDATE agent_sessions SET tombstoned = 1, deleted_at = ?, deleted_by_json = ?, delete_reason = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            deletedAt,
            JSON.stringify(tx.actor),
            tx.reason ?? null,
            deletedAt,
            session.id,
          )
        tx.recordOperations([operation('delete', session.id, 'agent.session', session.timelineId)])
        return requireSession(database, session.id, true)
      },
      updateSession: (input) => {
        const session = requireSession(database, input.agentSessionId)
        if (session.kind !== 'timeline' && ('agentPresetId' in input || 'narrativeMode' in input)) {
          throw new AgentStoreError('agent.session_preset_immutable', 'Agent Session preset binding is immutable')
        }
        if (session.kind === 'timeline' && input.timelineId === null)
          throw new AgentStoreError('agent.timeline_session_binding_immutable', 'Timeline Session cannot be detached')
        if (input.agentPresetId !== undefined || input.narrativeMode !== undefined) {
          const active = database.prepare(`SELECT entry_json FROM agent_transcript_entries WHERE agent_session_id = ?
            AND json_extract(entry_json, '$.kind') = 'run-state' ORDER BY sequence DESC LIMIT 1`).get(session.id)
          const state = active ? JSON.parse(String(active.entry_json)) : undefined
          if (state && (['created', 'running', 'suspended'].includes(state.state) || state.state === 'failed' && state.recovery))
            throw new AgentStoreError('agent.session_binding_active_run', 'Cannot change configuration while a Run is active or suspended')
          validateOptionalId(input.agentPresetId, 'agentPresetId')
          if (input.narrativeMode !== undefined && !['declared', 'automatic'].includes(input.narrativeMode))
            throw new AgentStoreError('agent.narrative_mode_invalid', 'Invalid Narrative mode')
          database.prepare('UPDATE agent_sessions SET agent_preset_id = ?, narrative_mode = ? WHERE id = ?')
            .run(input.agentPresetId ?? session.agentPresetId ?? null, input.narrativeMode ?? session.narrativeMode ?? null, session.id)
        }
        validateOptionalText(input.title, 'title')
        if (input.timelineId === null) {
          // Binding changes are rejected while the latest persisted run state is active;
          // an in-memory run registry cannot reliably cover restart or recovery paths.
          const activeRun = database
            .prepare(
              `SELECT entry_json FROM agent_transcript_entries
               WHERE agent_session_id = ? AND json_extract(entry_json, '$.kind') = 'run-state'
               ORDER BY sequence DESC LIMIT 1`,
            )
            .get(session.id) as { entry_json?: unknown } | undefined
          if (activeRun?.entry_json) {
            const entry = JSON.parse(String(activeRun.entry_json)) as { state?: unknown }
            if (entry.state === 'running' || entry.state === 'suspended') {
              throw new AgentStoreError(
                'agent.session_binding_active_run',
                'Cannot change agent session bindings while its latest run is active',
              )
            }
          }
        }
        if (input.timelineId !== undefined && input.timelineId !== null) {
          throw new AgentStoreError(
            'agent.session_rebind_unsupported',
            'Existing agent sessions cannot be rebound to another timeline',
          )
        }
        if (input.summaryPolicy !== undefined) {
          const policy = input.summaryPolicy
          if (typeof policy.enabled !== 'boolean' || typeof policy.asynchronous !== 'boolean'
            || !['maxTokens', 'bufferFloors', 'triggerFloors', 'triggerTokens'].every(key =>
              Number.isSafeInteger(policy[key as keyof typeof policy]) && Number(policy[key as keyof typeof policy]) >= 0)
            || policy.maxTokens < 1 || policy.triggerTokens <= policy.maxTokens
            || policy.triggerFloors < 1 || policy.bufferFloors >= policy.triggerFloors)
            throw new AgentStoreError('agent.summary_policy_invalid', 'Invalid Session summary policy')
          database.prepare('UPDATE agent_sessions SET summary_policy_json = ? WHERE id = ?')
            .run(JSON.stringify(policy), session.id)
        }
        database
          .prepare(
            `UPDATE agent_sessions SET title = ?, timeline_id = CASE WHEN ? IS NULL THEN NULL ELSE timeline_id END, updated_at = ? WHERE id = ?`,
          )
          .run(input.title === undefined ? session.title ?? null : input.title, input.timelineId === null ? null : session.timelineId ?? null, now(), session.id)
        tx.recordOperations([operation('update', session.id, 'agent.session', session.timelineId)])
        return requireSession(database, session.id)
      },
    }
  }

  async function write<T>(
    context: AgentWriteContext,
    callback: (tx: AgentTransaction) => T,
  ) {
    return engine.transact(context, (dataTx) =>
      Promise.resolve(callback(transaction(dataTx))),
    )
  }

  return {
    listEntries: agentSessionId => engine.read(database => {
      requireSession(database, agentSessionId)
      return database.prepare('SELECT * FROM agent_transcript_entries WHERE agent_session_id = ? ORDER BY sequence ASC').all(agentSessionId).map(entryFromRow)
    }),
    countSummaryMessages: (agentSessionId, retiredThrough, sourceThrough) => engine.read(database => {
      const session = requireSession(database, agentSessionId)
      const row = database.prepare(`WITH RECURSIVE history(id, parent_entry_id, sequence, entry_json) AS (
        SELECT id, parent_entry_id, sequence, entry_json FROM agent_transcript_entries WHERE id = ? AND agent_session_id = ?
        UNION ALL SELECT e.id, e.parent_entry_id, e.sequence, e.entry_json FROM agent_transcript_entries e
          JOIN history h ON e.id = h.parent_entry_id
      ) SELECT COUNT(*) AS total, COUNT(CASE WHEN sequence <= ? THEN 1 END) AS retired,
        COUNT(CASE WHEN sequence <= ? THEN 1 END) AS source FROM history
        WHERE json_extract(entry_json, '$.kind') = 'message' AND json_type(entry_json, '$.content') = 'text'
      `).get(session.headEntryId ?? null, session.id, retiredThrough, sourceThrough)!
      return { retired: Number(row.retired), source: Number(row.source), total: Number(row.total) }
    }),
    listSummaryTasks: agentSessionId => engine.read(database => {
      requireSession(database, agentSessionId)
      return database.prepare('SELECT data_json, created_at, updated_at FROM agent_summary_tasks WHERE agent_session_id = ? ORDER BY rowid DESC LIMIT 20')
        .all(agentSessionId).map(row => ({ ...JSON.parse(String(row.data_json)), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }) as AgentSummaryTask)
    }),
    getSession: (id) => engine.read((database) => readSession(database, id)),
    listSessions: (input) =>
      engine.read((database) => readSessions(database, input)),
    listRunStates: () => engine.read(database => {
      const rows = database.prepare(`
        SELECT s.id AS session_id, s.title, s.timeline_id, s.updated_at AS session_updated_at,
          e.run_id, e.created_at AS run_updated_at,
          json_extract(e.entry_json, '$.state') AS state,
          json_extract(e.entry_json, '$.reason') AS reason
        FROM agent_sessions s
        LEFT JOIN agent_transcript_entries e ON e.id = (
          SELECT latest.id FROM agent_transcript_entries latest
          WHERE latest.agent_session_id = s.id AND latest.run_id IS NOT NULL
            AND json_extract(latest.entry_json, '$.kind') = 'run-state'
          ORDER BY latest.sequence DESC LIMIT 1
        )
        WHERE s.tombstoned = 0
      `).all()
      return rows.map((row): AgentSessionRunSummary => ({
        agentSessionId: String(row.session_id),
        ...(row.title === null ? {} : { title: String(row.title) }),
        ...(row.timeline_id === null ? {} : { timelineId: String(row.timeline_id) }),
        updatedAt: String(row.session_updated_at),
        ...(row.run_id === null ? {} : { run: {
          runId: String(row.run_id), state: row.state as NonNullable<AgentSessionRunSummary['run']>['state'],
          updatedAt: String(row.run_updated_at),
          ...(row.reason === null ? {} : { reason: String(row.reason) }),
        } }),
      }))
    }),
    getEntry: (id) => engine.read((database) => readEntry(database, id)),
    findRunCheckpoint: input => engine.read(database => {
      requireSession(database, input.agentSessionId)
      const row = database.prepare(`SELECT id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at
        FROM agent_transcript_entries WHERE agent_session_id = ? AND run_id = ?
        AND json_extract(entry_json, '$.kind') = 'run-state' AND json_type(entry_json, '$.recovery') = 'object'
        ORDER BY sequence ASC LIMIT 1`).get(input.agentSessionId, input.runId)
      return row ? entryFromRow(row) : null
    }),
    getLatestWorkSummary: (agentSessionId) => engine.read(database => readLatestWorkSummary(database, agentSessionId)),
    getEntryPage: (input) =>
      engine.read((database) => readEntryPage(database, input)),
    createSession: async (input) => {
      const result = await write(input, (tx) => tx.createSession(input))
      return { session: result.value, commit: result.commit }
    },
    appendEntries: async (input) => {
      const result = await write(input, (tx) => tx.appendEntries(input))
      return { ...result.value, commit: result.commit }
    },
    deleteSession: async (input) => {
      const result = await write(input, (tx) => tx.deleteSession(input))
      return { session: result.value, commit: result.commit }
    },
    updateSession: async (input) => {
      const result = await write(input, (tx) => tx.updateSession(input))
      return { session: result.value, commit: result.commit }
    },
    transaction,
  }
}













function insertEntry(
  database: DatabaseSync,
  entry: AgentTranscriptEntry,
): void {
  try {
    database
      .prepare(
        `INSERT INTO agent_transcript_entries (id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at, round_id, candidate_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.agentSessionId,
        entry.parentEntryId ?? null,
        entry.sequence,
        entry.runId ?? null,
        JSON.stringify(entry.entry),
        entry.createdAt,
        entry.roundId ?? null,
        entry.candidateId ?? null,
      )
  } catch (error) {
    throw new AgentStoreError(
      'agent.entry_insert_failed',
      `Failed to insert Agent transcript entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

type ToolInvocationState = Map<string, { toolId: string; hasResult: boolean }>

function readToolInvocationState(
  database: DatabaseSync,
  agentSessionId: string,
): ToolInvocationState {
  const session = requireSession(database, agentSessionId)
  const rows = database.prepare(`WITH RECURSIVE path AS (
    SELECT * FROM agent_transcript_entries WHERE id = ?
    UNION ALL SELECT e.* FROM agent_transcript_entries e JOIN path p ON e.id = p.parent_entry_id
  ) SELECT entry_json FROM path ORDER BY sequence ASC`).all(session.headEntryId ?? null)
  const state: ToolInvocationState = new Map()
  for (const row of rows) {
    const entry = JSON.parse(String(row.entry_json)) as AgentTranscriptEntryData
    if (entry.kind === 'tool-invocation') state.set(entry.invocationId, { toolId: entry.toolId, hasResult: false })
    if (entry.kind === 'tool-result') state.set(entry.invocationId, { toolId: entry.toolId, hasResult: true })
  }
  return state
}

function updateToolInvocationState(
  database: DatabaseSync,
  entry: AgentTranscriptEntry,
  state: ToolInvocationState,
): void {
  if (entry.entry.kind === 'tool-invocation') {
    database
      .prepare(
        'INSERT INTO agent_tool_invocations (agent_session_id, invocation_id, tool_id, invocation_entry_id) VALUES (?, ?, ?, ?)',
      )
      .run(
        entry.agentSessionId,
        entry.entry.invocationId,
        entry.entry.toolId,
        entry.id,
      )
    state.set(entry.entry.invocationId, {
      toolId: entry.entry.toolId,
      hasResult: false,
    })
  } else if (entry.entry.kind === 'tool-result') {
    database
      .prepare(
        'UPDATE agent_tool_invocations SET result_entry_id = ? WHERE agent_session_id = ? AND invocation_id = ?',
      )
      .run(entry.id, entry.agentSessionId, entry.entry.invocationId)
    state.set(entry.entry.invocationId, {
      toolId: entry.entry.toolId,
      hasResult: true,
    })
  }
}

function readEntryPage(
  database: DatabaseSync,
  input: { agentSessionId: string; cursor?: string; limit?: number },
): AgentTranscriptPage {
  const session = requireSession(database, input.agentSessionId)
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit)
    throw new AgentStoreError(
      'agent.page_limit_invalid',
      `Agent transcript page limit must be between 1 and ${maximumPageLimit}`,
    )
  const startEntryId = input.cursor ?? session.headEntryId
  if (!startEntryId) return { session, entries: [] }
  if (input.cursor) {
    const cursor = requireEntry(database, input.cursor)
    if (cursor.agentSessionId !== session.id)
      throw new AgentStoreError(
        'agent.cursor_session_mismatch',
        `Agent transcript cursor does not belong to session: ${input.cursor}`,
      )
  }
  const rows = database
    .prepare(
      `WITH RECURSIVE session_entries(id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at, round_id, candidate_id, depth) AS (
      SELECT id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at, round_id, candidate_id, 1 FROM agent_transcript_entries WHERE id = ? AND agent_session_id = ?
      UNION ALL SELECT e.id, e.agent_session_id, e.parent_entry_id, e.sequence, e.run_id, e.entry_json, e.created_at, e.round_id, e.candidate_id, se.depth + 1 FROM agent_transcript_entries e JOIN session_entries se ON e.id = se.parent_entry_id WHERE se.parent_entry_id IS NOT NULL AND se.depth < 10000
    ) SELECT id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at, round_id, candidate_id FROM session_entries LIMIT ?`,
    )
    .all(startEntryId, session.id, limit)
  if (rows.length === 0) requireEntry(database, startEntryId)
  const reverseEntries = rows.map(entryFromRow)
  const lastEntry = reverseEntries.at(-1)
  return {
    session,
    entries: reverseEntries.reverse(),
    ...(reverseEntries.length === limit && lastEntry?.parentEntryId
      ? { nextCursor: lastEntry.parentEntryId }
      : {}),
  }
}

function readSession(
  database: DatabaseSync,
  id: string,
  includeDeleted = false,
): AgentSession | null {
  const row = database
    .prepare(
      'SELECT id, agent_preset_id, kind, narrative_mode, timeline_id, title, head_entry_id, entry_count, created_at, updated_at, deleted_at, summary_policy_json FROM agent_sessions WHERE id = ?',
    )
    .get(id)
  if (!row) return null
  const session = sessionFromRow(row)
  return session.deletedAt && !includeDeleted ? null : session
}
function requireSession(
  database: DatabaseSync,
  id: string,
  includeDeleted = false,
): AgentSession {
  const session = readSession(database, id, includeDeleted)
  if (!session)
    throw new AgentStoreError(
      'agent.session_not_found',
      `Agent session not found: ${id}`,
    )
  return session
}
function readEntry(
  database: DatabaseSync,
  id: string,
): AgentTranscriptEntry | null {
  const row = database
    .prepare(
      'SELECT entry.id, entry.agent_session_id, entry.parent_entry_id, entry.sequence, entry.run_id, entry.entry_json, entry.created_at, entry.round_id, entry.candidate_id FROM agent_transcript_entries entry JOIN agent_sessions session ON session.id = entry.agent_session_id WHERE entry.id = ? AND session.tombstoned = 0',
    )
    .get(id)
  return row ? entryFromRow(row) : null
}
function requireEntry(
  database: DatabaseSync,
  id: string,
): AgentTranscriptEntry {
  const entry = readEntry(database, id)
  if (!entry)
    throw new AgentStoreError(
      'agent.entry_not_found',
      `Agent transcript entry not found: ${id}`,
    )
  return entry
}
function readLatestWorkSummary(database: DatabaseSync, agentSessionId: string): AgentTranscriptEntry | null {
  const session = requireSession(database, agentSessionId)
  const row = database.prepare(`WITH RECURSIVE path AS (
    SELECT * FROM agent_transcript_entries WHERE id = ?
    UNION ALL SELECT e.* FROM agent_transcript_entries e JOIN path p ON e.id = p.parent_entry_id
  ) SELECT * FROM path WHERE json_extract(entry_json, '$.kind') = 'work-summary'
    ORDER BY sequence DESC LIMIT 1`).get(session.headEntryId ?? null)
  return row ? entryFromRow(row) : null
}

function sessionFromRow(row: unknown): AgentSession {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    kind: value.kind as AgentSession['kind'],
    agentPresetId: optionalString(value.agent_preset_id),
    ...(value.kind === 'timeline' ? { narrativeMode: (value.narrative_mode ?? 'declared') as 'declared' | 'automatic' } : {}),
    timelineId: optionalString(value.timeline_id),
    title: optionalString(value.title),
    headEntryId: optionalString(value.head_entry_id),
    ...(value.summary_policy_json ? { summaryPolicy: JSON.parse(String(value.summary_policy_json)) as NonNullable<AgentSession['summaryPolicy']> } : {}),
    entryCount: Number(value.entry_count),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    deletedAt: optionalString(value.deleted_at),
  }
}

function readSessions(
  database: DatabaseSync,
  input: ListAgentSessionsInput = {},
): AgentSessionPage {
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) {
    throw new AgentStoreError(
      'agent.session_list_limit_invalid',
      `Agent session list limit must be between 1 and ${maximumPageLimit}`,
    )
  }
  validateOptionalId(input.agentPresetId, 'agentPresetId')
  validateOptionalId(input.timelineId, 'timelineId')
  validateOptionalId(input.cursor, 'cursor')

  const cursor = input.cursor ? readSession(database, input.cursor) : undefined
  if (input.cursor && !cursor) {
    throw new AgentStoreError(
      'agent.session_cursor_not_found',
      `Agent session cursor not found: ${input.cursor}`,
    )
  }

  const conditions = ['tombstoned = 0']
  if (!input.includeTimelines) conditions.push("kind = 'agent'")
  const params: Array<string | number> = []

  if (input.agentPresetId) {
    conditions.push('agent_preset_id = ?')
    params.push(input.agentPresetId)
  }
  if (input.timelineId) {
    conditions.push('timeline_id = ?')
    params.push(input.timelineId)
  } else if (input.standalone) {
    conditions.push('timeline_id IS NULL')
  }
  if (cursor) {
    conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
  }

  const rows = database
    .prepare(
      `SELECT id, agent_preset_id, kind, narrative_mode, timeline_id, title, head_entry_id, entry_count, created_at, updated_at, deleted_at, summary_policy_json
       FROM agent_sessions
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1)

  const items = rows.slice(0, limit).map(sessionFromRow)
  const nextCursor = rows.length > limit ? items[items.length - 1]?.id : undefined
  return { sessions: items, nextCursor }
}
function entryFromRow(row: unknown): AgentTranscriptEntry {
  const value = row as Record<string, unknown>
  const parsed = JSON.parse(String(value.entry_json)) as unknown
  validateTranscriptEntry(parsed)
  return {
    id: String(value.id),
    agentSessionId: String(value.agent_session_id),
    parentEntryId: optionalString(value.parent_entry_id),
    sequence: Number(value.sequence),
    runId: optionalString(value.run_id),
    roundId: optionalString(value.round_id),
    candidateId: optionalString(value.candidate_id),
    entry: parsed,
    createdAt: String(value.created_at),
  }
}

function validateTranscriptEntry(
  value: unknown,
  toolInvocations?: ToolInvocationState,
  database?: DatabaseSync,
  agentSessionId?: string,
): asserts value is AgentTranscriptEntryData {
  if (!isRecord(value) || typeof value.kind !== 'string')
    throw new AgentStoreError(
      'agent.entry_invalid',
      'Agent transcript entry must have a kind',
    )
  if (value.kind === 'user-interjection' || value.kind === 'interjection-applied' || value.kind === 'interjection-discarded') {
    validateId(value.requestId, 'requestId')
    if (value.kind !== 'user-interjection') return
    if (value.withdrawn !== undefined && typeof value.withdrawn !== 'boolean') throw new Error('Invalid input withdrawal state')
    const attachments = readChatAttachments(value.attachments)
    if (typeof value.content !== 'string' || !value.content.trim() && !attachments?.length) validateContent(value.content)
    if (value.mode !== 'discussion' && value.mode !== 'narrative') throw new AgentStoreError('agent.input_invalid', 'Invalid interjection mode')
    if (value.narrativeTarget !== undefined) {
      if (!isRecord(value.narrativeTarget)) throw new AgentStoreError('agent.input_invalid', 'Invalid interjection target')
      validateId(value.narrativeTarget.timelineId, 'timelineId')
      validateId(value.narrativeTarget.branchId, 'branchId')
    }
    return
  }
  if (value.kind === 'work-summary') {
    validateContent(value.content)
    {
      const boundary = value.boundary
      if (!isRecord(boundary) || !Number.isSafeInteger(boundary.sourceThroughSequence)
        || !Number.isSafeInteger(boundary.retiredThroughSequence)
        || Number(boundary.retiredThroughSequence) < 0
        || Number(boundary.sourceThroughSequence) < Number(boundary.retiredThroughSequence)) {
        throw new AgentStoreError('agent.summary_boundary_invalid', 'Invalid summary boundaries')
      }
      if (boundary.adoptedWorkspaceRevisionId !== undefined) validateId(boundary.adoptedWorkspaceRevisionId, 'adoptedWorkspaceRevisionId')
      if (boundary.narrative !== undefined) {
        if (!isRecord(boundary.narrative)) throw new AgentStoreError('agent.summary_boundary_invalid', 'Invalid summary Narrative source')
        for (const key of ['timelineId', 'branchId']) validateId(boundary.narrative[key], key)
        if (boundary.narrative.nodeId !== null) validateId(boundary.narrative.nodeId, 'nodeId')
        if (boundary.narrative.stateRevisionId !== undefined) validateId(boundary.narrative.stateRevisionId, 'stateRevisionId')
        if (boundary.narrative.workspaceRevisionId !== undefined) validateId(boundary.narrative.workspaceRevisionId, 'workspaceRevisionId')
      }
    }
    return
  }
  if (value.kind === 'message') {
    if (value.role !== 'user' && value.role !== 'assistant')
      throw new AgentStoreError(
        'agent.message_role_invalid',
        'Agent message role must be user or assistant',
      )
    const attachments = readChatAttachments(value.attachments)
    if (value.role !== 'user' || !attachments?.length || typeof value.content !== 'string') validateContent(value.content)
    if (value.purpose !== undefined && value.purpose !== 'narrative' && value.purpose !== 'discussion')
      throw new AgentStoreError('agent.message_purpose_invalid', 'Invalid message purpose')
    if (value.interjectionRequestId !== undefined) validateId(value.interjectionRequestId, 'interjectionRequestId')
    if (value.narrativeId !== undefined) validateId(value.narrativeId, 'narrativeId')
    if (value.continuesEntryId !== undefined) {
      if (value.role !== 'assistant')
        throw new AgentStoreError(
          'agent.message_continuation_role_invalid',
          'Only assistant messages can continue another entry',
        )
      validateId(value.continuesEntryId, 'continuesEntryId')
      if (database && agentSessionId) {
        const target = requireEntry(database, value.continuesEntryId)
        if (target.agentSessionId !== agentSessionId)
          throw new AgentStoreError(
            'agent.message_continuation_session_mismatch',
            `Continuation entry does not belong to session: ${value.continuesEntryId}`,
          )
        if (
          target.entry.kind !== 'message' ||
          target.entry.role !== 'assistant' ||
          target.entry.state !== 'partial'
        )
          throw new AgentStoreError(
            'agent.message_continuation_target_invalid',
            'Continuation target must be an assistant partial message',
          )
      }
    }
    if (
      value.state !== undefined &&
      value.state !== 'partial' &&
      value.state !== 'complete'
    )
      throw new AgentStoreError(
        'agent.message_state_invalid',
        'Agent message state must be partial or complete',
      )
    return
  }
  if (value.kind === 'reasoning') {
    validateContent(value.content)
    if (value.source !== 'provider-native' && value.source !== 'assistant-content')
      throw new AgentStoreError('agent.reasoning_source_invalid', 'Agent reasoning source is invalid')
    if (!['collapsed', 'hidden', 'visible'].includes(String(value.visibility)))
      throw new AgentStoreError('agent.reasoning_visibility_invalid', 'Agent reasoning visibility is invalid')
    if (value.replay !== 'omit' && value.replay !== 'assistant-content')
      throw new AgentStoreError('agent.reasoning_replay_invalid', 'Agent reasoning replay policy is invalid')
    validateOptionalId(value.providerCallId as string | undefined, 'providerCallId')
    return
  }
  if (value.kind === 'provider-observation') {
    validateOptionalId(value.measurementId as string | undefined, 'measurementId')
    validateId(value.provider, 'provider')
    validateId(value.model, 'model')
    validateOptionalId(
      value.providerCallId as string | undefined,
      'providerCallId',
    )
    if (value.usage !== undefined && !isRecord(value.usage))
      throw new AgentStoreError(
        'agent.provider_usage_invalid',
        'Provider usage must be an object',
      )
    if (isRecord(value.usage)) {
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
        const count = value.usage[key]
        if (count !== undefined && (!Number.isSafeInteger(count) || Number(count) < 0)) {
          throw new AgentStoreError('agent.provider_usage_invalid', `Invalid Provider usage: ${key}`)
        }
      }
    }
    return
  }
  if (value.kind === 'request-measurement') {
    for (const key of ['measurementId', 'providerProfileId', 'modelId', 'requestDigest']) validateId(value[key], key)
    if (!Number.isSafeInteger(value.providerStep) || Number(value.providerStep) < 1
      || value.scope !== 'canonical-content-v1' || !isRecord(value.count)
      || !Number.isSafeInteger(value.count.baseTokens) || Number(value.count.baseTokens) < 0
      || !Number.isSafeInteger(value.count.estimatedTokens) || Number(value.count.estimatedTokens) < 0
      || !isRecord(value.count.basis) || value.count.basis.encoding !== 'o200k_base'
      || value.count.basis.implementation !== 'gpt-tokenizer' || typeof value.count.basis.implementationVersion !== 'string'
      || value.count.basis.algorithm !== 'literal-text-v1'
      || typeof value.count.basis.multiplier !== 'number' || !Number.isFinite(value.count.basis.multiplier)
      || value.count.basis.multiplier <= 0
      || value.count.estimatedTokens !== Math.ceil(Number(value.count.baseTokens) * value.count.basis.multiplier)
      || !Array.isArray(value.uncounted) || !value.uncounted.every(item => typeof item === 'string')) {
      throw new AgentStoreError('agent.request_measurement_invalid', 'Invalid request token measurement')
    }
    return
  }
  if (value.kind === 'tool-invocation') {
    validateId(value.invocationId, 'invocationId')
    validateId(value.toolId, 'toolId')
    validateId(value.exposedName, 'exposedName')
    if (toolInvocations?.has(value.invocationId))
      throw new AgentStoreError(
        'agent.tool_invocation_duplicate',
        `Duplicate tool invocation ID: ${value.invocationId}`,
      )
    if (
      !['native-function', 'provider-custom', 'content'].includes(
        String(value.transport),
      )
    )
      throw new AgentStoreError(
        'agent.tool_transport_invalid',
        'Tool invocation transport is invalid',
      )
    if (value.arguments !== undefined && !isJsonObject(value.arguments))
      throw new AgentStoreError(
        'agent.tool_arguments_invalid',
        'Tool invocation arguments must be a JSON object',
      )
    if (value.rawInput !== undefined && typeof value.rawInput !== 'string')
      throw new AgentStoreError(
        'agent.tool_raw_input_invalid',
        'Tool invocation raw input must be a string',
      )
    if (
      ![
        'proposed',
        'waiting-approval',
        'running',
        'suspended',
        'completed',
        'failed',
        'skipped',
      ].includes(String(value.status))
    )
      throw new AgentStoreError(
        'agent.tool_status_invalid',
        'Tool invocation status is invalid',
      )
    return
  }
  if (value.kind === 'tool-result') {
    validateId(value.invocationId, 'invocationId')
    validateId(value.toolId, 'toolId')
    if (!Array.isArray(value.content))
      throw new AgentStoreError(
        'agent.tool_result_invalid',
        'Tool result content must be an array',
      )
    value.content.forEach(validateToolResultPart)
    if (toolInvocations) {
      const invocation = toolInvocations.get(value.invocationId)
      if (!invocation)
        throw new AgentStoreError(
          'agent.tool_invocation_not_found',
          `Tool invocation not found: ${value.invocationId}`,
        )
      if (invocation.toolId !== value.toolId)
        throw new AgentStoreError(
          'agent.tool_result_mismatch',
          `Tool result tool does not match invocation: ${value.invocationId}`,
        )
      if (invocation.hasResult)
        throw new AgentStoreError(
          'agent.tool_result_duplicate',
          `Tool invocation already has a result: ${value.invocationId}`,
        )
    }
    return
  }
  if (value.kind === 'run-state') {
    if (value.sourceRunId !== undefined) validateId(value.sourceRunId, 'sourceRunId')
    if (
      ![
        'created',
        'running',
        'suspended',
        'completed',
        'failed',
        'aborted',
        'discarded',
      ].includes(String(value.state))
    )
      throw new AgentStoreError(
        'agent.run_state_invalid',
        'Agent run state is invalid',
      )
    return
  }
  throw new AgentStoreError(
    'agent.entry_kind_invalid',
    `Unsupported Agent transcript entry kind: ${value.kind}`,
  )
}

function validateToolResultPart(value: unknown): void {
  if (!isRecord(value) || typeof value.type !== 'string')
    throw new AgentStoreError(
      'agent.tool_result_part_invalid',
      'Tool result part must have a type',
    )
  if (value.type === 'text') return validateContent(value.text)
  if (value.type === 'artifact-ref')
    return validateId(value.artifactId, 'artifactId')
  if (value.type === 'json' && isJsonValue(value.value)) return
  throw new AgentStoreError(
    'agent.tool_result_part_invalid',
    `Unsupported Tool result part: ${value.type}`,
  )
}

function isJsonObject(
  value: unknown,
): value is Record<string, import('@loom-studio/shared').JsonValue> {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(
  value: unknown,
): value is import('@loom-studio/shared').JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}

function validateContent(value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new AgentStoreError(
      'agent.message_content_empty',
      'Agent message content cannot be empty',
    )
}
function validateOptionalText(value: string | undefined, field: string): void {
  if (value !== undefined && value.trim().length === 0)
    throw new AgentStoreError(
      'agent.input_invalid',
      `${field} must be a non-empty string`,
    )
}
function validateOptionalId(value: string | undefined, field: string): void {
  if (value !== undefined) validateId(value, field)
}
function validateId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new AgentStoreError(
      'agent.input_invalid',
      `${field} must be a non-empty string`,
    )
}
function operation(
  kind: DataCommitOperation['kind'],
  entityId: string,
  entityType: string,
  timelineId?: string,
): DataCommitOperation {
  return {
    store: 'agent', kind, entityId, entityType,
    ...(timelineId ? { scope: { store: 'narrative', entityType: 'narrative.timeline', entityId: timelineId } } : {}),
  }
}

function syncTimelineBranch(database: DatabaseSync, tx: SqliteDataTransaction, timelineId: string, headEntryId: string | null, targetBranchId?: string) {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'narrative_branches'").get()) return
  const row = targetBranchId
    ? database.prepare('SELECT id FROM narrative_branches WHERE id = ? AND timeline_id = ?').get(targetBranchId, timelineId)
    : database.prepare('SELECT active_branch_id AS id FROM narrative_timelines WHERE id = ?').get(timelineId)
  if (!row?.id) return
  const branchId = String(row.id)
  database.prepare('UPDATE narrative_branches SET head_entry_id = ? WHERE id = ?').run(headEntryId, branchId)
  tx.recordOperations([{ store: 'narrative', kind: 'update', entityId: branchId, entityType: 'narrative.branch' }])
}

function timelineEntryIdentity(database: DatabaseSync, session: AgentSession, item: { entry: AgentTranscriptEntryData; runId?: string; roundId?: string; candidateId?: string }, entryId: string) {
  if (session.kind !== 'timeline') return {}
  if (item.roundId) return { roundId: item.roundId, candidateId: item.candidateId }
  if (item.entry.kind === 'message' && item.entry.role === 'user' && item.entry.purpose === 'narrative') return { roundId: entryId }
  const hasSwipes = database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'narrative_swipe_groups'").get()
  if (item.runId && hasSwipes) {
    const attempt = database.prepare(`SELECT g.id AS group_id, json_extract(candidate.value, '$.id') AS candidate_id
      FROM narrative_swipe_groups g, json_each(g.metadata_json, '$.candidates') candidate,
        json_each(candidate.value, '$.runIds') run
      WHERE g.timeline_id = ? AND g.deleted_at IS NULL AND run.value = ?
        LIMIT 1`).get(session.id, item.runId)
    if (attempt) return { roundId: item.roundId ?? String(attempt.group_id), candidateId: item.candidateId ?? String(attempt.candidate_id) }
  }
  if (item.roundId || item.candidateId) return { roundId: item.roundId, candidateId: item.candidateId }
  // Unscoped imports/manual edits have no execution identity; never borrow the latest input.
  return {}
}


function initializeAgentSchema(database: DatabaseSync): void {
  database.exec(`
CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, title TEXT, head_entry_id TEXT, entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_json TEXT, delete_reason TEXT, timeline_id TEXT, summary_policy_json TEXT, kind TEXT NOT NULL DEFAULT 'agent', narrative_mode TEXT, agent_preset_id TEXT);

CREATE TABLE agent_transcript_entries (id TEXT PRIMARY KEY, agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), parent_entry_id TEXT REFERENCES agent_transcript_entries(id), sequence INTEGER NOT NULL CHECK (sequence > 0), run_id TEXT, entry_json TEXT NOT NULL, created_at TEXT NOT NULL, round_id TEXT, candidate_id TEXT, UNIQUE (agent_session_id, sequence));

CREATE TABLE agent_tool_invocations (agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), invocation_id TEXT NOT NULL, tool_id TEXT NOT NULL, invocation_entry_id TEXT NOT NULL REFERENCES agent_transcript_entries(id), result_entry_id TEXT REFERENCES agent_transcript_entries(id), PRIMARY KEY (agent_session_id, invocation_id));

CREATE INDEX idx_agent_entries_session_sequence ON agent_transcript_entries(agent_session_id, sequence);

CREATE INDEX idx_agent_entries_session_run ON agent_transcript_entries(agent_session_id, run_id);

CREATE INDEX idx_agent_sessions_timeline ON agent_sessions(timeline_id);

CREATE INDEX idx_agent_sessions_updated ON agent_sessions(updated_at);

CREATE TABLE agent_summary_tasks (
        task_id TEXT PRIMARY KEY, agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE INDEX agent_summary_tasks_session ON agent_summary_tasks(agent_session_id, created_at);
  `)
}
