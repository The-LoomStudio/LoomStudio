import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost, parseExtensionManifest, type ExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import type { JsonValue } from '@loom-studio/shared'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function createHarness() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerExtensionId, handler) => {
      const handle = kernel.registerExtensionRpc(name, ownerExtensionId, handler)
      return { name, ownerExtensionId, handler, dispose: handle.dispose }
    },
    emitEvent: (name, payload, ownerExtensionId) => {
      kernel.getEventBus().emit(name, payload, { source: `extension:${ownerExtensionId}` })
    },
    emitDocumentChange: (result, ownerExtensionId) => {
      kernel.getEventBus().emit('docs.changed', summarizeDocumentChange(result), { source: `extension:${ownerExtensionId}` })
    },
  })

  kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, extensionHost, diagnostics, documents }
}

describe('stage 3 extension host', () => {
  it('validates required manifest fields', () => {
    expect(() => parseExtensionManifest({ manifestVersion: 1 })).toThrow('Manifest id is required')
  })

  it('activates example.echo and serves extension rpc', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    const summary = await extensionHost.activate('example.echo')

    const result = await kernel.callRpc<{ extensionId: string; echo: JsonValue }>('example.echo.echo', { message: 'hello' })

    expect(summary.state).toBe('active')
    expect(result).toEqual({ extensionId: 'example.echo', echo: { message: 'hello' } })
    expect(extensionHost.list()[0]?.state).toBe('active')
  })

  it('reports extension rpc ownership through system.introspect', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    await extensionHost.activate('example.echo')

    const result = await kernel.callRpc<{ methods: Array<{ name: string; owner: string }> }>('system.introspect')

    expect(result.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo' })
  })

  it('rejects extension registration into Kernel namespace', async () => {
    const { kernel } = createHarness()
    await kernel.start()

    expect(() => kernel.registerExtensionRpc('system.bad', 'example.bad', () => null)).toThrow('Kernel namespace')
  })

  it('marks duplicate rpc registration activation as disabled', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    kernel.registerExtensionRpc('example.conflict.echo', 'owner.one', () => null)
    const dir = createExtensionFixture('conflict-extension', {
      manifest: manifest('example.conflict', [{ name: 'example.conflict.echo' }]),
      source: `export function activate(ctx) { ctx.rpc.register('example.conflict.echo', () => null) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.conflict')

    expect(summary.state).toBe('disabled')
    expect(extensionHost.diagnostics('example.conflict').some(diagnostic => diagnostic.code === 'extension.activation_failed')).toBe(true)
  })

  it('marks undeclared runtime rpc registration as degraded with diagnostics', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    const dir = createExtensionFixture('undeclared-extension', {
      manifest: manifest('example.undeclared', []),
      source: `export function activate(ctx) { ctx.rpc.register('example.undeclared.echo', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.undeclared')

    expect(summary.state).toBe('degraded')
    expect(extensionHost.diagnostics('example.undeclared').some(diagnostic => diagnostic.code === 'extension.rpc_not_declared')).toBe(true)
  })

  it('writes extension-owned documents through activation context', async () => {
    const { kernel, extensionHost, documents } = createHarness()
    await kernel.start()
    const dir = createExtensionFixture('document-extension', {
      manifest: manifest('example.documents', [{ name: 'example.documents.ping' }]),
      source: `export async function activate(ctx) { await ctx.documents.write({ id: 'example.documents:1', type: 'example.documents.note', content: { ok: true }, expectedVersion: 'new' }); ctx.rpc.register('example.documents.ping', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.documents')
    const document = await documents.get('example.documents:1')

    expect(document?.meta.ownerExtensionId).toBe('example.documents')
    expect(document?.meta.createdBy).toEqual({ kind: 'extension', id: 'example.documents' })
  })

  it('emits docs.changed for extension-owned document writes', async () => {
    const { kernel, extensionHost } = createHarness()
    const events: JsonValue[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event as unknown as JsonValue))
    const dir = createExtensionFixture('document-event-extension', {
      manifest: manifest('example.documentEvents', [{ name: 'example.documentEvents.ping' }]),
      source: `export async function activate(ctx) { await ctx.documents.write({ id: 'example.documentEvents:1', type: 'example.documentEvents.note', content: { ok: true }, expectedVersion: 'new' }); ctx.rpc.register('example.documentEvents.ping', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.documentEvents')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'docs.changed',
      payload: {
        documents: [{ id: 'example.documentEvents:1', type: 'example.documentEvents.note', version: 1, tombstoned: false }],
      },
      meta: { source: 'extension:example.documentEvents' },
    })
  })

  it('cleans partial rpc registrations after activation failure', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    const dir = createExtensionFixture('partial-failure-extension', {
      manifest: manifest('example.partialFailure', [{ name: 'example.partialFailure.echo' }]),
      source: `export function activate(ctx) { ctx.rpc.register('example.partialFailure.echo', () => ({ ok: true })); throw new Error('boom') }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.partialFailure')

    expect(summary.state).toBe('disabled')
    await expect(kernel.callRpc('example.partialFailure.echo', {})).rejects.toThrow('method not found')
  })

  it('dispose cleans extension rpc registrations', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    await extensionHost.activate('example.echo')

    await extensionHost.dispose('example.echo')

    await expect(kernel.callRpc('example.echo.echo', {})).rejects.toThrow('method not found')
  })
})

function createExtensionFixture(name: string, input: { manifest: unknown; source: string }): string {
  const root = join(process.cwd(), '.loomstudio-dev/test-extensions', name)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(input.manifest))
  writeFileSync(join(root, 'dist/index.js'), input.source)
  return root
}

function manifest(id: string, rpc: Array<{ name: string }>) {
  return {
    manifestVersion: 1,
    id,
    version: '0.0.0',
    displayName: id,
    engines: { studio: '^0.1.0' },
    server: { entry: './dist/index.js' },
    contributes: { rpc },
  }
}

function summarizeDocumentChange(result: { changesetId: string; operations: unknown; documents: Array<{ id: string; type: string; version: number; meta: { tombstone?: unknown } }> }): JsonValue {
  return {
    changesetId: result.changesetId,
    operations: result.operations as JsonValue,
    documents: result.documents.map(document => ({
      id: document.id,
      type: document.type,
      version: document.version,
      tombstoned: Boolean(document.meta.tombstone),
    })),
  }
}
