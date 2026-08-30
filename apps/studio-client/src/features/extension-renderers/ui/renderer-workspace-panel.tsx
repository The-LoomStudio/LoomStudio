import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ClientActionPlacement, ClientCommandDeclaration, RendererContributionDefinition } from '@loom-studio/extension-sdk'
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, PackagePlus, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { ManagedExtensionModule, ManagedExtensionPackage } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ClientExtensionHost } from '../model/client-extension-host.js'
import type { ClientRendererHost } from '../model/client-renderer-host.js'
import type { RendererSessionHost } from '../model/renderer-session.js'
import { rendererContributionKey, rendererSurfacePolicies } from '../model/renderer-registry.js'
import { clientCommandKey, matchesClientActionCondition } from '../model/client-actions.js'
import { ClientActionIcon } from './client-action-icon.js'
import { RendererSurfaceHost } from './renderer-surface-host.js'
import styles from './renderer-workspace-panel.module.scss'

const WORKSPACE_SCOPE_KEY = 'workspace'

export function RendererWorkspacePanel(props: {
  extensionHost: ClientExtensionHost
  host: ClientRendererHost
  packages: readonly ManagedExtensionPackage[]
  serverDiagnostics: readonly ClientJsonValue[]
  sessionHost: RendererSessionHost
  t: Translator
  onDisable(packageId: string, moduleId: string): Promise<unknown>
  onEnable(packageId: string, moduleId: string): Promise<unknown>
  onImportResources(packageId: string): Promise<unknown>
  onRemoveResources(packageId: string): Promise<unknown>
  onReload(packageId: string, moduleId: string): Promise<unknown>
  onUninstall(packageId: string, version?: string): Promise<unknown>
}) {
  useSyncExternalStore(props.host.subscribe, props.host.revision, props.host.revision)
  useSyncExternalStore(props.extensionHost.subscribe, props.extensionHost.revision, props.extensionHost.revision)
  useSyncExternalStore(props.sessionHost.subscribe, () => props.sessionHost.summaries().map(item => `${item.sessionId}:${item.state}`).join('|'), () => '')
  const [selectedPackageId, setSelectedPackageId] = useState(props.packages[0]?.packageId)
  const [busyKey, setBusyKey] = useState<string>()
  const registrations = props.host.list('shell.workspace-panel')
  const activeKey = props.host.activeContributionKey('shell.workspace-panel', WORKSPACE_SCOPE_KEY)
  const active = registrations.find(registration => rendererContributionKey(registration) === activeKey)

  if (active) {
    return (
      <section className={styles.panel} data-loom-component="renderer-workspace-panel">
        <header className={styles.header}>
          <button type="button" onClick={() => props.host.release('shell.workspace-panel', WORKSPACE_SCOPE_KEY, activeKey)}>
            <ArrowLeft aria-hidden="true" />
            <span>{props.t('renderer.back')}</span>
          </button>
          <strong>{active.definition.name}</strong>
        </header>
        <RendererSurfaceHost activeContributionKey={activeKey} className={styles.renderer} host={props.host} scope={{ kind: 'workspace', key: WORKSPACE_SCOPE_KEY }} surface="shell.workspace-panel" />
      </section>
    )
  }

  const selected = props.packages.find(item => item.packageId === selectedPackageId) ?? props.packages[0]
  const clientSummaries = props.extensionHost.summaries()
  const rendererDiagnostics = props.host.diagnostics()
  const clientDiagnostics = props.extensionHost.diagnostics()
  const instances = props.host.instances()
  const claims = props.host.activeClaims()
  const commandRegistrations = props.extensionHost.commandRegistrations()

  async function run(key: string, operation: () => Promise<unknown>) {
    setBusyKey(key)
    try {
      await operation()
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
      </header>
      <div className={styles.workbench}>
        <nav aria-label={props.t('renderer.packages')} className={styles.packageList}>
          {props.packages.length === 0 ? <p className={styles.empty}>{props.t('renderer.workspaceEmpty')}</p> : props.packages.map(extensionPackage => (
            <button aria-current={extensionPackage.packageId === selected?.packageId ? 'page' : undefined} key={extensionPackage.packageId} type="button" onClick={() => setSelectedPackageId(extensionPackage.packageId)}>
              <strong>{extensionPackage.displayName}</strong>
              <small>{extensionPackage.packageId} · {extensionPackage.version}</small>
            </button>
          ))}
        </nav>
        <div className={styles.detail}>
          {selected ? (
            <>
              <header className={styles.packageHeader}>
                <div><h3>{selected.displayName}</h3><code>{selected.packageId}@{selected.version}</code></div>
                <div className={styles.actions}>
                  {(selected.resources?.promptResources?.length ?? 0) + (selected.resources?.agentTools?.length ?? 0) > 0 ? (
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
              {(selected.resources?.promptResources?.length ?? 0) + (selected.resources?.agentTools?.length ?? 0) > 0 ? (
                <section className={styles.module}>
                  <header><div><strong>{props.t('renderer.packageResources')}</strong><small>{props.t('renderer.packageResourcesDescription')}</small></div></header>
                  <div className={styles.contributions}>
                    {(selected.resources?.promptResources ?? []).map(resource => (
                      <article className={styles.contribution} key={`prompt:${resource.id}`}>
                        <div className={styles.contributionMain}>
                          <strong>{resource.id}</strong>
                          <small>{resource.resourceKind} · {resource.source}</small>
                        </div>
                      </article>
                    ))}
                    {(selected.resources?.agentTools ?? []).map(tool => (
                      <article className={styles.contribution} key={`tool:${tool.id}`}>
                        <div className={styles.contributionMain}>
                          <strong>{tool.id}</strong>
                          <small>Agent Tool · {tool.source}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              {selected.modules.map(module => {
                const moduleKey = `${selected.packageId}/${module.moduleId}`
                const summary = clientSummaries.find(item => item.packageId === selected.packageId && item.moduleId === module.moduleId)
                return (
                  <section className={styles.module} key={moduleKey}>
                    <header>
                      <div><strong>{module.moduleId}</strong><small>{module.runtimeKind} · {summary?.state ?? 'inactive'}</small></div>
                      <div className={styles.actions}>
                        <button disabled={busyKey === moduleKey} title={module.desired.enabled ? props.t('renderer.disable') : props.t('renderer.enable')} type="button" onClick={() => void run(moduleKey, () => module.desired.enabled ? props.onDisable(selected.packageId, module.moduleId) : props.onEnable(selected.packageId, module.moduleId))}><Power aria-hidden="true" /></button>
                        <button disabled={!module.desired.enabled || busyKey === moduleKey} title={props.t('renderer.reload')} type="button" onClick={() => void run(moduleKey, () => props.onReload(selected.packageId, module.moduleId))}><RefreshCw aria-hidden="true" /></button>
                      </div>
                    </header>
                    {(module.contributions.renderers ?? []).length === 0 && (module.contributions.commands ?? []).length === 0 ? <p>{props.t('renderer.noContributions')}</p> : (
                      <div className={styles.contributions}>
                        {(module.contributions.renderers ?? []).map(definition => (
                          <RendererContributionRow
                            claims={claims}
                            definition={definition}
                            diagnostics={[
                              ...rendererDiagnostics,
                              ...clientDiagnostics.filter(item => item.packageId === selected.packageId && item.moduleId === module.moduleId && !item.commandId),
                            ]}
                            host={props.host}
                            instances={instances}
                            key={definition.id}
                            module={module}
                            packageId={selected.packageId}
                            sessionHost={props.sessionHost}
                            t={props.t}
                          />
                        ))}
                        {(module.contributions.commands ?? []).map(command => (
                          <ClientCommandRow
                            actions={(module.contributions.actions ?? []).filter(action => action.commandId === command.id)}
                            busy={busyKey === `${moduleKey}/${command.id}`}
                            command={command}
                            diagnostics={clientDiagnostics.filter(item => item.packageId === selected.packageId && item.moduleId === module.moduleId
                              && (item.commandId === command.id || item.code === 'client-extension.activation_failed'))}
                            extensionHost={props.extensionHost}
                            host={props.host}
                            key={command.id}
                            module={module}
                            packageId={selected.packageId}
                            registered={commandRegistrations.some(registration => registration.commandKey === clientCommandKey(selected.packageId, module.moduleId, command.id))}
                            t={props.t}
                            onBusyChange={busy => setBusyKey(busy ? `${moduleKey}/${command.id}` : undefined)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
              {props.serverDiagnostics.length > 0 ? (
                <details className={styles.diagnostics}>
                  <summary>{props.t('renderer.serverDiagnostics')} · {props.serverDiagnostics.length}</summary>
                  <pre>{JSON.stringify(props.serverDiagnostics, null, 2)}</pre>
                </details>
              ) : null}
            </>
          ) : <p className={styles.empty}>{props.t('renderer.workspaceEmpty')}</p>}
        </div>
      </div>
    </section>
  )
}

function ClientCommandRow(props: {
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
  const key = `${props.packageId}/${props.module.moduleId}/${props.definition.id}`
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
