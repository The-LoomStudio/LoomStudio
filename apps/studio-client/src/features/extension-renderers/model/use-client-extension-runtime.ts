import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { queryExtensionLogs, type Logger, type MemoryLogSink } from '@loom-studio/logging'
import { useAppearanceStore } from '../../../shared/studio-shell/appearance-store.js'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ManagedClientExtensionModule, ManagedClientExtensionPackage, ManagedExtensionPackage } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { invalidateCardMedia } from '../../../shared/lib/card-media.js'
import { createClientExtensionHost, type ClientExtensionDataApi } from './client-extension-host.js'
import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { createRendererSessionHost } from './renderer-session.js'

export function useClientExtensionRuntime(input: {
  api: Pick<StudioApi, 'extensions' | 'extensionRuntime' | 'states' | 'textTransforms'>
  rendererHost: ClientRendererHost
  logger: Logger
  clientLogs: MemoryLogSink
}) {
  const data = useMemo<ClientExtensionDataApi>(() => ({
    configs: {
      list: async (packageId, query) => (await input.api.extensionRuntime.listConfigs({ packageId, ...query })).configs,
      get: async (packageId, query) => (await input.api.extensionRuntime.getConfig({ packageId, ...query })).config,
      upsert: async (packageId, query) => (await input.api.extensionRuntime.upsertConfig({ packageId, ...query })).config,
    },
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
  const setAppearanceBackground = useAppearanceStore(state => state.setBackground)
  const host = useMemo(() => createClientExtensionHost({
    rendererHost: input.rendererHost,
    sessionHost,
    data,
    logger: input.logger,
    queryLogs: (packageId, query) => queryExtensionLogs({ current: input.clientLogs }, packageId, query, 'client'),
    appearance: { setBackground: setAppearanceBackground },
  }), [data, input.rendererHost, input.logger, input.clientLogs, sessionHost, setAppearanceBackground])
  const [packages, setPackages] = useState<ManagedExtensionPackage[]>([])
  const [error, setError] = useState<Error>()
  const [serverDiagnostics, setServerDiagnostics] = useState<ClientJsonValue[]>([])
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [configRevision, setConfigRevision] = useState(0)
  const lifecycle = useRef<{ host: typeof host; signal: AbortSignal } | null>(null)

  const refresh = useCallback(async (reload: readonly string[] = []) => {
    const signal = lifecycle.current?.host === host ? lifecycle.current.signal : undefined
    if (!signal || signal.aborted) return []
    try {
      const [result, diagnostics] = await Promise.all([
        input.api.extensions.list(),
        input.api.extensions.diagnostics(),
      ])
      if (signal.aborted) return []
      const [rules, extractors] = await Promise.all([
        input.api.textTransforms.listRules(),
        input.api.textTransforms.listExtractors(),
      ])
      if (signal.aborted) return []
      const packagesWithImportState = mapPackageImportState(result.items, rules.rules, extractors.extractors)
      setPackages(packagesWithImportState)
      setServerDiagnostics(diagnostics.diagnostics)
      await host.reconcile(toClientPackages(packagesWithImportState), { reload })
      if (signal.aborted) return []
      setError(undefined)
      setRefreshSequence(sequence => sequence + 1)
      return packagesWithImportState
    } catch (reason) {
      if (signal.aborted) return []
      setError(reason instanceof Error ? reason : new Error(String(reason)))
      return []
    }
  }, [host, input.api.extensions, input.api.textTransforms])

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = { host, signal: controller.signal }
    let events: EventSource | undefined
    void refresh().then(() => {
      if (controller.signal.aborted || typeof EventSource === 'undefined') return
      events = new EventSource('/extensions/events')
      events.addEventListener('open', invalidateCardMedia)
      events.addEventListener('directories.media.changed', invalidateCardMedia)
      events.addEventListener('extensions.changed', event => {
        const change = readExtensionChange(event)
        const reload = change?.action === 'reloaded' && change.packageId && change.moduleId
          ? [`${change.packageId}/${change.moduleId}`]
          : []
        void refresh(reload)
      })
      events.addEventListener('extensions.data.changed', () => {
        input.rendererHost.invalidate()
        setConfigRevision(revision => revision + 1)
        void host.notifyConfigsChanged()
      })
      events.onerror = () => setError(new Error('Extension event stream disconnected'))
    })
    return () => {
      controller.abort()
      events?.removeEventListener('open', invalidateCardMedia)
      events?.removeEventListener('directories.media.changed', invalidateCardMedia)
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
    configRevision,
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

export function mapPackageImportState(
  packages: readonly ManagedExtensionPackage[],
  rules: readonly { origin?: { kind: string; packageId: string; contributionId: string } }[],
  extractors: readonly { origin?: { kind: string; packageId: string; contributionId: string } }[],
): ManagedExtensionPackage[] {
  return packages.map(extensionPackage => ({
    ...extensionPackage,
    importedResources: {
      transformRuleContributionIds: rules
        .filter(rule => rule.origin?.kind === 'extension-package' && rule.origin.packageId === extensionPackage.packageId)
        .map(rule => rule.origin!.contributionId),
      textExtractorContributionIds: extractors
        .filter(extractor => extractor.origin?.kind === 'extension-package' && extractor.origin.packageId === extensionPackage.packageId)
        .map(extractor => extractor.origin!.contributionId),
    },
  }))
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
