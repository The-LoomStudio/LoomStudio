import type { NarrativeNode, NarrativeStore } from '@loom-studio/application-data'
import type { ExtensionInstallationTarget, NarrativeContextProjection, NarrativeContextProvider } from '@loom-studio/extension-sdk'
import { createNarrativeSampler } from './sampling.js'

export type ResolvedNarrativeContext = NarrativeContextProjection & { sourceId: string }
export type NarrativeContextRegistry = {
  register(provider: NarrativeContextProvider, target?: ExtensionInstallationTarget): { dispose(): void }
  resolve(context: { timelineId: string; branchId: string; cardId?: string }): Promise<ResolvedNarrativeContext | undefined>
  notifySessionHandoff(context: Parameters<NonNullable<NarrativeContextProvider['onSessionHandoff']>>[0] & { cardId?: string }): Promise<'notified' | 'not-configured'>
}

export function createNarrativeContextRegistry(): NarrativeContextRegistry {
  const providers = new Map<string, NarrativeContextProvider & { target: ExtensionInstallationTarget }>()
  const registry: NarrativeContextRegistry = {
    register(provider, target = { kind: 'global' }) {
      if (!provider.id.trim() || typeof provider.resolve !== 'function') throw new Error('Invalid Narrative context provider')
      if (providers.has(provider.id)) throw new Error(`Narrative context provider already registered: ${provider.id}`)
      const registered = { ...provider, target: structuredClone(target) }
      providers.set(provider.id, registered)
      return { dispose() { if (providers.get(provider.id) === registered) providers.delete(provider.id) } }
    },
    async resolve(context) {
      let result: ResolvedNarrativeContext | undefined
      const available = [...providers.values()].filter(provider => provider.target.kind === 'global' || provider.target.cardId === context.cardId)
      for (const provider of available) {
        const projection = await provider.resolve(Object.freeze({ ...context }))
        if (projection === undefined) continue
        validateProjection(projection)
        if (result) throw new Error(`Conflicting Narrative context providers: ${result.sourceId}, ${provider.id}`)
        result = { ...structuredClone(projection), sourceId: provider.id }
      }
      if (!result && available.length > 0) {
        throw new Error(`No Narrative context source selected for branch: ${context.branchId}`)
      }
      return result
    },
    async notifySessionHandoff(context) {
      const selected = await registry.resolve({ timelineId: context.timelineId, branchId: context.branchId, cardId: context.cardId })
      const provider = selected && providers.get(selected.sourceId)
      if (!provider?.onSessionHandoff) return 'not-configured'
      await provider.onSessionHandoff(Object.freeze({ ...context }))
      return 'notified'
    },
  }
  return registry
}

export async function readNarrativeContext(
  store: NarrativeStore,
  scope: { timelineId: string; branchId: string },
  projection: ResolvedNarrativeContext,
): Promise<NarrativeNode[]> {
  const coveredThroughNodeId = projection.memory?.coveredThroughNodeId
  if (projection.rawThroughNodeId === null) {
    // A memory-only view must still belong to the requested branch.
    if (coveredThroughNodeId) {
      await store.getPage({ ...scope, cursor: coveredThroughNodeId, limit: 1 })
    }
    return []
  }
  const sample = await createNarrativeSampler(store).sample({
    ...scope,
    selection: {
      kind: 'range',
      ...(coveredThroughNodeId ? { afterNodeId: coveredThroughNodeId } : {}),
      throughNodeId: projection.rawThroughNodeId,
    },
  })
  if (!sample.complete) throw new Error('Published Narrative context exceeds the sample budget; the memory source must publish a smaller view')
  return sample.nodes
}

function validateProjection(value: NarrativeContextProjection): void {
  const nonempty = (text: unknown): text is string => typeof text === 'string' && text.trim().length > 0
  if (!value || !nonempty(value.version)) throw new Error('Narrative context version is required')
  if (value.rawThroughNodeId !== null && !nonempty(value.rawThroughNodeId)) {
    throw new Error('Narrative context requires an explicit Raw endpoint or null')
  }
  if (value.memory === null) return
  if (!value.memory || !nonempty(value.memory.coveredThroughNodeId)
    || !Array.isArray(value.memory.entries) || value.memory.entries.length === 0) {
    throw new Error('Narrative memory requires coverage and nonempty entries')
  }
  const ids = new Set<string>()
  for (const entry of value.memory.entries) {
    if (!entry || !nonempty(entry.id) || !nonempty(entry.content) || ids.has(entry.id)) {
      throw new Error('Narrative memory entries require unique IDs and nonempty content')
    }
    ids.add(entry.id)
  }
}
