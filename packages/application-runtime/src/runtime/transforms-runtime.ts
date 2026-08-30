import type { DocumentRecord } from '@loom-studio/document-store'
import type { AgentTranscriptEntry } from '@loom-studio/agent-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import {
  extractHistory,
  projectHistoryEntries,
  validateTextExtractorDraft,
  validateTextTransformRuleDraft,
} from '../transforms/history-text.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import type {
  AgentProfileContent,
  HistoryProjectionSnapshot,
  HistorySource,
  HistoryTextEntry,
  MutationReceipt,
  RendererDefinition,
  RuntimeRequestContext,
  TextExtractionResult,
  TextExtractorContent,
  TextExtractorDraft,
  TextExtractorEntry,
  TextTransformPhase,
  TextTransformRuleContent,
  TextTransformRuleDraft,
  TextTransformRuleEntry,
} from '../types.js'

export const builtInRenderers: RendererDefinition[] = [
  {
    id: 'official/json-artifact',
    name: 'JSON Artifact',
    artifactType: 'application/json',
    surface: 'shell.workspace-panel',
    instanceScope: 'workspace',
    fallback: 'json',
  },
]

export function createTransformsRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    listTextTransformRules: async (): Promise<{ rules: TextTransformRuleEntry[] }> => ({
      rules: (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
        .map(document => toVersioned(document)),
    }),

    getTextTransformRule: async (input: { ruleId: string }): Promise<{ rule: TextTransformRuleEntry }> => ({
      rule: toVersioned(await readDocument<TextTransformRuleContent>(ctx.documents, input.ruleId, applicationDocumentTypes.textTransformRule)),
    }),

    upsertTextTransformRule: async (
      input: { ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ rule: TextTransformRuleEntry; mutation: MutationReceipt }> => {
      validateTextTransformRuleDraft(input.rule)
      const existing = await ctx.documents.get(input.ruleId)
      assertExpectedDocumentVersion(existing, input.expectedVersion, applicationDocumentTypes.textTransformRule, 'Text Transform Rule', input.ruleId)
      const timestamp = ctx.now()
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.upsertTextTransformRule', async documents =>
        writeDocument<TextTransformRuleContent>(documents, {
          id: input.ruleId,
          type: applicationDocumentTypes.textTransformRule,
          content: {
            ...structuredClone(input.rule),
            createdAt: existing ? (existing.content as TextTransformRuleContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: existing ? existing.version : 'new',
        }),
      )
      return { rule: toVersioned(mutation.value), mutation: mutation.mutation }
    },

    deleteTextTransformRule: async (
      input: { ruleId: string; expectedVersion?: number },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ deleted: true; mutation: MutationReceipt }> => {
      const existing = await readDocument<TextTransformRuleContent>(ctx.documents, input.ruleId, applicationDocumentTypes.textTransformRule)
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) throw new Error(`Text Transform Rule version conflict: ${input.ruleId}`)
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteTextTransformRule', async documents => {
        await documents.delete({ id: existing.id, expectedVersion: existing.version })
        return true as const
      })
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    listTextExtractors: async (): Promise<{ extractors: TextExtractorEntry[] }> => ({
      extractors: (await listDocuments<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor)).map(document => toVersioned(document)),
    }),

    getTextExtractor: async (input: { extractorId: string }): Promise<{ extractor: TextExtractorEntry }> => ({
      extractor: toVersioned(await readDocument<TextExtractorContent>(ctx.documents, input.extractorId, applicationDocumentTypes.textExtractor)),
    }),

    upsertTextExtractor: async (
      input: { extractorId: string; expectedVersion?: number; extractor: TextExtractorDraft },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ extractor: TextExtractorEntry; mutation: MutationReceipt }> => {
      validateTextExtractorDraft(input.extractor)
      const existing = await ctx.documents.get(input.extractorId)
      assertExpectedDocumentVersion(existing, input.expectedVersion, applicationDocumentTypes.textExtractor, 'Text Extractor', input.extractorId)
      const timestamp = ctx.now()
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.upsertTextExtractor', async documents =>
        writeDocument<TextExtractorContent>(documents, {
          id: input.extractorId,
          type: applicationDocumentTypes.textExtractor,
          content: {
            ...structuredClone(input.extractor),
            createdAt: existing ? (existing.content as TextExtractorContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: existing ? existing.version : 'new',
        }),
      )
      return { extractor: toVersioned(mutation.value), mutation: mutation.mutation }
    },

    deleteTextExtractor: async (
      input: { extractorId: string; expectedVersion?: number },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ deleted: true; mutation: MutationReceipt }> => {
      const existing = await readDocument<TextExtractorContent>(ctx.documents, input.extractorId, applicationDocumentTypes.textExtractor)
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) throw new Error(`Text Extractor version conflict: ${input.extractorId}`)
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteTextExtractor', async documents => {
        await documents.delete({ id: existing.id, expectedVersion: existing.version })
        return true as const
      })
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    projectHistory: async (input: { source: HistorySource; phase: TextTransformPhase }): Promise<{ snapshot: HistoryProjectionSnapshot }> => ({
      snapshot: await projectRuntimeHistory(ctx, input.source, input.phase),
    }),

    extractHistory: async (input: { source: HistorySource; extractorId: string; phase?: TextTransformPhase }): Promise<{ extraction: TextExtractionResult; snapshot: HistoryProjectionSnapshot }> => {
      const extractor = toVersioned(await readDocument<TextExtractorContent>(ctx.documents, input.extractorId, applicationDocumentTypes.textExtractor))
      const snapshot = await projectRuntimeHistory(ctx, input.source, input.phase ?? 'display')
      return { extraction: extractHistory({ snapshot, extractor }), snapshot }
    },

    listRenderers: async (): Promise<{ renderers: RendererDefinition[] }> => ({
      renderers: builtInRenderers.map(renderer => structuredClone(renderer)),
    }),
  }
}

