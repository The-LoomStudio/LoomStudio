import { createExtensionHost, type ExtensionHostOptions, type ExtensionModuleSummary } from '@loom-studio/extension-host'
import type { Diagnostic } from '@loom-studio/diagnostics'
import type { EventCapabilityCategory, ExtensionInstallationTarget, ExtensionModuleManifest, ServerExtensionModule } from '@loom-studio/extension-sdk'

/** These capabilities reuse the existing host context and its scope cleanup. */
export const serverScriptCapabilities = [
  'runtime.server', 'assets.publish', 'assets.read', 'ai.invoke', 'macros.provide',
  'prompt.process', 'narrative.context.provide', 'state.contribute', 'state.read',
  'state.write', 'state.processContent',
] as const

export type ServerScriptRun = {
  mountId: string
  mountVersion?: number
  target?: ExtensionInstallationTarget
  grantedCapabilities: readonly string[]
  script: {
    id: string
    version: number
    name: string
    metadataId: string
    scriptVersion: string
    runtime: string
    requestedCapabilities: readonly string[]
    contributions: readonly unknown[]
    requires?: readonly string[]
  }
  /** Prepared ESM source; dependency preparation belongs to the caller. */
  source: string
}

export type ServerScriptInstanceSummary = {
  mountId: string
  scriptDocumentId: string
  metadataId: string
  packageId: string
  runtime: 'server'
  runningDocumentVersion?: number
  instanceId?: string
  state: 'active' | 'degraded' | 'failed' | 'unavailable'
  diagnostics: Diagnostic[]
}

type RunningScript = {
  signature: string
  run: ServerScriptRun
  summary: ServerScriptInstanceSummary
  module?: ExtensionModuleSummary
}

