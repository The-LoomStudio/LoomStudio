import type { SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso, type JsonObject } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import { isJsonValue } from '../json.js'

export type WorkspaceEntry = {
  id: string
  parentId?: string
  name: string
} & ({ kind: 'directory' } | {
  kind: 'file'
  /** Text lives in the versioned tree; binary bytes live in the immutable Blob Store. */
  content: { text: string } | { blobId: string; mediaType?: string }
  injection?: JsonObject
})
export type WorkspaceRevision = {
  id: string
  timelineId: string
  parentRevisionId?: string
  entries: WorkspaceEntry[]
  createdAt: string
}
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>
export const initialWorkspaceEntries = (): WorkspaceEntry[] => [{
  id: 'memory', name: 'MEMORY.md', kind: 'file',
  content: { text: '# 共同工作记忆\n\n暂无共同工作记录。\n' },
}]

export function validateWorkspaceEntries(entries: WorkspaceEntry[]): void {
  if (!Array.isArray(entries)) throw new Error('Workspace entries must be an array')
  const byId = new Map<string, WorkspaceEntry>()
  const names = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || byId.has(entry.id)
      || typeof entry.name !== 'string' || !entry.name || /[/\\\u0000-\u001f]/.test(entry.name)
      || entry.name === '.' || entry.name === '..') throw new Error('Invalid Workspace identity or name')
    const name = JSON.stringify([entry.parentId ?? null, entry.name])
    if (names.has(name)) throw new Error('Workspace sibling names must be unique')
    names.add(name)
    byId.set(entry.id, entry)
    if (entry.kind === 'file') {
      if (entry.injection !== undefined && (entry.injection === null || Array.isArray(entry.injection) || typeof entry.injection !== 'object' || !isJsonValue(entry.injection))) throw new Error('Workspace injection metadata must be a JSON object')
      const value = entry.content
      if (!value || (('text' in value) === ('blobId' in value))
        || ('text' in value ? typeof value.text !== 'string' : typeof value.blobId !== 'string' || !value.blobId)) {
        throw new Error('Workspace file requires text or a Blob reference')
      }
    } else if (entry.kind !== 'directory') throw new Error('Invalid Workspace entry kind')
  }
  for (const entry of entries) {
    const visited = new Set([entry.id])
    let parentId = entry.parentId
    while (parentId !== undefined) {
      const parent = byId.get(parentId)
      if (!parent || parent.kind !== 'directory' || visited.has(parentId)) throw new Error('Invalid Workspace parent or cycle')
      visited.add(parentId)
      parentId = parent.parentId
    }
  }
}

export function createWorkspaceStore(options: { engine: SqliteDataEngine; createId?(prefix: string): string; now?(): string }) {
  const { engine } = options
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso
  engine.migrate({ namespace: 'application.workspace', migrations: [{ version: 1, migrate: db => db.exec(`
    CREATE TABLE workspace_revisions (
      id TEXT PRIMARY KEY, timeline_id TEXT NOT NULL, parent_revision_id TEXT,
      entries_json TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(parent_revision_id) REFERENCES workspace_revisions(id)
    );
    CREATE INDEX workspace_revisions_timeline ON workspace_revisions(timeline_id);
  `) }] })
  type RevisionRow = { id: string; timeline_id: string; parent_revision_id: string | null; entries_json: string; created_at: string }
  const fromRow = (row: RevisionRow): WorkspaceRevision => ({
    id: row.id, timelineId: row.timeline_id, parentRevisionId: row.parent_revision_id ?? undefined,
    entries: JSON.parse(row.entries_json), createdAt: row.created_at,
  })
  const read = (db: DatabaseSync, id: string): WorkspaceRevision | undefined => {
    const row = db.prepare('SELECT * FROM workspace_revisions WHERE id = ?').get(id) as RevisionRow | undefined
    return row && fromRow(row)
  }
  function transaction(tx: SqliteDataTransaction) {
    return {
      get: (id: string) => read(tx.database, id),
      create(input: { id?: string; timelineId: string; parentRevisionId?: string; entries: WorkspaceEntry[] }): WorkspaceRevision {
        validateWorkspaceEntries(input.entries)
        if (input.parentRevisionId && read(tx.database, input.parentRevisionId)?.timelineId !== input.timelineId)
          throw new Error('Workspace parent revision belongs to another Timeline')
        const revision = { ...input, id: input.id ?? nextId('workspace-revision'), entries: structuredClone(input.entries), createdAt: now() }
        // ponytail: Whole-tree snapshots keep initial recovery and archives simple; use shared text references when measured history size warrants them.
        tx.database.prepare('INSERT INTO workspace_revisions VALUES (?, ?, ?, ?, ?)')
          .run(revision.id, revision.timelineId, revision.parentRevisionId ?? null, JSON.stringify(revision.entries), revision.createdAt)
        tx.recordOperations([{ store: 'workspace', kind: 'create', entityId: revision.id, entityType: 'workspace.revision' }])
        return revision
      },
    }
  }
  return {
    transaction,
    get: (id: string) => engine.read(db => read(db, id)),
    list: (timelineId: string) => engine.read(db => (db.prepare('SELECT * FROM workspace_revisions WHERE timeline_id = ?').all(timelineId) as RevisionRow[]).map(fromRow)),
  }
}
