import { createAgentStore } from '@loom-studio/agent-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

function createTestContext() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const store = createAgentStore({ engine, createId, now })
  const actor = { kind: 'system' as const, id: 'test' }
  return { engine, store, actor }
}

describe('agent store', () => {
  it('creates a session and appends a linear batch with server-assigned sequence', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createSession({ actor, agentProfileId: 'profile-guide', title: 'Guide' })
    const appended = await store.appendMessages({
      actor,
      agentSessionId: created.session.id,
      expectedMessageCount: 0,
      messages: [
        { runId: 'run-1', message: { role: 'user', content: 'Hello' } },
        { runId: 'run-1', message: { role: 'assistant', content: 'Hi' } },
      ],
    })

    expect(appended.messages).toMatchObject([
      { sequence: 1, parentMessageId: undefined, message: { role: 'user' } },
      { sequence: 2, parentMessageId: appended.messages[0]?.id, message: { role: 'assistant' } },
    ])
    expect(appended.session).toMatchObject({
      headMessageId: appended.messages[1]?.id,
      messageCount: 2,
    })
    expect(appended.commit.operations.map(operation => operation.entityType)).toEqual([
      'agent.message',
      'agent.message',
      'agent.session',
    ])
    expect(engine.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('documents', 'document_revisions')").all()).toEqual([])
    engine.close()
  })

  it('validates tool call/result pairing across batches', async () => {
    const { engine, store, actor } = createTestContext()
    const { session } = await store.createSession({ actor, agentProfileId: 'profile-tools' })
    const call = await store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 0,
      messages: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"id":"x"}' },
          }],
        },
      }],
    })
    const result = await store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 1,
      messages: [{ message: { role: 'tool', tool_call_id: 'call-1', content: 'found' } }],
    })

    expect(result.messages[0]).toMatchObject({
      sequence: 2,
      parentMessageId: call.messages[0]?.id,
      message: { role: 'tool', tool_call_id: 'call-1' },
    })
    await expect(store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 2,
      messages: [{ message: { role: 'tool', tool_call_id: 'call-1', content: 'duplicate' } }],
    })).rejects.toMatchObject({ code: 'agent.tool_result_duplicate' })
    await expect(store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 2,
      messages: [{ message: { role: 'tool', tool_call_id: 'missing', content: 'bad' } }],
    })).rejects.toMatchObject({ code: 'agent.tool_call_not_found' })
    engine.close()
  })

  it('rejects stale appends and fully rolls back failed surrounding transactions', async () => {
    const { engine, store, actor } = createTestContext()
    const { session } = await store.createSession({ actor, agentProfileId: 'profile-1' })
    await store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 0,
      messages: [{ message: { role: 'user', content: 'stable' } }],
    })

    await expect(store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 0,
      messages: [{ message: { role: 'user', content: 'stale' } }],
    })).rejects.toMatchObject({ code: 'agent.message_count_conflict' })

    const commitCount = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()
    await expect(engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).appendMessages({
        agentSessionId: session.id,
        expectedMessageCount: 1,
        messages: [{ id: 'rolled-back-message', message: { role: 'assistant', content: 'rollback' } }],
      })
      throw new Error('abort agent transaction')
    })).rejects.toThrow('abort agent transaction')

    expect(await store.getMessage('rolled-back-message')).toBeNull()
    expect(await store.getSession(session.id)).toMatchObject({ messageCount: 1 })
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual(commitCount)
    engine.close()
  })

  it('pages by parent cursor and tombstones the session without deleting message rows', async () => {
    const { engine, store, actor } = createTestContext()
    const { session } = await store.createSession({ actor, agentProfileId: 'profile-1' })
    await store.appendMessages({
      actor,
      agentSessionId: session.id,
      expectedMessageCount: 0,
      messages: [1, 2, 3].map(index => ({ message: { role: 'user' as const, content: `message-${index}` } })),
    })

    const latest = await store.getMessagePage({ agentSessionId: session.id, limit: 2 })
    const older = await store.getMessagePage({ agentSessionId: session.id, cursor: latest.nextCursor, limit: 2 })
    expect(latest.messages.map(message => message.message)).toEqual([
      { role: 'user', content: 'message-2' },
      { role: 'user', content: 'message-3' },
    ])
    expect(older.messages.map(message => message.message)).toEqual([{ role: 'user', content: 'message-1' }])

    await store.deleteSession({ actor, agentSessionId: session.id, reason: 'delete test' })
    expect(await store.getSession(session.id)).toBeNull()
    expect(await store.getMessage(latest.messages[0]!.id)).toBeNull()
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM agent_messages').get()).toEqual({ count: 3 })
    engine.close()
  })

  it('persists schema and messages across engine instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-agent-'))
    const filename = join(directory, 'studio.sqlite')
    let nextId = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => '2026-08-12T00:00:00.000Z'
    try {
      const firstEngine = createSqliteDataEngine({ filename, createId, now })
      const firstStore = createAgentStore({ engine: firstEngine, createId, now })
      const { session } = await firstStore.createSession({
        actor: { kind: 'system', id: 'test' },
        agentProfileId: 'profile-persist',
      })
      await firstStore.appendMessages({
        actor: { kind: 'system', id: 'test' },
        agentSessionId: session.id,
        expectedMessageCount: 0,
        messages: [{ message: { role: 'developer', content: 'persistent' } }],
      })
      firstEngine.close()

      const secondEngine = createSqliteDataEngine({ filename, createId, now })
      const secondStore = createAgentStore({ engine: secondEngine, createId, now })
      expect(await secondStore.getMessagePage({ agentSessionId: session.id })).toMatchObject({
        messages: [{ message: { role: 'developer', content: 'persistent' } }],
      })
      secondEngine.close()

      const database = new DatabaseSync(filename)
      const migration = database.prepare('SELECT version FROM schema_migrations WHERE namespace = ?').get('application.agent')
      database.close()
      expect(migration).toEqual({ version: 2 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
