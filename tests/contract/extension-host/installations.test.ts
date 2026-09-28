import { describe, expect, it } from 'vitest'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { extensionInstallationId, installedExtensionContributionId, type ExtensionInstallationTarget, type ExtensionRpcHandler } from '@loom-studio/extension-sdk'
import { createAgentToolRegistry } from '@loom-studio/application-runtime'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('Extension Host installation identity', () => {
  it('registers same authored Tool handlers under independent installed IDs and disposes only the selected instance', async () => {
    const packageId = 'example.installedTools'
    const authoredId = `${packageId}/read`
    const targets = [{ kind: 'global' as const }, { kind: 'card' as const, cardId: 'A' }, { kind: 'card' as const, cardId: 'B' }]
    const toolIds = targets.map(target => installedExtensionContributionId(packageId, target, authoredId))
    const tools = createAgentToolRegistry(toolIds.map(id => ({
      id, owner: { namespace: packageId }, name: 'read', description: 'Read',
      input: { kind: 'structured', schema: { type: 'object' } },
    })))
    const { extensionHost } = createExtensionHostHarness({
      registerAgentToolHandler: (toolId, _packageId, _moduleId, _instanceId, handler) => tools.registerRuntime({
        toolId,
        execute: async ({ invocation, signal }) => ({
          invocationId: invocation.id, toolId, status: 'completed',
          content: [{ type: 'json', value: await handler({ arguments: {} }, { signal }) }],
        }),
      }),
    })
    const definition = manifest(packageId, [])
    const directory = createExtensionFixture('installation-tools', {
      manifest: {
        ...definition,
        contributes: { agentTools: [{ id: authoredId, source: 'tool.json' }] },
        modules: definition.modules.map(module => ({
          ...module, contributes: { agentToolHandlers: [{ toolId: authoredId }] },
        })),
      },
      source: `export function activate(ctx) { ctx.agentTools.register('${authoredId}', () => ({ instanceId: ctx.extension.instanceId })) }`,
    })
    try {
      const instanceIds = []
      for (const target of targets) {
        await extensionHost.discover(directory, target)
        const activated = await extensionHost.activate(packageId, 'server', target)
        expect(activated.state).toBe('active')
        instanceIds.push(activated.instance!.instanceId)
      }
      for (const [index, toolId] of toolIds.entries()) {
        const result = await tools.execute({
          id: `invoke-${index}`, toolId, arguments: {}, transport: 'native-function',
        }, new AbortController().signal)
        expect(result).toMatchObject({ status: 'completed', content: [{ type: 'json', value: { instanceId: instanceIds[index] } }] })
      }
      await extensionHost.dispose(packageId, 'server', targets[1])
      expect(tools.getRegistration(toolIds[1]!)).toBeUndefined()
      expect(tools.getRegistration(toolIds[0]!)).toBeDefined()
      expect(tools.getRegistration(toolIds[2]!)).toBeDefined()
    } finally {
      await extensionHost.disposeAll()
    }
  })

  it('isolates Config, Record and raw document access even for the same package and storage scope', async () => {
    const packageId = 'example.installedStorage'
    const names = ['config', 'configs', 'record', 'readRecord', 'records', 'updateRecord', 'deleteRecord', 'write', 'read', 'list', 'delete']
    const directory = createExtensionFixture('installation-storage', {
      manifest: manifest(packageId, names.map(name => ({ name: `${packageId}.${name}` })), ['example.installedStorage.note']),
      source: `
export function activate(ctx) {
  const actions = {
    config: input => ctx.storage.configs.upsert(input),
    configs: input => ctx.storage.configs.list(input),
    record: input => ctx.storage.records.create(input),
    readRecord: input => ctx.storage.records.get(input.id),
    records: input => ctx.storage.records.list(input),
    updateRecord: input => ctx.storage.records.update(input),
    deleteRecord: input => ctx.storage.records.delete(input),
    write: input => ctx.documents.write(input),
    read: input => ctx.documents.get(input.id),
    list: input => ctx.documents.list(input),
    delete: input => ctx.documents.delete(input.id),
  }
  for (const [name, handler] of Object.entries(actions)) ctx.rpc.register('example.installedStorage.' + name, handler)
}
`,
    })
    const handlers = new Map<string, ExtensionRpcHandler>()
    const host = createExtensionHost({
      documents: createInMemoryDocumentStore(), diagnostics: createInMemoryDiagnosticsRegistry(),
      callRpc: async () => null,
      validateStorageScope: async () => {},
      registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => {
        const key = `${ownerInstanceId}/${name}`
        handlers.set(key, handler)
        return { name, ownerPackageId, ownerModuleId, handler, dispose: () => { handlers.delete(key) } }
      },
    })
    try {
      const global = { kind: 'global' as const }
      const a = { kind: 'card' as const, cardId: 'A' }
      const b = { kind: 'card' as const, cardId: 'B' }
      const instances = []
      for (const target of [global, a, b]) {
        await host.discover(directory, target)
        instances.push(await host.activate(packageId, 'server', target))
      }
      const call = (index: number, name: string, input: Parameters<ExtensionRpcHandler>[0]) => {
        const instanceId = instances[index]!.instance!.instanceId
        return handlers.get(`${instanceId}/${packageId}.${name}`)!(input, { packageId, moduleId: 'server', instanceId })
      }
      const configInput = { scope: a, key: 'theme', value: 'global-owned' }
      const globalConfig = await call(0, 'config', configInput) as { id: string }
      const localConfig = await call(1, 'config', { ...configInput, value: 'A-owned' }) as { id: string }
      expect(localConfig.id).not.toBe(globalConfig.id)
      expect(await call(0, 'configs', {})).toMatchObject([{ id: globalConfig.id, value: 'global-owned' }])
      expect(await call(1, 'configs', {})).toMatchObject([{ id: localConfig.id, value: 'A-owned' }])
      expect(await call(2, 'configs', {})).toEqual([])
      await expect(call(1, 'config', { ...configInput, scope: global })).rejects.toThrow('outside its Card installation')
      await expect(call(1, 'config', { ...configInput, scope: b })).rejects.toThrow('outside its Card installation')
      const record = await call(1, 'record', { scope: a, recordType: 'memo', data: { text: 'A' } }) as { id: string; version: number }
      expect(await call(1, 'records', {})).toMatchObject([{ id: record.id }])
      for (const index of [0, 2]) {
        expect(await call(index, 'records', {})).toEqual([])
        await expect(call(index, 'readRecord', { id: record.id })).rejects.toThrow('another installation')
        await expect(call(index, 'updateRecord', {
          recordId: record.id, expectedVersion: record.version,
          scope: index === 0 ? { kind: 'global' } : b, recordType: 'memo', data: { overwritten: true },
        })).rejects.toThrow('another installation')
        await expect(call(index, 'deleteRecord', { recordId: record.id, expectedVersion: record.version })).rejects.toThrow('another installation')
      }
      const write = {
        id: 'private-note', type: 'example.installedStorage.note', content: { text: 'A' }, expectedVersion: 'new',
        meta: { ownerExtensionId: 'other.package', ownerInstallationId: 'spoofed' },
      }
      await call(1, 'write', write)
      expect(await call(1, 'list', { type: write.type })).toMatchObject([{ id: write.id }])
      for (const index of [0, 2]) {
        expect(await call(index, 'list', { type: write.type })).toEqual([])
        await expect(call(index, 'read', { id: write.id })).rejects.toThrow('another installation')
        await expect(call(index, 'write', { ...write, expectedVersion: 1 })).rejects.toThrow('another installation')
        await expect(call(index, 'delete', { id: write.id })).rejects.toThrow('another installation')
      }
      expect(await call(1, 'read', { id: write.id })).toMatchObject({ version: 1, content: { text: 'A' } })
      await call(0, 'write', { ...write, id: 'global-note' })
      await expect(call(1, 'read', { id: 'global-note' })).rejects.toThrow('another installation')
    } finally {
      await host.disposeAll()
    }
  })

  it('keeps same-package instances, grants and lifecycle independent across Global and two Cards', async () => {
    const packageId = 'example.installations'
    const directory = createExtensionFixture('installation-lifecycle', {
      manifest: manifest(packageId, []),
      source: `
export async function activate(ctx) {
  await ctx.rpc.call('probe', { instanceId: ctx.extension.instanceId, permissions: ctx.permissions })
}
`,
    })
    const probes: unknown[] = []
    const host = createExtensionHost({
      documents: createInMemoryDocumentStore(),
      diagnostics: createInMemoryDiagnosticsRegistry(),
      grantEventCapabilities: (_, __, target) => target.kind === 'global' ? ['state'] : [],
      grantAssetCapabilities: (_, __, target) => target.kind === 'card' && target.cardId === 'A' ? ['assets.read'] : [],
      callRpc: async (_, params) => { probes.push(params); return null },
      registerRpc: () => { throw new Error('This fixture has no RPC contributions') },
    })
    const global = { kind: 'global' as const }
    const a = { kind: 'card' as const, cardId: 'A' }
    const b = { kind: 'card' as const, cardId: 'B' }
    const targets: ExtensionInstallationTarget[] = [global, a, b]
    try {
      for (const target of targets) await host.discover(directory, target)
      expect(host.list().map(item => item.installationId)).toEqual(targets.map(target => extensionInstallationId(packageId, target)))
      const summaries = []
      for (const target of targets) summaries.push(await host.activate(packageId, 'server', target))
      expect(summaries.map(item => item.state)).toEqual(['active', 'active', 'active'])
      expect(new Set(summaries.map(item => item.instance!.instanceId)).size).toBe(3)
      expect(probes).toEqual([
        { instanceId: summaries[0]!.instance!.instanceId, permissions: { events: { subscribe: ['state'] }, assets: [] } },
        { instanceId: summaries[1]!.instance!.instanceId, permissions: { events: { subscribe: [] }, assets: ['assets.read'] } },
        { instanceId: summaries[2]!.instance!.instanceId, permissions: { events: { subscribe: [] }, assets: [] } },
      ])
      await host.dispose(packageId, 'server', a)
      expect(host.list().map(item => item.state)).toEqual(['active', 'disabled', 'active'])
      const reloaded = await host.reload(packageId, 'server', a)
      expect(reloaded.instance!.instanceId).not.toBe(summaries[1]!.instance!.instanceId)
      expect(host.list()[0]!.instance).toEqual(summaries[0]!.instance)
      expect(host.list()[2]!.instance).toEqual(summaries[2]!.instance)
      await host.forget(packageId, 'server', a)
      expect(host.list().map(item => item.target)).toEqual([global, b])
      await expect(host.discover(directory, b)).rejects.toThrow('Cannot rediscover active extension module')
    } finally {
      await host.disposeAll()
    }
  })
})
