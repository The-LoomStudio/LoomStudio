import { readChatAttachments, type ChatAttachment } from '@loom-studio/shared'
import { recordUserInteraction } from '../statistics/store.js'
import type { DataCommitOperation, SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso, optionalString } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import { createAgentStore } from '../agent/store.js'
import type { AgentTransaction } from '../agent/types.js'
import { createWorkspaceStore, initialWorkspaceEntries } from '../workspace/store.js'
import { createNarrativeSwipeStore } from './swipes.js'
import type {
  AppendNarrativeUserInputResult,
  CreateNarrativeTimelineInput,
  NarrativeBody,
  NarrativeBranch,
  NarrativeNode,
  NarrativeNodeSource,
  NarrativeRecoveryPoint,
  NarrativeStore,
  NarrativeTimeline,
  NarrativeTransaction,
  NarrativeWriteContext,
} from './types.js'

const migrationNamespace = 'application.narrative'
const defaultPageLimit = 50
const maximumPageLimit = 100

export class NarrativeStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NarrativeStoreError'
  }
}

export type CreateNarrativeStoreOptions = {
  engine: SqliteDataEngine
  createId?(prefix: string): string
  now?(): string
}

export function createNarrativeStore(options: CreateNarrativeStoreOptions): NarrativeStore {
  const { engine } = options
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso

  const workspaces = createWorkspaceStore(options)
  const agents = createAgentStore(options)

  engine.migrate({
    namespace: migrationNamespace,
    migrations: [
      { version: 1, migrate: migrateVersionOne },
      { version: 2, migrate: migrateVersionTwo },
      { version: 3, migrate: migrateVersionThree },
      { version: 4, migrate: database => database.exec('ALTER TABLE narrative_timelines ADD COLUMN opening_json TEXT') },
      { version: 5, migrate: database => database.exec(`
        ALTER TABLE narrative_nodes ADD COLUMN floor INTEGER;
        WITH RECURSIVE positions(id, floor) AS (
          SELECT id, 1 FROM narrative_nodes WHERE parent_node_id IS NULL
          UNION ALL
          SELECT n.id, p.floor + 1 FROM narrative_nodes n JOIN positions p ON n.parent_node_id = p.id
        ) UPDATE narrative_nodes SET floor = (SELECT floor FROM positions WHERE positions.id = narrative_nodes.id);
        CREATE INDEX narrative_nodes_floor ON narrative_nodes(timeline_id, floor);
      `) },
      { version: 6, migrate: database => {
        database.exec(`ALTER TABLE narrative_nodes ADD COLUMN workspace_revision_id TEXT; ALTER TABLE narrative_branches ADD COLUMN workspace_head_revision_id TEXT;
          CREATE TABLE narrative_recovery_points (
            branch_id TEXT NOT NULL REFERENCES narrative_branches(id), node_id TEXT NOT NULL REFERENCES narrative_nodes(id),
            state_revision_id TEXT NOT NULL, workspace_revision_id TEXT NOT NULL REFERENCES workspace_revisions(id),
            PRIMARY KEY(branch_id, node_id)
          )`)

        for (const row of database.prepare('SELECT id FROM narrative_timelines').all() as { id: string }[]) {
          const id = nextId('workspace-revision')
          database.prepare('INSERT INTO workspace_revisions VALUES (?, ?, NULL, ?, ?)').run(id, row.id, JSON.stringify(initialWorkspaceEntries()), now())
          database.prepare('UPDATE narrative_nodes SET workspace_revision_id = ? WHERE timeline_id = ?').run(id, row.id)
          database.prepare('UPDATE narrative_branches SET workspace_head_revision_id = ? WHERE timeline_id = ?').run(id, row.id)
        }
      } },
      // Early v6 databases already have Workspace columns but may lack branch recovery points.
      { version: 7, migrate: database => database.exec(`
        CREATE TABLE IF NOT EXISTS narrative_recovery_points (
          branch_id TEXT NOT NULL REFERENCES narrative_branches(id), node_id TEXT NOT NULL REFERENCES narrative_nodes(id),
          state_revision_id TEXT NOT NULL, workspace_revision_id TEXT NOT NULL REFERENCES workspace_revisions(id),
          PRIMARY KEY(branch_id, node_id)
        )
      `) },
      { version: 8, migrate: migrateNodeKind },
      { version: 9, migrate: database => migrateTimelineAuthority(database, nextId, now) },
    ],
  })
  assertNarrativeSchema(engine.database)
  const swipes = createNarrativeSwipeStore(options)

  function transaction(tx: SqliteDataTransaction): NarrativeTransaction {
    const { database } = tx

    return {
      getRecoveryPoint: (branchId, nodeId) => readRecoveryPoint(database, branchId, nodeId),
      getBranch: id => readBranch(database, id),
      getNode: id => readNode(database, id),
      restoreBranch: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        if ((branch.headNodeId ?? null) !== input.expectedHeadNodeId) {
          throw new NarrativeStoreError('narrative.head_conflict', `Narrative branch head conflict: ${branch.id}`)
        }
        if (branch.stateHeadRevisionId !== input.expectedStateHeadRevisionId) {
          throw new NarrativeStoreError('narrative.state_head_conflict', `Narrative branch state head conflict: ${branch.id}`)
        }
        const node = input.headNodeId === null ? undefined : requireNode(database, input.headNodeId)
        if (node && node.timelineId !== timeline.id) throw new NarrativeStoreError('narrative.timeline_mismatch', 'Restore node timeline mismatch')
        const revision = database.prepare(`SELECT r.id FROM state_revisions r JOIN state_scopes s ON s.id = r.scope_id
          WHERE r.id = ? AND s.kind = 'timeline' AND s.owner_id = ? AND s.deleted_at IS NULL`).get(input.stateRevisionId, timeline.id)
        if (!revision) throw new NarrativeStoreError('narrative.state_scope_mismatch', 'Restore State revision must belong to the timeline scope')
        if (input.expectedWorkspaceHeadRevisionId !== undefined && branch.workspaceHeadRevisionId !== input.expectedWorkspaceHeadRevisionId)
          throw new NarrativeStoreError('narrative.workspace_head_conflict', 'Workspace changed before restore')
        const workspaceRevisionId = input.workspaceRevisionId ?? node?.workspaceRevisionId
        if (!workspaceRevisionId || workspaces.transaction(tx).get(workspaceRevisionId)?.timelineId !== timeline.id)
          throw new NarrativeStoreError('narrative.workspace_scope_mismatch', 'Restore requires a Workspace revision belonging to this Timeline')
        const timestamp = now()
        database.prepare('UPDATE narrative_branches SET head_node_id = ?, state_head_revision_id = ?, workspace_head_revision_id = ?, updated_at = ? WHERE id = ?')
          .run(node?.id ?? null, input.stateRevisionId, workspaceRevisionId, timestamp, branch.id)
        const headEntryId = input.headEntryId === undefined ? (node ? recoveryAtNode(database, branch, node).headEntryId : undefined) : input.headEntryId
        database.prepare('UPDATE narrative_branches SET head_entry_id = ? WHERE id = ?').run(headEntryId ?? null, branch.id)
        if (timeline.activeBranchId === branch.id) agents.transaction(tx).setTimelineHead({ agentSessionId: timeline.id, headEntryId: headEntryId ?? null })
        database.prepare('UPDATE narrative_timelines SET updated_at = ? WHERE id = ?').run(timestamp, timeline.id)
        tx.recordOperations([operation('update', branch.id, 'narrative.branch'), operation('update', timeline.id, 'narrative.timeline')])
        return requireBranch(database, branch.id)
      },
      setBranchWorkspaceHead: input => {
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, input.timelineId)
        if (branch.workspaceHeadRevisionId !== input.expectedRevisionId)
          throw new NarrativeStoreError('narrative.workspace_head_conflict', 'Workspace changed after it was read')
        if (workspaces.transaction(tx).get(input.revisionId)?.timelineId !== input.timelineId)
          throw new NarrativeStoreError('narrative.workspace_scope_mismatch', 'Workspace revision belongs to another Timeline')
        database.prepare('UPDATE narrative_branches SET workspace_head_revision_id = ?, updated_at = ? WHERE id = ?').run(input.revisionId, now(), branch.id)
        tx.recordOperations([operation('update', branch.id, 'narrative.branch')])
        return requireBranch(database, branch.id)
      },
      replaceOpening: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        if ((branch.headNodeId ?? null) !== input.expectedHeadNodeId) {
          throw new NarrativeStoreError('narrative.head_conflict', 'Narrative branch head changed while choosing an opening')
        }
        if (branch.stateHeadRevisionId !== input.expectedStateHeadRevisionId) {
          throw new NarrativeStoreError('narrative.state_head_conflict', 'Narrative State changed while choosing an opening')
        }
        const opening = readEditableOpening(database, timeline, branch)
        if (!opening) {
          throw new NarrativeStoreError('narrative.opening_locked', 'Narrative opening is locked')
        }
        const timestamp = now()
        const nodes: NarrativeNode[] = []
        const replacement = input.openingNode
        if (replacement) {
          validateBody(replacement.body)
          const node = insertNode(database, agents.transaction(tx), tx, branch.id, {
            id: nextId('node'), timelineId: timeline.id,
            stateRevisionId: branch.stateHeadRevisionId, workspaceRevisionId: branch.workspaceHeadRevisionId, body: replacement.body,
            source: { changesetId: tx.changesetId }, createdAt: replacement.createdAt ?? timestamp,
          })
          nodes.push(node)
        }
        database.prepare('UPDATE narrative_branches SET head_node_id = ?, updated_at = ? WHERE id = ?')
          .run(nodes[0]?.id ?? null, timestamp, branch.id)
        if (!nodes.length) agents.transaction(tx).setTimelineHead({ agentSessionId: timeline.id, headEntryId: null })
        if (opening.nodeId) {
          database.prepare('DELETE FROM narrative_recovery_points WHERE node_id = ?').run(opening.nodeId)
          database.prepare('DELETE FROM narrative_nodes WHERE id = ?').run(opening.nodeId)
        }
        database.prepare('UPDATE narrative_timelines SET opening_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify({ id: input.openingId, nodeId: nodes[0]?.id, locked: false }), timestamp, timeline.id)
        tx.recordOperations([
          ...(opening.nodeId ? [operation('delete', opening.nodeId, 'narrative.node')] : []),
          ...nodes.map(node => operation('create', node.id, 'narrative.node')),
          operation('update', branch.id, 'narrative.branch'), operation('update', timeline.id, 'narrative.timeline'),
        ])
        return { timeline: requireTimeline(database, timeline.id), branch: requireBranch(database, branch.id), nodes }
      },
      getTimeline: id => readTimeline(database, id),
      restoreArchivePaths: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const existing = readBranches(database, timeline.id)
        if (existing.length !== 1 || existing[0]!.headNodeId
          || database.prepare('SELECT 1 FROM narrative_nodes WHERE timeline_id = ? LIMIT 1').get(timeline.id)) {
          throw new NarrativeStoreError('narrative.archive_target_not_empty', 'Archive restoration requires an empty timeline')
        }
        for (const node of input.nodes) {
          if (node.timelineId !== timeline.id) throw new NarrativeStoreError('narrative.timeline_mismatch', 'Archive node timeline mismatch')
          validateBody(node.body)
          insertNode(database, agents.transaction(tx), tx, undefined, node)
          tx.recordOperations([operation('create', node.id, 'narrative.node')])
        }
        for (const imported of input.branches) {
          const branch = { ...imported, headEntryId: imported.headEntryId ?? (imported.headNodeId ? requireNode(database, imported.headNodeId).entryId : undefined) }
          assertBranchTimeline(branch, timeline.id)
          if (branch.id === timeline.activeBranchId) {
            if (branch.parentBranchId || branch.forkedFromNodeId) throw new NarrativeStoreError('narrative.archive_root_invalid', 'Archive root cannot have a parent')
            database.prepare('UPDATE narrative_branches SET head_node_id = ?, state_head_revision_id = ?, workspace_head_revision_id = ?, updated_at = ?, head_entry_id = ? WHERE id = ?')
              .run(branch.headNodeId ?? null, branch.stateHeadRevisionId, branch.workspaceHeadRevisionId, branch.updatedAt, branch.headEntryId ?? null, branch.id)
            tx.recordOperations([operation('update', branch.id, 'narrative.branch')])
          } else {
            insertBranch(database, branch)
            tx.recordOperations([operation('create', branch.id, 'narrative.branch')])
          }
        }
        for (const point of input.recoveryPoints ?? []) {
          if (!input.branches.some(branch => branch.id === point.branchId) || !input.nodes.some(node => node.id === point.nodeId))
            throw new NarrativeStoreError('narrative.recovery_invalid', 'Recovery point must belong to the imported path')
          writeRecoveryPoint(database, { ...point, headEntryId: point.headEntryId ?? requireNode(database, point.nodeId).entryId })
        }
        const active = requireBranch(database, timeline.activeBranchId)
        agents.transaction(tx).setTimelineHead({ agentSessionId: timeline.id, headEntryId: active.headEntryId ?? null })
      },
      editBranchNode: input => {
        validateBody(input.body)
        validateBody(input.expectedBody, true)
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        if (branch.headNodeId !== input.expectedHeadNodeId) {
          throw new NarrativeStoreError('narrative.head_conflict', 'Narrative branch changed while editing')
        }
        const suffix: NarrativeNode[] = []
        let cursor: string | undefined = branch.headNodeId
        while (cursor) {
          const node = requireNode(database, cursor)
          suffix.push(node)
          if (node.id === input.nodeId) break
          cursor = node.parentNodeId
        }
        const target = suffix.at(-1)
        if (!target || target.id !== input.nodeId) {
          throw new NarrativeStoreError('narrative.node_not_in_branch', 'Edited node is not in the branch')
        }
        if (target.body.format !== input.expectedBody.format || target.body.raw !== input.expectedBody.raw) {
          throw new NarrativeStoreError('narrative.body_conflict', 'Narrative text changed while editing')
        }
        const opening = readEditableOpening(database, timeline, branch)
        captureBranchRecovery(database, branch)
        const adoptedHead = agents.transaction(tx).getSession(timeline.id)!.headEntryId
        if (timeline.activeBranchId !== branch.id)
          database.prepare('UPDATE agent_sessions SET head_entry_id = ? WHERE id = ?').run(branch.headEntryId ?? null, timeline.id)
        const replacements: Array<{ previousNodeId: string; node: NarrativeNode }> = []
        let parentNodeId = target.parentNodeId
        // ponytail: Copying the suffix is linear in later messages; keeps branch isolation without mutable shared text.
        for (const previous of suffix.reverse()) {
          const node = insertNode(database, agents.transaction(tx), tx, branch.id, {
            ...previous,
            attachments: nodeAttachments(agents.transaction(tx), previous),
            id: nextId('node'),
            parentNodeId,
            body: previous.id === target.id ? input.body : previous.body,
            entryId: previous.id === target.id ? undefined : previous.entryId,
            source: previous.id === target.id ? { ...previous.source, agentMessageId: undefined } : previous.source,
          }, input.executionRunId)
          writeRecoveryPoint(database, { ...recoveryAtNode(database, branch, previous), nodeId: node.id, headEntryId: previous.id === target.id ? node.entryId : recoveryAtNode(database, branch, previous).headEntryId })
          replacements.push({ previousNodeId: previous.id, node })
          parentNodeId = node.id
        }
        const revisedHead = agents.transaction(tx).getSession(timeline.id)!.headEntryId
        if (timeline.activeBranchId !== branch.id)
          database.prepare('UPDATE agent_sessions SET head_entry_id = ? WHERE id = ?').run(adoptedHead ?? null, timeline.id)
        database.prepare('UPDATE narrative_branches SET head_entry_id = ? WHERE id = ?').run(revisedHead ?? null, branch.id)
        const timestamp = now()
        database.prepare('UPDATE narrative_branches SET head_node_id = ?, updated_at = ? WHERE id = ?')
          .run(parentNodeId!, timestamp, branch.id)
        let updatedOpening = timeline.opening
        if (opening) {
          updatedOpening = { ...opening, nodeId: replacements[0]!.node.id, custom: true }
          database.prepare('DELETE FROM narrative_recovery_points WHERE node_id = ?').run(opening.nodeId!)
          database.prepare('DELETE FROM narrative_nodes WHERE id = ?').run(opening.nodeId!)
        }
        database.prepare('UPDATE narrative_timelines SET opening_json = ?, updated_at = ? WHERE id = ?')
          .run(updatedOpening ? JSON.stringify(updatedOpening) : null, timestamp, timeline.id)
        tx.recordOperations([
          ...replacements.map(({ node }) => operation('create', node.id, 'narrative.node')),
          ...(opening ? replacements.map(({ previousNodeId }) => operation('delete', previousNodeId, 'narrative.node')) : []),
          operation('update', branch.id, 'narrative.branch'),
          operation('update', timeline.id, 'narrative.timeline'),
        ])
        return { timeline: requireTimeline(database, timeline.id), branch: requireBranch(database, branch.id), replacements }
      },
      createTimeline: input => {
        const timestamp = now()
        const timelineId = input.id ?? nextId('timeline')
        agents.transaction(tx).createTimelineSession({ id: timelineId, title: input.title })
        const branchId = input.primaryBranchId ?? nextId('branch')
        const workspaceRevisionId = workspaces.transaction(tx).create({ timelineId, entries: initialWorkspaceEntries() }).id
        const promptResourceIds = [...new Set(input.promptResourceIds ?? [])]
        validateOptionalText(input.title, 'title')
        validateId(input.stateRevisionId, 'stateRevisionId')
        validateCreatedFrom(input.createdFrom)
        validateStringIds(promptResourceIds, 'promptResourceIds')

        database.prepare(`
          INSERT INTO narrative_timelines (
            id, title, created_from_card_id, created_from_card_version,
            prompt_resource_ids_json, active_branch_id, created_at, updated_at, tombstoned
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0)
        `).run(
          timelineId,
          input.title ?? null,
          input.createdFrom?.cardId ?? null,
          input.createdFrom?.cardVersion ?? null,
          JSON.stringify(promptResourceIds),
          timestamp,
          timestamp,
        )

        const nodes: NarrativeNode[] = []
        const opening = input.openingNode
        if (opening) {
          validateBody(opening.body)
          const node = insertNode(database, agents.transaction(tx), tx, branchId, {
            id: opening.id ?? nextId('node'),
            timelineId,
            stateRevisionId: input.stateRevisionId,
            workspaceRevisionId,
            body: opening.body,
            source: { ...opening.source, changesetId: tx.changesetId },
            createdAt: opening.createdAt ?? now(),
          })
          nodes.push(node)
        }

        const branch: NarrativeBranch = {
          id: branchId,
          timelineId,
          title: input.primaryBranchTitle,
          headNodeId: nodes[0]?.id,
          headEntryId: agents.transaction(tx).getSession(timelineId)?.headEntryId,
          stateHeadRevisionId: input.stateRevisionId,
          workspaceHeadRevisionId: workspaceRevisionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        validateOptionalText(branch.title, 'primaryBranchTitle')
        insertBranch(database, branch)
        database.prepare('UPDATE narrative_timelines SET active_branch_id = ?, opening_json = ? WHERE id = ?')
          .run(branchId, input.opening ? JSON.stringify({ ...input.opening, nodeId: nodes[0]?.id ?? input.opening.nodeId }) : null, timelineId)

        tx.recordOperations([
          operation('create', timelineId, 'narrative.timeline'),
          operation('create', branchId, 'narrative.branch'),
          ...nodes.map(node => operation('create', node.id, 'narrative.node')),
        ])

        return {
          timeline: requireTimeline(database, timelineId),
          branch,
          nodes,
        }
      },

      appendNode: input => {
        validateBody(input.body, input.kind === 'user-input' && Boolean(input.attachments?.length))
        readChatAttachments(input.attachments)
        validateId(input.stateRevisionId, 'stateRevisionId')
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        const expectedHead = input.expectedHeadNodeId ?? undefined
        if (branch.headNodeId !== expectedHead) {
          throw new NarrativeStoreError('narrative.head_conflict', `Narrative branch head conflict: ${branch.id}`)
        }

        const sourceEntry = input.source?.agentMessageId ? agents.transaction(tx).getEntry(input.source.agentMessageId) : null
        let recoveryHeadEntryId = branch.headEntryId
        if (sourceEntry?.agentSessionId === timeline.id && sourceEntry.entry.kind === 'message' && sourceEntry.entry.content === input.body.raw) {
          let firstSegment = sourceEntry
          while (firstSegment.entry.kind === 'message' && firstSegment.entry.continuesEntryId)
            firstSegment = agents.transaction(tx).getEntry(firstSegment.entry.continuesEntryId)!
          recoveryHeadEntryId = firstSegment.parentEntryId
        }
        captureBranchRecovery(database, { ...branch, headEntryId: recoveryHeadEntryId })
        const adoptedHead = agents.transaction(tx).getSession(timeline.id)!.headEntryId
        if (timeline.activeBranchId !== branch.id)
          database.prepare('UPDATE agent_sessions SET head_entry_id = ? WHERE id = ?').run(branch.headEntryId ?? null, timeline.id)
        const node = insertNode(database, agents.transaction(tx), tx, branch.id, {
          id: input.nodeId ?? nextId('node'),
          kind: input.kind ?? 'narrative',
          timelineId: timeline.id,
          parentNodeId: branch.headNodeId,
          stateRevisionId: input.stateRevisionId,
          workspaceRevisionId: branch.workspaceHeadRevisionId,
          body: input.body,
          attachments: input.attachments,
          source: { ...input.source, changesetId: tx.changesetId },
          createdAt: now(),
        })
        const appendedHead = agents.transaction(tx).getSession(timeline.id)!.headEntryId
        if (timeline.activeBranchId !== branch.id)
          database.prepare('UPDATE agent_sessions SET head_entry_id = ? WHERE id = ?').run(adoptedHead ?? null, timeline.id)
        database.prepare('UPDATE narrative_branches SET head_entry_id = ? WHERE id = ?').run(appendedHead ?? null, branch.id)
        const updatedAt = now()
        database.prepare(`
          UPDATE narrative_branches
          SET head_node_id = ?, state_head_revision_id = ?, updated_at = ?
          WHERE id = ?
        `).run(node.id, input.stateRevisionId, updatedAt, branch.id)
        database.prepare('UPDATE narrative_timelines SET opening_json = ?, updated_at = ? WHERE id = ?')
          .run(timeline.opening ? JSON.stringify({ ...timeline.opening, locked: true }) : null, updatedAt, timeline.id)
        tx.recordOperations([
          operation('create', node.id, 'narrative.node'),
          operation('update', branch.id, 'narrative.branch'),
          operation('update', timeline.id, 'narrative.timeline'),
        ])

        return {
          timeline: requireTimeline(database, timeline.id),
          branch: requireBranch(database, branch.id),
          node,
        }
      },

      editNode: input => {
        validateBody(input.body)
        const timeline = requireTimeline(database, input.timelineId)
        const existingNode = requireNode(database, input.nodeId)
        if (existingNode.timelineId !== timeline.id) {
          throw new NarrativeStoreError('narrative.node_not_found', `Narrative node ${input.nodeId} does not belong to timeline ${timeline.id}`)
        }
        const opening = readEditableOpening(database, timeline, requireBranch(database, timeline.activeBranchId))
        const session = agents.transaction(tx).getSession(timeline.id)!
        const saved = agents.transaction(tx).appendEntries({ agentSessionId: timeline.id, expectedEntryCount: session.entryCount,
          entries: [{ entry: { kind: 'message', role: existingNode.kind === 'user-input' ? 'user' : 'assistant',
            content: input.body.raw, attachments: nodeAttachments(agents.transaction(tx), existingNode), purpose: 'narrative', narrativeId: existingNode.id } }] }).entries[0]!
        database.prepare('UPDATE narrative_nodes SET entry_id = ? WHERE id = ?').run(saved.id, existingNode.id)
        const updatedAt = now()
        database.prepare('UPDATE narrative_timelines SET opening_json = ?, updated_at = ? WHERE id = ?')
          .run(timeline.opening ? JSON.stringify(opening ? { ...opening, custom: true } : timeline.opening) : null, updatedAt, timeline.id)
        tx.recordOperations([
          operation('update', existingNode.id, 'narrative.node'),
          operation('update', timeline.id, 'narrative.timeline'),
        ])
        return {
          node: requireNode(database, existingNode.id),
          timeline: requireTimeline(database, timeline.id),
        }
      },

      forkBranch: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const sourceBranch = requireBranch(database, input.fromBranchId)
        assertBranchTimeline(sourceBranch, timeline.id)
        const fromNode = requireNode(database, input.fromNodeId)
        if (fromNode.timelineId !== timeline.id || !isNodeInBranchPath(database, sourceBranch, fromNode.id)) {
          throw new NarrativeStoreError('narrative.node_not_in_branch', `Narrative node is not in branch path: ${fromNode.id}`)
        }
        validateOptionalText(input.title, 'title')
        captureBranchRecovery(database, sourceBranch)
        const recovery = readRecoveryPoint(database, sourceBranch.id, fromNode.id)
        const timestamp = now()
        const branch: NarrativeBranch = {
          id: input.branchId ?? nextId('branch'),
          timelineId: timeline.id,
          title: input.title,
          headNodeId: fromNode.id,
          headEntryId: recovery.headEntryId,
          stateHeadRevisionId: recovery.stateRevisionId,
          workspaceHeadRevisionId: recovery.workspaceRevisionId,
          parentBranchId: sourceBranch.id,
          forkedFromNodeId: fromNode.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        insertBranch(database, branch)
        let cursor: string | undefined = fromNode.id
        while (cursor) {
          const node = requireNode(database, cursor)
          writeRecoveryPoint(database, { ...recoveryAtNode(database, sourceBranch, node), branchId: branch.id })
          cursor = node.parentNodeId
        }
        database.prepare('UPDATE narrative_timelines SET opening_json = ?, updated_at = ? WHERE id = ?')
          .run(timeline.opening ? JSON.stringify({ ...timeline.opening, locked: true }) : null, timestamp, timeline.id)
        tx.recordOperations([operation('create', branch.id, 'narrative.branch'), operation('update', timeline.id, 'narrative.timeline')])
        return branch
      },

      setBranchStateHead: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        const expected = input.expectedStateHeadRevisionId ?? undefined
        if (branch.stateHeadRevisionId !== expected) {
          throw new NarrativeStoreError('narrative.state_head_conflict', `Narrative branch state head conflict: ${branch.id}`)
        }
        validateId(input.stateRevisionId, 'stateRevisionId')
        const updatedAt = now()
        database.prepare('UPDATE narrative_branches SET state_head_revision_id = ?, updated_at = ? WHERE id = ?')
          .run(input.stateRevisionId, updatedAt, branch.id)
        database.prepare('UPDATE narrative_timelines SET updated_at = ? WHERE id = ?').run(updatedAt, timeline.id)
        tx.recordOperations([
          operation('update', branch.id, 'narrative.branch'),
          operation('update', timeline.id, 'narrative.timeline'),
        ])
        return requireBranch(database, branch.id)
      },

      switchBranch: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        if (input.expectedActiveBranchId !== undefined && timeline.activeBranchId !== input.expectedActiveBranchId) {
          throw new NarrativeStoreError('narrative.active_branch_conflict', `Narrative active branch conflict: ${timeline.id}`)
        }
        database.prepare('UPDATE narrative_timelines SET active_branch_id = ?, updated_at = ? WHERE id = ?')
          .run(branch.id, now(), timeline.id)
        agents.transaction(tx).setTimelineHead({ agentSessionId: timeline.id, headEntryId: branch.headEntryId ?? null })
        tx.recordOperations([operation('update', timeline.id, 'narrative.timeline')])
        return requireTimeline(database, timeline.id)
      },

      deleteTimeline: input => {
        const timeline = requireTimeline(database, input.timelineId)
        swipes.transaction(tx).deleteTimeline(timeline.id)
        agents.transaction(tx).deleteSession({ agentSessionId: timeline.id })
        const deletedAt = now()
        database.prepare(`
          UPDATE narrative_timelines
          SET tombstoned = 1, deleted_at = ?, deleted_by_json = ?, delete_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(deletedAt, JSON.stringify(tx.actor), tx.reason ?? null, deletedAt, timeline.id)
        tx.recordOperations([operation('delete', timeline.id, 'narrative.timeline')])
        return requireTimeline(database, timeline.id, true)
      },

      updatePromptResources: input => {
        const timeline = requireTimeline(database, input.timelineId)
        const promptResourceIds = [...new Set(input.promptResourceIds)]
        validateStringIds(promptResourceIds, 'promptResourceIds')
        if (input.expectedPromptResourceIds && !sameStringArray(timeline.promptResourceIds, input.expectedPromptResourceIds)) {
          throw new NarrativeStoreError('narrative.prompt_resources_conflict', `Narrative prompt resources changed: ${timeline.id}`)
        }
        database.prepare(`
          UPDATE narrative_timelines
          SET prompt_resource_ids_json = ?, updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(promptResourceIds), now(), timeline.id)
        tx.recordOperations([operation('update', timeline.id, 'narrative.timeline')])
        return requireTimeline(database, timeline.id)
      },

      updateTimeline: input => {
        const timeline = requireTimeline(database, input.timelineId)
        validateOptionalText(input.title, 'title')
        database.prepare(`
          UPDATE narrative_timelines
          SET title = ?, updated_at = ?
          WHERE id = ?
        `).run(input.title ?? null, now(), timeline.id)
        tx.recordOperations([operation('update', timeline.id, 'narrative.timeline')])
        return requireTimeline(database, timeline.id)
      },
    }
  }

  async function write<T>(context: NarrativeWriteContext, callback: (tx: NarrativeTransaction) => T): Promise<{ value: T; commit: Awaited<ReturnType<SqliteDataEngine['transact']>>['commit'] }> {
    return engine.transact(context, dataTx => Promise.resolve(callback(transaction(dataTx))))
  }

  return {
    editBranchNode: async input => {
      const result = await write(input, tx => tx.editBranchNode(input))
      return { ...result.value, commit: result.commit }
    },
    getTimeline: (id, options) => engine.read(database => readTimeline(database, id, options?.includeDeleted)),
    listTimelines: input => engine.read(database => readTimelines(database, input)),
    listSearchTimelines: () => engine.read(database => {
      const rows = database.prepare(`
        SELECT id, title, created_from_card_id, created_from_card_version
        FROM narrative_timelines WHERE tombstoned = 0 ORDER BY id
      `).all() as Array<{ id: string; title: string | null; created_from_card_id: string | null; created_from_card_version: number | null }>
      return rows.map(row => ({
        id: row.id,
        title: row.title ?? undefined,
        createdFrom: row.created_from_card_id !== null && row.created_from_card_version !== null
          ? { cardId: row.created_from_card_id, cardVersion: row.created_from_card_version } : undefined,
      }))
    }),
    listRecoveryPoints: timelineId => engine.read(database => {
      requireTimeline(database, timelineId)
      return (database.prepare(`SELECT p.* FROM narrative_recovery_points p JOIN narrative_branches b ON b.id = p.branch_id WHERE b.timeline_id = ?`).all(timelineId) as Record<string, string>[]).map(recoveryFromRow)
    }),
    getRecoveryPoint: (branchId, nodeId) => engine.read(database => readRecoveryPoint(database, branchId, nodeId)),
    getBranch: (id, options) => engine.read(database => readBranch(database, id, options?.includeDeleted)),
    listBranches: timelineId => engine.read(database => readBranches(database, timelineId)),
    getNode: (id, options) => engine.read(database => readNode(database, id, options?.includeDeleted)),
    listNodes: timelineId => engine.read(database => {
      const rows = database.prepare(`SELECT id, timeline_id, parent_node_id, state_revision_id, workspace_revision_id, floor, body_format, body_raw,
        source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, kind, entry_id
        FROM narrative_node_projection WHERE timeline_id = ? ORDER BY created_at ASC, id ASC`).all(timelineId)
      return rows.map(row => nodeFromRow(row))
    }),
    getPage: input => engine.read(database => readPage(database, input)),
    createTimeline: async input => {
      const result = await write(input, tx => tx.createTimeline(input))
      return { ...result.value, commit: result.commit }
    },
    appendNode: async input => {
      const result = await write(input, tx => tx.appendNode(input))
      return { ...result.value, commit: result.commit }
    },
    appendInput: async input => {
      validateId(input.nodeId, 'nodeId')
      validateBody(input.body, Boolean(input.attachments?.length))
      readChatAttachments(input.attachments)
      const alreadyCommitted = new Error('Narrative input already committed')
      let replay: AppendNarrativeUserInputResult | undefined
      try {
        const result = await engine.transact(input, async dataTx => {
          const { database } = dataTx
          const node = readNode(database, input.nodeId)
          if (node) {
            const savedAttachments = nodeAttachments(agents.transaction(dataTx), node)
            const receipt = database.prepare('SELECT id, reason, operations_json FROM changesets WHERE id = ?')
              .get(node.source?.changesetId ?? null)
            const operations = receipt ? JSON.parse(String(receipt.operations_json)) as DataCommitOperation[] : []
            if (node.kind !== 'user-input' || node.timelineId !== input.timelineId
              || (node.parentNodeId ?? null) !== input.expectedHeadNodeId
              || node.body.format !== input.body.format
              || node.body.raw !== input.body.raw
              || JSON.stringify(savedAttachments ?? []) !== JSON.stringify(input.attachments ?? [])
              || !receipt
              || (receipt.reason ?? undefined) !== input.reason
              || !operations.some(item => item.store === 'narrative' && item.kind === 'create'
                && item.entityType === 'narrative.node' && item.entityId === node.id)
              || !operations.some(item => item.store === 'narrative' && item.kind === 'update'
                && item.entityType === 'narrative.branch' && item.entityId === input.branchId)) {
              throw new NarrativeStoreError('narrative.input_conflict', `Narrative input node conflict: ${input.nodeId}`)
            }
            const timeline = requireTimeline(database, input.timelineId)
            const branch = requireBranch(database, input.branchId)
            assertBranchTimeline(branch, timeline.id)
            replay = { timeline, branch, node, commit: { changesetId: String(receipt.id) } }
            // The Engine rejects empty commits; roll back this read-only attempt
            // and return the original receipt without emitting a new Changeset.
            throw alreadyCommitted
          }
          const branch = requireBranch(database, input.branchId)
          const swipeTx = swipes.transaction(dataTx)
          const group = swipeTx.getLatest(branch.id)
          const active = group?.candidates.find(candidate => candidate.id === group.activeCandidateId)
          if (group?.activeRunId && active && (active.status === 'running' || active.status === 'suspended')) {
            throw new NarrativeStoreError('narrative.swipe_active', 'Active Swipe execution must finish or be abandoned before new input')
          }
          swipeTx.closeLatest(branch.id)
          if (input.actor.kind === 'client') recordUserInteraction(dataTx, { id: input.nodeId, timelineId: input.timelineId, kind: 'narrative' })
          return transaction(dataTx).appendNode({
            ...input, kind: 'user-input',
            stateRevisionId: branch.stateHeadRevisionId,
          })
        })
        return { ...result.value, commit: { changesetId: result.commit.changesetId } }
      } catch (error) {
        if (error !== alreadyCommitted) throw error
        return replay!
      }
    },
    editNode: async input => {
      const result = await write(input, tx => tx.editNode(input))
      return { ...result.value, commit: result.commit }
    },
    forkBranch: async input => {
      const result = await write(input, tx => tx.forkBranch(input))
      return { branch: result.value, commit: result.commit }
    },
    setBranchStateHead: async input => {
      const result = await write(input, tx => tx.setBranchStateHead(input))
      return { branch: result.value, commit: result.commit }
    },
    switchBranch: async input => {
      const result = await write(input, tx => tx.switchBranch(input))
      return { timeline: result.value, commit: result.commit }
    },
    deleteTimeline: async input => {
      const result = await write(input, tx => tx.deleteTimeline(input))
      return { timeline: result.value, commit: result.commit }
    },
    updateTimeline: async input => {
      const result = await write(input, tx => tx.updateTimeline(input))
      return { timeline: result.value, commit: result.commit }
    },
    updatePromptResources: async input => {
      const result = await write(input, tx => tx.updatePromptResources(input))
      return { timeline: result.value, commit: result.commit }
    },
    transaction,
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function readEditableOpening(database: DatabaseSync, timeline: NarrativeTimeline, branch: NarrativeBranch): NarrativeTimeline['opening'] {
  const opening = timeline.opening
  if (!opening || opening.locked || timeline.activeBranchId !== branch.id || readBranches(database, timeline.id).length !== 1) return undefined
  if (opening.nodeId) {
    const node = requireNode(database, opening.nodeId)
    if (node.timelineId !== timeline.id || node.parentNodeId) return undefined
  }
  const count = database.prepare('SELECT count(*) AS count FROM narrative_node_projection WHERE timeline_id = ?').get(timeline.id)!
  return branch.headNodeId === opening.nodeId && Number(count.count) === (opening.nodeId ? 1 : 0) ? opening : undefined
}

function migrateNodeKind(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE narrative_nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'narrative' CHECK (kind IN ('user-input', 'narrative'));
    UPDATE narrative_nodes SET kind = 'user-input'
    WHERE source_changeset_id IN (SELECT id FROM changesets WHERE reason = 'application.appendNarrativeInput');
  `)
  // A fresh Narrative database creates the Swipe store after these migrations.
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'narrative_swipe_groups'").get()) {
    database.exec(`
      UPDATE narrative_nodes SET kind = 'user-input' WHERE id IN (
        SELECT json_extract(metadata_json, '$.inputNodeId') FROM narrative_swipe_groups
        UNION
        SELECT json_extract(input.value, '$.nodeId') FROM narrative_swipe_groups AS g, json_each(g.metadata_json, '$.inputs') AS input
      );
    `)
  }
}

function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE narrative_timelines (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_from_card_id TEXT,
      created_from_card_version INTEGER,
      prompt_resource_ids_json TEXT NOT NULL,
      active_branch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_json TEXT,
      delete_reason TEXT,
      CHECK (created_from_card_version IS NULL OR created_from_card_version > 0),
      FOREIGN KEY(id, active_branch_id)
        REFERENCES narrative_branches(timeline_id, id)
        DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE narrative_branches (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES narrative_timelines(id),
      title TEXT,
      head_node_id TEXT,
      parent_branch_id TEXT,
      forked_from_node_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(timeline_id, id),
      FOREIGN KEY(timeline_id, head_node_id)
        REFERENCES narrative_nodes(timeline_id, id),
      FOREIGN KEY(timeline_id, parent_branch_id)
        REFERENCES narrative_branches(timeline_id, id),
      FOREIGN KEY(timeline_id, forked_from_node_id)
        REFERENCES narrative_nodes(timeline_id, id)
    );

    CREATE TABLE narrative_nodes (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES narrative_timelines(id),
      parent_node_id TEXT,
      body_format TEXT NOT NULL CHECK (body_format = 'loom-markdown.v1'),
      body_raw TEXT NOT NULL,
      source_agent_session_id TEXT,
      source_agent_message_id TEXT,
      source_run_id TEXT,
      source_changeset_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(timeline_id, id),
      FOREIGN KEY(timeline_id, parent_node_id)
        REFERENCES narrative_nodes(timeline_id, id)
    );

    CREATE INDEX idx_narrative_branches_timeline ON narrative_branches(timeline_id);
    CREATE INDEX idx_narrative_nodes_timeline_parent ON narrative_nodes(timeline_id, parent_node_id);
    CREATE INDEX idx_narrative_nodes_timeline_created ON narrative_nodes(timeline_id, created_at);
  `)
}

