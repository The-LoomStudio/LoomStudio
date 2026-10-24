import type { LoomScriptOwner, LoomScriptMount } from '@loom-studio/shared/loom-scripts'
export type { LoomScriptOwner, LoomScriptMountTarget } from '@loom-studio/shared/loom-scripts'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'

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
  runtime: import('@loom-studio/shared/loom-scripts').LoomScriptRuntime
  requires?: string[]
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

export type LoomScriptMountContent = Omit<LoomScriptMount, 'id' | 'version'>
export type LoomScriptMountEntry = LoomScriptMount

export type LoomScriptRuntimeMountSnapshot = {
  mountId: string
  mountVersion?: number
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
  resourceOrigin?: 'card' | 'external'
}
