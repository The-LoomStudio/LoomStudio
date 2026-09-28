import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { AiGatewayCapabilityRegistry, ProfiledAiGateway } from '@loom-studio/ai-gateway'
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
  portablePayloads?: ExtensionHostOptions['portablePayloads']
  validateStorageScope?: ExtensionHostOptions['validateStorageScope']
  validateEntityRef?: ExtensionHostOptions['validateEntityRef']
  assetScratchRoot?: string
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  registerMacroProvider?: ExtensionHostOptions['registerMacroProvider']
  registerNarrativeContextProvider?: ExtensionHostOptions['registerNarrativeContextProvider']
  registerStateContribution?: ExtensionHostOptions['registerStateContribution']
  registerAgentToolHandler?: ExtensionHostOptions['registerAgentToolHandler']
  readState?: ExtensionHostOptions['readState']
  writeState?: ExtensionHostOptions['writeState']
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
    portablePayloads: options.portablePayloads,
    validateStorageScope: options.validateStorageScope,
    validateEntityRef: options.validateEntityRef,
    assetScratchRoot: options.assetScratchRoot,
    aiCapabilities: options.aiCapabilities,
    aiGateway: options.aiGateway,
    registerMacroProvider: options.registerMacroProvider,
    registerNarrativeContextProvider: options.registerNarrativeContextProvider,
    registerStateContribution: options.registerStateContribution,
    registerAgentToolHandler: options.registerAgentToolHandler,
    readState: options.readState,
    writeState: options.writeState,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId, target) => {
      const handle = kernel.registerExtensionRpc(name, ownerPackageId, ownerModuleId, handler, ownerInstanceId, target)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler, dispose: handle.dispose }
    },
    registerEventDefinition: (definition, registeredBy) => kernel.getEventBus().registerDefinition(definition, registeredBy),
    subscribeEvents: (patterns, handler, subscriber) => kernel.getEventBus().subscribe(patterns, handler, { subscriber }),
    emitEvent: (name, payload, publisher) => {
      return kernel.getEventBus().emit(name, payload, {
        publisher,
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
