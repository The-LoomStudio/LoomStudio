import type { StudioApi } from '../../../shared/api/studio-api.js'
import { downloadBase64, downloadBlob, encodeBase64 } from '../../../shared/browser/download.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { sanitizeFileName } from '../../../shared/lib/text.js'
import type { PresetToolMount, PresetToolMountInput, PromptResource, PromptResourceArtifact, SettingMount, SettingMountSource } from '../../../entities/index.js'

type UsePromptResourceCommandsInput = {
  api: StudioApi
  t: Translator
  runMutation<T>(action: () => Promise<T>): Promise<T>
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
  promptResources: PromptResource[]
  setPromptResources: (update: (current: PromptResource[]) => PromptResource[]) => void
  setSettingMounts: (update: (current: SettingMount[]) => SettingMount[]) => void
  setPresetToolMounts: (update: (current: PresetToolMount[]) => PresetToolMount[]) => void
  invalidatePromptResourceState(areas: {
    bindings?: boolean
    presetToolMounts?: boolean
    resources?: boolean
    settingMounts?: boolean
  }): Promise<void>
  refreshAgentPresets: () => Promise<unknown>
  refreshCards: () => Promise<unknown>
  refreshCardTimelines: (cardId: string) => Promise<unknown>
  selectedCardId?: string
}

