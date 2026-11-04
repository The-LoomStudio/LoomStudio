import type { AssetStore } from '@loom-studio/asset-store'
import type { ExtensionAssetCapability } from '@loom-studio/extension-sdk'
import type { DocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes, extensionInstallationId, resolvePackageDependency, type ExtensionInstallationContent, type ExtensionInstallationTarget } from '@loom-studio/application-runtime'

export async function canAccessExtensionAsset(
  documents: DocumentStore,
  asset: { ownerPackageId?: string; ownerInstallationId?: string },
  target: ExtensionInstallationTarget,
): Promise<boolean> {
  if (target.kind === 'global' || !asset.ownerInstallationId) return true
  const installation = await documents.get(asset.ownerInstallationId)
  if (!installation || installation.type !== applicationDocumentTypes.extensionInstallation) return false
  const content = installation.content as ExtensionInstallationContent
  return content.packageId === asset.ownerPackageId
    && (content.target.kind === 'global' || content.target.cardId === target.cardId)
}

/** Extension code consumes owned assets through declared, installed package dependencies.
 * The user-facing HTTP access check above deliberately has no manifest requirement.
 */
export async function canExtensionConsumeAsset(
  documents: DocumentStore,
  asset: { ownerPackageId?: string; ownerInstallationId?: string },
  target: ExtensionInstallationTarget,
  consumer: { packageId: string; dependencies?: import('@loom-studio/extension-sdk').ExtensionManifest['dependencies'] },
): Promise<boolean> {
  if (!asset.ownerPackageId) return canAccessExtensionAsset(documents, asset, target)
  let ownerTarget: ExtensionInstallationTarget = { kind: 'global' }
  if (asset.ownerInstallationId) {
    const owner = await documents.get(asset.ownerInstallationId)
    if (!owner || owner.meta.tombstone || owner.type !== applicationDocumentTypes.extensionInstallation) return false
    const content = owner.content as ExtensionInstallationContent
    if (content.packageId !== asset.ownerPackageId || extensionInstallationId(content.packageId, content.target) !== asset.ownerInstallationId) return false
    ownerTarget = content.target
  }
  await resolvePackageDependency({
    packageId: asset.ownerPackageId, target: ownerTarget,
    consumerPackageId: consumer.packageId, consumerTarget: target, dependencies: consumer.dependencies, documents,
  })
  return true
}

/** User-facing Card asset access; keep separate from extension dependency consumption. */
export async function canReadCardExtensionAsset(
  dependencies: {
    documents: DocumentStore
    assets?: Pick<AssetStore, 'getMediaAsset'>
    getGrantedAssetCapabilities(packageId: string, moduleId: string, target: ExtensionInstallationTarget): readonly ExtensionAssetCapability[]
  },
  input: { packageId: string; moduleId: string; cardId: string; assetId: string },
): Promise<boolean> {
  const { documents, assets } = dependencies
  const target = { kind: 'card' as const, cardId: input.cardId }
  const installationId = extensionInstallationId(input.packageId, target)
  const [installation, asset, card] = await Promise.all([
    documents.get(installationId), assets?.getMediaAsset(input.assetId), documents.get(input.cardId),
  ])
  if (!asset || !installation || installation.type !== applicationDocumentTypes.extensionInstallation
    || !card || card.type !== applicationDocumentTypes.cardSource) return false
  const content = installation.content as ExtensionInstallationContent
  if (content.packageId !== input.packageId || content.target.kind !== 'card' || content.target.cardId !== input.cardId) return false
  if (asset.ownerPackageId === input.packageId && asset.ownerInstallationId === installationId) return true
  return dependencies.getGrantedAssetCapabilities(input.packageId, input.moduleId, target).includes('assets.read')
    && await canAccessExtensionAsset(documents, asset, target)
}
