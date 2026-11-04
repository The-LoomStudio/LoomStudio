import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Dialog } from '@loom-studio/ui'
import styles from './rule-inspector-dialog.module.scss'
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
  getScriptOwnerName?: ComponentProps<typeof ScriptManagementPanel>['getOwnerName']
  onRelatedResourceChanged?(): void | Promise<void>
  onScriptsChanged(): void
  scriptsRefreshToken?: number
}

export function RendererWorkspacePanel(props: Props) {
  const queryClient = useQueryClient()
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
  return <><ExtensionWorkspace {...props} renderScripts={(header, category) =>
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
