import type { AgentStore } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { requireAgents } from '../runtime/context.js'

const executingSessions = new WeakMap<object, Set<string>>()

export function getAgentSessionExecutions(agents: AgentStore): Set<string> {
  let executing = executingSessions.get(agents)
  if (!executing) { executing = new Set(); executingSessions.set(agents, executing) }
  return executing
}

export function isAgentSessionExecuting(agents: AgentStore, sessionId: string): boolean {
  return executingSessions.get(agents)?.has(sessionId) ?? false
}

export function assertAgentSessionNotExecuting(ctx: Pick<ApplicationRuntimeContext, 'agents'>, sessionId: string): void {
  if (executingSessions.get(requireAgents(ctx))?.has(sessionId)) throw new Error('Finish the active Agent turn before switching its adopted history')
}
