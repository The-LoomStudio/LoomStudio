import { describe, expect, it } from 'vitest'
import type { MacroInspection } from '@loom-studio/shared'
import type { TimelinePresetConfig } from '@loom-studio/application-runtime'
import { callRpc, withStudioServer } from './helpers.js'

describe('Macro configuration RPC', () => {
  it('persists a candidate and uses it in server-side inspection without a client override', async () => {
    await withStudioServer(async port => {
      const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Card', macros: { tone: 'CARD' } })
      const { timeline } = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.id })
      const { resource } = await callRpc<{ resource: { id: string; version: number } }>(port, 'application.createPromptResource', { resourceKind: 'preset', name: 'Preset' })
      await callRpc(port, 'application.updatePromptResourceMacros', {
        resourceId: resource.id, expectedVersion: resource.version, macros: { tone: 'DEFAULT' },
        macroOptions: { tone: [{ id: 'quiet', label: 'Quiet', value: 'QUIET' }] },
      })
      const target = { timelineId: timeline.id, presetId: resource.id }
      const first = await callRpc<{ config: TimelinePresetConfig }>(port, 'application.getTimelinePresetConfig', target)
      expect(first.config).toMatchObject({ version: 0, macroSelections: {} })
      await callRpc(port, 'application.updateTimelinePresetConfig', {
        ...target, expectedVersion: 0, macroSelections: { tone: { sourceId: `preset:${resource.id}`, optionId: 'quiet' } },
      })
      const inspection = await callRpc<{ macroInspection: MacroInspection }>(port, 'application.inspectMacros', {
        timelineTarget: { timelineId: timeline.id }, presetId: resource.id,
      })
      expect(inspection.macroInspection.entries.find(entry => entry.name === 'tone')).toMatchObject({
        selectedOptionId: 'quiet', value: 'QUIET', status: 'resolved',
      })
      await expect(callRpc(port, 'application.updateTimelinePresetConfig', {
        ...target, expectedVersion: 1, macroSelections: [],
      })).rejects.toThrow()
      const stored = await callRpc<{ config: TimelinePresetConfig }>(port, 'application.getTimelinePresetConfig', target)
      expect(stored.config.version).toBe(1)
    })
  })
})
