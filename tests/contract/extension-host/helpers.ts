import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import type { ExtensionAssetCapability, ExtensionHostOptions } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import type { Logger } from '@loom-studio/logging'
import { createLoomRunner, createSamplePassFactories } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function createExtensionHostHarness(options: {
  logger?: Logger
  grantAssetCapabilities?: (packageId: string, moduleId: string) => readonly ExtensionAssetCapability[]
  assets?: ExtensionHostOptions['assets']
  assetScratchRoot?: string
} = {}) {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit, factories: createSamplePassFactories() })
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    logger: options.logger,
    grantAssetCapabilities: (packageManifest: { id: string }, moduleManifest: { id: string }) => (
      options.grantAssetCapabilities?.(packageManifest.id, moduleManifest.id) ?? []
    ),
    assets: options.assets,
    assetScratchRoot: options.assetScratchRoot,
    callRpc: (method: string, params?: unknown, context?: unknown) => kernel.callRpc(method, params as never, context as never),
    registerRpc: (name: string, ownerPackageId: string, ownerModuleId: string, handler: (...args: unknown[]) => unknown, ownerInstanceId?: string) => {
      const handle = kernel.registerExtensionRpc(name, ownerPackageId, ownerModuleId, handler as never, ownerInstanceId)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler: handler as never, dispose: handle.dispose }
    },
    emitEvent: (name: string, payload: unknown, publisher: { kind: string; packageId?: string; moduleId?: string }) => {
      kernel.getEventBus().emit(name, payload as never, {
        publisher: publisher as never,
        source: publisher.kind === 'extension' ? `extension:${publisher.packageId}/${publisher.moduleId}` : publisher.kind,
      })
    },
  })

  kernel = createKernel({
    documents,
    dataCommits: createDocumentDataCommitSource(documents),
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

export function manifest(id: string, rpc: Array<{ name: string }>, documentTypes: string[] = []) {
  return {
    manifestVersion: 2,
    id,
    version: '0.0.0',
    displayName: id,
    engines: { studio: '^0.1.0' },
    modules: [{
      id: 'server',
      runtime: 'server',
      entry: './dist/index.js',
      contributes: {
        rpc,
        ...(documentTypes.length ? { documentTypes: documentTypes.map(type => ({ type })) } : {}),
      },
    }],
  }
}
