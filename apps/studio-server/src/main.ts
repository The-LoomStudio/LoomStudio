import { createApplicationRuntime, createDocumentBackedAiGateway } from '@loom-studio/application-runtime'
import { createAgentStore } from '@loom-studio/agent-store'
import { createSqliteDataEngine, type SqliteDataEngine } from '@loom-studio/data-engine'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createSqliteDocumentStore, type DocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import { createConsoleLogSink, createMemoryLogSink, createRootLogger, type Logger, type LogReader, type LogRecord } from '@loom-studio/logging'
import { createJsonlFileSink } from '@loom-studio/logging/node'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId, nowIso } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { withAiGatewayLogging } from './ai-gateway-logging.js'
import { withDocumentStoreLogging } from './document-store-logging.js'
import { createStudioHttpServer } from './http-server.js'
import { createStudioRpcRouter } from './studio-rpc-router.js'
import { createServerExtensionManager } from './extensions/extension-manager.js'
import { createExtensionStateStore } from './extensions/extension-state-store.js'

const defaultPort = 4173
const defaultSqlitePath = '.loomstudio-dev/document-store.sqlite'

export type StudioServer = {
  listen(port?: number): Promise<{ port: number }>
  close(): Promise<void>
}

export type CreateStudioServerOptions = {
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
}

export function createStudioServer(options: CreateStudioServerOptions = {}): StudioServer {
  const logger = options.logger
  const diagnostics = createInMemoryDiagnosticsRegistry()
  let dataEngine: SqliteDataEngine | undefined
  let rawDocuments: DocumentStore
  if (options.documents) {
    rawDocuments = options.documents
  } else {
    dataEngine = createSqliteDataEngine({ filename: options.sqlitePath ?? defaultSqlitePath, createId, now: nowIso })
    try {
      rawDocuments = createSqliteDocumentStore({ engine: dataEngine })
    } catch (error) {
      dataEngine.close()
      throw error
    }
  }
  const documents = options.documentLogger ? withDocumentStoreLogging(rawDocuments, options.documentLogger) : rawDocuments
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  const gateway = createDocumentBackedAiGateway({ documents })
  let agents
  let narratives
  try {
    agents = dataEngine ? createAgentStore({ engine: dataEngine, createId, now: nowIso }) : undefined
    narratives = dataEngine ? createNarrativeStore({ engine: dataEngine, createId, now: nowIso }) : undefined
  } catch (error) {
    dataEngine?.close()
    throw error
  }
  const applicationRuntime = createApplicationRuntime({
    agents,
    dataEngine,
    documents,
    narratives,
    gateway: options.providerLogger ? withAiGatewayLogging(gateway, options.providerLogger) : gateway,
    logger: options.promptBuildLogger,
  })
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    logger: options.extensionLogger,
    mode: 'development',
    grantEventCapabilities: manifest => extensionManager.getGrantedEventCapabilities(manifest.id),
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerExtensionId, handler, ownerInstanceId) => {
      const handle = kernel.registerExtensionRpc(name, ownerExtensionId, handler, ownerInstanceId)
      return { name, ownerExtensionId, ownerInstanceId, handler, dispose: handle.dispose }
    },
    registerEventDefinition: (definition, registeredBy) => kernel.getEventBus().registerDefinition(definition, registeredBy),
    emitEvent: (name, payload, publisher) => kernel.getEventBus().emit(name, payload, {
      publisher,
      source: publisher.kind === 'extension' ? `extension:${publisher.extensionId}` : publisher.kind,
    }),
    subscribeEvents: (patterns, handler, subscriber) => kernel.getEventBus().subscribe(patterns, handler, { subscriber }),
  })
  const extensionRootDirectory = resolve(options.extensionRootDirectory ?? 'extensions')
  const extensionStateDirectory = resolve(options.extensionStateDirectory ?? '.loomstudio-dev/extensions')
  const extensionManager = createServerExtensionManager({
    host: extensionHost,
    diagnostics,
    stateStore: createExtensionStateStore({
      filename: join(extensionStateDirectory, 'state.json'),
      now: nowIso,
    }),
    repositoryDirectory: extensionRootDirectory,
    installedDirectory: join(extensionStateDirectory, 'installed'),
    devLinksFile: join(extensionStateDirectory, 'dev-links.json'),
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
  const rpcRouter = createStudioRpcRouter({ applicationRuntime, kernel, logs: options.logs })
  const server = createStudioHttpServer({ logger: options.rpcLogger, rpcRouter })

  return {
    listen: async (port = defaultPort) => {
      logger?.info('Studio server starting', {
        event: 'server.starting',
        data: { requestedPort: port },
      })
      try {
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
        await new Promise<void>((resolve, reject) => {
          server.close(error => {
            if (error) reject(error)
            else resolve()
          })
        })
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
  const instanceId = createId('server')
  const memoryLogs = createMemoryLogSink({ capacity: 5_000 })
  const rootLogger = createRootLogger({
    service: 'studio-server',
    instanceId,
    sinks: [
      memoryLogs,
      createJsonlFileSink({ directory: resolveLogDirectory() }),
      createConsoleLogSink({ filter: shouldWriteServerConsoleLog }),
    ],
  })
  const logger = rootLogger.child('system')
  const server = createStudioServer({
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

function resolveLogDirectory(): string {
  const dataDirectory = process.env.LOOM_STUDIO_DATA_DIR ?? join(homedir(), '.loomstudio')
  return join(dataDirectory, 'logs')
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