function migrateVersionTwo(database: DatabaseSync): void {
  database.exec(`
    CREATE INDEX idx_narrative_timelines_card_updated
    ON narrative_timelines(created_from_card_id, updated_at DESC, id DESC);
  `)
}

function migrateVersionThree(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE narrative_branches ADD COLUMN state_head_revision_id TEXT;
    ALTER TABLE narrative_nodes ADD COLUMN state_revision_id TEXT;
    CREATE INDEX idx_narrative_branches_state_head ON narrative_branches(state_head_revision_id);
    CREATE INDEX idx_narrative_nodes_state_revision ON narrative_nodes(state_revision_id);
  `)
}

function assertNarrativeSchema(database: DatabaseSync): void {
  const timelineForeignKeys = database.prepare("PRAGMA foreign_key_list('narrative_timelines')").all() as Array<{ table?: string; from?: string; to?: string }>
  const branchForeignKeys = database.prepare("PRAGMA foreign_key_list('narrative_branches')").all() as Array<{ table?: string; from?: string; to?: string }>
  const nodeForeignKeys = database.prepare("PRAGMA foreign_key_list('narrative_nodes')").all() as Array<{ table?: string; from?: string; to?: string }>
  const hasActiveBranchForeignKey = timelineForeignKeys.some(foreignKey =>
    foreignKey.table === 'narrative_branches'
    && foreignKey.from === 'active_branch_id'
    && foreignKey.to === 'id')
  const hasBranchHeadForeignKey = branchForeignKeys.some(foreignKey =>
    foreignKey.table === 'narrative_nodes'
    && foreignKey.from === 'head_node_id'
    && foreignKey.to === 'id')
  const hasNodeParentForeignKey = nodeForeignKeys.some(foreignKey =>
    foreignKey.table === 'narrative_nodes'
    && foreignKey.from === 'parent_node_id'
    && foreignKey.to === 'id')
  if (!hasActiveBranchForeignKey || !hasBranchHeadForeignKey || !hasNodeParentForeignKey) {
    throw new NarrativeStoreError('narrative.sqlite_schema_invalid', 'Narrative SQLite schema is missing required identity foreign keys')
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) {
    throw new NarrativeStoreError('narrative.sqlite_schema_invalid', `Narrative SQLite schema contains ${violations.length} foreign key violations`)
  }
}

function recoveryFromRow(row: Record<string, string>): NarrativeRecoveryPoint {
  return { headEntryId: optionalString(row.head_entry_id), branchId: row.branch_id!, nodeId: row.node_id!, stateRevisionId: row.state_revision_id!, workspaceRevisionId: row.workspace_revision_id! }
}
function writeRecoveryPoint(database: DatabaseSync, point: NarrativeRecoveryPoint) {
  database.prepare('INSERT OR REPLACE INTO narrative_recovery_points (branch_id, node_id, state_revision_id, workspace_revision_id, head_entry_id) VALUES (?, ?, ?, ?, ?)')
    .run(point.branchId, point.nodeId, point.stateRevisionId, point.workspaceRevisionId, point.headEntryId ?? null)
}
function captureBranchRecovery(database: DatabaseSync, branch: NarrativeBranch) {
  if (branch.headNodeId) writeRecoveryPoint(database, { branchId: branch.id, nodeId: branch.headNodeId,
    stateRevisionId: branch.stateHeadRevisionId, workspaceRevisionId: branch.workspaceHeadRevisionId, headEntryId: branch.headEntryId })
}
function readRecoveryPoint(database: DatabaseSync, branchId: string, nodeId: string): NarrativeRecoveryPoint {
  const branch = requireBranch(database, branchId)
  const node = requireNode(database, nodeId)
  if (!isNodeInBranchPath(database, branch, node.id)) throw new NarrativeStoreError('narrative.node_not_in_branch', 'Recovery node is not on this branch')
  return recoveryAtNode(database, branch, node)
}
function recoveryAtNode(database: DatabaseSync, branch: NarrativeBranch, node: NarrativeNode): NarrativeRecoveryPoint {
  const branchId = branch.id
  const nodeId = node.id
  if (branch.headNodeId === nodeId) return { branchId, nodeId, stateRevisionId: branch.stateHeadRevisionId, workspaceRevisionId: branch.workspaceHeadRevisionId, headEntryId: branch.headEntryId }
  const row = database.prepare('SELECT * FROM narrative_recovery_points WHERE branch_id = ? AND node_id = ?').get(branchId, nodeId) as Record<string, string> | undefined
  return row ? recoveryFromRow(row) : { branchId, nodeId, stateRevisionId: node.stateRevisionId, workspaceRevisionId: node.workspaceRevisionId, headEntryId: node.entryId }
}

function insertBranch(database: DatabaseSync, branch: NarrativeBranch): void {
  database.prepare(`
    INSERT INTO narrative_branches (
      id, timeline_id, title, head_node_id, state_head_revision_id, workspace_head_revision_id,
      parent_branch_id, forked_from_node_id, created_at, updated_at, head_entry_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    branch.id,
    branch.timelineId,
    branch.title ?? null,
    branch.headNodeId ?? null,
    branch.stateHeadRevisionId,
    branch.workspaceHeadRevisionId,
    branch.parentBranchId ?? null,
    branch.forkedFromNodeId ?? null,
    branch.createdAt,
    branch.updatedAt,
    branch.headEntryId ?? null,
  )
}

