import { onTestFinished } from 'vitest'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/kernel/diagnostics'
import { createInMemoryDocumentStore, createSqliteDocumentStore } from '@loom-studio/kernel/document-store'
import type { ExtensionHost } from '@loom-studio/kernel/extension-host'
import { createKernel } from '@loom-studio/kernel'
import { describe, expect, it, vi } from 'vitest'

function createTestKernel() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const extensionHost: ExtensionHost = {
    discover: async () => { throw new Error('not implemented') },
    activate: async () => { throw new Error('not implemented') },
    activateAll: async () => [],
    reload: async () => { throw new Error('not implemented') },
    dispose: async () => {},
    forget: async () => {},
    disposeAll: async () => {},
    list: () => [],
    diagnostics: () => [],
  }
  const kernel = createKernel({
    documents,
    dataCommits: documents,
    diagnostics,
    extensionHost,
  })

  onTestFinished(async () => {
    try {
      await kernel.stop()
      await extensionHost.disposeAll()
    } finally {
      await documents.close()
    }
  })

  return { kernel, documents, diagnostics }
}

describe('kernel rpc contract', () => {
  it('aggregates repeated subscriber failures without merging separate subscriptions', async () => {
    const { kernel, diagnostics } = createTestKernel()
    await kernel.start()
    const events = kernel.getEventBus()
    const first = events.subscribe(['extensions.changed'], () => { throw new Error('first subscriber') })
    const second = events.subscribe(['extensions.changed'], () => { throw new Error('second subscriber') })
    let delivered = 0
    const healthy = events.subscribe(['extensions.changed'], () => { delivered++ })
    try {
      for (let index = 0; index < 1000; index++) events.emit('extensions.changed', {})
      expect(delivered).toBe(1000)
      const items = diagnostics.list({ source: 'event-hub' })
      expect(items).toHaveLength(2)
      expect(items.every(item => item.code === 'event.subscriber_failed' && item.occurrences === 1000)).toBe(true)
      expect(new Set(items.map(item => (item.details as { subscriptionId: string }).subscriptionId)).size).toBe(2)
    } finally {
      first.dispose()
      second.dispose()
      healthy.dispose()
      await kernel.stop()
    }
  })

  it('can be started, stopped, and started again without duplicating kernel handlers', async () => {
    const { kernel } = createTestKernel()

    await kernel.start()
    const firstSurface = kernel.getPublicSurface()
    await kernel.stop()
    await kernel.start()
    const secondSurface = kernel.getPublicSurface()

    expect(secondSurface).toEqual(firstSurface)
    await expect(kernel.callRpc<{ ok: true }>('system.ping', {})).resolves.toMatchObject({ ok: true })
  })

  it('serves system.ping through the kernel rpc surface', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ ok: true; echo: string }>('system.ping', { echo: 'hello' })

    expect(result.ok).toBe(true)
    expect(result.echo).toBe('hello')
  })

  it('exposes kernel-owned methods and events through system.introspect', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{
      kernel: { studioVersion: string; kernelVersion: string; protocolVersion: string }
      methods: Array<{ name: string }>
      events: string[]
    }>('system.introspect', {})

    expect(result.kernel).toEqual({ studioVersion: '0.0.0', kernelVersion: '0.0.0', protocolVersion: '0.1.0' })
    expect(result.methods.some(method => method.name === 'system.ping')).toBe(true)
    expect(result.methods.some(method => method.name === 'system.introspect')).toBe(true)
    expect(result.methods.some(method => method.name.startsWith('docs.'))).toBe(false)
    expect(result.events).toContain('data.changed')
    expect(result.events).toContain('state.changed')
    expect(result.events).toContain('diagnostics.updated')
    expect(result.events).toContain('extensions.changed')
    expect(result.events).toContain('extensions.data.changed')
    expect(result.events).toContain('entity.lifecycle.changed')
    expect(result.events).toContain('system.ready')
    expect(result.events).toContain('system.stopping')
    expect(result.events.some(event => event.startsWith('docs.'))).toBe(false)
  })

  it('rejects non-kernel namespace registration', () => {
    const { kernel } = createTestKernel()

    expect(() => kernel.registerKernelRpc('chat.send', () => ({}))).toThrow('Not a Kernel namespace')
  })

  it('rejects duplicate kernel rpc registration', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    expect(() => kernel.registerKernelRpc('system.ping', () => ({}))).toThrow('already registered')
  })

  it('exposes injected platform services through getters', () => {
    const { kernel, documents, diagnostics } = createTestKernel()

    expect(kernel.getDocumentStore()).toBe(documents)
    expect(kernel.getDiagnostics()).toBe(diagnostics)
  })

  it('emits data.changed after document writes with actor and call metadata', async () => {
    const { kernel, documents } = createTestKernel()
    const events: Array<{ name: string; payload: { changesetId: string; operations: Array<Record<string, unknown>> }; meta: Record<string, unknown> }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event as never) })

    await documents.write({
      id: 'example.doc:2',
      type: 'example.doc',
      content: { privateText: 'must not enter commit facts' },
      expectedVersion: 'new',
      actor: { kind: 'client', id: 'client-1' },
      correlationId: 'corr-1',
      callId: 'call-1',
    })

    const document = await documents.get('example.doc:2')

    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('data.changed')
    expect(events[0]?.payload).toMatchObject({
      changesetId: expect.any(String),
      operations: [{
        store: 'documents',
        kind: 'create',
        entityId: 'example.doc:2',
        entityType: 'example.doc',
        toVersion: 1,
      }],
    })
    expect(events[0]?.meta).toMatchObject({
      source: 'kernel',
      clientId: 'client-1',
      correlationId: 'corr-1',
      callId: 'call-1',
    })
    expect(JSON.stringify(events)).not.toContain('must not enter commit facts')
    expect(document?.meta.createdBy).toEqual({ kind: 'client', id: 'client-1' })
  })

  it('continues broadcasting when one event subscriber throws', async () => {
    const { kernel, documents } = createTestKernel()
    const events: string[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['data.changed'], () => {
      throw new Error('broken subscriber')
    })
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event.name) })

    await expect(documents.write({
      id: 'example.doc:isolated-subscriber',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
      actor: { kind: 'client', id: 'client-isolated' },
    })).resolves.toMatchObject({ commit: { changesetId: expect.any(String) } })

    expect(events).toEqual(['data.changed'])
  })

  it('emits data.changed with call metadata after document deletes', async () => {
    const { kernel, documents } = createTestKernel()
    const events: Array<{ payload: { operations: Array<{ kind: string; entityId: string }> }; meta: { correlationId?: string; callId?: string } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event as never) })

    await documents.write({
      id: 'example.doc:3',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
      actor: { kind: 'client', id: 'client-2' },
      correlationId: 'corr-2',
      callId: 'call-2',
    })

    await documents.delete({
      id: 'example.doc:3',
      expectedVersion: 1,
      actor: { kind: 'client', id: 'client-3' },
      correlationId: 'corr-3',
      callId: 'call-3',
    })

    expect(events).toHaveLength(2)
    expect(events[1]?.payload.operations[0]).toMatchObject({ kind: 'delete', entityId: 'example.doc:3' })
    expect(events[1]?.meta.correlationId).toBe('corr-3')
    expect(events[1]?.meta.callId).toBe('call-3')
  })

  it('reads and reverts changesets with client call metadata', async () => {
    const { kernel, documents } = createTestKernel()
    const events: Array<{
      name: string
      payload: { changesetId: string; operations: Array<{ kind: string; entityId: string }> }
      meta: { correlationId?: string; callId?: string; parentCallId?: string }
    }> = []
    await kernel.start()
    const created = await documents.write({
      id: 'example.doc:undo',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
      actor: { kind: 'client', id: 'client-create' },
      correlationId: 'corr-create',
      callId: 'call-create',
    })
    const read = await documents.getChangeset(created.commit.changesetId)
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event as never) })

    const reverted = await documents.revertChangeset({
      changesetId: created.commit.changesetId,
      actor: { kind: 'client', id: 'client-undo' },
      reason: 'undo create',
      correlationId: 'corr-undo',
      callId: 'call-undo',
      parentCallId: 'call-create',
    })
    const revertChangeset = await documents.getChangeset(reverted.commit.changesetId)

    expect(read).toMatchObject({
      id: created.commit.changesetId,
      createdBy: { kind: 'client', id: 'client-create' },
      correlationId: 'corr-create',
    })
    expect(await documents.get('example.doc:undo')).toBeNull()
    expect(revertChangeset).toMatchObject({
      id: reverted.commit.changesetId,
      createdBy: { kind: 'client', id: 'client-undo' },
      reason: 'undo create',
      correlationId: 'corr-undo',
      callId: 'call-undo',
      parentCallId: 'call-create',
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'data.changed',
      payload: {
        changesetId: reverted.commit.changesetId,
        operations: [{ kind: 'delete', entityId: 'example.doc:undo' }],
      },
      meta: { correlationId: 'corr-undo', callId: 'call-undo', parentCallId: 'call-create' },
    })
  })

  it('emits no data.changed when revert conflicts', async () => {
    const { kernel, documents } = createTestKernel()
    const events: unknown[] = []
    await kernel.start()
    const created = await documents.write({
      id: 'example.doc:conflicting-undo',
      type: 'example.doc',
      content: { value: 1 },
      expectedVersion: 'new',
      actor: { kind: 'client', id: 'client-conflict' },
    })
    await documents.write({
      id: 'example.doc:conflicting-undo',
      type: 'example.doc',
      content: { value: 2 },
      expectedVersion: 1,
      actor: { kind: 'client', id: 'client-conflict' },
    })
    kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event) })

    await expect(documents.revertChangeset({
      changesetId: created.commit.changesetId,
      actor: { kind: 'client', id: 'client-conflict' },
    })).rejects.toMatchObject({ code: 'document.conflict' })

    expect(events).toHaveLength(0)
    expect(await documents.get('example.doc:conflicting-undo')).toMatchObject({
      version: 2,
      content: { value: 2 },
    })
  })
})