export async function projectRuntimeHistory(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  phase: TextTransformPhase,
) {
  const entries = await readRuntimeHistoryEntries(ctx, source)
  const documents = await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)
  const rules = documents.map(document => toVersioned(document))
  const activeRules = await filterRulesForSource(ctx, source, rules)
  return projectHistoryEntries({ source, phase, entries, rules: activeRules })
}

async function readRuntimeHistoryEntries(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
): Promise<HistoryTextEntry[]> {
  if (source.kind === 'agent-session') {
    const agents = ctx.agents
    if (!agents) throw new Error('Agent Store is not configured')
    let cursor = source.headEntryId
    const entries: AgentTranscriptEntry[] = []
    do {
      const page = await agents.getEntryPage({ agentSessionId: source.sessionId, ...(cursor ? { cursor } : {}), limit: 100 })
      entries.unshift(...page.entries)
      cursor = page.nextCursor
    } while (cursor)
    return entries.flatMap(entry => entry.entry.kind === 'message'
      ? [{ id: entry.id, source, role: entry.entry.role, text: entry.entry.content, sequence: entry.sequence, createdAt: entry.createdAt }]
      : [])
  }
  const narratives = ctx.narratives
  if (!narratives) throw new Error('Narrative Store is not configured')
  let cursor: string | undefined
  const nodes: import('@loom-studio/narrative-store').NarrativeNode[] = []
  do {
    const page = await narratives.getPage({ timelineId: source.timelineId, branchId: source.branchId, ...(cursor ? { cursor } : {}), limit: 100 })
    nodes.unshift(...page.nodes)
    cursor = page.nextCursor
  } while (cursor)
  return nodes.map((node, sequence) => ({
    id: node.id,
    source,
    text: node.body.raw,
    sequence: sequence + 1,
    createdAt: node.createdAt,
  }))
}

async function filterRulesForSource(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  rules: TextTransformRuleEntry[],
): Promise<TextTransformRuleEntry[]> {
  let presetId: string | undefined
  let cardId: string | undefined
  let snapshotRules: TextTransformRuleEntry[] = []
  let hasTimelineRuntimeContext = false
  if (source.kind === 'agent-session') {
    const session = await ctx.agents?.getSession(source.sessionId)
    if (!session) throw new Error(`Agent Session not found: ${source.sessionId}`)
    const profile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
    presetId = profile.content.presetId
  } else {
    const timeline = await ctx.narratives?.getTimeline(source.timelineId)
    if (!timeline) throw new Error(`Narrative Timeline not found: ${source.timelineId}`)
    cardId = timeline.createdFrom?.cardId
    const runtimeContext = await readTimelineRuntimeContext(ctx, source.timelineId)
    hasTimelineRuntimeContext = Boolean(runtimeContext)
    snapshotRules = runtimeContext?.textTransformRules ?? []
  }
  const active = rules.filter(rule => {
    if (rule.owner.kind === 'preset') return rule.owner.presetId === presetId
    if (rule.owner.kind === 'card') return !hasTimelineRuntimeContext && rule.owner.cardId === cardId
    return true
  })
  return [...active, ...snapshotRules]
}

function assertExpectedDocumentVersion(
  existing: DocumentRecord | null,
  expectedVersion: number | undefined,
  expectedType: string,
  label: string,
  id: string,
): void {
  if (existing && existing.type !== expectedType) throw new Error(`Unexpected document type for ${id}: ${existing.type}`)
  if (existing && expectedVersion === undefined) throw new Error(`expectedVersion is required when updating ${label}: ${id}`)
  if (existing && existing.version !== expectedVersion) throw new Error(`${label} version conflict: ${id}`)
  if (!existing && expectedVersion !== undefined) throw new Error(`${label} does not exist: ${id}`)
}
