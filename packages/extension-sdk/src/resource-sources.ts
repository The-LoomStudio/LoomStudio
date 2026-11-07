/** Source adapters resolve metadata; the host owns actual download and adoption. */
export type ResourceSourceKind = 'extension' | 'card' | 'preset'
export type ResourceSourceReference = { adapterId: string; url: string; resourceId: string }
export type ResourceSourceCandidate = {
  name: string
  kind: ResourceSourceKind
  source: ResourceSourceReference
  version?: string
  packageId?: string
  revision?: string
  prerelease?: boolean
  description?: string
  target: { kind: 'file'; url: string } | { kind: 'git'; url: string; ref?: string }
  manifestUrl?: string
  sha256?: string
}
export type ResourceSourceAdapter = {
  /** Must start with the owning package ID and '/'. */
  id: string
  /** Exact HTTPS host and path prefixes claimed by this adapter. No URL is broadcast to other adapters. */
  links: Array<{ hostname: string; pathPrefix: string }>
  resolve(input: { url: string; kind: ResourceSourceKind; ref?: string }, signal: AbortSignal): Promise<ResourceSourceCandidate[]>
  prepare?(candidate: ResourceSourceCandidate, signal: AbortSignal): Promise<ResourceSourceCandidate>
  check?(input: { source: ResourceSourceReference; installedVersion: string; packageId?: string; kind: ResourceSourceKind; prerelease: boolean }, signal: AbortSignal): Promise<ResourceSourceCandidate | null>
}
export type ResourceDistribution =
  | { kind: 'git'; url: string; ref?: string }
  | { kind: 'release'; provider: 'github'; repository: string; asset: string }
  | { kind: 'url'; url: string }
