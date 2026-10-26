import type { SqliteDataEngine } from './sqlite.js'

export function readSqliteSpaceUsage(engine: SqliteDataEngine) {
  return engine.read(db => {
    const pragma = (name: string) => Number(Object.values(db.prepare(`PRAGMA ${name}`).get()!)[0])
    const pageSize = pragma('page_size')
    const pageCount = pragma('page_count')
    const freePages = pragma('freelist_count')
    try {
      const tables = db.prepare(`SELECT COALESCE(s.tbl_name, d.name) AS name, SUM(d.pgsize) AS bytes
        FROM dbstat d LEFT JOIN sqlite_schema s ON s.name = d.name GROUP BY COALESCE(s.tbl_name, d.name) ORDER BY bytes DESC`).all() as Array<{ name: string; bytes: number }>
      return { pageSize, pageCount, freeBytes: freePages * pageSize, tables, unavailable: false }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('no such table: dbstat')) throw error
      return { pageSize, pageCount, freeBytes: freePages * pageSize, tables: [], unavailable: true }
    }
  })
}