it('compacts large UTF-8 commits and rollback summaries into a single frame with overflow=true', async () => {
  const { kernel, documents, diagnostics } = createTestKernel()
  await kernel.start()
  const events: Array<{ name: string; payload: any; meta: any }> = []
  kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event) })
  const result = await documents.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
    for (let i = 0; i < 1000; i++) await tx.write({ id: `正常\\\"文档-${i}`, type: 'test.note', content: {}, expectedVersion: 'new' })
  })

  expect(events).toHaveLength(1)
  expect(events[0]?.payload.changesetId).toBe(result.commit.changesetId)
  expect(events[0]?.payload.overflow).toBe(true)
  expect(events[0]?.meta.definitionVersion).toBe(2)
  expect(Buffer.byteLength(JSON.stringify(events[0]?.payload), 'utf8')).toBeLessThanOrEqual(65536)
  expect(events[0]?.payload.operations).toEqual([
    expect.objectContaining({ store: 'documents', kind: 'create', entityType: 'test.note', count: 1000 }),
  ])

  const reverted = await documents.revertChangeset({
    changesetId: result.commit.changesetId,
    actor: { kind: 'system', id: 'test' },
  })
  expect(events).toHaveLength(2)
  expect(events[1]?.payload.changesetId).toBe(reverted.commit.changesetId)
  expect(events[1]?.payload.overflow).toBe(true)
  expect(Buffer.byteLength(JSON.stringify(events[1]?.payload), 'utf8')).toBeLessThanOrEqual(65536)
  expect(diagnostics.list()).toHaveLength(0)
})

