import type { CardSourceContent, ProviderProfileContent } from '../types.js'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { ObservationEntry, ObservationListInput, ObservationSummary } from '../observability/types.js'
import { observationSummary } from '../observability/store.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'

export function createObservabilityRuntimeMethods(ctx: ApplicationRuntimeContext) {
  async function visible(record: ObservationSummary): Promise<boolean> {
    if (record.agentSessionId) {
      const session = await ctx.agents?.getSession(record.agentSessionId)
      if (!session || session.deletedAt) return false
      if (session.timelineId && !await ctx.narratives?.getTimeline(session.timelineId)) return false
    }
    if (record.timelineId && !await ctx.narratives?.getTimeline(record.timelineId)) return false
    if (record.origin?.installationId) {
      const installation = await ctx.documents.get(record.origin.installationId)
      if (!installation || installation.type !== applicationDocumentTypes.extensionInstallation) return false
    }
    return true
  }
  async function get(id: string): Promise<ObservationEntry | null> {
    const record = ctx.observations.get(id)
    if (!record || !await visible(record)) return null
    if (record.parentId) {
      const parent = ctx.observations.get(record.parentId)
      if (!parent || !await visible(parent)) return null
    }
    return record
  }
  return {
    // Current labels are a read projection, never persisted as historical evidence.
    async getObservationReferences(input: { references: Array<{ type: 'card' | 'timeline' | 'session' | 'resource' | 'provider' | 'run'; id: string }> }) {
      return Promise.all(input.references.map(async reference => {
        let title: string | undefined
        if (reference.type === 'timeline') {
          const timeline = await ctx.narratives?.getTimeline(reference.id)
          if (timeline) title = timeline.title ?? ''
        }
        else if (reference.type === 'session') {
          const session = await ctx.agents?.getSession(reference.id)
          if (session && !session.deletedAt) title = session.title ?? ''
        } else if (reference.type === 'resource') title = (await ctx.promptResources.getResource(reference.id))?.label
        else if (reference.type === 'run') title = (await get(reference.id))?.title
        else {
          const document = await ctx.documents.get(reference.id)
          if (reference.type === 'card' && document?.type === applicationDocumentTypes.cardSource) title = (document.content as CardSourceContent).name
          if (reference.type === 'provider' && document?.type === applicationDocumentTypes.providerProfile) title = (document.content as ProviderProfileContent).displayName
        }
        return { ...reference, title, state: title === undefined ? reference.type === 'run' ? 'unavailable' as const : 'deleted' as const : 'available' as const }
      }))
    },
    getObservationPersistence: () => ctx.observations.persistence(),
    setObservationPersistence: (input: { enabled: boolean }) => ctx.observations.setPersistence(input.enabled),
    async listObservations(input: ObservationListInput = {}) {
      const limit = Math.max(1, Math.min(100, input.limit ?? 50))
      const records: ObservationSummary[] = []
      let cursor = input.cursor
      let dropped = 0
      do {
        const page = ctx.observations.list({ ...input, cursor, limit: limit - records.length })
        dropped = page.dropped
        for (const entry of page.records) if (await visible(entry)) records.push(entry)
        cursor = page.nextCursor
      } while (cursor && records.length < limit)
      return { records, dropped, ...(cursor ? { nextCursor: cursor } : {}) }
    },
    async getObservation(input: { id: string }) {
      const record = await get(input.id)
      if (!record) return null
      const children = []
      for (const child of ctx.observations.children(record.id)) if (await visible(child)) children.push(child)
      return { record: observationSummary(record), children }
    },
    async getObservationRequest(input: { id: string }) {
      const record = await get(input.id)
      return record && (record.kind === 'request' || record.kind === 'api') ? record : null
    },
    async getObservationBuild(input: { id: string }) {
      const record = await get(input.id)
      return record?.kind === 'build' ? record : null
    },
    disposeObservations: () => ctx.observations.dispose(),
  }
}
