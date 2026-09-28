import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ClientActionPlacement, ClientCommandDeclaration, ExtensionInstallationTarget, RendererContributionDefinition } from '@loom-studio/extension-sdk'
import { ArrowDown, ArrowLeft, ArrowUp, Braces, Component, ExternalLink, FileSearch, Package, PackageMinus, PackagePlus, Power, RefreshCw, SlidersHorizontal, TerminalSquare, Trash2 } from 'lucide-react'
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
import styles from './renderer-workspace-panel.module.scss'

const WORKSPACE_SCOPE_KEY = 'workspace'

type ExtensionWorkspaceSelection =
  | { kind: 'card-module'; packageId: string; moduleId: string; cardId: string }
  | { kind: 'package'; packageId: string }
  | { kind: 'settings'; packageId: string }
  | { kind: 'resource'; packageId: string; resourceKind: 'prompt' | 'tool' | 'rule' | 'extractor'; id: string }
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
  const cardPackage = cardSelection && props.cardPackages.find(item => item.packageId === cardSelection.packageId
    && item.target?.kind === 'card' && item.target.cardId === cardSelection.cardId)
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
        <h2>{props.t('renderer.workspaceTitle')}</h2>
        <p>{props.t('renderer.workspaceDescription')}</p>
        <small>{props.packages.length} · {instances.length} {props.t('renderer.activeInstances')}</small>
        <label>
          <PackagePlus aria-hidden="true" />
          <span>{props.t('renderer.installZip')}</span>
          <input accept=".zip,application/zip" type="file" onChange={event => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (file) void installZip(file)
          }} />
        </label>
      </header>
      <MasterDetailWorkbench
        masterWidth="minmax(180px, 0.34fr)"
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
                    {packageResourceCount(extensionPackage) > 0 ? (
                      <>
                        <span className={styles.treeGroupLabel}>{props.t('renderer.packageResources')}</span>
                        {(extensionPackage.resources?.promptResources ?? []).map(resource => (
                          <TreeItem active={selectedItem?.kind === 'resource' && selectedItem.resourceKind === 'prompt' && selectedItem.id === resource.id} icon={Braces} key={`prompt:${resource.id}`} label={resource.id} onClick={() => select({ kind: 'resource', packageId: extensionPackage.packageId, resourceKind: 'prompt', id: resource.id })} />
                        ))}
                        {(extensionPackage.resources?.agentTools ?? []).map(resource => (
                          <TreeItem active={selectedItem?.kind === 'resource' && selectedItem.resourceKind === 'tool' && selectedItem.id === resource.id} icon={TerminalSquare} key={`tool:${resource.id}`} label={resource.id} onClick={() => select({ kind: 'resource', packageId: extensionPackage.packageId, resourceKind: 'tool', id: resource.id })} />
                        ))}
                        {(extensionPackage.resources?.transformRules ?? []).map(resource => (
                          <TreeItem active={selectedItem?.kind === 'resource' && selectedItem.resourceKind === 'rule' && selectedItem.id === resource.id} icon={FileSearch} key={`rule:${resource.id}`} label={resource.id} onClick={() => select({ kind: 'resource', packageId: extensionPackage.packageId, resourceKind: 'rule', id: resource.id })} />
                        ))}
                        {(extensionPackage.resources?.textExtractors ?? []).map(resource => (
                          <TreeItem active={selectedItem?.kind === 'resource' && selectedItem.resourceKind === 'extractor' && selectedItem.id === resource.id} icon={FileSearch} key={`extractor:${resource.id}`} label={resource.id} onClick={() => select({ kind: 'resource', packageId: extensionPackage.packageId, resourceKind: 'extractor', id: resource.id })} />
                        ))}
                      </>
                    ) : null}
                    {(extensionPackage.resources?.settings?.length ?? 0) > 0 ? (
                      <TreeItem active={selectedItem?.kind === 'settings'} icon={SlidersHorizontal} label={props.t('renderer.settings')} onClick={() => select({ kind: 'settings', packageId: extensionPackage.packageId })} />
                    ) : null}
                    {extensionPackage.modules.length > 0 ? <span className={styles.treeGroupLabel}>{props.t('renderer.modules')}</span> : null}
                    {extensionPackage.modules.map(module => (
                      <div className={styles.treeModule} key={module.moduleId}>
                        <TreeItem active={selectedItem?.kind === 'module' && selectedItem.moduleId === module.moduleId} icon={Component} label={module.moduleId} onClick={() => select({ kind: 'module', packageId: extensionPackage.packageId, moduleId: module.moduleId })} />
                        <div className={styles.treeChildren}>
                          {(module.contributions.renderers ?? []).map(definition => (
                            <TreeItem active={selectedItem?.kind === 'renderer' && selectedItem.moduleId === module.moduleId && selectedItem.id === definition.id} icon={Braces} key={definition.id} label={definition.name} onClick={() => select({ kind: 'renderer', packageId: extensionPackage.packageId, moduleId: module.moduleId, id: definition.id })} />
                          ))}
                          {(module.contributions.commands ?? []).map(command => (
                            <TreeItem active={selectedItem?.kind === 'command' && selectedItem.moduleId === module.moduleId && selectedItem.id === command.id} icon={TerminalSquare} key={command.id} label={command.title} onClick={() => select({ kind: 'command', packageId: extensionPackage.packageId, moduleId: module.moduleId, id: command.id })} />
                          ))}
                        </div>
                      </div>
                    ))}
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
                      <div className={styles.treeChildren}>
                        {props.promptResources.filter(resource => resource.origin?.kind === 'extension-package'
                          && resource.origin.packageId === extensionPackage.packageId
                          && installed && resource.origin.installationId === installed.id
                        ).map(resource => <TreeItem key={resource.id} active={false} icon={Braces}
                          label={resource.rootNode.label} onClick={() => props.onOpenPromptResource(resource)} />)}
                        {extensionPackage.modules.map(module => (
                          <TreeItem key={module.moduleId} icon={Component} label={`${module.moduleId} · ${module.runtimeKind}`}
                            active={cardSelection?.cardId === target.cardId && cardSelection.packageId === extensionPackage.packageId && cardSelection.moduleId === module.moduleId}
                            onClick={() => select({ kind: 'card-module', packageId: extensionPackage.packageId, moduleId: module.moduleId, cardId: target.cardId })} />
                        ))}
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
              extensionPackage={cardPackage} module={cardModule} onDisable={props.onDisable} onEnable={props.onEnable}
              onReload={props.onReload} run={run} t={props.t} /> : <p className={styles.empty}>{props.t('renderer.moduleUnavailable')}</p>
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
            </>
          ) : null}
          {selected && selectedItem?.kind === 'resource' ? <PackageResourceDetail extensionPackage={selected} selection={selectedItem} t={props.t} /> : null}
          {selected && selectedItem?.kind === 'settings' ? (
            <ExtensionSettingsForm
              api={props.extensionRuntime}
              configRevision={props.configRevision}
              packageId={selected.packageId}
              scopeContext={props.settingScopeContext}
              settings={selected.resources?.settings ?? []}
              t={props.t}
            />
          ) : null}
          {selected && selectedModule && selectedItem?.kind === 'module' ? (
            <ModuleDetail
              busyKey={busyKey}
              clientSummaries={clientSummaries}
              extensionPackage={selected}
              module={selectedModule}
              onDisable={props.onDisable}
              onEnable={props.onEnable}
              onReload={props.onReload}
              run={run}
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
  selection: Extract<ExtensionWorkspaceSelection, { kind: 'resource' }>
  t: Translator
}) {
  const resources = props.extensionPackage.resources
  const resource = props.selection.resourceKind === 'prompt'
    ? resources?.promptResources?.find(item => item.id === props.selection.id)
    : props.selection.resourceKind === 'tool'
      ? resources?.agentTools?.find(item => item.id === props.selection.id)
      : props.selection.resourceKind === 'rule'
        ? resources?.transformRules?.find(item => item.id === props.selection.id)
        : resources?.textExtractors?.find(item => item.id === props.selection.id)
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
        : props.t('renderer.textExtractor')

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
  onDisable(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<unknown>
  onEnable(packageId: string, moduleId: string, grants?: Parameters<StudioApi['extensions']['enable']>[2], target?: ExtensionInstallationTarget): Promise<unknown>
  onReload(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<unknown>
  run(key: string, operation: () => Promise<unknown>): Promise<void>
  t: Translator
}) {
  const target = props.extensionPackage.target
  const moduleKey = clientModuleKey(props.extensionPackage.packageId, props.module.moduleId, target)
  const summary = props.clientSummaries.find(item => clientModuleKey(item.packageId, item.moduleId, item.target) === moduleKey)
  const running = Boolean(summary?.instanceId && (summary.state === 'active' || summary.state === 'degraded'))
    || readServerRuntimeState(props.module.runtime) === 'active' || readServerRuntimeState(props.module.runtime) === 'degraded'
  const enable = (grants?: Parameters<StudioApi['extensions']['enable']>[2]) => props.onEnable(props.extensionPackage.packageId, props.module.moduleId, grants, target)
  const busy = Boolean(props.busyKey)

  return (
    <article className={styles.moduleDetail}>
      <header>
        <div><h3>{props.module.moduleId}</h3><small>{props.module.runtimeKind} · {running ? props.t('renderer.moduleRunning') : props.t('renderer.moduleNotRunning')}</small></div>
        <div className={styles.actions}>
          <button disabled={busy} title={props.module.desired.enabled ? props.t('renderer.disable') : props.t('renderer.enable')} type="button" onClick={() => {
            if (!props.module.desired.enabled && target?.kind === 'card'
              && !window.confirm(props.t('renderer.enableCardModuleConfirm', { name: props.module.moduleId, capabilities: JSON.stringify(props.module.requestedCapabilities ?? {}, null, 2) }))) return
            void props.run(moduleKey, () => props.module.desired.enabled ? props.onDisable(props.extensionPackage.packageId, props.module.moduleId, target) : enable())
          }}><Power aria-hidden="true" /></button>
          <button disabled={!props.module.desired.enabled || busy} title={props.t('renderer.reload')} type="button" onClick={() => void props.run(moduleKey, () => props.onReload(props.extensionPackage.packageId, props.module.moduleId, target))}><RefreshCw aria-hidden="true" /></button>
        </div>
      </header>
      <dl className={styles.detailFacts}>
        <div><dt>{props.t('renderer.owner')}</dt><dd><code>{props.extensionPackage.packageId}</code></dd></div>
        {target?.kind === 'card' ? <div><dt>{props.t('renderer.cardInstallations')}</dt><dd><code>{target.cardId}</code></dd></div> : null}
        <div><dt>{props.t('renderer.runtime')}</dt><dd>{props.module.runtimeKind}</dd></div>
        <div><dt>{props.t('renderer.status')}</dt><dd>{props.module.desired.enabled ? props.t('renderer.enabled') : props.t('renderer.disabled')} · {running ? props.t('renderer.moduleRunning') : props.t('renderer.moduleNotRunning')}</dd></div>
      </dl>
      {summary?.error ? <p role="alert">{summary.error}</p> : null}
      {props.module.runtimeKind === 'client' && props.module.requestedUiCapabilities?.includes('ui.notify') ? (
        <label>
          <input
            type="checkbox"
            checked={props.module.desired.grants?.ui?.includes('ui.notify') ?? false}
            disabled={!props.module.desired.enabled || busy}
            onChange={event => {
              const ui: Array<'ui.notify'> = event.currentTarget.checked ? ['ui.notify'] : []
              void props.run(moduleKey, () => enable({ ui }))
            }}
          />
          {props.t('renderer.allowNotifications')}
        </label>
      ) : null}
      {(props.module.requestedEventCapabilities ?? []).map(capability => (
        <label key={`event:${capability}`}>
          <input type="checkbox" disabled={!props.module.desired.enabled || busy}
            checked={props.module.desired.grants?.['events.subscribe']?.includes(capability) ?? false}
            onChange={event => {
              const previous = props.module.desired.grants?.['events.subscribe'] ?? []
              const grants = event.currentTarget.checked ? [...previous, capability] : previous.filter(item => item !== capability)
              void props.run(moduleKey, () => enable({ 'events.subscribe': grants }))
            }} />
          <code>events.subscribe: {capability}</code>
        </label>
      ))}
      {(props.module.requestedAssetCapabilities ?? []).map(capability => (
        <label key={capability}>
          <input type="checkbox" disabled={!props.module.desired.enabled || busy}
            checked={props.module.desired.grants?.assets?.includes(capability) ?? false}
            onChange={event => {
              const previous = props.module.desired.grants?.assets ?? []
              const grants = event.currentTarget.checked ? [...previous, capability] : previous.filter(item => item !== capability)
              void props.run(moduleKey, () => enable({ assets: grants }))
            }} />
          <code>{capability}</code>
        </label>
      ))}
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
