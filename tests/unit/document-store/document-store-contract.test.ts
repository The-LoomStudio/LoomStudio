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
  it.each(['write', 'delete', 'transact', 'revert'] as const)('preserves a queued %s after a concurrent transaction rolls back', async operation => {
    await withStore(create(), async store => {
      const initial = await store.write({ id: 'kept', type: 'test.queue', content: { text: 'original' }, expectedVersion: 'new' })
      const commits: string[] = []
      store.subscribeCommits(commit => commits.push(commit.changeset.id))
      let ready!: () => void
      let release!: () => void
      const started = new Promise<void>(resolve => { ready = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      const failing = store.transact({ actor }, async tx => {
        await tx.write({ id: 'temporary', type: 'test.queue', content: {}, expectedVersion: 'new' })
        ready()
        await gate
        throw new Error('rollback only this transaction')
      })
      const rejected = expect(failing).rejects.toThrow('rollback only this transaction')
      await started
      const write = { id: 'kept', type: 'test.queue', content: { text: 'updated' }, expectedVersion: 1 } as const
      const next = operation === 'write' ? store.write(write)
        : operation === 'delete' ? store.delete({ id: 'kept', expectedVersion: 1 })
          : operation === 'revert' ? store.revertChangeset({ changesetId: initial.changesetId, actor })
            : store.transact({ actor }, tx => tx.write(write))
      const readDuringTransaction = store.get('temporary')
      release()
      await rejected
      const result = await next
      expect(await readDuringTransaction).toBeNull()
      expect(await store.get('temporary', { version: 1 })).toBeNull()
      const persisted = await store.get('kept', { includeTombstone: true })
      expect(persisted?.version).toBe(2)
      expect(Boolean(persisted?.meta.tombstone)).toBe(operation === 'delete' || operation === 'revert')
      expect(await store.get('kept', { version: 2, includeTombstone: true })).toEqual(persisted)
      expect(await store.getChangeset(result.commit.changeset.id)).toEqual(result.commit.changeset)
      expect(commits).toEqual([result.commit.changeset.id])
    })
  })

  it('rejects outer-store reentrancy instead of deadlocking, and allows later writes', async () => {
    await withStore(create(), async store => {
      await expect(store.transact({ actor }, async tx => {
        await tx.write({ id: 'temporary', type: 'test.queue', content: {}, expectedVersion: 'new' })
        await store.get('temporary')
      })).rejects.toMatchObject({ code: expect.stringContaining('reentrant_transaction') })
      expect(await store.get('temporary')).toBeNull()
      await store.write({ id: 'after', type: 'test.queue', content: {}, expectedVersion: 'new' })
      expect((await store.get('after'))?.version).toBe(1)
    })
  })

  it('continues after a deleted cursor row and does not revisit updated documents', async () => {
    await withStore(create(), async store => {
      for (const id of ['a', 'b', 'c', 'd']) {
        await store.write({ id, type: 'test.page', content: {}, expectedVersion: 'new' })
      }
      const first = await store.list({ type: 'test.page', limit: 2 })
      expect(first.items.map(item => item.id)).toEqual(['a', 'b'])
      expect(first.nextCursor).toBeDefined()
      await store.delete({ id: 'b', expectedVersion: 1 })
      await store.write({ id: 'a', type: 'test.page', content: { updated: true }, expectedVersion: 1 })
      await store.write({ id: 'e', type: 'test.page', content: {}, expectedVersion: 'new' })
      const second = await store.list({ type: 'test.page', limit: 2, cursor: first.nextCursor })
      expect(second.items.map(item => item.id)).toEqual(['c', 'd'])
      const last = await store.list({ type: 'test.page', limit: 2, cursor: second.nextCursor })
      expect(last.items.map(item => item.id)).toEqual(['e'])
      expect(last.nextCursor).toBeUndefined()
      expect((await store.list({ includeTombstone: true })).items.map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    })
  })

  it('binds cursor to filters while allowing page size changes and transaction reads', async () => {
    await withStore(create(), async store => {
      await store.transact({ actor }, async tx => {
        for (const id of ['hidden', 'a', 'b', 'c']) {
          await tx.write({
            id, type: id === 'hidden' ? 'other' : 'test.page', content: {}, expectedVersion: 'new',
            meta: { ownerExtensionId: 'example.owner' },
          })
        }
        const first = await tx.list({ type: 'test.page', ownerExtensionId: 'example.owner', limit: 1 })
        const second = await tx.list({ type: 'test.page', ownerExtensionId: 'example.owner', limit: 2, cursor: first.nextCursor })
        expect(second.items.map(item => item.id)).toEqual(['b', 'c'])
        for (const filters of [
          { type: 'other', ownerExtensionId: 'example.owner' },
          { type: 'test.page', ownerExtensionId: 'different' },
          { type: 'test.page', ownerExtensionId: 'example.owner', includeTombstone: true },
        ]) {
          await expect(tx.list({ ...filters, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'document.input_invalid' })
        }
      })
    })
  })

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, 1001, Number.MAX_SAFE_INTEGER])('rejects invalid page size %s', async limit => {
    await withStore(create(), async store => {
      await expect(store.list({ limit })).rejects.toMatchObject({ code: 'document.input_invalid' })
    })
  })

  it.each(['', '-1', '0', 'abc', 'null', '{}', '[0,null,null,false]', '[1,null,null,false,"extra"]'])('rejects invalid cursor %s', async cursor => {
    await withStore(create(), async store => {
      await expect(store.list({ cursor })).rejects.toMatchObject({ code: 'document.input_invalid' })
    })
  })

  it('groups all transaction writes into one persisted changeset', async () => {
    await withStore(create(), async store => {
      const commits: unknown[] = []
      store.subscribeCommits(commit => commits.push(commit))
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
        changesetId: result.changeset.id,
        createdAt: result.changeset.createdAt,
        committedAt: expect.any(String),
        actor,
        reason: 'create pair',
        correlationId: 'corr-1',
        callId: undefined,
        parentCallId: undefined,
        operations: [
          {
            store: 'documents',
            kind: 'create',
            entityId: 'doc-a',
            entityType: 'example.note',
            fromVersion: undefined,
            toVersion: 2,
          },
          {
            store: 'documents',
            kind: 'create',
            entityId: 'doc-b',
            entityType: 'example.note',
            fromVersion: undefined,
            toVersion: 1,
          },
        ],
        changeset: result.changeset,
        documents: [
          { id: 'doc-a', type: 'example.note', version: 2, tombstoned: false },
          { id: 'doc-b', type: 'example.note', version: 1, tombstoned: false },
        ],
      })
      expect(result.commit.documents[0]).not.toHaveProperty('content')
      expect(result.commit.operations[0]).not.toHaveProperty('content')
      expect(commits).toEqual([result.commit])
      expect(persisted).toEqual(result.changeset)
      expect(await store.get('doc-a')).toMatchObject({ version: 2, content: { text: 'a2' } })
      expect(await store.get('doc-a', { version: 1 })).toMatchObject({ content: { text: 'a1' } })
    })
  })

  it('removes documents, revisions, and changesets when a transaction fails', async () => {
    await withStore(create(), async store => {
      let changesetId = ''
      const commits: unknown[] = []
      store.subscribeCommits(commit => commits.push(commit))

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
      expect(commits).toEqual([])
    })
  })

  it('does not report a committed write as failed when a commit observer throws', async () => {
    await withStore(create(), async store => {
      store.subscribeCommits(() => {
        throw new Error('observer failed')
      })

      await expect(store.write({
        id: 'observer-failure',
        type: 'example.note',
        content: { persisted: true },
        expectedVersion: 'new',
      })).resolves.toMatchObject({ changesetId: expect.any(String) })
      expect(await store.get('observer-failure')).toMatchObject({ content: { persisted: true } })
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
