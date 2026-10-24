import type { LoomScriptOwner } from '@loom-studio/shared/loom-scripts'
export type { LoomScriptOwner, LoomScriptMount } from '@loom-studio/shared/loom-scripts'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'

type LoomScriptRendererContribution = {
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
  runtime: import('@loom-studio/shared/loom-scripts').LoomScriptRuntime
  requires?: string[]
  contributions: LoomScriptRendererContribution[]
  requestedCapabilities: string[]
  source: { blobId: string; mediaType: 'text/javascript'; fileName: string }
  sourceDigest: string
  createdAt: string
  updatedAt: string
}

export type ResolvedLoomScriptRendererMount = {
  mountId: string
  mountVersion?: number
  target?: import('@loom-studio/shared/loom-scripts').LoomScriptMountTarget
  enabled: boolean
  orderIndex: number
  grantedCapabilities: string[]
  script: Pick<LoomScript, 'id' | 'version' | 'name' | 'metadataId' | 'scriptVersion' | 'requestedCapabilities' | 'contributions' | 'runtime' | 'requires'>
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
