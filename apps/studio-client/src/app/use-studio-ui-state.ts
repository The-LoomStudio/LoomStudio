import { useState } from 'react'

export function useStudioUiState() {
  const [loomScriptRefreshToken, setLoomScriptRefreshToken] = useState(0)
  const [composerHeight, setComposerHeight] = useState(0)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string>()
  const [resourceView, setResourceView] = useState<'settings' | 'macros' | 'text'>('settings')
  const [variableView, setVariableView] = useState<'state' | 'authoring' | 'preview' | 'build'>('state')

  return {
    loomScriptRefreshToken,
    bumpLoomScriptRefreshToken: () => setLoomScriptRefreshToken(value => value + 1),
    composerHeight,
    setComposerHeight,
    agentPanelOpen,
    setAgentPanelOpen,
    selectedPresetId,
    setSelectedPresetId,
    resourceView,
    setResourceView,
    variableView,
    setVariableView,
  }
}
