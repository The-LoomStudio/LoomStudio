import { z } from 'zod'
import { serviceProcedure, t } from './context.js'
const procedure = serviceProcedure.use(({ ctx, next }) => {
  if (!ctx.services.resourceDownloads) throw new Error('Resource downloads are unavailable')
  return next({ ctx: { ...ctx, downloads: ctx.services.resourceDownloads } })
})
const id = z.object({ id: z.string().min(1) })
export const resourceDownloadsRouter = t.router({
  resolve: procedure.input(z.object({ url: z.string().min(1), kind: z.enum(['extension', 'card', 'preset']), ref: z.string().optional(), adapterId: z.string().optional() })).mutation(({ ctx, input }) => ctx.downloads.resolve(input)),
  start: procedure.input(z.object({ candidateId: z.string().min(1) })).mutation(({ ctx, input }) => ctx.downloads.start(input)),
  list: procedure.query(({ ctx }) => ctx.downloads.list()),
  get: procedure.input(id).query(({ ctx, input }) => ctx.downloads.get(input.id)),
  cancel: procedure.input(id).mutation(({ ctx, input }) => ctx.downloads.cancel(input.id)),
  retry: procedure.input(id).mutation(({ ctx, input }) => ctx.downloads.retry(input.id)),
  prepareDependencies: procedure.input(id).mutation(({ ctx, input }) => ctx.downloads.prepareDependencies(input.id)),
  listUpdates: procedure.query(({ ctx }) => ctx.downloads.listUpdates()),
  checkUpdates: procedure.input(z.object({ force: z.boolean().optional() }).optional()).mutation(({ ctx, input }) => ctx.downloads.checkUpdates(input)),
  updatePolicy: procedure.input(z.object({ id: z.string().min(1), prerelease: z.boolean().optional(), fixed: z.boolean().optional() })).mutation(({ ctx, input }) => ctx.downloads.updatePolicy(input)),
  ignore: procedure.input(z.object({ id: z.string(), candidateId: z.string().optional() })).mutation(({ ctx, input }) => ctx.downloads.ignore(input)),
  acknowledge: procedure.input(id).mutation(({ ctx, input }) => ctx.downloads.acknowledge(input.id)),
  previewPromptUpdate: procedure.input(z.object({ id: z.string().min(1), resourceId: z.string().min(1) })).mutation(({ ctx, input }) => {
    if (!ctx.services.resourceDownloadUse) throw new Error('Resource adoption unavailable')
    return ctx.services.resourceDownloadUse.previewPromptUpdate(input)
  }),
  applyPromptUpdate: procedure.input(z.object({ id: z.string().min(1), resourceId: z.string().min(1), expectedVersion: z.number().int().positive(), fingerprint: z.string().min(1), keepLocal: z.boolean().optional() })).mutation(({ ctx, input }) => {
    if (!ctx.services.resourceDownloadUse) throw new Error('Resource adoption unavailable')
    return ctx.services.resourceDownloadUse.applyPromptUpdate(input, ctx.request.clientId!)
  }),
  previewCardUpdate: procedure.input(z.object({ id: z.string(), cardId: z.string() })).mutation(({ ctx, input }) => {
    if (!ctx.services.resourceDownloadUse) throw new Error('Resource adoption unavailable')
    return ctx.services.resourceDownloadUse.previewCardUpdate(input)
  }),
  applyCardUpdate: procedure.input(z.object({ id: z.string(), cardId: z.string(), expectedVersion: z.number().int().positive(), expectedFingerprint: z.string().min(1), keepPromptResourceIds: z.array(z.string()).optional(), keepCardFields: z.array(z.string()).optional(), keepMedia: z.boolean().optional() })).mutation(({ ctx, input }) => {
    if (!ctx.services.resourceDownloadUse) throw new Error('Resource adoption unavailable')
    return ctx.services.resourceDownloadUse.applyCardUpdate(input, ctx.request.clientId!)
  }),
  previewUse: procedure.input(z.object({ id: z.string().min(1), cardId: z.string().min(1).optional() })).mutation(({ ctx, input }) => {
    if (!ctx.services.resourceDownloadUse) throw new Error('Resource adoption unavailable')
    return ctx.services.resourceDownloadUse.preview(input.id, input.cardId)
  }),
  commitUse: procedure.input(z.object({ id: z.string(), token: z.string() })).mutation(({ ctx, input }) => {
    if (!ctx.services.resourceDownloadUse) throw new Error('Resource adoption unavailable')
    return ctx.services.resourceDownloadUse.commit(input.id, input.token, ctx.request.clientId!)
  }),
})
