import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'

export type LoomScriptOwner =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'user' }

export type LoomScriptRendererContribution = {
  kind: 'renderer'
  renderer: Omit<RendererContributionDefinition, 'adapter' | 'artifactType'>
  inputs: Array<{ kind: 'match'; ruleId: string } | { kind: 'artifact'; artifactType: string }>
}

export type LoomScript = {
  id: string
  version: number
  owner: LoomScriptOwner
  formatVersion: 1
  metadataId: string
  scriptVersion: string
  name: string
  runtime: 'client-sandbox'
  contributions: LoomScriptRendererContribution[]
  requestedCapabilities: string[]
  source: { blobId: string; mediaType: 'text/javascript'; fileName: string }
  sourceDigest: string
  createdAt: string
  updatedAt: string
}

export type LoomScriptMount = {
  id: string
  version: number
  target: LoomScriptOwner
  scriptDocumentId: string
  enabled: boolean
  orderIndex: number
  pinnedDocumentVersion?: number
  grantedCapabilities: string[]
  origin: Record<string, ClientJsonValue>
  createdAt: string
  updatedAt: string
}

export type ResolvedLoomScriptRendererMount = {
  mountId: string
  enabled: boolean
  orderIndex: number
  grantedCapabilities: string[]
  script: Pick<LoomScript, 'id' | 'version' | 'name' | 'metadataId' | 'scriptVersion' | 'requestedCapabilities' | 'contributions'>
  source: string
}
