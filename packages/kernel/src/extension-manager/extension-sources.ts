import type { ExtensionManifest } from '@loom-studio/extension-sdk'
import { isRecord, type JsonValue } from '@loom-studio/shared'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { SqliteDataEngine } from '../data-engine/index.js'
import { parseExtensionManifest } from '../extension-host/index.js'
import { writeJsonAtomically } from '../platform/atomic-json.js'
import { resolvePromptResourceFiles, type PromptResourceFileLoader } from './extension-package-installer.js'
import {
  initializeExtensionStateSchema,
  markExtensionStateSourceMigrated,
  readExtensionDevLinksFile,
  type ExtensionDevLinkRecord,
} from './extension-state-store.js'

const extensionDevLinksActor = { kind: 'kernel' as const, id: 'platform.extension-state' }

type ExtensionSourceKind = 'repository' | 'dev-link' | 'installed'

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
  repositoryDirectory?: string
  bundledDirectories?: readonly string[]
  installedDirectory: string
  devLinksFile?: string
  engine?: SqliteDataEngine
  now?: () => string
  loadPromptResourceFiles?: PromptResourceFileLoader
}): Promise<{
  discovered: DiscoveredExtensionSource[]
  failures: ExtensionSourceFailure[]
}> {
  const sources: ExtensionSource[] = []
  const discovered: DiscoveredExtensionSource[] = []
  const failures: ExtensionSourceFailure[] = []

  if (options.repositoryDirectory) {
    const repositoryDirectory = options.repositoryDirectory
    await collectSources(
      { kind: 'repository', directory: repositoryDirectory },
      () => scanChildDirectories(repositoryDirectory, 'repository'),
      sources,
      failures,
    )
  }
  sources.push(...(options.bundledDirectories ?? []).map(directory => ({ kind: 'repository' as const, directory })))
  await collectSources(
    { kind: 'dev-link', directory: options.devLinksFile ?? 'sqlite:extension_dev_links' },
    () => readDevLinks(options.devLinksFile, options.engine),
    sources,
    failures,
  )
  await collectSources(
    { kind: 'installed', directory: options.installedDirectory },
    () => scanChildDirectories(options.installedDirectory, 'installed'),
    sources,
    failures,
  )

  const seen = new Set<string>()
  for (const source of sources) {
    try {
      const directory = await realpath(source.directory)
      const identity = JSON.stringify([source.kind, directory])
      if (seen.has(identity)) continue
      seen.add(identity)
      const manifest = parseExtensionManifest(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as unknown)
      if (source.declaredPackageId && source.declaredPackageId !== manifest.id) {
        throw new Error(`Dev link package id ${source.declaredPackageId} does not match manifest id ${manifest.id}`)
      }
      for (const moduleManifest of manifest.modules ?? []) {
        await assertEntryInsideDirectory(directory, moduleManifest.entry)
      }
      for (const background of manifest.contributes?.backgrounds ?? []) {
        await assertEntryInsideDirectory(directory, background.image)
      }
      for (const rule of manifest.contributes?.transformRules ?? []) {
        await assertEntryInsideDirectory(directory, rule.source)
      }
      for (const extractor of manifest.contributes?.textExtractors ?? []) {
        await assertEntryInsideDirectory(directory, extractor.source)
      }
      for (const resource of manifest.contributes?.promptResources ?? []) {
        await assertEntryInsideDirectory(directory, resource.source)
        const sourcePath = resolve(directory, resource.source)
        // Missing build outputs remain discoverable; installation reports the existing actionable error.
        try {
          const sourceStat = await stat(sourcePath)
          if (sourceStat.size > 16 * 1024 * 1024) throw new Error('Prompt Resource exceeds maximum size')
          await resolvePromptResourceFiles(
            JSON.parse(await readFile(sourcePath, 'utf8')) as JsonValue,
            async path => {
              const candidate = resolve(dirname(sourcePath), path)
              await assertEntryInsideDirectory(directory, relative(directory, candidate))
              const info = await stat(candidate)
              if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('Invalid Prompt Resource file size or type')
              return readFile(candidate)
            },
            options.loadPromptResourceFiles,
          )
        } catch (error) {
          if (!isNodeError(error, 'ENOENT')) throw error
        }
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
    if (entry.name.startsWith('.')) continue
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

async function readDevLinks(
  filename?: string,
  engine?: SqliteDataEngine,
): Promise<ExtensionSource[]> {
  if (!engine) {
    if (!filename) return []
    const links = await readExtensionDevLinksFile(filename)
    return links.map(toDevLinkSource)
  }

  initializeExtensionStateSchema(engine)
  const rows = await readDevLinksFromSqlite(engine)
  return rows.map(toDevLinkSource)
}

export async function removeExtensionDevLink(
  filename: string | undefined,
  packageId: string,
  engine?: SqliteDataEngine,
  now?: () => string,
): Promise<boolean> {
  if (engine) {
    initializeExtensionStateSchema(engine)
    const existing = await engine.read(db =>
      db
        .prepare('SELECT package_id FROM extension_dev_links WHERE package_id = ?')
        .get(packageId) as { package_id: string } | undefined,
    )
    if (!existing) return false

    let removed = false
    await engine.transact(
      { actor: extensionDevLinksActor, reason: 'extension-dev-links.remove' },
      async tx => {
        const info = tx.database.prepare('DELETE FROM extension_dev_links WHERE package_id = ?').run(packageId)
        if (info.changes > 0) {
          markExtensionStateSourceMigrated(tx.database, 'dev-links', now?.() ?? new Date().toISOString())
          tx.recordOperations([
            {
              store: 'extension-state',
              kind: 'delete',
              entityId: packageId,
              entityType: 'extension.dev-link',
            },
          ])
          removed = true
        }
      },
    )
    return removed
  }

  if (!filename) return false
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
  await writeJsonAtomically(filename, { extensions })
  return true
}

async function readDevLinksFromSqlite(engine: SqliteDataEngine): Promise<ExtensionDevLinkRecord[]> {
  return engine.read(db => {
    const rows = db
      .prepare('SELECT package_id, directory FROM extension_dev_links ORDER BY package_id')
      .all() as Array<{ package_id: string; directory: string }>
    return rows.map(row => ({ packageId: row.package_id, directory: row.directory }))
  })
}

function toDevLinkSource(link: ExtensionDevLinkRecord): ExtensionSource {
  return { kind: 'dev-link', directory: link.directory, declaredPackageId: link.packageId }
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
