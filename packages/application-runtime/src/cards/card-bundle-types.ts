import type { JsonObject, StateArtifact, TimelineStateBinding } from '@loom-studio/shared'
import type {
  CardPresetInput,
  CardMediaRefs,
  CardFrameworkFields,
  CardExtensionAdoption,
  OpeningChatInput,
  LoreInput,
} from '../types.js'
import type { PromptResourceContent, PromptResourceKind, PromptResourceNode } from '../prompt/prompt-resource-types.js'
import type { PortableExtensionPayloadArtifact } from '../extensions/portable-payload-types.js'
import type { LoomScriptAttachmentArtifact } from '../scripts/loom-script-contracts.js'
import type { TextExtractorDraft, TextTransformRuleDraft } from '../transforms/history-text.js'

export type CardBundleArtifact = {
  schemaVersion: 4
  artifactId: string
  derivedFrom?: { artifactId: string }
  displayName: string
  description?: string
  card: CardFrameworkFields & {
    name: string
    userName?: string
    description?: string
    preset?: CardPresetInput
    opening?: OpeningChatInput | string
    lore?: LoreInput
    media?: CardMediaRefs
    macros?: Record<string, string>
    macroOptions?: import("@loom-studio/shared").MacroOptions
    stateContributionIds?: string[]
    extensionAdoptions?: CardExtensionAdoption[]
  }
  contextAssets: PromptResourceNode[]
  /** Portable resource settings keyed by the corresponding context asset root ID. */
  contextAssetSettings?: Record<string, Pick<PromptResourceContent,
    'metadata' | 'macros' | 'macroOptions' | 'useCardLore' | 'useGlobalLore' | 'useCardText' | 'useGlobalText' | 'historyPolicy' | 'textUses'>>
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
  extensionPackages?: Array<{ packageId: string; version: string; archiveBase64: string }>
  scriptAttachments?: LoomScriptAttachmentArtifact[]
  textTransformRules?: Array<Omit<TextTransformRuleDraft, 'owner'>>
  textExtractors?: Array<Omit<TextExtractorDraft, 'owner'>>
  metadata?: JsonObject
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
  /** Stable author identities mapped at import/update; not a review history. */
  resourceMappings?: { resources: Record<string, string>; nodes: Record<string, string>; scripts?: Record<string, string>; extensions?: Record<string, string> }
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
