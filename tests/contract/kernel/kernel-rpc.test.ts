import { onTestFinished } from 'vitest'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
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
      const result = await kernel.callRpc<{ items: { code: string; occurrences: number; details: { subscriptionId: string } }[] }>(
        'diagnostics.list', { source: 'event-hub' },
      )
      expect(result.items).toHaveLength(2)
      expect(result.items.every(item => item.code === 'event.subscriber_failed' && item.occurrences === 1000)).toBe(true)
      expect(new Set(result.items.map(item => item.details.subscriptionId)).size).toBe(2)
      expect(diagnostics.list()).toHaveLength(2)
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
    expect(result.methods.some(method => method.name === 'system.introspect')).toBe(true)
    expect(result.methods.some(method => method.name === 'docs.write')).toBe(true)
    expect(result.methods.some(method => method.name === 'docs.getChangeset')).toBe(true)
    expect(result.methods.some(method => method.name === 'docs.revertChangeset')).toBe(true)
    expect(result.events).toContain('data.changed')
    expect(result.events).toContain('docs.changed')
    expect(result.events).toContain('docs.rollback.completed')
    expect(result.events).toContain('docs.rollback.failed')
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

  it('emits docs.changed after document writes through kernel rpc', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ name: string; payload: { changesetId: string; documents: Array<{ tombstoned: boolean }> } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => { events.push(event as never) })

    await kernel.callRpc('docs.write', {
      id: 'example.doc:2',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
      actor: { kind: 'extension', id: 'forged' },
      meta: { ownerExtensionId: 'forged' },
    }, { clientId: 'client-1', correlationId: 'corr-1', callId: 'call-1' })

    const document = await kernel.getDocumentStore().get('example.doc:2')

    expect(events[0]?.name).toBe('docs.changed')
    expect(events[0]?.payload.changesetId).toBeDefined()
    expect(events[0]?.payload.documents[0]?.tombstoned).toBe(false)
    expect(document?.meta.createdBy).toEqual({ kind: 'client', id: 'client-1' })
    expect(document?.meta.ownerExtensionId).toBeUndefined()
  })

  it('projects one data.changed and one docs.changed from the same document commit', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ name: string; payload: { changesetId: string; operations: Array<Record<string, unknown>> } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['data.changed', 'docs.changed'], event => { events.push(event as never) })

    await kernel.callRpc('docs.write', {
      id: 'example.doc:data-commit',
      type: 'example.doc',
      content: { privateText: 'must not enter commit facts' },
      expectedVersion: 'new',
    }, { correlationId: 'corr-data', callId: 'call-data' })

    expect(events.map(event => event.name)).toEqual(['data.changed', 'docs.changed'])
    expect(events[0]?.payload).toMatchObject({
      changesetId: expect.any(String),
      operations: [{
        store: 'documents',
        kind: 'create',
        entityId: 'example.doc:data-commit',
        entityType: 'example.doc',
        toVersion: 1,
      }],
    })
    expect(events[1]?.payload.changesetId).toBe(events[0]?.payload.changesetId)
    expect(JSON.stringify(events)).not.toContain('must not enter commit facts')
  })

  it('continues broadcasting when one event subscriber throws', async () => {
    const { kernel } = createTestKernel()
    const events: string[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], () => {
      throw new Error('broken subscriber')
    })
    kernel.getEventBus().subscribe(['docs.changed'], event => { events.push(event.name) })

    await expect(kernel.callRpc('docs.write', {
      id: 'example.doc:isolated-subscriber',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
    })).resolves.toMatchObject({ changesetId: expect.any(String) })

    expect(events).toEqual(['docs.changed'])
  })

  it('emits docs.changed with call metadata after document deletes through kernel rpc', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ payload: { documents: Array<{ tombstoned: boolean }> }; meta: { correlationId?: string; callId?: string } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => { events.push(event as never) })

    await kernel.callRpc('docs.write', {
      id: 'example.doc:3',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
    }, { correlationId: 'corr-2', callId: 'call-2' })

    await kernel.callRpc('docs.delete', {
      id: 'example.doc:3',
      expectedVersion: 1,
    }, { correlationId: 'corr-3', callId: 'call-3' })

    expect(events).toHaveLength(2)
    expect(events[1]?.payload.documents[0]?.tombstoned).toBe(true)
    expect(events[1]?.meta.correlationId).toBe('corr-3')
    expect(events[1]?.meta.callId).toBe('call-3')
  })

  it('reads and reverts changesets with client call metadata', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{
      name: string
      payload: { targetChangesetId?: string; changesetId?: string }
      meta: { correlationId?: string; callId?: string }
    }> = []
    await kernel.start()
    const created = await kernel.callRpc<{ changesetId: string }>('docs.write', {
      id: 'example.doc:undo',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
    }, { clientId: 'client-create', correlationId: 'corr-create', callId: 'call-create' })
    const read = await kernel.callRpc<{
      changeset: { id: string; createdBy: { kind: string; id: string }; correlationId?: string }
    }>('docs.getChangeset', { changesetId: created.changesetId })
    kernel.getEventBus().subscribe(['docs.*'], event => { events.push(event as never) })

    const reverted = await kernel.callRpc<{ changesetId: string }>('docs.revertChangeset', {
      changesetId: created.changesetId,
      reason: 'undo create',
    }, {
      clientId: 'client-undo',
      correlationId: 'corr-undo',
      callId: 'call-undo',
      parentCallId: 'call-create',
    })
    const revertChangeset = await kernel.getDocumentStore().getChangeset(reverted.changesetId)

    expect(read.changeset).toMatchObject({
      id: created.changesetId,
      createdBy: { kind: 'client', id: 'client-create' },
      correlationId: 'corr-create',
    })
    expect(await kernel.getDocumentStore().get('example.doc:undo')).toBeNull()
    expect(revertChangeset).toMatchObject({
      id: reverted.changesetId,
      createdBy: { kind: 'client', id: 'client-undo' },
      reason: 'undo create',
      correlationId: 'corr-undo',
      callId: 'call-undo',
      parentCallId: 'call-create',
    })
    expect(events.map(event => event.name)).toEqual(['docs.changed', 'docs.rollback.completed'])
    expect(events[1]).toMatchObject({
      payload: {
        targetChangesetId: created.changesetId,
        changesetId: reverted.changesetId,
      },
      meta: { correlationId: 'corr-undo', callId: 'call-undo' },
    })
  })

  it('emits only rollback.failed when revert conflicts', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ name: string; payload: { error?: { code?: string } } }> = []
    await kernel.start()
    const created = await kernel.callRpc<{ changesetId: string }>('docs.write', {
      id: 'example.doc:conflicting-undo',
      type: 'example.doc',
      content: { value: 1 },
      expectedVersion: 'new',
    })
    await kernel.callRpc('docs.write', {
      id: 'example.doc:conflicting-undo',
      type: 'example.doc',
      content: { value: 2 },
      expectedVersion: 1,
    })
    kernel.getEventBus().subscribe(['docs.*'], event => { events.push(event as never) })

    let failure: unknown
    try {
      await kernel.callRpc('docs.revertChangeset', { changesetId: created.changesetId })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({ code: 'document.conflict' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'docs.rollback.failed',
      payload: { error: { code: 'document.conflict' } },
    })
    expect(await kernel.getDocumentStore().get('example.doc:conflicting-undo')).toMatchObject({
      version: 2,
      content: { value: 2 },
    })
  })

  it('serves diagnostics.list as a paged rpc result', async () => {
    const { kernel, diagnostics } = createTestKernel()
    diagnostics.add({ severity: 'info', code: 'test.info', message: 'hello', source: 'test' })
    await kernel.start()

    const result = await kernel.callRpc<{ items: unknown[] }>('diagnostics.list', {})

    expect(result.items).toHaveLength(1)
  })
})

