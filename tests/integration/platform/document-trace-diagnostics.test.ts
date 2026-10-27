import { createKernelBridge } from '../../support/kernel-bridge.js'
import { createExtensionHostHarness as createKernelHarness } from '../../contract/extension-host/helpers.js'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createId } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/extension-sdk'
import { describe, expect, it } from 'vitest'

describe('document and diagnostics integration', () => {
  it('preserves document history, tombstones deletes, and emits docs.changed', async () => {
    const { kernel } = createKernelHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => { events.push(event) })
    const bridge = createKernelBridge(kernel)

    await bridge.call('docs.write', {
      id: 'doc-scenario:revision',
      type: 'example.documentScenario.note',
      content: { version: 1 },
      expectedVersion: 'new',
    })
    await bridge.call('docs.write', {
      id: 'doc-scenario:revision',
      type: 'example.documentScenario.note',
      content: { version: 2 },
      expectedVersion: 1,
    })
    const firstRevision = await bridge.call<{ document: { version: number; content: { version: number } } }>('docs.get', { id: 'doc-scenario:revision', version: 1 })
    const current = await bridge.call<{ document: { version: number; content: { version: number } } }>('docs.get', { id: 'doc-scenario:revision' })
    await bridge.call('docs.delete', { id: 'doc-scenario:revision', expectedVersion: 2, reason: 'scenario tombstone' })
    const afterDelete = await bridge.call<{ document: unknown | null }>('docs.get', { id: 'doc-scenario:revision' })
    const tombstone = await bridge.call<{ document: { version: number; meta: { tombstone?: { reason?: string } } } }>('docs.get', { id: 'doc-scenario:revision', includeTombstone: true })

    expect(firstRevision.document).toMatchObject({ version: 1, content: { version: 1 } })
    expect(current.document).toMatchObject({ version: 2, content: { version: 2 } })
    expect(afterDelete.document).toBeNull()
    expect(tombstone.document).toMatchObject({ version: 3, meta: { tombstone: { reason: 'scenario tombstone' } } })
    expect(events.map(event => event.name)).toEqual(['docs.changed', 'docs.changed', 'docs.changed'])
  })

  it('requires a shared SQLite Data Engine for Application Runtime', async () => {
    const { documents } = createKernelHarness()
    const now = () => new Date().toISOString()
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const promptResources = createPromptResourceStore({ engine, createId, now })
      expect(() => createApplicationRuntime({ documents, promptResources })).toThrow('Shared Data Engine is required')
    } finally {
      engine.close()
    }
  })

  it('rejects stale document writes and preserves the current document', async () => {
    const { kernel } = createKernelHarness()
    await kernel.start()
    const bridge = createKernelBridge(kernel)

    await bridge.call('docs.write', {
      id: 'doc-scenario:conflict',
      type: 'example.documentScenario.note',
      content: { stable: true },
      expectedVersion: 'new',
    })

    await expect(bridge.call('docs.write', {
      id: 'doc-scenario:conflict',
      type: 'example.documentScenario.note',
      content: { stable: false },
      expectedVersion: 999,
    })).rejects.toThrow('Document version conflict')

    const current = await bridge.call<{ document: { version: number; content: { stable: boolean } } }>('docs.get', { id: 'doc-scenario:conflict' })
    expect(current.document).toMatchObject({ version: 1, content: { stable: true } })
  })

  it('queries and reverts changesets through the client bridge', async () => {
    const { kernel } = createKernelHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.*'], event => { events.push(event) })
    const bridge = createKernelBridge(kernel)
    const created = await bridge.call<{ changesetId: string }>('docs.write', {
      id: 'doc-scenario:undo',
      type: 'example.documentScenario.note',
      content: { value: 'created' },
      expectedVersion: 'new',
    })
    const read = await bridge.call<{
      changeset: { id: string; operations: Array<{ kind: string; documentId: string }> }
    }>('docs.getChangeset', { changesetId: created.changesetId })

    const reverted = await bridge.call<{ changesetId: string }>('docs.revertChangeset', {
      changesetId: created.changesetId,
      reason: 'integration undo',
    })
    const afterUndo = await bridge.call<{ document: unknown | null }>('docs.get', { id: 'doc-scenario:undo' })

    expect(read.changeset).toMatchObject({
      id: created.changesetId,
      operations: [{ kind: 'create', documentId: 'doc-scenario:undo' }],
    })
    expect(reverted.changesetId).not.toBe(created.changesetId)
    expect(afterUndo.document).toBeNull()
    expect(events.map(event => event.name)).toEqual([
      'docs.changed',
      'docs.changed',
      'docs.rollback.completed',
    ])
  })

  it('filters documents by ownerExtensionId', async () => {
    const { kernel, documents } = createKernelHarness()
    await kernel.start()

    await documents.write({
      id: 'owner:a',
      type: 'example.owner.note',
      content: { owner: 'a' },
      expectedVersion: 'new',
      meta: { ownerExtensionId: 'example.ownerA' },
      actor: { kind: 'extension', id: 'example.ownerA' },
    })
    await documents.write({
      id: 'owner:b',
      type: 'example.owner.note',
      content: { owner: 'b' },
      expectedVersion: 'new',
      meta: { ownerExtensionId: 'example.ownerB' },
      actor: { kind: 'extension', id: 'example.ownerB' },
    })

    const bridge = createKernelBridge(kernel)
    const result = await bridge.call<{ items: Array<{ id: string; meta: { ownerExtensionId?: string } }> }>('docs.list', { ownerExtensionId: 'example.ownerA' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'owner:a', meta: { ownerExtensionId: 'example.ownerA' } })
  })

  it('makes event subscriber failures queryable through diagnostics.list', async () => {
    const { kernel } = createKernelHarness()
    await kernel.start()
    const subscription = kernel.getEventBus().subscribe(['docs.changed'], () => {
      throw new Error('broken document subscriber')
    })
    const bridge = createKernelBridge(kernel)
    try {
      await bridge.call('docs.write', {
        id: 'diagnostic-scenario:subscriber',
        type: 'example.documentScenario.note',
        content: { stable: true },
        expectedVersion: 'new',
      })
      const diagnostics = await bridge.call<{ items: Array<{ code: string; source: string }> }>('diagnostics.list')

      expect(diagnostics.items).toContainEqual(expect.objectContaining({ code: 'event.subscriber_failed', source: 'event-hub' }))
    } finally {
      subscription.dispose()
    }
  })
})
