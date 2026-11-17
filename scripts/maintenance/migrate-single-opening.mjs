import { DatabaseSync, backup } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { createSqliteDataEngine } from '../../packages/kernel/dist/data-engine/index.js'
import { createSqliteDocumentStore } from '../../packages/kernel/dist/document-store/index.js'

// One-off repair for the local pre-single-opening database, not a runtime reader.
const filename = resolve(process.argv[2] ?? 'data/studio.sqlite')
const apply = process.argv.includes('--apply')
const source = new DatabaseSync(filename, { readOnly: true })
const cards = source.prepare("SELECT id, version, content_json FROM documents WHERE type = 'airp.cardSource' AND tombstoned = 0").all()
const converted = new Map()
const changes = []
function candidate(value) {
  if (typeof value?.content === 'string' && typeof value.id === 'string') return value
  if (!Array.isArray(value?.entries) || value.entries.length > 1) throw new Error('Expected a single legacy opening entry')
  const content = value.entries.length ? value.entries[0].content : ''
  if (typeof content !== 'string') throw new Error('Invalid legacy opening content')
  return { id: value.id ?? `opening-${randomUUID()}`, ...(value.title ? { title: value.title } : {}), content }
}
for (const row of cards) {
  const content = JSON.parse(row.content_json)
  const opening = content.opening
  const next = { ...candidate(opening), ...(opening.alternatives?.length
    ? { alternatives: opening.alternatives.map(candidate) } : {}) }
  converted.set(row.id, next)
  if (JSON.stringify(opening) !== JSON.stringify(next)) changes.push({ ...row, content: { ...content, opening: next } })
}
const timelines = source.prepare('SELECT id, created_from_card_id, opening_json FROM narrative_timelines WHERE tombstoned = 0 AND opening_json IS NOT NULL').all()
const timelineChanges = []
for (const row of timelines) {
  const previous = JSON.parse(row.opening_json)
  if (!Array.isArray(previous.nodeIds)) continue
  if (previous.nodeIds.length > 1) throw new Error('Multi-node Timeline opening needs manual review')
  const cardOpening = converted.get(row.created_from_card_id)
  const selected = previous.index === undefined ? undefined : previous.index === 0 ? cardOpening : cardOpening?.alternatives?.[previous.index - 1]
  if (previous.index !== undefined && !selected) throw new Error('Cannot resolve original opening index')
  timelineChanges.push({ ...row, opening: { ...(selected ? { id: selected.id } : {}), nodeId: previous.nodeIds[0], locked: false } })
}
console.log(JSON.stringify({ filename, mode: apply ? 'apply' : 'dry-run', cards: changes.map(row => ({ id: row.id, name: row.content.name })), timelines: timelineChanges.map(row => row.id) }, null, 2))
if (!apply || (!changes.length && !timelineChanges.length)) {
  source.close()
  process.exit(0)
}
const backupDirectory = join(dirname(filename), 'backups')
await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
const backupPath = join(backupDirectory, `before-single-opening-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`)
await backup(source, backupPath)
source.close()
console.log(JSON.stringify({ backup: backupPath }))
const engine = createSqliteDataEngine({ filename, createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
const documents = createSqliteDocumentStore({ engine })
try {
  const result = await engine.transact({ actor: { kind: 'system', id: 'single-opening-local-repair' }, reason: 'Convert local opening records to stable single-node candidates' }, async tx => {
    for (const row of timelineChanges) {
      const current = tx.database.prepare('SELECT opening_json, active_branch_id FROM narrative_timelines WHERE id = ? AND tombstoned = 0').get(row.id)
      if (!current || current.opening_json !== row.opening_json) throw new Error('Timeline changed during conversion')
      const branch = tx.database.prepare('SELECT head_node_id FROM narrative_branches WHERE id = ?').get(current.active_branch_id)
      const nodes = tx.database.prepare('SELECT id, parent_node_id FROM narrative_nodes WHERE timeline_id = ?').all(row.id)
      const branches = tx.database.prepare('SELECT count(*) AS count FROM narrative_branches WHERE timeline_id = ?').get(row.id)
      row.opening.locked = branches.count !== 1 || nodes.length !== (row.opening.nodeId ? 1 : 0)
        || (branch.head_node_id ?? undefined) !== row.opening.nodeId || nodes.some(node => node.parent_node_id !== null)
    }
    await documents.participateTransaction(tx, async store => {
      for (const row of changes) {
        await store.write({ id: row.id, type: 'airp.cardSource', expectedVersion: row.version, content: row.content })
      }
    }, { allowEmpty: true })
    for (const row of timelineChanges) {
      tx.database.prepare('UPDATE narrative_timelines SET opening_json = ? WHERE id = ?').run(JSON.stringify(row.opening), row.id)
      tx.recordOperations([{ store: 'narrative', kind: 'update', entityId: row.id, entityType: 'narrative.timeline' }])
    }
  })
  console.log(JSON.stringify({ changesetId: result.commit.changesetId, convertedCards: changes.length, convertedTimelines: timelineChanges.length }))
} finally {
  await documents.close()
  await engine.close()
}