it('preserves attribution scope when compacting >32 KiB real SQLite document commits', async () => {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createSqliteDocumentStore({ filename: ':memory:' })
  const extensionHost: ExtensionHost = {
    discover: async () => { throw new Error('not implemented') },
    activate: async () => { throw new Error('not implemented') },
    activateAll: async () => [],
    reload: async () => { throw new Error('not implemented') },
    dispose: async () => {},
    forget: async () => {},
    disposeAll: async () => {},
    list: () => [],
    diagnostics: () => [],
  }
  const kernel = createKernel({ documents, dataCommits: documents, diagnostics, extensionHost })
  onTestFinished(async () => {
    try {
      await kernel.stop()
    } finally {
      await documents.close()
    }
  })
  await kernel.start()
  const events: Array<{ name: string; payload: { changesetId: string; overflow?: boolean; operations: Array<Record<string, unknown>> } }> = []
  kernel.getEventBus().subscribe(['data.changed'], event => { events.push(event as never) })

  const installationId = extensionInstallationId('example.events', { kind: 'card', cardId: 'card-1' })
  const committed = await documents.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
    for (let index = 0; index < 200; index++) {
      await tx.write({
        id: `scoped-document-with-long-distinct-entity-id-${String(index).padStart(4, '0')}`,
        type: 'test.note',
        content: { index },
        expectedVersion: 'new',
        meta: { ownerExtensionId: 'example.events', ownerInstallationId: installationId },
      })
    }
  })

  expect(events).toHaveLength(1)
  expect(events[0]?.payload.changesetId).toBe(committed.commit.changesetId)
  expect(events[0]?.payload.overflow).toBe(true)
  expect(Buffer.byteLength(JSON.stringify(events[0]?.payload), 'utf8')).toBeLessThanOrEqual(65536)
  expect(events[0]?.payload.operations).toEqual([
    {
      store: 'documents',
      kind: 'create',
      entityType: 'test.note',
      entityId: '*',
      scope: { cardId: 'card-1', installationId },
      count: 200,
    },
  ])
  expect(diagnostics.list()).toHaveLength(0)
})

it('reports notification failure without changing successful write or revert results', async () => {
  const { kernel, documents, diagnostics } = createTestKernel()
  await kernel.start()
  const events = kernel.getEventBus()
  const spy = vi.spyOn(events, 'emit').mockImplementation(() => {
    throw new Error('notification unavailable')
  })
  try {
    const created = await documents.write({
      id: 'test:notify-failure',
      type: 'test.note',
      content: {},
      expectedVersion: 'new',
      actor: { kind: 'system', id: 'test' },
    })
    await expect(documents.revertChangeset({
      changesetId: created.commit.changesetId,
      actor: { kind: 'system', id: 'test' },
    })).resolves.toHaveProperty('commit.changesetId')
    expect(diagnostics.list().every(item => item.code === 'event.commit_notification_failed' && item.message.includes('committed'))).toBe(true)
    expect(diagnostics.list()).toHaveLength(1)
    expect(diagnostics.list()[0]?.occurrences).toBe(2)
    expect(await documents.get('test:notify-failure')).toBeNull()
  } finally { spy.mockRestore() }
})
