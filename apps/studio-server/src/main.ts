import {
  createApplicationRuntime,
  createDocumentBackedAiGateway,
  createOfficialTestAgentToolRegistry,
} from '@loom-studio/application-runtime'
import { createOfficialProviderAdapterRegistry } from '@loom-studio/ai-gateway'
import { createAgentStore } from '@loom-studio/agent-store'
import { createAssetStore, type AssetStore } from '@loom-studio/asset-store'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine, type SqliteDataEngine } from '@loom-studio/data-engine'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createSqliteDocumentStore, type DocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import { createConsoleLogSink, createMemoryLogSink, createRootLogger, type Logger, type LogReader, type LogRecord } from '@loom-studio/logging'
import { createJsonlFileSink } from '@loom-studio/logging/node'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore, type PromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createKeyringSecretBackend, createSecretStore, type SecretBackend } from '@loom-studio/secret-store'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId, nowIso } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { join, resolve } from 'node:path'
import { withAiGatewayLogging } from './ai-gateway-logging.js'
import { createNetworkSettingsStore } from './network-settings.js'
import { resolveSystemProxyUrl } from './system-proxy.js'
import { createApplicationSessionAuth } from './application-session-auth.js'
import { withDocumentStoreLogging } from './document-store-logging.js'
import { createStudioHttpServer } from './http-server.js'
import {
  createPolyglotCardPng,
  decodeCardPng,
  defaultCardPng,
  encodeCardPng,
  isPng,
  readPngImageBytes,
  readPolyglotArchive,
} from './card-png.js'
import { decodeCardBundleZip, encodeCardBundleZip, type CardBundleMedia } from './card-bundle-zip.js'
import { createStudioRpcRouter } from './studio-rpc-router.js'
import { createServerExtensionManager } from './extensions/extension-manager.js'
import { createExtensionStateStore } from './extensions/extension-state-store.js'
import { resolveLoomStudioLocalPaths, type LoomStudioLocalPaths } from './local-paths.js'

const defaultPort = 4173

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
  rpcLogger?: Logger
  documentLogger?: Logger
  promptBuildLogger?: Logger
  providerLogger?: Logger
  extensionLogger?: Logger
  extensionRootDirectory?: string
  extensionStateDirectory?: string
  secretBackend?: SecretBackend
  applicationSessionOrigins?: string[]
}

