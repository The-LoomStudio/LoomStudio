import type { SqliteDataEngine } from '@loom-studio/data-engine'

export type TextTransformOwnerFilter =
  | { kind: 'workspace' }
  | { kind: 'user-override' }
  | { kind: 'card'; cardId: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'extension'; packageId: string; moduleId?: string }

export function listTextTransformRuleDocuments<Content>(
  engine: SqliteDataEngine,
  owner: TextTransformOwnerFilter,
): Promise<Array<{ id: string; version: number; content: Content }>> {
  return engine.read(database => {
    const clauses = ["type = 'airp.textTransformRule'", 'tombstoned = 0', "json_extract(content_json, '$.owner.kind') = ?"]
    const values: string[] = [owner.kind]
    if (owner.kind === 'card') {
      clauses.push("json_extract(content_json, '$.owner.cardId') = ?")
      values.push(owner.cardId)
    } else if (owner.kind === 'preset') {
      clauses.push("json_extract(content_json, '$.owner.presetId') = ?")
      values.push(owner.presetId)
    } else if (owner.kind === 'extension') {
      clauses.push("json_extract(content_json, '$.owner.packageId') = ?")
      values.push(owner.packageId)
      if (owner.moduleId === undefined) {
        clauses.push("json_extract(content_json, '$.owner.moduleId') IS NULL")
      } else {
        clauses.push("json_extract(content_json, '$.owner.moduleId') = ?")
        values.push(owner.moduleId)
      }
    }
    const rows = database.prepare(`
      SELECT id, version, content_json FROM documents
      WHERE ${clauses.join(' AND ')} ORDER BY rowid
    `).all(...values) as Array<{ id: string; version: number; content_json: string }>
    return rows.map(row => ({ id: row.id, version: row.version, content: JSON.parse(row.content_json) as Content }))
  })
}
