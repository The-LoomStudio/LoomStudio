import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import type { Logger } from '@loom-studio/logging'
import { createLoomRunner } from '@loom-studio/loom-runner'
import type { JsonValue } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function createExtensionHostHarness(options: { logger?: Logger } = {}) {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    logger: options.logger,
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

  kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, extensionHost, diagnostics, documents }
}

export function createExtensionFixture(name: string, input: { manifest: unknown; source: string }): string {
  const root = join(process.cwd(), '.loomstudio-dev/test-extensions', name)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(input.manifest))
  writeFileSync(join(root, 'dist/index.js'), input.source)
  return root
}

export function manifest(id: string, rpc: Array<{ name: string }>) {
  return {
    manifestVersion: 1,
    id,
    version: '0.0.0',
    displayName: id,
    engines: { studio: '^0.1.0' },
    server: { entry: './dist/index.js' },
    contributes: { rpc },
  }
}

function summarizeDocumentChange(result: { changesetId: string; operations: unknown; documents: Array<{ id: string; type: string; version: number; meta: { tombstone?: unknown } }> }): JsonValue {
  return {
    changesetId: result.changesetId,
    operations: result.operations as JsonValue,
    documents: result.documents.map(document => ({
      id: document.id,
      type: document.type,
      version: document.version,
      tombstoned: Boolean(document.meta.tombstone),
    })),
  }
}
