import type { ExtensionDownloadSource, ExtensionManifest } from '@loom-studio/extension-host'
import { parseExtensionManifest } from '@loom-studio/extension-host'
import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
import { installExtensionPackageFromDirectory, installExtensionPackageFromZip } from './extension-package-installer.js'

const exec = promisify(execFile)
const semver = createRequire(import.meta.url)('semver') as {
  validRange(value: string): string | null
  satisfies(version: string, range: string): boolean
}
const downloadLimit = 256 * 1024 * 1024
export type ExtensionCandidate = {
  manifest: ExtensionManifest
  directory: string
  source?: ExtensionDownloadSource
  commit?: string
}

export function parseDownloadSource(input: unknown): ExtensionDownloadSource {
  if (!input || typeof input !== 'object') throw new Error('Extension source is required')
  const value = input as Record<string, unknown>
  if ((value.kind !== 'git' && value.kind !== 'zip') || typeof value.url !== 'string') throw new Error('Extension source must be Git or ZIP')
  const url = new URL(value.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Extension source requires public HTTPS without credentials')
  if (value.kind === 'zip') return { kind: 'zip', url: url.href }
  if (url.search) throw new Error('Git source cannot contain URL query parameters')
  if (value.ref !== undefined && (typeof value.ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.ref)
    || value.ref.includes('..') || value.ref.length > 200)) throw new Error('Invalid Git branch, Tag or commit')
  return { kind: 'git', url: url.href, ...(typeof value.ref === 'string' ? { ref: value.ref } : {}) }
}

export function satisfiesExtensionVersion(version: string, range: string): boolean {
  if (!semver.validRange(range)) throw new Error(`Invalid extension dependency version range: ${range}`)
  return semver.satisfies(version, range)
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a !== 0 && a !== 10 && a !== 127 && a !== 169 && a! < 224
      && !(a === 172 && b! >= 16 && b! <= 31) && !(a === 192 && b === 168)
      && !(a === 100 && b! >= 64 && b! <= 127) && !(a === 198 && (b === 18 || b === 19))
  }
  // Only global unicast IPv6; excludes loopback, link-local, ULA and mapped IPv4.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
}

async function publicEndpoint(url: URL) {
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true })
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Extension source cannot address a local or private network')
  return addresses[0]!
}

export async function downloadExtensionZip(source: ExtensionDownloadSource, redirects = 0, limits = { maxBytes: downloadLimit, timeoutMs: 120_000 }): Promise<Uint8Array> {
  if (source.kind !== 'zip') throw new Error('ZIP source is required')
  const url = new URL(source.url)
  const endpoint = await publicEndpoint(url)
  return new Promise((resolve, reject) => {
    const req = request(url, {
      family: endpoint.family,
      lookup: (_host, _options, callback) => callback(null, endpoint.address, endpoint.family),
      headers: { 'User-Agent': 'LoomStudio-Extension-Installer' },
    }, response => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (!response.headers.location || redirects >= 5) return reject(new Error('Extension download redirect limit exceeded'))
        try {
          const next = parseDownloadSource({ kind: 'zip', url: new URL(response.headers.location, url).href })
          downloadExtensionZip(next, redirects + 1, limits).then(resolve, reject)
        } catch (error) { reject(error) }
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Extension download failed: HTTP ${response.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > limits.maxBytes) response.destroy(new Error(`Extension download exceeds ${limits.maxBytes} bytes`))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    const timer = setTimeout(() => req.destroy(new Error('Extension download timed out')), limits.timeoutMs)
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end()
  })
}

export async function extensionGit(args: string[], cwd?: string): Promise<string> {
  try {
    const result = await exec('git', [
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
      '-c', 'http.followRedirects=false', '-c', 'http.proxy=',
      '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false', '-c', 'http.extraHeader=',
      '-c', 'http.cookieFile=', '-c', 'http.saveCookies=false', ...args,
    ], {
      cwd, timeout: 120_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    })
    return result.stdout.trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Git is required for Git extension sources. Install Git or use a ZIP package.', { cause: error })
    throw error
  }
}

async function remoteGit(args: string[], url: URL, cwd = tmpdir()): Promise<string> {
  const version = await extensionGit(['--version'])
  const match = /git version (\d+)\.(\d+)/.exec(version)
  if (!match || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 37)) throw new Error('Git 2.37 or newer is required for safe HTTPS extension fetching')
  const endpoint = await publicEndpoint(url)
  const address = endpoint.family === 6 ? `[${endpoint.address}]` : endpoint.address
  return extensionGit([
    '-c', 'http.curloptResolve=',
    '-c', `http.curloptResolve=${url.hostname}:${url.port || '443'}:${address}`,
    '-c', 'http.sslVerify=true', ...args,
  ], cwd)
}

