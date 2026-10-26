import type { AiGatewayCapabilityRegistry, ProfiledAiGateway } from '@loom-studio/ai-gateway'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { LogHistoryReader, LogReader } from '@loom-studio/logging'
import type { JsonValue } from '@loom-studio/shared'
import type { PromptResourceConverter } from '../../extensions/import-conversion.js'
import type { NetworkSettingsStore } from '../../platform/network-settings.js'

type RpcCallContext = {
  clientId: string
  correlationId: string
  callId: string
  parentCallId?: string
  signal?: AbortSignal
}

type KernelRpcCaller = Pick<import('@loom-studio/kernel').Kernel, 'callRpc'>

export type StudioRpcServices = {
  dashboard?: {
    statistics: import('@loom-studio/application-data').StatisticsStore
    storage: ReturnType<typeof import('../../statistics/storage-snapshot.js').createStorageSnapshot>
    database: () => ReturnType<typeof import('@loom-studio/data-engine').readSqliteSpaceUsage>
  }
  scripts?: ReturnType<typeof import('../../scripts/script-service.js').createScriptService>
  batchImporter?: ReturnType<typeof import('../../extensions/import-batch.js').createExtensionBatchImporter>
  applicationRuntime: ApplicationRuntime
  convertPromptResource?: PromptResourceConverter
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  kernel: KernelRpcCaller
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
