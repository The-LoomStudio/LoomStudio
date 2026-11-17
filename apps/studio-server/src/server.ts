import { createSourceCredentialStore } from './resource-adoption/source-credentials.js'
import { createResourceDownloadService } from './resource-downloads/service.js'
import { createResourceDownloadUse } from './resource-adoption/download-use.js'
import { createExtensionCharacterCatalog } from './extensions/extension-character-catalog.js'
import { createStorageSnapshot } from './statistics/storage-snapshot.js'
import { createSqliteDataEngine, readSqliteSpaceUsage, type SqliteDataEngine } from '@loom-studio/kernel/data-engine'
import {
  createAgentStore,
  createNarrativeStore,
  createPromptResourceStore,
  createStateStore,
  createStatisticsStore,
} from '@loom-studio/application-runtime/data'
import { createExtensionAgentTasks } from './extensions/extension-agent-tasks.js'
import { createExtensionApplicationAdapter } from './extensions/extension-application-adapter.js'
import { createCardTransferService } from './codecs/card-transfer-service.js'
import { createApplicationRuntime, createObservationStore } from '@loom-studio/application-runtime'
import { canReadCardExtensionAsset, canExtensionConsumeAsset } from './extensions/extension-asset-access.js'
import { createAssetStore, createBlobStore } from '@loom-studio/kernel/asset-store'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/kernel/diagnostics'
import { createSqliteDocumentStore, type DocumentStore } from '@loom-studio/kernel/document-store'
import { createExtensionHost } from '@loom-studio/kernel/extension-host'
import {
  createExtensionFileData,
  createExtensionStateStore,
  createServerExtensionManager,
} from '@loom-studio/kernel/extension-manager'
import { createExtensionScriptArchiveExporter } from './extensions/extension-script-export.js'
import { loadPromptResourceFiles } from './codecs/prompt-resource-files.js'
import { createScriptService } from './scripts/script-service.js'
import { createKernel } from '@loom-studio/kernel'
import { queryExtensionLogs, readLogFailure, type Logger, type LogReader, type LogHistoryReader } from '@loom-studio/logging'
import { createKeyringSecretBackend, createSecretStore, type SecretBackend } from '@loom-studio/kernel/secret-store'
import { createId, nowIso } from '@loom-studio/shared'
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acquireProcessLock,
  createNetworkSettingsStore,
  resolveLoomStudioLocalPaths,
  resolveSystemProxyUrl,
  type LoomStudioLocalPaths,
} from '@loom-studio/kernel/platform'
import { createApplicationSessionAuth } from './http/application-session-auth.js'
import { withDocumentStoreLogging } from './logging/document-store-logging.js'
import { createStudioHttpServer } from './http/http-server.js'
import type { StudioRpcServices } from './rpc/trpc/services-context.js'
import { createExtensionBatchImporter } from './extensions/import-batch.js'
import { createExtensionImportConversions } from './extensions/import-conversion.js'
import { createOfficialContentService } from './official/official-content.js'
import { createCardDirectoryService } from './resource-directories/card-directory.js'
import { createCardDirectoryCatalog } from './resource-directories/card-directory-catalog.js'
import { createCardDirectoryImporter } from './resource-directories/card-directory-import.js'
import { createCardDirectoryMedia } from './resource-directories/card-directory-media.js'

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

type ActiveServerState = {
  processLock?: { release(): Promise<void> }
  dataEngine?: SqliteDataEngine
  secrets?: ReturnType<typeof createSecretStore>
  observations?: ReturnType<typeof createObservationStore>
  applicationRuntime?: ReturnType<typeof createApplicationRuntime>
  kernel?: ReturnType<typeof createKernel>
  scripts?: ReturnType<typeof createScriptService>
  resourceDownloads?: ReturnType<typeof createResourceDownloadService>
  commitPublisher?: { dispose(): void }
  mediaWatcher?: { dispose(): void }
  httpServer?: ReturnType<typeof createStudioHttpServer>
}

