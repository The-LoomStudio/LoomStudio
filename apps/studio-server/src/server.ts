import { createExtensionCharacterCatalog } from './extensions/extension-character-catalog.js'
import { createStorageSnapshot } from './statistics/storage-snapshot.js'
import { readSqliteSpaceUsage } from '@loom-studio/data-engine'
import { createStatisticsStore } from '@loom-studio/application-data'
import { createExtensionAgentTasks } from './extensions/extension-agent-tasks.js'
import { createExtensionApplicationAdapter } from './extensions/extension-application-adapter.js'
import { createCardTransferService } from './codecs/card-transfer-service.js'
import {
  createApplicationRuntime,
  createObservationStore,
  createObservedAiGateway,
  createDocumentBackedAiGateway,
  createDocumentBackedProfiledAiGateway,
  createOfficialAgentToolRegistry,
  createMacroProviderRegistry,
  createPromptProcessorRegistry,
  createStateContentRegistry,
  createNarrativeContextRegistry,
  createStateContributionRegistry,
} from '@loom-studio/application-runtime'
import { canReadCardExtensionAsset, canExtensionConsumeAsset } from './extensions/extension-asset-access.js'
import { createExtensionFileData } from './extensions/extension-file-data.js'
import {
  createAiGatewayCapabilityRegistry,
  createOfficialProviderAdapterRegistry,
  registerOfficialFakeAiProvider,
} from '@loom-studio/ai-gateway'
import { createAgentStore } from '@loom-studio/application-data'
import { createAssetStore, type AssetStore } from '@loom-studio/asset-store'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine, type SqliteDataEngine } from '@loom-studio/data-engine'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createSqliteDocumentStore, type DocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createExtensionScriptArchiveExporter } from './extensions/extension-script-export.js'
import { createScriptService } from './scripts/script-service.js'
import { createKernel } from '@loom-studio/kernel'
import { queryExtensionLogs, readLogFailure, type Logger, type LogReader, type LogHistoryReader } from '@loom-studio/logging'
import { createNarrativeStore } from '@loom-studio/application-data'
import { createPromptResourceStore, type PromptResourceStore } from '@loom-studio/application-data'
import { createKeyringSecretBackend, createSecretStore, type SecretBackend } from '@loom-studio/secret-store'
import { createId, nowIso } from '@loom-studio/shared'
import { createStateStore } from '@loom-studio/application-data'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withAiGatewayLogging } from './logging/ai-gateway-logging.js'
import { createNetworkSettingsStore } from './platform/network-settings.js'
import { resolveSystemProxyUrl } from './platform/system-proxy.js'
import { createApplicationSessionAuth } from './http/application-session-auth.js'
import { withDocumentStoreLogging } from './logging/document-store-logging.js'
import { createStudioHttpServer } from './http/http-server.js'
import type { StudioRpcServices } from './rpc/trpc/services-context.js'
import { createServerExtensionManager } from './extensions/extension-manager.js'
import { createExtensionStateStore } from './extensions/extension-state-store.js'
import { createExtensionBatchImporter } from './extensions/import-batch.js'
import { createExtensionImportConversions } from './extensions/import-conversion.js'
import { createOfficialContentService } from './official/official-content.js'
import { createCardDirectoryService } from './resource-directories/card-directory.js'
import { createCardDirectoryCatalog } from './resource-directories/card-directory-catalog.js'
import { createCardDirectoryImporter } from './resource-directories/card-directory-import.js'
import { createCardDirectoryMedia } from './resource-directories/card-directory-media.js'
import { resolveLoomStudioLocalPaths, type LoomStudioLocalPaths } from './platform/local-paths.js'

const defaultPort = 18010
const defaultClientOrigin = process.env.STUDIO_CLIENT_URL ?? 'http://127.0.0.1:18011'
const installationRoot = fileURLToPath(new URL('../../../', import.meta.url))

export type StudioServer = {
  listen(port?: number): Promise<{ port: number }>
  close(): Promise<void>
}

