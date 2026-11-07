import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Dialog } from '@loom-studio/ui'
import styles from './rule-inspector-dialog.module.scss'
import { ResourceDownloadsLauncher } from '../resource-downloads/resource-downloads-launcher.js'
import { notify } from '../../shared/notifications/index.js'
import { buildStudioLogPath } from '../../shared/studio-shell/studio-route.js'
import { ExtensionWorkspace } from '../../features/extension-renderers/ui/extension-workspace.js'
import { ScriptManagementPanel } from '../../features/loom-scripts/ui/script-management-panel.js'
import type { StudioApi } from '../../shared/api/studio-api.js'

type Props = Omit<ComponentProps<typeof ExtensionWorkspace>, 'renderScripts'> & {
  endpoint: string
  active: boolean
  runtimeInspector?: ReactNode
  scriptScopes?: ComponentProps<typeof ScriptManagementPanel>['scopes']
  scriptPreviewContext?: ComponentProps<typeof ScriptManagementPanel>['previewContext']
  scriptApi: StudioApi['loomScripts']
  promptResourceApi?: StudioApi['promptResources']
  resourceDownloadsApi?: StudioApi['resourceDownloads']
  getScriptOwnerName?: ComponentProps<typeof ScriptManagementPanel>['getOwnerName']
  onRelatedResourceChanged?(): void | Promise<void>
  onScriptsChanged(): void
  scriptsRefreshToken?: number
}

export function RendererWorkspacePanel(props: Props) {
  const queryClient = useQueryClient()
  const copiedResources = useRef(new Map<string, { rootNodeId: string; kind: string }>())
  const catalogRevision = useRef(props.scriptsRefreshToken)
  useEffect(() => {
    if (catalogRevision.current === props.scriptsRefreshToken) return
    catalogRevision.current = props.scriptsRefreshToken
    void queryClient.invalidateQueries({ queryKey: ['loom-script-catalog', props.endpoint] })
  }, [queryClient, props.endpoint, props.scriptsRefreshToken])
  const canInspect = props.active && props.mode === 'management'
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const requestedInspector = props.searchParams.get('ruleInspector')
  useEffect(() => { setInspectorOpen(canInspect && requestedInspector === '1') }, [canInspect, requestedInspector])
  const requestedFilter = props.searchParams.get('scriptFilter')
  const initialFilter = requestedFilter === 'rules' || requestedFilter === 'runtime' ? requestedFilter : undefined
  return <><ExtensionWorkspace {...props}
    headerActions={<>{props.headerActions}{props.resourceDownloadsApi && <ResourceDownloadsLauncher compact initiallyOpen={props.searchParams.get('downloads') === '1'} api={props.resourceDownloadsApi} kind="extension"
      onChanged={async () => { await props.onRefreshExtensions(); await props.onRelatedResourceChanged?.() }}
      onOpenLogs={() => props.onNavigate(buildStudioLogPath({ source: 'server' }))} />}</>}
    onSaveResourceCopy={props.promptResourceApi ? async input => {
      const result = await props.promptResourceApi!.duplicate(input)
      copiedResources.current.set(result.resource.id, { rootNodeId: result.resource.rootNode.id, kind: result.resource.resourceKind })
      void Promise.resolve(props.onRelatedResourceChanged?.()).catch(error => notify.warning('副本已保存，资源列表刷新失败', { description: error instanceof Error ? error.message : String(error) }))
      return { id: result.resource.id, label: result.resource.rootNode.label }
    } : props.onSaveResourceCopy}
    onOpenResourceCopy={result => {
      const copy = copiedResources.current.get(result.id)
      if (copy) props.onNavigate(`/studio/${copy.kind === 'preset' ? 'agents' : 'resources'}/reference/${encodeURIComponent(result.id)}/node/${encodeURIComponent(copy.rootNodeId)}`)
      else props.onOpenResourceCopy?.(result)
    }} renderScripts={(header, category) =>
    <ScriptManagementPanel endpoint={props.endpoint} previewContext={props.scriptPreviewContext} category={category} initialFilter={initialFilter} initialScriptId={props.searchParams.get('scriptId') ?? undefined} api={props.scriptApi} promptResourceApi={props.promptResourceApi} onNavigate={props.onNavigate} scopes={props.scriptScopes} getOwnerName={props.getScriptOwnerName} cardId={props.settingScopeContext.cardId}
      onRelatedResourceChanged={props.onRelatedResourceChanged} onScriptsChanged={props.onScriptsChanged}
      onInspect={canInspect && props.runtimeInspector ? () => setInspectorOpen(true) : undefined}
      t={props.t} header={header} />
  } />
    {canInspect && inspectorOpen && props.runtimeInspector && <Dialog open layout="workbench" title="正则运行检查器" className={styles.dialog} onClose={() => {
      setInspectorOpen(false)
      if (requestedInspector) {
        const params = new URLSearchParams(props.searchParams)
        params.delete('ruleInspector')
        props.onNavigate(`/studio/extensions?${params}`)
      }
    }}><div className={styles.body}><Suspense fallback={<p role="status">正在加载运行检查器…</p>}>{props.runtimeInspector}</Suspense></div></Dialog>}
  </>
}
