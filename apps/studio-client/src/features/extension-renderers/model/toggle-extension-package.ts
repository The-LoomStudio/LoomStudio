import type { ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import type { ManagedExtensionModule } from '../../../entities/index.js'

export async function toggleExtensionPackage(input: {
  packageId: string
  target: ExtensionInstallationTarget
  modules: readonly ManagedExtensionModule[]
  enabled: boolean
  enable(packageId: string, moduleId: string, grants: ManagedExtensionModule['desired']['grants'] | undefined, target: ExtensionInstallationTarget): Promise<unknown>
  disable(packageId: string, moduleId: string, target: ExtensionInstallationTarget): Promise<unknown>
}) {
  const completed: string[] = []
  const failed: Array<{ moduleId: string; message: string }> = []
  const pending = input.modules.filter(module => module.desired.enabled !== input.enabled)
  for (const module of pending) {
    try {
      if (input.enabled) await input.enable(input.packageId, module.moduleId, module.desired.grants, input.target)
      else await input.disable(input.packageId, module.moduleId, input.target)
      completed.push(module.moduleId)
    } catch (error) {
      failed.push({ moduleId: module.moduleId, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { completed, failed, untouched: input.modules.filter(module => module.desired.enabled === input.enabled).map(module => module.moduleId) }
}
