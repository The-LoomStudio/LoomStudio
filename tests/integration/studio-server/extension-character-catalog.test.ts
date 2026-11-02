import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import { encodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { defaultCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

describe('extension character catalog', () => {
  it.skipIf(!existsSync(resolve('official/extensions/loom-assistant/manifest.json')))('serves repository character previews using the active file revision', async () => {
    await withStudioServer(async port => {
      const result = await callRpc<{ characters: Array<{ previewUrl: string }> }>(port, 'extensions.listCharacters', { packageId: 'official.loom-assistant' })
      const url = result.characters[0]!.previewUrl
      expect(url).toMatch(/\/1\.0\.0-[^/]+\/files\//)
      const response = await authenticatedFetch(port, url)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('image/png')
      expect(new Uint8Array(await response.arrayBuffer()).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    }, resolve('official/extensions'))
  })

  it.skipIf(!existsSync(resolve('official/extensions/loom-assistant/manifest.json')))('imports the real Nom template and uses its global assistant without copying knowledge', async () => {
    await withStudioServer(async port => {
      const packageId = 'official.loom-assistant'
      await callRpc(port, 'extensions.installPackage', { sourceDirectory: resolve('official/extensions/loom-assistant') })
      const resources = await callRpc<{ promptResources: Array<{ contributionId: string; resourceId: string }> }>(port, 'extensions.importPackageResources', { packageId })
      const presetId = resources.promptResources.find(item => item.contributionId === 'official.loom-assistant.preset')!.resourceId
      expect(presetId).not.toBe('official.loom-assistant.preset')
      const before = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', {})
      expect(await callRpc(port, 'extensions.listCharacters', { packageId })).toMatchObject({ characters: [{ id: 'nom', importedCards: [] }] })
      expect(await callRpc(port, 'application.listCards', {})).toMatchObject({ cards: [] })
      const input = { packageId, characterId: 'nom' }
      const preview = await callRpc<{ digest: string; blockers: string[] }>(port, 'extensions.previewCharacter', input)
      expect(preview.blockers).toEqual([])
      const { cardId } = await callRpc<{ cardId: string }>(port, 'extensions.importCharacter', { ...input, digest: preview.digest })
      const { timeline } = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId })
      expect(await callRpc(port, 'application.getAgentSession', { agentSessionId: timeline.id })).toMatchObject({ session: { agentPresetId: presetId } })
      const exported = await callRpc<{ artifact: CardBundleArtifact }>(port, 'application.exportCardBundle', { cardId })
      expect(exported.artifact.card.extensionDependencies).toEqual([{ id: packageId, version: '^1.0.0', target: 'global' }])
      expect(exported.artifact.card.defaultPreset).toEqual({ packageId, contributionId: 'official.loom-assistant.preset', target: 'global' })
      expect(exported.artifact.contextAssets).toEqual([])
      expect(exported.artifact.extensionPackages).toEqual([])
      const copy = await callRpc<{ card: { id: string } }>(port, 'application.importCardBundle', { artifact: exported.artifact })
      const roundtrip = await callRpc<{ artifact: CardBundleArtifact }>(port, 'application.exportCardBundle', { cardId: copy.card.id })
      expect(roundtrip.artifact.card.extensionDependencies).toEqual(exported.artifact.card.extensionDependencies)
      expect(roundtrip.artifact.card.defaultPreset).toEqual(exported.artifact.card.defaultPreset)
      const after = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', {})
      expect(after.resources.map(resource => resource.id).sort()).toEqual(before.resources.map(resource => resource.id).sort())
    })
  })

  it('only creates a user Card after a current preview is explicitly imported', async () => {
    await withStudioServer(async (port, directory) => {
      const packageId = 'example.character-catalog'
      const source = join(directory, 'catalog-source')
      await mkdir(source)
      await writeFile(join(source, 'manifest.json'), JSON.stringify({
        manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Characters', engines: { studio: '^0.1.0' },
        contributes: { characters: [{ id: 'nom', name: 'Nom', source: './nom.zip' }] },
      }))
      await writeFile(join(source, 'nom.zip'), encodeCardBundleZip({
        artifact: { schemaVersion: 4, artifactId: 'nom-template', displayName: 'Nom', card: { name: 'Nom', opening: 'Hello' }, contextAssets: [] },
        avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
      }))
      await callRpc(port, 'extensions.installPackage', { sourceDirectory: source })
      const input = { packageId, characterId: 'nom' }
      const listing = await callRpc<{ characters: Array<{ id: string; importedCards: unknown[] }> }>(port, 'extensions.listCharacters', { packageId })
      expect(listing.characters).toMatchObject([{ id: 'nom', importedCards: [] }])
      expect(await callRpc(port, 'application.listCards', {})).toMatchObject({ cards: [] })
      const preview = await callRpc<{ digest: string; blockers: string[] }>(port, 'extensions.previewCharacter', input)
      expect(preview.blockers).toEqual([])
      await expect(callRpc(port, 'extensions.importCharacter', { ...input, digest: 'stale' })).rejects.toThrow('changed')
      expect(await callRpc(port, 'application.listCards', {})).toMatchObject({ cards: [] })
      const imported = await callRpc<{ cardId: string }>(port, 'extensions.importCharacter', { ...input, digest: preview.digest })
      const card = await callRpc<{ card: { catalogSource: unknown; media: { avatarAssetId: string } } }>(port, 'application.getCard', { cardId: imported.cardId })
      expect(card.card.catalogSource).toEqual({ ...input, version: '1.0.0', digest: preview.digest })
      expect(card.card.media.avatarAssetId).toBeTruthy()
      await expect(callRpc(port, 'extensions.importCharacter', { ...input, digest: preview.digest })).rejects.toThrow('already been added')
      expect(await callRpc(port, 'extensions.listCharacters', { packageId })).toMatchObject({ characters: [{ importedCards: [{ id: imported.cardId, name: 'Nom' }] }] })
      const duplicate = await callRpc<{ cardId: string }>(port, 'extensions.importCharacter', { ...input, digest: preview.digest, allowDuplicate: true })
      expect(duplicate.cardId).not.toBe(imported.cardId)
    })
  })
})
