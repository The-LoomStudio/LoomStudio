import { createKernelBridge } from '../../support/kernel-bridge.js'
import { createExtensionHostHarness as createKernelHarness } from '../../contract/extension-host/helpers.js'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createPromptResourceStore } from '@loom-studio/application-runtime/data'
import { createSqliteDataEngine } from '@loom-studio/kernel/data-engine'
import { createId } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/extension-sdk'
import { describe, expect, it } from 'vitest'

describe('document and diagnostics integration', () => {
  const actor = { kind: 'system' as const, id: 'document-integration-test' }

  it('preserves document history, tombstones deletes, and emits data.changed', async () => {
    const { kernel, documents } = createKernelHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event) })

    await documents.write({
      id: 'doc-scenario:revision',
      type: 'example.documentScenario.note',
      content: { version: 1 },
      expectedVersion: 'new',
      actor,
    })
    await documents.write({
      id: 'doc-scenario:revision',
      type: 'example.documentScenario.note',
      content: { version: 2 },
      expectedVersion: 1,
      actor,
    })
    const firstRevision = await documents.get('doc-scenario:revision', { version: 1 })
    const current = await documents.get('doc-scenario:revision')
    await documents.delete({ id: 'doc-scenario:revision', expectedVersion: 2, reason: 'scenario tombstone', actor })
    const afterDelete = await documents.get('doc-scenario:revision')
    const tombstone = await documents.get('doc-scenario:revision', { includeTombstone: true })

    expect(firstRevision).toMatchObject({ version: 1, content: { version: 1 } })
    expect(current).toMatchObject({ version: 2, content: { version: 2 } })
    expect(afterDelete).toBeNull()
    expect(tombstone).toMatchObject({ version: 3, meta: { tombstone: { reason: 'scenario tombstone' } } })
    expect(events.map(event => event.name)).toEqual(['data.changed', 'data.changed', 'data.changed'])
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
    const { kernel, documents } = createKernelHarness()
    await kernel.start()

    await documents.write({
      id: 'doc-scenario:conflict',
      type: 'example.documentScenario.note',
      content: { stable: true },
      expectedVersion: 'new',
      actor,
    })

    await expect(documents.write({
      id: 'doc-scenario:conflict',
      type: 'example.documentScenario.note',
      content: { stable: false },
      expectedVersion: 999,
      actor,
    })).rejects.toThrow('Document version conflict')

    const current = await documents.get('doc-scenario:conflict')
    expect(current).toMatchObject({ version: 1, content: { stable: true } })
  })

  it('queries and reverts changesets and emits data.changed', async () => {
    const { kernel, documents } = createKernelHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event) })
    const created = await documents.write({
      id: 'doc-scenario:undo',
      type: 'example.documentScenario.note',
      content: { value: 'created' },
      expectedVersion: 'new',
      actor,
    })
    const changeset = await documents.getChangeset(created.changesetId)

    const reverted = await documents.revertChangeset({
      changesetId: created.changesetId,
      reason: 'integration undo',
      actor,
    })
    const afterUndo = await documents.get('doc-scenario:undo')

    expect(changeset).toMatchObject({
      id: created.changesetId,
      operations: [{ kind: 'create', documentId: 'doc-scenario:undo' }],
    })
    expect(reverted.changesetId).not.toBe(created.changesetId)
    expect(afterUndo).toBeNull()
    expect(events.map(event => event.name)).toEqual(['data.changed', 'data.changed'])
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

    const result = await documents.list({ ownerExtensionId: 'example.ownerA' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'owner:a', meta: { ownerExtensionId: 'example.ownerA' } })
  })

  it('makes event subscriber failures queryable through system.introspect diagnostics', async () => {
    const { kernel, documents } = createKernelHarness()
    await kernel.start()
    const subscription = kernel.getEventBus().subscribe(['data.changed'], () => {
      throw new Error('broken document subscriber')
    })
    const bridge = createKernelBridge(kernel)
    try {
      await documents.write({
        id: 'diagnostic-scenario:subscriber',
        type: 'example.documentScenario.note',
        content: { stable: true },
        expectedVersion: 'new',
        actor,
      })
      const introspect = await bridge.call<{ diagnostics?: Array<{ code: string; source: string }> }>('system.introspect', {
        includeDiagnostics: true,
      })

      expect(introspect.diagnostics).toContainEqual(expect.objectContaining({ code: 'event.subscriber_failed', source: 'event-hub' }))
    } finally {
      subscription.dispose()
    }
  })
})
