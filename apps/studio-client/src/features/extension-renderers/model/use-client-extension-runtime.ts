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
import { extensionInstallationId, type ClientNotification, type ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import { clientModuleKey } from './client-actions.js'

export function createClientExtensionDataApi(api: Pick<StudioApi, 'extensionRuntime' | 'states' | 'textTransforms'>): ClientExtensionDataApi {
  return {
    configs: {
      list: async (packageId, query, target) => (await api.extensionRuntime.listConfigs({ ...query, packageId, target: target ?? { kind: 'global' } })).configs,
      get: async (packageId, query, target) => (await api.extensionRuntime.getConfig({ ...query, packageId, target: target ?? { kind: 'global' } })).config,
      upsert: async (packageId, query, target) => (await api.extensionRuntime.upsertConfig({ ...query, packageId, target: target ?? { kind: 'global' } })).config,
    },
    records: {
      list: async (packageId, query, target) => (await api.extensionRuntime.listRecords({ ...query, packageId, target: target ?? { kind: 'global' } })).records,
      get: async (packageId, recordId, target) => (await api.extensionRuntime.getRecord(packageId, recordId, target ?? { kind: 'global' })).record,
    },
    state: {
      get: async (target, extensionTarget) => (await api.states.get(target, extensionTarget ?? { kind: 'global' })).snapshot,
    },
    history: {
      project: async (query, extensionTarget) => (await api.textTransforms.project({ ...query, extensionTarget: extensionTarget ?? { kind: 'global' } })).snapshot as never,
      extract: async (query, extensionTarget) => await api.textTransforms.extract({ ...query, extensionTarget: extensionTarget ?? { kind: 'global' } }) as never,
    },
    rpc: {
      call: (method, params, owner) => owner
        ? api.extensionRuntime.callInstalled({ ...owner, method, params: params as never })
        : api.extensionRuntime.call(method, params as never),
    },
    assets: {
      url: (assetId, owner) => owner?.target.kind === 'card'
        ? `/extension-assets/${[owner.packageId, owner.moduleId, owner.target.cardId, assetId].map(encodeURIComponent).join('/')}`
        : `/assets/${encodeURIComponent(assetId)}`,
    },
  }
}

export function useClientExtensionRuntime(input: {
  api: Pick<StudioApi, 'extensions' | 'extensionRuntime' | 'states' | 'textTransforms'>
  rendererHost: ClientRendererHost
  logger: Logger
  clientLogs: MemoryLogSink
  notify(owner: string, input: ClientNotification): void
}) {
  const data = useMemo(() => createClientExtensionDataApi(input.api), [input.api])
  const sessionHost = useMemo(() => createRendererSessionHost(input.rendererHost), [input.rendererHost])
  const setAppearanceBackground = useAppearanceStore(state => state.setBackground)
  const setScopedBackground = useAppearanceStore(state => state.setScopedBackground)
  const clearScopedBackground = useAppearanceStore(state => state.clearScopedBackground)
  const host = useMemo(() => createClientExtensionHost({
    rendererHost: input.rendererHost,
    sessionHost,
    data,
    logger: input.logger,
    queryLogs: (packageId, query, installationId) => queryExtensionLogs({ current: input.clientLogs }, packageId, query, 'client', installationId),
    appearance: { setBackground: setAppearanceBackground, scoped: { set: setScopedBackground, clear: clearScopedBackground } },
    notify: input.notify,
  }), [data, input.rendererHost, input.logger, input.clientLogs, input.notify, sessionHost, setAppearanceBackground, setScopedBackground, clearScopedBackground])
  const [packages, setPackages] = useState<ManagedExtensionPackage[]>([])
  const [cardPackages, setCardPackages] = useState<ManagedExtensionPackage[]>([])
  const [error, setError] = useState<Error>()
  const [serverDiagnostics, setServerDiagnostics] = useState<ClientJsonValue[]>([])
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [configRevision, setConfigRevision] = useState(0)
  const lifecycle = useRef<{ host: typeof host; signal: AbortSignal } | null>(null)
  const globalPackages = useRef<ManagedExtensionPackage[]>([])
  const requestSequence = useRef(0)

  const refresh = useCallback(async (reload: readonly string[] = []) => {
    const signal = lifecycle.current?.host === host ? lifecycle.current.signal : undefined
    if (!signal || signal.aborted) return []
    const sequence = ++requestSequence.current
    const cardId = input.rendererHost.scopeSnapshot().cardId
    const stale = () => signal.aborted || requestSequence.current !== sequence || input.rendererHost.scopeSnapshot().cardId !== cardId
    try {
      const [result, privateResult, diagnostics] = await Promise.all([
        input.api.extensions.list(),
        cardId ? input.api.extensions.list({ kind: 'card', cardId }) : Promise.resolve({ items: [] }),
        input.api.extensions.diagnostics(),
      ])
      if (stale()) return []
      const [rules, extractors] = await Promise.all([
        input.api.textTransforms.listRules(),
        input.api.textTransforms.listExtractors(),
      ])
      if (stale()) return []
      const packagesWithImportState = mapPackageImportState(result.items, rules.rules, extractors.extractors)
      const privatePackages = mapPackageImportState(privateResult.items, rules.rules, extractors.extractors)
      globalPackages.current = packagesWithImportState
      setPackages(packagesWithImportState)
      setCardPackages(privatePackages)
      setServerDiagnostics(diagnostics.diagnostics)
      await host.reconcile(toClientPackages([...packagesWithImportState, ...privatePackages]), { reload })
      if (stale()) return []
      setError(undefined)
      setRefreshSequence(sequence => sequence + 1)
      return packagesWithImportState
    } catch (reason) {
      if (stale()) return []
      setError(reason instanceof Error ? reason : new Error(String(reason)))
      return []
    }
  }, [host, input.api.extensions, input.api.textTransforms, input.rendererHost])

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = { host, signal: controller.signal }
    globalPackages.current = []
    let cardId = input.rendererHost.scopeSnapshot().cardId
    const unsubscribeScope = input.rendererHost.subscribe(() => {
      const nextCardId = input.rendererHost.scopeSnapshot().cardId
      if (nextCardId === cardId) return
      cardId = nextCardId
      setCardPackages([])
      void host.reconcile(toClientPackages(globalPackages.current))
      void refresh()
    })
    let events: EventSource | undefined
    void refresh().then(() => {
      if (controller.signal.aborted || typeof EventSource === 'undefined') return
      events = new EventSource('/extensions/events')
      events.addEventListener('open', invalidateCardMedia)
      events.addEventListener('directories.media.changed', invalidateCardMedia)
      events.addEventListener('extensions.changed', event => {
        const change = readExtensionChange(event)
        const reload = change?.action === 'reloaded' && change.packageId && change.moduleId
          ? [clientModuleKey(change.packageId, change.moduleId, change.target)]
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
      unsubscribeScope()
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
    cardPackages,
    error,
    serverDiagnostics,
    refreshSequence,
    configRevision,
    refresh,
    enable: async (packageId: string, moduleId: string, grants?: Parameters<StudioApi['extensions']['enable']>[2], target?: ExtensionInstallationTarget) => {
      await input.api.extensions.enable(packageId, moduleId, grants, target)
      return await refresh()
    },
    disable: async (packageId: string, moduleId: string, target?: ExtensionInstallationTarget) => {
      await input.api.extensions.disable(packageId, moduleId, target)
      return await refresh()
    },
    reload: async (packageId: string, moduleId: string, target?: ExtensionInstallationTarget) => {
      await input.api.extensions.reload(packageId, moduleId, target)
      return await refresh([clientModuleKey(packageId, moduleId, target)])
    },
    uninstall: async (packageId: string, version?: string) => {
      await input.api.extensions.uninstall(packageId, version)
      return await refresh()
    },
  }
}

export function mapPackageImportState(
  packages: readonly ManagedExtensionPackage[],
  rules: readonly { origin?: { kind: string; packageId: string; contributionId: string; installationId?: string } }[],
  extractors: readonly { origin?: { kind: string; packageId: string; contributionId: string; installationId?: string } }[],
): ManagedExtensionPackage[] {
  return packages.map(extensionPackage => ({
    ...extensionPackage,
    importedResources: {
      transformRuleContributionIds: rules
        .filter(rule => rule.origin?.kind === 'extension-package' && rule.origin.packageId === extensionPackage.packageId
          && (rule.origin.installationId ?? extensionInstallationId(extensionPackage.packageId, { kind: 'global' }))
            === extensionInstallationId(extensionPackage.packageId, extensionPackage.target ?? { kind: 'global' }))
        .map(rule => rule.origin!.contributionId),
      textExtractorContributionIds: extractors
        .filter(extractor => extractor.origin?.kind === 'extension-package' && extractor.origin.packageId === extensionPackage.packageId
          && (extractor.origin.installationId ?? extensionInstallationId(extensionPackage.packageId, { kind: 'global' }))
            === extensionInstallationId(extensionPackage.packageId, extensionPackage.target ?? { kind: 'global' }))
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

function readExtensionChange(event: Event): { packageId?: string; moduleId?: string; action?: string; target?: ExtensionInstallationTarget } | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return undefined
  try {
    const value = JSON.parse(event.data) as { payload?: { packageId?: string; moduleId?: string; action?: string; target?: ExtensionInstallationTarget } }
    return value.payload
  } catch {
    return undefined
  }
}
