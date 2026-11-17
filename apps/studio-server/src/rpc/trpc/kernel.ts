import type { DiagnosticFilter } from '@loom-studio/kernel/diagnostics'
import type { ExtensionHost } from '@loom-studio/kernel/extension-host'
import type { EventCapabilityCategory } from '@loom-studio/extension-sdk'
import type { BuiltinHandlers, ExtensionCharacterCatalogService, ExtensionManagementService, ExtensionModuleCapabilityGrants } from '@loom-studio/kernel'
import type { JsonValue } from '@loom-studio/shared'
import { z } from 'zod'
import { serviceProcedure as procedure, t, type StudioTrpcContext } from './context.js'

type ServiceCtx = StudioTrpcContext & { services: NonNullable<StudioTrpcContext['services']> }

function rpcCallContext(ctx: ServiceCtx) {
  return {
    clientId: ctx.request.clientId!,
    correlationId: ctx.request.correlationId!,
    callId: ctx.request.callId!,
    parentCallId: ctx.request.parentCallId,
  }
}

// Types come from the actual internal handlers. Keep Kernel dispatch for
// system.* introspection; callers cannot choose the output.
function callBuiltin<M extends keyof BuiltinHandlers>(ctx: ServiceCtx, method: M, input?: JsonValue): Promise<Awaited<ReturnType<BuiltinHandlers[M]>>> {
  return ctx.services.kernel.callRpc<Awaited<ReturnType<BuiltinHandlers[M]>>>(method, input, rpcCallContext(ctx))
}

function requireExtensionManager(ctx: ServiceCtx): ExtensionManagementService {
  if (!ctx.services.extensionManager) throw new Error('Extension management is not configured')
  return ctx.services.extensionManager
}

function requireExtensionHost(ctx: ServiceCtx): ExtensionHost {
  if (!ctx.services.extensionHost) throw new Error('Extension host is not configured')
  return ctx.services.extensionHost
}

function requireCharacterCatalog(ctx: ServiceCtx): ExtensionCharacterCatalogService {
  if (!ctx.services.characterCatalog) throw new Error('Extension character catalog unavailable')
  return ctx.services.characterCatalog
}

function emitExtensionsChanged(ctx: ServiceCtx, payload: JsonValue): void {
  ctx.services.emitEvent?.('extensions.changed', payload, rpcCallContext(ctx))
}

const target = z.discriminatedUnion('kind', [z.object({ kind: z.literal('global') }), z.object({ kind: z.literal('card'), cardId: z.string().min(1) })])
const pkg = z.object({ packageId: z.string() })
const globalPackage = z.strictObject({ packageId: z.string() }, { error: issue => issue.code === 'unrecognized_keys' && issue.keys.includes('target') ? 'Extension installation targets are not exposed by this endpoint yet' : undefined })
const moduleInput = pkg.extend({ moduleId: z.string(), target: target.optional() })
const version = z.number().int({ error: 'Expected a positive integer' }).positive({ error: 'Expected a positive integer' })
const installCard = pkg.extend({ cardId: z.string(), expectedCardVersion: version })
const updateCard = installCard.extend({ packageVersion: z.string(), expectedInstallationVersion: version, expectedPreviewFingerprint: z.string().min(1).optional(), keepPromptResourceIds: z.array(z.string().min(1)).max(1000).optional() })
const removeCard = pkg.extend({ cardId: z.string(), expectedInstallationVersion: version })
const source = z.discriminatedUnion('kind', [z.object({ kind: z.literal('git'), url: z.string(), ref: z.string().optional() }), z.object({ kind: z.literal('zip'), url: z.string() })])
const capabilityGrants = z.object({ ui: z.array(z.literal('ui.notify')).optional(), 'events.subscribe': z.array(z.union([z.enum(['documents', 'narrative', 'agent', 'diagnostics', 'platform-data', 'state']), z.templateLiteral(['extension:', z.string()])])).optional(), assets: z.array(z.enum(['assets.read', 'assets.publish'])).optional() })

