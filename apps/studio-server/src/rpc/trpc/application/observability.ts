import { z } from 'zod'
import { procedure } from '../context.js'

const identity = z.object({ id: z.string().min(1).max(512) })
export const observabilityProcedures = {
  'observations.references': procedure.input(z.object({ references: z.array(z.object({ type: z.enum(['card', 'timeline', 'session', 'resource', 'provider', 'run']), id: z.string().min(1).max(512) })).max(100) })).query(({ ctx, input }) => ctx.runtime.getObservationReferences(input)),
  'observations.persistence': procedure.query(({ ctx }) => ctx.runtime.getObservationPersistence()),
  'observations.setPersistence': procedure.input(z.object({ enabled: z.boolean() })).mutation(({ ctx, input }) => ctx.runtime.setObservationPersistence(input)),
  'observations.list': procedure.input(z.object({
    kind: z.enum(['run', 'build', 'api']).optional(),
    status: z.enum(['running', 'completed', 'failed', 'aborted', 'suspended']).optional(),
    agentSessionId: z.string().optional(), timelineId: z.string().optional(),
    cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).optional(),
  }).optional()).query(({ ctx, input }) => ctx.runtime.listObservations(input)),
  'observations.get': procedure.input(identity).query(({ ctx, input }) => ctx.runtime.getObservation(input)),
  'observations.getRequest': procedure.input(identity).query(({ ctx, input }) => ctx.runtime.getObservationRequest(input)),
  'observations.getBuild': procedure.input(identity).query(({ ctx, input }) => ctx.runtime.getObservationBuild(input)),
}
