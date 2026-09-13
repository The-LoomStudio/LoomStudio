import { createHash } from 'node:crypto'
import type { DocumentRecord } from '@loom-studio/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { collectPages } from '../foundation/pagination.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import {
  createTextExtractionArtifact,
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
  InspectTextPipelineInput,
  MutationReceipt,
  RendererDefinition,
  RuntimeRequestContext,
  TextExtractionResult,
  TextExtractorContent,
  TextExtractorDraft,
  TextExtractorEntry,
  TextPipelineConsumer,
  TextPipelineInspection,
  TextPipelineOverrideContent,
  TextPipelineOverrideEntry,
  TextPipelineOverrideSource,
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

    getTextPipelineOverride: async (input: InspectTextPipelineInput): Promise<{ override: TextPipelineOverrideEntry | null }> => ({
      override: await readTextPipelineOverride(ctx, input.source, input.phase, input.consumerAgentSessionId),
    }),

    upsertTextPipelineOverride: async (
      input: InspectTextPipelineInput & {
        expectedVersion?: number
        disabledRuleIds: string[]
        orderedRuleIds: string[]
      },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ override: TextPipelineOverrideEntry; mutation: MutationReceipt }> => {
      validateOverrideRuleIds(input.disabledRuleIds, 'disabledRuleIds')
      validateOverrideRuleIds(input.orderedRuleIds, 'orderedRuleIds')
      const source = normalizeOverrideSource(input.source)
      const documentId = textPipelineOverrideDocumentId(source, input.phase, input.consumerAgentSessionId)
      const existing = await ctx.documents.get(documentId)
      assertExpectedDocumentVersion(existing, input.expectedVersion, applicationDocumentTypes.textPipelineOverride, 'Text Pipeline Override', documentId)
      const timestamp = ctx.now()
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.upsertTextPipelineOverride', async documents =>
        writeDocument<TextPipelineOverrideContent>(documents, {
          id: documentId,
          type: applicationDocumentTypes.textPipelineOverride,
          content: {
            source,
            phase: input.phase,
            ...(input.consumerAgentSessionId ? { consumerAgentSessionId: input.consumerAgentSessionId } : {}),
            disabledRuleIds: [...input.disabledRuleIds],
            orderedRuleIds: [...input.orderedRuleIds],
            createdAt: existing ? (existing.content as TextPipelineOverrideContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: existing ? existing.version : 'new',
        }),
      )
      return { override: toVersioned(mutation.value), mutation: mutation.mutation }
    },

    deleteTextPipelineOverride: async (
      input: InspectTextPipelineInput & { expectedVersion?: number },
      requestContext?: RuntimeRequestContext,
    ): Promise<{ deleted: true; mutation: MutationReceipt }> => {
      const source = normalizeOverrideSource(input.source)
      const documentId = textPipelineOverrideDocumentId(source, input.phase, input.consumerAgentSessionId)
      const existing = await readDocument<TextPipelineOverrideContent>(ctx.documents, documentId, applicationDocumentTypes.textPipelineOverride)
      if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
        throw new Error(`Text Pipeline Override version conflict: ${documentId}`)
      }
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteTextPipelineOverride', async documents => {
        await documents.delete({ id: documentId, expectedVersion: existing.version })
        return true as const
      })
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    projectHistory: async (input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string }): Promise<{ snapshot: HistoryProjectionSnapshot }> => ({
      snapshot: await projectRuntimeHistory(ctx, input.source, input.phase, input.consumerAgentSessionId),
    }),

    inspectTextPipeline: async (input: InspectTextPipelineInput): Promise<TextPipelineInspection> => {
      const effective = await resolveEffectiveTextPipeline(ctx, input.source, input.phase, input.consumerAgentSessionId)
      const entries = await readRuntimeHistoryEntries(ctx, input.source)
      const snapshot = projectHistoryEntries({
        source: input.source,
        phase: input.phase,
        entries,
        rules: effective.rules,
        preserveRuleOrder: true,
        traceEntryId: input.traceEntryId,
      })
      const ruleIds = new Set(snapshot.ruleIds)
      const extractors = effective.extractors.filter(extractor => extractor.enabled && extractor.targets.includes(input.source.kind))
      const artifacts = extractors.flatMap(extractor => {
        if (!extractor.artifactType) return []
        const extraction = extractHistory({ snapshot, extractor })
        return [createTextExtractionArtifact({ source: input.source, phase: input.phase, extractor, extraction })]
      })
      return {
        source: input.source,
        phase: input.phase,
        ...(effective.consumer ? { consumer: effective.consumer } : {}),
        rules: effective.rules.filter(rule => ruleIds.has(rule.id)),
        extractors,
        artifacts,
        snapshot,
      }
    },

    extractHistory: async (input: { source: HistorySource; extractorId: string; phase?: TextTransformPhase; consumerAgentSessionId?: string }): Promise<{ extraction: TextExtractionResult; snapshot: HistoryProjectionSnapshot }> => {
      const phase = input.phase ?? 'display'
      const effective = await resolveEffectiveTextPipeline(ctx, input.source, phase, input.consumerAgentSessionId)
      const extractor = effective.extractors.find(candidate => candidate.id === input.extractorId
        && candidate.enabled
        && candidate.targets.includes(input.source.kind))
      if (!extractor) throw new Error(`Text Extractor is not effective for the current context: ${input.extractorId}`)
      const entries = await readRuntimeHistoryEntries(ctx, input.source)
      const snapshot = projectHistoryEntries({ source: input.source, phase, entries, rules: effective.rules, preserveRuleOrder: true })
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
  consumerAgentSessionId?: string,
) {
  const entries = await readRuntimeHistoryEntries(ctx, source)
  const effective = await resolveEffectiveTextPipeline(ctx, source, phase, consumerAgentSessionId)
  return projectHistoryEntries({ source, phase, entries, rules: effective.rules, preserveRuleOrder: true })
}

