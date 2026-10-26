import { useEffect } from 'react'
import { useContextAssets } from './use-context-assets.js'
import { usePromptResourceState } from './use-prompt-resource-state.js'
import { useAgentPresets } from './use-agent-presets.js'

type Input = Parameters<typeof usePromptResourceState>[0] & Pick<Parameters<typeof useContextAssets>[0], 'recordEdit' | 'runAction' | 't'>

export function usePromptResourceWorkspace(input: Input) {
  const state = usePromptResourceState(input)
  const { promptResources, setPromptResources } = state
  const contextAssetState = useContextAssets({
    api: input.api, scope: input.endpoint, resources: promptResources,
    recordEdit: input.recordEdit, runAction: input.runAction, t: input.t,
    onResourceChange: resource => {
      setPromptResources(current => current.map(item => item.id === resource.id && item.version <= resource.version ? resource : item))
    },
  })
  useEffect(() => {
    contextAssetState.setResources(promptResources)
  }, [input.endpoint, promptResources])
  const presetSelection = useAgentPresets({ resources: promptResources })
  return { state, contextAssetState, presetSelection }
}
