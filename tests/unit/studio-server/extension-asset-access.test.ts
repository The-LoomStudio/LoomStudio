import { describe, expect, it, onTestFinished } from 'vitest'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes, extensionInstallationId, type ExtensionInstallationTarget } from '@loom-studio/application-runtime'
import { canExtensionConsumeAsset, canAccessExtensionAsset } from '../../../apps/studio-server/src/extensions/extension-asset-access.js'

async function fixture(target: ExtensionInstallationTarget, version = '1.2.0') {
  const documents = createInMemoryDocumentStore(); onTestFinished(() => documents.close())
  const id = extensionInstallationId('example.media', target)
  await documents.write({ id, type: applicationDocumentTypes.extensionInstallation, content: {
    packageId: 'example.media', packageVersion: version, target,
    createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
  } })
  return { documents, asset: { ownerPackageId: 'example.media', ...(target.kind === 'card' ? { ownerInstallationId: id } : {}) } }
}
const consumer = { packageId: 'example.consumer', dependencies: [{ id: 'example.media', version: '^1.0.0' }] }

describe('extension-owned media dependency access', () => {
  it('requires a declared and compatible installed dependency for global owned assets', async () => {
    const { documents, asset } = await fixture({ kind: 'global' })
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'global' }, { packageId: consumer.packageId })).rejects.toThrow('not declared')
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'global' }, { ...consumer, dependencies: [{ id: 'example.media', version: '^2.0.0' }] })).rejects.toThrow('version mismatch')
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'global' }, consumer)).resolves.toBe(true)
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'card', cardId: 'A' }, consumer)).resolves.toBe(true)
  })
  it('permits only the same Card for a Card-owned dependency and rejects global access', async () => {
    const { documents, asset } = await fixture({ kind: 'card', cardId: 'A' })
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'card', cardId: 'A' }, consumer)).resolves.toBe(true)
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'card', cardId: 'B' }, consumer)).rejects.toThrow('another Card')
    await expect(canExtensionConsumeAsset(documents, asset, { kind: 'global' }, consumer)).rejects.toThrow('another Card')
  })
  it('does not turn user assets or ordinary user HTTP checks into manifest dependencies', async () => {
    const { documents, asset } = await fixture({ kind: 'global' })
    await expect(canExtensionConsumeAsset(documents, {}, { kind: 'global' }, { packageId: 'example.consumer' })).resolves.toBe(true)
    await expect(canAccessExtensionAsset(documents, asset, { kind: 'global' })).resolves.toBe(true)
  })
  it('rejects an absent or mismatched owning installation', async () => {
    const { documents, asset } = await fixture({ kind: 'card', cardId: 'A' })
    await expect(canExtensionConsumeAsset(documents, { ...asset, ownerInstallationId: 'missing' }, { kind: 'card', cardId: 'A' }, consumer)).resolves.toBe(false)
    await expect(canExtensionConsumeAsset(documents, { ...asset, ownerPackageId: 'different.package' }, { kind: 'card', cardId: 'A' }, consumer)).resolves.toBe(false)
  })
})
