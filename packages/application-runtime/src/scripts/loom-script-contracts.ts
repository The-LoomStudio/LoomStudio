import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'
import type { JsonObject } from '@loom-studio/shared'

export type LoomScriptOwner =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'user' }

export type LoomScriptInput =
  | { kind: 'match'; ruleId: string }
  | { kind: 'artifact'; artifactType: string }

export type LoomScriptRendererContributionDefinition = {
  kind: 'renderer'
  renderer: Omit<RendererContributionDefinition, 'adapter' | 'artifactType'>
  inputs: LoomScriptInput[]
}

export type LoomScriptContributionDefinition = LoomScriptRendererContributionDefinition

export type LoomScriptContent = {
  owner: LoomScriptOwner
  formatVersion: 1
  metadataId: string
  scriptVersion: string
  name: string
  runtime: 'client-sandbox'
  contributions: LoomScriptContributionDefinition[]
  requestedCapabilities: string[]
  source: {
    blobId: string
    mediaType: 'text/javascript'
    fileName: string
  }
  sourceDigest: string
  createdAt: string
  updatedAt: string
}

export type LoomScriptEntry = LoomScriptContent & { id: string; version: number }

export type LoomScriptMountTarget =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'user' }

export type LoomScriptMountContent = {
  target: LoomScriptMountTarget
  scriptDocumentId: string
  enabled: boolean
  orderIndex: number
  pinnedDocumentVersion?: number
  grantedCapabilities: string[]
  origin: JsonObject
  createdAt: string
  updatedAt: string
}

export type LoomScriptMountEntry = LoomScriptMountContent & { id: string; version: number }

export type LoomScriptRuntimeMountSnapshot = {
  mountId: string
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
  enabled: boolean
  orderIndex: number
  grantedCapabilities: string[]
  script: Pick<LoomScriptEntry, 'id' | 'version' | 'name' | 'metadataId' | 'scriptVersion' | 'requestedCapabilities' | 'contributions'>
  source: string
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
  resourceOrigin?: 'card' | 'external'
}
