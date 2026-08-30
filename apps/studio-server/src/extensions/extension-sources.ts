import { parseExtensionManifest, type ExtensionManifest } from '@loom-studio/extension-host'
import { access, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { isAbsolute, relative, resolve } from 'node:path'

export type ExtensionSourceKind = 'repository' | 'dev-link' | 'installed'

export type ExtensionSource = {
  kind: ExtensionSourceKind
  directory: string
  declaredPackageId?: string
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
    () => scanInstalledDirectories(options.installedDirectory),
    sources,
    failures,
  )

  for (const source of sources) {
    try {
      const directory = await realpath(source.directory)
      const manifest = parseExtensionManifest(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as unknown)
      if (source.declaredPackageId && source.declaredPackageId !== manifest.id) {
        throw new Error(`Dev link package id ${source.declaredPackageId} does not match manifest id ${manifest.id}`)
      }
      for (const moduleManifest of manifest.modules ?? []) {
        await assertEntryInsideDirectory(directory, moduleManifest.entry)
      }
      for (const rule of manifest.contributes?.transformRules ?? []) {
        await assertEntryInsideDirectory(directory, rule.source)
      }
      for (const resource of manifest.contributes?.promptResources ?? []) {
        await assertEntryInsideDirectory(directory, resource.source)
      }
      for (const tool of manifest.contributes?.agentTools ?? []) {
        await assertEntryInsideDirectory(directory, tool.source)
      }
      if (manifest.icon) await assertEntryInsideDirectory(directory, manifest.icon)
      discovered.push({ ...source, directory, manifest })
    } catch (error) {
      failures.push({ source, error })
    }
  }

  return { discovered, failures }
}

async function scanInstalledDirectories(parent: string): Promise<ExtensionSource[]> {
  let packageEntries
  try {
    packageEntries = await readdir(parent, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return []
    throw error
  }

  const sources: ExtensionSource[] = []
  for (const packageEntry of packageEntries) {
    if (packageEntry.name === '.staging' || !packageEntry.isDirectory()) continue
    const packageDirectory = resolve(parent, packageEntry.name)
    const versionEntries = await readdir(packageDirectory, { withFileTypes: true })
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory()) continue
      const directory = resolve(packageDirectory, versionEntry.name)
      try {
        await access(resolve(directory, 'manifest.json'))
        sources.push({ kind: 'installed', directory })
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
    }
  }
  return sources
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
    return { kind: 'dev-link' as const, directory: entry.path, declaredPackageId: entry.id }
  })
}

export async function removeExtensionDevLink(filename: string, packageId: string): Promise<boolean> {
  let source: string
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false
    throw error
  }
  const value = JSON.parse(source) as unknown
  if (!isRecord(value) || !Array.isArray(value.extensions)) {
    throw new Error('Extension dev links must contain an extensions array')
  }
  const extensions = value.extensions.filter((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.path !== 'string' || !isAbsolute(entry.path)) {
      throw new Error(`Invalid extension dev link at index ${index}`)
    }
    return entry.id !== packageId
  })
  if (extensions.length === value.extensions.length) return false
  await mkdir(dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify({ extensions }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, filename)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return true
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
  throw new Error(`Extension package path must stay inside its directory: ${entry}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
