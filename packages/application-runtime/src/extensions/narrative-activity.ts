import type { Logger } from '@loom-studio/logging'
import type { DataCommitFact, DataCommitSubscription, SqliteDataEngine } from '@loom-studio/data-engine'
import type { ExtensionNarrativeActivity } from '@loom-studio/extension-sdk'

type BranchHead = { id: string; timeline_id: string; head_node_id: string | null }

/** Capture heads synchronously after COMMIT, before another queued write can run. */
function changedBranches(engine: SqliteDataEngine, commit: DataCommitFact): BranchHead[] {
  const operations = commit.operations.filter(operation => operation.store === 'narrative')
  if (!operations.length) return []
  const database = engine.database
  const branches = new Map<string, BranchHead>()
  const add = (rows: unknown[]) => {
    for (const row of rows as BranchHead[]) branches.set(row.id, row)
  }
  for (const operation of operations) {
    if (operation.entityType === 'narrative.branch') {
      add(database.prepare('SELECT id, timeline_id, head_node_id FROM narrative_branches WHERE id = ?').all(operation.entityId))
    } else if (operation.entityType === 'narrative.swipe-group') {
      add(database.prepare(`SELECT b.id, b.timeline_id, b.head_node_id FROM narrative_branches b
        JOIN narrative_swipe_groups g ON g.branch_id = b.id WHERE g.id = ?`).all(operation.entityId))
    } else if (operation.entityType === 'narrative.node' && operation.kind === 'update') {
      // Legacy in-place edits can affect every branch sharing this node.
      add(database.prepare(`WITH RECURSIVE descendants(id) AS (
        SELECT id FROM narrative_nodes WHERE id = ?
        UNION ALL SELECT n.id FROM narrative_nodes n JOIN descendants d ON n.parent_node_id = d.id
      ) SELECT id, timeline_id, head_node_id FROM narrative_branches WHERE head_node_id IN (SELECT id FROM descendants)`)
        .all(operation.entityId))
    }
  }
  const coveredTimelines = new Set([...branches.values()].map(branch => branch.timeline_id))
  for (const operation of operations) {
    if (operation.entityType !== 'narrative.timeline') continue
    if (operation.kind === 'delete') {
      add(database.prepare('SELECT id, timeline_id, head_node_id FROM narrative_branches WHERE timeline_id = ?').all(operation.entityId))
    } else if (!coveredTimelines.has(operation.entityId)) {
      // Timeline-only commits include persisted active-branch changes. UI selection is not a commit.
      add(database.prepare(`SELECT b.id, b.timeline_id, b.head_node_id FROM narrative_branches b
        JOIN narrative_timelines t ON t.active_branch_id = b.id WHERE t.id = ?`).all(operation.entityId))
    }
  }
  return [...branches.values()]
}

/** Delivery only schedules extension work; foreground turns never await it. */
export function createNarrativeActivityRegistry(engine: SqliteDataEngine, logger?: Logger) {
  const listeners = new Set<(event: ExtensionNarrativeActivity) => void>()
  let commits: DataCommitSubscription | undefined
  const emit = (event: ExtensionNarrativeActivity) => {
    for (const listener of listeners) {
      try { listener(structuredClone(event)) } catch (error) {
        // Post-commit notification failures cannot undo writes or stop other listeners.
        logger?.error('Narrative activity listener failed', { event: 'narrative.notification_failed',
          data: { timelineId: event.timelineId, branchId: event.branchId,
            ...(event.kind === 'changed' ? { changesetId: event.changesetId } : {}),
            error: error instanceof Error ? error.message : String(error) } })
      }
    }
  }
  return {
    subscribe(listener: (event: ExtensionNarrativeActivity) => void) {
      listeners.add(listener)
      commits ??= engine.subscribeCommits(commit => {
        for (const branch of changedBranches(engine, commit)) emit({
          kind: 'changed', timelineId: branch.timeline_id, branchId: branch.id,
          headNodeId: branch.head_node_id, changesetId: commit.changesetId, committedAt: commit.committedAt,
        })
      })
      return { dispose() {
        listeners.delete(listener)
        if (!listeners.size) { commits?.dispose(); commits = undefined }
      } }
    },
    emit,
  }
}
