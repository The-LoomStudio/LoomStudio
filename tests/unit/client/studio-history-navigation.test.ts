// @vitest-environment happy-dom
import { createRootLogger } from '@loom-studio/logging'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '../../support/client/render-hook.js'
import { useStudioState } from '../../../apps/studio-client/src/app/use-studio-state.js'

const fixture = vi.hoisted(() => ({
  undo: vi.fn(),
  redo: vi.fn(),
  refreshResource: vi.fn(),
  refreshCards: vi.fn(),
  selectCard: vi.fn(),
  narrative: {} as Record<string, unknown>,
  resource: {
    id: 'resource', resourceKind: 'lore', version: 2,
    rootNode: { id: 'root', kind: 'module', category: 'lore', label: 'Restored' },
  },
}))

vi.mock('../../../apps/studio-client/src/features/user-profiles/model/use-user-profiles-query.js', () => ({
  useUserProfilesQuery: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/themes/model/theme-store.js', async original => {
  const actual = await original<typeof import('../../../apps/studio-client/src/features/themes/model/theme-store.js')>()
  return { ...actual, useThemeStore: (select: (state: ReturnType<typeof actual.useThemeStore.getState>) => unknown) => select(actual.useThemeStore.getState()) }
})
vi.mock('../../../apps/studio-client/src/shared/api/studio-api.js', () => ({
  createStudioApi: () => ({ history: { revert: vi.fn() } }),
}))
vi.mock('../../../apps/studio-client/src/features/edit-history/model/use-edit-history.js', () => ({
  useEditHistory: () => ({ undo: fixture.undo, redo: fixture.redo, clear: vi.fn() }),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.js', () => ({
  usePromptResourceState: () => ({
    promptResources: [fixture.resource],
    refreshPromptResource: fixture.refreshResource,
  }),
}))
vi.mock('../../../apps/studio-client/src/features/cards/model/use-cards.js', () => ({
  useCards: () => ({ refreshCards: fixture.refreshCards, setSelectedCardId: fixture.selectCard }),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-context-assets.js', () => ({
  useContextAssets: () => ({ setResources: vi.fn() }),
}))
vi.mock('../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js', () => ({
  useProviderSettings: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-agent-presets.js', () => ({
  useAgentPresets: () => ({ agentPresets: [] }),
}))
vi.mock('../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js', () => ({
  useNarrativeRuntime: () => fixture.narrative,
}))
vi.mock('../../../apps/studio-client/src/features/prompt-build/model/use-macro-selection.js', () => ({
  useMacroSelection: () => ({ targetKey: () => 'key', readSelections: () => ({}), readError: () => undefined }),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-build/model/use-macro-preview.js', () => ({
  useMacroPreview: () => ({ preview: { key: 'key' } }),
}))
vi.mock('../../../apps/studio-client/src/features/extension-renderers/model/use-extension-resource-commands.js', () => ({
  useExtensionResourceCommands: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-commands.js', () => ({
  usePromptResourceCommands: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/app/use-studio-derived-values.js', () => ({
  useStudioDerivedValues: () => ({}),
}))

vi.mock('../../../apps/studio-client/src/features/agent-presets/model/use-agent-tools.js', () => ({ useAgentTools: () => ({ tools: [] }) }))
vi.mock('../../../apps/studio-client/src/features/user-profiles/model/use-player-profile-query.js', () => ({ usePlayerProfileQuery: () => ({}) }))
vi.mock('../../../apps/studio-client/src/features/extension-renderers/ui/new-story-extensions.js', () => ({ useNewStoryExtensions: () => ({}) }))
vi.mock('../../../apps/studio-client/src/app/use-studio-startup.js', () => ({ useStudioStartup: () => ({ ready: () => true }) }))
const mounted: ReturnType<typeof renderHook>[] = []
const logger = createRootLogger({ service: 'history-test', instanceId: 'test', sinks: [] }).child('studio')
function studio() {
  const hook = renderHook(() => useStudioState(logger))
  mounted.push(hook)
  return hook.current
}
afterEach(() => { for (const hook of mounted.splice(0)) hook.unmount() })

beforeEach(() => {
  vi.clearAllMocks()
  fixture.narrative = { input: '', narrativeAttachments: { values: [], ready: true } }
})

describe.each(['undoEdit', 'redoEdit'] as const)('%s navigation after refresh', action => {
  it('does not refresh or navigate when reverting fails', async () => {
    fixture.undo.mockRejectedValue(new Error('Revert conflict'))
    fixture.redo.mockRejectedValue(new Error('Revert conflict'))
    const state = studio()
    await expect(state[action](() => true)).resolves.toBeUndefined()
    expect(fixture.refreshResource).not.toHaveBeenCalled()
    expect(fixture.refreshCards).not.toHaveBeenCalled()
    expect(fixture.selectCard).not.toHaveBeenCalled()
  })

  it('does not return a navigation target when post-commit refresh fails', async () => {
    fixture.undo.mockResolvedValue({ anchor: { documentId: 'resource' } })
    fixture.redo.mockResolvedValue({ anchor: { documentId: 'resource' } })
    fixture.refreshResource.mockRejectedValue(new Error('Refresh unavailable'))
    const state = studio()
    await expect(state[action](() => true)).resolves.toBeUndefined()
    expect(fixture.refreshResource).toHaveBeenCalledExactlyOnceWith('resource')
    expect(fixture.selectCard).not.toHaveBeenCalled()
  })

  it.each([true, false])('returns a resource target only while navigation is current: %s', async current => {
    const read = Promise.withResolvers<typeof fixture.resource>()
    fixture.undo.mockResolvedValue({ anchor: { documentId: 'resource', subjectId: 'root' } })
    fixture.redo.mockResolvedValue({ anchor: { documentId: 'resource', subjectId: 'root' } })
    fixture.refreshResource.mockReturnValue(read.promise)
    let canNavigate = true
    const state = studio()
    const pending = state[action](() => canNavigate)
    await vi.waitFor(() => expect(fixture.refreshResource).toHaveBeenCalledWith('resource'))
    canNavigate = current
    read.resolve(fixture.resource)
    await expect(pending).resolves.toEqual(current ? { assetId: 'root', layoutId: 'resources' } : undefined)
    expect(fixture.selectCard).not.toHaveBeenCalled()
  })

  it.each([true, false])('selects a restored Card only while navigation is current: %s', async current => {
    const read = Promise.withResolvers<Array<{ id: string }>>()
    fixture.undo.mockResolvedValue({ anchor: { documentId: 'restored-card' } })
    fixture.redo.mockResolvedValue({ anchor: { documentId: 'restored-card' } })
    fixture.refreshCards.mockReturnValue(read.promise)
    let canNavigate = true
    const state = studio()
    const pending = state[action](() => canNavigate)
    await vi.waitFor(() => expect(fixture.refreshCards).toHaveBeenCalledOnce())
    canNavigate = current
    read.resolve([{ id: 'restored-card' }])
    await pending
    if (current) expect(fixture.selectCard).toHaveBeenCalledExactlyOnceWith('restored-card')
    else expect(fixture.selectCard).not.toHaveBeenCalled()
  })
})

it('passes the active preview or last-run build trace to the Inspector', () => {
  const runTrace = { diagnostics: [{ severity: 'warning', code: 'tool.missing', toolId: 'gone' }] }
  const previewTrace = { variables: { diagnostics: [{ severity: 'warning', code: 'variable.path_missing', path: 'global.gone' }] } }
  fixture.narrative = { ...fixture.narrative, lastRun: { promptBuildTrace: runTrace } }
  expect(studio().promptBuildTrace).toBe(runTrace)
  fixture.narrative = { ...fixture.narrative, promptPreview: { promptBuildTrace: previewTrace } }
  expect(studio().promptBuildTrace).toBe(previewTrace)
  fixture.narrative = {}
  expect(studio().promptBuildTrace).toBeUndefined()
})
