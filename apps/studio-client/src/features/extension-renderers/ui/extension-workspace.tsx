import { PackageResourceReviewDialog, type ResourceCopyInput } from '../../resource-updates/ui/package-resource-review-dialog.js'
import type { ResourceCopyResult } from '../../resource-updates/ui/resource-update-review.js'
import { ExtensionModuleBatches } from './extension-module-batches.js'
import { RecoveryPanel } from './extension-recovery-panel.js'
import { MobileTabPages } from '../../../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import { InfoDialog } from '../../../shared/ui/info-dialog/info-dialog.js'
import { UserIdentity } from '../../../shared/ui/user-identity/user-identity.js'
import { cardMediaUrl } from '../../../shared/lib/card-media.js'
import type { PackageResourceEntry } from '../model/package-resource-preview.js'
import { ExtensionPackageResources, ExtensionPackageTabs } from './extension-package-resources.js'
import { ExtensionCharacterCatalog } from './extension-character-catalog.js'
import { ExtensionIcon } from '../../../shared/ui/extension-icon/extension-icon.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { ClientActionPlacement, ClientCommandDeclaration, ExtensionInstallationTarget, RendererContributionDefinition } from '@loom-studio/extension-sdk'
import { ArrowDown, ArrowLeft, ArrowUp, Component, ExternalLink, Package, PackageMinus, PackageOpen, PackagePlus, Power, RefreshCw, TerminalSquare, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { buildStudioLogPath } from '../../../shared/studio-shell/studio-route.js'
import { notify } from '../../../shared/notifications/index.js'
import type { Card, ListExtensionInstallationsResult, ManagedExtensionModule, ManagedExtensionPackage, PromptResource } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ClientExtensionHost } from '../model/client-extension-host.js'
import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import type { RendererSessionHost } from '../model/renderer-session.js'
import { rendererContributionKey, rendererSurfacePolicies } from '../../../shared/extension-renderer-runtime/renderer-registry.js'
import { clientCommandKey, clientModuleKey, matchesClientActionCondition } from '../model/client-actions.js'
import { ClientActionIcon } from './client-action-icon.js'
import { RendererSurfaceHost } from './renderer-surface-host.js'
import { ExtensionSettingsForm } from './extension-settings-form.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { toggleExtensionPackage } from '../model/toggle-extension-package.js'
import { ExtensionRemoteControls, RemoteExtensionInstall } from './remote-extension-install.js'
import { Button, Dialog } from '@loom-studio/ui'
import { PanelTabs } from '../../../shared/ui/panel-tabs/index.js'
import { TimelineExtensionPanel, type TimelineExtensionPanelProps } from './timeline-extension-panel.js'
import styles from './extension-workspace.module.scss'

const WORKSPACE_SCOPE_KEY = 'workspace'

type ExtensionWorkspaceSelection =
  | { kind: 'card-module'; packageId: string; moduleId: string; cardId: string }
  | { kind: 'package'; packageId: string }
  | { kind: 'card-package'; packageId: string; cardId: string }
  | { kind: 'module'; packageId: string; moduleId: string }
  | { kind: 'renderer'; packageId: string; moduleId: string; id: string }
  | { kind: 'command'; packageId: string; moduleId: string; id: string }

