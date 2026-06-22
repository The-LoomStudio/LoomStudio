import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createSqliteDocumentStore, type DocumentStore, type SqliteDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import type { StudioEvent } from '@loom-studio/transport'
import { resolve } from 'node:path'
import { createStudioHttpServer } from './http-server.js'
import { createRendererPocService } from './renderer-poc.js'
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
}

export function createStudioServer(options: CreateStudioServerOptions = {}): StudioServer {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = options.documents ?? createSqliteDocumentStore({ filename: options.sqlitePath ?? defaultSqlitePath })
  const ownsDocumentStore = !options.documents
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  const applicationRuntime = createApplicationRuntime({ documents })
  const rendererPoc = createRendererPocService()
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerExtensionId, handler) => {
      const handle = kernel.registerExtensionRpc(name, ownerExtensionId, handler)
      return { name, ownerExtensionId, handler, dispose: handle.dispose }
    },
    emitEvent: (name, payload, ownerExtensionId) => {
      kernel.getEventBus().emit(name, payload, { source: `extension:${ownerExtensionId}` })
    },
    emitDocumentChange: (result, ownerExtensionId) => {
      kernel.getEventBus().emit('docs.changed', summarizeDocumentChange(result), { source: `extension:${ownerExtensionId}` })
    },
  })
  const kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
  })
  const rpcRouter = createStudioRpcRouter({ applicationRuntime, kernel, rendererPoc })
  const server = createStudioHttpServer({ rendererPoc, rpcRouter })

  return {
    listen: async (port = defaultPort) => {
      await kernel.start()
      await extensionHost.discover(resolve('extensions/example-echo'))
      await extensionHost.activateAll()
      await new Promise<void>(resolve => {
        server.listen(port, resolve)
      })
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      return { port: actualPort }
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error)
          else resolve()
        })
      })
      await kernel.stop()
      rendererPoc.close()
      if (ownsDocumentStore && isClosableDocumentStore(documents)) {
        documents.close()
      }
    },
  }
}

export async function main(): Promise<void> {
  const server = createStudioServer()
  const port = Number(process.env.PORT ?? defaultPort)
  const result = await server.listen(port)
  console.log(`Loom Studio server listening on ${result.port}`)
}

function summarizeDocumentChange(result: { changesetId: string; operations: unknown; documents: Array<{ id: string; type: string; version: number; meta: { tombstone?: unknown } }> }): StudioEvent['payload'] {
  return {
    changesetId: result.changesetId,
    operations: result.operations as StudioEvent['payload'],
    documents: result.documents.map(document => ({
      id: document.id,
      type: document.type,
      version: document.version,
      tombstoned: Boolean(document.meta.tombstone),
    })),
  }
}

function isClosableDocumentStore(store: DocumentStore): store is SqliteDocumentStore {
  return 'close' in store && typeof store.close === 'function'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
