import type { JsonObject } from '@loom-studio/shared'
import type { AgentApprovalPolicy } from '../agents/approval-policy.js'
import type { AgentDelivery, AgentHistoryPolicy, ProviderModelSelection, ExtensionPackageResourceOrigin } from '../types.js'
import type { CardBundleSourceArtifactRef } from '../cards/card-bundle-types.js'
import type { PromptCompositionCapabilities } from './prompt-builder.js'
import type { PromptActivation } from './prompt-activation.js'
import type { LoomScriptAttachmentArtifact } from '../scripts/loom-script-contracts.js'
import type { TextTransformRuleDraft } from '../transforms/history-text.js'

export type PromptResourceKind = 'preset' | 'lore' | 'logic' | 'runtime' | 'history' | 'prompt' | (string & {})

export type PromptResourceContent = {
  /** Author-to-local identity mapping for standalone package updates, not review history. */
  sourcePackage?: { releaseId: string; rootId: string; nodeIds: Record<string, string>; attachmentsDigest: string }
  metadata?: import("@loom-studio/shared").PromptResourceDisplayMetadata
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  useCardLore?: boolean
  useCardText?: boolean
  useGlobalLore?: boolean
  useGlobalText?: boolean
  textUses?: Array<{ id: string; kind: 'rule' | 'extractor'; enabled: boolean; orderIndex?: number; reference?: NonNullable<import('@loom-studio/extension-sdk').ExtensionPromptResourceContribution['textUses']>[number]['reference'] }>
  historyPolicy?: AgentHistoryPolicy
  approvalPolicy?: AgentApprovalPolicy
  model?: ProviderModelSelection
  delivery?: AgentDelivery
  origin?: {
    kind: 'builtin'
    key: string
    packageVersion?: string
    sourceDigest?: string
  } | ExtensionPackageResourceOrigin
  sourceArtifactRef?: CardBundleSourceArtifactRef
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
  createdAt: string
  updatedAt: string
}

export type PromptResourceArtifact = {
  metadata?: import("@loom-studio/shared").PromptResourceDisplayMetadata
  format: 'loom.promptResource'
  schemaVersion: 2
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
  useCardLore?: boolean
  useCardText?: boolean
  useGlobalLore?: boolean
  useGlobalText?: boolean
  textUses?: PromptResourceContent['textUses']
  loreMounts?: Array<NonNullable<import('@loom-studio/shared').LoreMount['reference']>>
  textTransformRules?: Array<Omit<TextTransformRuleDraft, 'owner'>>
  scriptAttachments?: LoomScriptAttachmentArtifact[]
}

export type PromptResourceNode = {
  body?: string
  category?: 'preset' | 'lore' | 'logic' | 'runtime' | 'history' | (string & {})
  children?: PromptResourceNode[]
  enabled?: boolean
  id: string
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'slot' | 'message' | (string & {})
  label: string
  meta?: string
  capabilities?: PromptResourceCompositionCapabilities
  extra?: JsonObject
}

export type PromptResourceCompositionCapabilities = Omit<PromptCompositionCapabilities, 'roleHint'> & {
  roleHint?: 'system' | 'user' | 'assistant'
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
