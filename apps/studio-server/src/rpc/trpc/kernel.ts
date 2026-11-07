import type { BuiltinHandlers } from '@loom-studio/kernel'
import type { JsonValue } from '@loom-studio/shared'
import { z } from 'zod'
import { serviceProcedure as procedure, t, type StudioTrpcContext } from './context.js'

// Types come from the actual internal handlers. Keep Kernel dispatch for its
// tracing and extension installation checks; callers cannot choose the output.
function callBuiltin<M extends keyof BuiltinHandlers>(ctx: StudioTrpcContext & { services: NonNullable<StudioTrpcContext['services']> }, method: M, input?: JsonValue): Promise<Awaited<ReturnType<BuiltinHandlers[M]>>> {
  return ctx.services.kernel.callRpc<Awaited<ReturnType<BuiltinHandlers[M]>>>(method, input, {
    clientId: ctx.request.clientId!, correlationId: ctx.request.correlationId!, callId: ctx.request.callId!, parentCallId: ctx.request.parentCallId,
  })
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
export const extensionsRouter = t.router({
  listRecoveryRecords: procedure.query(({ ctx }) => callBuiltin(ctx, 'extensions.listRecoveryRecords')),
  listModuleBatches: procedure.query(({ ctx }) => callBuiltin(ctx, 'extensions.listModuleBatches')),
  getModuleBatch: procedure.input(z.object({ batchId: z.string().min(1) })).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.getModuleBatch', input)),
  startModuleBatch: procedure.input(pkg.extend({ target: target.optional(), enabled: z.boolean(), modules: z.array(z.object({ moduleId: z.string().min(1), grants: capabilityGrants.optional() })).max(100) })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.startModuleBatch', input)),
  previewPackageResources: procedure.input(pkg.extend({ packageVersion: z.string(), expectedInstallationVersion: version, target: target.optional(), expectedCardVersion: version.optional() })).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.previewPackageResources', input)),
  importConvertedBatch: procedure.input(pkg.extend({ target, sessionId: z.string().min(1) }).strict()).mutation(({ ctx, input }) => {
    if (!ctx.services.batchImporter) throw new Error('Batch import service unavailable')
    return ctx.services.batchImporter.commit(input, ctx.request)
  }),
  listPackages: procedure.input(z.object({ target: target.optional() }).optional()).query(async ({ ctx, input }) => {
    const result = await callBuiltin(ctx, 'extensions.listPackages', input)
    return {
      items: result.items.map(item => {
        if (!('modules' in item)) throw new Error('Package management is not configured')
        return item
      })
    }
  }),
  installCardPackage: procedure.input(installCard).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.installCardPackage', input)),
  updateCardPackage: procedure.input(updateCard).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.updateCardPackage', input)),
  uninstallCardPackage: procedure.input(removeCard).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.uninstallCardPackage', input)),
  installPackage: procedure.input(z.object({ sourceDirectory: z.string() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.installPackage', input)),
  installPackageZip: procedure.input(z.object({ base64: z.string() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.installPackageZip', input)),
  previewRemoteInstall: procedure.input(z.object({ sources: z.array(source) })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.previewRemoteInstall', input)),
  previewPackageZip: procedure.input(z.object({ base64: z.string() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.previewPackageZip', input)),
  officialSetup: procedure.query(({ ctx }) => callBuiltin(ctx, 'extensions.officialSetup')),
  finishOfficialSetup: procedure.mutation(({ ctx }) => callBuiltin(ctx, 'extensions.finishOfficialSetup')),
  previewRemoteChange: procedure.input(pkg.extend({ ref: z.string().optional(), rollback: z.boolean().optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.previewRemoteChange', input)),
  checkRemoteUpdate: procedure.input(pkg).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.checkRemoteUpdate', input)),
  commitRemoteInstall: procedure.input(z.object({ token: z.string() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.commitRemoteInstall', input)),
  uninstallPackage: procedure.input(pkg.extend({ version: z.string().optional(), deleteData: z.boolean().optional(), target: target.optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.uninstallPackage', input)),
  enableModule: procedure.input(moduleInput.extend({ grants: capabilityGrants.optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.enableModule', input)),
  disableModule: procedure.input(moduleInput).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.disableModule', input)),
  reloadModule: procedure.input(moduleInput).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.reloadModule', input)),
  importPackageResources: procedure.input(globalPackage).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.importPackageResources', input)),
  removePackageResources: procedure.input(globalPackage).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.removePackageResources', input)),
  updatePackageResources: procedure.input(globalPackage.extend({ packageVersion: z.string(), expectedInstallationVersion: version, expectedPreviewFingerprint: z.string().min(1).optional(), keepPromptResourceIds: z.array(z.string().min(1)).max(1000).optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.updatePackageResources', input)),
  listCharacters: procedure.input(pkg).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.listCharacters', input)),
  previewCharacter: procedure.input(pkg.extend({ characterId: z.string().min(1) })).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.previewCharacter', input)),
  importCharacter: procedure.input(pkg.extend({ characterId: z.string().min(1), digest: z.string().min(1), allowDuplicate: z.boolean().optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.importCharacter', input)),
  exportPackage: procedure.input(pkg.extend({ version: z.string() })).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.exportPackage', input)),
  callPackageRpc: procedure.input(pkg.extend({ method: z.string(), target, params: z.json().optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.callPackageRpc', input)),
  importCardPackageResources: procedure.input(installCard).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.importCardPackageResources', input)),
  updateCardPackageResources: procedure.input(updateCard).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.updateCardPackageResources', input)),
  removeCardPackageResources: procedure.input(removeCard).mutation(({ ctx, input }) => callBuiltin(ctx, 'extensions.removeCardPackageResources', input)),
  getDiagnostics: procedure.input(z.object({ packageId: z.string().optional(), moduleId: z.string().optional() }).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'extensions.getDiagnostics', input)),
})
export const kernelRouter = t.router({
  invoke: procedure.input(z.object({ method: z.string(), params: z.json().optional() })).mutation(({ ctx, input }) => {
    // Only dynamically registered extension methods use the generic gateway.
    // Static platform namespaces have concrete procedures and must not bypass them.
    if (['application', 'official', 'directories', 'settings', 'logs', 'ai', 'system', 'docs', 'extensions', 'diagnostics', 'events'].includes(input.method.split('.')[0]!)) throw new Error('Use the typed platform procedure')
    return ctx.services.kernel.callRpc(input.method, input.params, { clientId: ctx.request.clientId!, correlationId: ctx.request.correlationId!, callId: ctx.request.callId!, parentCallId: ctx.request.parentCallId })
  }),
})

export const platformRouters = {
  system: t.router({
    ping: procedure.input(z.object({ echo: z.json().optional() }).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'system.ping', input)),
    introspect: procedure.input(z.object({ includeDiagnostics: z.boolean().optional() }).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'system.introspect', input)),
  }),
  docs: t.router({
    get: procedure.input(z.object({ id: z.string(), includeTombstone: z.boolean().optional(), version: z.number().optional() })).query(({ ctx, input }) => callBuiltin(ctx, 'docs.get', input)),
    list: procedure.input(z.object({ type: z.string().optional(), cursor: z.string().optional(), limit: z.number().optional(), includeTombstone: z.boolean().optional() }).catchall(z.json()).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'docs.list', input)),
    getChangeset: procedure.input(z.object({ changesetId: z.string() })).query(({ ctx, input }) => callBuiltin(ctx, 'docs.getChangeset', input)),
    write: procedure.input(z.object({ id: z.string().optional(), type: z.string(), content: z.json(), expectedVersion: z.union([z.number(), z.literal('new')]).optional(), reason: z.string().optional(), meta: z.record(z.string(), z.json()).optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'docs.write', input)),
    delete: procedure.input(z.object({ id: z.string(), expectedVersion: z.number().optional(), reason: z.string().optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'docs.delete', input)),
    revertChangeset: procedure.input(z.object({ changesetId: z.string(), reason: z.string().optional() })).mutation(({ ctx, input }) => callBuiltin(ctx, 'docs.revertChangeset', input)),
  }),
  diagnostics: t.router({
    list: procedure.input(z.record(z.string(), z.json()).optional()).query(({ ctx, input }) => callBuiltin(ctx, 'diagnostics.list', input)),
  }),
}