export function createServerScriptRuntime(options: { hostOptions: ExtensionHostOptions; prepareSource?(run: ServerScriptRun, signal: AbortSignal): Promise<string> }) {
  const running = new Map<string, RunningScript>()
  const loading = new Map<string, { signature: string; controller: AbortController }>()
  let desired = new Map<string, ServerScriptRun>()
  let closed = false
  let pending: Promise<unknown> = Promise.resolve()
  const host = createExtensionHost({
    ...options.hostOptions,
    // Script grants come from the mount, never from extension package defaults.
    grantEventCapabilities: (_manifest, module) => module.capabilities?.['events.subscribe'] ?? [],
    grantAssetCapabilities: (_manifest, module) => (['assets.publish', 'assets.read'] as const)
      .filter(capability => module.capabilities?.[capability] === true),
  })

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work)
    pending = next.catch(() => {})
    return next
  }

  function diagnostic(run: ServerScriptRun, code: string, message: string): Diagnostic {
    return options.hostOptions.diagnostics.add({
      severity: 'error', code, message, source: 'script-runtime',
      packageId: packageId(run), moduleId: run.mountId, documentId: run.script.id,
      details: { mountId: run.mountId, scriptDocumentId: run.script.id },
    })
  }

  function isCurrent(run: ServerScriptRun): boolean {
    const next = desired.get(run.mountId)
    return !closed && next !== undefined && identity(next) === identity(run)
  }

  function cancelObsoleteLoads(): void {
    for (const [mountId, load] of loading) {
      const next = desired.get(mountId)
      if (closed || !next || identity(next) !== load.signature) {
        load.controller.abort(new DOMException('Script mount is no longer active', 'AbortError'))
      }
    }
  }

  async function start(run: ServerScriptRun): Promise<void> {
    if (!isCurrent(run)) return
    const entry: RunningScript = {
      signature: identity(run), run,
      summary: {
        mountId: run.mountId, scriptDocumentId: run.script.id, metadataId: run.script.metadataId,
        packageId: packageId(run), runtime: 'server', state: 'unavailable', diagnostics: [],
      },
    }
    running.set(run.mountId, entry)
    const capabilities = run.script.requestedCapabilities.filter(value => run.grantedCapabilities.includes(value))
    if (run.script.runtime !== 'server' || !capabilities.includes('runtime.server')) {
      entry.summary.diagnostics.push(diagnostic(run, 'script.runtime_unavailable',
        'Server scripts require runtime server and an explicit runtime.server mount grant'))
      return
    }
    const unsupported = capabilities.filter(value => !serverScriptCapabilities.includes(value as typeof serverScriptCapabilities[number])
      && !eventCapability(value))
    if (unsupported.length) {
      entry.summary.diagnostics.push(diagnostic(run, 'script.capability_unavailable',
        `Server script capabilities are unavailable in this host: ${unsupported.join(', ')}`))
      return
    }

    const moduleCapabilities: NonNullable<ExtensionModuleManifest['capabilities']> = {}
    for (const capability of capabilities) {
      if (capability !== 'runtime.server' && !capability.startsWith('events.subscribe:')) moduleCapabilities[capability] = true
    }
    moduleCapabilities['events.subscribe'] = capabilities.flatMap(value => {
      const category = eventCapability(value)
      return category ? [category] : []
    })
    const controller = new AbortController()
    loading.set(run.mountId, { signature: entry.signature, controller })
    const assertCurrent = () => {
      controller.signal.throwIfAborted()
      if (!isCurrent(run)) throw new DOMException('Script mount is no longer active', 'AbortError')
    }
    try {
      host.registerModule({
        manifest: {
          manifestVersion: 2, id: packageId(run), version: run.script.scriptVersion,
          displayName: run.script.name, engines: { studio: '*' },
          modules: [{ id: run.mountId, entry: 'script.mjs', runtime: 'server', capabilities: moduleCapabilities }],
        },
        moduleId: run.mountId,
        target: run.target,
        load: async instanceId => {
          // ponytail: Node ESM retains loaded modules; a service restart releases old versions.
          assertCurrent()
          const source = options.prepareSource ? await options.prepareSource(run, controller.signal) : run.source
          assertCurrent()
          const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${instanceId}`
          const loaded = await import(/* @vite-ignore */ url) as Partial<ServerExtensionModule>
          if (typeof loaded.activate !== 'function') throw new Error('Server Script must export activate(ctx)')
          return { activate: context => { assertCurrent(); return loaded.activate!(context) } }
        },
      })
      const module = await host.activate(packageId(run), run.mountId, run.target)
      entry.module = module
      entry.summary.instanceId = module.instance?.instanceId
      entry.summary.state = module.instance?.state === 'active' || module.instance?.state === 'degraded'
        ? module.instance.state : 'failed'
      if (entry.summary.state !== 'failed') entry.summary.runningDocumentVersion = run.script.version
      entry.summary.diagnostics = host.diagnostics(packageId(run), run.mountId)
        .filter(item => item.instanceId === module.instance?.instanceId)
    } catch (error) {
      entry.summary.state = 'failed'
      entry.summary.diagnostics.push(diagnostic(run, 'script.activation_failed', errorMessage(error)))
    } finally {
      loading.delete(run.mountId)
    }
  }

  async function stop(entry: RunningScript): Promise<void> {
    try {
      await host.forget(packageId(entry.run), entry.run.mountId, entry.run.target)
      running.delete(entry.run.mountId)
    } catch (error) {
      entry.summary.state = 'failed'
      entry.summary.diagnostics.push(diagnostic(entry.run, 'script.dispose_failed', errorMessage(error)))
      throw error
    }
  }

  const list = (): ServerScriptInstanceSummary[] => [...running.values()].map(entry => {
    const diagnostics = entry.module?.instance
      ? [...entry.summary.diagnostics.filter(item => item.source === 'script-runtime'),
        ...host.diagnostics(packageId(entry.run), entry.run.mountId).filter(item => item.instanceId === entry.module!.instance!.instanceId)]
      : entry.summary.diagnostics
    return structuredClone({ ...entry.summary, diagnostics })
  })

  return {
    reconcile(runs: readonly ServerScriptRun[]): Promise<ServerScriptInstanceSummary[]> {
      if (closed) return Promise.reject(new Error('Server Script runtime is disposed'))
      desired = new Map(structuredClone(runs).map(run => [run.mountId, run]))
      cancelObsoleteLoads()
      return serialize(async () => {
        if (closed) return []
        const errors: unknown[] = []
        for (const [mountId, entry] of running) {
          const next = desired.get(mountId)
          if (!next || identity(next) !== entry.signature) {
            try { await stop(entry) } catch (error) { errors.push(error) }
          }
        }
        if (errors.length) throw new AggregateError(errors, 'Server Script cleanup failed')
        for (const run of desired.values()) if (!running.has(run.mountId)) await start(run)
        return list()
      })
    },
    refresh(mountId: string): Promise<ServerScriptInstanceSummary | undefined> {
      loading.get(mountId)?.controller.abort(new DOMException('Script mount is refreshing', 'AbortError'))
      return serialize(async () => {
        if (closed) throw new Error('Server Script runtime is disposed')
        const run = desired.get(mountId)
        if (!run) return undefined
        const previous = running.get(mountId)
        if (previous) await stop(previous)
        await start(run)
        return list().find(entry => entry.mountId === mountId)
      })
    },
    list,
    dispose(): Promise<void> {
      closed = true
      desired.clear()
      cancelObsoleteLoads()
      return serialize(async () => {
        try {
          await host.disposeAll()
        } finally {
          running.clear()
        }
      })
    },
  }
}

function packageId(run: ServerScriptRun): string {
  return `script.${run.script.id}`
}

function identity(run: ServerScriptRun): string {
  // Saved source/version changes are adopted only by explicit refresh.
  return JSON.stringify([run.mountId, run.mountVersion, run.script.id, run.target ?? { kind: 'global' },
    [...new Set(run.grantedCapabilities)].sort()])
}

function eventCapability(value: string): EventCapabilityCategory | undefined {
  if (!value.startsWith('events.subscribe:')) return undefined
  const category = value.slice('events.subscribe:'.length)
  if (['documents', 'narrative', 'agent', 'diagnostics', 'platform-data', 'state'].includes(category)
    || (category.startsWith('extension:') && category.length > 'extension:'.length)) return category as EventCapabilityCategory
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
