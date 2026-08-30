import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import type { LoomRunner } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { describe, expect, it } from 'vitest'

function createTestKernel() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const traceAudit = createInMemoryTraceAuditStore()
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
  const loomRunner: LoomRunner = {
    run: async input => ({ fragments: input.fragments }),
  }
  const kernel = createKernel({
    documents,
    dataCommits: createDocumentDataCommitSource(documents),
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
  })

  return { kernel, documents, diagnostics, traceAudit }
}

describe('kernel rpc contract', () => {
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
    const { kernel, documents, diagnostics, traceAudit } = createTestKernel()

    expect(kernel.getDocumentStore()).toBe(documents)
    expect(kernel.getDiagnostics()).toBe(diagnostics)
    expect(kernel.getTraceAudit()).toBe(traceAudit)
  })

  it('emits docs.changed after document writes through kernel rpc', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ name: string; payload: { changesetId: string; documents: Array<{ tombstoned: boolean }> } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event as never))

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
    kernel.getEventBus().subscribe(['data.changed', 'docs.changed'], event => events.push(event as never))

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
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event.name))

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
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event as never))

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
    kernel.getEventBus().subscribe(['docs.*'], event => events.push(event as never))

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
    kernel.getEventBus().subscribe(['docs.*'], event => events.push(event as never))

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
