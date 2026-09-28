import { describe, expect, it, vi } from 'vitest'
import { usePromptResourceCommands } from '../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-commands.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

describe('Prompt Resource command outcomes', () => {
  it.each(['create', 'duplicate', 'import', 'importZip', 'delete'] as const)('%s distinguishes rejection from committed mutation with failed refresh', async operation => {
    const resource = {
      id: 'created', version: 1, resourceKind: 'setting',
      rootNode: { id: 'root', kind: 'folder', label: 'Created' },
    } as PromptResource
    const failure = new Error('Unavailable')
    const mutate = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({
      resource, mutation: { changesetId: 'change' },
    })
    const refresh = vi.fn().mockRejectedValue(failure)
    const report = vi.fn()
    let resources = operation === 'delete' ? [resource] : []
    const commands = usePromptResourceCommands({
      api: { promptResources: { [operation]: mutate } } as unknown as StudioApi,
      t: createTranslator('en-US'),
      runMutation: async action => {
        try { return await action() } catch (error) { report(error); throw error }
      },
      recordEdit: vi.fn(), promptResources: resources,
      setPromptResources: update => { resources = update(resources) },
      setSettingMounts: vi.fn(), setPresetToolMounts: vi.fn(),
      invalidatePromptResourceState: refresh,
      refreshAgentPresets: vi.fn(), refreshCards: vi.fn(), refreshCardTimelines: vi.fn(),
    })
    const invoke = () => {
      switch (operation) {
        case 'create': return commands.createPromptResource('setting')
        case 'duplicate': return commands.duplicatePromptResource('original')
        case 'import': return commands.importPromptResource(new File(['{}'], 'resource.json'))
        case 'importZip': return commands.importPromptResourceZip(new File(['zip'], 'resource.zip'))
        case 'delete': return commands.deletePromptResource('created')
      }
    }
    await expect(invoke()).rejects.toBe(failure)
    expect(refresh).not.toHaveBeenCalled()
    expect(resources).toEqual(operation === 'delete' ? [resource] : [])
    await expect(invoke()).resolves.toBe(operation === 'delete' ? undefined : 'created')
    expect(resources).toEqual(operation === 'delete' ? [] : [resource])
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('does not publish mounts when replacement is rejected', async () => {
    const failure = new Error('Mount update rejected')
    const setMounts = vi.fn()
    const commands = usePromptResourceCommands({
      api: { promptResources: {
        replaceSettingMounts: async () => { throw failure },
        replacePresetToolMounts: async () => { throw failure },
      } } as unknown as StudioApi,
      t: createTranslator('en-US'), runMutation: action => action(),
      recordEdit: vi.fn(), promptResources: [],
      setPromptResources: vi.fn(), setSettingMounts: setMounts, setPresetToolMounts: setMounts,
      invalidatePromptResourceState: vi.fn(),
      refreshAgentPresets: vi.fn(), refreshCards: vi.fn(), refreshCardTimelines: vi.fn(),
    })
    await expect(commands.replaceSettingMounts({ kind: 'manual', id: 'global' }, ['setting'])).rejects.toBe(failure)
    await expect(commands.replacePresetToolMounts('preset', [])).rejects.toBe(failure)
    expect(setMounts).not.toHaveBeenCalled()
  })
})
