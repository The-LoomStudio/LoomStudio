export type ExtensionManifest = {
  manifestVersion: 1
  id: string
  version: string
  displayName: string
  engines: {
    studio: string
    loom?: string
  }
}

export type ExtensionActivationContext = {
  extensionId: string
}

export type ServerExtensionModule = {
  activate(ctx: ExtensionActivationContext): void | Promise<void>
}

export function defineServerExtension(module: ServerExtensionModule): ServerExtensionModule {
  return module
}
