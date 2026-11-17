import type { DataCommitOperationScope } from '@loom-studio/kernel/data-engine'
import type { DatabaseSync } from 'node:sqlite'

const databasesWithTimelines = new WeakSet<DatabaseSync>()

function hasNarrativeTimelinesTable(database: DatabaseSync): boolean {
  if (databasesWithTimelines.has(database)) return true
  const row = database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'narrative_timelines'").get()
  if (!row) return false
  databasesWithTimelines.add(database)
  return true
}

/** Resolve the originating Card ID for a Narrative Timeline within the active SQLite transaction. */
export function readTimelineCardId(database: DatabaseSync, timelineId: string): string | undefined {
  if (!hasNarrativeTimelinesTable(database)) return undefined
  const row = database.prepare('SELECT created_from_card_id FROM narrative_timelines WHERE id = ?').get(timelineId) as
    | { created_from_card_id: string | null }
    | undefined
  return typeof row?.created_from_card_id === 'string' && row.created_from_card_id.length > 0
    ? row.created_from_card_id
    : undefined
}

export function timelineOperationScope(timelineId: string, cardId?: string): DataCommitOperationScope {
  return {
    store: 'narrative',
    entityType: 'narrative.timeline',
    entityId: timelineId,
    timelineId,
    ...(cardId ? { cardId } : {}),
  }
}

export function resolveTimelineOperationScope(database: DatabaseSync, timelineId: string): DataCommitOperationScope {
  return timelineOperationScope(timelineId, readTimelineCardId(database, timelineId))
}
