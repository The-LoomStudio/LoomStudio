import { readChatAttachments } from '@loom-studio/shared'
import { parseAgentApprovalPolicy } from '@loom-studio/application-runtime'
import type {
  ApplicationRuntime,
  InvokeAgentTurnInput,
  ToolDefinition
} from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { listPresetToolMountsInputSchema, replacePresetToolMountsInputSchema } from '@loom-studio/shared/tool-mounts'
import { getAgentRunService } from '../../../agents/agent-run-service.js'
import {
  isRecord,
  readBoolean,
  readNullableString,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readString,
} from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

export const agentsProcedures = {
  'createAgentPreset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createAgentPreset']>[0] => {
    return {
      name: readString(params, 'name'),
      model: readOptionalProviderModelSelection(params, 'model'),
      delivery: readOptionalDelivery(params),
      historyPolicy: readOptionalHistoryPolicy(params),
      approvalPolicy: parseAgentApprovalPolicy(isRecord(params) ? params.approvalPolicy : undefined),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createAgentPreset(input, ctx.request)),
  'getAgentPreset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getAgentPreset']>[0] => {
    return { agentPresetId: readString(params, 'agentPresetId') }
  })).query(({ ctx, input }) => ctx.runtime.getAgentPreset(input)),
  'listAgentPresets': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listAgentPresets']>[0] => {
    return {
      cursor: readOptionalString(params, 'cursor'), limit: readOptionalNumber(params, 'limit'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listAgentPresets(input)),
  'updateAgentPreset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateAgentPreset']>[0] => {
    return {
      agentPresetId: readString(params, 'agentPresetId'),
      expectedVersion: readNumber(params, 'expectedVersion'),
      name: readOptionalString(params, 'name'),
      model: isRecord(params) && params.model === null ? null : readOptionalProviderModelSelection(params, 'model'),
      delivery: readOptionalDelivery(params),
      historyPolicy: readOptionalHistoryPolicy(params),
      approvalPolicy: parseAgentApprovalPolicy(isRecord(params) ? params.approvalPolicy : undefined),
      useCardLore: readOptionalBoolean(params, 'useCardLore'),
      useGlobalLore: readOptionalBoolean(params, 'useGlobalLore'),
      textUses: readPresetTextUses(params),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateAgentPreset(input, ctx.request)),
  'deleteAgentPreset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteAgentPreset']>[0] => {
    return { agentPresetId: readString(params, 'agentPresetId') }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteAgentPreset(input, ctx.request)),
  'listAgentTools': procedure.query(({ ctx }) => ctx.runtime.listAgentTools()),
  'updateAgentTool': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateAgentTool']>[0] => {
    return {
      toolId: readString(params, 'toolId'),
      expectedVersion: readNumber(params, 'expectedVersion'),
      definition: readAgentToolDefinition(params),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateAgentTool(input, ctx.request)),
  'listPresetToolMounts': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listPresetToolMounts']>[0] => {
    return listPresetToolMountsInputSchema.parse(params ?? {})
  })).query(({ ctx, input }) => ctx.runtime.listPresetToolMounts(input)),
  'replacePresetToolMounts': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['replacePresetToolMounts']>[0] => {
    return replacePresetToolMountsInputSchema.parse(params)
  })).mutation(({ ctx, input }) => ctx.runtime.replacePresetToolMounts(input, ctx.request)),
  'createAgentSession': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createAgentSession']>[0] => {
    return {
      agentPresetId: readString(params, 'agentPresetId'),
      timelineId: readOptionalString(params, 'timelineId'),
      title: readOptionalString(params, 'title'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createAgentSession(input, ctx.request)),
  'listAgentSessions': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listAgentSessions']>[0] => {
    return {
      agentPresetId: readOptionalString(params, 'agentPresetId'),
      timelineId: readOptionalString(params, 'timelineId'),
      standalone: readOptionalBoolean(params, 'standalone'),
      includeTimelines: readOptionalBoolean(params, 'includeTimelines'),
      cursor: readOptionalString(params, 'cursor'),
      limit: readOptionalNumber(params, 'limit'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listAgentSessions(input)),
  'getAgentSession': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getAgentSession']>[0] => {
    return {
      agentSessionId: readString(params, 'agentSessionId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getAgentSession(input)),
  'getAgentTranscriptPage': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getAgentTranscriptPage']>[0] => ({ agentSessionId: readString(params, 'agentSessionId'), cursor: readOptionalString(params, 'cursor'), limit: readOptionalNumber(params, 'limit'), selectedCandidates: readOptionalBoolean(params, 'selectedCandidates') }))).query(({ ctx, input }) => ctx.runtime.getAgentTranscriptPage(input)),
  'deleteAgentSession': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteAgentSession']>[0] => {
    return {
      agentSessionId: readString(params, 'agentSessionId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deleteAgentSession(input, ctx.request)),
  'summarizeAgentSession': procedure.input(jsonInput((params: JsonValue | undefined) => ({ agentSessionId: readString(params, 'agentSessionId'), branchId: readOptionalString(params, 'branchId') }))).mutation(({ ctx, input }) => ctx.runtime.summarizeAgentSession(input, ctx.request)),
  'cancelAgentSessionSummary': procedure.input(jsonInput((params: JsonValue | undefined) => ({ agentSessionId: readString(params, 'agentSessionId') }))).mutation(({ ctx, input }) => ctx.runtime.cancelAgentSessionSummary(input)),
  'updateAgentSessionSummary': procedure.input(jsonInput((params: JsonValue | undefined) => ({ agentSessionId: readString(params, 'agentSessionId'), branchId: readOptionalString(params, 'branchId'), expectedSummaryId: readString(params, 'expectedSummaryId'), expectedEntryCount: readNumber(params, 'expectedEntryCount'), content: readString(params, 'content') }))).mutation(({ ctx, input }) => ctx.runtime.updateAgentSessionSummary(input, ctx.request)),
  'getAgentSessionMemory': procedure.input(jsonInput((params: JsonValue | undefined) => ({ agentSessionId: readString(params, 'agentSessionId'), branchId: readOptionalString(params, 'branchId') }))).query(({ ctx, input }) => ctx.runtime.getAgentSessionMemory(input)),
  'listAgentSessionSummaryTasks': procedure.input(jsonInput((params: JsonValue | undefined) => ({ agentSessionId: readString(params, 'agentSessionId') }))).query(({ ctx, input }) => ctx.runtime.listAgentSessionSummaryTasks(input)),
  'getAgentSessionSummaryStatus': procedure.input(jsonInput((params: JsonValue | undefined) => ({ agentSessionId: readString(params, 'agentSessionId') }))).query(({ ctx, input }) => ctx.runtime.getAgentSessionSummaryStatus(input)),
  'completeAgentSessionHandoff': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['completeAgentSessionHandoff']>[0] => ({ agentSessionId: readString(params, 'agentSessionId'), expectedEntryCount: readNumber(params, 'expectedEntryCount'), summary: readString(params, 'summary'), branchId: readOptionalString(params, 'branchId') }))).mutation(({ ctx, input }) => ctx.runtime.completeAgentSessionHandoff(input, ctx.request)),
  'updateAgentSession': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateAgentSession']>[0] => {
    const summaryPolicy = readOptionalObject(params, 'summaryPolicy')
    return {
      ...(summaryPolicy ? { summaryPolicy: {
        enabled: readBoolean(summaryPolicy, 'enabled'), asynchronous: readBoolean(summaryPolicy, 'asynchronous'),
        maxTokens: readNumber(summaryPolicy, 'maxTokens'), bufferFloors: readNumber(summaryPolicy, 'bufferFloors'),
        triggerFloors: readNumber(summaryPolicy, 'triggerFloors'), triggerTokens: readNumber(summaryPolicy, 'triggerTokens'),
      } } : {}),
      agentSessionId: readString(params, 'agentSessionId'),
      title: readOptionalString(params, 'title'),
      ...(isRecord(params) && params.agentPresetId !== undefined ? { agentPresetId: readString(params, 'agentPresetId') } : {}),
      ...(isRecord(params) && params.narrativeMode !== undefined ? { narrativeMode: readNarrativeMode(params.narrativeMode) } : {}),
      ...(isRecord(params) && params.timelineId !== undefined
        ? { timelineId: readNullableString(params, 'timelineId') }
        : {}),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateAgentSession(input, ctx.request)),
  'invokeAgentTurn': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['invokeAgentTurn']>[0] => {
    return readAgentTurnInput(params)
  })).mutation(({ ctx, input }) => ctx.runtime.invokeAgentTurn(input, ctx.request)),
  'agent.run.list': procedure.input(jsonInput((params: JsonValue | undefined): { timelineId?: string } => ({ timelineId: readOptionalString(params, 'timelineId') }))).query(({ ctx, input }) => getAgentRunService(ctx.runtime).list(input)),
  'reviseAgentInput': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['reviseAgentInput']>[0] => ({
    agentSessionId: readString(params, 'agentSessionId'), entryId: readString(params, 'entryId'),
    expectedContent: readString(params, 'expectedContent'), content: readString(params, 'content'),
    expectedAttachments: readChatAttachments(isRecord(params) ? params.expectedAttachments : undefined),
    attachments: readChatAttachments(isRecord(params) ? params.attachments : undefined),
  }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).reviseInput(input, ctx.request)),
  'submitAgentInterjection': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['submitAgentInterjection']>[0] => {
    const mode = readString(params, 'mode')
    if (mode !== 'discussion' && mode !== 'narrative') throw new Error('Invalid interjection mode')
    const target = readOptionalObject(params, 'narrativeTarget')
    return { agentSessionId: readString(params, 'agentSessionId'), requestId: readString(params, 'requestId'),
      input: readString(params, 'input'),
      attachments: readChatAttachments(isRecord(params) ? params.attachments : undefined), mode,
      macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
      activationFacts: readOptionalObject(params, 'activationFacts'),
      ...(target ? { narrativeTarget: { timelineId: readString(target, 'timelineId'), branchId: readString(target, 'branchId') } } : {}) }
  })).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).interject(input, ctx.request)),
  'agent.run.create': procedure.input(jsonInput(readAgentTurnInput)).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).create(input, ctx.request)),
  'agent.run.subscribe': procedure.input(jsonInput((params: JsonValue | undefined): { runId: string; cursor?: number; agentSessionId?: string } => ({ runId: readString(params, 'runId'), cursor: readOptionalNumber(params, 'cursor'), agentSessionId: readOptionalString(params, 'agentSessionId') }))).query(({ ctx, input }) => getAgentRunService(ctx.runtime).subscribe(input.runId, input.cursor, input.agentSessionId)),
  'agent.run.acknowledge-completion': procedure.input(jsonInput((params: JsonValue | undefined) => ({ runId: readString(params, 'runId') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).acknowledgeCompletion(input.runId)),
  'agent.run.cancel': procedure.input(jsonInput((params: JsonValue | undefined): { runId: string; reason?: string } => ({ runId: readString(params, 'runId'), reason: readOptionalString(params, 'reason') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).cancel(input.runId, input.reason ?? 'cancelled')),
  'agent.run.pause': procedure.input(jsonInput((params: JsonValue | undefined) => ({ runId: readString(params, 'runId') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).cancel(input.runId, 'user-pause')),
  'agent.run.history-read-approval': procedure.input(jsonInput((params: JsonValue | undefined): { runId: string; requestId: string; allow: boolean; reason?: string } => ({ runId: readString(params, 'runId'), requestId: readString(params, 'requestId'), allow: readBoolean(params, 'allow'), reason: readOptionalString(params, 'reason') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).approve(input.runId, input.requestId, 'history-read', input.allow, input.reason)),
  'agent.run.mutation-approval': procedure.input(jsonInput((params: JsonValue | undefined): { runId: string; requestId: string; allow: boolean; reason?: string } => ({ runId: readString(params, 'runId'), requestId: readString(params, 'requestId'), allow: readBoolean(params, 'allow'), reason: readOptionalString(params, 'reason') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).approve(input.runId, input.requestId, 'mutation', input.allow, input.reason)),
  'agent.run.abandon': procedure.input(jsonInput((params: JsonValue | undefined) => ({ runId: readString(params, 'runId'), agentSessionId: readOptionalString(params, 'agentSessionId') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).abandon(input.runId, ctx.request, input.agentSessionId)),
  'agent.run.resume': procedure.input(jsonInput((params: JsonValue | undefined): { runId?: string; agentSessionId?: string } => ({ runId: readOptionalString(params, 'runId'), agentSessionId: readOptionalString(params, 'agentSessionId') }))).mutation(({ ctx, input }) => getAgentRunService(ctx.runtime).resume(input, ctx.request)),
  'agent.run.state': procedure.input(jsonInput((params: JsonValue | undefined) => ({ runId: readString(params, 'runId'), agentSessionId: readOptionalString(params, 'agentSessionId') }))).query(({ ctx, input }) => getAgentRunService(ctx.runtime).state(input.runId, input.agentSessionId)),
  'previewAgentTurn': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['previewAgentTurn']>[0] => {
    return readAgentTurnInput(params)
  })).query(({ ctx, input }) => ctx.runtime.previewAgentTurn(input, ctx.request)),
  'inspectMacros': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['inspectMacros']>[0] => {
    return {
      cardId: readOptionalString(params, 'cardId'),
      presetId: readOptionalString(params, 'presetId'),
      timelineTarget: readOptionalMacroTimelineTarget(params),
      macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
    }
  })).query(({ ctx, input }) => ctx.runtime.inspectMacros(input)),
  'getTimelinePresetConfig': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getTimelinePresetConfig']>[0] => {
    return {
      timelineId: readString(params, 'timelineId'),
      presetId: readString(params, 'presetId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getTimelinePresetConfig(input)),
  'updateTimelinePresetConfig': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateTimelinePresetConfig']>[0] => {
    return {
      timelineId: readString(params, 'timelineId'),
      presetId: readString(params, 'presetId'),
      expectedVersion: readNumber(params, 'expectedVersion'),
      macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap,
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateTimelinePresetConfig(input, ctx.request)),
}

function readPresetTextUses(params: JsonValue | undefined): Array<{ id: string; kind: 'rule' | 'extractor'; enabled: boolean; orderIndex?: number }> | undefined {
  if (!isRecord(params) || params.textUses === undefined) return undefined
  if (!Array.isArray(params.textUses)) throw new Error('Preset textUses must be an array')
  return params.textUses.map(value => {
    if (!isRecord(value) || (value.kind !== 'rule' && value.kind !== 'extractor')) throw new Error('Invalid Preset text use')
    return {
      id: readString(value, 'id'),
      kind: value.kind,
      enabled: readBoolean(value, 'enabled'),
      orderIndex: readOptionalNumber(value, 'orderIndex'),
    }
  })
}

function readAgentToolDefinition(params: JsonValue | undefined): ToolDefinition {
  const definition = readOptionalObject(params, 'definition')
  if (!definition) throw new Error('Expected agent tool definition: definition')
  // ponytail: updateAgentTool immediately validates this definition with the registry before
  // persisting it. Replace this bridge when that validator accepts unknown and narrows its result.
  return definition as unknown as ToolDefinition
}

function readOptionalProviderModelSelection(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value) || typeof value.providerProfileId !== 'string' || typeof value.modelId !== 'string') {
    throw new Error(`Expected Provider model selection param: ${key}`)
  }
  return { providerProfileId: value.providerProfileId, modelId: value.modelId }
}

function readOptionalDelivery(params: JsonValue | undefined): 'stream' | 'complete' | undefined {
  if (!isRecord(params) || params.delivery === undefined) return undefined
  if (params.delivery !== 'stream' && params.delivery !== 'complete') {
    throw new Error('Expected Agent delivery: stream or complete')
  }
  return params.delivery
}

function readOptionalHistoryPolicy(params: JsonValue | undefined): 'persistent' | 'ephemeral' | undefined {
  if (!isRecord(params) || params.historyPolicy === undefined) return undefined
  if (params.historyPolicy !== 'persistent' && params.historyPolicy !== 'ephemeral') {
    throw new Error('Expected Agent historyPolicy: persistent or ephemeral')
  }
  return params.historyPolicy
}

function readOptionalNarrativeTarget(params: JsonValue | undefined): InvokeAgentTurnInput['narrativeTarget'] {
  const value = readOptionalObject(params, 'narrativeTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: narrativeTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.branchId')
  }
  if (value.inputNodeId !== undefined && typeof value.inputNodeId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.inputNodeId')
  }
  const sourceNodeId = readOptionalString(value, 'sourceNodeId')
  const swipeValue = readOptionalObject(value, 'swipe')
  let swipe: NonNullable<InvokeAgentTurnInput['narrativeTarget']>['swipe']
  if (swipeValue !== undefined) {
    const mode = readString(swipeValue, 'mode')
    if (mode !== 'swipe' && mode !== 'regenerate' && mode !== 'retry') {
      throw new Error('Expected narrativeTarget.swipe.mode: swipe, regenerate or retry')
    }
    const expectedRevision = readNumber(swipeValue, 'expectedRevision')
    if (!Number.isInteger(expectedRevision)) throw new Error('Expected integer param: narrativeTarget.swipe.expectedRevision')
    swipe = {
      groupId: readString(swipeValue, 'groupId'),
      mode,
      expectedRevision,
      allowSessionChange: readOptionalBoolean(swipeValue, 'allowSessionChange'),
      input: readOptionalString(swipeValue, 'input'),
    }
  }
  return {
    timelineId: value.timelineId,
    ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}),
    ...(typeof value.inputNodeId === 'string' ? { inputNodeId: value.inputNodeId } : {}),
    ...(sourceNodeId !== undefined ? { sourceNodeId } : {}),
    ...(swipe !== undefined ? { swipe } : {}),
  }
}

function readOptionalMacroTimelineTarget(params: JsonValue | undefined): { timelineId: string; branchId?: string } | undefined {
  const value = readOptionalObject(params, 'timelineTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: timelineTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') throw new Error('Expected optional string param: timelineTarget.branchId')
  return { timelineId: value.timelineId, ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}) }
}

function readAgentTurnInput(params: JsonValue | undefined): InvokeAgentTurnInput {
  const retry = readOptionalObject(params, 'retry')
  return {
    requestId: readOptionalString(params, 'requestId'),
    agentSessionId: readString(params, 'agentSessionId'),
    input: readString(params, 'input'),
    attachments: readChatAttachments(isRecord(params) ? params.attachments : undefined),
    ...(retry ? { retry: { entryId: readString(retry, 'entryId') } } : {}),
    activationFacts: readOptionalObject(params, 'activationFacts'),
    narrativeTarget: readOptionalNarrativeTarget(params),
    macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
    promptAddition: readOptionalObject(params, 'promptAddition') as InvokeAgentTurnInput['promptAddition'],
  }
}

function readNarrativeMode(value: unknown): 'declared' | 'automatic' {
  if (value !== 'declared' && value !== 'automatic') throw new Error('Invalid Narrative mode')
  return value
}
