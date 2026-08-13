import { parseExtensionManifest, type ExtensionManifest } from '@loom-studio/extension-host'
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export type ExtensionSourceKind = 'repository' | 'dev-link' | 'installed'

export type ExtensionSource = {
  kind: ExtensionSourceKind
  directory: string
  declaredId?: string
}

export type DiscoveredExtensionSource = ExtensionSource & {
  manifest: ExtensionManifest
}

export type ExtensionSourceFailure = {
  source: ExtensionSource
  error: unknown
}

export async function discoverExtensionSources(options: {
  repositoryDirectory: string
  installedDirectory: string
  devLinksFile: string
}): Promise<{
  discovered: DiscoveredExtensionSource[]
  failures: ExtensionSourceFailure[]
}> {
  const sources: ExtensionSource[] = []
  const discovered: DiscoveredExtensionSource[] = []
  const failures: ExtensionSourceFailure[] = []

  await collectSources(
    { kind: 'repository', directory: options.repositoryDirectory },
    () => scanChildDirectories(options.repositoryDirectory, 'repository'),
    sources,
    failures,
  )
  await collectSources(
    { kind: 'dev-link', directory: options.devLinksFile },
    () => readDevLinks(options.devLinksFile),
    sources,
    failures,
  )
  await collectSources(
    { kind: 'installed', directory: options.installedDirectory },
    () => scanChildDirectories(options.installedDirectory, 'installed'),
    sources,
    failures,
  )

  for (const source of sources) {
    try {
      const directory = await realpath(source.directory)
      const manifest = parseExtensionManifest(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as unknown)
      if (source.declaredId && source.declaredId !== manifest.id) {
        throw new Error(`Dev link id ${source.declaredId} does not match manifest id ${manifest.id}`)
      }
      const serverEntry = manifest.server?.entry
      if (!serverEntry) throw new Error('server.entry is required')
      await assertEntryInsideDirectory(directory, serverEntry)
      discovered.push({ ...source, directory, manifest })
    } catch (error) {
      failures.push({ source, error })
    }
  }

  return { discovered, failures }
}

async function collectSources(
  boundary: ExtensionSource,
  read: () => Promise<ExtensionSource[]>,
  sources: ExtensionSource[],
  failures: ExtensionSourceFailure[],
): Promise<void> {
  try {
    sources.push(...await read())
  } catch (error) {
    failures.push({ source: boundary, error })
  }
}

async function scanChildDirectories(parent: string, kind: 'repository' | 'installed'): Promise<ExtensionSource[]> {
  let entries
  try {
    entries = await readdir(parent, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return []
    throw error
  }

  const sources: ExtensionSource[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const directory = resolve(parent, entry.name)
    try {
      await access(resolve(directory, 'manifest.json'))
      sources.push({ kind, directory })
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
    }
  }
  return sources
}

async function readDevLinks(filename: string): Promise<ExtensionSource[]> {
  let source
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return []
    throw error
  }

  const value = JSON.parse(source) as unknown
  if (!isRecord(value) || !Array.isArray(value.extensions)) {
    throw new Error('Extension dev links must contain an extensions array')
  }

  return value.extensions.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.path !== 'string' || !isAbsolute(entry.path)) {
      throw new Error(`Invalid extension dev link at index ${index}`)
    }
    return { kind: 'dev-link' as const, directory: entry.path, declaredId: entry.id }
  })
}

async function assertEntryInsideDirectory(directory: string, entry: string): Promise<void> {
  const directoryPath = await realpath(directory)
  const candidate = resolve(directoryPath, entry)
  assertContained(directoryPath, candidate, entry)
  try {
    assertContained(directoryPath, await realpath(candidate), entry)
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error
  }
}

function assertContained(directory: string, candidate: string, entry: string): void {
  const pathFromDirectory = relative(directory, candidate)
  if (pathFromDirectory && !pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory)) return
  throw new Error(`Extension server entry must stay inside its directory: ${entry}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
