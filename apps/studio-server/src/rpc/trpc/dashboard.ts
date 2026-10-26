import { z } from 'zod'
import { t, serviceProcedure } from './context.js'

const range = z.object({
  from: z.iso.datetime().optional(), to: z.iso.datetime(),
  timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Invalid time zone'),
  includeSimulated: z.boolean().optional(),
}).refine(value => !value.from || value.from < value.to, 'Invalid time range')
const dashboard = serviceProcedure.use(({ ctx, next }) => {
  if (!ctx.services.dashboard) throw new Error('Dashboard statistics unavailable')
  return next({ ctx: { ...ctx, dashboard: ctx.services.dashboard } })
})
export const dashboardRouter = t.router({
  usage: dashboard.input(range).query(({ ctx, input }) => ctx.dashboard.statistics.usage(input)),
  usageRequests: dashboard.input(range.safeExtend({ providerProfileId: z.string().min(1), limit: z.number().int().min(1).max(100).default(30), cursor: z.object({ startedAt: z.iso.datetime(), id: z.string().min(1) }).optional() })).query(({ ctx, input }) => ctx.dashboard.statistics.usageRequests(input)),
  play: dashboard.input(range).query(({ ctx, input }) => ctx.dashboard.statistics.play(input)),
  resources: dashboard.query(({ ctx }) => ctx.dashboard.statistics.resources()),
  storage: dashboard.input(z.object({ refresh: z.boolean().optional() })).query(({ ctx, input }) => ctx.dashboard.storage(input.refresh)),
  database: dashboard.query(({ ctx }) => ctx.dashboard.database()),
})
