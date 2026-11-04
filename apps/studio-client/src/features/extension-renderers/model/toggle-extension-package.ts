import type { ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import type { ManagedExtensionModule } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

/** The server owns the accepted batch; a closing page cannot truncate it. */
export function toggleExtensionPackage(input: {
  packageId: string
  target: ExtensionInstallationTarget
  modules: readonly ManagedExtensionModule[]
  enabled: boolean
  start: StudioApi['extensions']['startModuleBatch']
}) {
  return input.start({ packageId: input.packageId, target: input.target, enabled: input.enabled,
    modules: input.modules.map(module => ({ moduleId: module.moduleId, grants: module.desired.grants })) })
}