it('chunks large UTF-8 commits and rollback summaries within the registered budget', async () => {
  const { kernel, documents, diagnostics } = createTestKernel()
  await kernel.start()
  const events: Array<{ name: string; payload: any; meta: any }> = []
  kernel.getEventBus().subscribe(['data.changed', 'docs.changed', 'docs.rollback.completed', 'docs.rollback.failed'], event => { events.push(event) })
  const result = await documents.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
    for (let i = 0; i < 1000; i++) await tx.write({ id: `正常\\\"文档-${i}`, type: 'test.note', content: {}, expectedVersion: 'new' })
  })
  for (const name of ['data.changed', 'docs.changed']) {
    const chunks = events.filter(event => event.name === name)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap(event => event.payload.operations)).toHaveLength(1000)
    chunks.forEach((event, index) => {
      expect(event.payload.chunk).toEqual({ index, count: chunks.length })
      expect(Buffer.byteLength(JSON.stringify(event.payload))).toBeLessThanOrEqual(65536)
      expect(event.meta.definitionVersion).toBe(2)
      if (name === 'docs.changed') expect(event.payload.documents.map((doc: any) => doc.id)).toEqual(event.payload.operations.map((op: any) => op.documentId))
    })
  }
  await kernel.callRpc('docs.revertChangeset', { changesetId: result.commit.changesetId })
  const completed = events.filter(event => event.name === 'docs.rollback.completed')
  expect(completed.length).toBeGreaterThan(1)
  expect(completed.flatMap(event => event.payload.operations)).toHaveLength(1000)
  expect(completed.every(event => event.payload.targetChangesetId === result.commit.changesetId && Buffer.byteLength(JSON.stringify(event.payload)) <= 65536)).toBe(true)
  expect(events.some(event => event.name === 'docs.rollback.failed')).toBe(false)
  expect(diagnostics.list()).toHaveLength(0)
})


it('reports notification failure without changing successful revert results or skipping docs projection', async () => {
  const { kernel, diagnostics } = createTestKernel()
  await kernel.start()
  const events = kernel.getEventBus()
  const emit = events.emit.bind(events)
  const delivered: string[] = []
  events.subscribe(['docs.changed', 'docs.rollback.failed'], event => { delivered.push(event.name) })
  const spy = vi.spyOn(events, 'emit').mockImplementation((name, payload, context) => {
    if (name === 'data.changed' || name === 'docs.rollback.completed') throw new Error('notification unavailable')
    return emit(name, payload, context)
  })
  try {
    const created = await kernel.callRpc<{ changesetId: string }>('docs.write', { id: 'test:notify-failure', type: 'test.note', content: {}, expectedVersion: 'new' })
    await expect(kernel.callRpc('docs.revertChangeset', { changesetId: created.changesetId })).resolves.toHaveProperty('changesetId')
    expect(delivered).toEqual(['docs.changed', 'docs.changed'])
    expect(diagnostics.list().every(item => item.code === 'event.commit_notification_failed' && item.message.includes('committed'))).toBe(true)
    expect(diagnostics.list().length).toBeGreaterThan(0)
    expect(await kernel.getDocumentStore().get('test:notify-failure')).toBeNull()
  } finally { spy.mockRestore() }
})
