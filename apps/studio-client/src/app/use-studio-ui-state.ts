import { useWorkbenchView } from '../shared/studio-shell/use-workbench-view.js'
import { useState } from 'react'
import type { VariableView } from './studio-state-panel.js'

export function useStudioUiState() {
  const [loomScriptRefreshToken, setLoomScriptRefreshToken] = useState(0)
  const [composerHeight, setComposerHeight] = useState(0)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string>()
  const [variableView, setVariableView] = useWorkbenchView<VariableView>('state.tab', 'sources', ['sources', 'authoring', 'state'])

  return {
    loomScriptRefreshToken,
    bumpLoomScriptRefreshToken: () => setLoomScriptRefreshToken(value => value + 1),
    composerHeight,
    setComposerHeight,
    agentPanelOpen,
    setAgentPanelOpen,
    selectedPresetId,
    setSelectedPresetId,
    variableView,
    setVariableView,
  }
}