export async function acquireExtension(sourceInput: unknown, parent: string): Promise<ExtensionCandidate> {
  const source = parseDownloadSource(sourceInput)
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'candidate-'))
  try {
    if (source.kind === 'zip') {
      const installed = await installExtensionPackageFromZip({ source: await downloadExtensionZip(source), installedDirectory: root })
      return { ...installed, source }
    }
    const url = new URL(source.url)
    const repository = join(root, 'repository')
    await remoteGit(['clone', '--depth=1', '--no-checkout', '--no-tags', '--', source.url, repository], url, root)
    let ref = source.ref ?? (await extensionGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], repository)).replace('refs/remotes/origin/', 'refs/heads/')
    if (!/^[a-f0-9]{40}$/i.test(ref) && !ref.startsWith('refs/heads/') && !ref.startsWith('refs/tags/')) {
      const refs = await remoteGit(['ls-remote', '--exit-code', source.url, `refs/heads/${ref}`, `refs/tags/${ref}`], url)
      if (refs.split('\n').some(line => line.endsWith(`\trefs/heads/${ref}`))) ref = `refs/heads/${ref}`
      else if (refs.split('\n').some(line => line.endsWith(`\trefs/tags/${ref}`))) ref = `refs/tags/${ref}`
      else throw new Error('Selected Git branch or Tag does not exist')
    }
    await remoteGit(['fetch', '--depth=1', '--no-tags', 'origin', ref], url, repository)
    await extensionGit(['checkout', '--detach', 'FETCH_HEAD'], repository)
    const commit = await extensionGit(['rev-parse', 'HEAD'], repository)
    const installed = await installExtensionPackageFromDirectory({ sourceDirectory: repository, installedDirectory: join(root, 'validated') })
    await cp(join(repository, '.git'), join(installed.directory, '.git'), { recursive: true })
    return { ...installed, source: { ...source, ref }, commit }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export async function checkGitUpdate(candidate: { source: ExtensionDownloadSource; commit?: string }) {
  const source = parseDownloadSource(candidate.source)
  if (source.kind !== 'git') throw new Error('ZIP installations do not support update checks')
  if (!source.ref) throw new Error('Git installation is missing its selected ref')
  if (/^[a-f0-9]{40}$/i.test(source.ref) || source.ref.startsWith('refs/tags/')) return { changed: false, ...(candidate.commit ? { commit: candidate.commit } : {}), locked: true }
  const branch = source.ref.startsWith('refs/heads/') ? source.ref : `refs/heads/${source.ref}`
  const output = await remoteGit(['ls-remote', '--exit-code', source.url, branch], new URL(source.url))
  const refs = new Map(output.split('\n').filter(Boolean).map(line => line.split(/\s+/) as [string, string]).map(([hash, ref]) => [ref, hash]))
  const commit = refs.get(branch)
  if (!commit) throw new Error('Selected Git ref no longer exists')
  return { changed: commit !== candidate.commit, commit, locked: false }
}

export async function readDownloadMetadata(directory: string): Promise<(ExtensionCandidate & { source: ExtensionDownloadSource; previous?: { source: ExtensionDownloadSource; commit?: string } }) | undefined> {
  let text: string
  try { text = await readFile(join(directory, '.loom-source.json'), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  const value = JSON.parse(text)
  const source = parseDownloadSource(value.source)
  if (source.kind === 'git' && !/^[0-9a-f]{40}$/i.test(value.commit)) throw new Error('Invalid stored Git commit')
  const manifest = parseExtensionManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))
  return { manifest, directory, source, ...(value.commit ? { commit: value.commit } : {}),
    ...(value.previous ? { previous: { source: parseDownloadSource(value.previous.source), ...(value.previous.commit ? { commit: value.previous.commit } : {}) } } : {}) }
}

export async function createDownloadWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'loom-extension-download-'))
}
