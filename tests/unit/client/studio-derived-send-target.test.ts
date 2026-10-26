// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRootLogger } from '@loom-studio/logging'
import { useStudioDerivedValues } from '../../../apps/studio-client/src/app/use-studio-derived-values.js'
import { useStudioState } from '../../../apps/studio-client/src/app/use-studio-state.js'
import type { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { renderHook } from '../../support/client/render-hook.js'

const runtime = vi.hoisted(() => ({ current: {} as Partial<ReturnType<typeof useNarrativeRuntime>> }))
vi.mock('../../../apps/studio-client/src/shared/api/studio-api.js', () => ({
  createStudioApi: () => ({ history: { revert: vi.fn() } }),
}))
vi.mock('../../../apps/studio-client/src/features/user-profiles/model/use-user-profiles-query.js', () => ({
  useUserProfilesQuery: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/extension-renderers/ui/new-story-extensions.js', () => ({
  useNewStoryExtensions: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.js', () => ({
  usePromptResourceState: () => ({ promptResources: [], presetToolMounts: [], loreMounts: [] }),
}))
vi.mock('../../../apps/studio-client/src/features/cards/model/use-cards.js', () => ({ useCards: () => ({}) }))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-context-assets.js', () => ({
  useContextAssets: () => ({ setResources: vi.fn() }),
}))
vi.mock('../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js', () => ({ useProviderSettings: () => ({}) }))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-agent-presets.js', () => ({
  useAgentPresets: () => ({ agentPresets: [] }),
}))
vi.mock('../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js', () => ({
  useNarrativeRuntime: () => runtime.current,
}))
vi.mock('../../../apps/studio-client/src/features/prompt-build/model/use-macro-selection.js', () => ({
  useMacroSelection: () => ({ targetKey: () => 'test', readSelections: () => ({}), readError: () => undefined }),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-build/model/use-macro-preview.js', () => ({
  useMacroPreview: () => ({ preview: { key: 'test' } }),
}))
vi.mock('../../../apps/studio-client/src/features/extension-renderers/model/use-extension-resource-commands.js', () => ({
  useExtensionResourceCommands: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-commands.js', () => ({
  usePromptResourceCommands: () => ({}),
}))
vi.mock('../../../apps/studio-client/src/app/use-studio-startup.js', () => ({ useStudioStartup: () => ({ ready: () => true }) }))

const input: Parameters<typeof useStudioDerivedValues>[0] = {
  t: createTranslator('zh-CN'),
  timeline: { id: 'timeline', activeBranchId: 'branch', createdAt: '', updatedAt: '', promptResourceIds: [] },
  branch: { id: 'branch', timelineId: 'timeline', stateHeadRevisionId: 'state', createdAt: '', updatedAt: '' },
  nodes: [], narrativeInput: 'Continue', agentInput: 'Hello',
  sessionBusy: false, agentChatBusy: false, agentSessionReady: true,
  activationFacts: undefined, macroPreview: { key: 'test' }, macroKey: 'test',
}
const session = { kind: 'timeline' as const, id: 'timeline', timelineId: 'timeline', agentPresetId: 'preset', entryCount: 0, createdAt: '', updatedAt: '' }
const logger = createRootLogger({ service: 'send-target-test', instanceId: 'test', sinks: [] }).child('studio')
beforeEach(() => {
  runtime.current = { timeline: input.timeline, branch: input.branch, nodes: [], input: input.narrativeInput,
    agentInput: input.agentInput, agentSessionReady: true, primarySession: session }
})

function derived(changes: Partial<typeof input> = {}) {
  const hook = renderHook(() => useStudioDerivedValues({ ...input, ...changes }))
  try { return hook.current } finally { hook.unmount() }
}
function studio(changes: Partial<typeof runtime.current> = {}) {
  runtime.current = { ...runtime.current, ...changes }
  const hook = renderHook(() => useStudioState(logger))
  try { return hook.current } finally { hook.unmount() }
}

describe('Studio send target availability', () => {
  it('blocks sending until Timeline restoration provides its configured Session', () => {
    expect(studio({ primarySession: undefined }).canSend).toBe(false)
    expect(studio({ primarySession: session }).canSend).toBe(true)
    // Sidebar Session readiness belongs to Agent chat and cannot block a restored Timeline.
    expect(studio({ agentSessionReady: false }).canSend).toBe(true)
    expect(derived({ agentSessionReady: false }).canSend).toBe(true)
  })

  it('uses the Timeline preset without a separately selected Agent preset', () => {
    expect(studio().canSend).toBe(true)
    expect(studio({ primarySession: { ...session, agentPresetId: undefined } }).canSend).toBe(false)
    expect(derived({ primarySession: session }).canPreviewPrompt).toBe(true)
    expect(derived({ primarySession: { ...session, timelineId: 'other' } }).canPreviewPrompt).toBe(false)
  })

  it('blocks Narrative send while its root is running, suspended, or changing the opening', () => {
    for (const status of ['running', 'suspended'] as const)
      expect(studio({ rootActiveRun: { runId: 'run', status } }).canSend).toBe(false)
    expect(studio({ rootActiveRun: undefined, openingChanged: true }).canSend).toBe(false)
    expect(studio({ openingChanged: false }).canSend).toBe(true)
  })

  it('restores Agent chat readiness independently of the Timeline preset', () => {
    const agentSession = { ...session, kind: 'agent' as const, id: 'helper' }
    expect(derived({ agentSession, agentSessionReady: false }).canSendAgent).toBe(false)
    expect(derived({ agentSession, agentSessionReady: true }).canSendAgent).toBe(true)
  })
})
