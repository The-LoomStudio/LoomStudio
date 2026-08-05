import { createApplicationRuntime, createDocumentBackedAiGateway } from '@loom-studio/application-runtime'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createSqliteDocumentStore, type DocumentStore, type SqliteDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import { createConsoleLogSink, createMemoryLogSink, createRootLogger, type Logger, type LogReader, type LogRecord } from '@loom-studio/logging'
import { createJsonlFileSink } from '@loom-studio/logging/node'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { withAiGatewayLogging } from './ai-gateway-logging.js'
import { withDocumentStoreLogging } from './document-store-logging.js'
import { createStudioHttpServer } from './http-server.js'
import { createStudioRpcRouter } from './studio-rpc-router.js'

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
}

export function createStudioServer(options: CreateStudioServerOptions = {}): StudioServer {
  const logger = options.logger
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const rawDocuments = options.documents ?? createSqliteDocumentStore({ filename: options.sqlitePath ?? defaultSqlitePath })
  const documents = options.documentLogger ? withDocumentStoreLogging(rawDocuments, options.documentLogger) : rawDocuments
  const ownsDocumentStore = !options.documents
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  const gateway = createDocumentBackedAiGateway({ documents })
  const applicationRuntime = createApplicationRuntime({
    documents,
    gateway: options.providerLogger ? withAiGatewayLogging(gateway, options.providerLogger) : gateway,
    logger: options.promptBuildLogger,
  })
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    logger: options.extensionLogger,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerExtensionId, handler) => {
      const handle = kernel.registerExtensionRpc(name, ownerExtensionId, handler)
      return { name, ownerExtensionId, handler, dispose: handle.dispose }
    },
    emitEvent: (name, payload, ownerExtensionId) => {
      kernel.getEventBus().emit(name, payload, { source: `extension:${ownerExtensionId}` })
    },
  })
  const kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
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
        await extensionHost.discover(resolve('extensions/example-echo'))
        await extensionHost.activateAll()
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
      await kernel.stop()
      if (ownsDocumentStore && isClosableDocumentStore(rawDocuments)) {
        rawDocuments.close()
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

function isClosableDocumentStore(store: DocumentStore): store is SqliteDocumentStore {
  return 'close' in store && typeof store.close === 'function'
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
