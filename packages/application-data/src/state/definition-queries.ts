import type { SqliteDataEngine } from '@loom-studio/data-engine'

export function listStateDefinitionDocuments<Content>(
  engine: SqliteDataEngine,
  input: { ids?: string[]; kind?: 'global' | 'timeline-template' },
): Promise<Array<{ id: string; version: number; content: Content }>> {
  if (input.ids?.length === 0) return Promise.resolve([])
  return engine.read(database => {
    const clauses = ["type = 'airp.stateDefinition'", 'tombstoned = 0']
    const values: string[] = []
    if (input.ids !== undefined) {
      clauses.push('id IN (SELECT value FROM json_each(?))')
      values.push(JSON.stringify(input.ids))
    }
    if (input.kind !== undefined) {
      clauses.push("json_extract(content_json, '$.kind') = ?")
      values.push(input.kind)
    }
    const rows = database.prepare(`
      SELECT id, version, content_json FROM documents
      WHERE ${clauses.join(' AND ')} ORDER BY rowid
    `).all(...values) as Array<{ id: string; version: number; content_json: string }>
    return rows.map(row => ({ id: row.id, version: row.version, content: JSON.parse(row.content_json) as Content }))
  })
}
