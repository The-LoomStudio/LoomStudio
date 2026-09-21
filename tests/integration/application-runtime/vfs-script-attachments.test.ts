import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createBlobStore } from '@loom-studio/blob-store'
import { listPresetScriptAttachments } from '../../../packages/application-runtime/src/vfs/script-attachments.js'
import { createResourceVfs } from '../../../packages/application-runtime/src/vfs/resource-filesystem.js'

describe('VFS SQL index and Blob bytes', () => {
  it('reads only owned mounted script bytes and honors pinned versions without executing source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-vfs-'))
    let sequence = 0
    const createId = (prefix: string) => `${prefix}-${++sequence}`
    const now = () => '2026-09-21T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const blobs = createBlobStore({ engine, rootDirectory: directory, createId, now })
      const original = 'throw new Error("must never execute");\n'
      const first = await blobs.write({ source: new TextEncoder().encode(original), actor: { kind: 'kernel', id: 'test' } })
      const next = await blobs.write({ source: new TextEncoder().encode('new-source'), actor: { kind: 'kernel', id: 'test' } })
      const content = {
        owner: { kind: 'preset', presetId: 'preset' },
        source: { blobId: first.blob.id, mediaType: 'text/javascript', fileName: '作者.js' },
      }
      await documents.write({ id: 'script', type: 'airp.loomScript', content, expectedVersion: 'new' })
      await documents.write({
        id: 'mount', type: 'airp.loomScriptMount', expectedVersion: 'new',
        content: { target: { kind: 'preset', presetId: 'preset' }, scriptDocumentId: 'script', orderIndex: 0, pinnedDocumentVersion: 1, enabled: false },
      })
      await documents.write({
        id: 'script', type: 'airp.loomScript', expectedVersion: 1,
        content: { ...content, source: { ...content.source, blobId: next.blob.id } },
      })
      await documents.write({
        id: 'foreign', type: 'airp.loomScript', expectedVersion: 'new',
        content: { ...content, owner: { kind: 'preset', presetId: 'other' } },
      })
      await documents.write({
        id: 'foreign-mount', type: 'airp.loomScriptMount', expectedVersion: 'new',
        content: { target: { kind: 'preset', presetId: 'preset' }, scriptDocumentId: 'foreign', orderIndex: 1 },
      })
      let reads = 0
      const ctx = { documents, blobs: { ...blobs, read: async (...args: Parameters<typeof blobs.read>) => { reads++; return blobs.read(...args) } } }
      const fs = createResourceVfs({ projections: [], attachments: () => listPresetScriptAttachments(ctx, 'preset') })
      const signal = new AbortController().signal
      expect(await fs.ls(['/attachments'], signal)).toBe('/attachments\n  作者.js')
      expect(reads).toBe(0)
      const result = await fs.read(['/attachments/作者.js'], signal)
      expect(result.text).toBe(original)
      expect(result.observation.binding).toMatchObject({ kind: 'script', documentId: 'script', version: 1, blobId: first.blob.id })
      expect(reads).toBe(1)
    } finally {
      engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
