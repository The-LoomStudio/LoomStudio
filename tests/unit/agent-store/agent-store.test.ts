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
  const now = () =>
    `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const store = createAgentStore({ engine, createId, now })
  const actor = { kind: 'system' as const, id: 'test' }
  return { engine, store, actor }
}

describe('agent store', () => {
  it('repairs a version 3 development schema missing tool invocations', async () => {
    const engine = createSqliteDataEngine({
      filename: ':memory:',
      createId: prefix => `${prefix}-1`,
      now: () => '2026-08-24T00:00:00.000Z',
    })
    engine.database.exec(`
      CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, agent_profile_id TEXT NOT NULL, title TEXT, head_entry_id TEXT, entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tombstoned INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by_json TEXT, delete_reason TEXT);
      CREATE TABLE agent_transcript_entries (id TEXT PRIMARY KEY, agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id), parent_entry_id TEXT REFERENCES agent_transcript_entries(id), sequence INTEGER NOT NULL CHECK (sequence > 0), run_id TEXT, entry_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (agent_session_id, sequence));
      INSERT INTO schema_migrations (namespace, version) VALUES ('application.agent', 3);
    `)

    createAgentStore({ engine })

    expect(
      engine.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_tool_invocations'")
        .get(),
    ).toEqual({ name: 'agent_tool_invocations' })
    expect(
      engine.database
        .prepare("SELECT version FROM schema_migrations WHERE namespace = 'application.agent'")
        .get(),
    ).toEqual({ version: 4 })
    engine.close()
  })

  it('creates a session and appends a linear batch with server-assigned sequence', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createSession({
      actor,
      agentProfileId: 'profile-guide',
      title: 'Guide',
    })
    const appended = await store.appendEntries({
      actor,
      agentSessionId: created.session.id,
      expectedEntryCount: 0,
      entries: [
        {
          runId: 'run-1',
          entry: { kind: 'message', role: 'user', content: 'Hello' },
        },
        {
          runId: 'run-1',
          entry: { kind: 'message', role: 'assistant', content: 'Hi' },
        },
      ],
    })

    expect(appended.entries).toMatchObject([
      {
        sequence: 1,
        parentEntryId: undefined,
        entry: { kind: 'message', role: 'user' },
      },
      {
        sequence: 2,
        parentEntryId: appended.entries[0]?.id,
        entry: { kind: 'message', role: 'assistant' },
      },
    ])
    expect(appended.session).toMatchObject({
      headEntryId: appended.entries[1]?.id,
      entryCount: 2,
    })
    expect(
      appended.commit.operations.map((operation) => operation.entityType),
    ).toEqual([
      'agent.transcript-entry',
      'agent.transcript-entry',
      'agent.session',
    ])
    expect(
      engine.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('documents', 'document_revisions')",
        )
        .all(),
    ).toEqual([])
    engine.close()
  })

  it('validates tool call/result pairing across batches', async () => {
    const { engine, store, actor } = createTestContext()
    const { session } = await store.createSession({
      actor,
      agentProfileId: 'profile-tools',
    })
    const call = await store.appendEntries({
      actor,
      agentSessionId: session.id,
      expectedEntryCount: 0,
      entries: [
        {
          entry: {
            kind: 'tool-invocation',
            invocationId: 'call-1',
            toolId: 'official/lookup',
            exposedName: 'lookup',
            transport: 'native-function',
            arguments: { id: 'x' },
            status: 'proposed',
          },
        },
      ],
    })
    const result = await store.appendEntries({
      actor,
      agentSessionId: session.id,
      expectedEntryCount: 1,
      entries: [
        {
          entry: {
            kind: 'tool-result',
            invocationId: 'call-1',
            toolId: 'official/lookup',
            status: 'completed',
            content: [{ type: 'text', text: 'found' }],
          },
        },
      ],
    })

    expect(result.entries[0]).toMatchObject({
      sequence: 2,
      parentEntryId: call.entries[0]?.id,
      entry: { kind: 'tool-result', invocationId: 'call-1' },
    })
    await expect(
      store.appendEntries({
        actor,
        agentSessionId: session.id,
        expectedEntryCount: 2,
        entries: [
          {
            entry: {
              kind: 'tool-result',
              invocationId: 'call-1',
              toolId: 'official/lookup',
              status: 'completed',
              content: [],
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'agent.tool_result_duplicate' })
    await expect(
      store.appendEntries({
        actor,
        agentSessionId: session.id,
        expectedEntryCount: 2,
        entries: [
          {
            entry: {
              kind: 'tool-result',
              invocationId: 'missing',
              toolId: 'official/lookup',
              status: 'failed',
              content: [],
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'agent.tool_invocation_not_found' })
    engine.close()
  })

  it('rejects stale appends and fully rolls back failed surrounding transactions', async () => {
    const { engine, store, actor } = createTestContext()
    const { session } = await store.createSession({
      actor,
      agentProfileId: 'profile-1',
    })
    await store.appendEntries({
      actor,
      agentSessionId: session.id,
      expectedEntryCount: 0,
      entries: [
        { entry: { kind: 'message', role: 'user', content: 'stable' } },
      ],
    })

    await expect(
      store.appendEntries({
        actor,
        agentSessionId: session.id,
        expectedEntryCount: 0,
        entries: [
          { entry: { kind: 'message', role: 'user', content: 'stale' } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'agent.entry_count_conflict' })

    const commitCount = engine.database
      .prepare('SELECT COUNT(*) AS count FROM changesets')
      .get()
    await expect(
      engine.transact({ actor }, async (dataTx) => {
        store.transaction(dataTx).appendEntries({
          agentSessionId: session.id,
          expectedEntryCount: 1,
          entries: [
            {
              id: 'rolled-back-entry',
              entry: {
                kind: 'message',
                role: 'assistant',
                content: 'rollback',
              },
            },
          ],
        })
        throw new Error('abort agent transaction')
      }),
    ).rejects.toThrow('abort agent transaction')

    expect(await store.getEntry('rolled-back-entry')).toBeNull()
    expect(await store.getSession(session.id)).toMatchObject({ entryCount: 1 })
    expect(
      engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get(),
    ).toEqual(commitCount)
    engine.close()
  })

  it('pages by parent cursor and tombstones the session without deleting message rows', async () => {
    const { engine, store, actor } = createTestContext()
    const { session } = await store.createSession({
      actor,
      agentProfileId: 'profile-1',
    })
    await store.appendEntries({
      actor,
      agentSessionId: session.id,
      expectedEntryCount: 0,
      entries: [1, 2, 3].map((index) => ({
        entry: {
          kind: 'message' as const,
          role: 'user' as const,
          content: `message-${index}`,
        },
      })),
    })

    const latest = await store.getEntryPage({
      agentSessionId: session.id,
      limit: 2,
    })
    const older = await store.getEntryPage({
      agentSessionId: session.id,
      cursor: latest.nextCursor,
      limit: 2,
    })
    expect(latest.entries.map((entry) => entry.entry)).toEqual([
      { kind: 'message', role: 'user', content: 'message-2' },
      { kind: 'message', role: 'user', content: 'message-3' },
    ])
    expect(older.entries.map((entry) => entry.entry)).toEqual([
      { kind: 'message', role: 'user', content: 'message-1' },
    ])

    await store.deleteSession({
      actor,
      agentSessionId: session.id,
      reason: 'delete test',
    })
    expect(await store.getSession(session.id)).toBeNull()
    expect(await store.getEntry(latest.entries[0]!.id)).toBeNull()
    expect(
      engine.database
        .prepare('SELECT COUNT(*) AS count FROM agent_transcript_entries')
        .get(),
    ).toEqual({ count: 3 })
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
      const firstStore = createAgentStore({
        engine: firstEngine,
        createId,
        now,
      })
      const { session } = await firstStore.createSession({
        actor: { kind: 'system', id: 'test' },
        agentProfileId: 'profile-persist',
      })
      await firstStore.appendEntries({
        actor: { kind: 'system', id: 'test' },
        agentSessionId: session.id,
        expectedEntryCount: 0,
        entries: [
          { entry: { kind: 'message', role: 'user', content: 'persistent' } },
        ],
      })
      firstEngine.close()

      const secondEngine = createSqliteDataEngine({ filename, createId, now })
      const secondStore = createAgentStore({
        engine: secondEngine,
        createId,
        now,
      })
      expect(
        await secondStore.getEntryPage({ agentSessionId: session.id }),
      ).toMatchObject({
        entries: [
          { entry: { kind: 'message', role: 'user', content: 'persistent' } },
        ],
      })
      secondEngine.close()

      const database = new DatabaseSync(filename)
      const migration = database
        .prepare('SELECT version FROM schema_migrations WHERE namespace = ?')
        .get('application.agent')
      database.close()
      expect(migration).toEqual({ version: 4 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
