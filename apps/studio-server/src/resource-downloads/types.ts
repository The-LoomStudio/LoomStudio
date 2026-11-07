import type { ExtensionDependency } from '@loom-studio/extension-sdk'

export type ResourceDependency = Omit<ExtensionDependency, 'version'> & { version?: string; requestedBy?: string; embedded?: boolean }

export type ResourceKind = 'extension' | 'card' | 'preset'
export type ResourceSource = { adapterId: string; url: string; resourceId: string }
export type ResourceCandidate = {
  id: string
  name: string
  kind: ResourceKind
  source: ResourceSource
  version?: string
  packageId?: string
  revision?: string
  prerelease?: boolean
  description?: string
  recommended?: boolean
  dependencyTarget?: 'global' | 'card'
}
export type ResourceDownloadTarget = { kind: 'file'; url: string } | { kind: 'git'; url: string; ref?: string }
export type PreparedResourceCandidate = Omit<ResourceCandidate, 'id'> & {
  fixedSource?: boolean
  target: ResourceDownloadTarget
  manifestUrl?: string
  sha256?: string
  expectedVersionRange?: string
}
export type ResourceDownloadTask = ResourceCandidate & {
  candidateId: string
  status: 'queued' | 'downloading' | 'ready' | 'failed' | 'cancelled' | 'interrupted'
  phase: 'waiting' | 'fetching' | 'validating' | 'staged' | 'failed' | 'cancelled'
  createdAt: string
  updatedAt: string
  receivedBytes: number
  totalBytes?: number
  sha256?: string
  error?: string
  dependencies: ResourceDependency[]
}
export type ResourceDownloadArtifact = { kind: ResourceKind; path: string; directory?: string; fileName: string }
export type ResourceUpdateRecord = {
  id: string
  source: ResourceSource
  name: string
  kind: ResourceKind
  installedVersion: string
  dependencyTarget?: 'global' | 'card'
  targetId?: string
  packageId?: string
  prerelease: boolean
  fixed: boolean
  sourcePinned?: boolean
  checkedAt?: string
  status: 'unchecked' | 'available' | 'current' | 'unsupported' | 'failed' | 'unavailable'
  candidate?: ResourceCandidate
  ignoredCandidate?: string
  notifiedCandidate?: string
  error?: string
}
export type ResourceSourceAdapter = {
  id: string
  matches(url: URL): boolean
  resolve(input: { url: string; kind: ResourceKind; ref?: string }, signal: AbortSignal): Promise<PreparedResourceCandidate[]>
  prepare?(candidate: PreparedResourceCandidate, signal: AbortSignal): Promise<PreparedResourceCandidate>
  check?(input: { source: ResourceSource; installedVersion: string; packageId?: string; kind: ResourceKind; prerelease: boolean }, signal: AbortSignal): Promise<PreparedResourceCandidate | null>
}
