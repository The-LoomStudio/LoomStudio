import type { StudioRpcOutputs } from '../shared/api/trpc-client.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
export type {
  ListLoreMountsResult,
  ReplaceLoreMountsResult,
  LoreMount,
  LoreMountSource,
} from '@loom-studio/shared'
import type { MutationReceipt } from './common.js'
import type { Card } from './card.js'
import type { ContextAssetNode } from './context-asset.js'

export type CardBundleArtifact = StudioRpcOutputs['application']['exportCardBundle']['artifact']

type PortableExtensionPayloadArtifact = {
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

type PortableExtensionPayload = PortableExtensionPayloadDraft & {
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

export type PromptResource = StudioRpcOutputs['application']['getPromptResource']['resource']

export type { PresetToolMount, PresetToolMountInput, ListPresetToolMountsResult, ReplacePresetToolMountsResult } from '@loom-studio/shared/tool-mounts'


export type PromptResourceArtifact = StudioRpcOutputs['application']['exportPromptResource']['artifact']

type ImportBundle = {
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

export type ListPromptResourcesResult = StudioRpcOutputs['application']['listPromptResources']

export type GetPromptResourceBindingsResult = {
  resourceId: string
  cards: Array<{ id: string; name: string }>
  loreMounts: import('@loom-studio/shared').LoreMount[]
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

export type ImportCardBundleResult = StudioRpcOutputs['application']['importCardBundle']

export type ExportCardBundleResult = StudioRpcOutputs['application']['exportCardBundle']