export function createStudioServer(options: CreateStudioServerOptions = {}): StudioServer {
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
      dataEngine.close()
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
  }) : undefined
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  const providerAdapters = createOfficialProviderAdapterRegistry()
  const gateway = createDocumentBackedAiGateway({
    documents,
    secrets,
    resolveProxyUrl: networkSettings.resolveProxyUrl,
    providerAdapters,
  })
  let agents
  let narratives
  let assets: AssetStore | undefined
  let promptResources: PromptResourceStore | undefined
  try {
    promptResources = dataEngine ? createPromptResourceStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    agents = dataEngine ? createAgentStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    narratives = dataEngine ? createNarrativeStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    if (dataEngine) {
      const blobs = createBlobStore({
        engine: dataEngine,
        rootDirectory: localPaths.blobRoot,
        createId,
        now: nowIso,
      })
      assets = createAssetStore({ engine: dataEngine, blobs, createId, now: nowIso })
    }
  } catch (error) {
    dataEngine?.close()
    throw error
  }
  if (!dataEngine || !promptResources) {
    throw new Error('Studio Server requires a shared SQLite Data Engine and Prompt Resource Store')
  }
  const applicationRuntime = createApplicationRuntime({
    agents,
    agentTools: createOfficialTestAgentToolRegistry(),
    dataEngine,
    documents,
    narratives,
    promptResources,
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
    mediaAssets: assets ? { get: assetId => assets.getMediaAsset(assetId) } : undefined,
    secrets,
    providerAdapters,
    gateway: options.providerLogger ? withAiGatewayLogging(gateway, options.providerLogger) : gateway,
    logger: options.promptBuildLogger,
  })
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    logger: options.extensionLogger,
    mode: 'development',
    grantEventCapabilities: (manifest, moduleManifest) => extensionManager.getGrantedEventCapabilities(manifest.id, moduleManifest.id),
    grantAssetCapabilities: (manifest, moduleManifest) => extensionManager.getGrantedAssetCapabilities(manifest.id, moduleManifest.id),
    assetScratchRoot: localPaths.extensionCacheRoot,
    assets: assets
      ? {
          publish: async input => {
            const result = await assets.createMediaAsset({
              source: input.bytes,
              kind: input.kind,
              label: input.label,
              mediaType: input.mediaType,
              width: input.width,
              height: input.height,
              ownerPackageId: input.ownerPackageId,
              actor: input.actor,
              reason: 'extension.asset.publish',
            })
            return {
              id: result.asset.id,
              kind: result.asset.kind,
              label: result.asset.label,
              mediaType: result.asset.mediaType,
              sizeBytes: result.asset.sizeBytes,
              width: result.asset.width,
              height: result.asset.height,
              ownerPackageId: result.asset.ownerPackageId,
              createdAt: result.asset.createdAt,
            }
          },
          get: async assetId => {
            const asset = await assets.getMediaAsset(assetId)
            return asset
              ? {
                  id: asset.id,
                  kind: asset.kind,
                  label: asset.label,
                  mediaType: asset.mediaType,
                  sizeBytes: asset.sizeBytes,
                  width: asset.width,
                  height: asset.height,
                  ownerPackageId: asset.ownerPackageId,
                  createdAt: asset.createdAt,
                }
              : undefined
          },
          read: (assetId, readOptions) => assets.readMediaAsset(assetId, readOptions),
        }
      : undefined,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => {
      const handle = kernel.registerExtensionRpc(name, ownerPackageId, ownerModuleId, handler, ownerInstanceId)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler, dispose: handle.dispose }
    },
    registerEventDefinition: (definition, registeredBy) => kernel.getEventBus().registerDefinition(definition, registeredBy),
    emitEvent: (name, payload, publisher) => kernel.getEventBus().emit(name, payload, {
      publisher,
      source: publisher.kind === 'extension' ? `extension:${publisher.packageId}/${publisher.moduleId}` : publisher.kind,
    }),
    subscribeEvents: (patterns, handler, subscriber) => kernel.getEventBus().subscribe(patterns, handler, { subscriber }),
  })
  const extensionRootDirectory = resolve(options.extensionRootDirectory ?? 'extensions')
  const extensionStateDirectory = resolve(options.extensionStateDirectory ?? localPaths.extensionRoot)
  const extensionManager = createServerExtensionManager({
    host: extensionHost,
    diagnostics,
    stateStore: createExtensionStateStore({
      filename: options.extensionStateDirectory ? join(extensionStateDirectory, 'state.json') : localPaths.extensionStateFile,
      now: nowIso,
    }),
    repositoryDirectory: extensionRootDirectory,
    installedDirectory: options.extensionStateDirectory ? join(extensionStateDirectory, 'installed') : localPaths.extensionInstalledRoot,
    devLinksFile: options.extensionStateDirectory ? join(extensionStateDirectory, 'dev-links.json') : localPaths.extensionDevLinksFile,
  })
  const kernel = createKernel({
    documents,
    dataCommits: dataEngine ?? createDocumentDataCommitSource(documents),
    diagnostics,
    traceAudit,
    extensionHost,
    extensionManager,
    loomRunner,
  })
  const rpcRouter = createStudioRpcRouter({ applicationRuntime, kernel, logs: options.logs, networkSettings })
  const readCardExport = async (cardId: string) => {
    const { artifact } = await applicationRuntime.exportCardArtifact({ cardId })
    const readMedia = async (assetId: string | undefined): Promise<CardBundleMedia | undefined> => {
      if (!assetId) return undefined
      const media = await assets?.getMediaAsset(assetId)
      if (!media) return undefined
      return {
        bytes: await assets!.readMediaAsset(assetId, { maxBytes: 64 * 1024 * 1024 }),
        mediaType: media.mediaType ?? 'application/octet-stream',
      }
    }
    return {
      artifact,
      avatar: await readMedia(artifact.card.media?.avatarAssetId) ?? { bytes: defaultCardPng, mediaType: 'image/png' },
      background: await readMedia(artifact.card.media?.coverAssetId),
    }
  }
  const importCardArchive = async (input: Awaited<ReturnType<typeof decodeCardBundleZip>>, clientId: string) => {
    const createMedia = async (media: CardBundleMedia, kind: string) => (await assets!.createMediaAsset({
      source: media.bytes,
      kind,
      mediaType: media.mediaType,
      maxBytes: 64 * 1024 * 1024,
      actor: { kind: 'client', id: clientId },
      reason: 'application.importLoomCard.media',
    })).asset.id
    const avatarAssetId = await createMedia(input.avatar, 'card.avatar')
    const coverAssetId = input.background ? await createMedia(input.background, 'card.background') : undefined
    input.artifact.card.media = { avatarAssetId, ...(coverAssetId ? { coverAssetId } : {}) }
    return await applicationRuntime.importCardBundle({ artifact: input.artifact }, { clientId })
  }
  const server = createStudioHttpServer({
    auth: createApplicationSessionAuth({
      allowedOrigins: options.applicationSessionOrigins ?? ['http://127.0.0.1:5173'],
    }),
    assets,
    cardPng: assets ? {
      export: async cardId => {
        const { artifact, avatar } = await readCardExport(cardId)
        // ponytail: M0 不引入图片转码依赖；非 PNG 头像暂用内置 PNG，接入图像管线后再统一转码。
        return encodeCardPng(avatar.mediaType === 'image/png' && isPng(avatar.bytes) ? avatar.bytes : defaultCardPng, artifact)
      },
      import: async (source, session) => {
        const archive = readPolyglotArchive(source)
        if (archive) return await importCardArchive(await decodeCardBundleZip(archive), session.clientId)
        const artifact = decodeCardPng(source)
        const media = await assets.createMediaAsset({
          source: readPngImageBytes(source),
          kind: 'card.avatar',
          mediaType: 'image/png',
          maxBytes: 32 * 1024 * 1024,
          actor: { kind: 'client', id: session.clientId },
          reason: 'application.importCardPng.media',
        })
        artifact.card.media = {
          avatarAssetId: media.asset.id,
        }
        return await applicationRuntime.importCardBundle({ artifact }, { clientId: session.clientId })
      },
      exportBundle: async cardId => encodeCardBundleZip(await readCardExport(cardId)),
      importBundle: async (source, session) => await importCardArchive(await decodeCardBundleZip(source), session.clientId),
      exportPolyglot: async cardId => {
        const bundle = await readCardExport(cardId)
        const image = bundle.avatar.mediaType === 'image/png' && isPng(bundle.avatar.bytes) ? bundle.avatar.bytes : defaultCardPng
        return createPolyglotCardPng(image, encodeCardBundleZip(bundle))
      },
    } : undefined,
    extensionIcons: {
      read: (packageId, version) => extensionManager.readPackageIcon(packageId, version),
    },
    extensionEvents: {
      subscribe: handler => kernel.getEventBus().subscribe(['extensions.changed'], handler),
    },
    logger: options.rpcLogger,
    rpcRouter,
  })

  return {
    listen: async (port = defaultPort) => {
      logger?.info('Studio server starting', {
        event: 'server.starting',
        data: { requestedPort: port },
      })
      try {
        await applicationRuntime.initialize()
        await kernel.start()
        await extensionManager.initialize()
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
          data: { host: '127.0.0.1', port: actualPort },
        })
        return { port: actualPort }
      } catch (error) {
        logger?.error('Studio server failed to start', {
          event: 'server.start.failed',
          error,
          data: { requestedPort: port },
        })
        throw error
      }
    },
    close: async () => {
      logger?.info('Studio server stopping', { event: 'server.stopping' })
      if (server.listening) {
        const closed = new Promise<void>((resolve, reject) => {
          server.close(error => {
            if (error) reject(error)
            else resolve()
          })
        })
        server.closeAllConnections()
        await closed
      }
      try {
        await kernel.stop()
      } finally {
        dataEngine?.close()
      }
      logger?.info('Studio server stopped', { event: 'server.stopped' })
    },
  }
}

