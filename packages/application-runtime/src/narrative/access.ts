import type { NarrativeStore } from '../data/index.js'
import type { ToolApprovalDecision } from '../agents/tool-registry.js'
import type { NarrativeContextRegistry } from './context-provider.js'
import { createNarrativeSampler, defaultNarrativeSampleBudget, type NarrativeSampleRequest, type NarrativeSampleResult } from './sampling.js'

export type NarrativeHistoryReadApproval = {
  kind: 'narrative-history-read'
  timelineId: string
  branchId: string
  selection: NarrativeSampleRequest['selection']
  maxNodes: number
  maxCharacters: number
}

export type ApproveNarrativeHistory = (
  action: NarrativeHistoryReadApproval, signal?: AbortSignal,
) => Promise<ToolApprovalDecision>

export function createNarrativeReader(input: {
  store: NarrativeStore
  context: NarrativeContextRegistry
  timelineId: string
  branchId: string
  cardId?: string
}) {
  const scope = { timelineId: input.timelineId, branchId: input.branchId }
  return {
    async sample(
      request: Omit<NarrativeSampleRequest, 'timelineId' | 'branchId'>,
      signal?: AbortSignal,
      approveHistory?: ApproveNarrativeHistory,
    ): Promise<NarrativeSampleResult> {
      const selected = structuredClone(request)
      signal?.throwIfAborted()
      const published = await input.context.resolve({ ...scope, cardId: input.cardId })
      if (!published) throw Object.assign(new Error('The Timeline and branch are bound, but no default Narrative context source is configured to authorize this read. This is a read-range configuration error, not a missing Timeline or a loss of appendNarrative capability. Do not repeat the same read. Use the context already provided if sufficient; otherwise report the missing read configuration.'), { code: 'narrative.context_unconfigured' })
      const page = await input.store.getPage({ ...scope, limit: 1 })
      signal?.throwIfAborted()
      const throughNodeId = page.branch.headNodeId ?? null
      const boundary = published.memory?.coveredThroughNodeId
      const query = { ...selected, ...scope }
      try {
        return await createNarrativeSampler(input.store, {
          ...scope, throughNodeId, ...(boundary ? { afterNodeId: boundary } : {}),
        }).sample(query, signal)
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'narrative.read_out_of_range') throw error
      }
      if (!approveHistory) {
        throw Object.assign(new Error('Reading old Narrative requires explicit Tools approval'), { code: 'narrative.history_authorization_required' })
      }
      const selection = { ...selected.selection, ...(throughNodeId ? { throughNodeId: selected.selection.throughNodeId ?? throughNodeId } : {}) }
      const action: NarrativeHistoryReadApproval = {
        kind: 'narrative-history-read', ...scope, selection,
        maxNodes: selected.maxNodes ?? defaultNarrativeSampleBudget.maxNodes,
        maxCharacters: selected.maxCharacters ?? defaultNarrativeSampleBudget.maxCharacters,
      }
      signal?.throwIfAborted()
      const decision = await approveHistory(structuredClone(action), signal)
      signal?.throwIfAborted()
      if (decision.decision !== 'allow') {
        throw Object.assign(new Error(decision.decision === 'deny' ? decision.reason ?? 'Narrative history read was denied' : 'Invalid Narrative history approval'), {
          code: 'narrative.history_denied',
        })
      }
      // Approval applies to this exact read only; it never moves the passive baseline or grants future pages.
      return await createNarrativeSampler(input.store, { ...scope, throughNodeId }).sample({
        ...query, selection,
      }, signal)
    },
  }
}
