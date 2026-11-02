import { createHash } from 'node:crypto'
import { listScriptTextTransformRules, getTextTransformRuleScript, upsertTextTransformRuleScript, deleteTextTransformRuleScript } from '../scripts/loom-script-text-migration.js'
import { resolveScriptTextContributions } from '../scripts/loom-script-text-pipeline.js'
import { parseLoomScriptSource, resolveLoomScriptSettings, resolveTextTransformContributionRule, resolveTextExtractorContribution, type LoomScriptSettings } from '@loom-studio/shared/loom-scripts'
import type { DocumentRecord } from '@loom-studio/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { ExtensionInstallationTarget } from '../types.js'
import { assertExtensionTimelineAccess } from './extension-resource-access.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { collectPages } from '../foundation/pagination.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import {
  type TextTransformDiagnostic,
  createTextExtractionArtifact,
  extractHistory,
  projectHistoryEntries,
  validateTextExtractorDraft,
} from '../transforms/history-text.js'
import { createNarrativeSampler, type NarrativeSampleRequest, type NarrativeSampleResult } from '../narrative/sampling.js'
import { projectNarrativeSample } from '../narrative/projection.js'
import { isExtensionResourceAvailable, readAvailableExtensionInstallations } from './extension-resource-access.js'
import type {
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
  TextTransformRuleDraft,
  TextTransformRuleEntry,
} from '../types.js'

const builtInRenderers: RendererDefinition[] = [
  {
    id: 'official/json-artifact',
    name: 'JSON Artifact',
    artifactType: 'application/json',
    surface: 'shell.workspace-panel',
    instanceScope: 'workspace',
    fallback: 'json',
  },
]

export type SampleNarrativeInput = NarrativeSampleRequest & {
  processing?: {
    phase: TextTransformPhase
    presetId?: string
    consumerAgentSessionId?: string
  }
}

export async function sampleRuntimeNarrative(
  ctx: TransformsRuntimeContext,
  input: SampleNarrativeInput,
  signal?: AbortSignal,
): Promise<NarrativeSampleResult> {
  if (!ctx.narratives) throw new Error('Narrative Store is not configured')
  if (input.processing && !['prompt', 'display', 'classify'].includes(input.processing.phase)) {
    throw new Error('Unsupported Narrative processing phase')
  }
  const sample = await createNarrativeSampler(ctx.narratives).sample(input, signal)
  if (!input.processing) return sample
  const effective = await resolveEffectiveTextPipeline(
    ctx, { kind: 'narrative', timelineId: sample.timelineId, branchId: sample.branchId },
    input.processing.phase, input.processing.consumerAgentSessionId, input.processing.presetId,
  )
  signal?.throwIfAborted()
  return projectNarrativeSample(sample, {
    phase: input.processing.phase, rules: effective.rules,
    maxNodes: input.maxNodes, maxCharacters: input.maxCharacters,
  })
}

type TransformsRuntimeContext = Pick<ApplicationRuntimeContext, 'agents' | 'documents' | 'narratives' | 'now' | 'promptResources'>

