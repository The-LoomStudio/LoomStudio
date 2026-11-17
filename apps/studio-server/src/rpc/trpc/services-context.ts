import type { AiGatewayCapabilityRegistry, ProfiledAiGateway } from '@loom-studio/ai-gateway'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { LogHistoryReader, LogReader } from '@loom-studio/logging'
import type { JsonValue } from '@loom-studio/shared'
import type { PromptResourceConverter } from '../../extensions/import-conversion.js'
import type { NetworkSettingsStore } from '@loom-studio/kernel/platform'

type RpcCallContext = {
  clientId: string
  correlationId: string
  callId: string
  parentCallId?: string
  signal?: AbortSignal
}

type KernelRpcCaller = Pick<import('@loom-studio/kernel').Kernel, 'callRpc'>

export type StudioRpcServices = {
  resourceDownloads?: import('../../resource-downloads/service.js').ResourceDownloadService
  resourceDownloadUse?: ReturnType<typeof import('../../resource-adoption/download-use.js').createResourceDownloadUse>

  dashboard?: {
    statistics: import('@loom-studio/application-runtime/data').StatisticsStore
    storage: ReturnType<typeof import('../../statistics/storage-snapshot.js').createStorageSnapshot>
    database: () => ReturnType<typeof import('@loom-studio/kernel/data-engine').readSqliteSpaceUsage>
    createBackup?: () => Promise<{ filename: string; path: string; sizeBytes: number }>
  }
  scripts?: ReturnType<typeof import('../../scripts/script-service.js').createScriptService>
  batchImporter?: ReturnType<typeof import('../../extensions/import-batch.js').createExtensionBatchImporter>
  applicationRuntime: ApplicationRuntime
  convertPromptResource?: PromptResourceConverter
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  kernel: KernelRpcCaller
  extensionManager?: import('@loom-studio/kernel').ExtensionManagementService
  extensionHost?: import('@loom-studio/kernel/extension-host').ExtensionHost
  diagnostics?: import('@loom-studio/kernel/diagnostics').DiagnosticsRegistry
  characterCatalog?: import('@loom-studio/kernel').ExtensionCharacterCatalogService
  logs?: LogReader
  logHistory?: LogHistoryReader
  networkSettings?: NetworkSettingsStore
  officialContent?: ReturnType<typeof import('../../official/official-content.js').createOfficialContentService>
  directoryCatalog?: ReturnType<typeof import('../../resource-directories/card-directory-catalog.js').createCardDirectoryCatalog>
  directoryResources?: ReturnType<typeof import('../../resource-directories/card-directory.js').createCardDirectoryService>
  directoryImporter?: ReturnType<typeof import('../../resource-directories/card-directory-import.js').createCardDirectoryImporter>
  startupDirectoryScan?: Promise<unknown>
  emitEvent?: (name: string, payload: JsonValue, context: RpcCallContext) => void
}
