import type { RuntimeRequestContext } from '../types.js'
import type { ObservationOrigin } from './types.js'

export function observationOrigin(context?: RuntimeRequestContext): ObservationOrigin {
  return {
    ...(context?.actor ? { actor: `${context.actor.kind}:${context.actor.id}` } : context?.clientId ? { actor: `client:${context.clientId}` } : {}),
    ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context?.callId ? { callId: context.callId } : {}),
    ...(context?.parentCallId ? { parentCallId: context.parentCallId } : {}),
    ...(context?.agentRun?.continuation ? { sourceRunId: context.agentRun.continuation.sourceRunId } : {}),
    ...context?.observationOrigin,
  }
}
