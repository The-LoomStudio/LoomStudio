import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { useAgentPresets } from '../../../apps/studio-client/src/features/prompt-resources/model/use-agent-presets.js'
import { usePromptResourceState } from '../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.js'
import { usePromptResourceCommands } from '../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-commands.js'
import { useContextAssets } from '../../../apps/studio-client/src/features/prompt-resources/model/use-context-assets.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

let client: QueryClient
afterEach(() => client?.clear())

it('publishes macro, node and model edits to the Preset projection and uses their latest CAS for the next rename', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let saved: PromptResource = { id: 'preset', version: 1, resourceKind: 'preset', rootNode: { id: 'root', kind: 'module', label: 'Original' }, createdAt: '', updatedAt: '' }
  const versions: number[] = []
  const update = (version: number, patch: Partial<PromptResource>) => {
    expect(version).toBe(saved.version)
    versions.push(version)
    saved = { ...saved, ...patch, version: version + 1 }
    return { resource: saved, mutation: { changesetId: `change-${saved.version}` } }
  }
  const api = {
    promptResources: {
      updateMacros: async (input: { expectedVersion: number; macros: Record<string, string> }) => update(input.expectedVersion, { macros: input.macros }),
      updateAsset: async (input: { expectedVersion: number; label: string }) => update(input.expectedVersion, { rootNode: { ...saved.rootNode, label: input.label } }),
    },
    agentPresets: { update: vi.fn(async (input: { expectedVersion: number; name?: string }) => {
      const result = update(input.expectedVersion, { rootNode: { ...saved.rootNode, label: input.name ?? saved.rootNode.label } })
      return { agentPreset: result.resource, mutation: result.mutation }
    }) },
  } as unknown as StudioApi
  client.setQueryData(['prompt-resources', '/rpc', 'resources'], { resources: [saved] })
  let state!: ReturnType<typeof usePromptResourceState>
  let presets!: ReturnType<typeof useAgentPresets>
  let commands!: ReturnType<typeof usePromptResourceCommands>
  let editor!: ReturnType<typeof useContextAssets>
  function Consumer() {
    state = usePromptResourceState({ api, endpoint: '/rpc' })
    presets = useAgentPresets({ resources: state.promptResources })
    const t = createTranslator('en-US')
    commands = usePromptResourceCommands({ api, t, promptResources: state.promptResources, setPromptResources: state.setPromptResources, setLoreMounts: state.setLoreMounts, setPresetToolMounts: state.setPresetToolMounts, invalidatePromptResourceState: async () => {}, recordEdit: () => {}, runMutation: action => action(), refreshCards: async () => {}, refreshCardTimelines: async () => {} })
    editor = useContextAssets({ api, scope: '/rpc', resources: state.promptResources, onResourceChange: resource => state.setPromptResources(current => current.map(item => item.id === resource.id ? resource : item)), recordEdit: () => {}, runAction: action => action(), t })
    return null
  }
  const render = () => renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
  render()
  await commands.updatePresetMacros('preset', { expectedVersion: 1, macros: { mood: 'happy' } })
  // The actual root editor reads the published resource version before its next save.
  render()
  await editor.updateContextAsset('root', { label: 'After macro' })
  render()
  expect(presets.agentPresets[0]?.macros).toEqual({ mood: 'happy' })
  await editor.updateContextAsset('root', { label: 'Edited node' })
  render()
  await editor.updateContextAsset('root', { label: 'After node' })
  render()
  await commands.updatePresetModel({ agentPresetId: 'preset', expectedVersion: saved.version, delivery: 'complete' })
  render()
  await editor.updateContextAsset('root', { label: 'After model' })
  render()
  expect(presets.agentPresets[0]).toEqual(saved)
  expect(versions).toEqual([1, 2, 3, 4, 5, 6])
})
