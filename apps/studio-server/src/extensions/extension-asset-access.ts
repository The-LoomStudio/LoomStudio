import type { DocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes, type ExtensionInstallationContent, type ExtensionInstallationTarget } from '@loom-studio/application-runtime'

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
