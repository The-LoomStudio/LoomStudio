import type { DataCommitOperation, SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso, optionalString } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AppendNarrativeUserInputResult,
  CreateNarrativeTimelineInput,
  NarrativeBody,
  NarrativeBranch,
  NarrativeNode,
  NarrativeNodeSource,
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

  engine.migrate({
    namespace: migrationNamespace,
    migrations: [
      { version: 1, migrate: migrateVersionOne },
      { version: 2, migrate: migrateVersionTwo },
      { version: 3, migrate: migrateVersionThree },
    ],
  })
  assertNarrativeSchema(engine.database)

  function transaction(tx: SqliteDataTransaction): NarrativeTransaction {
    const { database } = tx

    return {
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
          insertNode(database, node)
          tx.recordOperations([operation('create', node.id, 'narrative.node')])
        }
        for (const branch of input.branches) {
          assertBranchTimeline(branch, timeline.id)
          if (branch.id === timeline.activeBranchId) {
            if (branch.parentBranchId || branch.forkedFromNodeId) throw new NarrativeStoreError('narrative.archive_root_invalid', 'Archive root cannot have a parent')
            database.prepare('UPDATE narrative_branches SET head_node_id = ?, state_head_revision_id = ?, updated_at = ? WHERE id = ?')
              .run(branch.headNodeId ?? null, branch.stateHeadRevisionId, branch.updatedAt, branch.id)
            tx.recordOperations([operation('update', branch.id, 'narrative.branch')])
          } else {
            insertBranch(database, branch)
            tx.recordOperations([operation('create', branch.id, 'narrative.branch')])
          }
        }
      },
      editBranchNode: input => {
        validateBody(input.body)
        validateBody(input.expectedBody)
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
        const replacements: Array<{ previousNodeId: string; node: NarrativeNode }> = []
        let parentNodeId = target.parentNodeId
        // ponytail: Copying the suffix is linear in later messages; keeps branch isolation without mutable shared text.
        for (const previous of suffix.reverse()) {
          const node = insertNode(database, {
            ...previous,
            id: nextId('node'),
            parentNodeId,
            body: previous.id === target.id ? input.body : previous.body,
          })
          replacements.push({ previousNodeId: previous.id, node })
          parentNodeId = node.id
        }
        const timestamp = now()
        database.prepare('UPDATE narrative_branches SET head_node_id = ?, updated_at = ? WHERE id = ?')
          .run(parentNodeId!, timestamp, branch.id)
        database.prepare('UPDATE narrative_timelines SET updated_at = ? WHERE id = ?').run(timestamp, timeline.id)
        tx.recordOperations([
          ...replacements.map(({ node }) => operation('create', node.id, 'narrative.node')),
          operation('update', branch.id, 'narrative.branch'),
          operation('update', timeline.id, 'narrative.timeline'),
        ])
        return { timeline: requireTimeline(database, timeline.id), branch: requireBranch(database, branch.id), replacements }
      },
      createTimeline: input => {
        const timestamp = now()
        const timelineId = input.id ?? nextId('timeline')
        const branchId = input.primaryBranchId ?? nextId('branch')
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
        let parentNodeId: string | undefined
        for (const opening of input.openingNodes ?? []) {
          validateBody(opening.body)
          const node = insertNode(database, {
            id: opening.id ?? nextId('node'),
            timelineId,
            parentNodeId,
            stateRevisionId: input.stateRevisionId,
            body: opening.body,
            source: { ...opening.source, changesetId: tx.changesetId },
            createdAt: now(),
          })
          nodes.push(node)
          parentNodeId = node.id
        }

        const branch: NarrativeBranch = {
          id: branchId,
          timelineId,
          title: input.primaryBranchTitle,
          headNodeId: parentNodeId,
          stateHeadRevisionId: input.stateRevisionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        validateOptionalText(branch.title, 'primaryBranchTitle')
        insertBranch(database, branch)
        database.prepare('UPDATE narrative_timelines SET active_branch_id = ? WHERE id = ?').run(branchId, timelineId)

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
        validateBody(input.body)
        validateId(input.stateRevisionId, 'stateRevisionId')
        const timeline = requireTimeline(database, input.timelineId)
        const branch = requireBranch(database, input.branchId)
        assertBranchTimeline(branch, timeline.id)
        const expectedHead = input.expectedHeadNodeId ?? undefined
        if (branch.headNodeId !== expectedHead) {
          throw new NarrativeStoreError('narrative.head_conflict', `Narrative branch head conflict: ${branch.id}`)
        }

        const node = insertNode(database, {
          id: input.nodeId ?? nextId('node'),
          timelineId: timeline.id,
          parentNodeId: branch.headNodeId,
          stateRevisionId: input.stateRevisionId,
          body: input.body,
          source: { ...input.source, changesetId: tx.changesetId },
          createdAt: now(),
        })
        const updatedAt = now()
        database.prepare(`
          UPDATE narrative_branches
          SET head_node_id = ?, state_head_revision_id = ?, updated_at = ?
          WHERE id = ?
        `).run(node.id, input.stateRevisionId, updatedAt, branch.id)
        database.prepare('UPDATE narrative_timelines SET updated_at = ? WHERE id = ?').run(updatedAt, timeline.id)
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
        database.prepare(`
          UPDATE narrative_nodes
          SET body_format = ?, body_raw = ?
          WHERE id = ?
        `).run(input.body.format, input.body.raw, existingNode.id)
        const updatedAt = now()
        database.prepare('UPDATE narrative_timelines SET updated_at = ? WHERE id = ?').run(updatedAt, timeline.id)
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
        validateId(input.stateRevisionId, 'stateRevisionId')
        const timeline = requireTimeline(database, input.timelineId)
        const sourceBranch = requireBranch(database, input.fromBranchId)
        assertBranchTimeline(sourceBranch, timeline.id)
        const fromNode = requireNode(database, input.fromNodeId)
        if (fromNode.timelineId !== timeline.id || !isNodeInBranchPath(database, sourceBranch, fromNode.id)) {
          throw new NarrativeStoreError('narrative.node_not_in_branch', `Narrative node is not in branch path: ${fromNode.id}`)
        }
        validateOptionalText(input.title, 'title')
        const timestamp = now()
        const branch: NarrativeBranch = {
          id: input.branchId ?? nextId('branch'),
          timelineId: timeline.id,
          title: input.title,
          headNodeId: fromNode.id,
          stateHeadRevisionId: input.stateRevisionId,
          parentBranchId: sourceBranch.id,
          forkedFromNodeId: fromNode.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        insertBranch(database, branch)
        tx.recordOperations([operation('create', branch.id, 'narrative.branch')])
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
        tx.recordOperations([operation('update', timeline.id, 'narrative.timeline')])
        return requireTimeline(database, timeline.id)
      },

      deleteTimeline: input => {
        const timeline = requireTimeline(database, input.timelineId)
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
    getBranch: (id, options) => engine.read(database => readBranch(database, id, options?.includeDeleted)),
    listBranches: timelineId => engine.read(database => readBranches(database, timelineId)),
    getNode: (id, options) => engine.read(database => readNode(database, id, options?.includeDeleted)),
    listNodes: timelineId => engine.read(database => {
      const rows = database.prepare(`SELECT id, timeline_id, parent_node_id, state_revision_id, body_format, body_raw,
        source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at
        FROM narrative_nodes WHERE timeline_id = ? ORDER BY created_at ASC, id ASC`).all(timelineId)
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
      validateBody(input.body)
      const alreadyCommitted = new Error('Narrative input already committed')
      let replay: AppendNarrativeUserInputResult | undefined
      try {
        const result = await engine.transact(input, async dataTx => {
          const { database } = dataTx
          const node = readNode(database, input.nodeId)
          if (node) {
            const receipt = database.prepare('SELECT id, reason, operations_json FROM changesets WHERE id = ?')
              .get(node.source?.changesetId ?? null)
            const operations = receipt ? JSON.parse(String(receipt.operations_json)) as DataCommitOperation[] : []
            if (node.timelineId !== input.timelineId
              || (node.parentNodeId ?? null) !== input.expectedHeadNodeId
              || node.body.format !== input.body.format
              || node.body.raw !== input.body.raw
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
          return transaction(dataTx).appendNode({
            ...input,
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

function insertBranch(database: DatabaseSync, branch: NarrativeBranch): void {
  database.prepare(`
    INSERT INTO narrative_branches (
      id, timeline_id, title, head_node_id, state_head_revision_id,
      parent_branch_id, forked_from_node_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    branch.id,
    branch.timelineId,
    branch.title ?? null,
    branch.headNodeId ?? null,
    branch.stateHeadRevisionId,
    branch.parentBranchId ?? null,
    branch.forkedFromNodeId ?? null,
    branch.createdAt,
    branch.updatedAt,
  )
}

function insertNode(database: DatabaseSync, node: NarrativeNode): NarrativeNode {
  database.prepare(`
    INSERT INTO narrative_nodes (
      id, timeline_id, parent_node_id, state_revision_id, body_format, body_raw,
      source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id,
    node.timelineId,
    node.parentNodeId ?? null,
    node.stateRevisionId,
    node.body.format,
    node.body.raw,
    node.source?.agentSessionId ?? null,
    node.source?.agentMessageId ?? null,
    node.source?.runId ?? null,
    node.source?.changesetId ?? null,
    node.createdAt,
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
    WITH RECURSIVE branch_nodes(id, timeline_id, parent_node_id, state_revision_id, body_format, body_raw,
                                source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, depth) AS (
      SELECT id, timeline_id, parent_node_id, state_revision_id, body_format, body_raw,
             source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at, 1
      FROM narrative_nodes
      WHERE id = ? AND timeline_id = ?
      UNION ALL
      SELECT n.id, n.timeline_id, n.parent_node_id, n.state_revision_id, n.body_format, n.body_raw,
             n.source_agent_session_id, n.source_agent_message_id, n.source_run_id, n.source_changeset_id, n.created_at, bn.depth + 1
      FROM narrative_nodes n
      JOIN branch_nodes bn ON n.id = bn.parent_node_id
      WHERE bn.parent_node_id IS NOT NULL AND bn.depth < 10000
    )
    SELECT id, timeline_id, parent_node_id, state_revision_id, body_format, body_raw,
           source_agent_session_id, source_agent_message_id, source_run_id, source_changeset_id, created_at
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
           (SELECT substr(body_raw, 1, 240) FROM narrative_nodes node
            WHERE node.timeline_id = narrative_timelines.id AND node.parent_node_id IS NULL
            ORDER BY node.created_at ASC, node.id ASC LIMIT 1) AS opening_preview,
           (SELECT substr(body_raw, 1, 240) FROM narrative_nodes node
            WHERE node.timeline_id = narrative_timelines.id
            ORDER BY node.created_at DESC, node.id DESC LIMIT 1) AS latest_preview,
           created_from_card_id, created_from_card_version, prompt_resource_ids_json,
           active_branch_id, created_at, updated_at, tombstoned, deleted_at
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
           (SELECT substr(body_raw, 1, 240) FROM narrative_nodes node
            WHERE node.timeline_id = narrative_timelines.id AND node.parent_node_id IS NULL
            ORDER BY node.created_at ASC, node.id ASC LIMIT 1) AS opening_preview,
           (SELECT substr(body_raw, 1, 240) FROM narrative_nodes node
            WHERE node.timeline_id = narrative_timelines.id
            ORDER BY node.created_at DESC, node.id DESC LIMIT 1) AS latest_preview,
           created_from_card_id, created_from_card_version, prompt_resource_ids_json,
           active_branch_id, created_at, updated_at, tombstoned, deleted_at
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
    SELECT id, timeline_id, title, head_node_id, state_head_revision_id,
           parent_branch_id, forked_from_node_id, created_at, updated_at
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
    SELECT branch.id, branch.timeline_id, branch.title, branch.head_node_id, branch.state_head_revision_id,
           branch.parent_branch_id, branch.forked_from_node_id, branch.created_at, branch.updated_at
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
    SELECT node.id, node.timeline_id, node.parent_node_id, node.state_revision_id, node.body_format, node.body_raw,
           node.source_agent_session_id, node.source_agent_message_id, node.source_run_id,
           node.source_changeset_id, node.created_at
    FROM narrative_nodes node
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
    stateHeadRevisionId: requiredString(value.state_head_revision_id, 'state_head_revision_id'),
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
    stateRevisionId: requiredString(value.state_revision_id, 'state_revision_id'),
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
      FROM narrative_nodes
      WHERE id = ?
      UNION ALL
      SELECT n.id, n.parent_node_id, bp.depth + 1
      FROM narrative_nodes n
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

function validateBody(body: NarrativeBody): void {
  if (body.format !== 'loom-markdown.v1') {
    throw new NarrativeStoreError('narrative.body_format_invalid', `Unsupported narrative body format: ${String(body.format)}`)
  }
  if (typeof body.raw !== 'string' || body.raw.trim().length === 0) {
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
