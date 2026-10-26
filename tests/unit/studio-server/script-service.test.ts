import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createScriptService } from '../../../apps/studio-server/src/scripts/script-service.js'

it.each(['remove', 'dispose'] as const)('aborts a streaming dependency on %s without executing stale code', async action => {
  const requested = Promise.withResolvers<void>()
  const disconnected = Promise.withResolvers<void>()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/javascript' })
    response.write('// pending dependency\n')
    response.on('close', () => disconnected.resolve())
    requested.resolve()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const effects: string[] = []
  const marker = `__loom_script_service_${action}_test__`
  Object.defineProperty(globalThis, marker, { value: effects, configurable: true })
  const source = `
    const effects = globalThis[${JSON.stringify(marker)}];
    effects.push('import');
    export function activate(ctx) {
      effects.push('activate');
      ctx.lifecycle.onDispose(() => { effects.push('dispose'); });
    }
  `
  const mount = {
    mountId: 'streaming', mountVersion: 1, enabled: true, orderIndex: 0,
    target: { kind: 'user' as const }, grantedCapabilities: ['runtime.server'], source,
    script: { id: 'streaming-doc', version: 1, name: 'Streaming', metadataId: 'streaming', scriptVersion: '1.0.0',
      runtime: 'server' as const, requestedCapabilities: ['runtime.server'], contributions: [],
      requires: [`http://127.0.0.1:${(server.address() as AddressInfo).port}/dependency.js`] },
  }
  let mounts = [mount]
  // The resolver is the external boundary; service, downloader, ESM and Host remain real.
  const setExecutionStates = vi.fn()
  const runtime = { setLoomScriptExecutionStates: setExecutionStates, resolveLoomScriptRendererMounts: async () => ({ mounts, unavailableMounts: [] }) } as unknown as ApplicationRuntime
  const documents = createInMemoryDocumentStore()
  onTestFinished(() => documents.close())
  const service = createScriptService({ runtime, hostOptions: {
    documents, diagnostics: createInMemoryDiagnosticsRegistry(),
    callRpc: async () => null, registerRpc: () => { throw new Error('Not used') },
  } })
  try {
    const pending = service.resolve()
    await requested.promise
    if (action === 'dispose') {
      await service.dispose()
    } else {
      mounts = []
      expect((await service.resolve()).serverInstances).toEqual([])
    }
    await pending
    await disconnected.promise
    expect(effects).toEqual([])
    expect(setExecutionStates).toHaveBeenLastCalledWith([])
    if (action === 'remove') {
      mounts = [{ ...mount, mountVersion: 2, script: { ...mount.script, requires: [] } }]
      expect((await service.resolve()).serverInstances[0]).toMatchObject({ mountId: mount.mountId, state: 'active', runningDocumentVersion: 1 })
      expect(effects).toEqual(['import', 'activate'])
      expect(setExecutionStates).toHaveBeenLastCalledWith([{ mountId: mount.mountId, revision: 2, active: true }])
      await service.dispose()
      expect(effects).toEqual(['import', 'activate', 'dispose'])
      expect(setExecutionStates).toHaveBeenLastCalledWith([])
    }
  } finally {
    await service.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    Reflect.deleteProperty(globalThis, marker)
  }
})

it('retains readiness for unchanged adoption and revokes it before a replacement activates', async () => {
  const documents = createInMemoryDocumentStore()
  const setExecutionStates = vi.fn()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const marker = '__loom_script_ready_replacement__'
  Object.defineProperty(globalThis, marker, { value: { started, release }, configurable: true })
  const first = {
    mountId: 'ready', mountVersion: 1, enabled: true, orderIndex: 0,
    grantedCapabilities: ['runtime.server'], source: 'export function activate() {}',
    script: { id: 'ready-doc', version: 1, name: 'Ready', metadataId: 'ready', scriptVersion: '1.0.0',
      runtime: 'server' as const, requestedCapabilities: ['runtime.server'], contributions: [] },
  }
  let current = first
  const runtime = { setLoomScriptExecutionStates: setExecutionStates,
    resolveLoomScriptRendererMounts: async () => ({ mounts: [current], unavailableMounts: [] }),
  } as unknown as ApplicationRuntime
  const service = createScriptService({ runtime, hostOptions: {
    documents, diagnostics: createInMemoryDiagnosticsRegistry(),
    callRpc: async () => null, registerRpc: () => { throw new Error('Not used') },
  } })
  try {
    await service.resolve()
    setExecutionStates.mockClear()
    await service.resolve()
    expect(setExecutionStates.mock.calls.length).toBeGreaterThan(0)
    for (const [states] of setExecutionStates.mock.calls) expect(states).toEqual([{ mountId: first.mountId, revision: 1, active: true }])
    current = { ...first, mountVersion: 2,
      source: `export async function activate() { const gate = globalThis[${JSON.stringify(marker)}]; gate.started.resolve(); await gate.release.promise; }`,
    }
    const replacing = service.resolve()
    await started.promise
    expect(setExecutionStates).toHaveBeenLastCalledWith([])
    release.resolve()
    await replacing
    expect(setExecutionStates).toHaveBeenLastCalledWith([{ mountId: first.mountId, revision: 2, active: true }])
  } finally { release.resolve(); await service.dispose(); await documents.close(); Reflect.deleteProperty(globalThis, marker) }
})
