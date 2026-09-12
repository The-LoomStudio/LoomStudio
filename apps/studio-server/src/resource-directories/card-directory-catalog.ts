import * as fs from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { CardDirectoryAttachment, CardDirectoryCatalog, CardDirectoryEntry, JsonValue, OpenCardDirectoryResult } from '@loom-studio/shared'
import { loadCardBundleFiles } from '../codecs/card-bundle-zip.js'
import { validateBundlePath } from '../codecs/card-bundle-files.js'
import { readString } from '../rpc/rpc-params.js'
import { parseBaseline, readCardDirectoryBinding, readOptional } from './card-directory.js'
import { directoryFilesToken } from './card-directory-import.js'

export function createCardDirectoryCatalog(options: {
  dataRoot: string
  listCardIds(): Promise<string[]>
}) {
  const root = resolve(options.dataRoot)
  const characters = join(root, 'characters')
  let catalog: CardDirectoryCatalog = { root: characters, entries: [] }
  let scanning: Promise<CardDirectoryCatalog> | undefined

  async function scan(): Promise<CardDirectoryCatalog> {
    const result: CardDirectoryCatalog = { root: characters, entries: [] }
    try {
      let names: string[]
      try {
        if (await fs.realpath(characters) !== characters) throw new Error('Character directory cannot follow symbolic links')
        names = await fs.readdir(characters)
      } catch (error) {
        if (isMissing(error)) return catalog = result
        throw error
      }
      // ponytail: bounded local library scan; add pagination before supporting larger libraries.
      if (names.length > 4096) throw new Error('Character directory scan exceeds 4096 entries')
      const cardIds = new Set(await options.listCardIds())
      const bindings = new Map<string, { cardId: string; artifactId: string }>()
      for (const cardId of cardIds) {
        const binding = await readCardDirectoryBinding(root, cardId)
        if (!binding) continue
        if (bindings.has(binding.directoryName)) throw new Error('Multiple Cards are registered to the same directory')
        bindings.set(binding.directoryName, { cardId, artifactId: binding.artifactId })
      }
      for (const name of names.sort()) {
        const directory = join(characters, name)
        const entry: CardDirectoryEntry = { directory, name, sameSourceCount: 0 }
        try {
          const stat = await fs.lstat(directory)
          if (stat.isSymbolicLink()) throw new Error('Character project cannot be a symbolic link')
          if (!stat.isDirectory()) continue
          const manifest = await readHeader(directory, 'manifest.json')
          if (!manifest) continue
          const header = manifest.schema === 'loom.cardBundle.zip.v2'
            ? { metadata: manifest.resources?.metadata, card: (await readHeader(directory, manifest.resources?.card))?.config }
            : manifest.schema === 'loom.cardBundle.zip.v1'
              ? { metadata: manifest.artifact, card: manifest.artifact?.card }
              : undefined
          if (!header || typeof header.metadata?.artifactId !== 'string' || typeof header.card?.name !== 'string') {
            throw new Error('Invalid Loom Card directory header')
          }
          entry.name = header.card.name
          entry.artifactId = header.metadata.artifactId
          const sourceCardId = header.metadata.metadata?.exportedFromCardId
          if (typeof sourceCardId === 'string') entry.sourceCardId = sourceCardId
          const binding = bindings.get(name)
          const registeredId = binding?.cardId ?? (cardIds.has(name) ? name : undefined)
          if (registeredId) {
            const baseline = await readOptional(root, `.loom/card-directories/${registeredId}/baseline.json`)
            if (baseline) {
              parseBaseline(JSON.parse(baseline.toString('utf8')), registeredId)
              if (binding ? binding.artifactId !== entry.artifactId : entry.sourceCardId !== registeredId) throw new Error('Saved directory identity differs from its registered Card')
              entry.registeredCardId = registeredId
              for (const marker of ['import.json', 'apply.json', 'pending/journal.json']) {
                if (await readOptional(root, `.loom/card-directories/${registeredId}/${marker}`)) {
                  entry.error = 'Directory has an unfinished operation; recovery is required before further changes'
                  break
                }
              }
            }
          }
        } catch (error) {
          entry.error = message(error)
        }
        result.entries.push(entry)
      }
      for (const entry of result.entries) {
        if (!entry.artifactId) continue
        entry.sameSourceCount = result.entries.filter(other => other !== entry && (
          (entry.sourceCardId && other.sourceCardId === entry.sourceCardId) || other.artifactId === entry.artifactId
        )).length
      }
    } catch (error) {
      result.error = message(error)
    }
    catalog = result
    return result
  }

  async function open(directory: string): Promise<OpenCardDirectoryResult> {
    if (!isAbsolute(directory)) throw new Error('Select an absolute project directory')
    // An explicitly selected root may be reached via an OS alias; references may not escape it.
    const selected = await fs.realpath(directory)
    const assertNoPendingSave = async () => {
      const cardId = catalog.entries.find(entry => entry.directory === selected)?.registeredCardId ?? basename(selected)
      if (dirname(selected) === characters
        && await readOptional(root, `.loom/card-directories/${cardId}/pending/journal.json`)) {
        throw new Error('Card directory has an unfinished save; recover it before opening')
      }
    }
    await assertNoPendingSave()
    const { bundle, files } = await loadCardBundleFiles(async path => {
      const bytes = await readOptional(selected, path)
      if (!bytes) throw new Error(`Loom Card package is missing ${path}`)
      return bytes
    })
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!))
    const attachments: NonNullable<OpenCardDirectoryResult['attachments']> = []
    for (const [label, path] of Object.entries(manifest.media ?? {})) {
      if (typeof path === 'string' && files.has(path) && imageMediaType(path)) attachments.push({ path, kind: 'image', label, sizeBytes: files.get(path)!.byteLength })
    }
    // README is the one conventional document entry, not an arbitrary file or executable attachment scan.
    const readme = await readOptional(selected, 'README.md', 512 * 1024)
    if (readme) {
      attachments.push({ path: 'README.md', kind: 'document', label: 'README', sizeBytes: readme.byteLength })
    }
    await assertNoPendingSave()
    return {
      directory: selected,
      name: bundle.artifact.card.name,
      artifactId: bundle.artifact.artifactId,
      token: directoryFilesToken(files),
      description: bundle.artifact.card.description,
      files: [...files].map(([path, bytes]) => ({ path, sizeBytes: bytes.byteLength })).sort((a, b) => a.path.localeCompare(b.path)),
      totalBytes: [...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
      attachments,
      promptResources: bundle.artifact.contextAssets.map((node, index) => ({
        id: node.id, label: node.label, external: bundle.artifact.externalContextAssetIds?.includes(node.id) ?? false,
        ...(manifest.schema === 'loom.cardBundle.zip.v2' ? { indexPath: manifest.resources.contextAssets[index] } : {}),
      })),
      scriptCount: bundle.artifact.scriptAttachments?.length ?? 0,
      payloadCount: bundle.artifact.extensionPayloads?.length ?? 0,
    }
  }

  return {
    scan() {
      scanning ??= scan().finally(() => { scanning = undefined })
      return scanning
    },
    list: () => catalog,
    open,
    async attachment(directory: string, path: string): Promise<CardDirectoryAttachment> {
      const overview = await open(directory)
      const entry = overview.attachments!.find(item => item.path === path)
      if (!entry) throw new Error('File is not a supported card attachment')
      const bytes = await readOptional(overview.directory, path, entry.kind === 'document' ? 512 * 1024 : 64 * 1024 * 1024)
      if (!bytes) throw new Error('Attachment is missing')
      if (entry.kind === 'document') {
        return { kind: 'document', content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      }
      return { kind: 'image', content: `data:${imageMediaType(path)};base64,${bytes.toString('base64')}` }
    },
    async call(method: string, params: JsonValue | undefined): Promise<JsonValue> {
      if (method === 'directories.list') return this.list() as unknown as JsonValue
      if (method === 'directories.scan') return await this.scan() as unknown as JsonValue
      if (method === 'directories.open') return await this.open(readString(params, 'directory')) as unknown as JsonValue
      if (method === 'directories.attachment') return await this.attachment(readString(params, 'directory'), readString(params, 'path')) as unknown as JsonValue
      throw new Error(`Unknown directory catalog method: ${method}`)
    },
  }
}

function imageMediaType(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string, string>)[extension ?? '']
}

type DirectoryHeader = {
  schema?: string
  resources?: { metadata?: ArtifactHeader; card?: string }
  artifact?: ArtifactHeader & { card?: { name?: string } }
  config?: { name?: string }
}
type ArtifactHeader = { artifactId?: string; metadata?: { exportedFromCardId?: string } }

async function readHeader(root: string, path: string | undefined): Promise<DirectoryHeader | null> {
  if (typeof path !== 'string') throw new Error('Missing Card header path')
  validateBundlePath(path)
  const target = join(root, path)
  const stat = await fs.lstat(target).catch(error => {
    if (isMissing(error)) return null
    throw error
  })
  if (!stat) return null
  if (stat.size > 4 * 1024 * 1024) throw new Error(`Directory header exceeds 4 MiB: ${basename(path)}`)
  const bytes = await readOptional(root, path)
  if (!bytes) return null
  if (bytes.length > 4 * 1024 * 1024) throw new Error(`Directory header exceeds 4 MiB: ${basename(path)}`)
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Card directory header object')
  return value as DirectoryHeader
}

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
