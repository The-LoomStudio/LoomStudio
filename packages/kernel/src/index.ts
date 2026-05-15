import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { DocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import type { LoomRunner } from '@loom-studio/loom-runner'

export type Kernel = {
  start(): Promise<void>
  stop(): Promise<void>
}

export type CreateKernelOptions = {
  documents: DocumentStore
  diagnostics: DiagnosticsRegistry
  extensionHost: ExtensionHost
  loomRunner: LoomRunner
}

export function createKernel(_options: CreateKernelOptions): Kernel {
  void _options

  return {
    start: async () => {},
    stop: async () => {},
  }
}
