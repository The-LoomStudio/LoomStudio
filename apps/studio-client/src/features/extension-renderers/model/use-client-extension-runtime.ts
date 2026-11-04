import { subscribeExtensionEvents } from '../../../shared/api/extension-events.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { queryExtensionLogs, type Logger, type MemoryLogSink } from '@loom-studio/logging'
import { useAppearanceStore } from '../../../shared/studio-shell/appearance-store.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { ManagedClientExtensionModule, ManagedClientExtensionPackage, ManagedExtensionPackage } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { invalidateCardMedia } from '../../../shared/lib/card-media.js'
import { createClientExtensionHost, type ClientExtensionDataApi, type ClientTimelineParticipation } from './client-extension-host.js'
import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { createRendererSessionHost } from './renderer-session.js'
import { migrateOfficialBackground } from './resolve-background.js'
import { extensionInstallationId, type ClientNotification, type ExtensionInstallationTarget } from '@loom-studio/extension-sdk'

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
    imports: { commit: (sessionId, owner) => api.extensionRuntime.importConvertedBatch({ ...owner, sessionId }) },
    rpc: {
      call: (method, params, owner) => api.extensionRuntime.callInstalled({ ...owner, method, params: params as never }),
    },
    assets: {
      url: (assetId, owner) => owner?.target.kind === 'card'
        ? `/extension-assets/${[owner.packageId, owner.moduleId, owner.target.cardId, assetId].map(encodeURIComponent).join('/')}`
        : `/assets/${encodeURIComponent(assetId)}`,
    },
  }
}

