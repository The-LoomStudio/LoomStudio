import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('in-memory document store', () => {
  it('creates, updates, lists, and tombstones documents', async () => {
    const documents = createInMemoryDocumentStore()
    const created = await documents.write({
      id: 'example.doc:1',
      type: 'example.doc',
      content: { value: 'a' },
      expectedVersion: 'new',
    })

    expect(created.documents[0]?.version).toBe(1)

    const updated = await documents.write({
      id: 'example.doc:1',
      type: 'example.doc',
      content: { value: 'b' },
      expectedVersion: 1,
    })

    expect(updated.documents[0]?.version).toBe(2)

    const listed = await documents.list({ type: 'example.doc' })
    expect(listed.items).toHaveLength(1)

    await documents.delete({ id: 'example.doc:1', expectedVersion: 2 })

    const afterDelete = await documents.list({ type: 'example.doc' })
    expect(afterDelete.items).toHaveLength(0)

    const tombstones = await documents.list({ type: 'example.doc', includeTombstone: true })
    expect(tombstones.items[0]?.meta.tombstone).toBeDefined()
  })
})
