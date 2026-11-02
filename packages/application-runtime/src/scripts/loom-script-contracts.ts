import type { LoomScriptOwner, LoomScriptMount } from '@loom-studio/shared/loom-scripts'
export type { LoomScriptOwner, LoomScriptMountTarget } from '@loom-studio/shared/loom-scripts'
import type { LoomScriptContributionDefinition, LoomScriptSettingDefinition, LoomScriptSettings } from '@loom-studio/shared/loom-scripts'
export type { LoomScriptInput, LoomScriptContributionDefinition, LoomScriptRendererContributionDefinition } from '@loom-studio/shared/loom-scripts'

export type LoomScriptContent = {
  owner: LoomScriptOwner
  formatVersion: 1
  metadataId: string
  scriptVersion: string
  name: string
  runtime: import('@loom-studio/shared/loom-scripts').LoomScriptRuntime
  requires?: string[]
  settings?: LoomScriptSettingDefinition[]
  tags?: string[]
  textResourceIds?: Record<string, string>
  textResourceReferences?: Record<string, string>
  textResourceOrigin?: import('../transforms/history-text.js').TextTransformRuleContent['origin']
  textResourceOwner?: import('../transforms/history-text.js').TextRuleOwner
  contributions: LoomScriptContributionDefinition[]
  requestedCapabilities: string[]
  source: {
    blobId: string
    mediaType: 'text/javascript' | 'text/markdown'
    fileName: string
  }
  sourceDigest: string
  createdAt: string
  updatedAt: string
}

export type LoomScriptEntry = LoomScriptContent & { id: string; version: number }

export type LoomScriptMountContent = Omit<LoomScriptMount, 'id' | 'version'>
export type LoomScriptMountEntry = LoomScriptMount

export type LoomScriptRuntimeMountSnapshot = {
  mountId: string
  mountVersion?: number
  settings?: LoomScriptSettings
  target?: import('@loom-studio/shared/loom-scripts').LoomScriptMountTarget
  enabled: boolean
  orderIndex: number
  scriptDocumentId: string
  documentVersion: number
  sourceDigest: string
  contributionIds: string[]
  requestedCapabilities: string[]
  grantedCapabilities: string[]
}

export type ResolvedLoomScriptRendererMount = {
  mountId: string
  mountVersion?: number
  settings?: LoomScriptSettings
  target?: import('@loom-studio/shared/loom-scripts').LoomScriptMountTarget
  enabled: boolean
  orderIndex: number
  grantedCapabilities: string[]
  script: Pick<LoomScriptEntry, 'id' | 'version' | 'name' | 'metadataId' | 'scriptVersion' | 'requestedCapabilities' | 'contributions' | 'runtime' | 'requires'>
  source: string
}

export type UnavailableLoomScriptMount = {
  mountId: string
  scriptDocumentId: string
  enabled: boolean
  available: false
  severity: 'warning'
  reason: 'script-missing' | 'installation-missing'
  message: string
}

export type LoomScriptArtifact = {
  format: 'loom.script'
  schemaVersion: 1
  fileName: string
  source: string
}

export type LoomScriptAttachmentArtifact = {
  script: LoomScriptArtifact
  orderIndex: number
  groupOrder?: number
  resourceOrigin?: 'card' | 'external'
  textResourceIds?: Record<string, string>
  textResourceReferences?: Record<string, string>
  settings?: LoomScriptSettings
}
