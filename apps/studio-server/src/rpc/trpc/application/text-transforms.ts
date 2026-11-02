import { z } from 'zod'
import type {
  ApplicationRuntime,
  TextExtractorDraft,
  TextTransformRuleDraft
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readObject,
  readOptionalInstallationTarget,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readString,
  readStringArray,
} from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

export const textTransformsProcedures = {
  'listTextTransformRules': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listTextTransformRules']>[0] => {
    return { owner: readOptionalRuleOwner(params) }
  })).query(({ ctx, input }) => ctx.runtime.listTextTransformRules(input)),
  'getTextTransformRule': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getTextTransformRule']>[0] => {
    return { ruleId: readString(params, 'ruleId') }
  })).query(({ ctx, input }) => ctx.runtime.getTextTransformRule(input)),
  'upsertTextTransformRule': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['upsertTextTransformRule']>[0] => {
    return {
      ruleId: readString(params, 'ruleId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      rule: readObject(params, 'rule') as unknown as TextTransformRuleDraft,
    }
  })).mutation(({ ctx, input }) => ctx.runtime.upsertTextTransformRule(input, ctx.request)),
  'deleteTextTransformRule': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteTextTransformRule']>[0] => {
    return {
      ruleId: readString(params, 'ruleId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteTextTransformRule(input, ctx.request)),
  'listTextExtractors': procedure.query(({ ctx }) => ctx.runtime.listTextExtractors()),
  'getTextExtractor': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getTextExtractor']>[0] => {
    return { extractorId: readString(params, 'extractorId') }
  })).query(({ ctx, input }) => ctx.runtime.getTextExtractor(input)),
  'upsertTextExtractor': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['upsertTextExtractor']>[0] => {
    return {
      extractorId: readString(params, 'extractorId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      extractor: readObject(params, 'extractor') as unknown as TextExtractorDraft,
    }
  })).mutation(({ ctx, input }) => ctx.runtime.upsertTextExtractor(input, ctx.request)),
  'deleteTextExtractor': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteTextExtractor']>[0] => {
    return {
      extractorId: readString(params, 'extractorId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteTextExtractor(input, ctx.request)),
  'getTextPipelineOverride': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getTextPipelineOverride']>[0] => {
    return {
      source: readHistorySource(params),
      phase: readTextTransformPhase(params, 'phase'),
      consumerAgentSessionId: readOptionalString(params, 'consumerAgentSessionId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getTextPipelineOverride(input)),
  'upsertTextPipelineOverride': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['upsertTextPipelineOverride']>[0] => {
    return {
      source: readHistorySource(params),
      phase: readTextTransformPhase(params, 'phase'),
      consumerAgentSessionId: readOptionalString(params, 'consumerAgentSessionId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      disabledRuleIds: readStringArray(params, 'disabledRuleIds'),
      orderedRuleIds: readStringArray(params, 'orderedRuleIds'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.upsertTextPipelineOverride(input, ctx.request)),
  'deleteTextPipelineOverride': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteTextPipelineOverride']>[0] => {
    return {
      source: readHistorySource(params),
      phase: readTextTransformPhase(params, 'phase'),
      consumerAgentSessionId: readOptionalString(params, 'consumerAgentSessionId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteTextPipelineOverride(input, ctx.request)),
  'projectHistory': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['projectHistory']>[0] => {
    return {
      entryIds: readOptionalStringArray(params, 'entryIds'),
      streamingEntries: z.array(z.strictObject({ id: z.string().min(1), text: z.string().max(100000), role: z.enum(['user', 'assistant']).optional() })).max(64).optional().parse(params && typeof params === 'object' && !Array.isArray(params) ? params.streamingEntries : undefined),
      extensionTarget: readOptionalInstallationTarget(params, 'extensionTarget'),
      source: readHistorySource(params),
      phase: readTextTransformPhase(params, 'phase'),
      consumerAgentSessionId: readOptionalString(params, 'consumerAgentSessionId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.projectHistory(input)),
  'previewCardOpeningDisplay': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['previewCardOpeningDisplay']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
      presetId: readOptionalString(params, 'presetId'),
      text: readString(params, 'text'),
    }
  })).query(({ ctx, input }) => ctx.runtime.previewCardOpeningDisplay(input)),
  'inspectTextPipeline': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['inspectTextPipeline']>[0] => {
    return {
      source: readHistorySource(params),
      phase: readTextTransformPhase(params, 'phase'),
      consumerAgentSessionId: readOptionalString(params, 'consumerAgentSessionId'),
      traceEntryId: readOptionalString(params, 'traceEntryId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.inspectTextPipeline(input)),
  'extractHistory': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['extractHistory']>[0] => {
    return {
      extensionTarget: readOptionalInstallationTarget(params, 'extensionTarget'),
      source: readHistorySource(params),
      phase: readOptionalTextTransformPhase(params, 'phase'),
      extractorId: readString(params, 'extractorId'),
      consumerAgentSessionId: readOptionalString(params, 'consumerAgentSessionId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.extractHistory(input)),
  'listRenderers': procedure.query(({ ctx }) => ctx.runtime.listRenderers()),
}

function readOptionalRuleOwner(params: JsonValue | undefined): TextTransformRuleDraft['owner'] | undefined {
  if (!isRecord(params) || params.owner === undefined) return undefined
  const owner = readObject(params, 'owner')
  if (owner.kind === 'workspace' || owner.kind === 'user-override') return { kind: owner.kind }
  if (owner.kind === 'card') return { kind: 'card', cardId: readString(owner, 'cardId') }
  if (owner.kind === 'preset') return { kind: 'preset', presetId: readString(owner, 'presetId') }
  if (owner.kind === 'extension') return {
    kind: 'extension', packageId: readString(owner, 'packageId'), moduleId: readOptionalString(owner, 'moduleId'),
  }
  throw new Error('Unsupported Text Transform Rule owner')
}

function readHistorySource(value: JsonValue | undefined) {
  const source = readObject(value, 'source')
  if (source.kind === 'narrative') {
    if (typeof source.timelineId !== 'string' || typeof source.branchId !== 'string') {
      throw new Error('Narrative History source requires timelineId and branchId')
    }
    return { kind: 'narrative' as const, timelineId: source.timelineId, branchId: source.branchId }
  }
  if (source.kind === 'agent-session') {
    if (typeof source.sessionId !== 'string') throw new Error('Agent Session History source requires sessionId')
    return {
      kind: 'agent-session' as const,
      sessionId: source.sessionId,
      ...(typeof source.headEntryId === 'string' ? { headEntryId: source.headEntryId } : {}),
    }
  }
  throw new Error('Unsupported History source')
}

function readTextTransformPhase(value: JsonValue | undefined, key: string): 'classify' | 'prompt' | 'display' {
  const phase = isRecord(value) ? value[key] : undefined
  if (phase === 'classify' || phase === 'prompt' || phase === 'display') return phase
  throw new Error(`Expected Text Transform phase: ${key}`)
}

function readOptionalTextTransformPhase(value: JsonValue | undefined, key: string): 'classify' | 'prompt' | 'display' | undefined {
  const phase = isRecord(value) ? value[key] : undefined
  return phase === undefined ? undefined : readTextTransformPhase(value, key)
}
