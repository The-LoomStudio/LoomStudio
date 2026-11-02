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
