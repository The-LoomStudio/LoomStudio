import type { JsonObject, JsonValue } from '@loom-studio/shared'

const SENSITIVE_KEY_PATTERN = /^(?:api[_-]?key|secret(?:[_-]?value)?|password|token|authorization|credential)$/i

export function formatEntityMention(type: string, id: string, label?: string): string {
  const cleanId = id.trim()
  const cleanLabel = label?.trim()
  if (cleanLabel && cleanLabel !== cleanId) {
    return `<@${type}:${cleanId}|${cleanLabel}>`
  }
  return `<@${type}:${cleanId}>`
}

export function sanitizeRpcParams(params: unknown): unknown {
  if (params === null || params === undefined) return params
  if (typeof params !== 'object') return params

  if (Array.isArray(params)) {
    return params.map(item => sanitizeRpcParams(item))
  }

  const record = params as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '***'
    } else if (typeof value === 'string' && value.length > 500) {
      result[key] = `${value.slice(0, 200)}... (${value.length} chars)`
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeRpcParams(value)
    } else {
      result[key] = value
    }
  }
  return result
}

function cleanJson(obj: unknown): JsonValue {
  if (obj === null || obj === undefined) return null
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj
  if (Array.isArray(obj)) return obj.map(cleanJson)
  if (typeof obj === 'object') {
    const result: JsonObject = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = cleanJson(value)
      }
    }
    return result
  }
  return String(obj)
}

function cleanJsonObject(obj: Record<string, unknown>): JsonObject {
  return cleanJson(obj) as JsonObject
}

export type RpcSummary = {
  textSuffix?: string
  summaryData?: JsonObject
}

