import { createRequire } from 'node:module'
import { downloadExtensionZip, parseDownloadSource, type DownloadOptions } from '../extensions/extension-download.js'
import type { PreparedResourceCandidate, ResourceKind, ResourceSourceAdapter } from './types.js'

const semver = createRequire(import.meta.url)('semver') as { valid(value: string): string | null; gt(a: string, b: string): boolean; prerelease(value: string): unknown }
export { semver }
export type DownloadTransport = (url: string, options: DownloadOptions) => Promise<Uint8Array>
export const downloadPublicResource: DownloadTransport = (url, options) => downloadExtensionZip({ kind: 'zip', url }, 0, options)

export function publicUrl(value: string): URL {
  return new URL(parseDownloadSource({ kind: 'zip', url: value }).url)
}
export function displayUrl(value: string): string {
  const url = publicUrl(value)
  return `${url.origin}${url.pathname}`
}
export function safeDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Resource operation failed'
  return message.replace(/https?:\/\/[^\s"'<>]+/g, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '[remote source]' }
  }).slice(0, 600)
}
export function createBuiltinSourceAdapters(download: DownloadTransport): ResourceSourceAdapter[] {
  async function json(url: string, signal: AbortSignal): Promise<unknown> {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await download(url, { maxBytes: 1024 * 1024, timeoutMs: 30_000, signal })))
  }
  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source metadata must be an object')
    return value as Record<string, unknown>
  }
  function releaseManifest(value: unknown) {
    const envelope = record(value)
    if (envelope.release === undefined) return envelope
    const release = record(envelope.release)
    return { ...release, ...(release.distribution === undefined && envelope.distribution !== undefined ? { distribution: envelope.distribution } : {}), ...(release.displayName === undefined && typeof envelope.displayName === 'string' ? { displayName: envelope.displayName } : {}) }
  }
  async function fromManifest(url: string, kind: ResourceKind, signal: AbortSignal, value?: unknown): Promise<PreparedResourceCandidate> {
    const manifest = releaseManifest(value ?? await json(url, signal))
    if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string' || !semver.valid(manifest.version)) throw new Error('Update manifest requires package ID and a SemVer version')
    const distribution = record(manifest.distribution)
    const base = { name: typeof manifest.displayName === 'string' ? manifest.displayName : manifest.id, kind, packageId: manifest.id, version: manifest.version, source: { adapterId: 'manifest', url: displayUrl(url), resourceId: manifest.id }, manifestUrl: url }
    if (distribution.kind === 'git' && typeof distribution.url === 'string') {
      const source = parseDownloadSource(distribution)
      if (source.kind !== 'git') throw new Error('Expected Git source')
      return { ...base, target: source }
    }
    if (distribution.kind === 'url' && typeof distribution.url === 'string') return { ...base, target: { kind: 'file', url: publicUrl(distribution.url).href } }
    if (distribution.kind === 'release' && distribution.provider === 'github' && typeof distribution.repository === 'string' && typeof distribution.asset === 'string') {
      const repo = githubRepository(publicUrl(distribution.repository))
      const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=30`, signal)
      if (!Array.isArray(releases)) throw new Error('Invalid GitHub release list')
      const release = releases.map(record).find(item => item.tag_name === manifest.version || item.tag_name === `v${manifest.version}`)
      if (!release) throw new Error('No published release matches the declared version')
      const assets = Array.isArray(release.assets) ? release.assets.map(record) : []
      const asset = assets.find(item => item.name === distribution.asset)
      if (!asset || typeof asset.browser_download_url !== 'string') throw new Error('Declared release asset is not available')
      return { ...base, target: { kind: 'file', url: publicUrl(asset.browser_download_url).href } }
    }
    throw new Error('Update manifest has no supported download distribution')
  }
  function githubRepository(url: URL) {
    if (url.hostname !== 'github.com') throw new Error('GitHub repository URL required')
    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('Invalid GitHub repository URL')
    return `${owner}/${repo.replace(/\.git$/, '')}`
  }
  const github: ResourceSourceAdapter = {
    id: 'github', matches: url => url.hostname === 'github.com' && !url.pathname.includes('/releases/download/'),
    async resolve({ url: input, kind, ref }, signal) {
      const url = publicUrl(input)
      const repo = githubRepository(url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[2] === 'blob' && parts.length >= 5) {
        return [{ name: decodeURIComponent(parts.at(-1)!), kind, source: { adapterId: 'github', url: displayUrl(input), resourceId: `${repo}/${parts.slice(2).join('/')}` }, target: { kind: 'file', url: `https://raw.githubusercontent.com/${repo}/${parts.slice(3).join('/')}` } }]
      }
      if (ref || url.pathname.endsWith('.git')) {
        if (kind !== 'extension') throw new Error('Git directory downloads are supported for extensions; use a package file for this resource')
        const source = parseDownloadSource({ kind: 'git', url: `https://github.com/${repo}.git`, ...(ref ? { ref } : {}) })
        return [{ name: repo, kind, source: { adapterId: 'github', url: `https://github.com/${repo}${ref ? `/tree/${encodeURIComponent(ref)}` : ''}`, resourceId: repo }, target: source as { kind: 'git'; url: string; ref?: string } }]
      }
      let recommended: PreparedResourceCandidate | undefined
      if (parts.length === 2) {
        let metadata: unknown
        try { metadata = await json(`https://api.github.com/repos/${repo}/contents/manifest.json`, signal) }
        catch (error) {
          // Only a missing root Manifest means there is no declaration; auth/rate/network failures stay visible.
          if (!(error instanceof Error) || !/HTTP 404(?:\D|$)/.test(error.message)) throw error
        }
        if (metadata !== undefined) {
          const content = record(metadata)
          if (typeof content.download_url !== 'string') throw new Error('GitHub root Manifest has no readable file URL')
          const manifestUrl = publicUrl(content.download_url).href
          const manifestValue = await json(manifestUrl, signal)
          const declaration = releaseManifest(manifestValue)
          if (declaration.distribution !== undefined) {
            const resolved = await fromManifest(manifestUrl, kind, signal, manifestValue)
            recommended = { ...resolved, name: `${resolved.name} · 作者推荐`, recommended: true,
              source: { adapterId: 'github', url: `https://github.com/${repo}`, resourceId: `${repo}#manifest:${resolved.packageId}` },
            }
          }
        }
      }
      const tag = parts[2] === 'releases' && parts[3] === 'tag' ? parts.slice(4).join('/') : undefined
      const endpoint = tag ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(decodeURIComponent(tag))}` : `https://api.github.com/repos/${repo}/releases?per_page=30`
      const result = await json(endpoint, signal)
      const releases = tag ? [record(result)] : Array.isArray(result) ? result.map(record) : (() => { throw new Error('Invalid GitHub release list') })()
      const candidates: PreparedResourceCandidate[] = recommended ? [recommended] : []
      for (const release of releases) {
        if (release.draft || typeof release.tag_name !== 'string') continue
        for (const asset of Array.isArray(release.assets) ? release.assets.map(record) : []) {
          if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') continue
          if (!/\.(?:zip|png|loomcard)$/i.test(asset.name) || (kind !== 'card' && !/\.zip$/i.test(asset.name))) continue
          candidates.push({ name: `${repo} · ${release.tag_name} · ${asset.name}`, kind, source: { adapterId: 'github', url: `https://github.com/${repo}`, resourceId: `${repo}#${asset.name}` }, fixedSource: !!tag, revision: release.tag_name, prerelease: release.prerelease === true, description: typeof release.body === 'string' ? release.body.slice(0, 4000) : undefined, target: { kind: 'file', url: publicUrl(asset.browser_download_url).href } })
        }
      }
      if (!tag && kind === 'extension') candidates.push({ name: `${repo} · Git repository`, kind, source: { adapterId: 'github', url: `https://github.com/${repo}`, resourceId: repo }, target: { kind: 'git', url: `https://github.com/${repo}.git` } })
      if (!candidates.length) throw new Error('No supported release assets were found; provide a direct package URL')
      return candidates
    },
  }
  github.check = async ({ source, kind, prerelease }, signal) => {
    const repo = githubRepository(publicUrl(source.url))
    const assetName = source.resourceId.includes('#') ? source.resourceId.slice(source.resourceId.indexOf('#') + 1) : undefined
    if (assetName) {
      const result = await json(`https://api.github.com/repos/${repo}/releases?per_page=30`, signal)
      if (!Array.isArray(result)) throw new Error('Invalid GitHub release list')
      let newest: PreparedResourceCandidate | null = null
      for (const release of result.map(record)) {
        if (release.draft || (!prerelease && release.prerelease) || typeof release.tag_name !== 'string') continue
        const assets = Array.isArray(release.assets) ? release.assets.map(record) : []
        const asset = assets.find(item => item.name === assetName)
        if (!asset || typeof asset.browser_download_url !== 'string') continue
        const metadata = assets.find(item => item.name === 'manifest.json')
        const manifestUrl = metadata && typeof metadata.browser_download_url === 'string' ? metadata.browser_download_url : `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(release.tag_name)}/manifest.json`
        const manifest = releaseManifest(await json(manifestUrl, signal))
        if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string' || !semver.valid(manifest.version)) throw new Error('Release Manifest has no valid identity/version')
        if (!prerelease && semver.prerelease(manifest.version)) continue
        if (!newest || semver.gt(manifest.version, newest.version!)) newest = { name: typeof manifest.displayName === 'string' ? manifest.displayName : repo, kind, source, packageId: manifest.id, version: manifest.version, revision: release.tag_name, prerelease: release.prerelease === true, target: { kind: 'file', url: publicUrl(asset.browser_download_url).href } }
      }
      return newest
    }
    if (source.resourceId !== repo) throw new Error('This GitHub file source does not declare an update manifest')
    const sourceParts = publicUrl(source.url).pathname.split('/').filter(Boolean)
    const selectedRef = sourceParts[2] === 'tree' ? decodeURIComponent(sourceParts.slice(3).join('/')) : 'HEAD'
    const commit = record(await json(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(selectedRef)}`, signal))
    if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('GitHub returned an invalid revision')
    const manifest = releaseManifest(await json(`https://raw.githubusercontent.com/${repo}/${commit.sha}/manifest.json`, signal))
    if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string' || !semver.valid(manifest.version)) throw new Error('Repository Manifest has no valid identity/version')
    return { name: typeof manifest.displayName === 'string' ? manifest.displayName : repo, kind, source, packageId: manifest.id, version: manifest.version, revision: commit.sha, target: { kind: 'git', url: `https://github.com/${repo}.git`, ref: commit.sha } }
  }
  const manifest: ResourceSourceAdapter = {
    id: 'manifest', matches: url => /\/manifest\.json$/i.test(url.pathname),
    resolve: async ({ url, kind }, signal) => [await fromManifest(url, kind, signal)],
    async check({ source, kind }, signal) { return fromManifest(source.url, kind, signal) },
  }
  const direct: ResourceSourceAdapter = {
    id: 'direct', matches: () => false,
    async resolve({ url, kind, ref }) {
      const parsed = publicUrl(url)
      const git = parsed.pathname.endsWith('.git') || ref !== undefined
      if (git && kind !== 'extension') throw new Error('Use a specific package file for cards and presets')
      return [{ name: decodeURIComponent(parsed.pathname.split('/').pop() || parsed.hostname), kind, source: { adapterId: 'direct', url: displayUrl(url), resourceId: displayUrl(url) }, target: git ? parseDownloadSource({ kind: 'git', url, ref }) as { kind: 'git'; url: string; ref?: string } : { kind: 'file', url: parsed.href } }]
    },
  }
  return [github, manifest, direct]
}
