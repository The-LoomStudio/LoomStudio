import type { DocumentTransaction } from '@loom-studio/document-store'
import type { MacroSelectionMap } from '@loom-studio/shared'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'

export type TimelinePresetConfig = {
  timelineId: string
  presetId: string
  macroSelections: MacroSelectionMap
  version: number
}
export type TimelinePresetConfigContent = Omit<TimelinePresetConfig, 'version'>

export function timelinePresetConfigId(timelineId: string, presetId: string): string {
  return `timeline-preset-config:${JSON.stringify([timelineId, presetId])}`
}

export async function readTimelinePresetConfig(
  documents: DocumentTransaction, timelineId: string, presetId: string,
): Promise<TimelinePresetConfig> {
  const record = await documents.get(timelinePresetConfigId(timelineId, presetId))
  if (!record) return { timelineId, presetId, macroSelections: {}, version: 0 }
  if (record.type !== applicationDocumentTypes.timelinePresetConfig) throw new Error('Unexpected Timeline Preset configuration document')
  return { ...record.content as TimelinePresetConfigContent, version: record.version }
}

export async function listTimelinePresetConfigs(documents: DocumentTransaction, timelineId: string) {
  const records = await listDocuments<TimelinePresetConfigContent>(documents, applicationDocumentTypes.timelinePresetConfig)
  return records.filter(record => record.content.timelineId === timelineId)
}

export async function deleteTimelinePresetConfigs(documents: DocumentTransaction, timelineId: string): Promise<void> {
  for (const record of await listTimelinePresetConfigs(documents, timelineId)) {
    await documents.delete({ id: record.id, expectedVersion: record.version })
  }
}