function insertNode(database: DatabaseSync, agent: AgentTransaction, tx: SqliteDataTransaction, targetBranchId: string | undefined, input: Omit<NarrativeNode, 'floor' | 'kind'> & { floor?: number; kind?: NarrativeNode['kind']; attachments?: ChatAttachment[] }, executionRunId?: string): NarrativeNode {
  const parentFloor = input.parentNodeId ? requireNode(database, input.parentNodeId).floor : 0
  const floor = input.floor ?? parentFloor + 1
  if (!Number.isSafeInteger(floor) || floor <= parentFloor) {
    throw new NarrativeStoreError('narrative.floor_invalid', 'Floor must be a positive integer greater than its parent floor')
  }
  const referenced = input.entryId ? agent.getEntry(input.entryId) : input.source?.agentMessageId ? agent.getEntry(input.source.agentMessageId) : null
  const canReuse = referenced?.agentSessionId === input.timelineId && referenced.entry.kind === 'message' && referenced.entry.content === input.body.raw
  const session = agent.getSession(input.timelineId)!
  const entryId = canReuse ? referenced.id : agent.appendEntries({ agentSessionId: input.timelineId, expectedEntryCount: session.entryCount,
    entries: [{ ...(executionRunId ? { runId: executionRunId } : input.source?.agentSessionId === input.timelineId && input.source.runId ? { runId: input.source.runId } : {}), entry: { kind: 'message', role: input.kind === 'user-input' ? 'user' : 'assistant', content: input.body.raw,
      purpose: 'narrative', narrativeId: input.id, ...(input.attachments?.length ? { attachments: input.attachments } : {}) } }] }, targetBranchId ? { timelineBranchId: targetBranchId } : undefined).entries[0]!.id
  if (canReuse && !input.entryId && referenced.entry.kind === 'message') {
    database.prepare(`UPDATE agent_transcript_entries SET entry_json = json_set(entry_json, '$.purpose', 'narrative', '$.narrativeId', COALESCE(json_extract(entry_json, '$.narrativeId'), ?)) WHERE id = ?`)
      .run(input.id, entryId)
    tx.recordOperations([{ store: 'agent', kind: 'update', entityId: entryId, entityType: 'agent.transcript-entry' }])
  }
  const node = { ...input, entryId, floor, kind: input.kind ?? 'narrative' }
  database.prepare(`
    INSERT INTO narrative_nodes (
      id, timeline_id, parent_node_id, state_revision_id, workspace_revision_id, floor, entry_id,
      source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id,
    node.timelineId,
    node.parentNodeId ?? null,
    node.stateRevisionId,
    node.workspaceRevisionId,
    node.floor,
    node.entryId,
    node.source?.agentSessionId ?? null,
    node.source?.agentMessageId ?? null,
    node.source?.runId ?? null,
    node.source?.changesetId ?? null,
    node.createdAt,
    node.kind,
  )
  return node
}

function readPage(
  database: DatabaseSync,
  input: { timelineId: string; branchId?: string; cursor?: string; limit?: number },
): { timeline: NarrativeTimeline; branch: NarrativeBranch; nodes: NarrativeNode[]; nextCursor?: string } {
  const timeline = requireTimeline(database, input.timelineId)
  const branch = requireBranch(database, input.branchId ?? timeline.activeBranchId)
  assertBranchTimeline(branch, timeline.id)
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) {
    throw new NarrativeStoreError('narrative.page_limit_invalid', `Narrative page limit must be between 1 and ${maximumPageLimit}`)
  }

  const startNodeId = input.cursor ?? branch.headNodeId
  if (!startNodeId) {
    return { timeline, branch, nodes: [] }
  }

  if (input.cursor && !isNodeInBranchPath(database, branch, input.cursor)) {
    throw new NarrativeStoreError('narrative.cursor_not_in_branch', `Narrative cursor is not in branch path: ${input.cursor}`)
  }

  const rows = database.prepare(`
    WITH RECURSIVE branch_nodes(id, timeline_id, parent_node_id, state_revision_id, workspace_revision_id, floor, body_format, body_raw,
                                source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, kind, entry_id, depth) AS (
      SELECT id, timeline_id, parent_node_id, state_revision_id, workspace_revision_id, floor, body_format, body_raw,
             source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, kind, entry_id, 1
      FROM narrative_node_projection
      WHERE id = ? AND timeline_id = ?
      UNION ALL
      SELECT n.id, n.timeline_id, n.parent_node_id, n.state_revision_id, n.workspace_revision_id, n.floor, n.body_format, n.body_raw,
             n.source_agent_session_id, n.source_agent_message_id, n.source_run_id, n.source_changeset_id, n.created_at, n.kind, n.entry_id, bn.depth + 1
      FROM narrative_node_projection n
      JOIN branch_nodes bn ON n.id = bn.parent_node_id
      WHERE bn.parent_node_id IS NOT NULL AND bn.depth < 10000
    )
    SELECT id, timeline_id, parent_node_id, state_revision_id, workspace_revision_id, floor, body_format, body_raw,
           source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, kind, entry_id
    FROM branch_nodes
    LIMIT ?
  `).all(startNodeId, timeline.id, limit)

  if (rows.length === 0 && startNodeId) {
    requireNode(database, startNodeId)
  }

  const reverseNodes = rows.map(nodeFromRow)
  const lastNode = reverseNodes.at(-1)
  const nextCursor = reverseNodes.length === limit ? (lastNode?.parentNodeId ?? undefined) : undefined

  return {
    timeline,
    branch,
    nodes: reverseNodes.reverse(),
    nextCursor,
  }
}

function readTimeline(database: DatabaseSync, id: string, includeDeleted = false): NarrativeTimeline | null {
  const row = database.prepare(`
    SELECT id, title,
           (SELECT substr(body_raw, 1, 240) FROM narrative_node_projection node
            WHERE node.timeline_id = narrative_timelines.id AND node.parent_node_id IS NULL
            ORDER BY node.created_at ASC, node.id ASC LIMIT 1) AS opening_preview,
           (SELECT substr(node.body_raw, 1, 240) FROM narrative_branches branch
            JOIN narrative_node_projection node ON node.id = branch.head_node_id
            WHERE branch.id = narrative_timelines.active_branch_id) AS latest_preview,
           created_from_card_id, created_from_card_version, prompt_resource_ids_json,
           active_branch_id, opening_json, created_at, updated_at, tombstoned, deleted_at
    FROM narrative_timelines WHERE id = ?
  `).get(id)
  if (!row) return null
  const timeline = timelineFromRow(row)
  if (timeline.deletedAt && !includeDeleted) return null
  return timeline
}

function readTimelines(
  database: DatabaseSync,
  input: { createdFromCardId?: string; cursor?: string; limit?: number } = {},
): { timelines: NarrativeTimeline[]; nextCursor?: string } {
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) {
    throw new NarrativeStoreError('narrative.timeline_list_limit_invalid', `Narrative timeline list limit must be between 1 and ${maximumPageLimit}`)
  }
  validateOptionalId(input.createdFromCardId, 'createdFromCardId')
  validateOptionalId(input.cursor, 'cursor')

  const cursor = input.cursor ? readTimeline(database, input.cursor) : undefined
  if (input.cursor && !cursor) {
    throw new NarrativeStoreError('narrative.timeline_cursor_not_found', `Narrative timeline cursor not found: ${input.cursor}`)
  }
  if (cursor && input.createdFromCardId && cursor.createdFrom?.cardId !== input.createdFromCardId) {
    throw new NarrativeStoreError('narrative.timeline_cursor_filter_mismatch', 'Narrative timeline cursor does not match the source card filter')
  }
  const conditions = ['tombstoned = 0']
  const params: Array<string | number> = []
  if (input.createdFromCardId) {
    conditions.push('created_from_card_id = ?')
    params.push(input.createdFromCardId)
  }
  if (cursor) {
    conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
  }
  const rows = database.prepare(`
    SELECT id, title,
           (SELECT substr(body_raw, 1, 240) FROM narrative_node_projection node
            WHERE node.timeline_id = narrative_timelines.id AND node.parent_node_id IS NULL
            ORDER BY node.created_at ASC, node.id ASC LIMIT 1) AS opening_preview,
           (SELECT substr(node.body_raw, 1, 240) FROM narrative_branches branch
            JOIN narrative_node_projection node ON node.id = branch.head_node_id
            WHERE branch.id = narrative_timelines.active_branch_id) AS latest_preview,
           created_from_card_id, created_from_card_version, prompt_resource_ids_json,
           active_branch_id, opening_json, created_at, updated_at, tombstoned, deleted_at
    FROM narrative_timelines
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(...params, limit + 1)
  const timelines = rows.slice(0, limit).map(timelineFromRow)
  return {
    timelines,
    nextCursor: rows.length > limit ? timelines.at(-1)?.id : undefined,
  }
}

function readBranches(database: DatabaseSync, timelineId: string): NarrativeBranch[] {
  validateId(timelineId, 'timelineId')
  requireTimeline(database, timelineId)
  return database.prepare(`
    SELECT id, timeline_id, title, head_node_id, state_head_revision_id, workspace_head_revision_id,
           parent_branch_id, forked_from_node_id, created_at, updated_at, head_entry_id
    FROM narrative_branches
    WHERE timeline_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(timelineId).map(branchFromRow)
}

function requireTimeline(database: DatabaseSync, id: string, includeDeleted = false): NarrativeTimeline {
  const timeline = readTimeline(database, id, includeDeleted)
  if (!timeline) throw new NarrativeStoreError('narrative.timeline_not_found', `Narrative timeline not found: ${id}`)
  return timeline
}

function readBranch(database: DatabaseSync, id: string, includeDeleted = false): NarrativeBranch | null {
  const row = database.prepare(`
    SELECT branch.id, branch.timeline_id, branch.title, branch.head_node_id, branch.state_head_revision_id, branch.workspace_head_revision_id, workspace_head_revision_id,
           branch.parent_branch_id, branch.forked_from_node_id, branch.created_at, branch.updated_at, branch.head_entry_id
    FROM narrative_branches branch
    JOIN narrative_timelines timeline ON timeline.id = branch.timeline_id
    WHERE branch.id = ? AND (? = 1 OR timeline.tombstoned = 0)
  `).get(id, includeDeleted ? 1 : 0)
  return row ? branchFromRow(row) : null
}

function requireBranch(database: DatabaseSync, id: string): NarrativeBranch {
  const branch = readBranch(database, id)
  if (!branch) throw new NarrativeStoreError('narrative.branch_not_found', `Narrative branch not found: ${id}`)
  return branch
}

function readNode(database: DatabaseSync, id: string, includeDeleted = false): NarrativeNode | null {
  const row = database.prepare(`
    SELECT node.id, node.timeline_id, node.parent_node_id, node.state_revision_id, node.workspace_revision_id, node.floor, node.body_format, node.body_raw,
           node.source_agent_session_id, node.source_agent_message_id, node.source_run_id,
           node.source_changeset_id, node.created_at, node.kind, node.entry_id
    FROM narrative_node_projection node
    JOIN narrative_timelines timeline ON timeline.id = node.timeline_id
    WHERE node.id = ? AND (? = 1 OR timeline.tombstoned = 0)
  `).get(id, includeDeleted ? 1 : 0)
  return row ? nodeFromRow(row) : null
}

function requireNode(database: DatabaseSync, id: string): NarrativeNode {
  const node = readNode(database, id)
  if (!node) throw new NarrativeStoreError('narrative.node_not_found', `Narrative node not found: ${id}`)
  return node
}

function timelineFromRow(row: unknown): NarrativeTimeline {
  const value = row as Record<string, unknown>
  if (typeof value.active_branch_id !== 'string') {
    throw new NarrativeStoreError('narrative.timeline_invalid', `Narrative timeline is missing active branch: ${String(value.id)}`)
  }
  return {
    id: String(value.id),
    ...(typeof value.opening_json === 'string' ? { opening: JSON.parse(value.opening_json) as NarrativeTimeline['opening'] } : {}),
    title: optionalString(value.title),
    openingPreview: optionalString(value.opening_preview),
    latestPreview: optionalString(value.latest_preview),
    createdFrom: typeof value.created_from_card_id === 'string' && typeof value.created_from_card_version === 'number'
      ? { cardId: value.created_from_card_id, cardVersion: value.created_from_card_version }
      : undefined,
    promptResourceIds: parseStringArray(value.prompt_resource_ids_json, 'prompt_resource_ids_json'),
    activeBranchId: value.active_branch_id,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    deletedAt: optionalString(value.deleted_at),
  }
}

function branchFromRow(row: unknown): NarrativeBranch {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    timelineId: String(value.timeline_id),
    title: optionalString(value.title),
    headNodeId: optionalString(value.head_node_id),
    headEntryId: optionalString(value.head_entry_id),
    stateHeadRevisionId: requiredString(value.state_head_revision_id, 'state_head_revision_id'),
    workspaceHeadRevisionId: requiredString(value.workspace_head_revision_id, 'workspace_head_revision_id'),
    parentBranchId: optionalString(value.parent_branch_id),
    forkedFromNodeId: optionalString(value.forked_from_node_id),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  }
}

function nodeFromRow(row: unknown): NarrativeNode {
  const value = row as Record<string, unknown>
  const source = compactSource({
    agentSessionId: optionalString(value.source_agent_session_id),
    agentMessageId: optionalString(value.source_agent_message_id),
    runId: optionalString(value.source_run_id),
    changesetId: optionalString(value.source_changeset_id),
  })
  return {
    id: String(value.id),
    timelineId: String(value.timeline_id),
    parentNodeId: optionalString(value.parent_node_id),
    entryId: optionalString(value.entry_id),
    stateRevisionId: requiredString(value.state_revision_id, 'state_revision_id'),
    kind: value.kind as NarrativeNode['kind'],
    floor: Number(value.floor),
    workspaceRevisionId: requiredString(value.workspace_revision_id, 'workspace_revision_id'),
    body: { format: 'loom-markdown.v1', raw: String(value.body_raw) },
    source,
    createdAt: String(value.created_at),
  }
}

function isNodeInBranchPath(database: DatabaseSync, branch: NarrativeBranch, nodeId: string): boolean {
  if (!branch.headNodeId) return false
  const row = database.prepare(`
    WITH RECURSIVE branch_path(id, parent_node_id, depth) AS (
      SELECT id, parent_node_id, 1
      FROM narrative_node_projection
      WHERE id = ?
      UNION ALL
      SELECT n.id, n.parent_node_id, bp.depth + 1
      FROM narrative_node_projection n
      JOIN branch_path bp ON n.id = bp.parent_node_id
      WHERE bp.parent_node_id IS NOT NULL AND bp.depth < 10000
    )
    SELECT 1 FROM branch_path WHERE id = ? LIMIT 1
  `).get(branch.headNodeId, nodeId)
  return Boolean(row)
}

function assertBranchTimeline(branch: NarrativeBranch, timelineId: string): void {
  if (branch.timelineId !== timelineId) {
    throw new NarrativeStoreError('narrative.branch_timeline_mismatch', `Narrative branch does not belong to timeline: ${branch.id}`)
  }
}

function validateBody(body: NarrativeBody, allowEmpty = false): void {
  if (body.format !== 'loom-markdown.v1') {
    throw new NarrativeStoreError('narrative.body_format_invalid', `Unsupported narrative body format: ${String(body.format)}`)
  }
  if (typeof body.raw !== 'string' || !allowEmpty && body.raw.trim().length === 0) {
    throw new NarrativeStoreError('narrative.body_empty', 'Narrative body cannot be empty')
  }
}

function validateCreatedFrom(createdFrom: CreateNarrativeTimelineInput['createdFrom']): void {
  if (!createdFrom) return
  if (!createdFrom.cardId || !Number.isInteger(createdFrom.cardVersion) || createdFrom.cardVersion < 1) {
    throw new NarrativeStoreError('narrative.created_from_invalid', 'Narrative createdFrom requires a card ID and positive version')
  }
}

function validateStringIds(values: string[], field: string): void {
  if (values.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new NarrativeStoreError('narrative.input_invalid', `${field} must contain non-empty string IDs`)
  }
}

function validateOptionalText(value: string | undefined, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
    throw new NarrativeStoreError('narrative.input_invalid', `${field} must be a non-empty string`)
  }
}

function validateId(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new NarrativeStoreError('narrative.input_invalid', `${field} must be a non-empty string ID`)
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NarrativeStoreError('narrative.data_invalid', `Narrative ${field} is missing`)
  }
  return value
}

function validateOptionalId(value: string | undefined, field: string): void {
  if (value !== undefined) validateId(value, field)
}

function operation(kind: DataCommitOperation['kind'], entityId: string, entityType: string): DataCommitOperation {
  return { store: 'narrative', kind, entityId, entityType }
}

function compactSource(source: NarrativeNodeSource): NarrativeNodeSource | undefined {
  return Object.values(source).some(value => value !== undefined) ? source : undefined
}

function parseStringArray(value: unknown, field: string): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error()
    return parsed
  } catch {
    throw new NarrativeStoreError('narrative.data_invalid', `Narrative ${field} is invalid`)
  }
}

function migrateTimelineAuthority(database: DatabaseSync, nextId: (prefix: string) => string, _now: () => string) {
  database.exec(`ALTER TABLE narrative_nodes ADD COLUMN entry_id TEXT REFERENCES agent_transcript_entries(id);
    ALTER TABLE narrative_branches ADD COLUMN head_entry_id TEXT REFERENCES agent_transcript_entries(id);
    ALTER TABLE narrative_recovery_points ADD COLUMN head_entry_id TEXT REFERENCES agent_transcript_entries(id);`)
  for (const timeline of database.prepare('SELECT * FROM narrative_timelines').all()) {
    const timelineId = String(timeline.id)
    database.prepare(`INSERT INTO agent_sessions (id, kind, timeline_id, title, narrative_mode, entry_count, created_at, updated_at)
      VALUES (?, 'timeline', ?, ?, 'declared', 0, ?, ?)`)
      .run(timelineId, timelineId, timeline.title, timeline.created_at, timeline.updated_at)
    let sequence = 0
    for (const node of database.prepare(`WITH RECURSIVE path AS (
      SELECT *, 1 AS depth FROM narrative_nodes WHERE timeline_id = ? AND parent_node_id IS NULL
      UNION ALL SELECT n.*, p.depth + 1 FROM narrative_nodes n JOIN path p ON n.parent_node_id = p.id
    ) SELECT * FROM path ORDER BY depth, created_at, id`).all(timelineId)) {
      const entryId = nextId('agent-entry')
      const parent = node.parent_node_id ? database.prepare('SELECT entry_id FROM narrative_nodes WHERE id = ?').get(node.parent_node_id)?.entry_id : null
      database.prepare(`INSERT INTO agent_transcript_entries (id, agent_session_id, parent_entry_id, sequence, entry_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(entryId, timelineId, parent ?? null, ++sequence, JSON.stringify({ kind: 'message', role: node.kind === 'user-input' ? 'user' : 'assistant',
          content: node.body_raw, purpose: 'narrative', narrativeId: node.id }), node.created_at)
      database.prepare('UPDATE narrative_nodes SET entry_id = ? WHERE id = ?').run(entryId, node.id)
    }
    database.prepare('UPDATE agent_sessions SET entry_count = ? WHERE id = ?').run(sequence, timelineId)
  }
  database.exec(`UPDATE narrative_branches SET head_entry_id = (SELECT entry_id FROM narrative_nodes WHERE id = head_node_id);
    UPDATE narrative_recovery_points SET head_entry_id = (SELECT entry_id FROM narrative_nodes WHERE id = node_id);
    UPDATE agent_sessions SET head_entry_id = (SELECT b.head_entry_id FROM narrative_timelines t JOIN narrative_branches b ON b.id = t.active_branch_id WHERE t.id = agent_sessions.id) WHERE kind = 'timeline';
    ALTER TABLE narrative_nodes DROP COLUMN body_raw;
    ALTER TABLE narrative_nodes DROP COLUMN body_format;
    CREATE VIEW narrative_node_projection AS SELECT n.*, 'loom-markdown.v1' AS body_format,
      json_extract(e.entry_json, '$.content') AS body_raw FROM narrative_nodes n JOIN agent_transcript_entries e ON e.id = n.entry_id;`)
}

function nodeAttachments(agent: AgentTransaction, node: NarrativeNode): ChatAttachment[] | undefined {
  const entry = node.entryId ? agent.getEntry(node.entryId)?.entry : undefined
  return entry?.kind === 'message' ? entry.attachments : undefined
}