export async function resolveEffectiveTextPipeline(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  phase: TextTransformPhase,
  consumerAgentSessionId?: string,
): Promise<{ rules: TextTransformRuleEntry[]; extractors: TextExtractorEntry[]; consumer?: TextPipelineConsumer }> {
  const ruleDocuments = await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)
  const extractorDocuments = await listDocuments<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor)
  const rules = ruleDocuments.map(document => toVersioned(document))
  const extractors = extractorDocuments.map(document => toVersioned(document))
  let presetId: string | undefined
  let cardId: string | undefined
  let consumer: TextPipelineConsumer | undefined
  let snapshotRules: TextTransformRuleEntry[] = []
  let snapshotExtractors: TextExtractorEntry[] = []
  let hasTimelineRuntimeContext = false

  if (source.kind === 'agent-session') {
    const session = await ctx.agents?.getSession(source.sessionId)
    if (!session) throw new Error(`Agent Session not found: ${source.sessionId}`)
    const profile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
    presetId = profile.content.presetId
    consumer = { agentSessionId: session.id, agentProfileId: session.agentProfileId, presetId }
  } else {
    if (phase === 'prompt' && !consumerAgentSessionId) throw new Error('Narrative prompt projection requires consumerAgentSessionId')
    const timeline = await ctx.narratives?.getTimeline(source.timelineId)
    if (!timeline) throw new Error(`Narrative Timeline not found: ${source.timelineId}`)
    cardId = timeline.createdFrom?.cardId
    const runtimeContext = await readTimelineRuntimeContext(ctx, source.timelineId)
    hasTimelineRuntimeContext = Boolean(runtimeContext)
    snapshotRules = runtimeContext?.textTransformRules ?? []
    snapshotExtractors = runtimeContext?.textExtractors ?? []
    if (consumerAgentSessionId) {
      const session = await ctx.agents?.getSession(consumerAgentSessionId)
      if (!session) throw new Error(`Agent Session not found: ${consumerAgentSessionId}`)
      const profile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
      presetId = profile.content.presetId
      consumer = { agentSessionId: session.id, agentProfileId: session.agentProfileId, presetId }
    }
  }

  const defaultRules = [
    ...rules.filter(rule => rule.enabled && isOwnerActive(rule.owner, presetId, cardId, hasTimelineRuntimeContext)),
    ...snapshotRules.filter(rule => rule.enabled),
  ].sort(compareTextEntries)
  const override = await readTextPipelineOverride(ctx, source, phase, consumerAgentSessionId)
  return {
    rules: applyTextPipelineOverride(defaultRules, override),
    extractors: [
      ...extractors.filter(extractor => extractor.enabled && isOwnerActive(extractor.owner, presetId, cardId, hasTimelineRuntimeContext)),
      ...snapshotExtractors.filter(extractor => extractor.enabled),
    ].sort(compareTextEntries),
    ...(consumer ? { consumer } : {}),
  }
}

function normalizeOverrideSource(source: HistorySource): TextPipelineOverrideSource {
  return source.kind === 'narrative'
    ? { kind: 'narrative', timelineId: source.timelineId, branchId: source.branchId }
    : { kind: 'agent-session', sessionId: source.sessionId }
}