export function createTransformsRuntimeMethods(ctx: TransformsRuntimeContext & Pick<ApplicationRuntimeContext, 'dataEngine' | 'blobs' | 'createId'>) {
  return {
    sampleNarrative: (input: SampleNarrativeInput, signal?: AbortSignal) => sampleRuntimeNarrative(ctx, input, signal),
    previewLoomScript: async (input: { source: string; text: string; phase?: TextTransformPhase; streaming?: boolean; settings?: LoomScriptSettings }) => {
      const metadata = parseLoomScriptSource(input.source)
      const settings = resolveLoomScriptSettings(metadata.settings ?? [], input.settings ?? {})
      const rules: TextTransformRuleEntry[] = metadata.contributions.flatMap(contribution => contribution.kind === 'text-transform'
        ? [{ ...resolveTextTransformContributionRule(contribution, settings), id: contribution.id, version: 1,
          owner: { kind: 'workspace' as const }, createdAt: '', updatedAt: '' }] : [])
      const source = { kind: 'narrative' as const, timelineId: 'preview', branchId: 'preview' }
      const snapshot = projectHistoryEntries({ streaming: input.streaming, source, phase: input.phase ?? 'display', rules,
        entries: [{ id: 'sample', source, text: input.text, sequence: 0 }] })
      const extractions = metadata.contributions.flatMap(contribution => {
        if (contribution.kind !== 'text-extractor') return []
        const extractor = { ...resolveTextExtractorContribution(contribution, settings), id: contribution.id, version: 1,
          owner: { kind: 'workspace' as const }, createdAt: '', updatedAt: '' }
        return [extractHistory({ snapshot, extractor })]
      })
      return { output: snapshot.entries[0]?.text ?? input.text, matches: snapshot.matches, extractions,
        diagnostics: [...snapshot.diagnostics, ...metadata.contributions.flatMap(item => item.kind !== 'renderer' && item.requiresCode
          ? [{ code: 'preview.code_not_executed', message: `Testing ${item.id} independently; preview does not execute JavaScript` }] : [])] }
    },
    listTextTransformRules: async (input?: { owner?: TextTransformRuleDraft['owner'] }): Promise<{ rules: TextTransformRuleEntry[] }> => ({
      rules: (await listScriptTextTransformRules(ctx.documents)).filter(rule => !input?.owner || JSON.stringify(rule.owner) === JSON.stringify(input.owner)),
    }),
    getTextTransformRule: (input: { ruleId: string }) => getTextTransformRuleScript(ctx, input),
    upsertTextTransformRule: (input: { ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft }, request?: RuntimeRequestContext) => upsertTextTransformRuleScript(ctx, input, request),
    deleteTextTransformRule: (input: { ruleId: string; expectedVersion?: number }, request?: RuntimeRequestContext) => deleteTextTransformRuleScript(ctx, input, request),

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

    projectHistory: async (input: { source: HistorySource; phase: TextTransformPhase; entryIds?: string[]; streamingEntries?: Array<{ id: string; text: string; role?: 'user' | 'assistant' }>; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget }): Promise<{ snapshot: HistoryProjectionSnapshot }> => {
      input = structuredClone(input)
      await assertHistoryInstallationAccess(ctx, input)
      const snapshot = await projectRuntimeHistory(ctx, input.source, input.phase, input.consumerAgentSessionId, input.entryIds)
      if (input.streamingEntries?.length) {
        if (input.phase !== 'display') throw new Error('Streaming snapshots are display-only')
        if (input.streamingEntries.length > 64 || input.streamingEntries.reduce((n, entry) => n + entry.text.length, 0) > 2_000_000) throw new Error('Streaming snapshot budget exceeded')
        if (new Set(input.streamingEntries.map(entry => entry.id)).size !== input.streamingEntries.length) throw new Error('Duplicate streaming entry ID')
        const effective = await resolveEffectiveTextPipeline(ctx, input.source, 'display', input.consumerAgentSessionId)
        const history = await readRuntimeHistoryEntries(ctx, input.source)
        const byId = new Map(history.map(entry => [entry.id, entry]))
        const newest = history.reduce((n, entry) => Math.max(n, entry.sequence), 0)
        const ids = new Set(input.streamingEntries.map(entry => entry.id))
        const projected = projectHistoryEntries({ source: input.source, phase: 'display', streaming: true,
          rules: effective.rules, preserveRuleOrder: true, entryIds: [...ids],
          entries: [...history.filter(entry => !ids.has(entry.id)), ...input.streamingEntries.map((entry, index) => ({
            ...entry, source: input.source, sequence: byId.get(entry.id)?.sequence ?? newest + index + 1,
          }))],
        })
        snapshot.entries = [...snapshot.entries.filter(entry => !ids.has(entry.id)), ...projected.entries]
        snapshot.matches = [...snapshot.matches.filter(match => !ids.has(match.entryId)), ...projected.matches]
        snapshot.diagnostics.push(...projected.diagnostics)
      }
      if (input.entryIds !== undefined) {
        const ids = new Set(input.entryIds)
        snapshot.entries = snapshot.entries.filter(entry => ids.has(entry.id))
        snapshot.matches = snapshot.matches.filter(match => ids.has(match.entryId))
        snapshot.diagnostics = snapshot.diagnostics.filter(item => item.entryId === undefined || ids.has(item.entryId))
      }
      return { snapshot }
    },

    previewCardOpeningDisplay: async (input: { cardId: string; presetId?: string; text: string }) => {
      await readDocument(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      if (input.presetId !== undefined) {
        const preset = await ctx.promptResources.getResource(input.presetId)
        if (!preset || preset.tombstoned || preset.resourceKind !== 'preset') throw new Error(`Preset not found: ${input.presetId}`)
      }
      const effective = await resolveScriptTextContributions(ctx, { cardId: input.cardId, presetId: input.presetId })
      const rules = effective.rules
        .filter(rule => isOwnerActive(rule.owner, input.presetId, input.cardId))
        .sort(compareTextEntries)
      const source = { kind: 'card-opening' as const, cardId: input.cardId }
      const snapshot = projectHistoryEntries({
        source, phase: 'display', rules, preserveRuleOrder: true,
        entries: [{ id: 'opening', source, role: 'assistant', text: input.text, sequence: 0 }],
      })
      return { text: snapshot.entries[0]!.text, originalText: input.text, diagnostics: snapshot.diagnostics }
    },

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
      snapshot.diagnostics.push(...effective.diagnostics)
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

    extractHistory: async (input: { source: HistorySource; extractorId: string; phase?: TextTransformPhase; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget }): Promise<{ extraction: TextExtractionResult; snapshot: HistoryProjectionSnapshot }> => {
      input = structuredClone(input)
      await assertHistoryInstallationAccess(ctx, input)
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

async function projectRuntimeHistory(
  ctx: TransformsRuntimeContext,
  source: HistorySource,
  phase: TextTransformPhase,
  consumerAgentSessionId?: string,
  entryIds?: readonly string[],
) {
  const entries = await readRuntimeHistoryEntries(ctx, source)
  const effective = await resolveEffectiveTextPipeline(ctx, source, phase, consumerAgentSessionId)
  const snapshot = projectHistoryEntries({ source, phase, entries, entryIds, rules: effective.rules, preserveRuleOrder: true })
  snapshot.diagnostics.push(...effective.diagnostics)
  return snapshot
}

export async function resolveEffectiveTextPipeline(
  ctx: TransformsRuntimeContext,
  source: HistorySource,
  phase: TextTransformPhase,
  consumerAgentSessionId?: string,
  consumerPresetId?: string,
): Promise<{ rules: TextTransformRuleEntry[]; extractors: TextExtractorEntry[]; consumer?: TextPipelineConsumer; diagnostics: TextTransformDiagnostic[] }> {
  if (consumerPresetId !== undefined) {
    if (source.kind !== 'narrative' || consumerAgentSessionId !== undefined) {
      throw new Error('Explicit Narrative Preset and Session consumer are mutually exclusive')
    }
    const preset = await ctx.promptResources.getResource(consumerPresetId)
    if (!preset || preset.tombstoned || preset.resourceKind !== 'preset') {
      throw new Error(`Narrative consumer Preset not found: ${consumerPresetId}`)
    }
  }
  const extractorDocuments = await listDocuments<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor)
  const legacyExtractors = extractorDocuments.map(document => toVersioned(document))
  let presetId = consumerPresetId
  let cardId: string | undefined
  let timelineId: string | null = null
  let consumer: TextPipelineConsumer | undefined

  if (source.kind === 'agent-session') {
    const session = await ctx.agents?.getSession(source.sessionId)
    if (!session) throw new Error(`Agent Session not found: ${source.sessionId}`)
    presetId = session.agentPresetId
    if (session.timelineId) {
      timelineId = session.timelineId
      const timeline = await ctx.narratives?.getTimeline(session.timelineId)
      if (!timeline) throw new Error(`Narrative Timeline not found: ${session.timelineId}`)
      cardId = timeline.createdFrom?.cardId
    }
    consumer = { agentSessionId: session.id, agentPresetId: session.agentPresetId, presetId }
  } else {
    timelineId = source.timelineId
    if (phase === 'prompt' && !consumerAgentSessionId && !consumerPresetId) {
      throw new Error('Narrative prompt projection requires consumerAgentSessionId or presetId')
    }
    const timeline = await ctx.narratives?.getTimeline(source.timelineId)
    if (!timeline) throw new Error(`Narrative Timeline not found: ${source.timelineId}`)
    cardId = timeline.createdFrom?.cardId
    if (consumerAgentSessionId) {
      const session = await ctx.agents?.getSession(consumerAgentSessionId)
      if (!session) throw new Error(`Agent Session not found: ${consumerAgentSessionId}`)
      presetId = session.agentPresetId
      consumer = { agentSessionId: session.id, agentPresetId: session.agentPresetId, presetId }
    }
  }

  const scriptContributions = await resolveScriptTextContributions(ctx, { cardId, presetId, timelineId })
  const rules = scriptContributions.rules
  const extractors = [...legacyExtractors, ...scriptContributions.extractors]
  const availableInstallations = await readAvailableExtensionInstallations(ctx.documents, cardId, timelineId)
  const preset = presetId ? await ctx.promptResources.getResource(presetId) : null
  const uses = Array.isArray(preset?.metadata.textUses)
    ? preset.metadata.textUses as Array<{ id: string; kind: 'rule' | 'extractor'; enabled: boolean; orderIndex?: number; reference?: { kind: string; resourceId?: string; origin?: { packageId: string; contributionId: string } } }>
    : []
  const presetOrigin = preset?.metadata.origin as { kind?: string; packageId?: string } | undefined
  const usable = (use: typeof uses[number], item: TextTransformRuleEntry | TextExtractorEntry) =>
    use.reference?.kind === 'package'
      ? Boolean(presetOrigin?.kind === 'extension-package'
        && item.origin?.packageId === presetOrigin.packageId
        && item.origin?.contributionId === (use.reference as { contributionId?: string }).contributionId)
      : use.reference?.kind !== 'external' || (use.reference.origin
        ? item.origin?.packageId === use.reference.origin.packageId && item.origin.contributionId === use.reference.origin.contributionId
        : use.reference.resourceId === item.id && !item.origin)
  const configured = (kind: 'rule' | 'extractor', item: TextTransformRuleEntry | TextExtractorEntry) =>
    uses.find(use => use.kind === kind && use.id === item.id && usable(use, item))
  const diagnostics = uses.filter(use => !(use.kind === 'rule' ? rules : extractors).some(item =>
    item.id === use.id && usable(use, item) && isExtensionResourceAvailable(item.origin, availableInstallations)
    && (item.owner.kind !== 'card' && item.owner.kind !== 'preset' || isOwnerActive(item.owner, presetId, cardId))))
    .map(use => ({
      code: 'text.use_unresolved',
      presetId, presetName: preset?.label, resourceKind: use.kind, referenceIndex: uses.indexOf(use) + 1,
      resourceName: (use.kind === 'rule' ? rules : extractors).find(item => item.id === use.id)?.name,
      message: `Preset ${use.kind} reference is unavailable: ${use.id}`,
      ...(use.kind === 'rule' ? { ruleId: use.id } : {}),
    }))
  const defaultRules = rules
    .filter(rule => (rule.owner.kind !== 'card' && rule.owner.kind !== 'preset' || isOwnerActive(rule.owner, presetId, cardId))
      && (configured('rule', rule)?.enabled ?? rule.enabled)
      && isExtensionResourceAvailable(rule.origin, availableInstallations))
    .map(rule => configured('rule', rule)?.enabled === true && !rule.enabled ? { ...rule, enabled: true } : rule)
    .sort((left, right) => (left.orderGroupExplicit ? left.orderGroup! : configured('rule', left) ? 0 : left.orderGroup ?? 0) - (right.orderGroupExplicit ? right.orderGroup! : configured('rule', right) ? 0 : right.orderGroup ?? 0) || (configured('rule', left) ? '' : left.orderGroupKey ?? '').localeCompare(configured('rule', right) ? '' : right.orderGroupKey ?? '') || (left.orderOverridden ? left.orderIndex : configured('rule', left)?.orderIndex ?? left.orderIndex)
      - (right.orderOverridden ? right.orderIndex : configured('rule', right)?.orderIndex ?? right.orderIndex) || (left.localOrder ?? 0) - (right.localOrder ?? 0) || left.id.localeCompare(right.id))
  const override = await readTextPipelineOverride(ctx, source, phase, consumerAgentSessionId)
  return {
    diagnostics: [...scriptContributions.diagnostics, ...diagnostics],
    rules: applyTextPipelineOverride(defaultRules, override),
    extractors: extractors
      .filter(extractor => (extractor.owner.kind !== 'card' && extractor.owner.kind !== 'preset' || isOwnerActive(extractor.owner, presetId, cardId))
        && (configured('extractor', extractor)?.enabled ?? extractor.enabled)
        && isExtensionResourceAvailable(extractor.origin, availableInstallations))
      .map(extractor => configured('extractor', extractor)?.enabled === true && !extractor.enabled
        ? { ...extractor, enabled: true } : extractor)
      .sort((left, right) => (configured('extractor', left)?.orderIndex ?? left.orderIndex)
        - (configured('extractor', right)?.orderIndex ?? right.orderIndex) || left.id.localeCompare(right.id)),
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
  ctx: Pick<ApplicationRuntimeContext, 'documents'>,
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

function isOwnerActive(owner: { kind: string; presetId?: string; cardId?: string }, presetId: string | undefined, cardId: string | undefined): boolean {
  if (owner.kind === 'preset') return owner.presetId === presetId
  if (owner.kind === 'card') return owner.cardId === cardId
  return true
}

function compareTextEntries(left: { orderIndex: number; id: string }, right: { orderIndex: number; id: string }): number {
  return left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
}

async function assertHistoryInstallationAccess(
  ctx: Pick<ApplicationRuntimeContext, 'agents' | 'narratives'>,
  input: { source: HistorySource; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget },
): Promise<void> {
  if (input.extensionTarget?.kind !== 'card') return
  if (input.source.kind === 'narrative') await assertExtensionTimelineAccess(ctx.narratives, input.extensionTarget, input.source.timelineId)
  const sessionIds = [
    ...(input.source.kind === 'agent-session' ? [input.source.sessionId] : []),
    ...(input.consumerAgentSessionId ? [input.consumerAgentSessionId] : []),
  ]
  for (const id of sessionIds) {
    const session = await ctx.agents?.getSession(id)
    await assertExtensionTimelineAccess(ctx.narratives, input.extensionTarget, session?.deletedAt ? undefined : session?.timelineId)
  }
}

async function readRuntimeHistoryEntries(
  ctx: Pick<ApplicationRuntimeContext, 'agents' | 'narratives'>,
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
    return { items: [...page.nodes].reverse(), nextCursor: page.nextCursor }
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
