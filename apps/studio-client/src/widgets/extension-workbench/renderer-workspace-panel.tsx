import type { ComponentProps } from 'react'
import { ExtensionWorkspace } from '../../features/extension-renderers/ui/extension-workspace.js'
import { ScriptManagementPanel } from '../../features/loom-scripts/ui/script-management-panel.js'
import type { StudioApi } from '../../shared/api/studio-api.js'

type Props = Omit<ComponentProps<typeof ExtensionWorkspace>, 'renderScripts'> & {
  scriptApi: StudioApi['loomScripts']
  onScriptsChanged(): void
  scriptsRefreshToken?: number
}

export function RendererWorkspacePanel(props: Props) {
  return <ExtensionWorkspace {...props} renderScripts={header =>
    <ScriptManagementPanel api={props.scriptApi} cardId={props.settingScopeContext.cardId}
      onScriptsChanged={props.onScriptsChanged} refreshToken={props.scriptsRefreshToken}
      t={props.t} header={header} />
  } />
}