function textPipelineOverrideDocumentId(
  source: TextPipelineOverrideSource,
  phase: TextTransformPhase,
  consumerAgentSessionId?: string,
): string {
  const sourceKey = source.kind === 'narrative'
    ? `narrative\u0000${source.timelineId}\u0000${source.branchId}`
    : `agent-session\u0000${source.sessionId}`
  const digest = createHash('sha256')
    .update(`${sourceKey}\u0000${phase}\u0000${consumerAgentSessionId ?? ''}`)
    .digest('hex')
  return `text-pipeline-override:${digest}`
}

async function readTextPipelineOverride(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  phase: TextTransformPhase,
  consumerAgentSessionId?: string,
): Promise<TextPipelineOverrideEntry | null> {
  const normalizedSource = normalizeOverrideSource(source)
  const documentId = textPipelineOverrideDocumentId(normalizedSource, phase, consumerAgentSessionId)
  const document = await ctx.documents.get(documentId)
  if (!document) return null
  if (document.type !== applicationDocumentTypes.textPipelineOverride) {
    throw new Error(`Unexpected document type for ${documentId}: ${document.type}`)
  }
  return toVersioned(document as DocumentRecord<TextPipelineOverrideContent>)
}

function applyTextPipelineOverride(
  rules: TextTransformRuleEntry[],
  override: TextPipelineOverrideEntry | null,
): TextTransformRuleEntry[] {
  if (!override) return rules
  const disabled = new Set(override.disabledRuleIds)
  const activeById = new Map(rules.filter(rule => !disabled.has(rule.id)).map(rule => [rule.id, rule]))
  const ordered: TextTransformRuleEntry[] = []
  for (const ruleId of override.orderedRuleIds) {
    const rule = activeById.get(ruleId)
    if (!rule) continue
    ordered.push(rule)
    activeById.delete(ruleId)
  }
  return [...ordered, ...rules.filter(rule => activeById.delete(rule.id))]
}

function validateOverrideRuleIds(ruleIds: string[], label: string): void {
  const normalized = ruleIds.map(ruleId => ruleId.trim())
  if (normalized.some(ruleId => !ruleId)) throw new Error(`Text Pipeline Override ${label} cannot contain empty Rule IDs`)
  if (normalized.some((ruleId, index) => ruleId !== ruleIds[index])) throw new Error(`Text Pipeline Override ${label} Rule IDs cannot contain surrounding whitespace`)
  if (new Set(normalized).size !== normalized.length) throw new Error(`Text Pipeline Override ${label} cannot contain duplicate Rule IDs`)
}

function isOwnerActive(owner: { kind: string; presetId?: string; cardId?: string }, presetId: string | undefined, cardId: string | undefined, hasTimelineRuntimeContext: boolean): boolean {
  if (owner.kind === 'preset') return owner.presetId === presetId
  if (owner.kind === 'card') return !hasTimelineRuntimeContext && owner.cardId === cardId
  return true
}

function compareTextEntries(left: { orderIndex: number; id: string }, right: { orderIndex: number; id: string }): number {
  return left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
}

async function readRuntimeHistoryEntries(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
): Promise<HistoryTextEntry[]> {
  if (source.kind === 'agent-session') {
    const agents = ctx.agents
    if (!agents) throw new Error('Agent Store is not configured')
    const entries = await collectPages(async cursor => {
      const pageCursor = cursor ?? source.headEntryId
      const page = await agents.getEntryPage({ agentSessionId: source.sessionId, ...(pageCursor ? { cursor: pageCursor } : {}), limit: 100 })
      return { items: page.entries, nextCursor: page.nextCursor }
    })
    entries.reverse()
    return entries.flatMap(entry => entry.entry.kind === 'message'
      ? [{ id: entry.id, source, role: entry.entry.role, text: entry.entry.content, sequence: entry.sequence, createdAt: entry.createdAt }]
      : [])
  }
  const narratives = ctx.narratives
  if (!narratives) throw new Error('Narrative Store is not configured')
  const nodes = await collectPages(async cursor => {
    const page = await narratives.getPage({ timelineId: source.timelineId, branchId: source.branchId, ...(cursor ? { cursor } : {}), limit: 100 })
    return { items: page.nodes, nextCursor: page.nextCursor }
  })
  nodes.reverse()
  return nodes.map((node, sequence) => ({
    id: node.id,
    source,
    text: node.body.raw,
    sequence: sequence + 1,
    createdAt: node.createdAt,
  }))
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