export async function main(): Promise<void> {
  const localPaths = resolveLoomStudioLocalPaths()
  const instanceId = createId('server')
  const memoryLogs = createMemoryLogSink({ capacity: 5_000 })
  const rootLogger = createRootLogger({
    service: 'studio-server',
    instanceId,
    sinks: [
      memoryLogs,
      createJsonlFileSink({ directory: localPaths.logRoot }),
      createConsoleLogSink({ filter: shouldWriteServerConsoleLog }),
    ],
  })
  const logger = rootLogger.child('system')
  const server = createStudioServer({
    localPaths,
    logger,
    logs: memoryLogs,
    rpcLogger: rootLogger.child('transport.rpc'),
    documentLogger: rootLogger.child('document.store'),
    promptBuildLogger: rootLogger.child('prompt.build'),
    providerLogger: rootLogger.child('runtime.provider'),
    extensionLogger: rootLogger.child('extension.loader'),
  })
  const port = Number(process.env.PORT ?? defaultPort)
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Studio server shutdown requested', {
      event: 'server.shutdown.requested',
      data: { signal },
    })
    try {
      await server.close()
    } catch (error) {
      logger.error('Studio server failed to stop cleanly', {
        event: 'server.stop.failed',
        error,
      })
      process.exitCode = 1
    } finally {
      await rootLogger.close()
    }
  }
  const handleSigint = () => void shutdown('SIGINT')
  const handleSigterm = () => void shutdown('SIGTERM')
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    await server.listen(port)
  } catch (error) {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    await server.close()
    await rootLogger.close()
    throw error
  }
}

function shouldWriteServerConsoleLog(record: LogRecord): boolean {
  return record.level === 'warn'
    || record.level === 'error'
    || record.namespace === 'system'
    || record.namespace === 'runtime.provider'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch(error => {
    if (isAddressInUseError(error)) {
      console.error(`Loom Studio server port ${error.port ?? defaultPort} is already in use. Stop the existing server or set PORT to another port.`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  })
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException & { port?: number } {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}
