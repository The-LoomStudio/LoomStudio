import type { StudioApi } from '../../../shared/api/studio-api.js'
import { encodeBase64 } from '../../../shared/browser/download.js'

type UseExtensionResourceCommandsInput = {
  api: StudioApi
  refreshCards(): Promise<unknown>
  refreshCardTimelines(cardId: string): Promise<unknown>
  refreshDependentData(): Promise<void>
  selectedCardId?: string
}

export function useExtensionResourceCommands(input: UseExtensionResourceCommandsInput) {
  async function installCardPackage(installation: Parameters<StudioApi['extensions']['installCard']>[0]) {
    const result = await input.api.extensions.installCard(installation)
    await input.refreshDependentData()
    return result
  }

  async function updateCardPackage(update: Parameters<StudioApi['extensions']['updateCard']>[0]) {
    const result = await input.api.extensions.updateCard(update)
    await input.refreshDependentData()
    return result
  }

  async function uninstallCardPackage(removal: Parameters<StudioApi['extensions']['uninstallCard']>[0]) {
    const result = await input.api.extensions.uninstallCard(removal)
    await input.refreshDependentData()
    return result
  }

  async function importExtensionPackageResources(packageId: string) {
    const result = await input.api.extensions.importResources(packageId)
    await input.refreshDependentData()
    return result
  }

  async function removeCardPackageResources(removal: Parameters<StudioApi['extensions']['removeCardResources']>[0]) {
    const result = await input.api.extensions.removeCardResources(removal)
    await input.refreshDependentData()
    return result
  }

  async function updateExtensionPackageResources(update: Parameters<StudioApi['extensions']['updateResources']>[0]) {
    const result = await input.api.extensions.updateResources(update)
    await input.refreshDependentData()
    return result
  }

  async function removeExtensionPackageResources(packageId: string) {
    const result = await input.api.extensions.removeResources(packageId)
    await Promise.all([
      input.refreshDependentData(),
      input.refreshCards(),
      input.selectedCardId ? input.refreshCardTimelines(input.selectedCardId) : Promise.resolve(),
    ])
    return result
  }

  async function installExtensionPackageZip(file: File) {
    return await input.api.extensions.installZip(encodeBase64(new Uint8Array(await file.arrayBuffer())))
  }

  return {
    installCardPackage,
    updateCardPackage,
    uninstallCardPackage,
    importExtensionPackageResources,
    removeCardPackageResources,
    updateExtensionPackageResources,
    removeExtensionPackageResources,
    installExtensionPackageZip,
  }
}
