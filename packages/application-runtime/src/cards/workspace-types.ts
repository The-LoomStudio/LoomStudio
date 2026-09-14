import type { JsonObject, StateArtifact, TimelineStateBinding } from '@loom-studio/shared'
import type {
  AgentHistoryPolicy,
  CardPresetInput,
  CardMediaRefs,
  OpeningChatInput,
  SettingLayerInput,
} from '../types.js'
import type { PromptCompositionCapabilities } from '../prompt/prompt-builder.js'
import type { PromptActivation } from '../prompt/prompt-activation.js'
import type { LoomScriptAttachmentArtifact } from '../scripts/loom-script-contracts.js'
import type { TextExtractorDraft, TextTransformRuleDraft } from '../transforms/history-text.js'

export type CardBundleArtifact = {
  schemaVersion: 4
  artifactId: string
  displayName: string
  description?: string
  card: {
    name: string
    userName?: string
    description?: string
    preset?: CardPresetInput
    opening?: OpeningChatInput | string
    settingLayer?: SettingLayerInput
    media?: CardMediaRefs
    macros?: Record<string, string>
    stateContributionIds?: string[]
  }
  contextAssets: PromptResourceNode[]
  externalContextAssetIds?: string[]
  state?: StateArtifact
  stateTemplates?: Array<{
    id: string
    templateVersion: number
    schema: JsonObject
    initial: JsonObject
    componentKey?: string
    targetEntityTypeIds?: string[]
    label?: string
  }>
  timelineStateBindings?: TimelineStateBinding[]
  extensionPayloads?: PortableExtensionPayloadArtifact[]
  scriptAttachments?: LoomScriptAttachmentArtifact[]
  textTransformRules?: Array<Omit<TextTransformRuleDraft, 'owner'>>
  textExtractors?: Array<Omit<TextExtractorDraft, 'owner'>>
  metadata?: JsonObject
}

export type PortableExtensionPayloadArtifact = {
  id: string
  packageId: string
  fileName: string
  format: string
  mediaType: string
  schemaVersion?: number
  requirement?: {
    versionRange?: string
  }
  metadata?: JsonObject
  content: string
  resourceOrigin?: 'card' | 'external'
}

export type PortableExtensionPayloadContent = Omit<PortableExtensionPayloadArtifact, 'id'> & {
  artifactPayloadId: string
  createdAt: string
  updatedAt: string
}

export type PromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt' | (string & {})

export type PromptResourceContent = {
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  historyPolicy?: AgentHistoryPolicy
  origin?: {
    kind: 'builtin'
    key: string
  } | {
    kind: 'extension-package'
    packageId: string
    packageVersion: string
    contributionId: string
  }
  sourceArtifactRef?: CardBundleSourceArtifactRef
  macros?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type PromptResourceArtifact = {
  format: 'loom.promptResource'
  schemaVersion: 1 | 2
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  macros?: Record<string, string>
  textTransformRules?: Array<Omit<TextTransformRuleDraft, 'owner'>>
  scriptAttachments?: LoomScriptAttachmentArtifact[]
}

export type CardBundleSourceArtifactRef = {
  artifactId: string
  displayName: string
  format: 'loom.cardBundle'
  importedAt: string
  schemaVersion: CardBundleArtifact['schemaVersion']
  sourceArtifactId?: string
  blobId?: string
  sha256?: string
  sizeBytes?: number
  originalFileName?: string
  mediaType?: string
}

export type CardBundleImportManifest = {
  artifactId: string
  bindingIds: string[]
  documentIds: string[]
  promptResourceIds: string[]
  assetIds: string[]
  id: string
  importedAt: string
  sourceArtifactRef: CardBundleSourceArtifactRef
}

export type ImportBundleContent = {
  cardId: string
  documentIds: string[]
  promptResourceIds: string[]
  assetIds: string[]
  sourceArtifact: CardBundleArtifact
  sourceArtifactRef: CardBundleSourceArtifactRef
  bindings: CardBundleSourceBinding[]
  importedAt: string
}

export type CardBundleSourceBinding = {
  createdAt: string
  from: CardBundleBindingEndpoint
  id: string
  relationship: 'recommends'
  to: CardBundleBindingEndpoint
}

export type CardBundleBindingEndpoint = {
  documentId?: string
  documentType?: string
  resourceId?: string
  resourceKind?: PromptResourceKind
  nodeId?: string
}

export type PromptResourceNode = {
  body?: string
  category?: 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | (string & {})
  children?: PromptResourceNode[]
  configRows?: Array<{ label: string; value: string }>
  enabled?: boolean
  id: string
  isSection?: boolean
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'slot' | 'message' | (string & {})
  label: string
  meta?: string
  orderList?: string[]
  capabilities?: PromptResourceCompositionCapabilities
  projection?: {
    entryOrder?: number
    lifecycle?: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrder?: number
    sourceKind?: 'actual' | 'virtual'
    zoneId: string
  }
  extra?: JsonObject
}

export type PromptResourceCompositionCapabilities = PromptCompositionCapabilities & {
  activation?: PromptActivation
  lifecycle?: { lifecycle: 'always' | 'conditional' | 'fresh' | string }
  projection?: {
    entryOrderHint?: number
    bindingId?: string
    zoneId: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrderHint?: number
    sourceKind?: 'actual' | 'virtual'
  }
}