export function summarizeRpc(method: string, _params: unknown, result: unknown): RpcSummary {
  if (!result || typeof result !== 'object') {
    return {}
  }

  const res = result as Record<string, unknown>

  // 1. Agent Profiles
  if (method === 'application.listAgentProfiles' && Array.isArray(res.profiles)) {
    const profiles = res.profiles as Array<{ id?: string; name?: string }>
    const mentions = profiles.slice(0, 5).map(p => formatEntityMention('agent', p.id || 'unknown', p.name))
    const extra = profiles.length > 5 ? `, +${profiles.length - 5} more` : ''
    return {
      textSuffix: `${profiles.length} profiles: [${mentions.join(', ')}${extra}]`,
      summaryData: cleanJsonObject({
        itemCount: profiles.length,
        agentProfiles: profiles.map(p => ({ id: p.id, name: p.name })),
      }),
    }
  }
  if ((method === 'application.createAgentProfile' || method === 'application.getAgentProfile' || method === 'application.updateAgentProfile') && res.profile && typeof res.profile === 'object') {
    const p = res.profile as { id?: string; name?: string }
    const mention = formatEntityMention('agent', p.id || 'unknown', p.name)
    return {
      textSuffix: mention,
      summaryData: cleanJsonObject({ profileId: p.id, name: p.name }),
    }
  }

  // 2. Cards
  if (method === 'application.listCards' && Array.isArray(res.cards)) {
    const cards = res.cards as Array<{ id?: string; name?: string }>
    const mentions = cards.slice(0, 5).map(c => formatEntityMention('card', c.id || 'unknown', c.name))
    const extra = cards.length > 5 ? `, +${cards.length - 5} more` : ''
    return {
      textSuffix: `${cards.length} cards: [${mentions.join(', ')}${extra}]`,
      summaryData: cleanJsonObject({
        itemCount: cards.length,
        cards: cards.map(c => ({ id: c.id, name: c.name })),
      }),
    }
  }
  if ((method === 'application.createCard' || method === 'application.getCard' || method === 'application.updateCard') && res.card && typeof res.card === 'object') {
    const c = res.card as { id?: string; name?: string }
    const mention = formatEntityMention('card', c.id || 'unknown', c.name)
    return {
      textSuffix: mention,
      summaryData: cleanJsonObject({ cardId: c.id, name: c.name }),
    }
  }

  // 3. Prompt Resources
  if (method === 'application.listPromptResources' && Array.isArray(res.resources)) {
    const resources = res.resources as Array<{ id?: string; name?: string; resourceKind?: string }>
    const mentions = resources.slice(0, 5).map(r => formatEntityMention('resource', r.id || 'unknown', r.name))
    const extra = resources.length > 5 ? `, +${resources.length - 5} more` : ''
    return {
      textSuffix: `${resources.length} resources: [${mentions.join(', ')}${extra}]`,
      summaryData: cleanJsonObject({
        itemCount: resources.length,
        resources: resources.map(r => ({ id: r.id, name: r.name, kind: r.resourceKind })),
      }),
    }
  }
  if ((method === 'application.createPromptResource' || method === 'application.getPromptResource' || method === 'application.updatePromptResource') && res.resource && typeof res.resource === 'object') {
    const r = res.resource as { id?: string; name?: string; resourceKind?: string }
    const mention = formatEntityMention('resource', r.id || 'unknown', r.name)
    return {
      textSuffix: mention,
      summaryData: cleanJsonObject({ resourceId: r.id, name: r.name, kind: r.resourceKind }),
    }
  }

  // 4. Narrative Timelines
  if (method === 'application.listNarrativeTimelines' && Array.isArray(res.timelines)) {
    const timelines = res.timelines as Array<{ id?: string; cardId?: string }>
    const mentions = timelines.slice(0, 5).map(t => formatEntityMention('timeline', t.id || 'unknown'))
    const extra = timelines.length > 5 ? `, +${timelines.length - 5} more` : ''
    return {
      textSuffix: `${timelines.length} timelines: [${mentions.join(', ')}${extra}]`,
      summaryData: cleanJsonObject({
        itemCount: timelines.length,
        timelineIds: timelines.map(t => t.id),
      }),
    }
  }
  if ((method === 'application.createNarrativeTimeline' || method === 'application.getNarrativeTimeline') && res.timeline && typeof res.timeline === 'object') {
    const t = res.timeline as { id?: string; cardId?: string }
    const tMention = formatEntityMention('timeline', t.id || 'unknown')
    const cMention = t.cardId ? ` for ${formatEntityMention('card', t.cardId)}` : ''
    return {
      textSuffix: `${tMention}${cMention}`,
      summaryData: cleanJsonObject({ timelineId: t.id, cardId: t.cardId }),
    }
  }

  // 5. Provider Profiles & Models
  if (method === 'application.listProviderProfiles' && Array.isArray(res.providerProfiles)) {
    const providers = res.providerProfiles as Array<{ id?: string; displayName?: string; providerExtensionId?: string }>
    const mentions = providers.map(p => formatEntityMention('provider', p.id || 'unknown', p.displayName))
    return {
      textSuffix: `${providers.length} providers: [${mentions.join(', ')}]`,
      summaryData: cleanJsonObject({
        itemCount: providers.length,
        providers: providers.map(p => ({ id: p.id, name: p.displayName })),
      }),
    }
  }
  if ((method === 'application.createProviderProfile' || method === 'application.getProviderProfile' || method === 'application.updateProviderProfile') && res.providerProfile && typeof res.providerProfile === 'object') {
    const p = res.providerProfile as { id?: string; displayName?: string }
    const mention = formatEntityMention('provider', p.id || 'unknown', p.displayName)
    return {
      textSuffix: mention,
      summaryData: cleanJsonObject({ providerId: p.id, displayName: p.displayName }),
    }
  }
  if (method === 'application.listProviderModels' && Array.isArray(res.modelIds)) {
    const modelIds = res.modelIds as string[]
    const mentions = modelIds.slice(0, 5).map(m => formatEntityMention('model', m))
    const extra = modelIds.length > 5 ? `, +${modelIds.length - 5} more` : ''
    return {
      textSuffix: `${modelIds.length} models: [${mentions.join(', ')}${extra}]`,
      summaryData: cleanJsonObject({ itemCount: modelIds.length, models: modelIds }),
    }
  }

  // 6. Agent Turn Invocation
  if (method === 'application.invokeAgentTurn') {
    const model = typeof res.model === 'string' ? formatEntityMention('model', res.model) : undefined
    const usage = res.usage as { inputTokens?: number; outputTokens?: number } | undefined
    const tokenInfo = usage ? ` (${(usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)} tokens)` : ''
    const parts = [model, tokenInfo].filter(Boolean)
    return {
      textSuffix: parts.length > 0 ? parts.join(' ') : 'turn completed',
      summaryData: cleanJsonObject({
        model: res.model,
        finishReason: res.finishReason,
        usage,
      }),
    }
  }

  // 7. Pages & Nodes (getNarrativePage / getAgentTranscriptPage)
  if (Array.isArray(res.nodes) || Array.isArray(res.items)) {
    const list = (res.nodes ?? res.items) as unknown[]
    return {
      textSuffix: `${list.length} entries (nextCursor: ${res.nextCursor ? 'yes' : 'none'})`,
      summaryData: cleanJsonObject({ itemCount: list.length, hasMore: Boolean(res.nextCursor) }),
    }
  }

  // 8. Mutations / Changesets
  const changesetId = (res.mutation && typeof res.mutation === 'object' && (res.mutation as Record<string, unknown>).changesetId) || res.changesetId
  if (typeof changesetId === 'string') {
    return {
      textSuffix: `changeset: ${formatEntityMention('changeset', changesetId)}`,
      summaryData: cleanJsonObject({ changesetId }),
    }
  }

  return {}
}
