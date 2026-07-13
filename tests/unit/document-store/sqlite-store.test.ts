import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

describe('sqlite document store', () => {
  it('persists current documents and revisions across store instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const first = createSqliteDocumentStore({ filename })
      const created = await first.write({
        id: 'doc-1',
        type: 'example.note',
        content: { text: 'v1' },
        expectedVersion: 'new',
      })
      const updated = await first.write({
        id: 'doc-1',
        type: 'example.note',
        content: { text: 'v2' },
        expectedVersion: 1,
      })
      first.close()

      const second = createSqliteDocumentStore({ filename })
      const current = await second.get('doc-1')
      const revision = await second.get('doc-1', { version: 1 })
      const changeset = await second.getChangeset(updated.changesetId)
      const listed = await second.list({ type: 'example.note' })
      second.close()

      expect(created.operations[0]).toMatchObject({ kind: 'create', toVersion: 1 })
      expect(updated.operations[0]).toMatchObject({ kind: 'update', fromVersion: 1, toVersion: 2 })
      expect(current).toMatchObject({ id: 'doc-1', version: 2, content: { text: 'v2' } })
      expect(revision).toMatchObject({ id: 'doc-1', version: 1, content: { text: 'v1' } })
      expect(changeset).toMatchObject({ id: updated.changesetId, operations: updated.operations })
      expect(listed.items).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps tombstoned documents out of default reads while preserving history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const store = createSqliteDocumentStore({ filename })
      await store.write({
        id: 'doc-delete',
        type: 'example.note',
        content: { ok: true },
        expectedVersion: 'new',
      })
      const deleted = await store.delete({
        id: 'doc-delete',
        expectedVersion: 1,
        reason: 'test delete',
      })
      const hidden = await store.get('doc-delete')
      const included = await store.get('doc-delete', { includeTombstone: true })
      const revision = await store.get('doc-delete', { version: 1 })
      const listed = await store.list({ type: 'example.note' })
      store.close()

      expect(deleted.operations[0]).toMatchObject({ kind: 'delete', fromVersion: 1, toVersion: 2 })
      expect(hidden).toBeNull()
      expect(included?.meta.tombstone?.reason).toBe('test delete')
      expect(revision).toMatchObject({ version: 1, content: { ok: true } })
      expect(listed.items).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rolls back writes when a transaction fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const store = createSqliteDocumentStore({ filename })

      await expect(store.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        await tx.write({
          id: 'rolled-back',
          type: 'example.note',
          content: { ok: false },
          expectedVersion: 'new',
        })
        throw new Error('stop transaction')
      })).rejects.toThrow('stop transaction')

      expect(await store.get('rolled-back')).toBeNull()
      store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
