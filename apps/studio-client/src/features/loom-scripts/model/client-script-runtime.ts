import { createScriptConfigClient } from '@loom-studio/extension-sdk'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { ClientExtensionActivationContext, ClientExtensionModule, ClientNotification, RegisteredClientBackground } from '@loom-studio/extension-sdk'
import type { ExtensionHostLogWriter } from '@loom-studio/logging'
import type { ResolvedLoomScriptRendererMount, ManagedClientExtensionPackage } from '../../../entities/index.js'
import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { createClientExtensionHost, type ClientExtensionDataApi } from '../../extension-renderers/model/client-extension-host.js'
import { createRendererSessionHost } from '../../extension-renderers/model/renderer-session.js'
import { prepareScriptSource } from '../runtime/prepare-script-source.js'
import { createClientWorkerModule } from '../../../shared/worker-runtime/client-worker-module.js'

export type ClientScriptRuntimeOptions = {
  rendererHost: ClientRendererHost
  configs?: Pick<StudioApi['loomScripts'], 'listConfigs' | 'upsertConfig'>
  data: ClientExtensionDataApi
  logger?: ExtensionHostLogWriter
  listBackgrounds?(): readonly RegisteredClientBackground[]
  notify?(owner: string, notification: ClientNotification): void
  loadSource?(source: string, signal: AbortSignal): Promise<Partial<ClientExtensionModule> & { default?: ClientExtensionModule }>
}
type ScriptSource = { mount: ResolvedLoomScriptRendererMount; fingerprint: string; controller: AbortController }

export function createClientScriptRuntime(options: ClientScriptRuntimeOptions) {
  const sources = new Map<string, ScriptSource>()
  const sessionHost = createRendererSessionHost(options.rendererHost)
  const host = createClientExtensionHost({
    rendererHost: options.rendererHost,
    sessionHost,
    data: options.data,
    logger: options.logger,
    notify: options.notify,
    loadModule: async entryUrl => {
      const entry = sources.get(entryUrl)
      if (!entry) throw new Error('Loom Script instance is no longer active')
      assertAuthorized(entry.mount)
      const { signal } = entry.controller
      const source = await prepareScriptSource(entry.mount.source, entry.mount.script.requires ?? [], signal)
      signal.throwIfAborted()
      let module: ClientExtensionModule | undefined
      if (entry.mount.script.runtime === 'client-worker') {
        module = createClientWorkerModule({ source })
      } else {
        const loaded = await (options.loadSource ?? importScriptSource)(source, signal)
        module = loaded.activate ? loaded as ClientExtensionModule : loaded.default
      }
      signal.throwIfAborted()
      if (!module?.activate) throw new Error('Loom Script must export activate(ctx)')
      return { activate: context => module.activate(scriptContext(context, entry.mount, options.rendererHost, options.listBackgrounds, options.configs)) }
    },
  })
  return {
    host,
    reconcile(mounts: readonly ResolvedLoomScriptRendererMount[], developmentSources?: ReadonlyMap<string, string>) {
      const desired = new Set<string>()
      const packages: ManagedClientExtensionPackage[] = []
      for (const adoptedMount of mounts) {
        const override = developmentSources?.get(adoptedMount.mountId)
        // Development edits replace code only; metadata/grant changes still use normal save/adoption.
        if (override !== undefined && override.split('// ==/LoomScript==')[0] !== adoptedMount.source.split('// ==/LoomScript==')[0]) {
          throw new Error('开发热更新不支持修改 Metadata；请关闭联调后保存并重新采用脚本')
        }
        const mount = override === undefined ? adoptedMount : { ...adoptedMount, source: override }
        if (!mount.enabled || (mount.script.runtime !== 'client' && mount.script.runtime !== 'client-worker')) continue
        const entryUrl = `loom-script:${mount.mountId}`
        desired.add(entryUrl)
        const fingerprint = JSON.stringify([mount.script.id, mount.mountVersion ?? 0, [...mount.grantedCapabilities].sort(), override ?? null])
        let entry = sources.get(entryUrl)
        if (entry?.fingerprint !== fingerprint) {
          entry?.controller.abort()
          entry = { mount: structuredClone(mount), fingerprint, controller: new AbortController() }
          sources.set(entryUrl, entry)
        }
        const running = entry.mount
        const packageId = `script.${running.script.id}`
        packages.push({
          packageId,
          version: String(running.mountVersion ?? 0),
          displayName: running.script.name,
          ...(running.target?.kind === 'card' ? { target: { kind: 'card' as const, cardId: running.target.cardId } } : {}),
          tags: [], available: true, sourceKinds: ['script'],
          modules: [{
            packageId, moduleId: running.mountId, runtimeKind: running.script.runtime === 'client-worker' ? 'client-worker' : 'client', entryUrl,
            reloadId: fingerprint,
            requestedUiCapabilities: running.script.requestedCapabilities.includes('ui.notify') ? ['ui.notify'] : [],
            desired: { enabled: true, grants: { ui: running.grantedCapabilities.includes('ui.notify') ? ['ui.notify'] : [] } },
            contributions: { renderers: running.script.contributions.filter(item => item.kind === 'renderer').map(item => ({ ...item.renderer })) },
          }],
        })
      }
      for (const [key, entry] of sources) {
        if (desired.has(key)) continue
        entry.controller.abort()
        sources.delete(key)
      }
      return host.reconcile(packages)
    },
    async dispose() {
      for (const entry of sources.values()) entry.controller.abort()
      sources.clear()
      await host.dispose()
      sessionHost.dispose()
    },
  }
}

