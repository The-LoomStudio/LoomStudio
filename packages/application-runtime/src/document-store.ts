import type { DocumentRecord, DocumentTransaction } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { isObject } from './json.js'

export async function readDocument<T extends JsonValue>(documents: DocumentTransaction, id: string, type: string): Promise<DocumentRecord<T>> {
  const document = await documents.get(id)
  if (!document) throw new Error(`Document not found: ${id}`)
  if (document.type !== type) throw new Error(`Unexpected document type for ${id}: ${document.type}`)
  return document as DocumentRecord<T>
}

export async function listDocuments<T extends JsonValue>(documents: DocumentTransaction, type: string): Promise<Array<DocumentRecord<T>>> {
  const items: DocumentRecord[] = []
  let cursor: string | undefined

  do {
    const result = await documents.list({ type, cursor, limit: 100 })
    items.push(...result.items)
    cursor = result.nextCursor
  } while (cursor)

  return items as Array<DocumentRecord<T>>
}

export async function writeDocument<T extends JsonValue>(
  documents: DocumentTransaction,
  input: {
    id: string
    type: string
    content: T
    expectedVersion: number | 'new'
  },
): Promise<DocumentRecord<T>> {
  const result = await documents.write({
    id: input.id,
    type: input.type,
    content: input.content,
    expectedVersion: input.expectedVersion,
  })
  const document = result.documents[0]
  if (!document) throw new Error(`Document write returned no document: ${input.id}`)
  return document as DocumentRecord<T>
}

export function toVersioned<T extends JsonValue>(document: DocumentRecord<T>): T & { id: string; version: number } {
  if (!isObject(document.content)) {
    throw new Error(`Document content must be an object: ${document.id}`)
  }

  const content = document.content as JsonObject

  return {
    ...content,
    id: document.id,
    version: document.version,
  } as T & { id: string; version: number }
}