export function useClientExtensionRuntime(input: {
  api: Pick<StudioApi, 'extensions' | 'extensionRuntime' | 'states' | 'textTransforms' | 'timelineExtensions' | 'extensionInstallations'>
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
  const [connectionError, setConnectionError] = useState<Error>()
  const [serverDiagnostics, setServerDiagnostics] = useState<ClientJsonValue[]>([])
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [configRevision, setConfigRevision] = useState(0)
  const [, setBackgroundRevision] = useState(0)
  useEffect(() => host.subscribe(() => setBackgroundRevision(revision => revision + 1)), [host])
  const lifecycle = useRef<{ host: typeof host; signal: AbortSignal } | null>(null)
  const globalPackages = useRef<ManagedExtensionPackage[]>([])
  const currentPackages = useRef<ManagedExtensionPackage[]>([])
  const loadedCatalog = useRef<{ signal: AbortSignal; packages: readonly ManagedExtensionPackage[] } | undefined>(undefined)
  const requestSequence = useRef(0)
  const participationSequence = useRef(0)

  const refreshParticipation = useCallback(async (catalog = currentPackages.current, reload: readonly string[] = []) => {
    const signal = lifecycle.current?.host === host ? lifecycle.current.signal : undefined
    if (!signal || signal.aborted) return false
    const sequence = ++participationSequence.current
    const scope = input.rendererHost.scopeSnapshot()
    const stale = () => signal.aborted || sequence !== participationSequence.current
      || contextKey(input.rendererHost) !== JSON.stringify([scope.cardId, scope.timelineId, scope.branchId])
    try {
      let timeline: ClientTimelineParticipation | undefined
      if (scope.timelineId && scope.branchId && catalog.some(item => item.participation === 'timeline')) {
        const [config, result] = await Promise.all([
          input.api.timelineExtensions.get({ timelineId: scope.timelineId }),
          input.api.extensionInstallations.list(),
        ])
        if (stale()) return false
        timeline = {
          target: { scope: 'timeline', timelineId: scope.timelineId, branchId: scope.branchId },
          leases: config.entries.flatMap(entry => {
            const installation = result.installations.find(item => item.id === entry.installationId)
            const pkg = catalog.find(item => extensionInstallationId(item.packageId, item.target ?? { kind: 'global' }) === entry.installationId)
            if (!entry.enabled || !installation || !pkg || pkg.participation !== 'timeline'
              || config.timelineId !== scope.timelineId || installation.participation !== 'timeline'
              || installation.version !== entry.installationVersion || installation.packageId !== entry.packageId
              || installation.packageVersion !== entry.packageVersion || pkg.version !== entry.packageVersion
              || extensionInstallationId(installation.packageId, installation.target) !== entry.installationId
              || (installation.target.kind === 'card' && installation.target.cardId !== scope.cardId)) return []
            return [{
              timelineId: scope.timelineId!, installationId: entry.installationId,
              installationVersion: entry.installationVersion, generation: entry.generation,
            }]
          }),
        }
      }
      if (stale()) return false
      await host.reconcile(toClientPackages(catalog), { reload, timeline })
      if (stale()) return false
      const saved = useAppearanceStore.getState().background
      const background = migrateOfficialBackground(saved, host.backgrounds())
      if (background !== saved) useAppearanceStore.setState({ background })
      // A scope refresh can supersede the catalog's first participation request.
      // Its successful reconciliation still completes the real startup boundary.
      if (loadedCatalog.current?.signal === signal && loadedCatalog.current.packages === catalog
        && currentPackages.current === catalog) setRefreshSequence(sequence => Math.max(1, sequence))
      return true
    } catch (reason) {
      if (stale()) return false
      await host.reconcile(toClientPackages(catalog))
      if (!stale()) setError(reason instanceof Error ? reason : new Error(String(reason)))
      return false
    }
  }, [host, input.api.extensionInstallations, input.api.timelineExtensions, input.rendererHost])

  const refresh = useCallback(async (reload: readonly string[] = []) => {
    const signal = lifecycle.current?.host === host ? lifecycle.current.signal : undefined
    if (!signal || signal.aborted) return []
    const sequence = ++requestSequence.current
    const cardId = input.rendererHost.scopeSnapshot().cardId
    const stale = () => signal.aborted || requestSequence.current !== sequence
      || input.rendererHost.scopeSnapshot().cardId !== cardId
    try {
      const [result, privateResult] = await Promise.all([
        input.api.extensions.list(),
        cardId ? input.api.extensions.list({ kind: 'card', cardId }) : Promise.resolve({ items: [] }),
      ])
      if (stale()) return []
      // Import badges and diagnostics do not grant Timeline participation.
      const [rules, extractors, diagnostics] = await Promise.allSettled([
        input.api.textTransforms.listRuleSummaries(),
        input.api.textTransforms.listExtractorSummaries(),
        input.api.extensions.diagnostics(),
      ])
      if (stale()) return []
      const auxiliaryFailure = [rules, extractors, diagnostics].find(item => item.status === 'rejected')
      const withImportState = (items: ManagedExtensionPackage[]) => rules.status === 'fulfilled' && extractors.status === 'fulfilled'
        ? mapPackageImportState(items, rules.value.rules, extractors.value.extractors) : items
      const packagesWithImportState = withImportState(result.items)
      const privatePackages = withImportState(privateResult.items)
      globalPackages.current = packagesWithImportState
      currentPackages.current = [...packagesWithImportState, ...privatePackages]
      loadedCatalog.current = { signal, packages: currentPackages.current }
      setPackages(packagesWithImportState)
      setCardPackages(privatePackages)
      if (diagnostics.status === 'fulfilled') setServerDiagnostics(diagnostics.value.diagnostics)
      if (!await refreshParticipation(currentPackages.current, reload) || stale()) return []
      setError(auxiliaryFailure?.status === 'rejected'
        ? new Error('Extension auxiliary catalog could not be refreshed', { cause: auxiliaryFailure.reason }) : undefined)
      setRefreshSequence(sequence => sequence + 1)
      return packagesWithImportState
    } catch (reason) {
      if (stale()) return []
      participationSequence.current += 1
      await host.reconcile(toClientPackages(currentPackages.current))
      if (stale()) return []
      setError(reason instanceof Error ? reason : new Error(String(reason)))
      return []
    }
  }, [host, input.api.extensions, input.api.textTransforms, input.rendererHost, refreshParticipation])

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = { host, signal: controller.signal }
    globalPackages.current = []
    currentPackages.current = []
    let started = false
    let disconnectNotice: ReturnType<typeof setTimeout> | undefined
    let disconnected = false
    let pageHidden = false
    let connectionReported = false
    const clearDisconnectNotice = () => {
      clearTimeout(disconnectNotice)
      disconnectNotice = undefined
    }
    const scheduleDisconnectNotice = () => {
      clearDisconnectNotice()
      if (!disconnected || connectionReported || pageHidden || controller.signal.aborted
        || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      disconnectNotice = setTimeout(() => {
        disconnectNotice = undefined
        if (controller.signal.aborted || !disconnected || pageHidden
          || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
        connectionReported = true
        setConnectionError(new Error('Extension event stream disconnected'))
      }, 30_000)
    }
    const pageHide = () => { pageHidden = true; clearDisconnectNotice() }
    const pageShow = () => { pageHidden = false; scheduleDisconnectNotice() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', scheduleDisconnectNotice)
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', pageHide)
      window.addEventListener('pageshow', pageShow)
    }
    if (connectionError) setConnectionError(undefined)
    let target = contextKey(input.rendererHost)
    let catalogCardId = input.rendererHost.scopeSnapshot().cardId
    const unsubscribeScope = input.rendererHost.subscribe(() => {
      const nextTarget = contextKey(input.rendererHost)
      if (nextTarget === target) return
      target = nextTarget
      participationSequence.current += 1
      const nextCardId = input.rendererHost.scopeSnapshot().cardId
      if (nextCardId === catalogCardId) {
        void host.reconcile(toClientPackages(currentPackages.current))
        if (started) void refreshParticipation()
        return
      }
      catalogCardId = nextCardId
      setCardPackages([])
      currentPackages.current = globalPackages.current
      void host.reconcile(toClientPackages(globalPackages.current))
      if (started) void refresh()
    })
    let unsubscribeEvents: (() => void) | undefined
    const connected = () => {
      disconnected = false
      connectionReported = false
      clearDisconnectNotice()
      setConnectionError(undefined)
      if (started) invalidateCardMedia()
      started = true
      void refresh().then(async () => {
        if (controller.signal.aborted) return
        input.rendererHost.invalidate()
        setConfigRevision(revision => revision + 1)
        await Promise.all([host.notifyConfigsChanged(), host.notifyStateChanged()])
      })
    }
    if (typeof EventSource === 'undefined') {
      started = true
      void refresh()
    } else {
      unsubscribeEvents = subscribeExtensionEvents({
        onConnected: connected,
        events: {
          'directories.media.changed': invalidateCardMedia,
          'extensions.changed': () => { void refresh() },
          'extensions.data.changed': () => {
            void refreshParticipation().then(async current => {
              if (!current || controller.signal.aborted) return
              input.rendererHost.invalidate()
              setConfigRevision(revision => revision + 1)
              await Promise.all([host.notifyConfigsChanged(), host.notifyStateChanged()])
            })
          },
        },
        onError: () => {
          requestSequence.current += 1
          participationSequence.current += 1
          void host.reconcile(toClientPackages(currentPackages.current))
          // Native EventSource owns retries; report only a sustained foreground outage.
          disconnected = true
          if (!disconnectNotice) scheduleDisconnectNotice()
          // Keep the catalog usable if the initial SSE connection fails.
          if (!started) {
            started = true
            void refresh()
          }
        },
      })
    }
    return () => {
      clearTimeout(disconnectNotice)
      controller.abort()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', scheduleDisconnectNotice)
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', pageHide)
        window.removeEventListener('pageshow', pageShow)
      }
      unsubscribeScope()
      unsubscribeEvents?.()
      void host.dispose()
      sessionHost.dispose()
    }
  }, [host, input.rendererHost, refresh, refreshParticipation, sessionHost])

  return {
    host,
    sessionHost,
    packages,
    cardPackages,
    error,
    connectionError,
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
      return await refresh()
    },
    uninstall: async (packageId: string, version?: string, deleteData?: boolean) => {
      await input.api.extensions.uninstall(packageId, version, deleteData)
      return await refresh()
    },
  }
}

function contextKey(host: ClientRendererHost): string {
  const scope = host.scopeSnapshot()
  return JSON.stringify([scope.cardId, scope.timelineId, scope.branchId])
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
      (module.runtimeKind === 'client' || module.runtimeKind === 'client-worker') && typeof module.entryUrl === 'string'
    ))
    return modules.length > 0 || extensionPackage.resources?.backgrounds?.length ? [{ ...extensionPackage, modules }] : []
  })
}