function assertAuthorized(mount: ResolvedLoomScriptRendererMount) {
  const runtimeCapability = `runtime.${mount.script.runtime}`
  if (!mount.grantedCapabilities.includes(runtimeCapability)) throw new Error(`Loom Script ${runtimeCapability} is not granted`)
  const missing = mount.script.requestedCapabilities.filter(capability => !mount.grantedCapabilities.includes(capability))
  if (missing.length) throw new Error(`Loom Script capabilities are not granted: ${missing.join(', ')}`)
  const supported = new Set([runtimeCapability, 'state.read', 'events.subscribe:state', 'ui.notify', 'narrative.read', 'assets.read', 'configs.read', 'configs.write'])
  const unsupported = mount.script.requestedCapabilities.filter(capability => !supported.has(capability))
  if (unsupported.length) throw new Error(`Loom Script Client Host does not support: ${unsupported.join(', ')}`)
}

function scriptContext(context: ClientExtensionActivationContext, mount: ResolvedLoomScriptRendererMount, rendererHost: ClientRendererHost, listBackgrounds?: ClientScriptRuntimeOptions['listBackgrounds'], configs?: ClientScriptRuntimeOptions['configs']): ClientExtensionActivationContext {
  function requireCapability(capability: string) {
    context.signal.throwIfAborted()
    if (!mount.script.requestedCapabilities.includes(capability) || !mount.grantedCapabilities.includes(capability)) {
      throw new Error(`Loom Script capability is not granted: ${capability}`)
    }
  }
  function unavailable(): never { throw new Error('This Client API requires an installed Extension Package and is unavailable to Loom Scripts') }
  function assertHistory(source: Parameters<ClientExtensionActivationContext['history']['project']>[0]['source']) {
    requireCapability('narrative.read')
    const scope = rendererHost.scopeSnapshot()
    if (source.kind === 'narrative' ? source.timelineId !== scope.timelineId || source.branchId !== scope.branchId : source.sessionId !== scope.agentSessionId) {
      throw new Error('Loom Script history target is outside the current context')
    }
  }
  return {
    ...context,
    scriptSettings: Object.freeze(structuredClone(mount.settings ?? {})),
    timeline: { get target() {
      context.signal.throwIfAborted()
      const scope = rendererHost.scopeSnapshot()
      return scope.timelineId && scope.branchId ? Object.freeze({ scope: 'timeline' as const, timelineId: scope.timelineId, branchId: scope.branchId }) : undefined
    } },
    state: {
      get: target => { requireCapability('state.read'); return context.state.get(target) },
      subscribe: (target, handler, onError) => { requireCapability('state.read'); return context.state.subscribe(target, handler, onError) },
    },
    history: {
      project: async input => { const query = structuredClone(input); assertHistory(query.source); const result = await context.history.project(query); assertHistory(query.source); return result },
      extract: async input => { const query = structuredClone(input); assertHistory(query.source); const result = await context.history.extract(query); assertHistory(query.source); return result },
    },
    assets: { url: assetId => { requireCapability('assets.read'); return `/assets/${encodeURIComponent(assetId)}` } },
    configs: configs ? createScriptConfigClient({
      signal: context.signal,
      defaultScope: () => {
        const scope = rendererHost.scopeSnapshot()
        return scope.timelineId ? { kind: 'timeline', timelineId: scope.timelineId } : scope.cardId ? { kind: 'card', cardId: scope.cardId } : { kind: 'global' }
      },
      assertScope: (target, write) => {
        requireCapability(write ? 'configs.write' : 'configs.read')
        const scope = rendererHost.scopeSnapshot()
        if (target.kind === 'card' && target.cardId !== scope.cardId
          || target.kind === 'timeline' && target.timelineId !== scope.timelineId
          || target.kind === 'agent-session' && target.agentSessionId !== scope.agentSessionId) throw new Error('Config target is outside the current Script context')
      },
      list: scope => configs.listConfigs({ mountId: mount.mountId, runtimeRevision: mount.mountVersion ?? 0, scope }),
      upsert: query => configs.upsertConfig({ ...query, mountId: mount.mountId, runtimeRevision: mount.mountVersion ?? 0 }),
      onError: error => {
        context.logger.error('Script Config subscription stopped', {
          event: 'script.config.subscription_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      },
    }) : { list: unavailable, get: unavailable, upsert: unavailable, subscribe: unavailable },
    records: { list: unavailable, get: unavailable },
    imports: { commit: unavailable },
    rpc: { call: unavailable },
    files: { url: unavailable },
    backgrounds: {
      register: unavailable,
      list: () => {
        requireCapability('assets.read')
        if (!listBackgrounds) throw new Error('Background resource catalog is unavailable')
        const cardId = rendererHost.scopeSnapshot().cardId
        return listBackgrounds().filter(background => background.target?.kind !== 'card' || background.target.cardId === cardId)
          .map(background => structuredClone(background))
      },
      activate: unavailable,
    },
  }
}

async function importScriptSource(source: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try {
    return await import(/* @vite-ignore */ url) as Partial<ClientExtensionModule> & { default?: ClientExtensionModule }
  } finally { URL.revokeObjectURL(url) }
}
