import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ManagedClientExtensionModule, ManagedClientExtensionPackage, ManagedExtensionPackage } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { createClientExtensionHost, type ClientExtensionDataApi } from './client-extension-host.js'
import type { ClientRendererHost } from './client-renderer-host.js'
import { createRendererSessionHost } from './renderer-session.js'

export function useClientExtensionRuntime(input: {
  api: Pick<StudioApi, 'extensions' | 'extensionRuntime' | 'states' | 'textTransforms'>
  rendererHost: ClientRendererHost
}) {
  const data = useMemo<ClientExtensionDataApi>(() => ({
    records: {
      list: async (packageId, query) => (await input.api.extensionRuntime.listRecords({ packageId, ...query })).records,
      get: async (packageId, recordId) => (await input.api.extensionRuntime.getRecord(packageId, recordId)).record,
    },
    state: {
      get: async target => (await input.api.states.get(target)).snapshot,
    },
    history: {
      project: async query => (await input.api.textTransforms.project(query)).snapshot as never,
      extract: async query => await input.api.textTransforms.extract(query) as never,
    },
    rpc: {
      call: (method, params) => input.api.extensionRuntime.call(method, params as never),
    },
    assets: {
      url: assetId => `/assets/${encodeURIComponent(assetId)}`,
    },
  }), [input.api])
  const sessionHost = useMemo(() => createRendererSessionHost(), [])
  const host = useMemo(() => createClientExtensionHost({ rendererHost: input.rendererHost, sessionHost, data }), [data, input.rendererHost, sessionHost])
  const [packages, setPackages] = useState<ManagedExtensionPackage[]>([])
  const [error, setError] = useState<Error>()
  const [serverDiagnostics, setServerDiagnostics] = useState<ClientJsonValue[]>([])
  const [refreshSequence, setRefreshSequence] = useState(0)

  const refresh = useCallback(async (reload: readonly string[] = []) => {
    try {
      const [result, diagnostics] = await Promise.all([
        input.api.extensions.list(),
        input.api.extensions.diagnostics(),
      ])
      setPackages(result.items)
      setServerDiagnostics(diagnostics.diagnostics)
      await host.reconcile(toClientPackages(result.items), { reload })
      setError(undefined)
      setRefreshSequence(sequence => sequence + 1)
      return result.items
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)))
      return []
    }
  }, [host, input.api.extensions])

  useEffect(() => {
    let disposed = false
    let events: EventSource | undefined
    void refresh().then(() => {
      if (disposed || typeof EventSource === 'undefined') return
      events = new EventSource('/extensions/events')
      events.addEventListener('extensions.changed', event => {
        const change = readExtensionChange(event)
        const reload = change?.action === 'reloaded' && change.packageId && change.moduleId
          ? [`${change.packageId}/${change.moduleId}`]
          : []
        void refresh(reload)
      })
      events.addEventListener('extensions.data.changed', () => input.rendererHost.invalidate())
      events.onerror = () => setError(new Error('Extension event stream disconnected'))
    })
    return () => {
      disposed = true
      events?.close()
      void host.dispose()
      sessionHost.dispose()
    }
  }, [host, input.rendererHost, refresh, sessionHost])

  return {
    host,
    sessionHost,
    packages,
    error,
    serverDiagnostics,
    refreshSequence,
    refresh,
    enable: async (packageId: string, moduleId: string) => {
      await input.api.extensions.enable(packageId, moduleId)
      return await refresh()
    },
    disable: async (packageId: string, moduleId: string) => {
      await input.api.extensions.disable(packageId, moduleId)
      return await refresh()
    },
    reload: async (packageId: string, moduleId: string) => {
      await input.api.extensions.reload(packageId, moduleId)
      return await refresh([`${packageId}/${moduleId}`])
    },
    uninstall: async (packageId: string, version?: string) => {
      await input.api.extensions.uninstall(packageId, version)
      return await refresh()
    },
  }
}

function toClientPackages(packages: readonly ManagedExtensionPackage[]): ManagedClientExtensionPackage[] {
  return packages.flatMap(extensionPackage => {
    const modules = extensionPackage.modules.filter((module): module is ManagedClientExtensionModule => (
      module.runtimeKind === 'client' && typeof module.entryUrl === 'string'
    ))
    return modules.length > 0 ? [{ ...extensionPackage, modules }] : []
  })
}

function readExtensionChange(event: Event): { packageId?: string; moduleId?: string; action?: string } | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return undefined
  try {
    const value = JSON.parse(event.data) as { payload?: { packageId?: string; moduleId?: string; action?: string } }
    return value.payload
  } catch {
    return undefined
  }
}
