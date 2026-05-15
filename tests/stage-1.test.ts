import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import type { LoomRunner } from '@loom-studio/loom-runner'
import { createErrorResponse, parseRpcRequest } from '@loom-studio/transport'
import { describe, expect, it } from 'vitest'

function createTestKernel() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const extensionHost: ExtensionHost = {
    list: () => [],
    diagnostics: () => [],
  }
  const loomRunner: LoomRunner = {
    run: async input => ({ fragments: input.fragments }),
  }
  const kernel = createKernel({
    documents,
    diagnostics,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, documents, diagnostics }
}

describe('stage 1 kernel rpc', () => {
  it('registers and calls system.ping', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ ok: true; echo: string }>('system.ping', { echo: 'hello' })

    expect(result.ok).toBe(true)
    expect(result.echo).toBe('hello')
  })

  it('returns minimal system info without business runtime capabilities', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ capabilities: { documents: boolean; loomRun: boolean } }>('system.getInfo', {})

    expect(result.capabilities.documents).toBe(true)
    expect(result.capabilities.loomRun).toBe(false)
    expect(JSON.stringify(result)).not.toContain('chat')
    expect(JSON.stringify(result)).not.toContain('provider')
  })

  it('exposes system.introspect', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ methods: Array<{ name: string }>; events: string[] }>('system.introspect', {})

    expect(result.methods.some(method => method.name === 'system.introspect')).toBe(true)
    expect(result.methods.some(method => method.name === 'docs.write')).toBe(true)
    expect(result.events).toContain('docs.changed')
  })

  it('rejects non-kernel namespace registration', () => {
    const { kernel } = createTestKernel()

    expect(() => kernel.registerKernelRpc('chat.send', () => ({}))).toThrow('Not a Kernel namespace')
  })
})

describe('stage 1 document store', () => {
  it('creates, updates, lists, and tombstones documents', async () => {
    const documents = createInMemoryDocumentStore()
    const created = await documents.write({
      id: 'example.doc:1',
      type: 'example.doc',
      content: { value: 'a' },
      expectedVersion: 'new',
    })

    expect(created.documents[0]?.version).toBe(1)

    const updated = await documents.write({
      id: 'example.doc:1',
      type: 'example.doc',
      content: { value: 'b' },
      expectedVersion: 1,
    })

    expect(updated.documents[0]?.version).toBe(2)

    const listed = await documents.list({ type: 'example.doc' })
    expect(listed.items).toHaveLength(1)

    await documents.delete({ id: 'example.doc:1', expectedVersion: 2 })

    const afterDelete = await documents.list({ type: 'example.doc' })
    expect(afterDelete.items).toHaveLength(0)

    const tombstones = await documents.list({ type: 'example.doc', includeTombstone: true })
    expect(tombstones.items[0]?.meta.tombstone).toBeDefined()
  })

  it('emits docs.changed when writing through kernel rpc', async () => {
    const { kernel } = createTestKernel()
    const events: string[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event.name))

    await kernel.callRpc('docs.write', {
      id: 'example.doc:2',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
    })

    expect(events).toEqual(['docs.changed'])
  })
})

describe('stage 1 transport helpers', () => {
  it('parses rpc request and serializes invalid request errors', () => {
    const request = parseRpcRequest({ jsonrpc: '2.0', id: '1', method: 'system.ping', params: {} })
    expect(request.method).toBe('system.ping')

    const response = createErrorResponse(null, new Error('bad'), 'rpc.invalid_request')
    expect(response.error?.code).toBe('rpc.invalid_request')
    expect(response.error?.message).toBe('bad')
  })
})