export type CreateStudioServerOptions = {
  localPaths?: LoomStudioLocalPaths
  documents?: DocumentStore
  sqlitePath?: string
  logger?: Logger
  logs?: LogReader
  logHistory?: LogHistoryReader
  rpcLogger?: Logger
  documentLogger?: Logger
  promptBuildLogger?: Logger
  runtimeLogger?: Logger
  providerLogger?: Logger
  extensionLogger?: Logger
  extensionRootDirectory?: string
  extensionInstalledDirectory?: string
  extensionStateDirectory?: string
  officialContentDirectory?: string
  secretBackend?: SecretBackend
  applicationSessionOrigins?: string[]
  runtimeMode?: 'development' | 'production'
  clientDirectory?: string
}

export function createStudioServer(options: CreateStudioServerOptions = {}): StudioServer {
  const officialContentDirectory = options.officialContentDirectory
  const localPaths = options.localPaths ?? resolveLoomStudioLocalPaths({ home: '.loomstudio-dev' })
  const logger = options.logger
  const diagnostics = createInMemoryDiagnosticsRegistry()
  let dataEngine: SqliteDataEngine | undefined
  let rawDocuments: DocumentStore
  if (options.documents) {
    rawDocuments = options.documents
  } else {
    dataEngine = createSqliteDataEngine({ filename: options.sqlitePath ?? localPaths.databaseFile, createId, now: nowIso })
    try {
      rawDocuments = createSqliteDocumentStore({ engine: dataEngine })
    } catch (error) {
      void dataEngine.close()
      throw error
    }
  }
  const documents = options.documentLogger ? withDocumentStoreLogging(rawDocuments, options.documentLogger) : rawDocuments
  const networkSettings = createNetworkSettingsStore({
    filename: join(localPaths.configRoot, 'network.json'),
    resolveSystemProxyUrl,
  })
  const secrets = dataEngine ? createSecretStore({
    engine: dataEngine,
    backend: options.secretBackend ?? createKeyringSecretBackend(),
    createId,
    now: nowIso,
    authorizeUse: (_metadata, context) => context.caller === 'application.ai-gateway',
    onCleanupFailure: () => {
      diagnostics.add({
        severity: 'warning',
        source: 'secret-store',
        code: 'secret.cleanup_pending',
        message: 'Credential cleanup is incomplete; its durable record is retained for retry.',
      })
      logger?.warn('Credential cleanup is incomplete; queued for retry', {
        event: 'secret.cleanup_pending',
      })
    },
  }) : undefined
  const aiCapabilities = createAiGatewayCapabilityRegistry()
  const macroProviders = createMacroProviderRegistry()
  const promptProcessors = createPromptProcessorRegistry()
  const stateContent = createStateContentRegistry()
  const narrativeContext = createNarrativeContextRegistry()
  const stateContributions = createStateContributionRegistry()
  registerOfficialFakeAiProvider(aiCapabilities)
  const providerAdapters = createOfficialProviderAdapterRegistry({ aiCapabilities })
  const statistics = dataEngine ? createStatisticsStore(dataEngine, nowIso, () => { diagnostics.add({ severity: 'warning', source: 'statistics', code: 'statistics.capture_failed', message: 'Usage recording failed; statistics may be incomplete.' }) }) : undefined
  const observations = createObservationStore({ persistencePath: join(localPaths.configRoot, 'observations') })
  const profiledAiGateway = createDocumentBackedProfiledAiGateway({
    statistics,
    observations,
    documents,
    registry: aiCapabilities,
    secrets,
  })
  const baseGateway = createDocumentBackedAiGateway({
    mediaAssets: { get: async id => assets?.getMediaAsset(id), read: async (id, options) => {
      if (!assets) throw new Error('Asset storage is unavailable')
      return assets.readMediaAsset(id, options)
    } },
    statistics,
    observations,
    documents,
    secrets,
    resolveProxyUrl: networkSettings.resolveProxyUrl,
    providerAdapters,
  })
  const gateway = createObservedAiGateway(options.providerLogger ? withAiGatewayLogging(baseGateway, options.providerLogger) : baseGateway, observations)
  let agents
  let narratives
  let states
  let blobs: ReturnType<typeof createBlobStore> | undefined
  let assets: AssetStore | undefined
  let promptResources: PromptResourceStore | undefined
  try {
    promptResources = dataEngine ? createPromptResourceStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    agents = dataEngine ? createAgentStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    narratives = dataEngine ? createNarrativeStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    states = dataEngine ? createStateStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    if (dataEngine) {
      blobs = createBlobStore({
        engine: dataEngine,
        rootDirectory: localPaths.blobRoot,
        createId,
        now: nowIso,
      })
      assets = createAssetStore({ engine: dataEngine, blobs, createId, now: nowIso })
    }
  } catch (error) {
    void dataEngine?.close()
    throw error
  }
  if (!dataEngine || !promptResources) {
    throw new Error('Studio Server requires a shared SQLite Data Engine and Prompt Resource Store')
  }
  const agentTools = createOfficialAgentToolRegistry()
  const exportExtensionArchive = blobs ? createExtensionScriptArchiveExporter({ documents, blobs }) : undefined
  const applicationRuntime = createApplicationRuntime({
    observations,
    exportExtensionArchive,
    validatePackageAsset: input => extensionManager.validatePackageAsset(input),
    onStateChanged: event => kernel.getEventBus().emit('state.changed', event, { publisher: { kind: 'kernel' }, source: 'application-state' }),
    withCardDeletion: (id, commit) => {
      if (!resourceDirectories) throw new Error('Card directory service is unavailable')
      return extensionManager.withCardDeletions([id], () => resourceDirectories!.deleteCard(id, commit))
    },
    withCardDeletions: (ids, commit) => {
      if (!resourceDirectories) throw new Error('Card directory service is unavailable')
      return extensionManager.withCardDeletions(ids, () => resourceDirectories!.deleteCards(ids, commit))
    },
    agents,
    agentTools,
    dataEngine,
    documents,
    blobs,
    narratives,
    promptResources,
    states,
    sourceArtifacts: assets
      ? {
        preserve: async input => {
          const result = await assets.preserveSourceArtifact(input)
          const blob = await assets.blobs.get(result.artifact.blobId)
          if (!blob) throw new Error(`Preserved source Blob not found: ${result.artifact.blobId}`)
          return {
            sourceArtifactId: result.artifact.id,
            blobId: blob.id,
            sha256: blob.sha256,
            sizeBytes: blob.sizeBytes,
            originalFileName: result.artifact.originalFileName,
            mediaType: result.artifact.mediaType,
          }
        },
      }
      : undefined,
    mediaAssets: assets ? { get: assetId => assets.getMediaAsset(assetId), read: (id, options) => assets.readMediaAsset(id, options) } : undefined,
    secrets,
    providerAdapters,
    aiCapabilities,
    macroProviders,
    promptProcessors,
    stateContent,
    narrativeContext,
    stateContributions,
    gateway,
    logger: options.promptBuildLogger,
    runtimeLogger: options.runtimeLogger,
  })
  const extensionAgentTasks = createExtensionAgentTasks({ runtime: applicationRuntime, documents })
  const extensionFileData = createExtensionFileData(localPaths.dataRoot, documents)
  const extensionHost = createExtensionHost({
    resolveFileDataDirectory: extensionFileData.directory,
    serverModuleSnapshotRoot: join(options.extensionInstalledDirectory ?? join(installationRoot, 'extensions'), '.runtime'),
    documents,
    diagnostics,
    logger: options.extensionLogger,
    queryLogs: (packageId, input, installationId) => queryExtensionLogs({ current: options.logs, history: options.logHistory }, packageId, input, 'server', installationId),
    mode: options.runtimeMode ?? 'development',
    grantEventCapabilities: (manifest, moduleManifest, target) => extensionManager.getGrantedEventCapabilities(manifest.id, moduleManifest.id, target),
    grantAssetCapabilities: (manifest, moduleManifest, target) => extensionManager.getGrantedAssetCapabilities(manifest.id, moduleManifest.id, target),
    assetScratchRoot: localPaths.extensionCacheRoot,
    canAccessAsset: (asset, target, consumer) => canExtensionConsumeAsset(documents, asset, target, consumer),
    ...createExtensionApplicationAdapter({
      applicationRuntime, assets, documents, agents, narratives, states, promptResources, extensionAgentTasks,
      getKernel: () => kernel,
      aiCapabilities, profiledAiGateway, gateway, agentTools, macroProviders, promptProcessors,
      stateContent, narrativeContext, stateContributions,
    }),
  })
  const useOfficialExtensions = (options.runtimeMode === 'production' || options.runtimeMode === 'development')
    && !options.extensionInstalledDirectory && !options.extensionRootDirectory
  const extensionRootDirectory = options.extensionRootDirectory
    ?? (useOfficialExtensions ? join(installationRoot, 'official/extensions') : undefined)
  const extensionStateDirectory = resolve(options.extensionStateDirectory ?? localPaths.extensionRoot)
  const extensionManager = createServerExtensionManager({
    exportExtensionArchive,
    host: extensionHost,
    diagnostics,
    stateStore: createExtensionStateStore({
      filename: options.extensionStateDirectory ? join(extensionStateDirectory, 'state.json') : localPaths.extensionStateFile,
      now: nowIso,
    }),
    repositoryDirectory: extensionRootDirectory,
    installedDirectory: options.extensionInstalledDirectory ?? join(installationRoot, 'extensions'),
    devLinksFile: options.extensionStateDirectory ? join(extensionStateDirectory, 'dev-links.json') : localPaths.extensionDevLinksFile,
    deleteData: extensionFileData.removeGlobal,
    officialSetupFile: join(localPaths.configRoot, 'official-extension-setup.json'),
    bundledDirectories: useOfficialExtensions
      ? [
        join(installationRoot, 'official/extensions/loom-assistant'),
        join(installationRoot, 'official/extensions/story-memory'),
      ] : [],
    bundledEnabledModules: { 'official.story-memory': ['server', 'client'] },
    readCardPackage: input => applicationRuntime.getCardExtensionPackage(input),
    listInstallations: () => applicationRuntime.listExtensionInstallations(),
    assertDependencyConsumers: (packageId, target, nextVersion) => applicationRuntime.checkExtensionDependencyConsumers({ packageId, target, nextVersion }),
    onModuleBatchCompleted: result => { kernel.getEventBus().emit('extensions.changed', {
      packageId: result.packageId, target: result.target, action: 'batch-completed', batchId: result.batchId,
    }, { publisher: { kind: 'kernel' } }) },
    previewPackageResources: input => applicationRuntime.previewExtensionPackageResources(input),
    uninstallInstallation: input => applicationRuntime.uninstallExtensionInstallation(input, {
      actor: { kind: 'extension', id: input.packageId },
    }),
    importPackageResources: input => applicationRuntime.importExtensionPackageResources(input, {
      actor: { kind: 'extension', id: input.packageId },
    }),
    removePackageResources: input => applicationRuntime.removeExtensionPackageResources(input, {
      actor: { kind: 'extension', id: input.packageId },
    }),
  })
  const kernel = createKernel({
    documents,
    dataCommits: dataEngine ?? documents,
    diagnostics,
    extensionHost,
    extensionManager,
    characterCatalog: {
      list: packageId => characterCatalog.list(packageId),
      preview: (packageId, characterId) => characterCatalog.preview(packageId, characterId),
      import: (input, clientId) => characterCatalog.import(input, clientId),
    },
  })
  const importConversions = createExtensionImportConversions(kernel)
  const scripts = createScriptService({
    runtime: applicationRuntime,
    hostOptions: {
      documents, diagnostics, logger: options.extensionLogger,
      mode: options.runtimeMode ?? 'development',
      assetScratchRoot: localPaths.extensionCacheRoot,
      canAccessAsset: (asset, target, consumer) => canExtensionConsumeAsset(documents, asset, target, consumer),
      ...createExtensionApplicationAdapter({
        applicationRuntime, assets, documents, agents, narratives, states, promptResources, extensionAgentTasks,
        getKernel: () => kernel,
        aiCapabilities, profiledAiGateway, gateway, agentTools, macroProviders, promptProcessors,
        stateContent, narrativeContext, stateContributions,
      }),
    },
  })
  kernel.getEventBus().registerDefinition({
    name: 'directories.media.changed', owner: { kind: 'kernel' }, version: 1,
    visibility: 'public', stability: 'experimental', summary: 'Card directory media changed',
  })
  const directoryCatalog = createCardDirectoryCatalog({
    dataRoot: localPaths.dataRoot,
    listCardIds: async () => {
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = await applicationRuntime.listCards({ cursor, limit: 100 })
        ids.push(...page.cards.map(card => card.id))
        cursor = page.nextCursor
      } while (cursor)
      return ids
    },
  })
  const startupDirectoryScan = directoryCatalog.scan()
  const directoryMedia = createCardDirectoryMedia({ dataRoot: localPaths.dataRoot, logger: options.logger?.child('card.directory.media') })
  let commitPublisher: { dispose(): void } | undefined
  let mediaWatcher: { dispose(): void } | undefined
  const resourceDirectories = assets ? createCardDirectoryService({
    dataRoot: localPaths.dataRoot,
    logger: options.logger?.child('card.directory'),
    readCard: cardId => cardTransfer.readCardExport(cardId),
    applyCard: async (cardId, artifact, snapshot, context) => { await applicationRuntime.applyCardDirectoryState({ cardId, artifact, snapshot }, context) },
  }) : undefined
  const cardExists = async (id: string) => {
    const document = await documents.get(id)
    return Boolean(document && !document.meta.tombstone)
  }
  const saveImportedCard = async (id: string) => {
    if (!resourceDirectories) throw new Error('Card directory service unavailable')
    await resourceDirectories.saveImportedCard(id)
  }
  const directoryImporter = createCardDirectoryImporter({
    dataRoot: localPaths.dataRoot,
    cardExists,
    isRegistered: async directory => {
      const catalog = await directoryCatalog.scan()
      if (catalog.error) throw new Error(catalog.error)
      const entry = catalog.entries.find(entry => entry.directory === directory)
      if (entry?.error) throw new Error(entry.error)
      return Boolean(entry?.registeredCardId)
    },
    importCard: async (bundle, id, clientId) => { await cardTransfer.importCardArchive(bundle, clientId, id) },
    saveImportedCard,
  })
  const rpcServices: StudioRpcServices = {
    dashboard: statistics ? { statistics, storage: createStorageSnapshot(localPaths, options.sqlitePath ?? localPaths.databaseFile), database: () => readSqliteSpaceUsage(dataEngine!) } : undefined,
    scripts,
    directoryCatalog, directoryResources: resourceDirectories, directoryImporter, startupDirectoryScan,
    batchImporter: createExtensionBatchImporter({ kernel, runtime: applicationRuntime, assets, saveImportedCard }),
    convertPromptResource: importConversions.promptResource,
    applicationRuntime,
    officialContent: createOfficialContentService(applicationRuntime, officialContentDirectory ? resolve(officialContentDirectory) : undefined),
    aiCapabilities,
    aiGateway: profiledAiGateway,
    kernel,
    logs: options.logs,
    logHistory: options.logHistory,
    networkSettings,
    emitEvent: (name, payload, context) => {
      kernel.getEventBus().emit(name, payload, {
        publisher: { kind: 'kernel' },
        source: 'studio-server',
        ...context,
      })
    },
  }
  const cardTransfer = createCardTransferService({ applicationRuntime, assets, directoryMedia, importConversions, saveImportedCard })
  const characterCatalog = createExtensionCharacterCatalog({ runtime: applicationRuntime, readPackage: packageId => extensionManager.readCharacterPackage(packageId), importArchive: cardTransfer.importArchiveAndSave })
  const server = createStudioHttpServer({
    trpcServices: rpcServices,
    applicationRuntime,
    auth: createApplicationSessionAuth({
      allowedOrigins: options.applicationSessionOrigins ?? (options.runtimeMode === 'production' ? [] : [defaultClientOrigin]),
    }),
    clientDirectory: options.clientDirectory,
    assets,
    canReadCardExtensionAsset: input => canReadCardExtensionAsset({
      documents, assets,
      getGrantedAssetCapabilities: (packageId, moduleId, target) => extensionManager.getGrantedAssetCapabilities(packageId, moduleId, target),
    }, input),
    cardMedia: cardTransfer.cardMedia,
    cardPng: cardTransfer.cardPng,
    extensionIcons: {
      read: (packageId, version) => extensionManager.readPackageIcon(packageId, version),
    },
    extensionFiles: {
      read: (packageId, version, path, installation) => installation
        ? extensionManager.readCardPackageFile(installation.cardId, packageId, version, installation.archiveDigest, path)
        : extensionManager.readPackageFile(packageId, version, path),
    },
    extensionEvents: {
      subscribe: handler => {
        const eventBus = kernel.getEventBus()
        return eventBus.subscribe(['extensions.changed', 'extensions.data.changed', 'entity.lifecycle.changed', 'directories.media.changed', 'data.changed'], handler)
      },
    },
    logger: options.rpcLogger,
  })

  return {
    listen: async (port = defaultPort) => {
      logger?.info('Studio server starting', {
        event: 'server.starting',
        data: { requestedPort: port },
      })
      try {
        await secrets?.retryPendingCleanup({ actor: { kind: 'system', id: 'studio-server' }, reason: 'server.start.secret-cleanup' })
        await startupDirectoryScan
        const deletionRecoveryErrors = await resourceDirectories!.recoverDeletions(async id => {
          const document = await documents.get(id)
          return Boolean(document && !document.meta.tombstone)
        })
        const recoveryErrors = [
          ...deletionRecoveryErrors,
          ...await directoryImporter.recoverImports(),
          ...await resourceDirectories!.recoverApplies(),
        ]
        for (const failure of recoveryErrors) {
          logger?.error(`Card ${failure.cardId} directory recovery requires attention: ${failure.error}`, {
            event: 'card.directory.recovery_failed',
            data: { cardId: failure.cardId, error: String(failure.error) },
          })
        }
        await observations.ready()
        await directoryCatalog.scan()
        await applicationRuntime.initialize()
        await extensionAgentTasks.recover()
        await kernel.start()
        commitPublisher ??= (dataEngine ?? documents).subscribeCommits(commit => {
          kernel.getEventBus().emit('extensions.data.changed', { changesetId: commit.changesetId }, { publisher: { kind: 'kernel' } })
        })
        await extensionManager.initialize()
        await scripts.resolve({ workspaceId: 'workspace' })
        mediaWatcher = await directoryMedia.watch(() => {
          kernel.getEventBus().emit('directories.media.changed', {}, { publisher: { kind: 'kernel' }, source: 'studio-server' })
        })
        await new Promise<void>((resolve, reject) => {
          const handleError = (error: Error) => reject(error)
          server.once('error', handleError)
          server.listen(port, '127.0.0.1', () => {
            server.off('error', handleError)
            resolve()
          })
        })
        const address = server.address()
        const actualPort = typeof address === 'object' && address ? address.port : port
        logger?.info('Studio server started', {
          event: 'server.started',
          data: { host: '127.0.0.1', port: actualPort, detail: `http://127.0.0.1:${actualPort}` },
        })
        return { port: actualPort }
      } catch (error) {
        commitPublisher?.dispose()
        commitPublisher = undefined
        mediaWatcher?.dispose()
        mediaWatcher = undefined
        logger?.error('Studio server failed to start', {
          event: 'server.start.failed',
          data: { requestedPort: port, ...readLogFailure(error), detail: readLogFailure(error).failureReason },
        })
        throw error
      }
    },
    close: async () => {
      logger?.info('Studio server stopping', { event: 'server.stopping' })
      commitPublisher?.dispose()
      commitPublisher = undefined
      mediaWatcher?.dispose()
      mediaWatcher = undefined
      try {
        await server.shutdown()
        try { await scripts.dispose() } finally { await kernel.stop() }
      } finally {
        try {
          await secrets?.retryPendingCleanup({ actor: { kind: 'system', id: 'studio-server' }, reason: 'server.stop.secret-cleanup' })
        } finally {
          try { await applicationRuntime.disposeObservations() } finally { await dataEngine?.close() }
        }
      }
      logger?.info('Studio server stopped', { event: 'server.stopped' })
    },
  }
}
