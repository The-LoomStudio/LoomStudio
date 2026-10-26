import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { AiGatewayCapabilityRegistry, ProfiledAiGateway } from '@loom-studio/ai-gateway'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import type { ExtensionAssetCapability, ExtensionHostOptions } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import type { Logger } from '@loom-studio/logging'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

export function createExtensionHostHarness(options: {
  readExtensionNarrative?: ExtensionHostOptions['readExtensionNarrative']
  validateExtensionNarrative?: ExtensionHostOptions['validateExtensionNarrative']
  subscribeNarrativeActivity?: ExtensionHostOptions['subscribeNarrativeActivity']
  registerReadonlyFiles?: ExtensionHostOptions['registerReadonlyFiles']
  extensionAgentTasks?: ExtensionHostOptions['extensionAgentTasks']
  logger?: Logger
  grantAssetCapabilities?: (packageId: string, moduleId: string) => readonly ExtensionAssetCapability[]
  assets?: ExtensionHostOptions['assets']
  portablePayloads?: ExtensionHostOptions['portablePayloads']
  validateStorageScope?: ExtensionHostOptions['validateStorageScope']
  validateEntityRef?: ExtensionHostOptions['validateEntityRef']
  assetScratchRoot?: string
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  invokeModel?: ExtensionHostOptions['invokeModel']
  buildPrompt?: ExtensionHostOptions['buildPrompt']
  registerPromptProcessor?: ExtensionHostOptions['registerPromptProcessor']
  registerMacroProvider?: ExtensionHostOptions['registerMacroProvider']
  registerNarrativeContextProvider?: ExtensionHostOptions['registerNarrativeContextProvider']
  registerStateContribution?: ExtensionHostOptions['registerStateContribution']
  registerStateContentHandler?: ExtensionHostOptions['registerStateContentHandler']
  registerAgentToolHandler?: ExtensionHostOptions['registerAgentToolHandler']
  readState?: ExtensionHostOptions['readState']
  writeState?: ExtensionHostOptions['writeState']
  runTimelineWork?: ExtensionHostOptions['runTimelineWork']
  beginTimelineWork?: ExtensionHostOptions['beginTimelineWork']
  canRunTimelineWork?: ExtensionHostOptions['canRunTimelineWork']
  assertTimelineWork?: ExtensionHostOptions['assertTimelineWork']
} = {}) {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    readExtensionNarrative: options.readExtensionNarrative,
    validateExtensionNarrative: options.validateExtensionNarrative,
    subscribeNarrativeActivity: options.subscribeNarrativeActivity,
    registerReadonlyFiles: options.registerReadonlyFiles,
    extensionAgentTasks: options.extensionAgentTasks,
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
    invokeModel: options.invokeModel,
    buildPrompt: options.buildPrompt,
    registerPromptProcessor: options.registerPromptProcessor,
    registerMacroProvider: options.registerMacroProvider,
    registerNarrativeContextProvider: options.registerNarrativeContextProvider,
    registerStateContribution: options.registerStateContribution,
    registerStateContentHandler: options.registerStateContentHandler,
    registerAgentToolHandler: options.registerAgentToolHandler,
    readState: options.readState,
    writeState: options.writeState,
    runTimelineWork: options.runTimelineWork,
    beginTimelineWork: options.beginTimelineWork,
    canRunTimelineWork: options.canRunTimelineWork,
    assertTimelineWork: options.assertTimelineWork,
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
    dataCommits: documents,
    diagnostics,
    extensionHost,
  })

  onTestFinished(async () => {
    try {
      await kernel.stop()
      await extensionHost.disposeAll()
    } finally {
      await documents.close()
    }
  })

  return { kernel, extensionHost, diagnostics, documents }
}

export function createExtensionFixture(name: string, input: { manifest: unknown; source: string }): string {
  const root = mkdtempSync(join(tmpdir(), `loom-test-extension-${name}-`))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
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
