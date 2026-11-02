import { createHash } from 'node:crypto'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { ExtensionManifest } from '@loom-studio/extension-sdk'
import type { ExtensionCharacterCatalogService } from '@loom-studio/kernel'
import { decodeCardBundleZip } from '../codecs/card-bundle-zip.js'
import type { createCardTransferService } from '../codecs/card-transfer-service.js'

type Options = {
  runtime: ApplicationRuntime
  readPackage(packageId: string): { manifest: ExtensionManifest; fileUrl(path: string): string; read(path: string): Promise<Uint8Array> }
  importArchive: ReturnType<typeof createCardTransferService>['importArchiveAndSave']
}

/** Catalog reads never materialize a Card or execute the code carried by its archive. */
export function createExtensionCharacterCatalog(options: Options): ExtensionCharacterCatalogService {
  const importing = new Set<string>()
  async function importedCards(packageId: string, characterId: string) {
    const result: Array<{ id: string; name: string }> = []
    let cursor: string | undefined
    do {
      const page = await options.runtime.listCards({ limit: 100, ...(cursor ? { cursor } : {}) })
      for (const card of page.cards) {
        if (card.catalogSource?.packageId === packageId && card.catalogSource.characterId === characterId) result.push({ id: card.id, name: card.name })
      }
      cursor = page.nextCursor
    } while (cursor)
    return result
  }
  async function prepare(packageId: string, characterId: string) {
    const pkg = options.readPackage(packageId)
    const character = pkg.manifest.contributes?.characters?.find(item => item.id === characterId)
    if (!character) throw new Error(`Character is not provided by this extension: ${characterId}`)
    const bytes = await pkg.read(character.source)
    const digest = createHash('sha256').update(JSON.stringify({ version: pkg.manifest.version, character })).update(bytes).digest('hex')
    const bundle = await decodeCardBundleZip(bytes)
    // The host supplies provenance; a bundled archive cannot impersonate another catalog.
    bundle.artifact.card.catalogSource = { packageId, characterId, version: pkg.manifest.version, digest }
    return { character, bundle, digest, version: pkg.manifest.version }
  }
  return {
    async list(packageId) {
      const { manifest, fileUrl } = options.readPackage(packageId)
      return { characters: await Promise.all((manifest.contributes?.characters ?? []).map(async character => ({
        id: character.id, name: character.name, description: character.description,
        previewUrl: character.preview ? fileUrl(character.preview) : undefined,
        importedCards: await importedCards(packageId, character.id),
      }))) }
    },
    async preview(packageId, characterId) {
      const prepared = await prepare(packageId, characterId)
      const blockers: string[] = []
      try { await options.runtime.validateCardFramework({ card: prepared.bundle.artifact.card }) }
      catch (error) { blockers.push(error instanceof Error ? error.message : String(error)) }
      return {
        packageId, characterId, version: prepared.version, digest: prepared.digest,
        name: prepared.bundle.artifact.card.name,
        dependencies: prepared.bundle.artifact.card.extensionDependencies ?? [],
        embeddedPackages: (prepared.bundle.artifact.extensionPackages ?? []).map(item => ({ packageId: item.packageId, version: item.version })),
        importedCards: await importedCards(packageId, characterId), blockers,
      }
    },
    async import(input, clientId) {
      const key = JSON.stringify([input.packageId, input.characterId])
      if (importing.has(key)) throw new Error('This character is already being imported')
      importing.add(key)
      try {
        const prepared = await prepare(input.packageId, input.characterId)
        if (prepared.digest !== input.digest) throw new Error('Character package changed; preview it again before importing')
        if (!input.allowDuplicate && (await importedCards(input.packageId, input.characterId)).length) throw new Error('This character has already been added; open it or explicitly add another copy')
        await options.runtime.validateCardFramework({ card: prepared.bundle.artifact.card })
        const result = await options.importArchive(prepared.bundle, clientId)
        return { cardId: result.card.id, name: result.card.name }
      } finally { importing.delete(key) }
    },
  }
}
