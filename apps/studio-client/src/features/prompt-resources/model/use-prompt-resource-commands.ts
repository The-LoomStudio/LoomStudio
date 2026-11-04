import type { StudioApi } from '../../../shared/api/studio-api.js'
import { downloadBase64, downloadBlob, encodeBase64 } from '../../../shared/browser/download.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { sanitizeFileName } from '../../../shared/lib/text.js'
import type { PresetToolMount, PresetToolMountInput, PromptResource, PromptResourceArtifact, LoreMount, LoreMountSource } from '../../../entities/index.js'

type UsePromptResourceCommandsInput = {
  api: StudioApi
  t: Translator
  runMutation<T>(action: () => Promise<T>): Promise<T>
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
  loreMounts: LoreMount[]
  presetToolMounts: PresetToolMount[]
  promptResources: PromptResource[]
  setPromptResources: (update: (current: PromptResource[]) => PromptResource[]) => void
  setLoreMounts: (update: (current: LoreMount[]) => LoreMount[]) => void
  setPresetToolMounts: (update: (current: PresetToolMount[]) => PresetToolMount[]) => void
  invalidatePromptResourceState(areas: {
    bindings?: boolean
    presetToolMounts?: boolean
    resources?: boolean
    loreMounts?: boolean
  }): Promise<void>
  refreshCards: () => Promise<unknown>
  refreshCardTimelines: (cardId: string) => Promise<unknown>
  selectedCardId?: string
}

export function usePromptResourceCommands(input: UsePromptResourceCommandsInput) {
  const {
    api, t, runMutation, recordEdit, promptResources, setPromptResources, setLoreMounts, setPresetToolMounts,
    invalidatePromptResourceState,
    refreshCards, refreshCardTimelines, selectedCardId,
  } = input

  async function updatePresetModel(config: Parameters<StudioApi['agentPresets']['update']>[0]) {
    return runMutation(async () => {
      const result = await api.agentPresets.update(config)
      setPromptResources(current => current.map(resource => resource.id === result.agentPreset.id && resource.version <= result.agentPreset.version ? result.agentPreset : resource))
      return result.agentPreset
    })
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
        name: resourceKind === 'preset' ? 'New Preset' : resourceKind === 'lore' ? 'New Lore' : 'New Prompt Resource',
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
        loreMounts: result.resource.resourceKind === 'preset',
        presetToolMounts: result.resource.resourceKind === 'preset',
      })
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
      await invalidatePromptResourceState({ resources: true, loreMounts: true, presetToolMounts: true })
      await Promise.all([
        refreshCards(),
        selectedCardId ? refreshCardTimelines(selectedCardId) : Promise.resolve(),
      ])
    }).catch(error => {
      if (!deleted) throw error
    })
  }

  async function replaceLoreMounts(
    source: LoreMountSource,
    selections: string[] | Array<{ id: string } | { loreResourceId: string }>,
    mode: 'resourceIds' | 'mounts' = 'resourceIds',
    expectedMountIds = input.loreMounts.filter(mount => mount.source.kind === source.kind && (mount.source.id ?? 'global') === (source.id ?? 'global')).map(mount => mount.id),
  ): Promise<void> {
    await runMutation(async () => {
      const result = await api.promptResources.replaceLoreMounts(
        mode === 'mounts'
          ? { source, expectedMountIds, mounts: selections as Array<{ id: string } | { loreResourceId: string }> }
          : { source, expectedMountIds, loreResourceIds: selections as string[] },
      )
      setLoreMounts(current => [
        ...current.filter(mount => mount.source.kind !== source.kind || (source.kind === 'preset' ? mount.source.id !== source.id : mount.source.id !== (source.id ?? 'global'))),
        ...result.mounts,
      ])
      await invalidatePromptResourceState({ resources: true })
    })
  }

  async function replacePresetToolMounts(presetId: string, mounts: PresetToolMountInput[], expectedMountIds = input.presetToolMounts.filter(mount => mount.presetResourceId === presetId).map(mount => mount.id)): Promise<void> {
    await runMutation(async () => {
      const result = await api.promptResources.replacePresetToolMounts({ presetId, mounts, expectedMountIds })
      setPresetToolMounts(current => [
        ...current.filter(mount => mount.presetResourceId !== presetId),
        ...result.mounts,
      ])
      await invalidatePromptResourceState({ resources: true })
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
      await invalidatePromptResourceState({ resources: true, loreMounts: true })
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
      await invalidatePromptResourceState({ resources: true, loreMounts: true })
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
    replaceLoreMounts,
    replacePresetToolMounts,
  }
}
