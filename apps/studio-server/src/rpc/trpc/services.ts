import { readLogQuery, type LogQuery } from '@loom-studio/logging'
import { z } from 'zod'
import { retainAiGatewayRun, requireAiGatewayRun } from './ai-operations.js'
import { jsonInput, serviceProcedure as procedure, t } from './context.js'

const confirmedContent = z.object({ packageId: z.string(), digest: z.string() })
const card = z.object({ cardId: z.string() })
const directory = z.object({ directory: z.string() })

export const officialRouter = t.router({
  listContent: procedure.query(({ ctx }) => {
    if (!ctx.services.officialContent) throw new Error('Official content unavailable')
    return ctx.services.officialContent.listContent()
  }),
  installContent: procedure.input(confirmedContent).mutation(({ ctx, input }) => {
    if (!ctx.services.officialContent) throw new Error('Official content unavailable')
    return ctx.services.officialContent.installContent(input, ctx.request)
  }),
  exportContent: procedure.input(confirmedContent).query(({ ctx, input }) => {
    if (!ctx.services.officialContent) throw new Error('Official content unavailable')
    return ctx.services.officialContent.exportContent(input)
  }),
})
export const settingsRouter = t.router({
  network: t.router({
    get: procedure.query(({ ctx }) => {
      if (!ctx.services.networkSettings) throw new Error('Network settings unavailable')
      return ctx.services.networkSettings.get()
    }),
    update: procedure.input(z.object({ proxyMode: z.enum(['system', 'direct', 'manual']), proxyUrl: z.string().optional() })).mutation(({ ctx, input }) => {
      if (!ctx.services.networkSettings) throw new Error('Network settings unavailable')
      return ctx.services.networkSettings.update(input)
    }),
  })
})
export const logsRouter = t.router({
  list: procedure.input(jsonInput((params): Omit<LogQuery, 'limit'> & { limit?: number } => readLogQuery(params))).query(({ ctx, input }) => {
    if (!ctx.services.logs) throw new Error('Logs unavailable')
    return ctx.services.logs.query(readLogQuery(input))
  }),
  history: procedure.input(jsonInput((params): Omit<LogQuery, 'limit'> & { limit?: number } => readLogQuery(params))).query(({ ctx, input }) => {
    if (!ctx.services.logHistory) throw new Error('History logs are not available')
    if (!input.since || !input.until) throw new Error('History queries require since and until')
    return ctx.services.logHistory.query({ ...readLogQuery(input), since: input.since, until: input.until }, ctx.request.abortSignal)
  }),
})
export const directoriesRouter = t.router({
  list: procedure.query(async ({ ctx }) => {
    await ctx.services.startupDirectoryScan
    if (!ctx.services.directoryCatalog) throw new Error('Directory catalog unavailable')
    return ctx.services.directoryCatalog.list()
  }),
  scan: procedure.query(({ ctx }) => {
    if (!ctx.services.directoryCatalog) throw new Error('Directory catalog unavailable')
    return ctx.services.directoryCatalog.scan()
  }),
  open: procedure.input(directory).query(({ ctx, input }) => {
    if (!ctx.services.directoryCatalog) throw new Error('Directory catalog unavailable')
    return ctx.services.directoryCatalog.open(input.directory)
  }),
  attachment: procedure.input(directory.extend({ path: z.string() })).query(({ ctx, input }) => {
    if (!ctx.services.directoryCatalog) throw new Error('Directory catalog unavailable')
    return ctx.services.directoryCatalog.attachment(input.directory, input.path)
  }),
  import: procedure.input(directory.extend({ token: z.string() })).mutation(async ({ ctx, input }) => {
    if (!ctx.services.directoryImporter || !ctx.services.directoryCatalog) throw new Error('Directory importer unavailable')
    const result = await ctx.services.directoryImporter.importDirectory(input.directory, input.token, ctx.request.clientId!)
    await ctx.services.directoryCatalog.scan()
    return result
  }),
  previewApply: procedure.input(card).query(({ ctx, input }) => {
    if (!ctx.services.directoryResources) throw new Error('Card directory saving requires the Asset Store')
    return ctx.services.directoryResources.previewApply(input.cardId)
  }),
  applyChanges: procedure.input(card.extend({ token: z.string() })).mutation(({ ctx, input }) => {
    if (!ctx.services.directoryResources) throw new Error('Card directory saving requires the Asset Store')
    return ctx.services.directoryResources.apply(input.cardId, input.token, ctx.request)
  }),
  previewCard: procedure.input(card).query(({ ctx, input }) => {
    if (!ctx.services.directoryResources) throw new Error('Card directory saving requires the Asset Store')
    return ctx.services.directoryResources.previewCard(input.cardId)
  }),
  saveCard: procedure.input(card.extend({ token: z.string() })).mutation(({ ctx, input }) => {
    if (!ctx.services.directoryResources) throw new Error('Card directory saving requires the Asset Store')
    return ctx.services.directoryResources.saveCard(input.cardId, input.token)
  }),
  recoverCard: procedure.input(card).mutation(({ ctx, input }) => {
    if (!ctx.services.directoryResources) throw new Error('Card directory saving requires the Asset Store')
    return ctx.services.directoryResources.recoverCard(input.cardId)
  }),
})

const aiProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.services.aiCapabilities || !ctx.services.aiGateway) throw new Error('AI Gateway unavailable')
  return next({ ctx: { ...ctx, ai: { registry: ctx.services.aiCapabilities, gateway: ctx.services.aiGateway } } })
})
const aiInput = z.object({ profileId: z.string(), input: z.json() })
const runInput = z.object({ runId: z.string() })
export const aiRouter = t.router({
  providers: t.router({ list: aiProcedure.query(({ ctx }) => ({ providers: ctx.ai.registry.list() })) }),
  invoke: aiProcedure.input(aiInput).mutation(({ ctx, input }) => ctx.ai.gateway.invoke({ ...input, caller: { kind: 'studio-client' } })),
  run: t.router({
    create: aiProcedure.input(aiInput).mutation(({ ctx, input }) => {
      const run = ctx.ai.gateway.createRun({ ...input, caller: { kind: 'studio-client' } })
      retainAiGatewayRun(ctx.ai.gateway, run)
      return { runId: run.id }
    }),
    subscribe: aiProcedure.input(runInput.extend({ cursor: z.number().int().nonnegative().optional() })).query(({ ctx, input }) => {
      const run = requireAiGatewayRun(ctx.ai.gateway, input.runId)
      return { ...run.readEvents(input.cursor ?? 0), state: run.getState() }
    }),
    cancel: aiProcedure.input(runInput.extend({ reason: z.string().optional() })).mutation(({ ctx, input }) => {
      const run = requireAiGatewayRun(ctx.ai.gateway, input.runId)
      run.cancel(input.reason)
      return { runId: run.id, state: run.getState() }
    }),
    state: aiProcedure.input(runInput).query(({ ctx, input }) => {
      const run = requireAiGatewayRun(ctx.ai.gateway, input.runId)
      return { runId: run.id, state: run.getState() }
    }),
  }),
})
