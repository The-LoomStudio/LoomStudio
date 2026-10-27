import { createExtensionHostHarness as createKernelHarness } from '../../contract/extension-host/helpers.js'
import { createKernelBridge } from '../../support/kernel-bridge.js'
import type { StudioEvent } from '@loom-studio/extension-sdk'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('platform capability integration smoke', () => {
  it('runs the headless client path across kernel, documents, extension rpc, and diagnostics', async () => {
    const { kernel, extensionHost } = createKernelHarness({
      registerStateContribution: () => ({ dispose() {} }),
      registerMacroProvider: () => ({ dispose() {} }),
    })
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed', 'diagnostics.updated'], (event: StudioEvent) => { events.push(event) })
    await extensionHost.discover(join(process.cwd(), 'tests/fixtures/extensions/echo'))
    await extensionHost.activate('example.echo', 'server')
    const bridge = createKernelBridge(kernel)

    const introspect = await bridge.call<{ methods: Array<{ name: string; owner: string }>; events: string[] }>('system.introspect')
    const writeResult = await bridge.call<{ documents: Array<{ id: string; content: { ok: boolean } }> }>('docs.write', {
      id: 'platform-smoke:doc',
      type: 'example.platform-smoke.note',
      content: { ok: true },
      expectedVersion: 'new',
    })
    const documents = await bridge.call<{ items: Array<{ id: string; content: { ok: boolean } }> }>('docs.list', { type: 'example.platform-smoke.note' })
    const echo = await bridge.call<{ packageId: string; moduleId: string; echo: { message: string } }>('example.echo.echo', { message: 'platform-smoke' })
    const extensions = await bridge.call<{ items: Array<{ packageId: string; moduleId: string; state: string }> }>('extensions.listPackages')
    expect(extensions.items).toContainEqual(expect.objectContaining({ packageId: 'example.echo', moduleId: 'server', state: 'active' }))
    await extensionHost.dispose('example.echo', 'server')
    const diagnostics = await bridge.call<{ items: Array<{ code: string }> }>('diagnostics.list')

    expect(introspect.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo/server' })
    expect(introspect.methods).toContainEqual({ name: 'system.ping', owner: 'kernel' })
    expect(introspect.events).toContain('docs.changed')
    expect(introspect.events).toContain('diagnostics.updated')
    expect(writeResult.documents[0]).toMatchObject({ id: 'platform-smoke:doc', content: { ok: true } })
    expect(documents.items[0]).toMatchObject({ id: 'platform-smoke:doc', content: { ok: true } })
    expect(events.some(event => event.name === 'docs.changed')).toBe(true)
    expect(echo).toEqual({ packageId: 'example.echo', moduleId: 'server', echo: { message: 'platform-smoke' } })
    expect(diagnostics.items.some(diagnostic => diagnostic.code === 'example.echo.disposed')).toBe(true)
  })

  it('keeps runtime/provider/chat methods out of the kernel surface', async () => {
    const { kernel } = createKernelHarness()
    await kernel.start()
    const surface = JSON.stringify(kernel.getPublicSurface())

    expect(surface).not.toContain('chat.send')
    expect(surface).not.toContain('provider.invoke')
  })
})
