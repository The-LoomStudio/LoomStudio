import type { DataCommitOperation, SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso, type ChatMessage, type ChatToolCall } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentMessage,
  AgentMessagePage,
  AgentSession,
  AgentStore,
  AgentTransaction,
  AgentWriteContext,
} from './types.js'

const migrationNamespace = 'application.agent'
const defaultPageLimit = 50
const maximumPageLimit = 100

export class AgentStoreError extends Error {
  constructor(readonly code: string, message: string) {
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
  engine.migrate({ namespace: migrationNamespace, migrations: [{ version: 1, migrate: migrateVersionOne }] })

  function transaction(tx: SqliteDataTransaction): AgentTransaction {
    const { database } = tx
    return {
      createSession: input => {
        validateId(input.agentPresetId, 'agentPresetId')
        validateOptionalText(input.title, 'title')
        const timestamp = now()
        const session: AgentSession = {
          id: input.id ?? nextId('agent-session'),
          agentPresetId: input.agentPresetId,
          title: input.title,
          messageCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        database.prepare(`
          INSERT INTO agent_sessions (
            id, agent_preset_id, title, head_message_id, message_count,
            created_at, updated_at, tombstoned
          ) VALUES (?, ?, ?, NULL, 0, ?, ?, 0)
        `).run(session.id, session.agentPresetId, session.title ?? null, timestamp, timestamp)
        tx.recordOperations([operation('create', session.id, 'agent.session')])
        return session
      },

      appendMessages: input => {
        const session = requireActiveSession(database, input.agentSessionId)
        if (!Number.isInteger(input.expectedMessageCount) || input.expectedMessageCount < 0) {
          throw new AgentStoreError('agent.expected_count_invalid', 'Expected message count must be a non-negative integer')
        }
        if (session.messageCount !== input.expectedMessageCount) {
          throw new AgentStoreError('agent.message_count_conflict', `Agent session message count conflict: ${session.id}`)
        }
        if (input.messages.length === 0) {
          throw new AgentStoreError('agent.messages_empty', 'Agent append requires at least one message')
        }

        const knownToolCalls = readToolCallState(database, session.id)
        const appended: AgentMessage[] = []
        let parentMessageId = session.headMessageId
        let sequence = session.messageCount
        for (const item of input.messages) {
          validateOptionalId(item.runId, 'runId')
          validateChatMessage(item.message, knownToolCalls)
          sequence += 1
          const message: AgentMessage = {
            id: item.id ?? nextId('agent-message'),
            agentSessionId: session.id,
            parentMessageId,
            sequence,
            runId: item.runId,
            message: structuredClone(item.message) as ChatMessage,
            createdAt: now(),
          }
          insertMessage(database, message)
          updateToolCallState(database, message, knownToolCalls)
          appended.push(message)
          parentMessageId = message.id
        }

        const updatedAt = now()
        database.prepare(`
          UPDATE agent_sessions SET head_message_id = ?, message_count = ?, updated_at = ? WHERE id = ?
        `).run(parentMessageId ?? null, sequence, updatedAt, session.id)
        tx.recordOperations([
          ...appended.map(message => operation('create', message.id, 'agent.message')),
          operation('update', session.id, 'agent.session'),
        ])
        return { session: requireSession(database, session.id), messages: appended }
      },

      deleteSession: input => {
        const session = requireActiveSession(database, input.agentSessionId)
        const deletedAt = now()
        database.prepare(`
          UPDATE agent_sessions
          SET tombstoned = 1, deleted_at = ?, deleted_by_json = ?, delete_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(deletedAt, JSON.stringify(tx.actor), tx.reason ?? null, deletedAt, session.id)
        tx.recordOperations([operation('delete', session.id, 'agent.session')])
        return requireSession(database, session.id, true)
      },
    }
  }

  async function write<T>(context: AgentWriteContext, callback: (tx: AgentTransaction) => T) {
    return engine.transact(context, dataTx => Promise.resolve(callback(transaction(dataTx))))
  }

  return {
    getSession: id => engine.read(database => readSession(database, id)),
    getMessage: id => engine.read(database => readMessage(database, id)),
    getMessagePage: input => engine.read(database => readMessagePage(database, input)),
    createSession: async input => {
      const result = await write(input, tx => tx.createSession(input))
      return { session: result.value, commit: result.commit }
    },
    appendMessages: async input => {
      const result = await write(input, tx => tx.appendMessages(input))
      return { ...result.value, commit: result.commit }
    },
    deleteSession: async input => {
      const result = await write(input, tx => tx.deleteSession(input))
      return { session: result.value, commit: result.commit }
    },
    transaction,
  }
}

function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      agent_preset_id TEXT NOT NULL,
      title TEXT,
      head_message_id TEXT,
      message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_json TEXT,
      delete_reason TEXT
    );

    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY,
      agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
      parent_message_id TEXT REFERENCES agent_messages(id),
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      run_id TEXT,
      message_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (agent_session_id, sequence)
    );

    CREATE TABLE agent_tool_calls (
      agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
      tool_call_id TEXT NOT NULL,
      assistant_message_id TEXT NOT NULL REFERENCES agent_messages(id),
      result_message_id TEXT REFERENCES agent_messages(id),
      PRIMARY KEY (agent_session_id, tool_call_id)
    );

    CREATE INDEX idx_agent_messages_session_sequence ON agent_messages(agent_session_id, sequence);
    CREATE INDEX idx_agent_messages_session_run ON agent_messages(agent_session_id, run_id);
  `)
}

function insertMessage(database: DatabaseSync, message: AgentMessage): void {
  database.prepare(`
    INSERT INTO agent_messages (
      id, agent_session_id, parent_message_id, sequence, run_id, message_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    message.agentSessionId,
    message.parentMessageId ?? null,
    message.sequence,
    message.runId ?? null,
    JSON.stringify(message.message),
    message.createdAt,
  )
}

function readMessagePage(
  database: DatabaseSync,
  input: { agentSessionId: string; cursor?: string; limit?: number },
): AgentMessagePage {
  const session = requireActiveSession(database, input.agentSessionId)
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) {
    throw new AgentStoreError('agent.page_limit_invalid', `Agent message page limit must be between 1 and ${maximumPageLimit}`)
  }
  let messageId = input.cursor ?? session.headMessageId
  if (messageId) {
    const cursor = requireMessage(database, messageId)
    if (cursor.agentSessionId !== session.id) {
      throw new AgentStoreError('agent.cursor_session_mismatch', `Agent message cursor does not belong to session: ${messageId}`)
    }
  }

  const reverseMessages: AgentMessage[] = []
  while (messageId && reverseMessages.length < limit) {
    const message = requireMessage(database, messageId)
    reverseMessages.push(message)
    messageId = message.parentMessageId
  }
  return {
    session,
    messages: reverseMessages.reverse(),
    nextCursor: messageId,
  }
}

function readSession(database: DatabaseSync, id: string, includeDeleted = false): AgentSession | null {
  const row = database.prepare(`
    SELECT id, agent_preset_id, title, head_message_id, message_count, created_at, updated_at, deleted_at
    FROM agent_sessions WHERE id = ?
  `).get(id)
  if (!row) return null
  const session = sessionFromRow(row)
  return session.deletedAt && !includeDeleted ? null : session
}

function requireSession(database: DatabaseSync, id: string, includeDeleted = false): AgentSession {
  const session = readSession(database, id, includeDeleted)
  if (!session) throw new AgentStoreError('agent.session_not_found', `Agent session not found: ${id}`)
  return session
}

function requireActiveSession(database: DatabaseSync, id: string): AgentSession {
  return requireSession(database, id)
}

function readMessage(database: DatabaseSync, id: string): AgentMessage | null {
  const row = database.prepare(`
    SELECT message.id, message.agent_session_id, message.parent_message_id, message.sequence,
           message.run_id, message.message_json, message.created_at
    FROM agent_messages message
    JOIN agent_sessions session ON session.id = message.agent_session_id
    WHERE message.id = ? AND session.tombstoned = 0
  `).get(id)
  return row ? messageFromRow(row) : null
}

function requireMessage(database: DatabaseSync, id: string): AgentMessage {
  const message = readMessage(database, id)
  if (!message) throw new AgentStoreError('agent.message_not_found', `Agent message not found: ${id}`)
  return message
}

function sessionFromRow(row: unknown): AgentSession {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    agentPresetId: String(value.agent_preset_id),
    title: optionalString(value.title),
    headMessageId: optionalString(value.head_message_id),
    messageCount: Number(value.message_count),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    deletedAt: optionalString(value.deleted_at),
  }
}

function messageFromRow(row: unknown): AgentMessage {
  const value = row as Record<string, unknown>
  const parsed = JSON.parse(String(value.message_json)) as unknown
  const toolCalls = new Map<string, boolean>()
  validateChatMessage(parsed, toolCalls, false)
  return {
    id: String(value.id),
    agentSessionId: String(value.agent_session_id),
    parentMessageId: optionalString(value.parent_message_id),
    sequence: Number(value.sequence),
    runId: optionalString(value.run_id),
    message: parsed,
    createdAt: String(value.created_at),
  }
}

function readToolCallState(database: DatabaseSync, agentSessionId: string): Map<string, boolean> {
  const rows = database.prepare(`
    SELECT tool_call_id, result_message_id FROM agent_tool_calls WHERE agent_session_id = ?
  `).all(agentSessionId) as Array<{ tool_call_id: string; result_message_id: string | null }>
  return new Map(rows.map(row => [row.tool_call_id, row.result_message_id !== null]))
}

function updateToolCallState(database: DatabaseSync, message: AgentMessage, state: Map<string, boolean>): void {
  if (message.message.role === 'assistant') {
    for (const call of message.message.tool_calls ?? []) {
      database.prepare(`
        INSERT INTO agent_tool_calls (agent_session_id, tool_call_id, assistant_message_id)
        VALUES (?, ?, ?)
      `).run(message.agentSessionId, call.id, message.id)
      state.set(call.id, false)
    }
  } else if (message.message.role === 'tool') {
    database.prepare(`
      UPDATE agent_tool_calls SET result_message_id = ?
      WHERE agent_session_id = ? AND tool_call_id = ?
    `).run(message.id, message.agentSessionId, message.message.tool_call_id)
    state.set(message.message.tool_call_id, true)
  }
}

function validateChatMessage(value: unknown, toolCalls: Map<string, boolean>, validateToolResult = true): asserts value is ChatMessage {
  if (!isRecord(value) || typeof value.role !== 'string') {
    throw new AgentStoreError('agent.message_invalid', 'Agent message must be an object with a role')
  }
  if (value.role === 'system' || value.role === 'developer' || value.role === 'user') {
    validateContent(value.content)
    return
  }
  if (value.role === 'assistant') {
    const content = typeof value.content === 'string' && value.content.trim().length > 0 ? value.content : undefined
    const calls = value.tool_calls === undefined ? [] : validateToolCalls(value.tool_calls, toolCalls)
    if (!content && calls.length === 0) {
      throw new AgentStoreError('agent.assistant_message_empty', 'Assistant message requires content or tool calls')
    }
    return
  }
  if (value.role === 'tool') {
    validateContent(value.content)
    validateId(value.tool_call_id, 'tool_call_id')
    if (validateToolResult) {
      if (!toolCalls.has(value.tool_call_id)) {
        throw new AgentStoreError('agent.tool_call_not_found', `Tool call not found: ${value.tool_call_id}`)
      }
      if (toolCalls.get(value.tool_call_id)) {
        throw new AgentStoreError('agent.tool_result_duplicate', `Tool call already has a result: ${value.tool_call_id}`)
      }
    }
    return
  }
  throw new AgentStoreError('agent.message_role_invalid', `Unsupported Agent message role: ${value.role}`)
}

function validateToolCalls(value: unknown, known: Map<string, boolean>): ChatToolCall[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AgentStoreError('agent.tool_calls_invalid', 'Assistant tool_calls must be a non-empty array')
  }
  const seen = new Set<string>()
  return value.map(item => {
    if (!isRecord(item) || item.type !== 'function' || !isRecord(item.function)) {
      throw new AgentStoreError('agent.tool_call_invalid', 'Tool call must use the function shape')
    }
    validateId(item.id, 'tool call id')
    validateId(item.function.name, 'tool function name')
    if (typeof item.function.arguments !== 'string') {
      throw new AgentStoreError('agent.tool_arguments_invalid', 'Tool function arguments must be a string')
    }
    if (seen.has(item.id) || known.has(item.id)) {
      throw new AgentStoreError('agent.tool_call_duplicate', `Duplicate tool call ID: ${item.id}`)
    }
    seen.add(item.id)
    known.set(item.id, false)
    return item as unknown as ChatToolCall
  })
}

function validateContent(value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentStoreError('agent.message_content_empty', 'Agent message content cannot be empty')
  }
}

function validateOptionalText(value: string | undefined, field: string): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new AgentStoreError('agent.input_invalid', `${field} must be a non-empty string`)
  }
}

function validateOptionalId(value: string | undefined, field: string): void {
  if (value !== undefined) validateId(value, field)
}

function validateId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentStoreError('agent.input_invalid', `${field} must be a non-empty string`)
  }
}

function operation(kind: DataCommitOperation['kind'], entityId: string, entityType: string): DataCommitOperation {
  return { store: 'agent', kind, entityId, entityType }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
