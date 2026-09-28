import type { JsonObject } from '@loom-studio/shared'

export type RpcSummary = {
  textSuffix?: string
  summaryData?: JsonObject
}

export function isTechnicalRpc(method: string): boolean {
  return /(?:^|\.)(?:list|get|inspect|preview|resolve|subscribe|state)(?:[A-Z.]|$)/.test(method)
    || method === 'system.ping'
}

export function summarizeRpc(method: string, result: unknown): RpcSummary {
  if (!result || typeof result !== 'object') return {}
  const res = result as Record<string, unknown>
  if (method === 'application.agent.run.create') {
    return {
      textSuffix: 'run accepted',
      summaryData: typeof res.runId === 'string' ? { runId: res.runId } : {},
    }
  }
  if (method === 'application.invokeAgentTurn') {
    const provider = res.provider && typeof res.provider === 'object'
      ? res.provider as Record<string, unknown> : undefined
    return {
      textSuffix: 'turn completed',
      summaryData: {
        ...(typeof res.runId === 'string' ? { runId: res.runId } : {}),
        ...(typeof provider?.model === 'string' ? { model: provider.model } : {}),
      },
    }
  }

  // Lists report counts, never entity names or full result/parameter objects.
  for (const key of ['profiles', 'agentPresets', 'cards', 'resources', 'timelines', 'providerProfiles', 'modelIds', 'nodes', 'items', 'entries', 'events']) {
    if (!Array.isArray(res[key])) continue
    const itemCount = res[key].length
    return { textSuffix: `${itemCount} entries`, summaryData: { itemCount } }
  }
  const mutation = res.mutation && typeof res.mutation === 'object' ? res.mutation as Record<string, unknown> : undefined
  const changesetId = mutation?.changesetId ?? res.changesetId
  if (typeof changesetId === 'string') {
    return { textSuffix: 'changes committed', summaryData: { changesetId } }
  }
  return {}
}
