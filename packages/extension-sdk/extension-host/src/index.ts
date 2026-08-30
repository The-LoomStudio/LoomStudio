export type { ExtensionRpcHandler } from '@loom-studio/extension-sdk'
export type {
  EventCapabilityCategory,
  ExtensionAgentToolContribution,
  ExtensionAssetCapability,
  ExtensionEntityRef,
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionPromptResourceContribution,
  ExtensionStorageScope,
} from '@loom-studio/extension-sdk'

export type {
  ExtensionEventRegistration,
  ExtensionHost,
  ExtensionHostLogger,
  ExtensionHostOptions,
  ExtensionInstanceState,
  ExtensionModuleSummary,
  ExtensionRpcContext,
  ExtensionRpcRegistration,
  ExtensionState,
} from './types.js'

export { parseExtensionManifest } from './manifest.js'
export { createExtensionHost } from './host.js'
