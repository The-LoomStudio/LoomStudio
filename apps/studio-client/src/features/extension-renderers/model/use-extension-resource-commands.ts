import { useMemo } from 'react'
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
  const officialContentApi = useMemo(() => ({
    list: input.api.officialContent.list,
    export: input.api.officialContent.export,
    install: async (installInput: { packageId: string; digest: string }) => {
      const result = await input.api.officialContent.install(installInput)
      await input.refreshDependentData()
      return result
    },
  }), [input.api, input.refreshDependentData])

  async function importExtensionPackageResources(packageId: string) {
    const result = await input.api.extensions.importResources(packageId)
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
    officialContentApi,
    importExtensionPackageResources,
    removeExtensionPackageResources,
    installExtensionPackageZip,
  }
}
