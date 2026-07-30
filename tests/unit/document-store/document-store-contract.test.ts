import {
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  type DocumentStore,
} from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

const actor = { kind: 'system', id: 'document-store-contract' } as const
const stores = [
  {
    name: 'in-memory',
    create: () => createInMemoryDocumentStore(),
  },
  {
    name: 'sqlite',
    create: () => createSqliteDocumentStore({ filename: ':memory:' }),
  },
]

describe.each(stores)('$name document store contract', ({ create }) => {
  it('groups all transaction writes into one persisted changeset', async () => {
    await withStore(create(), async store => {
      const result = await store.transact({
        actor,
        reason: 'create pair',
        correlationId: 'corr-1',
      }, async tx => {
        await tx.write({
          id: 'doc-a',
          type: 'example.note',
          content: { text: 'a1' },
          expectedVersion: 'new',
        })
        await tx.write({
          id: 'doc-b',
          type: 'example.note',
          content: { text: 'b1' },
          expectedVersion: 'new',
        })
        await tx.write({
          id: 'doc-a',
          type: 'example.note',
          content: { text: 'a2' },
          expectedVersion: 1,
        })
        return 'done'
      })
      const persisted = await store.getChangeset(result.changeset.id)

      expect(result.value).toBe('done')
      expect(result.changeset).toMatchObject({
        createdBy: actor,
        reason: 'create pair',
        correlationId: 'corr-1',
      })
      expect(result.changeset.operations).toEqual([
        {
          kind: 'create',
          documentId: 'doc-a',
          type: 'example.note',
          fromVersion: undefined,
          toVersion: 2,
        },
        {
          kind: 'create',
          documentId: 'doc-b',
          type: 'example.note',
          fromVersion: undefined,
          toVersion: 1,
        },
      ])
      expect(result.commit).toEqual({
        changeset: result.changeset,
        documents: [
          { id: 'doc-a', type: 'example.note', version: 2, tombstoned: false },
          { id: 'doc-b', type: 'example.note', version: 1, tombstoned: false },
        ],
      })
      expect(JSON.stringify(result.commit)).not.toContain('a2')
      expect(persisted).toEqual(result.changeset)
      expect(await store.get('doc-a')).toMatchObject({ version: 2, content: { text: 'a2' } })
      expect(await store.get('doc-a', { version: 1 })).toMatchObject({ content: { text: 'a1' } })
    })
  })

  it('removes documents, revisions, and changesets when a transaction fails', async () => {
    await withStore(create(), async store => {
      let changesetId = ''

      await expect(store.transact({ actor }, async tx => {
        const write = await tx.write({
          id: 'rolled-back',
          type: 'example.note',
          content: { ok: false },
          expectedVersion: 'new',
        })
        changesetId = write.changesetId
        throw new Error('stop transaction')
      })).rejects.toThrow('stop transaction')

      expect(await store.get('rolled-back')).toBeNull()
      expect(await store.get('rolled-back', { version: 1 })).toBeNull()
      expect(await store.getChangeset(changesetId)).toBeNull()
    })
  })

  it('collapses repeated updates to the same document and restores the transaction-start version', async () => {
    await withStore(create(), async store => {
      await store.write({
        id: 'repeated-update',
        type: 'example.note',
        content: { value: 1 },
        expectedVersion: 'new',
      })
      const updated = await store.transact({ actor }, async tx => {
        await tx.write({
          id: 'repeated-update',
          type: 'example.note',
          content: { value: 2 },
          expectedVersion: 1,
        })
        await tx.write({
          id: 'repeated-update',
          type: 'example.note',
          content: { value: 3 },
          expectedVersion: 2,
        })
      })

      expect(updated.changeset.operations).toEqual([
        {
          kind: 'update',
          documentId: 'repeated-update',
          type: 'example.note',
          fromVersion: 1,
          toVersion: 3,
        },
      ])

      await store.revertChangeset({
        changesetId: updated.changeset.id,
        actor,
      })

      expect(await store.get('repeated-update')).toMatchObject({ version: 4, content: { value: 1 } })
    })
  })

  it('undoes and redoes document creation', async () => {
    await withStore(create(), async store => {
      const created = await store.write({
        id: 'created-doc',
        type: 'example.note',
        content: { text: 'created' },
        expectedVersion: 'new',
      })
      const undone = await store.revertChangeset({
        changesetId: created.changesetId,
        actor,
        reason: 'undo create',
      })

      expect(await store.get('created-doc')).toBeNull()
      expect(await store.get('created-doc', { includeTombstone: true })).toMatchObject({ version: 2 })
      expect(undone.operations).toEqual([
        expect.objectContaining({ kind: 'delete', documentId: 'created-doc', fromVersion: 1, toVersion: 2 }),
      ])

      const redone = await store.revertChangeset({
        changesetId: undone.changesetId,
        actor,
        reason: 'redo create',
      })

      expect(await store.get('created-doc')).toMatchObject({ version: 3, content: { text: 'created' } })
      expect(redone.operations).toEqual([
        expect.objectContaining({ kind: 'restore', documentId: 'created-doc', fromVersion: 2, toVersion: 3 }),
      ])
    })
  })

  it('undoes and redoes document updates', async () => {
    await withStore(create(), async store => {
      await store.write({
        id: 'updated-doc',
        type: 'example.note',
        content: { text: 'before' },
        expectedVersion: 'new',
      })
      const updated = await store.write({
        id: 'updated-doc',
        type: 'example.note',
        content: { text: 'after' },
        expectedVersion: 1,
      })
      const undone = await store.revertChangeset({
        changesetId: updated.changesetId,
        actor,
      })

      expect(await store.get('updated-doc')).toMatchObject({ version: 3, content: { text: 'before' } })

      await store.revertChangeset({
        changesetId: undone.changesetId,
        actor,
      })

      expect(await store.get('updated-doc')).toMatchObject({ version: 4, content: { text: 'after' } })
    })
  })

  it('undoes and redoes tombstone deletion', async () => {
    await withStore(create(), async store => {
      await store.write({
        id: 'deleted-doc',
        type: 'example.note',
        content: { ok: true },
        expectedVersion: 'new',
      })
      const deleted = await store.delete({
        id: 'deleted-doc',
        expectedVersion: 1,
      })
      expect(deleted.commit.documents).toEqual([
        { id: 'deleted-doc', type: 'example.note', version: 2, tombstoned: true },
      ])
      const undone = await store.revertChangeset({
        changesetId: deleted.changesetId,
        actor,
      })

      expect(await store.get('deleted-doc')).toMatchObject({ version: 3, content: { ok: true } })
      expect(undone.commit.documents).toEqual([
        { id: 'deleted-doc', type: 'example.note', version: 3, tombstoned: false },
      ])

      const redone = await store.revertChangeset({
        changesetId: undone.changesetId,
        actor,
      })

      expect(await store.get('deleted-doc')).toBeNull()
      expect(await store.get('deleted-doc', { includeTombstone: true })).toMatchObject({ version: 4 })
      expect(redone.commit.documents).toEqual([
        { id: 'deleted-doc', type: 'example.note', version: 4, tombstoned: true },
      ])
    })
  })

  it('rejects a conflicting multi-document revert without partial writes', async () => {
    await withStore(create(), async store => {
      const created = await store.transact({ actor }, async tx => {
        await tx.write({
          id: 'conflict-a',
          type: 'example.note',
          content: { value: 1 },
          expectedVersion: 'new',
        })
        await tx.write({
          id: 'conflict-b',
          type: 'example.note',
          content: { value: 1 },
          expectedVersion: 'new',
        })
      })
      await store.write({
        id: 'conflict-a',
        type: 'example.note',
        content: { value: 2 },
        expectedVersion: 1,
      })

      await expect(store.revertChangeset({
        changesetId: created.changeset.id,
        actor,
      })).rejects.toThrow('Document version conflict: conflict-a')

      expect(await store.get('conflict-a')).toMatchObject({ version: 2, content: { value: 2 } })
      expect(await store.get('conflict-b')).toMatchObject({ version: 1, content: { value: 1 } })
      expect(await store.get('conflict-b', { version: 2 })).toBeNull()
    })
  })
})

async function withStore(store: DocumentStore, run: (store: DocumentStore) => Promise<void>): Promise<void> {
  try {
    await run(store)
  } finally {
    if ('close' in store && typeof store.close === 'function') store.close()
  }
}
