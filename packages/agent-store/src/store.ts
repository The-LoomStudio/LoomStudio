import type {
  DataCommitOperation,
  SqliteDataEngine,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'
import { createId, isRecord, nowIso, optionalString } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentSession,
  AgentStore,
  AgentTransaction,
  AgentTranscriptEntry,
  AgentTranscriptEntryData,
  AgentTranscriptPage,
  AgentWriteContext,
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
  engine.migrate({
    namespace: migrationNamespace,
    migrations: [
      { version: 1, migrate: migrateVersionOne },
      { version: 2, migrate: migrateVersionTwo },
      { version: 3, migrate: migrateVersionThree },
      { version: 4, migrate: migrateVersionFour },
    ],
  })

  function transaction(tx: SqliteDataTransaction): AgentTransaction {
    const { database } = tx
    return {
      createSession: (input) => {
        validateId(input.agentProfileId, 'agentProfileId')
        validateOptionalText(input.title, 'title')
        const timestamp = now()
        const session: AgentSession = {
          id: input.id ?? nextId('agent-session'),
          agentProfileId: input.agentProfileId,
          title: input.title,
          entryCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        database
          .prepare(
            `INSERT INTO agent_sessions (
          id, agent_profile_id, title, head_entry_id, entry_count, created_at, updated_at, tombstoned
        ) VALUES (?, ?, ?, NULL, 0, ?, ?, 0)`,
          )
          .run(
            session.id,
            session.agentProfileId,
            session.title ?? null,
            timestamp,
            timestamp,
          )
        tx.recordOperations([operation('create', session.id, 'agent.session')])
        return session
      },
      appendEntries: (input) => {
        const session = requireActiveSession(database, input.agentSessionId)
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
          validateTranscriptEntry(item.entry, toolInvocations)
          sequence += 1
          const entry: AgentTranscriptEntry = {
            id: item.id ?? nextId('agent-entry'),
            agentSessionId: session.id,
            parentEntryId,
            sequence,
            runId: item.runId,
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
        tx.recordOperations([
          ...appended.map((entry) =>
            operation('create', entry.id, 'agent.transcript-entry'),
          ),
          operation('update', session.id, 'agent.session'),
        ])
        return {
          session: requireSession(database, session.id),
          entries: appended,
        }
      },
      deleteSession: (input) => {
        const session = requireActiveSession(database, input.agentSessionId)
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
        tx.recordOperations([operation('delete', session.id, 'agent.session')])
        return requireSession(database, session.id, true)
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
    getSession: (id) => engine.read((database) => readSession(database, id)),
    getEntry: (id) => engine.read((database) => readEntry(database, id)),
    getEntryPage: (input) =>
      engine.read((database) => readEntryPage(database, input)),
    hasSessionForProfile: (agentProfileId) =>
      engine.read((database) => {
        validateId(agentProfileId, 'agentProfileId')
        return Boolean(
          database
            .prepare(
              'SELECT 1 FROM agent_sessions WHERE agent_profile_id = ? AND tombstoned = 0 LIMIT 1',
            )
            .get(agentProfileId),
        )
      }),
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
    transaction,
  }
}

function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, agent_preset_id TEXT NOT NULL, title TEXT, head_message_id TEXT, message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_json TEXT, delete_reason TEXT);
    CREATE TABLE agent_messages (id TEXT PRIMARY KEY, agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), parent_message_id TEXT REFERENCES agent_messages(id), sequence INTEGER NOT NULL CHECK (sequence > 0), run_id TEXT, message_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (agent_session_id, sequence));
    CREATE TABLE agent_tool_calls (agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), tool_call_id TEXT NOT NULL, assistant_message_id TEXT NOT NULL REFERENCES agent_messages(id), result_message_id TEXT REFERENCES agent_messages(id), PRIMARY KEY (agent_session_id, tool_call_id));
    CREATE INDEX idx_agent_messages_session_sequence ON agent_messages(agent_session_id, sequence);
    CREATE INDEX idx_agent_messages_session_run ON agent_messages(agent_session_id, run_id);
  `)
}

function migrateVersionTwo(database: DatabaseSync): void {
  database.exec(
    `DELETE FROM agent_tool_calls; DELETE FROM agent_messages; DELETE FROM agent_sessions; ALTER TABLE agent_sessions RENAME COLUMN agent_preset_id TO agent_profile_id;`,
  )
}

function migrateVersionThree(database: DatabaseSync): void {
  database.exec(`
    DROP TABLE agent_tool_calls;
    DROP TABLE agent_messages;
    DROP TABLE agent_sessions;
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, agent_profile_id TEXT NOT NULL, title TEXT, head_entry_id TEXT, entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_json TEXT, delete_reason TEXT);
    CREATE TABLE agent_transcript_entries (id TEXT PRIMARY KEY, agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), parent_entry_id TEXT REFERENCES agent_transcript_entries(id), sequence INTEGER NOT NULL CHECK (sequence > 0), run_id TEXT, entry_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (agent_session_id, sequence));
    CREATE TABLE agent_tool_invocations (agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), invocation_id TEXT NOT NULL, tool_id TEXT NOT NULL, invocation_entry_id TEXT NOT NULL REFERENCES agent_transcript_entries(id), result_entry_id TEXT REFERENCES agent_transcript_entries(id), PRIMARY KEY (agent_session_id, invocation_id));
    CREATE INDEX idx_agent_entries_session_sequence ON agent_transcript_entries(agent_session_id, sequence);
    CREATE INDEX idx_agent_entries_session_run ON agent_transcript_entries(agent_session_id, run_id);
  `)
}

function migrateVersionFour(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_tool_invocations (agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), invocation_id TEXT NOT NULL, tool_id TEXT NOT NULL, invocation_entry_id TEXT NOT NULL REFERENCES agent_transcript_entries(id), result_entry_id TEXT REFERENCES agent_transcript_entries(id), PRIMARY KEY (agent_session_id, invocation_id));
    CREATE INDEX IF NOT EXISTS idx_agent_entries_session_sequence ON agent_transcript_entries(agent_session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_agent_entries_session_run ON agent_transcript_entries(agent_session_id, run_id);
  `)
}

