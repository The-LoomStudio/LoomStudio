import { createSqliteDocumentStore } from './sqlite-store.js'
import type { SqliteDocumentStore } from './types.js'

export function createInMemoryDocumentStore(): SqliteDocumentStore {
  return createSqliteDocumentStore({ filename: ':memory:' })
}
