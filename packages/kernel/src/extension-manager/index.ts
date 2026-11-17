export {
  acquireExtension,
  checkGitUpdate,
  createDownloadWorkspace,
  downloadExtensionZip,
  extensionGit,
  isPublicAddress,
  parseDownloadSource,
  readDownloadMetadata,
  satisfiesExtensionVersion,
  type DownloadOptions,
  type ExtensionCandidate,
} from './extension-download.js'
export { createExtensionFileData } from './extension-file-data.js'
export {
  exportExtensionPackageZip,
  installExtensionPackageFromDirectory,
  installExtensionPackageFromZip,
  maxPackageBytes,
  readExtensionPackageZip,
  resolvePromptResourceFiles,
  uninstallExtensionPackageDirectory,
  type InstalledExtensionPackage,
  type PromptResourceFileLoader,
} from './extension-package-installer.js'
export { listExtensionRecoveryRecords } from './extension-recovery.js'
export {
  discoverExtensionSources,
  removeExtensionDevLink,
  type DiscoveredExtensionSource,
  type ExtensionSource,
  type ExtensionSourceFailure,
} from './extension-sources.js'
export {
  createExtensionStateStore,
  initializeExtensionStateSchema,
  readExtensionDevLinksFile,
  type ExtensionDevLinkRecord,
  type ExtensionModuleDesiredState,
  type ExtensionStateStore,
  type OfficialExtensionSetupState,
} from './extension-state-store.js'
export {
  createServerExtensionManager,
  type ExtensionInstallationSource,
  type ExtensionInstallationSummary,
  type ExtensionPackageResourceImportInput,
  type ExtensionPackageResourceImportOutput,
  type ExtensionPackageResourcePreviewInput,
  type ListExtensionInstallationsResult,
  type ServerExtensionManager,
  type ServerExtensionManagerOptions,
} from './extension-manager.js'