function toCapabilityGrants(grants: z.infer<typeof capabilityGrants> | undefined): ExtensionModuleCapabilityGrants | undefined {
  if (!grants) return undefined
  return {
    uiCapabilities: grants.ui,
    eventCapabilities: grants['events.subscribe'] as EventCapabilityCategory[] | undefined,
    assetCapabilities: grants.assets,
  }
}

export const extensionsRouter = t.router({
  listRecoveryRecords: procedure.query(({ ctx }) => requireExtensionManager(ctx).listRecoveryRecords()),
  listModuleBatches: procedure.query(({ ctx }) => requireExtensionManager(ctx).listModuleBatches()),
  getModuleBatch: procedure.input(z.object({ batchId: z.string().min(1) })).query(({ ctx, input }) => requireExtensionManager(ctx).getModuleBatch(input.batchId)),
  startModuleBatch: procedure.input(pkg.extend({ target: target.optional(), enabled: z.boolean(), modules: z.array(z.object({ moduleId: z.string().min(1), grants: capabilityGrants.optional() })).max(100) })).mutation(({ ctx, input }) => requireExtensionManager(ctx).startModuleBatch({
    packageId: input.packageId,
    target: input.target,
    enabled: input.enabled,
    modules: input.modules.map(item => ({ moduleId: item.moduleId, grants: toCapabilityGrants(item.grants) })),
  })),
  previewPackageResources: procedure.input(pkg.extend({ packageVersion: z.string(), expectedInstallationVersion: version, target: target.optional(), expectedCardVersion: version.optional() })).query(({ ctx, input }) => requireExtensionManager(ctx).previewPackageResources(input)),
  importConvertedBatch: procedure.input(pkg.extend({ target, sessionId: z.string().min(1) }).strict()).mutation(({ ctx, input }) => {
    if (!ctx.services.batchImporter) throw new Error('Batch import service unavailable')
    return ctx.services.batchImporter.commit(input, ctx.request)
  }),
  listPackages: procedure.input(z.object({ target: target.optional() }).optional()).query(({ ctx, input }) => {
    const items = input?.target
      ? requireExtensionManager(ctx).listPackages(input.target)
      : ctx.services.extensionManager?.listPackages() ?? requireExtensionHost(ctx).list()
    return {
      items: items.map(item => {
        if (!('modules' in item)) throw new Error('Package management is not configured')
        return item
      }),
    }
  }),
  installCardPackage: procedure.input(installCard).mutation(async ({ ctx, input }) => {
    const extensionPackage = await requireExtensionManager(ctx).installCardPackage(input)
    emitExtensionsChanged(ctx, { packageId: extensionPackage.packageId, target: { kind: 'card', cardId: input.cardId }, action: 'installed' })
    return { package: extensionPackage }
  }),
  updateCardPackage: procedure.input(updateCard).mutation(async ({ ctx, input }) => {
    const extensionPackage = await requireExtensionManager(ctx).updateCardPackage(input)
    emitExtensionsChanged(ctx, { packageId: extensionPackage.packageId, target: { kind: 'card', cardId: input.cardId }, action: 'updated' })
    return { package: extensionPackage }
  }),
  uninstallCardPackage: procedure.input(removeCard).mutation(async ({ ctx, input }) => {
    const extensionPackage = await requireExtensionManager(ctx).uninstallCardPackage(input)
    emitExtensionsChanged(ctx, { packageId: extensionPackage.packageId, target: { kind: 'card', cardId: input.cardId }, action: 'uninstalled' })
    return { package: extensionPackage }
  }),
  installPackage: procedure.input(z.object({ sourceDirectory: z.string() })).mutation(async ({ ctx, input }) => {
    const extensionPackage = await requireExtensionManager(ctx).installPackage(input.sourceDirectory)
    emitExtensionsChanged(ctx, { packageId: extensionPackage.packageId, version: extensionPackage.version, action: 'installed' })
    return { package: extensionPackage }
  }),
  installPackageZip: procedure.input(z.object({ base64: z.string() })).mutation(async ({ ctx, input }) => {
    const extensionPackage = await requireExtensionManager(ctx).installPackageZip(new Uint8Array(Buffer.from(input.base64, 'base64')))
    emitExtensionsChanged(ctx, { packageId: extensionPackage.packageId, version: extensionPackage.version, action: 'installed' })
    return { package: extensionPackage }
  }),
  previewRemoteInstall: procedure.input(z.object({ sources: z.array(source) })).mutation(({ ctx, input }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.previewRemoteInstall) throw new Error('Remote extension installation is unavailable')
    return manager.previewRemoteInstall(input)
  }),
  previewPackageZip: procedure.input(z.object({ base64: z.string() })).mutation(({ ctx, input }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.previewPackageZip) throw new Error('ZIP preview requires package bytes')
    return manager.previewPackageZip(new Uint8Array(Buffer.from(input.base64, 'base64')))
  }),
  officialSetup: procedure.query(({ ctx }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.officialSetup) throw new Error('Official extension selection is unavailable')
    return manager.officialSetup()
  }),
  finishOfficialSetup: procedure.mutation(({ ctx }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.finishOfficialSetup) throw new Error('Official extension selection is unavailable')
    return manager.finishOfficialSetup()
  }),
  previewRemoteChange: procedure.input(pkg.extend({ ref: z.string().optional(), rollback: z.boolean().optional() })).mutation(({ ctx, input }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.previewRemoteChange) throw new Error('Remote extension replacement is unavailable')
    return manager.previewRemoteChange(input)
  }),
  checkRemoteUpdate: procedure.input(pkg).query(({ ctx, input }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.checkRemoteUpdate) throw new Error('Remote extension updates are unavailable')
    return manager.checkRemoteUpdate(input.packageId)
  }),
  commitRemoteInstall: procedure.input(z.object({ token: z.string() })).mutation(async ({ ctx, input }) => {
    const manager = requireExtensionManager(ctx)
    if (!manager.commitRemoteInstall) throw new Error('Remote extension installation is unavailable')
    const result = await manager.commitRemoteInstall(input.token)
    emitExtensionsChanged(ctx, { action: 'installed' })
    return result
  }),
  uninstallPackage: procedure.input(pkg.extend({ version: z.string().optional(), deleteData: z.boolean().optional(), target: target.optional() })).mutation(async ({ ctx, input }) => {
    if (input.target?.kind === 'card') throw new Error('Use extensions.uninstallCardPackage for a Card installation')
    const extensionPackage = await requireExtensionManager(ctx).uninstallPackage(input.packageId, input.version, input.deleteData === true)
    emitExtensionsChanged(ctx, {
      packageId: input.packageId,
      ...(input.version ? { version: input.version } : {}),
      action: 'uninstalled',
    })
    return { package: extensionPackage }
  }),
  enableModule: procedure.input(moduleInput.extend({ grants: capabilityGrants.optional() })).mutation(async ({ ctx, input }) => {
    const module = await requireExtensionManager(ctx).enableModule(input.packageId, input.moduleId, toCapabilityGrants(input.grants), input.target)
    emitExtensionsChanged(ctx, { packageId: input.packageId, moduleId: input.moduleId, ...(input.target ? { target: input.target } : {}), action: 'enabled' })
    return { module }
  }),
  disableModule: procedure.input(moduleInput).mutation(async ({ ctx, input }) => {
    const module = await requireExtensionManager(ctx).disableModule(input.packageId, input.moduleId, input.target)
    emitExtensionsChanged(ctx, { packageId: input.packageId, moduleId: input.moduleId, ...(input.target ? { target: input.target } : {}), action: 'disabled' })
    return { module }
  }),
  reloadModule: procedure.input(moduleInput).mutation(async ({ ctx, input }) => {
    const module = await requireExtensionManager(ctx).reloadModule(input.packageId, input.moduleId, input.target)
    emitExtensionsChanged(ctx, { packageId: input.packageId, moduleId: input.moduleId, ...(input.target ? { target: input.target } : {}), action: 'reloaded' })
    return { module }
  }),
  importPackageResources: procedure.input(globalPackage).mutation(({ ctx, input }) => requireExtensionManager(ctx).importPackageResources(input.packageId)),
  removePackageResources: procedure.input(globalPackage).mutation(({ ctx, input }) => requireExtensionManager(ctx).removePackageResources(input.packageId)),
  updatePackageResources: procedure.input(globalPackage.extend({ packageVersion: z.string(), expectedInstallationVersion: version, expectedPreviewFingerprint: z.string().min(1).optional(), keepPromptResourceIds: z.array(z.string().min(1)).max(1000).optional() })).mutation(({ ctx, input }) => requireExtensionManager(ctx).updatePackageResources(input)),
  listCharacters: procedure.input(pkg).query(({ ctx, input }) => requireCharacterCatalog(ctx).list(input.packageId)),
  previewCharacter: procedure.input(pkg.extend({ characterId: z.string().min(1) })).query(({ ctx, input }) => requireCharacterCatalog(ctx).preview(input.packageId, input.characterId)),
  importCharacter: procedure.input(pkg.extend({ characterId: z.string().min(1), digest: z.string().min(1), allowDuplicate: z.boolean().optional() })).mutation(({ ctx, input }) => {
    if (!ctx.request.clientId) throw new Error('Character import requires a client session')
    return requireCharacterCatalog(ctx).import(input, ctx.request.clientId)
  }),
  exportPackage: procedure.input(pkg.extend({ version: z.string() })).query(({ ctx, input }) => requireExtensionManager(ctx).exportPackage(input)),
  invoke: procedure.input(pkg.extend({ target: target.optional(), method: z.string(), params: z.json().optional() })).mutation(({ ctx, input }) => {
    if (!input.method.startsWith(`${input.packageId}.`)) throw new Error('Client extension RPC must use its package namespace')
    return ctx.services.kernel.callRpc(input.method, input.params, {
      ...rpcCallContext(ctx),
      extensionTarget: input.target ?? { kind: 'global' },
      expectedExtensionPackageId: input.packageId,
    })
  }),
  importCardPackageResources: procedure.input(installCard).mutation(({ ctx, input }) => requireExtensionManager(ctx).importCardPackageResources(input)),
  updateCardPackageResources: procedure.input(updateCard).mutation(({ ctx, input }) => requireExtensionManager(ctx).importCardPackageResources({
    cardId: input.cardId,
    packageId: input.packageId,
    expectedCardVersion: input.expectedCardVersion,
    update: {
      packageVersion: input.packageVersion,
      expectedInstallationVersion: input.expectedInstallationVersion,
      expectedPreviewFingerprint: input.expectedPreviewFingerprint,
      keepPromptResourceIds: input.keepPromptResourceIds,
    },
  })),
  removeCardPackageResources: procedure.input(removeCard).mutation(({ ctx, input }) => requireExtensionManager(ctx).removeCardPackageResources(input)),
  getDiagnostics: procedure.input(z.object({ packageId: z.string().optional(), moduleId: z.string().optional() }).optional()).query(({ ctx, input }) => ({
    diagnostics: requireExtensionHost(ctx).diagnostics(input?.packageId, input?.moduleId),
  })),
})

export const platformRouters = {
  system: t.router({
    ping: procedure.input(z.object({ echo: z.json().optional() }).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'system.ping', input)),
    introspect: procedure.input(z.object({ includeDiagnostics: z.boolean().optional() }).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'system.introspect', input)),
  }),
  diagnostics: t.router({
    list: procedure.input(z.record(z.string(), z.json()).optional()).query(({ ctx, input }) => {
      if (!ctx.services.diagnostics) throw new Error('Diagnostics registry is not configured')
      return { items: ctx.services.diagnostics.list(input as DiagnosticFilter | undefined) }
    }),
  }),
}
