import type { ComponentProps } from 'react'
import { ExtensionWorkspace } from '../../features/extension-renderers/ui/extension-workspace.js'
import { ScriptManagementPanel } from '../../features/loom-scripts/ui/script-management-panel.js'
import type { StudioApi } from '../../shared/api/studio-api.js'

type Props = Omit<ComponentProps<typeof ExtensionWorkspace>, 'renderScripts'> & {
  scriptScopes?: ComponentProps<typeof ScriptManagementPanel>['scopes']
  scriptApi: StudioApi['loomScripts']
  getScriptOwnerName?: ComponentProps<typeof ScriptManagementPanel>['getOwnerName']
  onScriptsChanged(): void
  scriptsRefreshToken?: number
}

export function RendererWorkspacePanel(props: Props) {
  const requestedFilter = props.searchParams.get('scriptFilter')
  const initialFilter = requestedFilter === 'rules' || requestedFilter === 'runtime' ? requestedFilter : undefined
  return <ExtensionWorkspace {...props} renderScripts={header =>
    <ScriptManagementPanel initialFilter={initialFilter} initialScriptId={props.searchParams.get('scriptId') ?? undefined} api={props.scriptApi} scopes={props.scriptScopes} getOwnerName={props.getScriptOwnerName} cardId={props.settingScopeContext.cardId}
      onScriptsChanged={props.onScriptsChanged} refreshToken={props.scriptsRefreshToken}
      t={props.t} header={header} />
  } />
}
