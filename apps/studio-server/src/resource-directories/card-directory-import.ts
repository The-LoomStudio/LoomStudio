import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { basename, dirname, resolve, join } from 'node:path'
import { loadCardBundleFiles, type CardBundleFilesInput } from '../codecs/card-bundle-zip.js'
import { readOptional, replace, safePath } from './card-directory.js'

export function directoryFilesToken(files: ReadonlyMap<string, Uint8Array>): string {
  return createHash('sha256').update(JSON.stringify(fileHashes(files))).digest('hex')
}

function fileHashes(files: ReadonlyMap<string, Uint8Array>) {
  return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
}

export function createCardDirectoryImporter(options: {
  dataRoot: string
  isRegistered(directory: string): Promise<boolean>
  cardExists(cardId: string): Promise<boolean>
  importCard(bundle: CardBundleFilesInput, cardId: string, clientId: string): Promise<void>
  normalizeCard(cardId: string): Promise<void>
}) {
  const root = resolve(options.dataRoot)
  const importing = new Set<string>()
  async function finish(id: string) {
    await options.normalizeCard(id)
    await fs.rm(await safePath(root, `.loom/card-directories/${id}/import.json`))
  }
  return {
    async importDirectory(directory: string, token: string, clientId: string) {
      const selected = resolve(directory)
      if (dirname(selected) !== join(root, 'characters') || await fs.realpath(selected) !== selected) throw new Error('Import requires a real directory directly inside characters')
      if (importing.has(selected)) throw new Error('This directory is already being imported')
      importing.add(selected)
      const id = `card-${randomUUID()}`
      const metadata = `.loom/card-directories/${id}`
      try {
        if (await options.isRegistered(selected)) throw new Error('This directory is already registered')
        const { bundle, files } = await loadCardBundleFiles(async path => {
          const bytes = await readOptional(selected, path)
          if (!bytes) throw new Error(`Missing directory file: ${path}`)
          return bytes
        })
        if (directoryFilesToken(files) !== token) throw new Error('Directory changed since validation; refresh and import again')
        await replace(root, `${metadata}/import.json`, Buffer.from(JSON.stringify({ cardId: id })))
        await replace(root, `${metadata}/binding.json`, Buffer.from(JSON.stringify({ directoryName: basename(selected), artifactId: bundle.artifact.artifactId })))
        await replace(root, `${metadata}/baseline.json`, Buffer.from(JSON.stringify({ version: 1, cardId: id, files: fileHashes(files) })))
        await options.importCard(bundle, id, clientId)
        await finish(id)
        return { cardId: id }
      } catch (error) {
        if (await options.cardExists(id)) throw new Error(`Card imported as ${id}; directory finalization requires recovery. Do not import again. ${error instanceof Error ? error.message : String(error)}`, { cause: error })
        await fs.rm(await safePath(root, metadata), { recursive: true, force: true })
        throw error
      } finally { importing.delete(selected) }
    },
    async recoverImports() {
      const errors: Array<{ cardId: string; error: string }> = []
      const parent = await safePath(root, '.loom/card-directories')
      let entries: string[]
      try { entries = await fs.readdir(parent) } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return errors; throw error }
      for (const id of entries) {
        try {
          const bytes = await readOptional(root, `.loom/card-directories/${id}/import.json`)
          if (!bytes) continue
          if (JSON.parse(bytes.toString('utf8')).cardId !== id) throw new Error('Invalid directory import journal')
          if (await options.cardExists(id)) await finish(id)
          else await fs.rm(await safePath(root, `.loom/card-directories/${id}`), { recursive: true })
        } catch (error) { errors.push({ cardId: id, error: error instanceof Error ? error.message : String(error) }) }
      }
      return errors
    },
  }
}
