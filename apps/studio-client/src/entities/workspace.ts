import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { MutationReceipt } from './common.js'
import type { Card } from './card.js'
import type { ContextAssetNode } from './context-asset.js'

export type CardBundleArtifact = {
  schemaVersion: 2
  artifactId: string
  displayName: string
  description?: string
  card: {
    name: string
    userName?: string
    description?: string
    preset?: ClientJsonValue
    opening?: ClientJsonValue
    settingLayer?: ClientJsonValue
  }
  contextAssets: ContextAssetNode[]
  stateTemplates?: Array<{
    id: string
    templateVersion: number
    schema: Record<string, ClientJsonValue>
    initial: Record<string, ClientJsonValue>
    label?: string
  }>
  timelineStateBindings?: Array<{
    path: string
    templateId: string
    templateVersion: number
    initial?: Record<string, ClientJsonValue>
  }>
  extensionPayloads?: PortableExtensionPayloadArtifact[]
  metadata?: Record<string, ClientJsonValue>
}

export type PortableExtensionPayloadArtifact = {
  id: string
  packageId: string
  fileName: string
  format: string
  mediaType: string
  schemaVersion?: number
  requirement?: { versionRange?: string }
  metadata?: Record<string, ClientJsonValue>
  content: string
}

export type PortableExtensionPayloadDraft = Omit<PortableExtensionPayloadArtifact, 'id'>

export type PortableExtensionPayload = PortableExtensionPayloadDraft & {
  id: string
  artifactPayloadId: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ListPortableExtensionPayloadsResult = {
  payloads: PortableExtensionPayload[]
}

export type GetPortableExtensionPayloadResult = {
  payload: PortableExtensionPayload
}

export type MutatePortableExtensionPayloadResult = {
  payload: PortableExtensionPayload
  mutation: MutationReceipt
}

export type PromptResource = {
  id: string
  version: number
  resourceKind: 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'
  rootNode: ContextAssetNode
  historyPolicy?: 'persistent' | 'ephemeral'
  origin?: { kind: 'builtin'; key: string }
  sourceArtifactRef?: ClientJsonValue
  createdAt: string
  updatedAt: string
}

export type SettingMountSource =
  | { kind: 'manual'; id?: 'global' }
  | { kind: 'preset'; id: string }

export type SettingMount = {
  id: string
  settingResourceId: string
  source: SettingMountSource
  orderIndex: number
  origin: Record<string, ClientJsonValue>
  createdAt: string
}

export type ListSettingMountsResult = {
  mounts: SettingMount[]
}

export type ReplaceSettingMountsResult = {
  mounts: SettingMount[]
  mutation: MutationReceipt
}

export type PresetToolMount = {
  id: string
  presetResourceId: string
  toolId: string
  orderIndex: number
  defaultEnabled: boolean
  activation?: ClientJsonValue
  provider?: { order?: number }
  content?: {
    zone?: string
    slot?: string
    rankKey?: string
    orderHint?: number
  }
  origin: Record<string, ClientJsonValue>
  createdAt: string
}

export type PresetToolMountInput = Omit<PresetToolMount, 'id' | 'presetResourceId' | 'origin' | 'createdAt'>

export type ListPresetToolMountsResult = {
  mounts: PresetToolMount[]
}

export type ReplacePresetToolMountsResult = {
  mounts: PresetToolMount[]
  mutation: MutationReceipt
}

export type PromptResourceArtifact = {
  format: 'loom.promptResource'
  schemaVersion: 1
  resourceKind: PromptResource['resourceKind']
  rootNode: ContextAssetNode
}

export type ImportBundle = {
  id: string
  version: number
  cardId: string
  documentIds: string[]
  sourceArtifact: CardBundleArtifact
  sourceArtifactRef: ClientJsonValue
  bindings: ClientJsonValue[]
  importedAt: string
}

export type GetPromptResourceResult = {
  resource: PromptResource
}

export type ListPromptResourcesResult = {
  resources: PromptResource[]
}

export type CreatePromptResourceResult = {
  resource: PromptResource
  mutation: MutationReceipt
}

export type DeletePromptResourceResult = {
  deleted: true
  detachedReferences: {
    presets: number
    cards: number
    timelines: number
  }
  mutation: MutationReceipt
}

export type ExportPromptResourceResult = {
  artifact: PromptResourceArtifact
}

export type UpdatePromptResourceResult = {
  resource: PromptResource
  mutation: MutationReceipt
}

export type ImportCardBundleResult = {
  card: Card
  importBundle: ImportBundle
}

export type ExportCardBundleResult = {
  artifact: CardBundleArtifact
}