async function drainResources(resources: ActiveServerState, swallowErrors: boolean): Promise<void> {
  const runStep = async (step: (() => unknown) | undefined) => {
    if (!step) return
    if (!swallowErrors) {
      await step()
      return
    }
    try {
      await step()
    } catch {
      // Best-effort rollback on startup failure; preserve the original startup error.
    }
  }

  resources.mediaWatcher?.dispose()
  resources.mediaWatcher = undefined
  resources.commitPublisher?.dispose()
  resources.commitPublisher = undefined

  try {
    await runStep(resources.httpServer ? () => resources.httpServer!.shutdown() : undefined)
  } finally {
    try {
      await runStep(resources.resourceDownloads ? () => resources.resourceDownloads!.close() : undefined)
    } finally {
      try {
        try {
          await runStep(resources.scripts ? () => resources.scripts!.dispose() : undefined)
        } finally {
          await runStep(resources.kernel ? () => resources.kernel!.stop() : undefined)
        }
      } finally {
        try {
          await runStep(resources.secrets
            ? () => resources.secrets!.retryPendingCleanup({
              actor: { kind: 'system', id: 'studio-server' },
              reason: 'server.stop.secret-cleanup',
            })
            : undefined)
        } finally {
          try {
            await runStep(resources.applicationRuntime
              ? () => resources.applicationRuntime!.disposeObservations()
              : resources.observations
                ? () => resources.observations!.dispose()
                : undefined)
          } finally {
            try {
              await runStep(resources.dataEngine ? () => resources.dataEngine!.close() : undefined)
            } finally {
              await resources.processLock?.release()
              resources.processLock = undefined
            }
          }
        }
      }
    }
  }
}

