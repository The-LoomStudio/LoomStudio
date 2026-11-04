import type { SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { nowIso } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import type { NarrativeSwipeGroup } from './types.js'

export class NarrativeSwipeStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'NarrativeSwipeStoreError'
  }
}

export function createNarrativeSwipeStore(options: {
  engine: SqliteDataEngine
  now?(): string
  createId?(prefix: string): string
}) {
  const { engine } = options
  const now = options.now ?? nowIso
  engine.initializeSchema({ namespace: 'application.narrative.swipes', version: 1, initialize: database => {
    database.exec(`
      CREATE TABLE narrative_swipe_groups (
        id TEXT PRIMARY KEY, timeline_id TEXT NOT NULL, branch_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL, deleted_at TEXT, revision INTEGER NOT NULL
      );
      CREATE INDEX idx_narrative_swipes_branch ON narrative_swipe_groups(branch_id, deleted_at);
      CREATE INDEX idx_narrative_swipes_timeline ON narrative_swipe_groups(timeline_id, deleted_at);
    `)
  } })

  function read(database: DatabaseSync, where: string, args: string[], single = false): NarrativeSwipeGroup[] {
    const rows = database.prepare(`SELECT g.metadata_json FROM narrative_swipe_groups g
      JOIN narrative_timelines t ON t.id = g.timeline_id
      WHERE g.deleted_at IS NULL AND t.tombstoned = 0 AND ${where}
      ORDER BY json_extract(g.metadata_json, '$.createdAt') DESC, g.rowid DESC${single ? ' LIMIT 1' : ''}`).all(...args)
    return rows.map(row => JSON.parse(String(row.metadata_json)) as NarrativeSwipeGroup)
  }
  function transaction(tx: SqliteDataTransaction) {
    const { database } = tx
    const get = (id: string) => read(database, 'g.id = ?', [id], true)[0] ?? null
    const getLatest = (branchId: string) => read(database, 'g.branch_id = ?', [branchId], true)[0] ?? null
    function record(kind: 'create' | 'update' | 'delete', id: string) {
      tx.recordOperations([{ store: 'narrative', kind, entityId: id, entityType: 'narrative.swipe-group' }])
    }
    function save(group: NarrativeSwipeGroup, options: { expectedRevision?: number } = {}): NarrativeSwipeGroup {
      const existing = database.prepare('SELECT revision, deleted_at FROM narrative_swipe_groups WHERE id = ?').get(group.id)
      if (existing ? existing.deleted_at !== null || options.expectedRevision !== Number(existing.revision) : options.expectedRevision !== undefined) {
        throw new NarrativeSwipeStoreError('narrative.swipe_revision_conflict', `Swipe group revision conflict: ${group.id}`)
      }
      const value = { ...group, revision: existing ? Number(existing.revision) + 1 : 1, updatedAt: now() }
      if (existing) {
        database.prepare(`UPDATE narrative_swipe_groups SET timeline_id = ?, branch_id = ?, metadata_json = ?, revision = ? WHERE id = ?`)
          .run(value.timelineId, value.branchId, JSON.stringify(value), value.revision, value.id)
      } else {
        database.prepare(`INSERT INTO narrative_swipe_groups (id, timeline_id, branch_id, metadata_json, revision) VALUES (?, ?, ?, ?, ?)`)
          .run(value.id, value.timelineId, value.branchId, JSON.stringify(value), value.revision)
      }
      record(existing ? 'update' : 'create', value.id)
      return value
    }
    return {
      get, getLatest, save,
      closeLatest(branchId: string) {
        const group = getLatest(branchId)
        if (group && !group.closed) save({ ...group, closed: true, generation: group.generation + 1 }, { expectedRevision: group.revision })
      },
      deleteTimeline(timelineId: string) {
        const rows = database.prepare('SELECT id FROM narrative_swipe_groups WHERE timeline_id = ? AND deleted_at IS NULL').all(timelineId)
        database.prepare('UPDATE narrative_swipe_groups SET deleted_at = ? WHERE timeline_id = ? AND deleted_at IS NULL').run(now(), timelineId)
        for (const row of rows) record('delete', String(row.id))
      },
    }
  }
  return {
    get: (id: string) => engine.read(database => read(database, 'g.id = ?', [id], true)[0] ?? null),
    getLatest: (branchId: string) => engine.read(database => read(database, 'g.branch_id = ?', [branchId], true)[0] ?? null),
    listForSession: (agentSessionId: string) => engine.read(database => read(database, `(
      json_extract(g.metadata_json, '$.agentSessionId') = ? OR EXISTS (
        SELECT 1 FROM json_each(g.metadata_json, '$.candidates') candidate
        WHERE json_extract(candidate.value, '$.agentSessionId') = ?
      ))`, [agentSessionId, agentSessionId])),
    transaction,
  }
}