function insertEntry(
  database: DatabaseSync,
  entry: AgentTranscriptEntry,
): void {
  try {
    database
      .prepare(
        `INSERT INTO agent_transcript_entries (id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.agentSessionId,
        entry.parentEntryId ?? null,
        entry.sequence,
        entry.runId ?? null,
        JSON.stringify(entry.entry),
        entry.createdAt,
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
  const rows = database
    .prepare(
      'SELECT invocation_id, tool_id, result_entry_id FROM agent_tool_invocations WHERE agent_session_id = ?',
    )
    .all(agentSessionId) as Array<{
    invocation_id: string
    tool_id: string
    result_entry_id: string | null
  }>
  return new Map(
    rows.map((row) => [
      row.invocation_id,
      { toolId: row.tool_id, hasResult: row.result_entry_id !== null },
    ]),
  )
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
  const session = requireActiveSession(database, input.agentSessionId)
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
      `WITH RECURSIVE session_entries(id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at, depth) AS (
      SELECT id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at, 1 FROM agent_transcript_entries WHERE id = ? AND agent_session_id = ?
      UNION ALL SELECT e.id, e.agent_session_id, e.parent_entry_id, e.sequence, e.run_id, e.entry_json, e.created_at, se.depth + 1 FROM agent_transcript_entries e JOIN session_entries se ON e.id = se.parent_entry_id WHERE se.parent_entry_id IS NOT NULL AND se.depth < 10000
    ) SELECT id, agent_session_id, parent_entry_id, sequence, run_id, entry_json, created_at FROM session_entries LIMIT ?`,
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
      'SELECT id, agent_profile_id, title, head_entry_id, entry_count, created_at, updated_at, deleted_at FROM agent_sessions WHERE id = ?',
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
function requireActiveSession(
  database: DatabaseSync,
  id: string,
): AgentSession {
  return requireSession(database, id)
}
function readEntry(
  database: DatabaseSync,
  id: string,
): AgentTranscriptEntry | null {
  const row = database
    .prepare(
      'SELECT entry.id, entry.agent_session_id, entry.parent_entry_id, entry.sequence, entry.run_id, entry.entry_json, entry.created_at FROM agent_transcript_entries entry JOIN agent_sessions session ON session.id = entry.agent_session_id WHERE entry.id = ? AND session.tombstoned = 0',
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
function sessionFromRow(row: unknown): AgentSession {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    agentProfileId: String(value.agent_profile_id),
    title: optionalString(value.title),
    headEntryId: optionalString(value.head_entry_id),
    entryCount: Number(value.entry_count),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    deletedAt: optionalString(value.deleted_at),
  }
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
    entry: parsed,
    createdAt: String(value.created_at),
  }
}

function validateTranscriptEntry(
  value: unknown,
  toolInvocations?: ToolInvocationState,
): asserts value is AgentTranscriptEntryData {
  if (!isRecord(value) || typeof value.kind !== 'string')
    throw new AgentStoreError(
      'agent.entry_invalid',
      'Agent transcript entry must have a kind',
    )
  if (value.kind === 'message') {
    if (value.role !== 'user' && value.role !== 'assistant')
      throw new AgentStoreError(
        'agent.message_role_invalid',
        'Agent message role must be user or assistant',
      )
    validateContent(value.content)
    return
  }
  if (value.kind === 'provider-observation') {
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
): DataCommitOperation {
  return { store: 'agent', kind, entityId, entityType }
}
