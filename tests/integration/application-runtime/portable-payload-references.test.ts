import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { describe, expect, it, vi } from 'vitest'

function fixture() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-09-23T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, createId, now })
  return { engine, documents, runtime }
}

const payload = {
  packageId: 'example.payload', fileName: 'config.json', format: 'example.config',
  mediaType: 'application/json', content: '{"enabled":true}',
}

describe('Portable Payload dangling references', () => {
  it('keeps bound Cards unchanged and fails reads and exports explicitly after deletion', async () => {
    const { engine, runtime, documents } = fixture()
    try {
      const created = await runtime.createPortableExtensionPayload({ artifactPayloadId: 'config', payload })
      const cards = []
      for (const name of ['First', 'Second']) {
        const { card } = await runtime.createCard({ name })
        const bound = await runtime.replaceCardPortableExtensionPayloads({
          cardId: card.id, expectedVersion: card.version, payloadIds: [created.payload.id],
        })
        cards.push(bound.card)
        expect((await runtime.exportCardBundle({ cardId: card.id })).artifact.extensionPayloads)
          .toEqual([{ id: 'config', ...payload }])
      }
      const captured = await runtime.captureCardDirectoryState({ cardId: cards[0]!.id })
      expect(captured.artifact.extensionPayloads).toEqual([{ id: 'config', ...payload }])

      const deleted = await runtime.deletePortableExtensionPayload({
        payloadId: created.payload.id, expectedVersion: created.payload.version,
      })
      expect(deleted.deleted).toBe(true)
      expect((await documents.getChangeset(deleted.mutation.changesetId))?.operations)
        .toEqual([expect.objectContaining({ kind: 'delete', documentId: created.payload.id })])
      const missing = `Document not found: ${created.payload.id}`
      await expect(runtime.getPortableExtensionPayload({ payloadId: created.payload.id })).rejects.toThrow(missing)
      expect((await runtime.listPortableExtensionPayloads()).payloads).toEqual([])
      for (const card of cards) {
        expect((await runtime.getCard({ cardId: card.id })).card).toEqual(card)
        await expect(runtime.exportCardBundle({ cardId: card.id })).rejects.toThrow(missing)
        await expect(runtime.captureCardDirectoryState({ cardId: card.id })).rejects.toThrow(missing)
      }

      await runtime.createPortableExtensionPayload({ artifactPayloadId: 'config', payload })
      await expect(runtime.exportCardBundle({ cardId: cards[0]!.id })).rejects.toThrow(missing)
      await runtime.replaceCardPortableExtensionPayloads({
        cardId: cards[0]!.id, expectedVersion: cards[0]!.version, payloadIds: [],
      })
      expect((await runtime.exportCardBundle({ cardId: cards[0]!.id })).artifact.extensionPayloads ?? []).toEqual([])
      expect((await runtime.getCard({ cardId: cards[1]!.id })).card).toEqual(cards[1])
    } finally {
      await engine.close()
    }
  })

  it('rejects stale deletion versions without changing a bound Card or its Payload', async () => {
    const { engine, runtime } = fixture()
    try {
      const created = await runtime.createPortableExtensionPayload({ payload })
      const { card } = await runtime.createCard({ name: 'Bound' })
      const bound = await runtime.replaceCardPortableExtensionPayloads({
        cardId: card.id, expectedVersion: card.version, payloadIds: [created.payload.id],
      })
      const updated = await runtime.updatePortableExtensionPayload({
        payloadId: created.payload.id, expectedVersion: created.payload.version,
        payload: { ...payload, content: '{"enabled":false}' },
      })
      await expect(runtime.deletePortableExtensionPayload({
        payloadId: created.payload.id, expectedVersion: created.payload.version,
      })).rejects.toThrow(`Portable Extension Payload version conflict: ${created.payload.id}`)
      expect((await runtime.getPortableExtensionPayload({ payloadId: created.payload.id })).payload).toEqual(updated.payload)
      expect((await runtime.getCard({ cardId: card.id })).card).toEqual(bound.card)
      expect((await runtime.exportCardBundle({ cardId: card.id })).artifact.extensionPayloads)
        .toEqual([expect.objectContaining({ content: '{"enabled":false}' })])
    } finally {
      await engine.close()
    }
  })

  it('keeps the conditional delete after a concurrent update between the read and transaction', async () => {
    const { engine, runtime, documents } = fixture()
    try {
      const created = await runtime.createPortableExtensionPayload({ payload })
      const originalGet = documents.get.bind(documents)
      const read = vi.spyOn(documents, 'get').mockImplementationOnce(async (id, options) => {
        const stale = await originalGet(id, options)
        await documents.write({
          id, type: stale!.type, expectedVersion: stale!.version,
          content: { ...created.payload, content: 'concurrent content' },
        })
        return stale
      })
      await expect(runtime.deletePortableExtensionPayload({
        payloadId: created.payload.id, expectedVersion: created.payload.version,
      })).rejects.toMatchObject({ code: 'document.conflict' })
      read.mockRestore()
      expect((await runtime.getPortableExtensionPayload({ payloadId: created.payload.id })).payload)
        .toMatchObject({ version: created.payload.version + 1, content: 'concurrent content' })
    } finally {
      vi.restoreAllMocks()
      await engine.close()
    }
  })
})