export function ExtensionWorkspace(props: {
  mode: 'management' | 'workspace'
  onOpenWorkspace(): void
  onCloseWorkspace(): void
  extensionHost: ClientExtensionHost
  host: ClientRendererHost
  packages: readonly ManagedExtensionPackage[]
  cardPackages: readonly ManagedExtensionPackage[]
  serverDiagnostics: readonly ClientJsonValue[]
  sessionHost: RendererSessionHost
  t: Translator
  extensionRuntime: Pick<StudioApi['extensionRuntime'], 'getConfig' | 'listConfigs' | 'upsertConfig'>
  extensionApi: StudioApi['extensions']
  renderScripts(header: ReactNode, category: 'rules' | 'runtime'): ReactNode
  headerActions?: ReactNode
  onSaveResourceCopy?(input: ResourceCopyInput): Promise<ResourceCopyResult>
  onOpenResourceCopy?(result: ResourceCopyResult): void
  onRefreshExtensions(): Promise<unknown>
  onCharacterImported(): Promise<unknown>
  runtimeError?: string
  configRevision: number
  settingScopeContext: { cardId?: string; timelineId?: string; timelineCardId?: string; agentSessionId?: string; agentSessionCardId?: string }
  searchParams: URLSearchParams
  onNavigate(path: string): void
  onDisable(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<unknown>
  onEnable(packageId: string, moduleId: string, grants?: Parameters<StudioApi['extensions']['enable']>[2], target?: ExtensionInstallationTarget): Promise<unknown>
  onImportResources(packageId: string): Promise<unknown>
  onAttachPackage(cardId: string, packageId: string, version: string): Promise<unknown>
  embeddedPackageCard?: Pick<Card, 'id' | 'version' | 'name' | 'media' | 'extensionPackages'>
  onDetachPackage(cardId: string, expectedVersion: number, packageId: string): Promise<unknown>
  onInstallCardPackage(input: Parameters<StudioApi['extensions']['installCard']>[0]): Promise<unknown>
  onUpdateCardPackage(input: Parameters<StudioApi['extensions']['updateCard']>[0]): Promise<unknown>
  onUninstallCardPackage(input: Parameters<StudioApi['extensions']['uninstallCard']>[0]): Promise<unknown>
  onRemoveCardResources(input: Parameters<StudioApi['extensions']['removeCardResources']>[0]): Promise<unknown>
  installations: ListExtensionInstallationsResult['installations']
  timelineParticipation: Omit<TimelineExtensionPanelProps, 'installations' | 't'>
  promptResources: PromptResource[]
  onOpenPackageResource(pkg: ManagedExtensionPackage, entry: PackageResourceEntry): Promise<void>
  onUpdateResources(input: Parameters<StudioApi['extensions']['updateResources']>[0]): Promise<unknown>
  onRemoveResources(packageId: string): Promise<unknown>
  onReload(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<unknown>
  onUninstall(packageId: string, version?: string, deleteData?: boolean): Promise<unknown>
}) {
  useSyncExternalStore(props.host.subscribe, props.host.revision, props.host.revision)
  useSyncExternalStore(props.extensionHost.subscribe, props.extensionHost.revision, props.extensionHost.revision)
  useSyncExternalStore(props.sessionHost.subscribe, () => props.sessionHost.summaries().map(item => `${item.sessionId}:${item.state}`).join('|'), () => '')
  const { searchParams, onNavigate: navigate } = props
  const [selection, setSelection] = useState<ExtensionWorkspaceSelection | undefined>(() => searchParams.get('packageId') || props.packages[0] ? { kind: 'package', packageId: searchParams.get('packageId') ?? props.packages[0]!.packageId } : undefined)
  useEffect(() => {
    const packageId = searchParams.get('packageId')
    if (packageId) setSelection({ kind: 'package', packageId })
  }, [searchParams])
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [actionError, setActionError] = useState<string>()
  const [busyKey, setBusyKey] = useState<string>()
  const [removal, setRemoval] = useState<{ packageId: string; version: string }>()
  const [deleteData, setDeleteData] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const requestedView = searchParams.get('extensionView')
  const [storyDetails, setStoryDetails] = useState(requestedView === 'participation')
  useEffect(() => { setStoryDetails(requestedView === 'participation') }, [requestedView, searchParams.get('packageId')])
  const view = requestedView === 'scripts' && searchParams.get('scriptFilter') === 'rules' ? 'rules'
    : requestedView === 'scripts' || requestedView === 'rules' ? requestedView : 'packages'
  const setView = (next: 'packages' | 'scripts' | 'rules') => {
    const params = new URLSearchParams(searchParams)
    params.set('extensionView', next)
    params.delete('scriptId')
    params.delete('scriptFilter')
    setMobilePane('master')
    navigate(`/studio/extensions?${params}`)
  }
  const [batchRevision, setBatchRevision] = useState(0)
  const [resourceUpdate, setResourceUpdate] = useState<{
    title: string; fromVersion: string; input: Parameters<StudioApi['extensions']['previewPackageResources']>[0]
    apply(fingerprint: string, keepPromptResourceIds: string[]): Promise<unknown>
  }>()
  const resourceUpdateDialog = resourceUpdate ? <PackageResourceReviewDialog api={props.extensionApi}
    title={resourceUpdate.title} fromVersion={resourceUpdate.fromVersion} input={resourceUpdate.input}
    onApply={resourceUpdate.apply} onSaveCopy={props.onSaveResourceCopy} onOpenCopy={props.onOpenResourceCopy}
    onClose={() => setResourceUpdate(undefined)} /> : null
  const registrations = props.host.list('shell.workspace-panel')
  const activeKey = props.host.activeContributionKey('shell.workspace-panel', WORKSPACE_SCOPE_KEY)
  const active = registrations.find(registration => rendererContributionKey(registration) === activeKey)
  const activeOwner = active?.owner
  const activePackage = activeOwner?.kind === 'extension' ? props.packages.find(item => item.packageId === activeOwner.packageId) : undefined
  const activeIconUrl = activePackage ? extensionIconUrl(activePackage) : undefined
  const runtimeAlert = props.runtimeError || actionError ? <div role="alert" className={styles.runtimeAlert}>
    {actionError ? <p>{actionError}</p> : null}
    {props.runtimeError ? <>
    <p>{props.t('renderer.runtimeUnavailable')}</p>
    <p>{props.runtimeError}</p>
    <Button disabled={!!busyKey} onClick={() => {
      setBusyKey('refresh')
      setActionError(undefined)
      void props.onRefreshExtensions().catch(error => {
        setActionError(error instanceof Error ? error.message : String(error))
      }).finally(() => setBusyKey(undefined))
    }}><RefreshCw aria-hidden="true" size={16} />{props.t('renderer.retryRuntime')}</Button>
    </> : null}
  </div> : null

  if (props.mode === 'workspace' && !active) {
    return <section className={styles.panel}><Button onClick={props.onCloseWorkspace}>{props.t('renderer.back')}</Button></section>
  }
  if (props.mode === 'workspace' && active) {
    return (
      <section className={styles.panel} data-runtime-error={Boolean(props.runtimeError)} data-loom-component="renderer-workspace-panel" data-loom-mobile-page="">
        <header className={styles.header}>
          <button type="button" onClick={() => {
            props.host.release('shell.workspace-panel', WORKSPACE_SCOPE_KEY, activeKey)
            props.onCloseWorkspace()
          }}>
            <ArrowLeft aria-hidden="true" />
            <span>{props.t('renderer.back')}</span>
          </button>
          <strong className={styles.activeTitle}>
            {activePackage ? <ExtensionIcon iconUrl={activeIconUrl} size={30} /> : null}
            <span>{active.definition.name}</span>
          </strong>
        </header>
        <div className={styles.managementNotices}>
      {runtimeAlert}
      <RecoveryPanel api={props.extensionApi} t={props.t} revision={props.packages} />
      <ExtensionModuleBatches api={props.extensionApi} t={props.t} revision={batchRevision} />
      </div>
      {resourceUpdateDialog}
        <RendererSurfaceHost activeContributionKey={activeKey} className={styles.renderer} host={props.host} scope={{ kind: 'workspace', key: WORKSPACE_SCOPE_KEY }} surface="shell.workspace-panel" />
      </section>
    )
  }

  const selected = props.packages.find(item => item.packageId === selection?.packageId) ?? props.packages[0]
  const installation = props.installations.find(item => item.packageId === selected?.packageId && item.target.kind === 'global')
  const selectedItem = selection && selected?.packageId === selection.packageId ? selection : selected ? { kind: 'package' as const, packageId: selected.packageId } : undefined
  const clientSummaries = props.extensionHost.summaries()
  const rendererDiagnostics = props.host.diagnostics()
  const clientDiagnostics = props.extensionHost.diagnostics()
  const instances = props.host.instances()
  const claims = props.host.activeClaims()
  const commandRegistrations = props.extensionHost.commandRegistrations()
  const cardSelection = selection?.kind === 'card-module' ? selection : undefined
  const cardPackageSelection = selection?.kind === 'card-package' ? selection : undefined
  const cardTargetSelection = cardSelection ?? cardPackageSelection
  const cardPackage = cardTargetSelection && props.cardPackages.find(item => item.packageId === cardTargetSelection.packageId
    && item.target?.kind === 'card' && item.target.cardId === cardTargetSelection.cardId)
  const cardModule = cardPackage?.modules.find(item => item.moduleId === cardSelection?.moduleId)
  const selectedModule = selectedItem && 'moduleId' in selectedItem
    ? selected?.modules.find(module => module.moduleId === selectedItem.moduleId)
    : undefined

  function select(next: ExtensionWorkspaceSelection) {
    setStoryDetails(false)
    setSelection(next)
    setMobilePane('detail')
  }

  function resourcePanel(pkg: ManagedExtensionPackage) {
    const installed = props.installations.find(item => item.packageId === pkg.packageId && (pkg.target?.kind === 'card'
      ? item.target.kind === 'card' && item.target.cardId === pkg.target.cardId
      : item.target.kind === 'global'))
    const resources = props.promptResources.filter(resource => resource.origin?.kind === 'extension-package'
      && resource.origin.packageId === pkg.packageId
      && (pkg.target?.kind === 'card' ? Boolean(installed && resource.origin.installationId === installed.id)
        : !resource.origin.installationId || resource.origin.installationId === installed?.id))
    return <ExtensionPackageResources extensionPackage={pkg} promptResources={resources} onOpenResource={entry => props.onOpenPackageResource(pkg, entry)} t={props.t} />
  }

  function settingsPanel(pkg: ManagedExtensionPackage) {
    const target = pkg.target ?? { kind: 'global' as const }
    const scopeContext = target.kind === 'card'
      ? { ...props.settingScopeContext, cardId: target.cardId }
      : props.settingScopeContext
    return pkg.resources?.settings?.length ? <ExtensionSettingsForm api={props.extensionRuntime} configRevision={props.configRevision}
      packageId={pkg.packageId} target={target} scopeContext={scopeContext} settings={pkg.resources.settings} t={props.t} /> : null
  }

  async function run(key: string, operation: () => Promise<unknown>) {
    setActionError(undefined)
    setBusyKey(key)
    try {
      await operation()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(undefined)
    }
  }

  async function togglePackage(extensionPackage: ManagedExtensionPackage) {
    const target = extensionPackage.target ?? { kind: 'global' as const }
    const key = `${target.kind === 'card' ? target.cardId : 'global'}/${extensionPackage.packageId}`
    const enabled = !extensionPackage.modules.every(module => module.desired.enabled)
    if (enabled && !window.confirm(props.t('renderer.enablePackageConfirm', {
      name: extensionPackage.displayName,
      capabilities: extensionPackage.modules.filter(module => !module.desired.enabled)
        .map(module => `${module.moduleId} (${module.runtimeKind}): ${JSON.stringify(module.requestedCapabilities ?? {})}`).join('\n'),
    }))) return
    setActionError(undefined)
    setBusyKey(key)
    try {
      await toggleExtensionPackage({
        packageId: extensionPackage.packageId, target, modules: extensionPackage.modules, enabled,
        start: props.extensionApi.startModuleBatch,
      })
      setBatchRevision(value => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(undefined)
    }
  }

  async function importResources(packageId: string) {
    setActionError(undefined)
    try {
      await props.onImportResources(packageId)
      notify.success(props.t('renderer.resourcesImported'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeResources(packageId: string) {
    if (!window.confirm(props.t('renderer.removeResourcesConfirm'))) return
    setActionError(undefined)
    try {
      await props.onRemoveResources(packageId)
      notify.success(props.t('renderer.resourcesRemoved'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function uninstallPackage(packageId: string, version: string) {
    setActionError(undefined)
    setDeleteData(false)
    setRemoval({ packageId, version })
  }
  async function confirmUninstall() {
    if (!removal) return
    setActionError(undefined)
    setBusyKey('uninstall')
    try {
      await props.onUninstall(removal.packageId, removal.version, deleteData)
      setRemoval(undefined)
      notify.success(props.t('renderer.uninstalled'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey(undefined)
    }
  }

  const [storyCount, setStoryCount] = useState<number>()
  const [storyCountError, setStoryCountError] = useState(false)
  const storyId = props.timelineParticipation.timeline?.id
  useEffect(() => {
    let active = true
    setStoryCount(undefined)
    setStoryCountError(false)
    if (view !== 'packages' || !storyId) return
    void props.timelineParticipation.api.get({ timelineId: storyId }).then(result => {
      if (active) setStoryCount(result.entries.filter(entry => entry.enabled).length)
    }).catch(() => { if (active) setStoryCountError(true) })
    return () => { active = false }
  }, [view, storyId, props.timelineParticipation.api, props.timelineParticipation.refreshToken])

  const mobileTabs = <div data-loom-primary-tabs="" className={styles.packageTreeHeader}>
    <PanelTabs activeId={view} onChange={setView} ariaLabel={props.t('renderer.workspaceTitle')} items={[
      { id: 'packages', label: props.t('renderer.packages') },
      { id: 'scripts', label: '脚本' },
      { id: 'rules', label: '正则' },
    ]} />
    {view === 'packages' ? props.headerActions : null}
    {view === 'packages' ? <button type="button" className={styles.installPackageBtn}
      onClick={() => setInstallOpen(true)} title={props.t('renderer.install')} aria-label={props.t('renderer.install')}>
      <PackagePlus size={14} aria-hidden="true" />
    </button> : null}
  </div>

  const scriptsPage = (category: 'rules' | 'runtime') => <section className={`${styles.panel} ${styles.management}`} data-runtime-error={Boolean(props.runtimeError || actionError)} data-loom-component="renderer-workspace-panel" data-loom-mobile-page="">
    {runtimeAlert}
    {props.renderScripts(<div data-mobile-tab-inline-header="" data-loom-primary-tabs="" className={styles.packageTreeHeader}><PanelTabs activeId={view} onChange={setView} ariaLabel={props.t('renderer.workspaceTitle')} items={[
      { id: 'packages', label: props.t('renderer.packages') },
      { id: 'scripts', label: '脚本' },
      { id: 'rules', label: '正则' },
    ]} /></div>, category)}
  </section>

  const packagePage = () => (
    <section className={`${styles.panel} ${styles.management}`} data-runtime-error={Boolean(props.runtimeError || actionError)} data-loom-component="renderer-workspace-panel" data-loom-mobile-page="">
      {runtimeAlert}
      {resourceUpdateDialog}
      {view === 'packages' && installOpen ? <RemoteExtensionInstall api={props.extensionApi} t={props.t}
        onClose={() => setInstallOpen(false)} onInstalled={props.onRefreshExtensions} /> : null}
      {view === 'packages' && removal ? <Dialog open title={props.t('renderer.uninstall')} dismissible={!busyKey} onClose={() => setRemoval(undefined)}
        actions={<>
          <Button disabled={!!busyKey} onClick={() => setRemoval(undefined)}>{props.t('renderer.remote.cancel')}</Button>
          <Button variant="danger" disabled={!!busyKey} onClick={() => void confirmUninstall()}><Trash2 size={16} aria-hidden="true" />{props.t('renderer.uninstall')}</Button>
        </>}>
        {actionError ? <p role="alert">{actionError}</p> : null}
        <p>{removal.packageId} · {removal.version}</p>
        <label><input type="checkbox" checked={deleteData} disabled={!!busyKey} onChange={event => setDeleteData(event.target.checked)} /> {props.t('renderer.remote.deleteData')}</label>
      </Dialog> : null}
      <MasterDetailWorkbench
        navigationScope="local"
        masterWidth="minmax(210px, 0.24fr)"
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={(
          <nav aria-label={props.t('renderer.workspaceTitle')} data-loom-mobile-tab-scope="" className={styles.packageTree}>
            <div data-mobile-tab-inline-header="" data-loom-primary-tabs="" className={styles.packageTreeHeader}>
              <PanelTabs
                activeId={view}
                onChange={setView}
                ariaLabel={props.t('renderer.workspaceTitle')}
                items={[
                  { id: 'packages', label: props.t('renderer.packages') },
                  { id: 'scripts', label: '脚本' },
                  { id: 'rules', label: '正则' },
                ]}
              />
              {view === 'packages' ? props.headerActions : null}
                        {view === 'packages' ? (
                <button
                  type="button"
                  className={styles.installPackageBtn}
                  onClick={() => setInstallOpen(true)}
                  title={props.t('renderer.install')}
                  aria-label={props.t('renderer.install')}
                >
                  <PackagePlus size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className={styles.packageTreeBody}>
              {props.packages.length === 0 ? <p className={styles.empty}>{props.t('renderer.workspaceEmpty')}</p> : props.packages.map(extensionPackage => {
              const isEnabled = extensionPackage.modules.length > 0 && extensionPackage.modules.every(module => module.desired.enabled)
              return (
              <section className={styles.treePackage} key={extensionPackage.packageId}>
                <div className={styles.packageItemRow}>
                  <button
                    aria-current={!storyDetails && !cardTargetSelection && extensionPackage.packageId === selected?.packageId ? 'page' : undefined}
                    className={styles.packageItem}
                    type="button"
                    onClick={() => select({ kind: 'package', packageId: extensionPackage.packageId })}
                  >
                    <ExtensionIcon iconUrl={extensionPackage.iconUrl} size={30} />
                    <span><strong>{extensionPackage.displayName}</strong><small>{extensionPackage.packageId} · {extensionPackage.version}</small></span>
                  </button>
                  {extensionPackage.modules.length > 0 ? (
                    <button
                      type="button"
                      className={styles.packageToggle}
                      title={props.t(isEnabled ? 'renderer.disablePackage' : 'renderer.enablePackage')}
                      aria-label={props.t(isEnabled ? 'renderer.disablePackage' : 'renderer.enablePackage')}
                      aria-pressed={isEnabled}
                      disabled={Boolean(busyKey) || !extensionPackage.available}
                      onClick={event => {
                        event.stopPropagation()
                        void togglePackage(extensionPackage)
                      }}
                    >
                      {isEnabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
                    </button>
                  ) : null}
                </div>

              </section>
            )})}
            {view === 'packages' && props.embeddedPackageCard ? (
              <section className={styles.characterSummary} key={props.embeddedPackageCard.id}>
                <h3 className={styles.cardHeading}><UserIdentity name={props.embeddedPackageCard.name} avatarUrl={cardMediaUrl(props.embeddedPackageCard.id, 'avatar', props.embeddedPackageCard.media?.avatarAssetId, props.embeddedPackageCard.version)} /></h3>
                <div className={styles.characterStory}>
                  <p className={styles.storySummary}>{storyId ? props.timelineParticipation.timeline?.title || props.t('participation.timeline') : '尚未开始故事'}</p>
                  {storyId && <button type="button" className={styles.storyEntry} aria-current={storyDetails ? 'page' : undefined} onClick={() => { setStoryDetails(true); setMobilePane('detail') }}>
                    <span>当前故事扩展</span>
                    <small>{storyCount !== undefined ? `已启用 ${storyCount}` : storyCountError ? '状态读取失败' : '读取中…'}</small>
                  </button>}
                </div>
                {(props.embeddedPackageCard.extensionPackages ?? []).map(archive => {
                  const card = props.embeddedPackageCard!
                  const installed = props.installations.find(item => item.packageId === archive.packageId && item.target.kind === 'card' && item.target.cardId === card.id)
                  return (
                  <div className={styles.embeddedPackage} key={archive.packageId}>
                    <span>{archive.packageId}<small>{archive.version}</small></span>
                    <button
                      type="button"
                      title={props.t('renderer.installCardPackage')}
                      aria-label={props.t('renderer.installCardPackage')}
                      disabled={Boolean(busyKey)}
                      onClick={() => {
                        const card = props.embeddedPackageCard!
                        void run(`${card.id}/${archive.packageId}/import`, async () => {
                          await props.onInstallCardPackage({ cardId: card.id, expectedCardVersion: card.version, packageId: archive.packageId })
                          notify.success(props.t('renderer.installed'))
                        })
                      }}
                    ><PackagePlus aria-hidden="true" size={16} /></button>
                    {installed ? <>
                      <button
                        type="button" disabled={Boolean(busyKey)}
                        title={props.t('renderer.updateCardPackage')} aria-label={props.t('renderer.updateCardPackage')}
                        onClick={() => {
                          const input = { cardId: card.id, packageId: archive.packageId, expectedCardVersion: card.version,
                            packageVersion: archive.version, expectedInstallationVersion: installed.version }
                          setResourceUpdate({ title: archive.packageId, fromVersion: installed.packageVersion,
                            input: { ...input, target: { kind: 'card', cardId: card.id } },
                            apply: (fingerprint: string, keepPromptResourceIds: string[]) => props.onUpdateCardPackage({ ...input, expectedPreviewFingerprint: fingerprint, keepPromptResourceIds }) })
                        }}
                      ><RefreshCw aria-hidden="true" size={16} /></button>
                      <button
                        type="button" disabled={Boolean(busyKey)}
                        title={props.t('renderer.removeCardResources')} aria-label={props.t('renderer.removeCardResources')}
                        onClick={() => {
                          if (!window.confirm(props.t('renderer.removeCardResourcesConfirm', { name: archive.packageId }))) return
                          void run(`${card.id}/${archive.packageId}/remove`, async () => {
                            await props.onRemoveCardResources({
                              cardId: card.id, packageId: archive.packageId, expectedInstallationVersion: installed.version,
                            })
                            notify.success(props.t('renderer.resourcesRemoved'))
                          })
                        }}
                      ><PackageMinus aria-hidden="true" size={16} /></button>
                    </> : null}
                    <button
                      type="button"
                      title={props.t('renderer.detachPackage')}
                      aria-label={props.t('renderer.detachPackage')}
                      disabled={Boolean(busyKey)}
                      onClick={() => {
                        const card = props.embeddedPackageCard!
                        if (!window.confirm(props.t('renderer.detachPackageConfirm', { name: archive.packageId }))) return
                        void run(`${card.id}/${archive.packageId}/detach`, async () => {
                          await props.onDetachPackage(card.id, card.version, archive.packageId)
                          notify.success(props.t('notify.success.deleted'))
                        })
                      }}
                    ><Trash2 aria-hidden="true" size={16} /></button>
                  </div>
                )})}
                {!props.embeddedPackageCard.extensionPackages?.length ? <p className={styles.summaryEmpty}><Package size={14} aria-hidden="true" /><span>{props.t('renderer.noEmbeddedPackages')}</span></p> : null}
              </section>
            ) : null}
            {props.cardPackages.length > 0 ? (
              <details className={styles.embeddedPackages} open>
                <summary>{props.t('renderer.cardInstallations')}</summary>
                {(view === 'packages' ? props.cardPackages : []).filter(item => item.target?.kind === 'card' && item.target.cardId === props.embeddedPackageCard?.id).map(extensionPackage => {
                  const target = extensionPackage.target
                  if (target?.kind !== 'card') return null
                  const installed = props.installations.find(item => item.packageId === extensionPackage.packageId
                    && item.target.kind === 'card' && item.target.cardId === target.cardId)
                  return (
                    <section className={styles.treePackage} key={`${target.cardId}/${extensionPackage.packageId}`}>
                      <div className={styles.embeddedPackage}>
                        <span>{extensionPackage.displayName}<small>{extensionPackage.version}</small></span>
                        <button type="button" disabled={Boolean(busyKey) || !installed} title={props.t('renderer.uninstall')} aria-label={props.t('renderer.uninstall')}
                          onClick={() => {
                            if (!installed || !window.confirm(props.t('renderer.uninstallCardConfirm', { name: extensionPackage.displayName }))) return
                            void run(`${target.cardId}/${extensionPackage.packageId}/uninstall`, async () => {
                              await props.onUninstallCardPackage({
                                cardId: target.cardId, packageId: extensionPackage.packageId, expectedInstallationVersion: installed.version,
                              })
                              notify.success(props.t('renderer.uninstalled'))
                            })
                          }}><Trash2 aria-hidden="true" size={16} /></button>
                      </div>
                      <button className={styles.packageItem} type="button" onClick={() => select({ kind: 'card-package', packageId: extensionPackage.packageId, cardId: target.cardId })}>
                        <Package aria-hidden="true" />{props.t('renderer.packageDetails')}
                      </button>

                    </section>
                  )
                })}
              </details>
            ) : null}
            </div>
          </nav>
        )}
      >
        {storyDetails ? (
          <TimelineExtensionPanel
            key={JSON.stringify([props.timelineParticipation.timeline?.id, props.timelineParticipation.timeline?.branchId, props.embeddedPackageCard?.id])}
            {...props.timelineParticipation}
            installations={props.installations}
            t={props.t}
          />
        ) : (
          <div className={styles.detail}>
          {selection && selection.kind !== 'package' && selection.kind !== 'card-package' ? <Button size="small" onClick={() => select(cardPackage?.target?.kind === 'card'
            ? { kind: 'card-package', packageId: cardPackage.packageId, cardId: cardPackage.target.cardId }
            : { kind: 'package', packageId: selection.packageId })}><ArrowLeft size={14} aria-hidden="true" />{props.t('renderer.packageDetails')}</Button> : null}
          {cardSelection ? (
            cardPackage && cardModule ? <ModuleDetail busyKey={busyKey} clientSummaries={clientSummaries}
              extensionPackage={cardPackage} module={cardModule} t={props.t} /> : <p className={styles.empty}>{props.t('renderer.moduleUnavailable')}</p>

          ) : cardPackageSelection && cardPackage ? (
            <>
              <header className={styles.packageHeader}><h3>{cardPackage.displayName}</h3><code>{cardPackage.packageId}@{cardPackage.version}</code>
                <Button disabled={Boolean(busyKey) || !cardPackage.available || !cardPackage.modules.length} onClick={() => void togglePackage(cardPackage)}>
                  {props.t(cardPackage.modules.every(module => module.desired.enabled) ? 'renderer.disablePackage' : 'renderer.enablePackage')}
                </Button>
              </header>
              <ExtensionPackageTabs key={`${cardPackage.target?.kind === 'card' ? cardPackage.target.cardId : ''}:${cardPackage.packageId}`} t={props.t}
                resources={resourcePanel(cardPackage)} settings={settingsPanel(cardPackage)} overview={<>
                  {cardPackage.description ? <p>{cardPackage.description}</p> : null}
                  <PackageControls extensionPackage={cardPackage} clientSummaries={clientSummaries} busy={Boolean(busyKey)}
                    onGrant={(module, grants) => run(`${cardPackage.packageId}/${module.moduleId}/grant`, () => props.onEnable(cardPackage.packageId, module.moduleId, grants, cardPackage.target))}
                    onToggle={togglePackage} t={props.t} />
                  <ModuleNavigation extensionPackage={cardPackage} select={select} t={props.t} />
                </>} />
            </>
          ) : <>
          {selected && selectedItem?.kind === 'package' ? (
            <>
              {(() => {
                const packageEnabled = selected.modules.length > 0 && selected.modules.every(module => module.desired.enabled)
                return (
                  <header className={styles.packageHeader}>
                    <div className={styles.packageTitleRow}>
                      {selected.modules.length > 0 ? (
                        <button
                          type="button"
                          className={`${styles.powerBtn} ${packageEnabled ? styles.powerBtnActive : styles.powerBtnInactive}`}
                          title={props.t(packageEnabled ? 'renderer.disablePackage' : 'renderer.enablePackage')}
                          aria-label={props.t(packageEnabled ? 'renderer.disablePackage' : 'renderer.enablePackage')}
                          aria-pressed={packageEnabled}
                          disabled={Boolean(busyKey) || !selected.available}
                          onClick={() => void togglePackage(selected)}
                        >
                          <Power size={18} aria-hidden="true" />
                        </button>
                      ) : null}
                      <div className={styles.packageTitleInfo}>
                        <div className={styles.packageTitleHeading}>
                          <h3>{selected.displayName}</h3>
                          <span className={selected.available ? styles.statusBadgeAvailable : styles.statusBadgeUnavailable}>
                            {selected.available ? props.t('renderer.available') : props.t('renderer.unavailable')}
                          </span>
                        </div>
                        <code>{selected.packageId}@{selected.version}</code>
                        {installation ? <small>{props.t('renderer.review.versions', { code: selected.version, resources: installation.packageVersion })}</small> : null}
                      </div>
                    </div>
                    <div className={styles.packageToolbarRow}>
                      {props.serverDiagnostics.length > 0 && <InfoDialog title={`${props.t('renderer.serverDiagnostics')} · ${props.serverDiagnostics.length}`}><pre>{JSON.stringify(props.serverDiagnostics, null, 2)}</pre></InfoDialog>}
                      <button type="button" className={styles.actionBtn} onClick={() => navigate(buildStudioLogPath({ packageId: selected.packageId }))} title={props.t('logs.viewExtension')} aria-label={props.t('logs.viewExtension')}>
                        <TerminalSquare aria-hidden="true" />
                      </button>
                      {props.settingScopeContext.cardId ? (
                        <button
                          className={styles.actionBtn}
                          disabled={Boolean(busyKey) || !selected.available}
                          type="button"
                          onClick={() => {
                            const cardId = props.settingScopeContext.cardId
                            if (!cardId || !window.confirm(props.t('renderer.attachPackageConfirm', { name: selected.displayName }))) return
                            void run(`${selected.packageId}/attach`, async () => {
                              await props.onAttachPackage(cardId, selected.packageId, selected.version)
                              notify.success(props.t('renderer.packageAttached'))
                            })
                          }}
                          title={props.t('renderer.attachPackage')} aria-label={props.t('renderer.attachPackage')}
                        >
                          <PackagePlus aria-hidden="true" />
                        </button>
                      ) : null}
                      {installation ? (
                        <button
                          className={styles.actionBtn}
                          disabled={Boolean(busyKey) || !selected.available}
                          type="button"
                          onClick={() => {
                            const input = { packageId: selected.packageId, packageVersion: selected.version,
                              expectedInstallationVersion: installation.version }
                            setResourceUpdate({ title: selected.displayName, fromVersion: installation.packageVersion, input,
                              apply: (fingerprint: string, keepPromptResourceIds: string[]) => props.onUpdateResources({ ...input, expectedPreviewFingerprint: fingerprint, keepPromptResourceIds }) })
                          }}
                          title={props.t('renderer.updateResources')} aria-label={props.t('renderer.updateResources')}
                        >
                          <RefreshCw aria-hidden="true" />
                        </button>
                      ) : null}
                      {packageResourceCount(selected) > 0 ? (
                        <>
                          <button className={styles.actionBtn} disabled={busyKey === `${selected.packageId}/resources`} type="button" onClick={() => void run(`${selected.packageId}/resources`, () => importResources(selected.packageId))} title={props.t('renderer.importResources')} aria-label={props.t('renderer.importResources')}>
                            <PackageOpen aria-hidden="true" />
                          </button>
                          <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} disabled={busyKey === `${selected.packageId}/resources`} type="button" onClick={() => void run(`${selected.packageId}/resources`, () => removeResources(selected.packageId))} title={props.t('renderer.removeResources')} aria-label={props.t('renderer.removeResources')}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </>
                      ) : null}
                      {selected.sourceKinds.length === 1 && (selected.sourceKinds[0] === 'installed' || selected.sourceKinds[0] === 'dev-link') ? (
                        <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} disabled={busyKey === `${selected.packageId}/uninstall`} type="button" onClick={() => void run(`${selected.packageId}/uninstall`, () => uninstallPackage(selected.packageId, selected.version))} title={props.t('renderer.uninstall')} aria-label={props.t('renderer.uninstall')}>
                          <PackageMinus aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </header>
                )
              })()}
              <ExtensionPackageTabs key={selected.packageId} t={props.t} resources={resourcePanel(selected)} settings={settingsPanel(selected)} overview={<>
              {selected.description ? <p>{selected.description}</p> : null}
              <ExtensionRemoteControls key={selected.packageId} api={props.extensionApi} t={props.t}
                selected={selected} onInstalled={props.onRefreshExtensions} />
              <ExtensionCharacterCatalog key={`${selected.packageId}:${selected.version}`} packageId={selected.packageId}
                api={props.extensionApi} t={props.t} onImported={props.onCharacterImported}
                onOpen={cardId => navigate(`/studio/characters/${encodeURIComponent(cardId)}`)} />

              <PackageControls extensionPackage={selected} clientSummaries={clientSummaries} busy={Boolean(busyKey)}
                onGrant={(module, grants) => run(`${selected.packageId}/${module.moduleId}/grant`, () => props.onEnable(selected.packageId, module.moduleId, grants, selected.target))}
                onToggle={togglePackage} t={props.t} />
              <ModuleNavigation extensionPackage={selected} select={select} t={props.t} />
              </>} />
            </>
          ) : null}
          {selected && selectedModule && selectedItem?.kind === 'module' ? (
            <ModuleDetail
              busyKey={busyKey}
              clientSummaries={clientSummaries}
              extensionPackage={selected}
              module={selectedModule}
              t={props.t}
            />
          ) : null}
          {selected && selectedModule && selectedItem?.kind === 'renderer' ? (() => {
            const definition = (selectedModule.contributions.renderers ?? []).find(item => item.id === selectedItem.id)
            return definition ? (
              <RendererContributionRow
                claims={claims}
                definition={definition}
                diagnostics={[...rendererDiagnostics, ...clientDiagnostics.filter(item => item.packageId === selected.packageId && item.moduleId === selectedModule.moduleId && !item.commandId)]}
                host={props.host}
                instances={instances}
                module={selectedModule}
                packageId={selected.packageId}
                sessionHost={props.sessionHost}
                onOpenWorkspace={props.onOpenWorkspace}
                t={props.t}
              />
            ) : null
          })() : null}
          {selected && selectedModule && selectedItem?.kind === 'command' ? (() => {
            const command = (selectedModule.contributions.commands ?? []).find(item => item.id === selectedItem.id)
            const moduleKey = clientModuleKey(selected.packageId, selectedModule.moduleId, selected.target)
            return command ? (
              <ClientCommandRow
                actions={(selectedModule.contributions.actions ?? []).filter(action => action.commandId === command.id)}
                busy={busyKey === `${moduleKey}/${command.id}`}
                command={command}
                diagnostics={clientDiagnostics.filter(item => clientModuleKey(item.packageId, item.moduleId, item.target) === moduleKey && (item.commandId === command.id || item.code === 'client-extension.activation_failed'))}
                extensionHost={props.extensionHost}
                host={props.host}
                module={selectedModule}
                packageId={selected.packageId}
                target={selected.target}
                registered={commandRegistrations.some(registration => registration.commandKey === clientCommandKey(selected.packageId, selectedModule.moduleId, command.id, selected.target))}
                t={props.t}
                onBusyChange={busy => setBusyKey(busy ? `${moduleKey}/${command.id}` : undefined)}
              />
            ) : null
          })() : null}
          {!selected ? <p className={styles.empty}>{props.t('renderer.workspaceEmpty')}</p> : null}
          </>}
        </div>
      )}
      </MasterDetailWorkbench>
    </section>
  )
  return <MobileTabPages activeId={view} onChange={setView} header={mobileTabs} pages={[
    { id: 'packages', content: packagePage() },
    { id: 'scripts', content: scriptsPage('runtime') },
    { id: 'rules', content: scriptsPage('rules') },
  ]} />
}

function extensionIconUrl(extensionPackage: ManagedExtensionPackage): string | undefined {
  if (extensionPackage.iconUrl) return extensionPackage.iconUrl
  const entryUrl = extensionPackage.modules.find(module => module.runtimeKind === 'client')?.entryUrl
  if (!entryUrl) return undefined
  try { return new URL('../../../icon.png', entryUrl).href } catch { return undefined }
}

function readServerRuntimeState(runtime: ClientJsonValue | undefined): string | undefined {
  if (!runtime || Array.isArray(runtime) || typeof runtime !== 'object') return undefined
  const instance = runtime.instance
  if (!instance || Array.isArray(instance) || typeof instance !== 'object') return undefined
  return typeof instance.state === 'string' ? instance.state : undefined
}

function packageResourceCount(extensionPackage: ManagedExtensionPackage): number {
  return (extensionPackage.resources?.promptResources?.length ?? 0)
    + (extensionPackage.resources?.agentTools?.length ?? 0)
    + (extensionPackage.resources?.transformRules?.length ?? 0)
    + (extensionPackage.resources?.textExtractors?.length ?? 0)
    + (extensionPackage.resources?.loomScripts?.length ?? 0)
}

function ModuleNavigation(props: { extensionPackage: ManagedExtensionPackage; select(selection: ExtensionWorkspaceSelection): void; t: Translator }) {
  const pkg = props.extensionPackage
  return <section aria-label={props.t('renderer.modules')}>
    {pkg.modules.map(module => <div className={styles.moduleLinks} key={module.moduleId}>
      <TreeItem active={false} icon={Component} label={module.moduleId} onClick={() => props.select(pkg.target?.kind === 'card'
        ? { kind: 'card-module', packageId: pkg.packageId, cardId: pkg.target.cardId, moduleId: module.moduleId }
        : { kind: 'module', packageId: pkg.packageId, moduleId: module.moduleId })} />
      {pkg.target?.kind !== 'card' ? <>
        {(module.contributions.renderers ?? []).map(item => <TreeItem key={`renderer:${item.id}`} active={false} icon={Component} label={item.name}
          onClick={() => props.select({ kind: 'renderer', packageId: pkg.packageId, moduleId: module.moduleId, id: item.id })} />)}
        {(module.contributions.commands ?? []).map(item => <TreeItem key={`command:${item.id}`} active={false} icon={TerminalSquare} label={item.title}
          onClick={() => props.select({ kind: 'command', packageId: pkg.packageId, moduleId: module.moduleId, id: item.id })} />)}
      </> : null}
    </div>)}
  </section>
}

function PackageControls(props: {
  extensionPackage: ManagedExtensionPackage
  clientSummaries: ReturnType<ClientExtensionHost['summaries']>
  busy: boolean
  report?: { key: string; completed: string[]; failed: Array<{ moduleId: string; message: string }> }
  onToggle(extensionPackage: ManagedExtensionPackage): Promise<void>
  onGrant(module: ManagedExtensionModule, grants: ManagedExtensionModule['desired']['grants']): Promise<void>
  t: Translator
}) {
  const { extensionPackage } = props
  const modules = extensionPackage.modules
  const enabled = modules.filter(module => module.desired.enabled).length
  const isRunning = (module: ManagedExtensionModule) => {
    const client = props.clientSummaries.find(item => clientModuleKey(item.packageId, item.moduleId, item.target)
      === clientModuleKey(extensionPackage.packageId, module.moduleId, extensionPackage.target))
    return readServerRuntimeState(module.runtime) === 'active' || readServerRuntimeState(module.runtime) === 'degraded'
      || Boolean(client?.instanceId && (client.state === 'active' || client.state === 'degraded'))
  }
  const running = modules.filter(isRunning).length
  const key = `${extensionPackage.target?.kind === 'card' ? extensionPackage.target.cardId : 'global'}/${extensionPackage.packageId}`
  return <>
    {modules.length ? <section className={styles.moduleDetail}>
      <header>
        <div><h3>{props.t('renderer.packageRuntime')}</h3>
          <small>{props.t('renderer.packageState', { enabled, total: modules.length, running })}</small></div>
      </header>
      <div className={styles.runtimeModuleList}>
        {modules.map(module => {
          const isModuleRunning = isRunning(module)
          return (
            <div key={module.moduleId} className={styles.runtimeModuleRow}>
              <strong>{module.moduleId}</strong>
              {module.runtimeKind === 'client-worker' ? <small>Worker · 线程隔离，可访问浏览器网络与存储</small> : null}
              <span className={module.desired.enabled ? styles.runtimeEnabledText : styles.runtimeDisabledText}>
                {props.t(module.desired.enabled ? 'renderer.enabled' : 'renderer.disabled')}
              </span>
              <span className={styles.runtimeSeparator}>·</span>
              <span className={isModuleRunning ? styles.runtimeStateRunning : styles.runtimeStateIdle}>
                {props.t(isModuleRunning ? 'renderer.moduleRunning' : 'renderer.moduleNotRunning')}
              </span>
            </div>
          )
        })}
      </div>
      {modules.map(module => <div key={`${module.moduleId}:grants`}>
        {module.desired.enabled && (module.runtimeKind === 'client' || module.runtimeKind === 'client-worker') && module.requestedUiCapabilities?.includes('ui.notify') ? <label>
          <input type="checkbox" disabled={props.busy} checked={module.desired.grants?.ui?.includes('ui.notify') ?? false}
            onChange={event => void props.onGrant(module, { ui: event.currentTarget.checked ? ['ui.notify'] : [] })} />
          {module.moduleId}: {props.t('renderer.allowNotifications')}
        </label> : null}
        {module.desired.enabled && (module.requestedEventCapabilities ?? []).map(capability => <label key={capability}>
          <input type="checkbox" disabled={props.busy} checked={module.desired.grants?.['events.subscribe']?.includes(capability) ?? false}
            onChange={event => void props.onGrant(module, { 'events.subscribe': event.currentTarget.checked
              ? [...(module.desired.grants?.['events.subscribe'] ?? []), capability]
              : (module.desired.grants?.['events.subscribe'] ?? []).filter(item => item !== capability) })} />
          {module.moduleId}: events.subscribe: {capability}
        </label>)}
        {module.desired.enabled && (module.requestedAssetCapabilities ?? []).map(capability => <label key={capability}>
          <input type="checkbox" disabled={props.busy} checked={module.desired.grants?.assets?.includes(capability) ?? false}
            onChange={event => void props.onGrant(module, { assets: event.currentTarget.checked
              ? [...(module.desired.grants?.assets ?? []), capability]
              : (module.desired.grants?.assets ?? []).filter(item => item !== capability) })} />
          {module.moduleId}: {capability}
        </label>)}
      </div>)}
      {props.report?.key === key ? <div role="status">
        <p>{props.t('renderer.packageCompleted')}: {props.report.completed.join(', ') || '—'}</p>
        {props.report.failed.map(item => <p key={item.moduleId} role="alert">{item.moduleId}: {item.message}</p>)}
      </div> : null}
    </section> : null}
  </>
}

function TreeItem(props: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick(): void
}) {
  const Icon = props.icon
  return (
    <button aria-current={props.active ? 'page' : undefined} className={styles.treeItem} type="button" onClick={props.onClick}>
      <Icon aria-hidden="true" />
      <span>{props.label}</span>
    </button>
  )
}

function ModuleDetail(props: {
  busyKey: string | undefined
  clientSummaries: ReturnType<ClientExtensionHost['summaries']>
  extensionPackage: ManagedExtensionPackage
  module: ManagedExtensionModule
  t: Translator
}) {
  const target = props.extensionPackage.target
  const moduleKey = clientModuleKey(props.extensionPackage.packageId, props.module.moduleId, target)
  const summary = props.clientSummaries.find(item => clientModuleKey(item.packageId, item.moduleId, item.target) === moduleKey)
  const running = Boolean(summary?.instanceId && (summary.state === 'active' || summary.state === 'degraded'))
    || readServerRuntimeState(props.module.runtime) === 'active' || readServerRuntimeState(props.module.runtime) === 'degraded'

  return (
    <article className={styles.moduleDetail}>
      <header>
        <div><h3>{props.module.moduleId}</h3><small>{props.module.runtimeKind} · {running ? props.t('renderer.moduleRunning') : props.t('renderer.moduleNotRunning')}</small></div>
      </header>
      <dl className={styles.detailFacts}>
        <div><dt>{props.t('renderer.owner')}</dt><dd><code>{props.extensionPackage.packageId}</code></dd></div>
        {target?.kind === 'card' ? <div><dt>{props.t('renderer.cardInstallations')}</dt><dd><code>{target.cardId}</code></dd></div> : null}
        <div><dt>{props.t('renderer.runtime')}</dt><dd>{props.module.runtimeKind}</dd></div>
        <div><dt>{props.t('renderer.status')}</dt><dd>{props.module.desired.enabled ? props.t('renderer.enabled') : props.t('renderer.disabled')} · {running ? props.t('renderer.moduleRunning') : props.t('renderer.moduleNotRunning')}</dd></div>
      </dl>
      {summary?.error ? <p role="alert">{summary.error}</p> : null}
      <pre>{JSON.stringify({ requested: props.module.requestedCapabilities, grants: props.module.desired.grants }, null, 2)}</pre>
      {(props.module.contributions.renderers ?? []).length === 0 && (props.module.contributions.commands ?? []).length === 0 ? <p>{props.t('renderer.noContributions')}</p> : null}
    </article>
  )
}

function ClientCommandRow(props: {
  target?: ExtensionInstallationTarget
  actions: readonly ClientActionPlacement[]
  busy: boolean
  command: ClientCommandDeclaration
  diagnostics: Array<{ code: string; message: string }>
  extensionHost: ClientExtensionHost
  host: ClientRendererHost
  module: ManagedExtensionModule
  packageId: string
  registered: boolean
  t: Translator
  onBusyChange(busy: boolean): void
}) {
  const [commandError, setCommandError] = useState<string>()
  const scopes = props.host.scopeSnapshot()
  const invocationContext = {
    sourceSurface: 'extension.workbench.actions' as const,
    workspaceId: scopes.workspace,
    ...(scopes.cardId ? { cardId: scopes.cardId } : {}),
    ...(scopes.timelineId ? { timelineId: scopes.timelineId } : {}),
    ...(scopes.agentSessionId ? { agentSessionId: scopes.agentSessionId } : {}),
  }
  const workbenchActions = props.actions.filter(action => action.surface === 'extension.workbench.actions'
    && matchesClientActionCondition(action, invocationContext))

  async function execute() {
    props.onBusyChange(true)
    setCommandError(undefined)
    try {
      const result = await props.extensionHost.executeCommand({
        packageId: props.packageId,
        moduleId: props.module.moduleId,
        commandId: props.command.id,
        target: props.target,
        sourceSurface: 'extension.workbench.actions',
      })
      if (result.status === 'failed') setCommandError(result.message)
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error))
    } finally {
      props.onBusyChange(false)
    }
  }

  return (
    <article className={styles.contribution} data-command-state={props.registered ? 'registered' : 'declared'}>
      <div className={styles.contributionMain}>
        <strong>{props.command.title}</strong>
        {commandError ? <p role="alert">{commandError}</p> : null}
        <small>{props.command.id} · {props.t(props.registered ? 'renderer.commandRegistered' : 'renderer.commandDeclared')}</small>
        <small>{props.actions.map(action => action.surface).join(' · ') || props.t('renderer.commandNoPlacements')}</small>
        {props.diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`}>{diagnostic.code}: {diagnostic.message}</p>)}
      </div>
      {workbenchActions.length > 0 ? (
        <div className={styles.actions}>
          <button disabled={!props.module.desired.enabled || props.busy} type="button" onClick={() => void execute()}>
            {props.command.icon ? <ClientActionIcon name={props.command.icon} /> : null}
            <span>{props.t('renderer.runCommand')}</span>
          </button>
        </div>
      ) : null}
    </article>
  )
}

function RendererContributionRow(props: {
  onOpenWorkspace(): void
  claims: ReturnType<ClientRendererHost['activeClaims']>
  definition: RendererContributionDefinition
  diagnostics: Array<{ code: string; message: string; contributionKey?: string }>
  host: ClientRendererHost
  instances: ReturnType<ClientRendererHost['instances']>
  module: ManagedExtensionModule
  packageId: string
  sessionHost: RendererSessionHost
  t: Translator
}) {
  const key = rendererContributionKey({
    owner: { kind: 'extension', packageId: props.packageId, moduleId: props.module.moduleId },
    contributionId: props.definition.id,
  })
  const registration = props.host.find(key)
  const activeInstances = props.instances.filter(instance => instance.contributionKey === key)
  const claim = props.claims.find(item => item.contributionKey === key)
  const policy = rendererSurfacePolicies[props.definition.surface]
  const diagnostics = props.diagnostics.filter(item => !item.contributionKey || item.contributionKey === key)
  const scopeKey = resolveCurrentScopeKey(props.host, props.definition)
  const ordered = policy === 'collection' ? props.host.list(props.definition.surface) : []
  const orderIndex = ordered.findIndex(item => rendererContributionKey(item) === key)

  function move(offset: number) {
    if (orderIndex < 0) return
    const keys = ordered.map(rendererContributionKey)
    const target = orderIndex + offset
    if (target < 0 || target >= keys.length) return
    ;[keys[orderIndex], keys[target]] = [keys[target]!, keys[orderIndex]!]
    props.host.setUserOrder(props.definition.surface, keys)
  }

  function open(replace = false) {
    if (!registration || !scopeKey) return
    if (props.definition.surface === 'standalone.page') {
      props.sessionHost.open(registration, { kind: props.definition.instanceScope, key: scopeKey })
      return
    }
    const result = props.host.claim(props.definition.surface, scopeKey, key, { replace })
    if (result.accepted && props.definition.surface === 'shell.workspace-panel') props.onOpenWorkspace()
  }

  const occupied = scopeKey ? props.host.activeContributionKey(props.definition.surface, scopeKey) : undefined
  return (
    <article className={styles.contribution} data-renderer-state={registration ? 'registered' : 'inactive'}>
      <div className={styles.contributionMain}>
        <strong>{props.definition.name}</strong>
        <small>{props.definition.surface} · {props.definition.instanceScope} · {props.definition.adapter ?? 'direct'}</small>
        <small>{registration ? props.t('renderer.registered') : props.t('renderer.notRegistered')} · {activeInstances.length} {props.t('renderer.activeInstances')}</small>
        {claim ? <small>{props.t('renderer.claimedAt')} {claim.scopeKey}</small> : null}
        {diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`}>{diagnostic.code}: {diagnostic.message}</p>)}
      </div>
      <div className={styles.actions}>
        {policy === 'collection' ? (
          <>
            <button disabled={orderIndex <= 0} title={props.t('renderer.moveUp')} type="button" onClick={() => move(-1)}><ArrowUp aria-hidden="true" /></button>
            <button disabled={orderIndex < 0 || orderIndex >= ordered.length - 1} title={props.t('renderer.moveDown')} type="button" onClick={() => move(1)}><ArrowDown aria-hidden="true" /></button>
          </>
        ) : (
          <button disabled={!registration || !scopeKey} type="button" onClick={() => open(Boolean(occupied && occupied !== key))}>
            {props.definition.surface === 'standalone.page' ? <ExternalLink aria-hidden="true" /> : null}
            <span>{occupied && occupied !== key ? props.t('renderer.replace') : props.t('renderer.open')}</span>
          </button>
        )}
      </div>
    </article>
  )
}

function resolveCurrentScopeKey(host: ClientRendererHost, definition: RendererContributionDefinition): string | undefined {
  const scopes = host.scopeSnapshot()
  if (definition.instanceScope === 'workspace') return scopes.workspace
  if (definition.instanceScope === 'timeline') return scopes.timelineId
  if (definition.instanceScope === 'agent-session') return scopes.agentSessionId
  return undefined
}
