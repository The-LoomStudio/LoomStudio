import type { Logger } from '@loom-studio/logging'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudioState } from '../../../apps/studio-client/src/app/use-studio-state.js'

const fixture = vi.hoisted(() => ({
  undo: vi.fn(),
  redo: vi.fn(),
  refreshResource: vi.fn(),
  refreshCards: vi.fn(),
  selectCard: vi.fn(),
  narrative: {} as Record<string, unknown>,
  resource: {
    id: 'resource', resourceKind: 'setting', version: 2,
    rootNode: { id: 'root', kind: 'module', category: 'setting', label: 'Restored' },
  },
}))

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useReducer: (_reducer: unknown, initial: unknown, initialize: (value: unknown) => unknown) => [initialize(initial), vi.fn()],
}))
vi.mock('@loom-studio/client-bridge', () => ({ createClientBridge: () => ({}) }))
vi.mock('../../../apps/studio-client/src/shared/api/client-bridge-logging.js', () => ({ withClientBridgeLogging: () => ({}) }))
vi.mock('../../../apps/studio-client/src/shared/api/studio-api.js', () => ({
  createStudioApi: () => ({ history: { revert: vi.fn() } }),
}))
vi.mock('../../../apps/studio-client/src/features/edit-history/model/use-edit-history.js', () => ({
  useEditHistory: () => ({ undo: fixture.undo, redo: fixture.redo }),
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
vi.mock('../../../apps/studio-client/src/features/context-assets/model/use-context-assets.js', () => ({
  useContextAssets: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js', () => ({
  useProviderSettings: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/agent-presets/model/use-agent-presets.js', () => ({
  useAgentPresets: () => ({ agentPresets: [] }),
}))
vi.mock('../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js', () => ({
  useNarrativeRuntime: () => fixture.narrative,
}))
vi.mock('../../../apps/studio-client/src/features/prompt-build/model/use-macro-selection.js', () => ({
  useMacroSelection: () => ({ targetKey: () => 'key', readSelections: () => ({}) }),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.narrative = {}
})

describe.each(['undoEdit', 'redoEdit'] as const)('%s navigation after refresh', action => {
  it('does not refresh or navigate when reverting fails', async () => {
    fixture.undo.mockRejectedValue(new Error('Revert conflict'))
    fixture.redo.mockRejectedValue(new Error('Revert conflict'))
    const state = useStudioState({} as Logger)
    await expect(state[action](() => true)).resolves.toBeUndefined()
    expect(fixture.refreshResource).not.toHaveBeenCalled()
    expect(fixture.refreshCards).not.toHaveBeenCalled()
    expect(fixture.selectCard).not.toHaveBeenCalled()
  })

  it('does not return a navigation target when post-commit refresh fails', async () => {
    fixture.undo.mockResolvedValue({ anchor: { documentId: 'resource' } })
    fixture.redo.mockResolvedValue({ anchor: { documentId: 'resource' } })
    fixture.refreshResource.mockRejectedValue(new Error('Refresh unavailable'))
    const state = useStudioState({} as Logger)
    await expect(state[action](() => true)).resolves.toBeUndefined()
    expect(fixture.refreshResource).toHaveBeenCalledExactlyOnceWith('resource')
    expect(fixture.selectCard).not.toHaveBeenCalled()
  })

  it.each([true, false])('returns a resource target only while navigation is current: %s', async current => {
    const read = deferred<typeof fixture.resource>()
    fixture.undo.mockResolvedValue({ anchor: { documentId: 'resource', subjectId: 'root' } })
    fixture.redo.mockResolvedValue({ anchor: { documentId: 'resource', subjectId: 'root' } })
    fixture.refreshResource.mockReturnValue(read.promise)
    let canNavigate = true
    const state = useStudioState({} as Logger)
    const pending = state[action](() => canNavigate)
    await vi.waitFor(() => expect(fixture.refreshResource).toHaveBeenCalledWith('resource'))
    canNavigate = current
    read.resolve(fixture.resource)
    await expect(pending).resolves.toEqual(current ? { assetId: 'root', layoutId: 'resources' } : undefined)
    expect(fixture.selectCard).not.toHaveBeenCalled()
  })

  it.each([true, false])('selects a restored Card only while navigation is current: %s', async current => {
    const read = deferred<Array<{ id: string }>>()
    fixture.undo.mockResolvedValue({ anchor: { documentId: 'restored-card' } })
    fixture.redo.mockResolvedValue({ anchor: { documentId: 'restored-card' } })
    fixture.refreshCards.mockReturnValue(read.promise)
    let canNavigate = true
    const state = useStudioState({} as Logger)
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
  fixture.narrative = { lastRun: { promptBuildTrace: runTrace } }
  expect(useStudioState({} as Logger).promptBuildTrace).toBe(runTrace)
  fixture.narrative = { ...fixture.narrative, promptPreview: { promptBuildTrace: previewTrace } }
  expect(useStudioState({} as Logger).promptBuildTrace).toBe(previewTrace)
  fixture.narrative = {}
  expect(useStudioState({} as Logger).promptBuildTrace).toBeUndefined()
})