export function usePromptResourceCommands(input: UsePromptResourceCommandsInput) {
  const {
    api, t, runMutation, recordEdit, promptResources, setPromptResources, setSettingMounts, setPresetToolMounts,
    invalidatePromptResourceState,
    refreshAgentPresets, refreshCards, refreshCardTimelines, selectedCardId,
  } = input

  async function updatePresetModel(config: Parameters<StudioApi['agentPresets']['update']>[0]) {
    let committed: PromptResource | undefined
    try {
      return await runMutation(async () => {
        const result = await api.agentPresets.update(config)
        committed = result.agentPreset
        setPromptResources(current => current.map(resource => resource.id === result.agentPreset.id && resource.version <= result.agentPreset.version ? result.agentPreset : resource))
        await refreshAgentPresets()
        return result.agentPreset
      })
    } catch (error) {
      // The operation reporter surfaces refresh failures without retrying a committed write.
      if (committed) return committed
      throw error
    }
  }

  async function updatePresetMacros(resourceId: string, config: { expectedVersion: number; macros: Record<string, string>; macroOptions?: import('@loom-studio/shared').MacroOptions }) {
    const result = await api.promptResources.updateMacros({ resourceId, ...config })
    recordEdit({
      label: t('history.context.update'),
      changesetId: result.mutation.changesetId,
      anchor: { documentId: resourceId },
    })
    setPromptResources(current => current.map(resource => resource.id === result.resource.id && resource.version <= result.resource.version ? result.resource : resource))
    return { version: result.resource.version, macros: result.resource.macros ?? {}, macroOptions: result.resource.macroOptions }
  }

  async function createPromptResource(resourceKind: PromptResource['resourceKind']): Promise<string | undefined> {
    let resourceId: string | undefined
    await runMutation(async () => {
      const result = await api.promptResources.create({
        resourceKind,
        name: resourceKind === 'preset' ? 'New Preset' : resourceKind === 'setting' ? 'New Setting Layer' : 'New Prompt Resource',
      })
      resourceId = result.resource.id
      setPromptResources(current => [...current, result.resource])
      recordEdit({
        label: t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      await invalidatePromptResourceState({
        resources: true,
        presetToolMounts: resourceKind === 'preset',
      })
      if (resourceKind === 'preset') await refreshAgentPresets()
    }).catch(error => {
      if (!resourceId) throw error
    })
    return resourceId
  }

  async function duplicatePromptResource(resourceId: string): Promise<string | undefined> {
    let duplicatedId: string | undefined
    await runMutation(async () => {
      const result = await api.promptResources.duplicate({ resourceId })
      duplicatedId = result.resource.id
      setPromptResources(current => [...current, result.resource])
      recordEdit({
        label: t('history.context.duplicate'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      await invalidatePromptResourceState({
        resources: true,
        settingMounts: result.resource.resourceKind === 'preset',
        presetToolMounts: result.resource.resourceKind === 'preset',
      })
      if (result.resource.resourceKind === 'preset') await refreshAgentPresets()
    }).catch(error => {
      if (!duplicatedId) throw error
    })
    return duplicatedId
  }

  async function deletePromptResource(resourceId: string): Promise<void> {
    let deleted = false
    await runMutation(async () => {
      await api.promptResources.delete(resourceId)
      deleted = true
      setPromptResources(current => current.filter(resource => resource.id !== resourceId))
      await invalidatePromptResourceState({ resources: true, settingMounts: true, presetToolMounts: true })
      await Promise.all([
        refreshCards(),
        refreshAgentPresets(),
        selectedCardId ? refreshCardTimelines(selectedCardId) : Promise.resolve(),
      ])
    }).catch(error => {
      if (!deleted) throw error
    })
  }

  async function replaceSettingMounts(
    source: SettingMountSource,
    selections: string[] | Array<{ id: string } | { settingResourceId: string }>,
    mode: 'resourceIds' | 'mounts' = 'resourceIds',
  ): Promise<void> {
    await runMutation(async () => {
      const result = await api.promptResources.replaceSettingMounts(
        mode === 'mounts'
          ? { source, mounts: selections as Array<{ id: string } | { settingResourceId: string }> }
          : { source, settingResourceIds: selections as string[] },
      )
      setSettingMounts(current => [
        ...current.filter(mount => mount.source.kind !== source.kind || (source.kind === 'preset' ? mount.source.id !== source.id : mount.source.id !== (source.id ?? 'global'))),
        ...result.mounts,
      ])
      await invalidatePromptResourceState({ bindings: true })
      await refreshAgentPresets()
    })
  }

  async function replacePresetToolMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void> {
    await runMutation(async () => {
      const result = await api.promptResources.replacePresetToolMounts({ presetId, mounts })
      setPresetToolMounts(current => [
        ...current.filter(mount => mount.presetResourceId !== presetId),
        ...result.mounts,
      ])
      await refreshAgentPresets()
    })
  }

  async function importPromptResource(file: File): Promise<string | undefined> {
    let resourceId: string | undefined
    await runMutation(async () => {
      let artifact: PromptResourceArtifact
      try {
        artifact = JSON.parse(await file.text()) as PromptResourceArtifact
      } catch {
        throw new Error('Prompt Resource import must be valid JSON')
      }
      const baseName = file.name.replace(/\.[^/.]+$/, '').trim()
      const result = await api.promptResources.import(artifact, baseName || undefined)
      resourceId = result.resource.id
      setPromptResources(current => [...current, result.resource])
      recordEdit({
        label: t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      await invalidatePromptResourceState({ resources: true })
      if (result.resource.resourceKind === 'preset') await refreshAgentPresets()
    }).catch(error => {
      if (!resourceId) throw error
    })
    return resourceId
  }

  async function exportPromptResource(resourceId: string): Promise<void> {
    const resource = promptResources.find(item => item.id === resourceId)
    if (!resource) return
    const result = await api.promptResources.export(resourceId)
    downloadBlob(
      new Blob([JSON.stringify(result.artifact, null, 2)], { type: 'application/json' }),
      `${sanitizeFileName(resource.rootNode.label).replace(/\s+/g, ' ') || 'prompt-resource'}.loomresource.json`,
    )
  }

  async function importPromptResourceZip(file: File): Promise<string | undefined> {
    let resourceId: string | undefined
    await runMutation(async () => {
      const result = await api.promptResources.importZip(encodeBase64(new Uint8Array(await file.arrayBuffer())))
      resourceId = result.resource.id
      setPromptResources(current => [...current, result.resource])
      recordEdit({
        label: t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      await invalidatePromptResourceState({ resources: true })
      if (result.resource.resourceKind === 'preset') await refreshAgentPresets()
    }).catch(error => {
      if (!resourceId) throw error
    })
    return resourceId
  }

  async function exportPromptResourceZip(resourceId: string): Promise<void> {
    const result = await api.promptResources.exportZip(resourceId)
    downloadBase64(result.base64, result.fileName, 'application/zip')
  }

  return {
    updatePresetModel,
    updatePresetMacros,
    createPromptResource,
    duplicatePromptResource,
    deletePromptResource,
    importPromptResource,
    exportPromptResource,
    importPromptResourceZip,
    exportPromptResourceZip,
    replaceSettingMounts,
    replacePresetToolMounts,
  }
}
