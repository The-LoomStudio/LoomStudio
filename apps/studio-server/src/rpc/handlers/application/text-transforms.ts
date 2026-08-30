import type {
  ApplicationRuntime,
  RuntimeRequestContext,
  TextExtractorDraft,
  TextTransformRuleDraft,
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalNumber,
  readString,
} from '../../rpc-params.js'

export async function handleTextTransformsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.listTextTransformRules':
      return await runtime.listTextTransformRules() as unknown as JsonValue

    case 'application.getTextTransformRule':
      return await runtime.getTextTransformRule({ ruleId: readString(params, 'ruleId') }) as unknown as JsonValue

    case 'application.upsertTextTransformRule':
      return await runtime.upsertTextTransformRule({
        ruleId: readString(params, 'ruleId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
        rule: readRequiredRecord(params, 'rule') as unknown as TextTransformRuleDraft,
      }, context) as unknown as JsonValue

    case 'application.deleteTextTransformRule':
      return await runtime.deleteTextTransformRule({
        ruleId: readString(params, 'ruleId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      }, context) as unknown as JsonValue

    case 'application.listTextExtractors':
      return await runtime.listTextExtractors() as unknown as JsonValue

    case 'application.getTextExtractor':
      return await runtime.getTextExtractor({ extractorId: readString(params, 'extractorId') }) as unknown as JsonValue

    case 'application.upsertTextExtractor':
      return await runtime.upsertTextExtractor({
        extractorId: readString(params, 'extractorId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
        extractor: readRequiredRecord(params, 'extractor') as unknown as TextExtractorDraft,
      }, context) as unknown as JsonValue

    case 'application.deleteTextExtractor':
      return await runtime.deleteTextExtractor({
        extractorId: readString(params, 'extractorId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      }, context) as unknown as JsonValue

    case 'application.projectHistory':
      return await runtime.projectHistory({
        source: readHistorySource(params),
        phase: readTextTransformPhase(params, 'phase'),
      }) as unknown as JsonValue

    case 'application.extractHistory':
      return await runtime.extractHistory({
        source: readHistorySource(params),
        phase: readOptionalTextTransformPhase(params, 'phase'),
        extractorId: readString(params, 'extractorId'),
      }) as unknown as JsonValue

    case 'application.listRenderers':
      return await runtime.listRenderers() as unknown as JsonValue

    default:
      return undefined
  }
}

function readRequiredRecord(value: JsonValue | undefined, key: string): Record<string, JsonValue> {
  if (!isRecord(value) || !isRecord(value[key])) throw new Error(`Expected object: ${key}`)
  return value[key]
}

function readHistorySource(value: JsonValue | undefined) {
  const source = readRequiredRecord(value, 'source')
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
