import { describe, expect, it, vi } from 'vitest'
import { usePromptResourceCommands } from '../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-commands.js'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { Translator } from '../../../apps/studio-client/src/shared/i18n/index.js'

describe('prompt resource commands', () => {
  it('invalidates resource and mount queries after duplicating a preset', async () => {
    const invalidate = vi.fn(async () => undefined)
    const duplicate = vi.fn(async () => ({
      resource: promptResource('preset-copy', 'preset'),
      mutation: { changesetId: 'change-1' },
    }))
    const commands = usePromptResourceCommands(commandInput({
      api: { promptResources: { duplicate } } as unknown as StudioApi,
      invalidate,
    }))

    await expect(commands.duplicatePromptResource('preset-source')).resolves.toBe('preset-copy')

    expect(duplicate).toHaveBeenCalledWith({ resourceId: 'preset-source' })
    expect(invalidate).toHaveBeenCalledWith({
      resources: true,
      settingMounts: true,
      presetToolMounts: true,
    })
  })

  it('invalidates remote truth before refreshing dependent documents after deletion', async () => {
    const events: string[] = []
    const commands = usePromptResourceCommands(commandInput({
      api: {
        promptResources: {
          delete: async () => { events.push('delete') },
        },
      } as unknown as StudioApi,
      invalidate: async () => { events.push('invalidate') },
      refreshAgentProfiles: async () => { events.push('agents') },
      refreshCards: async () => { events.push('cards') },
      refreshCardTimelines: async () => { events.push('timelines') },
      selectedCardId: 'card-1',
    }))

    await commands.deletePromptResource('resource-1')

    expect(events.slice(0, 2)).toEqual(['delete', 'invalidate'])
    expect(new Set(events.slice(2))).toEqual(new Set(['agents', 'cards', 'timelines']))
  })
})

function commandInput(overrides: {
  api: StudioApi
  invalidate: (areas: { presetToolMounts?: boolean; resources?: boolean; settingMounts?: boolean }) => Promise<void>
  refreshAgentProfiles?: () => Promise<unknown>
  refreshCards?: () => Promise<unknown>
  refreshCardTimelines?: (cardId: string) => Promise<unknown>
  selectedCardId?: string
}) {
  return {
    api: overrides.api,
    t: ((key: string) => key) as Translator,
    runMutation: async <T,>(action: () => Promise<T>) => action(),
    recordEdit: () => undefined,
    promptResources: [],
    setPromptResources: () => undefined,
    setSettingMounts: () => undefined,
    setPresetToolMounts: () => undefined,
    invalidatePromptResourceState: overrides.invalidate,
    refreshAgentProfiles: overrides.refreshAgentProfiles ?? (async () => undefined),
    refreshCards: overrides.refreshCards ?? (async () => undefined),
    refreshCardTimelines: overrides.refreshCardTimelines ?? (async () => undefined),
    selectedCardId: overrides.selectedCardId,
  }
}

function promptResource(id: string, resourceKind: PromptResource['resourceKind']): PromptResource {
  return {
    id,
    version: 1,
    resourceKind,
    rootNode: { id: `${id}-root`, label: id, kind: 'module' },
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  }
}
