import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ClientActionPlacement, ClientCommandDeclaration, ExtensionInstallationTarget, RendererContributionDefinition } from '@loom-studio/extension-sdk'
import { ArrowDown, ArrowLeft, ArrowUp, Braces, Component, ExternalLink, Folder, Package, PackageMinus, PackagePlus, Power, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { buildStudioLogPath } from '../../../shared/studio-shell/studio-route.js'
import { toast } from 'sonner'
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
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { toggleExtensionPackage } from '../model/toggle-extension-package.js'
import styles from './renderer-workspace-panel.module.scss'

const WORKSPACE_SCOPE_KEY = 'workspace'

type ExtensionWorkspaceSelection =
  | { kind: 'card-module'; packageId: string; moduleId: string; cardId: string }
  | { kind: 'package'; packageId: string }
  | { kind: 'card-package'; packageId: string; cardId: string }
  | { kind: 'card-resource'; packageId: string; cardId: string; resourceKind: 'prompt' | 'tool' | 'rule' | 'extractor' | 'script'; id: string }
  | { kind: 'resource'; packageId: string; resourceKind: 'prompt' | 'tool' | 'rule' | 'extractor' | 'script'; id: string }
  | { kind: 'module'; packageId: string; moduleId: string }
  | { kind: 'renderer'; packageId: string; moduleId: string; id: string }
  | { kind: 'command'; packageId: string; moduleId: string; id: string }

export function RendererWorkspacePanel(props: {
  extensionHost: ClientExtensionHost
  host: ClientRendererHost
  packages: readonly ManagedExtensionPackage[]
  cardPackages: readonly ManagedExtensionPackage[]
  serverDiagnostics: readonly ClientJsonValue[]
  sessionHost: RendererSessionHost
  t: Translator
  extensionRuntime: Pick<StudioApi['extensionRuntime'], 'getConfig' | 'listConfigs' | 'upsertConfig'>
  configRevision: number
  settingScopeContext: { cardId?: string; timelineId?: string; agentSessionId?: string }
  searchParams: URLSearchParams
  onNavigate(path: string): void
  onDisable(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<unknown>
  onEnable(packageId: string, moduleId: string, grants?: Parameters<StudioApi['extensions']['enable']>[2], target?: ExtensionInstallationTarget): Promise<unknown>
  onImportResources(packageId: string): Promise<unknown>
  onAttachPackage(cardId: string, packageId: string, version: string): Promise<unknown>
  embeddedPackageCard?: Pick<Card, 'id' | 'version' | 'name' | 'extensionPackages'>
  onDetachPackage(cardId: string, expectedVersion: number, packageId: string): Promise<unknown>
  onInstallCardPackage(input: Parameters<StudioApi['extensions']['installCard']>[0]): Promise<unknown>
  onUpdateCardPackage(input: Parameters<StudioApi['extensions']['updateCard']>[0]): Promise<unknown>
  onUninstallCardPackage(input: Parameters<StudioApi['extensions']['uninstallCard']>[0]): Promise<unknown>
  onRemoveCardResources(input: Parameters<StudioApi['extensions']['removeCardResources']>[0]): Promise<unknown>
  installations: ListExtensionInstallationsResult['installations']
  promptResources: PromptResource[]
  onOpenPromptResource(resource: PromptResource): void
  onUpdateResources(input: Parameters<StudioApi['extensions']['updateResources']>[0]): Promise<unknown>
  onInstallZip(file: File): Promise<unknown>
  onRemoveResources(packageId: string): Promise<unknown>
  onReload(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<unknown>
  onUninstall(packageId: string, version?: string): Promise<unknown>
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
  const [busyKey, setBusyKey] = useState<string>()
  const [expandedIds, setExpandedIds] = useState<string[]>(() => [...props.packages, ...props.cardPackages].flatMap(item => {
    const prefix = `${item.target?.kind === 'card' ? item.target.cardId : 'global'}:${item.packageId}:`
    return [`${prefix}resources`, `${prefix}modules`, ...['prompt', 'tool', 'rule', 'extractor'].map(kind => `${prefix}resources:${kind}`)]
  }))
  const [toggleReport, setToggleReport] = useState<{ key: string; completed: string[]; failed: Array<{ moduleId: string; message: string }> }>()
  async function installZip(file: File) {
    await run('install-zip', async () => {
      await props.onInstallZip(file)
      toast.success(props.t('renderer.installed'))
    })
  }
  const registrations = props.host.list('shell.workspace-panel')
  const activeKey = props.host.activeContributionKey('shell.workspace-panel', WORKSPACE_SCOPE_KEY)
  const active = registrations.find(registration => rendererContributionKey(registration) === activeKey)
  const activeOwner = active?.owner
  const activePackage = activeOwner?.kind === 'extension' ? props.packages.find(item => item.packageId === activeOwner.packageId) : undefined
  const activeIconUrl = activePackage ? extensionIconUrl(activePackage) : undefined

  if (active) {
    return (
      <section className={styles.panel} data-loom-component="renderer-workspace-panel">
        <header className={styles.header}>
          <button type="button" onClick={() => props.host.release('shell.workspace-panel', WORKSPACE_SCOPE_KEY, activeKey)}>
            <ArrowLeft aria-hidden="true" />
            <span>{props.t('renderer.back')}</span>
          </button>
          <strong className={styles.activeTitle}>
            {activeIconUrl ? <img className={styles.activeIcon} src={activeIconUrl} alt="" aria-hidden="true" /> : null}
            <span>{active.definition.name}</span>
          </strong>
        </header>
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
  const cardResourceSelection = selection?.kind === 'card-resource' ? selection : undefined
  const cardTargetSelection = cardSelection ?? cardPackageSelection ?? cardResourceSelection
  const cardPackage = cardTargetSelection && props.cardPackages.find(item => item.packageId === cardTargetSelection.packageId
    && item.target?.kind === 'card' && item.target.cardId === cardTargetSelection.cardId)
  const cardModule = cardPackage?.modules.find(item => item.moduleId === cardSelection?.moduleId)
  const selectedModule = selectedItem && 'moduleId' in selectedItem
    ? selected?.modules.find(module => module.moduleId === selectedItem.moduleId)
    : undefined

  function select(next: ExtensionWorkspaceSelection) {
    setSelection(next)
    setMobilePane('detail')
  }

  async function run(key: string, operation: () => Promise<unknown>) {
    setBusyKey(key)
    try {
      await operation()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
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
    setBusyKey(key)
    setToggleReport(undefined)
    try {
      const report = await toggleExtensionPackage({
        packageId: extensionPackage.packageId, target, modules: extensionPackage.modules, enabled,
        enable: props.onEnable, disable: props.onDisable,
      })
      setToggleReport({ key, ...report })
      if (report.failed.length) toast.error(props.t('renderer.packagePartial'))
    } finally {
      setBusyKey(undefined)
    }
  }

  async function importResources(packageId: string) {
    try {
      await props.onImportResources(packageId)
      toast.success(props.t('renderer.resourcesImported'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeResources(packageId: string) {
    if (!window.confirm(props.t('renderer.removeResourcesConfirm'))) return
    try {
      await props.onRemoveResources(packageId)
      toast.success(props.t('renderer.resourcesRemoved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function uninstallPackage(packageId: string, version: string) {
    if (!window.confirm(props.t('renderer.uninstallConfirm'))) return
    try {
      await props.onUninstall(packageId, version)
      toast.success(props.t('renderer.uninstalled'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className={styles.panel} data-loom-component="renderer-workspace-panel">
      <header className={styles.intro}>
        <div><h2>{props.t('renderer.workspaceTitle')}</h2>
          <small>{props.packages.length} · {instances.length} {props.t('renderer.activeInstances')}</small></div>
        <label className={styles.installButton}>
          <PackagePlus aria-hidden="true" />
          <span>{props.t('renderer.installZip')}</span>
          <input aria-label={props.t('renderer.installZip')} accept=".zip,application/zip" type="file" onChange={event => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (file) void installZip(file)
          }} />
        </label>
      </header>
      <MasterDetailWorkbench
        masterWidth="minmax(210px, 0.24fr)"
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={(
          <nav aria-label={props.t('renderer.packages')} className={styles.packageTree}>
            <span className={styles.treeGroupLabel}>{props.t('renderer.packages')}</span>
            {props.packages.length === 0 ? <p className={styles.empty}>{props.t('renderer.workspaceEmpty')}</p> : props.packages.map(extensionPackage => (
              <section className={styles.treePackage} key={extensionPackage.packageId}>
                <button
                  aria-current={selectedItem?.kind === 'package' && extensionPackage.packageId === selected?.packageId ? 'page' : undefined}
                  className={styles.packageItem}
                  type="button"
                  onClick={() => select({ kind: 'package', packageId: extensionPackage.packageId })}
                >
                  {extensionIconUrl(extensionPackage) ? <img className={styles.packageIcon} src={extensionIconUrl(extensionPackage)} alt="" aria-hidden="true" /> : <Package aria-hidden="true" />}
                  <span><strong>{extensionPackage.displayName}</strong><small>{extensionPackage.packageId} · {extensionPackage.version}</small></span>
                </button>
                {extensionPackage.packageId === selected?.packageId ? (
                  <div className={styles.treeChildren}>
                    {props.promptResources.filter(resource => {
                      const origin = resource.origin
                      if (origin?.kind !== 'extension-package' || origin.packageId !== extensionPackage.packageId) return false
                      const installed = props.installations.find(item => item.id === origin.installationId)
                      return installed?.target.kind === 'global' || !origin.installationId
                    }).map(resource => <TreeItem key={`installed:${resource.id}`} active={false} icon={Braces}
                      label={resource.rootNode.label} onClick={() => props.onOpenPromptResource(resource)} />)}
                    <ExtensionFiles extensionPackage={extensionPackage} expandedIds={expandedIds}
                      onExpandedIdsChange={setExpandedIds} selection={selectedItem} select={select} t={props.t} />
                  </div>
                ) : null}
              </section>
            ))}
            {props.embeddedPackageCard ? (
              <details className={styles.embeddedPackages} key={props.embeddedPackageCard.id}>
                <summary>{props.t('renderer.embeddedPackages', { name: props.embeddedPackageCard.name })}</summary>
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
                          toast.success(props.t('renderer.installed'))
                        })
                      }}
                    ><PackagePlus aria-hidden="true" size={16} /></button>
                    {installed ? <>
                      <button
                        type="button" disabled={Boolean(busyKey)}
                        title={props.t('renderer.updateCardPackage')} aria-label={props.t('renderer.updateCardPackage')}
                        onClick={() => {
                          if (!window.confirm(props.t('renderer.updateCardPackageConfirm', { name: archive.packageId, from: installed.packageVersion, to: archive.version }))) return
                          void run(`${card.id}/${archive.packageId}/update`, () => props.onUpdateCardPackage({
                            cardId: card.id, packageId: archive.packageId, expectedCardVersion: card.version,
                            packageVersion: archive.version, expectedInstallationVersion: installed.version,
                          }))
                        }}
                      ><RefreshCw aria-hidden="true" size={16} /></button>
                      <button
                        type="button" disabled={Boolean(busyKey)}
                        title={props.t('renderer.removeCardResources')} aria-label={props.t('renderer.removeCardResources')}
                        onClick={() => {
                          if (!window.confirm(props.t('renderer.removeCardResourcesConfirm', { name: archive.packageId }))) return
                          void run(`${card.id}/${archive.packageId}/remove`, () => props.onRemoveCardResources({
                            cardId: card.id, packageId: archive.packageId, expectedInstallationVersion: installed.version,
                          }))
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
                        void run(`${card.id}/${archive.packageId}/detach`, () => props.onDetachPackage(card.id, card.version, archive.packageId))
                      }}
                    ><Trash2 aria-hidden="true" size={16} /></button>
                  </div>
                )})}
                {!props.embeddedPackageCard.extensionPackages?.length ? <p className={styles.empty}>{props.t('renderer.noEmbeddedPackages')}</p> : null}
              </details>
            ) : null}
            {props.cardPackages.length > 0 ? (
              <details className={styles.embeddedPackages} open>
                <summary>{props.t('renderer.cardInstallations')}</summary>
                {props.cardPackages.map(extensionPackage => {
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
                            void run(`${target.cardId}/${extensionPackage.packageId}/uninstall`, () => props.onUninstallCardPackage({
                              cardId: target.cardId, packageId: extensionPackage.packageId, expectedInstallationVersion: installed.version,
                            }))
                          }}><Trash2 aria-hidden="true" size={16} /></button>
                      </div>
                      <button className={styles.packageItem} type="button" onClick={() => select({ kind: 'card-package', packageId: extensionPackage.packageId, cardId: target.cardId })}>
                        <Package aria-hidden="true" />{props.t('renderer.settings')}
                      </button>
                      <div className={styles.treeChildren}>
                        {props.promptResources.filter(resource => resource.origin?.kind === 'extension-package'
                          && resource.origin.packageId === extensionPackage.packageId
                          && installed && resource.origin.installationId === installed.id
                        ).map(resource => <TreeItem key={resource.id} active={false} icon={Braces}
                          label={resource.rootNode.label} onClick={() => props.onOpenPromptResource(resource)} />)}
                        <ExtensionFiles extensionPackage={extensionPackage} expandedIds={expandedIds}
                          onExpandedIdsChange={setExpandedIds} selection={selection} select={select} t={props.t} />
                      </div>
                    </section>
                  )
                })}
              </details>
            ) : null}
          </nav>
        )}
      >
        <div className={styles.detail}>
          {cardSelection ? (
            cardPackage && cardModule ? <ModuleDetail busyKey={busyKey} clientSummaries={clientSummaries}
              extensionPackage={cardPackage} module={cardModule} t={props.t} /> : <p className={styles.empty}>{props.t('renderer.moduleUnavailable')}</p>
          ) : cardResourceSelection && cardPackage ? (
            <PackageResourceDetail extensionPackage={cardPackage} selection={cardResourceSelection} t={props.t} />
          ) : cardPackageSelection && cardPackage ? (
            <PackageControls extensionPackage={cardPackage} clientSummaries={clientSummaries} busy={Boolean(busyKey)} report={toggleReport}
              onGrant={(module, grants) => run(`${cardPackage.packageId}/${module.moduleId}/grant`, () => props.onEnable(cardPackage.packageId, module.moduleId, grants, cardPackage.target))}
              onToggle={togglePackage} settings={(cardPackage.resources?.settings?.length ?? 0) > 0
                ? <ExtensionSettingsForm api={props.extensionRuntime} configRevision={props.configRevision}
                  packageId={cardPackage.packageId} scopeContext={props.settingScopeContext} settings={cardPackage.resources?.settings ?? []} t={props.t} />
                : null}
              t={props.t} />
          ) : <>
          {selected && selectedItem?.kind === 'package' ? (
            <>
              <header className={styles.packageHeader}>
                <div><h3>{selected.displayName}</h3><code>{selected.packageId}@{selected.version}</code></div>
                <div className={styles.actions}>
                  <button type="button" onClick={() => navigate(buildStudioLogPath({ packageId: selected.packageId }))}><TerminalSquare aria-hidden="true" /><span>{props.t('logs.viewExtension')}</span></button>
                  {props.settingScopeContext.cardId ? (
                    <button
                      disabled={Boolean(busyKey) || !selected.available}
                      type="button"
                      onClick={() => {
                        const cardId = props.settingScopeContext.cardId
                        if (!cardId || !window.confirm(props.t('renderer.attachPackageConfirm', { name: selected.displayName }))) return
                        void run(`${selected.packageId}/attach`, async () => {
                          await props.onAttachPackage(cardId, selected.packageId, selected.version)
                          toast.success(props.t('renderer.packageAttached'))
                        })
                      }}
                    >
                      <PackagePlus aria-hidden="true" />
                      <span>{props.t('renderer.attachPackage')}</span>
                    </button>
                  ) : null}
                  {installation ? (
                    <button
                      disabled={Boolean(busyKey) || !selected.available}
                      type="button"
                      onClick={() => {
                        if (!window.confirm(props.t('renderer.updateResourcesConfirm', {
                          name: selected.displayName, from: installation.packageVersion, to: selected.version,
                        }))) return
                        void run(`${selected.packageId}/resources`, async () => {
                          await props.onUpdateResources({
                            packageId: selected.packageId,
                            packageVersion: selected.version,
                            expectedInstallationVersion: installation.version,
                          })
                          toast.success(props.t('renderer.resourcesUpdated'))
                        })
                      }}
                    >
                      <RefreshCw aria-hidden="true" />
                      <span>{props.t('renderer.updateResources')}</span>
                    </button>
                  ) : null}
                  {packageResourceCount(selected) > 0 ? (
                    <>
                      <button disabled={busyKey === `${selected.packageId}/resources`} type="button" onClick={() => void run(`${selected.packageId}/resources`, () => importResources(selected.packageId))}>
                        <PackagePlus aria-hidden="true" />
                        <span>{props.t('renderer.importResources')}</span>
                      </button>
                      <button disabled={busyKey === `${selected.packageId}/resources`} type="button" onClick={() => void run(`${selected.packageId}/resources`, () => removeResources(selected.packageId))}>
                        <Trash2 aria-hidden="true" />
                        <span>{props.t('renderer.removeResources')}</span>
                      </button>
                    </>
                  ) : null}
                  {selected.sourceKinds.length === 1 && (selected.sourceKinds[0] === 'installed' || selected.sourceKinds[0] === 'dev-link') ? (
                    <button disabled={busyKey === `${selected.packageId}/uninstall`} type="button" onClick={() => void run(`${selected.packageId}/uninstall`, () => uninstallPackage(selected.packageId, selected.version))}>
                      <Trash2 aria-hidden="true" />
                      <span>{props.t('renderer.uninstall')}</span>
                    </button>
                  ) : null}
                  <span>{selected.available ? props.t('renderer.available') : props.t('renderer.unavailable')}</span>
                </div>
              </header>
              {props.serverDiagnostics.length > 0 ? (
                <details className={styles.diagnostics}>
                  <summary>{props.t('renderer.serverDiagnostics')} · {props.serverDiagnostics.length}</summary>
                  <pre>{JSON.stringify(props.serverDiagnostics, null, 2)}</pre>
                </details>
              ) : null}
              <PackageControls extensionPackage={selected} clientSummaries={clientSummaries} busy={Boolean(busyKey)} report={toggleReport}
                onGrant={(module, grants) => run(`${selected.packageId}/${module.moduleId}/grant`, () => props.onEnable(selected.packageId, module.moduleId, grants, selected.target))}
                onToggle={togglePackage} settings={(selected.resources?.settings?.length ?? 0) > 0
                  ? <ExtensionSettingsForm api={props.extensionRuntime} configRevision={props.configRevision}
                    packageId={selected.packageId} scopeContext={props.settingScopeContext} settings={selected.resources?.settings ?? []} t={props.t} />
                  : null} t={props.t} />
            </>
          ) : null}
          {selected && selectedItem?.kind === 'resource' ? <PackageResourceDetail extensionPackage={selected} selection={selectedItem} t={props.t} /> : null}
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
      </MasterDetailWorkbench>
    </section>
  )
}

function extensionIconUrl(extensionPackage: ManagedExtensionPackage): string | undefined {
  if (extensionPackage.iconUrl) return extensionPackage.iconUrl
  const entryUrl = extensionPackage.modules.find(module => module.runtimeKind === 'client')?.entryUrl
  if (!entryUrl) return undefined
  try { return new URL('../../icon.png', entryUrl).href } catch { return undefined }
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

function ExtensionFiles(props: {
  extensionPackage: ManagedExtensionPackage
  expandedIds: string[]
  onExpandedIdsChange(ids: string[]): void
  selection?: ExtensionWorkspaceSelection
  select(selection: ExtensionWorkspaceSelection): void
  t: Translator
}) {
  const extensionPackage = props.extensionPackage
  const prefix = `${extensionPackage.target?.kind === 'card' ? extensionPackage.target.cardId : 'global'}:${extensionPackage.packageId}:`
  const selections = new Map<string, ExtensionWorkspaceSelection>()
  const resources: FileTreeNode[] = []
  for (const [kind, label, entries] of [
    ['prompt', props.t('renderer.promptResource'), extensionPackage.resources?.promptResources ?? []],
    ['tool', props.t('renderer.agentTool'), extensionPackage.resources?.agentTools ?? []],
    ['rule', props.t('renderer.transformRule'), extensionPackage.resources?.transformRules ?? []],
    ['extractor', props.t('renderer.textExtractor'), extensionPackage.resources?.textExtractors ?? []],
    ['script', props.t('renderer.loomScript'), extensionPackage.resources?.loomScripts ?? []],
  ] as const) {
    const children: FileTreeNode[] = []
    for (const resource of entries) {
      const id = `${prefix}${kind}:${resource.id}`
      children.push({ id, label: resource.id.startsWith(`${extensionPackage.packageId}/`)
        ? resource.id.slice(extensionPackage.packageId.length + 1) : resource.id, kind })
      selections.set(id, extensionPackage.target?.kind === 'card'
        ? { kind: 'card-resource', packageId: extensionPackage.packageId, cardId: extensionPackage.target.cardId, resourceKind: kind, id: resource.id }
        : { kind: 'resource', packageId: extensionPackage.packageId, resourceKind: kind, id: resource.id })
    }
    if (children.length) resources.push({ id: `${prefix}resources:${kind}`, label, kind: 'folder', children })
  }
  const modules: FileTreeNode[] = extensionPackage.modules.map(module => {
    const id = `${prefix}module:${module.moduleId}`
    selections.set(id, extensionPackage.target?.kind === 'card'
      ? { kind: 'card-module', packageId: extensionPackage.packageId, cardId: extensionPackage.target.cardId, moduleId: module.moduleId }
      : { kind: 'module', packageId: extensionPackage.packageId, moduleId: module.moduleId })
    const children: FileTreeNode[] = []
    if (extensionPackage.target?.kind !== 'card') {
      for (const definition of module.contributions.renderers ?? []) {
        const childId = `${id}:renderer:${definition.id}`
        children.push({ id: childId, label: definition.name, kind: 'renderer' })
        selections.set(childId, { kind: 'renderer', packageId: extensionPackage.packageId, moduleId: module.moduleId, id: definition.id })
      }
      for (const command of module.contributions.commands ?? []) {
        const childId = `${id}:command:${command.id}`
        children.push({ id: childId, label: command.title, kind: 'command' })
        selections.set(childId, { kind: 'command', packageId: extensionPackage.packageId, moduleId: module.moduleId, id: command.id })
      }
    }
    return { id, label: module.moduleId, kind: 'module', ...(children.length ? { children } : {}) }
  })
  const nodes: FileTreeNode[] = [
    ...(resources.length ? [{ id: `${prefix}resources`, label: props.t('renderer.packageResources'), kind: 'folder', children: resources }] : []),
    ...(modules.length ? [{ id: `${prefix}modules`, label: props.t('renderer.modules'), kind: 'folder', children: modules }] : []),
  ]
  const selectedId = [...selections].find(([, item]) => JSON.stringify(item) === JSON.stringify(props.selection))?.[0]
  return <FileTree ariaLabel={extensionPackage.displayName} nodes={nodes} expandedIds={props.expandedIds}
    onExpandedIdsChange={props.onExpandedIdsChange} selectedId={selectedId}
    getDisclosureLabel={node => node.label} getDragLabel={node => node.label} moreActionsLabel={props.t('context.actionMore')}
    onSelect={node => {
      if (node.children) {
        props.onExpandedIdsChange(props.expandedIds.includes(node.id)
          ? props.expandedIds.filter(id => id !== node.id) : [...props.expandedIds, node.id])
      } else {
        const item = selections.get(node.id)
        if (item) props.select(item)
      }
    }}
    renderIcon={node => node.kind === 'folder' ? <Folder size={16} /> : node.kind === 'module' ? <Component size={16} />
      : node.kind === 'command' || node.kind === 'tool' ? <TerminalSquare size={16} /> : <Braces size={16} />} />
}

function PackageControls(props: {
  extensionPackage: ManagedExtensionPackage
  clientSummaries: ReturnType<ClientExtensionHost['summaries']>
  busy: boolean
  report?: { key: string; completed: string[]; failed: Array<{ moduleId: string; message: string }> }
  onToggle(extensionPackage: ManagedExtensionPackage): Promise<void>
  onGrant(module: ManagedExtensionModule, grants: ManagedExtensionModule['desired']['grants']): Promise<void>
  settings: React.ReactNode
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
        <div className={styles.actions}><button type="button" disabled={props.busy || !extensionPackage.available}
          onClick={() => void props.onToggle(extensionPackage)}><Power aria-hidden="true" />
          <span>{props.t(enabled === modules.length ? 'renderer.disablePackage' : 'renderer.enablePackage')}</span></button></div>
      </header>
      <ul>{modules.map(module => <li key={module.moduleId}>{module.moduleId}: {props.t(module.desired.enabled ? 'renderer.enabled' : 'renderer.disabled')}
        {' · '}{props.t(isRunning(module) ? 'renderer.moduleRunning' : 'renderer.moduleNotRunning')}</li>)}</ul>
      {modules.map(module => <div key={`${module.moduleId}:grants`}>
        {module.desired.enabled && module.runtimeKind === 'client' && module.requestedUiCapabilities?.includes('ui.notify') ? <label>
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
    {props.settings}
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

function PackageResourceDetail(props: {
  extensionPackage: ManagedExtensionPackage
  selection: Extract<ExtensionWorkspaceSelection, { kind: 'resource' | 'card-resource' }>
  t: Translator
}) {
  const resources = props.extensionPackage.resources
  const resource = props.selection.resourceKind === 'prompt'
    ? resources?.promptResources?.find(item => item.id === props.selection.id)
    : props.selection.resourceKind === 'tool'
      ? resources?.agentTools?.find(item => item.id === props.selection.id)
      : props.selection.resourceKind === 'rule'
        ? resources?.transformRules?.find(item => item.id === props.selection.id)
        : props.selection.resourceKind === 'extractor'
          ? resources?.textExtractors?.find(item => item.id === props.selection.id)
          : resources?.loomScripts?.find(item => item.id === props.selection.id)
  if (!resource) return <p className={styles.empty}>{props.t('renderer.resourceMissing')}</p>

  const imported = props.selection.resourceKind === 'rule'
    ? props.extensionPackage.importedResources?.transformRuleContributionIds.includes(resource.id) ?? false
    : props.selection.resourceKind === 'extractor'
      ? props.extensionPackage.importedResources?.textExtractorContributionIds.includes(resource.id) ?? false
      : undefined
  const kind = props.selection.resourceKind === 'prompt'
    ? props.t('renderer.promptResource')
    : props.selection.resourceKind === 'tool'
      ? props.t('renderer.agentTool')
      : props.selection.resourceKind === 'rule'
        ? props.t('renderer.transformRule')
        : props.selection.resourceKind === 'extractor'
          ? props.t('renderer.textExtractor')
          : props.t('renderer.loomScript')

  return (
    <article className={styles.resourceDetail}>
      <header><Braces aria-hidden="true" /><div><h3>{resource.id}</h3><small>{kind}</small></div></header>
      <dl className={styles.detailFacts}>
        <div><dt>{props.t('renderer.owner')}</dt><dd><code>{props.extensionPackage.packageId}@{props.extensionPackage.version}</code></dd></div>
        <div><dt>{props.t('renderer.source')}</dt><dd><code>{resource.source}</code></dd></div>
        {imported === undefined ? null : <div><dt>{props.t('renderer.status')}</dt><dd>{props.t(imported ? 'renderer.resourceImported' : 'renderer.resourceDeclared')}</dd></div>}
      </dl>
      <pre>{JSON.stringify(resource, null, 2)}</pre>
    </article>
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
    try {
      const result = await props.extensionHost.executeCommand({
        packageId: props.packageId,
        moduleId: props.module.moduleId,
        commandId: props.command.id,
        target: props.target,
        sourceSurface: 'extension.workbench.actions',
      })
      if (result.status === 'failed') toast.error(result.message)
    } finally {
      props.onBusyChange(false)
    }
  }

  return (
    <article className={styles.contribution} data-command-state={props.registered ? 'registered' : 'declared'}>
      <div className={styles.contributionMain}>
        <strong>{props.command.title}</strong>
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
    props.host.claim(props.definition.surface, scopeKey, key, { replace })
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