export function createStudioServer(options: CreateStudioServerOptions = {}): StudioServer {
  if (options.documents) {
    throw new Error('Studio Server requires a shared SQLite Data Engine and Prompt Resource Store')
  }

  const logger = options.logger
  let active: ActiveServerState | undefined
  let listenPromise: Promise<{ port: number }> | undefined
  let closingPromise: Promise<void> | undefined

  return {
    listen: async (port = defaultPort) => {
      if (active || listenPromise) {
        throw new Error('Studio server is already running')
      }

      const runListen = async (): Promise<{ port: number }> => {
        logger?.info('Studio server starting', {
          event: 'server.starting',
          data: { requestedPort: port },
        })

        const resources: ActiveServerState = {}
        try {
          // Stage 1: Resolve local paths and acquire exclusive data-root lock before opening SQLite.
          const officialContentDirectory = options.officialContentDirectory
          const localPaths = options.localPaths ?? resolveLoomStudioLocalPaths({ home: '.loomstudio-dev' })
          const lockFile = !options.localPaths && options.sqlitePath
            ? (options.sqlitePath === ':memory:' ? undefined : join(dirname(resolve(options.sqlitePath)), 'loom.lock'))
            : join(localPaths.dataRoot, 'loom.lock')
          if (lockFile) {
            resources.processLock = await acquireProcessLock({ lockFile, port, now: nowIso })
          }

          // Stage 2: Open SQLite Data Engine and construct durable stores.
          const databaseFile = options.sqlitePath ?? localPaths.databaseFile
          const databaseExistedBeforeOpen = databaseFile !== ':memory:' && existsSync(databaseFile)
          const dataEngine = createSqliteDataEngine({ filename: databaseFile, createId, now: nowIso })
          resources.dataEngine = dataEngine

          const backupRoot = join(localPaths.dataRoot, 'backups')
          const createSqliteBackup = async (prefix: string): Promise<{ filename: string; path: string; sizeBytes: number }> => {
            await mkdir(backupRoot, { recursive: true })
            const stamp = nowIso().replace(/[:.]/g, '-')
            let filename = `${prefix}-${stamp}.sqlite`
            let path = join(backupRoot, filename)
            let suffix = 1
            while (existsSync(path)) {
              filename = `${prefix}-${stamp}-${suffix}.sqlite`
              path = join(backupRoot, filename)
              suffix += 1
            }
            await dataEngine.backup(path)
            const info = await stat(path)
            return { filename, path, sizeBytes: info.size }
          }

          const extensionStateDirectory = resolve(options.extensionStateDirectory ?? localPaths.extensionRoot)
          const extensionDevLinksFile = options.extensionStateDirectory ? join(extensionStateDirectory, 'dev-links.json') : localPaths.extensionDevLinksFile
          const officialSetupFile = join(localPaths.configRoot, 'official-extension-setup.json')
          const extensionStateStore = createExtensionStateStore({
            engine: dataEngine,
            filename: options.extensionStateDirectory ? join(extensionStateDirectory, 'state.json') : localPaths.extensionStateFile,
            officialSetupFile,
            devLinksFile: extensionDevLinksFile,
            now: nowIso,
            onBeforeMigrate: async () => {
              if (!databaseExistedBeforeOpen) return
              await createSqliteBackup('pre-state-migration')
            },
          })
          await extensionStateStore.load()

          const diagnostics = createInMemoryDiagnosticsRegistry()
          const rawDocuments = createSqliteDocumentStore({ engine: dataEngine })
          const documents = options.documentLogger ? withDocumentStoreLogging(rawDocuments, options.documentLogger) : rawDocuments
          const networkSettings = createNetworkSettingsStore({
            filename: join(localPaths.configRoot, 'network.json'),
            resolveSystemProxyUrl,
          })
          const secrets = createSecretStore({
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
          })
          resources.secrets = secrets

          const statistics = createStatisticsStore(dataEngine, nowIso, () => {
            diagnostics.add({
              severity: 'warning',
              source: 'statistics',
              code: 'statistics.capture_failed',
              message: 'Usage recording failed; statistics may be incomplete.',
            })
          })
          const observations = createObservationStore({ persistencePath: join(localPaths.configRoot, 'observations') })
          resources.observations = observations
          const promptResources = createPromptResourceStore({ engine: dataEngine, createId, now: nowIso })
          const agents = createAgentStore({ engine: dataEngine, createId, now: nowIso })
          const narratives = createNarrativeStore({ engine: dataEngine, createId, now: nowIso })
          const states = createStateStore({ engine: dataEngine, createId, now: nowIso })
          const blobs = createBlobStore({
            engine: dataEngine,
            rootDirectory: localPaths.blobRoot,
            createId,
            now: nowIso,
          })
          const assets = createAssetStore({ engine: dataEngine, blobs, createId, now: nowIso })

          // Stage 3: Wire Runtime, Extension Host/Manager, Kernel, Scripts, Card Directories, and RPC context.
          const exportExtensionArchive = createExtensionScriptArchiveExporter({ documents, blobs })
          /* oxlint-disable prefer-const -- Forward-declared for mutually referencing Stage 3 closures. */
          let extensionManager: ReturnType<typeof createServerExtensionManager>
          let kernel: ReturnType<typeof createKernel>
          let resourceDirectories: ReturnType<typeof createCardDirectoryService>
          let cardTransfer: ReturnType<typeof createCardTransferService>
          let characterCatalog: ReturnType<typeof createExtensionCharacterCatalog>
          /* oxlint-enable prefer-const */

          const applicationRuntime = createApplicationRuntime({
            observations,
            exportExtensionArchive,
            validatePackageAsset: input => extensionManager.validatePackageAsset(input),
            onStateChanged: event => kernel.getEventBus().emit('state.changed', event, { publisher: { kind: 'kernel' }, source: 'application-state' }),
            withCardDeletion: (id, commit) => extensionManager.withCardDeletions([id], () => resourceDirectories.deleteCard(id, commit)),
            withCardDeletions: (ids, commit) => extensionManager.withCardDeletions(ids, () => resourceDirectories.deleteCards(ids, commit)),
            agents,
            dataEngine,
            documents,
            blobs,
            narratives,
            promptResources,
            states,
            sourceArtifacts: {
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
            },
            mediaAssets: { get: assetId => assets.getMediaAsset(assetId), read: (id, readOptions) => assets.readMediaAsset(id, readOptions) },
            secrets,
            statistics,
            resolveProxyUrl: networkSettings.resolveProxyUrl,
            providerLogger: options.providerLogger,
            logger: options.promptBuildLogger,
            runtimeLogger: options.runtimeLogger,
          })
          resources.applicationRuntime = applicationRuntime

          const extensionAgentTasks = createExtensionAgentTasks({ runtime: applicationRuntime, documents })
          const extensionFileData = createExtensionFileData(localPaths.dataRoot, documents)
          const resourceDownloads = createResourceDownloadService({
            directory: join(localPaths.cacheRoot, 'resource-downloads'),
            logger: options.logger?.child('resource.downloads'),
          })
          resources.resourceDownloads = resourceDownloads

          const extensionHost = createExtensionHost({
            resourceSourceCredentials: createSourceCredentialStore(join(localPaths.configRoot, 'source-credentials.json'), secrets),
            registerResourceSource: adapter => resourceDownloads.registerAdapter({
              ...adapter,
              matches: url => url.protocol === 'https:' && adapter.links.some(link => url.hostname === link.hostname && url.pathname.startsWith(link.pathPrefix)),
            }),
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
              applicationRuntime,
              assets,
              documents,
              extensionAgentTasks,
              getKernel: () => kernel,
            }),
          })

          const useOfficialExtensions = (options.runtimeMode === 'production' || options.runtimeMode === 'development')
            && !options.extensionInstalledDirectory && !options.extensionRootDirectory
          const extensionRootDirectory = options.extensionRootDirectory
            ?? (useOfficialExtensions ? join(installationRoot, 'official/extensions') : undefined)

          extensionManager = createServerExtensionManager({
            logger: options.extensionLogger ?? options.logger?.child('extension.manager'),
            exportExtensionArchive,
            loadPromptResourceFiles,
            host: extensionHost,
            diagnostics,
            engine: dataEngine,
            now: nowIso,
            stateStore: extensionStateStore,
            repositoryDirectory: extensionRootDirectory,
            installedDirectory: options.extensionInstalledDirectory ?? join(installationRoot, 'extensions'),
            devLinksFile: extensionDevLinksFile,
            deleteData: extensionFileData.removeGlobal,
            officialSetupFile,
            bundledDirectories: useOfficialExtensions
              ? [
                join(installationRoot, 'official/extensions/loom-assistant'),
                join(installationRoot, 'official/extensions/story-memory'),
              ] : [],
            bundledEnabledModules: { 'official.story-memory': ['server', 'client'] },
            readCardPackage: input => applicationRuntime.getCardExtensionPackage(input),
            listInstallations: () => applicationRuntime.listExtensionInstallations(),
            assertDependencyConsumers: (packageId, target, nextVersion) => applicationRuntime.checkExtensionDependencyConsumers({ packageId, target, nextVersion }),
            onModuleBatchCompleted: result => {
              kernel.getEventBus().emit('extensions.changed', {
                packageId: result.packageId, target: result.target, action: 'batch-completed', batchId: result.batchId,
              }, { publisher: { kind: 'kernel' } })
            },
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

          kernel = createKernel({
            documents,
            dataCommits: dataEngine,
            diagnostics,
            extensionHost,
            extensionManager,
            characterCatalog: {
              list: packageId => characterCatalog.list(packageId),
              preview: (packageId, characterId) => characterCatalog.preview(packageId, characterId),
              import: (input, clientId) => characterCatalog.import(input, clientId),
            },
          })
          resources.kernel = kernel

          const importConversions = createExtensionImportConversions(kernel)
          const scripts = createScriptService({
            runtime: applicationRuntime,
            host: extensionHost,
            documents,
            diagnostics,
          })
          resources.scripts = scripts

          kernel.getEventBus().registerDefinition({
            name: 'directories.media.changed', owner: { kind: 'kernel' }, version: 1,
            visibility: 'public', stability: 'experimental', summary: 'Card directory media changed',
          })
          const agentRunListChanged = 'agent.run-list.changed'
          kernel.getEventBus().registerDefinition({
            name: agentRunListChanged, owner: { kind: 'kernel' }, version: 1,
            visibility: 'internal', stability: 'experimental', summary: 'Agent task list changed',
          })
          const publishAgentRunListChange = (timelineId?: string | null) => {
            kernel.getEventBus().emit(agentRunListChanged, timelineId === undefined ? {} : { timelineId }, { source: 'studio-server' })
          }
          applicationRuntime.runs.setListChangeListener(sessionId => {
            void agents.getSession(sessionId).then(session => {
              publishAgentRunListChange(session ? session.timelineId ?? null : undefined)
            }).catch(error => {
              logger?.warn('Could not scope Agent task list update', { event: 'agent.run_list_notification_failed', error })
              publishAgentRunListChange()
            })
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
          const directoryMedia = createCardDirectoryMedia({
            dataRoot: localPaths.dataRoot,
            logger: options.logger?.child('card.directory.media'),
          })
          resourceDirectories = createCardDirectoryService({
            dataRoot: localPaths.dataRoot,
            logger: options.logger?.child('card.directory'),
            readCard: cardId => cardTransfer.readCardExport(cardId),
            applyCard: async (cardId, artifact, snapshot, context) => {
              await applicationRuntime.applyCardDirectoryState({ cardId, artifact, snapshot }, context)
            },
          })
          const cardExists = async (id: string) => {
            const document = await documents.get(id)
            return Boolean(document && !document.meta.tombstone)
          }
          const saveImportedCard = async (id: string) => {
            await resourceDirectories.saveImportedCard(id)
          }
          const directoryImporter = createCardDirectoryImporter({
            dataRoot: localPaths.dataRoot,
            cardExists,
            isRegistered: async directory => {
              const catalog = await directoryCatalog.scan()
              if (catalog.error) throw new Error(catalog.error)
              const entry = catalog.entries.find(item => item.directory === directory)
              if (entry?.error) throw new Error(entry.error)
              return Boolean(entry?.registeredCardId)
            },
            importCard: async (bundle, id, clientId) => { await cardTransfer.importCardArchive(bundle, clientId, id) },
            saveImportedCard,
          })
          cardTransfer = createCardTransferService({ applicationRuntime, assets, directoryMedia, importConversions, saveImportedCard })
          characterCatalog = createExtensionCharacterCatalog({
            runtime: applicationRuntime,
            readPackage: packageId => extensionManager.readCharacterPackage(packageId),
            importArchive: cardTransfer.importArchiveAndSave,
          })

          const rpcServices: StudioRpcServices = {
            resourceDownloads,
            resourceDownloadUse: createResourceDownloadUse({
              downloads: resourceDownloads,
              extensions: extensionManager,
              runtime: applicationRuntime,
              cards: cardTransfer,
              logger: options.logger?.child('resource.adopt'),
            }),
            dashboard: {
              statistics,
              storage: createStorageSnapshot(localPaths, databaseFile),
              database: () => readSqliteSpaceUsage(dataEngine),
              createBackup: () => createSqliteBackup('studio-backup'),
            },
            scripts,
            directoryCatalog,
            directoryResources: resourceDirectories,
            directoryImporter,
            batchImporter: createExtensionBatchImporter({ kernel, runtime: applicationRuntime, assets, saveImportedCard }),
            convertPromptResource: importConversions.promptResource,
            applicationRuntime,
            officialContent: createOfficialContentService(applicationRuntime, officialContentDirectory ? resolve(officialContentDirectory) : undefined),
            aiCapabilities: applicationRuntime.extensionPorts.aiCapabilities,
            aiGateway: applicationRuntime.extensionPorts.aiGateway,
            kernel,
            extensionManager,
            extensionHost,
            diagnostics,
            characterCatalog,
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

          // Stage 4: Run recovery, start Kernel/Extensions/Scripts, and attach watchers.
          await secrets.retryPendingCleanup({ actor: { kind: 'system', id: 'studio-server' }, reason: 'server.start.secret-cleanup' })
          await resourceDownloads.initialize()
          const startupDirectoryScan = directoryCatalog.scan()
          rpcServices.startupDirectoryScan = startupDirectoryScan
          await startupDirectoryScan
          const deletionRecoveryErrors = await resourceDirectories.recoverDeletions(async id => {
            const document = await documents.get(id)
            return Boolean(document && !document.meta.tombstone)
          })
          const recoveryErrors = [
            ...deletionRecoveryErrors,
            ...await directoryImporter.recoverImports(),
            ...await resourceDirectories.recoverApplies(),
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
          resources.commitPublisher = dataEngine.subscribeCommits(commit => {
            kernel.getEventBus().emit('extensions.data.changed', { changesetId: commit.changesetId }, { publisher: { kind: 'kernel' } })
            const timelines = new Set<string | null>()
            for (const operation of commit.operations) {
              if (operation.entityType === 'agent.session' && operation.kind !== 'create') {
                timelines.add(operation.scope?.entityType === 'narrative.timeline' ? operation.scope.entityId : null)
              }
            }
            if (timelines.size) publishAgentRunListChange(timelines.size === 1 ? timelines.values().next().value : undefined)
          })
          await extensionManager.initialize()
          await scripts.resolve({ workspaceId: 'workspace' })
          resources.mediaWatcher = await directoryMedia.watch(() => {
            kernel.getEventBus().emit('directories.media.changed', {}, { publisher: { kind: 'kernel' }, source: 'studio-server' })
          })

          // Stage 5: Create and bind HTTP server.
          const httpServer = createStudioHttpServer({
            trpcServices: rpcServices,
            applicationRuntime,
            auth: createApplicationSessionAuth({
              allowedOrigins: options.applicationSessionOrigins ?? (options.runtimeMode === 'production' ? [] : [defaultClientOrigin]),
              allowPrivateNetworkOrigins: options.runtimeMode === 'development' && process.env.LOOM_DEV_LAN === '1',
            }),
            clientDirectory: options.clientDirectory,
            assets,
            canReadCardExtensionAsset: input => canReadCardExtensionAsset({
              documents,
              assets,
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
                return eventBus.subscribe(['extensions.changed', 'extensions.data.changed', 'entity.lifecycle.changed', 'directories.media.changed', 'data.changed', agentRunListChanged], handler)
              },
            },
            logger: options.rpcLogger,
          })
          resources.httpServer = httpServer

          await new Promise<void>((resolveListen, rejectListen) => {
            const handleError = (error: Error) => rejectListen(error)
            httpServer.once('error', handleError)
            httpServer.listen(port, '127.0.0.1', () => {
              httpServer.off('error', handleError)
              resolveListen()
            })
          })

          const address = httpServer.address()
          const actualPort = typeof address === 'object' && address ? address.port : port
          active = resources
          logger?.info('Studio server started', {
            event: 'server.started',
            data: { host: '127.0.0.1', port: actualPort, detail: `http://127.0.0.1:${actualPort}` },
          })
          return { port: actualPort }
        } catch (error) {
          active = undefined
          await drainResources(resources, true)
          logger?.error('Studio server failed to start', {
            event: 'server.start.failed',
            data: { requestedPort: port, ...readLogFailure(error), detail: readLogFailure(error).failureReason },
          })
          throw error
        }
      }

      const pending = runListen().finally(() => {
        listenPromise = undefined
      })
      listenPromise = pending
      return pending
    },
    close: async () => {
      if (closingPromise) return closingPromise
      if (listenPromise) {
        await listenPromise.catch(() => undefined)
      }
      if (!active) return
      const resources = active
      active = undefined
      const runClose = async () => {
        logger?.info('Studio server stopping', { event: 'server.stopping' })
        await drainResources(resources, false)
        logger?.info('Studio server stopped', { event: 'server.stopped' })
      }
      closingPromise = runClose().finally(() => {
        closingPromise = undefined
      })
      return closingPromise
    },
  }
}
