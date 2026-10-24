import { measureObservationSize } from '../observability/store.js'
import { observationRequest } from '../observability/gateway.js'
import type { ObservationRequest } from '../observability/types.js'
import { createHash } from 'node:crypto'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { estimateRequestTokens } from '@loom-studio/ai-gateway'
import type {
  AgentStore,
  AgentTranscriptEntry,
  AgentTranscriptEntryData,
  AgentSession,
} from '@loom-studio/application-data'
import type { PresetToolMount } from '@loom-studio/application-data'
import { readLogFailure } from '@loom-studio/logging'
import type { ChatMessage, JsonObject, JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { VariableRenderContext } from '../prompt/variables.js'
import {
  type PromptContribution,
  type SourceNode,
} from '../prompt/prompt-builder.js'
import type {
  ToolDefinition,
  ToolExecutionScope,
  ToolInvocation,
  ToolResult,
  ToolDiagnostic,
} from './tool-registry.js'
import {
  compileToolPromptSources,
  type CompiledToolExposure,
  type ToolPromptBuildTrace,
  type ToolPromptSource,
} from './tool-prompt-build.js'
import type { ActivationFacts } from '../prompt/prompt-activation.js'
import type {
  GatewayChatResult,
  ProviderModelSelection,
  RuntimeRequestContext,
  InvokeAgentTurnInput,
} from '../types.js'
import type { TextTransformRuleEntry } from '../transforms/history-text.js'
import { codeActToolIds } from './codeact/prompts.js'
import { classifyAssistantContent, decodeToolResponse, encodeToolResultMessage, scanContentTools } from './tool-response-protocol.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { isExtensionResourceAvailable, readAvailableExtensionInstallations } from '../runtime/extension-resource-access.js'
import type { AgentToolContent } from '../types.js'
import { encodeRunRecovery, type AgentRunRecoveryCheckpoint } from './run-recovery.js'
import { applyApplicationStateMutation, type ApplicationStateContext } from '../state/state.js'
import { guardNarrativeWrite } from '../runtime/swipe-runtime.js'
import { prepareStateContent } from '../state/process-state-content.js'
import { beginTimelineExtensionWork, assertTimelineExtensionLease } from '../extensions/timeline-participation.js'
import { collectPromptExtensionDependencies } from '../extensions/prompt-dependencies.js'

const MAX_OBSERVED_TOOLS = 128
const MAX_OBSERVED_TOOL_EVENTS = 128
const MAX_OBSERVED_TOOL_BYTES = 1024 * 1024

const safeToolCodes = new Set(['tool.unknown', 'tool.transport_mismatch', 'tool.approval_failed', 'tool.denied', 'tool.timeout', 'tool.aborted', 'codeact.source_transformed', 'codeact.incomplete_step'])

export type AgentRunProgress = {
  stage: string
  providerStep: number
  toolCount: number
  suspended: boolean
}

export type NativeToolLoopResult = {
  session: AgentSession
  userEntry: AgentTranscriptEntry
  assistantEntry: AgentTranscriptEntry
  providerResult: GatewayChatResult
  toolPromptBuildTrace: ToolPromptBuildTrace
  changesetId: string
}

export type CompiledAgentToolSet = {
  tools: Array<{
    exposure: CompiledToolExposure
    definition: ToolDefinition
    mount: PresetToolMount
    transport: CompiledToolExposure['transport']
  }>
  trace: ToolPromptBuildTrace
}

export type ContentToolPromptRuntimeInputs = {
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
}

type AgentToolResolutionContext = Pick<ApplicationRuntimeContext, 'agentTools' | 'documents' | 'providerAdapters'>
type NativeToolLoopContext = ApplicationStateContext & Pick<ApplicationRuntimeContext, 'agentTools' | 'createId' | 'gateway' | 'runtimeLogger' | 'stateContent' | 'swipes'> & Partial<Pick<ApplicationRuntimeContext, 'observations'>>

export async function compileAgentToolSet(input: {
  ctx: AgentToolResolutionContext
  model: ProviderModelSelection
  toolMounts: PresetToolMount[]
  availableExtensionInstallations?: ReadonlyMap<string, string>
  cardId?: string
  variables: VariableRenderContext
  currentInput: string
  activationFacts?: ActivationFacts
}): Promise<CompiledAgentToolSet> {
  const enabledMounts: PresetToolMount[] = []
  const unavailableDiagnostics: ToolDiagnostic[] = []
  for (const mount of input.toolMounts.filter(mount => mount.defaultEnabled)) {
    const document = await input.ctx.documents.get(mount.toolId)
    if (document?.type === applicationDocumentTypes.agentTool
      && !isExtensionResourceAvailable((document.content as AgentToolContent).origin, input.availableExtensionInstallations)) {
      const origin = (document.content as AgentToolContent).origin!
      const belongsToContext = origin.installationId === extensionInstallationId(origin.packageId, { kind: 'global' })
        || (input.cardId !== undefined && origin.installationId === extensionInstallationId(origin.packageId, { kind: 'card', cardId: input.cardId }))
      if (!belongsToContext) throw new Error(`Agent Tool is not available in this context: ${mount.toolId}`)
      unavailableDiagnostics.push({
        severity: 'warning', code: 'tool.source_unavailable', toolId: mount.toolId,
        message: 'Skipped a tool whose extension source is unavailable in this story; its mount is retained.',
      })
      continue
    }
    enabledMounts.push(mount)
  }
  const { tools: resolvedTools, diagnostics } = await resolveTools(
    input.ctx,
    input.model,
    enabledMounts.map(mount => mount.toolId),
  )
  const mountsByToolId = new Map(enabledMounts.map(mount => [mount.toolId, mount]))
  const toolPromptBuild = compileToolPromptSources({
    sources: resolvedTools.map(({ definition, transport }) => {
      const mount = mountsByToolId.get(definition.id)!
      const content = mount.content ?? {}
      const providerOrder = mount.provider?.order
      return {
        tool: definition,
        template: {
          description: definition.description,
          ...(definition.prompt?.parameterDescriptions
            ? { parameterDescriptions: definition.prompt.parameterDescriptions }
            : {}),
          ...(definition.prompt?.guidance
            ? { guidance: definition.prompt.guidance }
            : {}),
        },
        activation: mount.activation as ToolPromptSource['activation'],
        ...(transport === 'content' || providerOrder === undefined
          ? {}
          : { providerOrder }),
        ...(transport !== 'content'
          ? {}
          : {
              contentPlacement: {
                targetAnchorId: content.targetAnchorId ?? '@chat.tools',
                localDepth: content.localDepth ?? 0,
              },
            }),
        transport,
      }
    }),
    variables: input.variables,
    currentInput: input.currentInput,
    activationFacts: input.activationFacts,
  })
  const definitionsById = new Map(
    resolvedTools.map((tool) => [tool.definition.id, tool.definition]),
  )
  return {
    tools: toolPromptBuild.exposures.map((exposure) => ({
      exposure,
      definition: definitionsById.get(exposure.toolId)!,
      mount: mountsByToolId.get(exposure.toolId)!,
      transport: exposure.transport,
    })),
    trace: { ...toolPromptBuild.trace, diagnostics: [...unavailableDiagnostics, ...diagnostics] },
  }
}

export function createContentToolPromptRuntimeInputs(
  toolSet: CompiledAgentToolSet,
): ContentToolPromptRuntimeInputs {
  const contentTools = toolSet.tools.filter(
    (tool) => tool.transport === 'content',
  )
  const groups = new Map<string, {
    targetAnchorId: string
    localDepth: number
    tools: CompiledToolExposure[]
  }>()
  for (const tool of contentTools) {
    const content = tool.mount.content ?? {}
    const targetAnchorId = content.targetAnchorId ?? '@chat.tools'
    const localDepth = content.localDepth ?? 0
    const key = JSON.stringify([targetAnchorId, localDepth])
    const group = groups.get(key) ?? {
      targetAnchorId,
      localDepth,
      tools: [],
    }
    group.tools.push(tool.exposure)
    groups.set(key, group)
  }

  const sourceId = 'runtime.agent-tools'
  const sourceNodes: SourceNode[] = groups.size === 0
    ? []
    : [{
        id: sourceId,
        sourceId,
        parentId: null,
        displayName: 'Agent Tools',
        orderIndex: 0,
        kind: 'folder',
      }]
  const contributions: PromptContribution[] = []
  
  // Convert map to array to give them orderIndex
  for (const [index, group] of [...groups.values()].entries()) {
    const sourceNodeId = `${sourceId}.group.${index}`
    sourceNodes.push({
      id: sourceNodeId,
      sourceId,
      parentId: sourceId,
      displayName: `Tools at ${group.targetAnchorId}`,
      orderIndex: index + 1,
      kind: 'entry',
    })
    contributions.push({
      id: `${sourceId}.contribution.${index}`,
      sourceRef: { kind: 'runtime', sourceId, sourceNodeId },
      content: renderContentToolInstructions(group.tools),
      capabilities: {
        targetAnchorId: group.targetAnchorId,
        localDepth: group.localDepth,
      },
    })
  }
  const codeAct = toolSet.tools.find(tool => codeActToolIds.has(tool.definition.id))
  if (codeAct) {
    const sourceId = 'runtime.codeact.instructions'
    sourceNodes.push({
      id: sourceId, sourceId, parentId: null, displayName: 'CodeAct', kind: 'entry', orderIndex: 0,
    })
    contributions.push({
      id: sourceId,
      sourceRef: { kind: 'runtime', sourceId, sourceNodeId: sourceId },
      content: codeAct.exposure.prompt.guidance ?? '',
      capabilities: {
        targetAnchorId: codeAct.mount.content?.targetAnchorId ?? '@chat.tools',
        localDepth: codeAct.mount.content?.localDepth ?? 0,
      },
    })
  }
  return { sourceNodes, contributions }
}

export function createNativeToolSpecs(toolSet: CompiledAgentToolSet) {
  return toolSet.tools.filter(tool => tool.transport === 'native-function').map(({ exposure }) => ({
    name: exposure.name,
    description: renderNativeToolDescription(exposure),
    inputSchema: readNativeSchema(exposure),
  }))
}

type NativeToolLoopInput = {
  ctx: NativeToolLoopContext
  agents: AgentStore
  session: AgentSession
  runId: string
  buildId?: string
  model: ProviderModelSelection
  tokenMultiplier?: number
  initialMessages: ChatMessage[]
  recoveryRequest: InvokeAgentTurnInput
  processedPrompt?: AgentRunRecoveryCheckpoint['processedPrompt']
  promptExtensionLeases?: AgentRunRecoveryCheckpoint['promptExtensionLeases']
  userInput: string
  compiledToolSet: CompiledAgentToolSet
  toolExecutionScope?: ToolExecutionScope
  branchId: string
  purpose: 'agent' | 'narrative'
  classificationRules?: TextTransformRuleEntry[]
  requestContext?: RuntimeRequestContext
  delivery?: 'stream' | 'complete'
  resumeUserEntry?: AgentTranscriptEntry
  resumeAssistantEntryId?: string
  progress?: AgentRunProgress
}

export async function runNativeToolLoop(input: NativeToolLoopInput): Promise<NativeToolLoopResult> {
  const scopes: Array<Awaited<ReturnType<typeof beginTimelineExtensionWork>>> = []
  const controller = new AbortController()
  const promptExtensionLeases = [...(input.promptExtensionLeases ?? [])]
  const extensionLeases = [...(input.requestContext?.extensionLeases ?? []), ...promptExtensionLeases]
  const abortSignal = input.requestContext?.abortSignal
    ? AbortSignal.any([input.requestContext.abortSignal, controller.signal]) : controller.signal
  const addScope = async (lease: AgentRunRecoveryCheckpoint['promptExtensionLeases'][number]) => {
    const scope = await beginTimelineExtensionWork(input.ctx, { ...lease, lease, signal: abortSignal })
    scopes.push(scope)
    scope.signal.addEventListener('abort', () => controller.abort(scope.signal.reason), { once: true })
    scope.signal.throwIfAborted()
  }
  const guarded = <T>(work: () => Promise<T>) => scopes.reduceRight<() => Promise<T>>(
    (next, scope) => () => scope.run(next), work,
  )()
  try {
    for (const lease of promptExtensionLeases) await addScope(lease)
    return await runToolLoop({
      ...input, promptExtensionLeases,
      requestContext: {
        ...input.requestContext, abortSignal, extensionLeases,
      },
    }, guarded, async work => {
      const consumed = await collectPromptExtensionDependencies(input.ctx, async () => {
        const timelineId = input.recoveryRequest.narrativeTarget?.timelineId
        const timeline = timelineId ? await input.ctx.narratives?.getTimeline(timelineId) : undefined
        const available = await readAvailableExtensionInstallations(input.ctx.documents, timeline?.createdFrom?.cardId, timelineId ?? null)
        if (input.toolExecutionScope) input.toolExecutionScope.availableExtensionInstallations = available
        return { result: await guarded(work) }
      })
      for (const lease of consumed.promptExtensionLeases) {
        if (promptExtensionLeases.some(existing => existing.installationId === lease.installationId)) continue
        await addScope(lease)
        promptExtensionLeases.push(lease)
        extensionLeases.push(lease)
      }
      return consumed.result
    })
  } finally {
    for (const scope of scopes) scope.dispose()
  }
}

async function runToolLoop(
  input: NativeToolLoopInput,
  runTool: <T>(work: () => Promise<T>) => Promise<T>,
  runInvocation: (work: () => Promise<ToolResult>) => Promise<ToolResult>,
): Promise<NativeToolLoopResult> {
  const progress = input.progress ?? { stage: 'transcript', providerStep: 0, toolCount: 0, suspended: false }
  progress.stage = 'transcript'
  const stepLogger = input.ctx.runtimeLogger?.child('step')
  const toolLogger = input.ctx.runtimeLogger?.child('tool')
  const logContext = {
    correlationId: input.requestContext?.correlationId,
    callId: input.requestContext?.callId,
    parentCallId: input.requestContext?.parentCallId,
  }
  const references = { runId: input.runId, sessionId: input.session.id }
  let stepStartedAt: number | undefined
  let activeTool: { invocationId: string; toolId: string; toolName: string; startedAt: number } | undefined
  let session = input.session
  let lastChangesetId = ''
  let measurementId: string | undefined
  let toolExecutions: NonNullable<ObservationRequest['toolExecutions']> = []
  let observedToolEventCount = 0
  let observedToolBytes = 0
  const tools = input.compiledToolSet.tools
  const contentTools = tools.filter((tool) => tool.transport === 'content')
  const providerMessages = [...input.initialMessages]
  let freshContextMessages: ChatMessage[] = []
  let checkpointMessages = [...input.initialMessages]
  let continuationAssistantEntryId = input.resumeAssistantEntryId
  const toolSpecs = createNativeToolSpecs(input.compiledToolSet)
  const toolContract = createHash('sha256').update(JSON.stringify(input.compiledToolSet.tools.map(tool => ({
    id: tool.definition.id, exposure: tool.exposure, transport: tool.transport,
  })))).digest('hex')
  const continuation = input.requestContext?.agentRun?.continuation
  let acceptedContent = continuation?.recovery?.acceptedContent
  let pendingAssistantContent = continuation?.recovery?.pendingAssistantContent ?? ''
  let nextRecoveryStep = continuation?.recovery?.nextProviderStep ?? 1
  if (continuation?.recovery && continuation.recovery.toolContract !== toolContract) {
    throw Object.assign(new Error('Agent tool contract changed since the checkpoint'), { code: 'agent.recovery_tools_changed' })
  }
  if (continuation?.recovery?.phase === 'tools') {
    throw Object.assign(new Error('The interrupted tool outcome is unknown; side effects will not be repeated'), {
      code: 'agent.recovery_tool_outcome_unknown',
    })
  }
  const userEntryId = input.resumeUserEntry?.id ?? input.ctx.createId('agent-entry')
  function recovery(phase: AgentRunRecoveryCheckpoint['phase'], messages: ChatMessage[], nextProviderStep: number) {
    return encodeRunRecovery({
      version: 1, phase, executor: { pid: process.pid, id: input.runId },
      request: input.recoveryRequest,
      ...(input.requestContext?.agentRun?.sendRequestDigest ?? continuation?.recovery?.sendRequestDigest
        ? { sendRequestDigest: input.requestContext?.agentRun?.sendRequestDigest ?? continuation?.recovery?.sendRequestDigest } : {}),
      model: input.model, toolContract,
      ...(input.toolExecutionScope?.narrativeSource ? { narrativeSource: input.toolExecutionScope.narrativeSource } : {}),
      messages, userEntryId, nextProviderStep,
      promptExtensionLeases: input.promptExtensionLeases ?? [],
      ...(input.processedPrompt ? { processedPrompt: input.processedPrompt } : {}),
      ...(pendingAssistantContent ? { pendingAssistantContent } : {}),
      ...(phase === 'content' && acceptedContent ? { acceptedContent } : {}),
      ...(continuationAssistantEntryId ? { partialEntryId: continuationAssistantEntryId } : {}),
    })
  }
  const byExposedName = new Map(
    tools.map((tool) => [tool.definition.name, tool] as const),
  )
  let streamedText = ''
  let streamedReasoning = ''
  const streamedToolInputs = new Map<string, { toolName?: string; input: string }>()
  const pendingTools = new Map<string, { invocation: ToolInvocation; render: (result: ToolResult) => ChatMessage }>()

  const initial = input.resumeUserEntry
    ? await append([{
        kind: 'run-state', state: 'running',
        sourceRunId: input.requestContext?.agentRun?.continuation?.sourceRunId,
        recovery: recovery(acceptedContent ? 'content' : 'provider', providerMessages, continuation?.recovery?.nextProviderStep ?? 1),
      }], undefined, continuation?.recovery ? continuation : undefined)
    : await append([
        { kind: 'message', role: 'user', content: input.userInput },
        { kind: 'run-state', state: 'running', recovery: recovery('provider', providerMessages, 1) },
      ], userEntryId)
  const userEntry = input.resumeUserEntry ?? initial.entries[0]!

  try {
    if (acceptedContent) return await finishAcceptedContent()
    for (let step = continuation?.recovery?.nextProviderStep ?? 1; ; step += 1) {
      nextRecoveryStep = step
      progress.providerStep = step
      progress.stage = 'provider'
      stepStartedAt = performance.now()
      stepLogger?.info(`Step ${step} started`, {
        event: 'step.started', ...logContext,
        data: { ...references, providerStep: step, outcome: 'running', modelId: input.model.modelId },
      })
      if (input.requestContext?.abortSignal?.aborted)
        throw createAbortError(input.requestContext.abortSignal.reason)
      const stepMessages = [...providerMessages, ...freshContextMessages]
      checkpointMessages = [...stepMessages]
      freshContextMessages = []
      measurementId = input.ctx.createId('measurement')
      toolExecutions = []
      observedToolEventCount = 0
      observedToolBytes = 0
      let estimate: ReturnType<typeof estimateRequestTokens> | undefined
      const measure = () => { estimate = estimateRequestTokens({ messages: stepMessages, tools: toolSpecs }, { multiplier: input.tokenMultiplier }) }
      if (input.ctx.observations) input.ctx.observations.capture(measure)
      else { try { measure() } catch { /* Legacy measurement remains best effort without the workbench store. */ } }
      input.ctx.observations?.capture(() => input.ctx.observations!.write({
        id: measurementId!, kind: 'request', parentId: input.runId, title: `Step ${step}`, status: 'running',
        agentSessionId: session.id, branchId: input.branchId, buildId: input.buildId, providerStep: step,
        timelineId: input.recoveryRequest.narrativeTarget?.timelineId,
        request: { preparedMessages: stepMessages, messages: stepMessages, tools: toolSpecs, toolChoice: toolSpecs.length ? 'auto' : undefined,
          model: input.model, delivery: input.delivery ?? 'stream', phase: 'prepared',
          estimate },
      }))
      await appendObservation(() => {
        if (!estimate) return []
        return [{
          kind: 'request-measurement',
          measurementId: measurementId!,
          providerStep: step,
          providerProfileId: input.model.providerProfileId,
          modelId: input.model.modelId,
          requestDigest: createHash('sha256').update(JSON.stringify({ messages: stepMessages, tools: toolSpecs })).digest('hex'),
          scope: estimate.scope,
          count: { baseTokens: estimate.baseTokens, estimatedTokens: estimate.estimatedTokens, basis: estimate.basis },
          uncounted: estimate.uncounted,
        }]
      })
      if (input.requestContext?.abortSignal?.aborted)
        throw createAbortError(input.requestContext.abortSignal.reason)
      await assertPromptDependencies()
      const providerResult = await input.ctx.gateway.invokeChat({
        request: observationRequest({
          messages: stepMessages,
          ...(toolSpecs.length
            ? { tools: toolSpecs, toolChoice: 'auto' as const }
            : {}),
          metadata: {
            observationRequestId: measurementId,
            purpose: input.purpose,
            agentSessionId: session.id,
            runId: input.runId,
            providerStep: step,
          },
        }, measurementId),
        model: input.model,
        runId: input.runId,
        sessionId: session.id,
        branchId: input.branchId,
        ...(input.requestContext ? { context: input.requestContext } : {}),
        ...(input.requestContext?.abortSignal
          ? { abortSignal: input.requestContext.abortSignal }
          : {}),
        delivery: input.delivery ?? 'stream',
        onEvent: event => {
          if (event.type === 'reasoning-delta') streamedReasoning += event.delta
          if (event.type === 'text-delta') streamedText += event.delta
          if (event.type === 'tool-input-delta') {
            const existing = streamedToolInputs.get(event.toolCallId)
            streamedToolInputs.set(event.toolCallId, {
              toolName: event.toolName ?? existing?.toolName,
              input: `${existing?.input ?? ''}${event.delta}`,
            })
          }
          if (event.type !== 'text-delta' && event.type !== 'reasoning-delta' && event.type !== 'tool-input-delta' && event.type !== 'usage') return
          input.requestContext?.agentRun?.onEvent({
            ...event,
            runId: input.requestContext.agentRun.runId,
            providerRunId: event.runId,
            providerStep: step,
          })
        },
      })

      await assertPromptDependencies()
      progress.stage = 'response'
      await appendObservation(() => [{ ...providerObservation(providerResult), measurementId, providerStep: step }])
      const { classified, contentScan, invocationPairs, providerMessage } = decodeToolResponse({
        providerResult, sessionId: session.id, classificationRules: input.classificationRules ?? [],
        byExposedName, contentTools, createInvocationId: () => input.ctx.createId('tool-invocation'),
      })
      checkpointMessages = [...stepMessages, providerMessage]
      input.ctx.observations?.capture(() => {
        input.ctx.observations!.patch(measurementId!, { request: { assistantContent: contentScan.text } })
        toolExecutions = invocationPairs.slice(0, MAX_OBSERVED_TOOLS).map(pair => ({ id: pair.invocation.id,
          name: pair.resolved?.definition.name ?? pair.invocation.toolId,
          ...(retainToolEvidence(pair.invocation) ? { input: pair.invocation } : {}), status: 'queued', transport: pair.transport }))
        if (invocationPairs.length > MAX_OBSERVED_TOOLS) markToolEvidencePartial()
        recordTools()
      })

      const stepEntries: AgentTranscriptEntryData[] = []
      streamedReasoning = providerResult.reasoning ?? streamedReasoning
      if (streamedReasoning) stepEntries.push({ kind: 'reasoning', content: streamedReasoning,
        source: 'provider-native', visibility: 'collapsed', replay: 'omit',
        ...(providerResult.providerCallId ? { providerCallId: providerResult.providerCallId } : {}),
      })
      if (!invocationPairs.length && providerResult.finishReason === 'length' && !providerResult.message.content?.trim())
        throw Object.assign(new Error('Provider reached its output limit without assistant text or tool calls; automatic continuation stopped.'), { code: 'agent.provider_no_progress' })
      for (const reasoning of classified.reasoning) {
        stepEntries.push({
          kind: 'reasoning',
          content: reasoning.content,
          source: 'assistant-content',
          visibility: reasoning.visibility,
          replay: reasoning.replay,
          ...(reasoning.dialect ? { dialect: reasoning.dialect } : {}),
          ...(providerResult.providerCallId ? { providerCallId: providerResult.providerCallId } : {}),
        })
      }
      if (contentScan.text) {
        stepEntries.push({
          kind: 'message',
          role: 'assistant',
          content: contentScan.text,
          ...(continuationAssistantEntryId ? {
            continuesEntryId: continuationAssistantEntryId,
          } : {}),
          ...(providerResult.finishReason === 'length' ? { state: 'partial' as const } : {}),
        })
      }
      for (const pair of invocationPairs) {
        const exposedName =
          pair.transport === 'native-function'
            ? pair.call.function.name
            : pair.exposedName
        stepEntries.push({
          kind: 'tool-invocation',
          invocationId: pair.invocation.id,
          toolId: pair.invocation.toolId,
          exposedName,
          transport: pair.transport,
          arguments: pair.invocation.arguments,
          rawInput: pair.invocation.rawInput,
          providerCallId: pair.invocation.providerCallId,
          providerItemId: pair.invocation.providerItemId,
          status: 'proposed',
        })
      }
      if (invocationPairs.length) stepEntries.push({
        kind: 'run-state', state: 'running', recovery: recovery('tools', checkpointMessages, step),
      })
      const finalResponse = invocationPairs.length === 0 && providerResult.finishReason !== 'error'
        && providerResult.finishReason !== 'length' && Boolean(providerResult.message.content) && Boolean(contentScan.text)
      let contentDiagnostics: string[] = []
      if (finalResponse) {
        const completeText = classifyAssistantContent(pendingAssistantContent + (providerResult.message.content ?? ''),
          session.id, input.classificationRules ?? []).text
        const prepared = await prepareStateContent(input.ctx, {
          assertSource: input.toolExecutionScope?.assertNarrativeSource,
          text: scanContentTools(completeText, contentTools.map(tool => tool.definition.name)).text,
          operationId: `agent-content:${input.runId}:${step}`,
          target: input.recoveryRequest.narrativeTarget ? {
            timelineId: input.recoveryRequest.narrativeTarget.timelineId, branchId: input.branchId,
          } : undefined,
          signal: input.requestContext?.abortSignal ?? new AbortController().signal,
        })
        contentDiagnostics = prepared.diagnostics
        if (prepared.mutation) {
          const { raw: _raw, ...recoverableResult } = providerResult
          acceptedContent = { mutation: prepared.mutation, extensionLeases: prepared.extensionLeases, entries: stepEntries, providerResult: recoverableResult, diagnostics: contentDiagnostics }
          // Once accepted, replay commits these exact operations, never re-runs extension code.
          await append([{ kind: 'run-state', state: 'running', recovery: recovery('content', checkpointMessages, step) }])
          streamedText = ''
          streamedReasoning = ''
          streamedToolInputs.clear()
          return await finishAcceptedContent()
        }
      }
      if (finalResponse) stepEntries.push({
        kind: 'run-state', state: 'completed', ...(contentDiagnostics.length ? { reason: contentDiagnostics.join('\n') } : {}),
      })
      if (invocationPairs.length === 0 && providerResult.finishReason === 'length') {
        pendingAssistantContent += providerResult.message.content ?? ''
        stepEntries.push({
          kind: 'run-state', state: 'running', recovery: recovery('provider', checkpointMessages, step + 1),
        })
      } else pendingAssistantContent = ''
      const persistedStep = await runTool(() => append(stepEntries))
      for (const pair of invocationPairs) {
        pendingTools.set(pair.invocation.id, {
          invocation: pair.invocation,
          render: result => encodeToolResultMessage(pair, result),
        })
      }
      streamedText = ''
      streamedReasoning = ''
      streamedToolInputs.clear()

      if (invocationPairs.length === 0) {
        if (providerResult.finishReason === 'error')
          throw new Error('Provider Step finished with an error')
        if (providerResult.finishReason === 'length') {
          const partialEntry = persistedStep.entries.find(entry =>
            entry.entry.kind === 'message' && entry.entry.role === 'assistant',
          )
          if (partialEntry) continuationAssistantEntryId = partialEntry.id
          providerMessages.push(providerMessage)
          nextRecoveryStep = step + 1
          completeStep('Output limit reached · continuing')
          continue
        }
        if (!providerResult.message.content)
          throw new Error(
            'Provider completed without assistant text or tool calls',
          )
        const assistantEntry = persistedStep.entries.find(
          (entry) => entry.entry.kind === 'message',
        )
        if (!assistantEntry)
          throw new Error('Final assistant transcript entry was not persisted')
        completeStep('Final assistant output accepted')
        return {
          session,
          userEntry,
          assistantEntry,
          providerResult,
          toolPromptBuildTrace: input.compiledToolSet.trace,
          changesetId: persistedStep.changesetId,
        }
      }

      providerMessages.push(providerMessage)
      for (const pair of invocationPairs) {
        progress.stage = 'tool'
        progress.toolCount += 1
        activeTool = {
          invocationId: pair.invocation.id,
          toolId: pair.resolved?.definition.id ?? 'unknown',
          toolName: pair.resolved?.definition.name ?? 'unknown tool',
          startedAt: performance.now(),
        }
        toolLogger?.info(`${activeTool.toolName} · tool started`, {
          event: 'tool.started', ...logContext,
          data: { ...references, invocationId: activeTool.invocationId, toolId: activeTool.toolId, providerStep: step, transport: pair.transport, outcome: 'running' },
        })
        input.ctx.observations?.capture(() => {
          const execution = toolExecutions.find(item => item.id === pair.invocation.id)
          if (execution) execution.status = 'running'
          recordTools()
        })
        const observeToolEvent = (event: unknown) => input.ctx.observations?.capture(() => {
          const execution = toolExecutions.find(item => item.id === pair.invocation.id)
          if (!execution) return
          if (observedToolEventCount >= MAX_OBSERVED_TOOL_EVENTS) { markToolEvidencePartial(); return }
          observedToolEventCount += 1
          if (!retainToolEvidence(event)) return
          const events = (execution.events as unknown[] | undefined) ?? []
          events.push(event)
          execution.events = events
          recordTools()
        })
        if (input.toolExecutionScope) input.toolExecutionScope.observeToolEvent = observeToolEvent
        const incompleteCodeAct = codeActToolIds.has(pair.invocation.toolId)
          && (providerResult.finishReason === 'length' || providerResult.finishReason === 'error')
        const result = 'validationError' in pair && pair.validationError ? failedResult(
          pair.invocation, pair.validationError.code, pair.validationError.message,
        ) : 'sourceChanged' in pair && pair.sourceChanged ? failedResult(
          pair.invocation,
          'codeact.source_transformed',
          'CodeAct was not executed: an assistant-content transformation changed its source. Exclude tool code from the rule or choose the JSON CodeAct transport.',
        ) : incompleteCodeAct ? failedResult(
          pair.invocation,
          'codeact.incomplete_step',
          'CodeAct was not executed because the Provider response did not finish normally. Submit a complete invocation.',
        ) : await runInvocation(() => executeInvocation(
          input.ctx,
          pair.invocation,
          pair.resolved?.transport,
          input.toolExecutionScope,
          input.requestContext?.abortSignal,
          observeToolEvent,
        ))
        input.ctx.observations?.capture(() => {
          const execution = toolExecutions.find(item => item.id === pair.invocation.id)
          if (execution) Object.assign(execution, {
            ...(retainToolEvidence(result) ? { result } : { resultOmitted: true }),
            status: result.status, durationMs: performance.now() - activeTool!.startedAt,
          })
          recordTools()
        })
        const toolOutcome = result.status
        const errorCode = result.error?.code && safeToolCodes.has(result.error.code) ? result.error.code : undefined
        toolLogger?.[toolOutcome === 'completed' || (toolOutcome === 'aborted' && errorCode !== 'tool.timeout') ? 'info' : 'warn'](`${activeTool.toolName} · ${toolOutcome}${errorCode ? ` · ${errorCode}` : ''}`, {
          event: `tool.${toolOutcome}`, ...logContext,
          data: {
            ...references, invocationId: activeTool.invocationId, toolId: activeTool.toolId,
            providerStep: step, transport: pair.transport, outcome: toolOutcome,
            durationMs: Math.round((performance.now() - activeTool.startedAt) * 100) / 100,
            ...(errorCode ? { errorCode } : {}),
          },
        })
        activeTool = undefined
        progress.stage = 'transcript'
        checkpointMessages.push(encodeToolResultMessage(pair, result))
        freshContextMessages.push(...renderFreshContextMounts(result))
        const resultEntries: AgentTranscriptEntryData[] = [toTranscriptResult(result, input.requestContext?.abortSignal)]
        if (pair === invocationPairs.at(-1)) resultEntries.push({
          kind: 'run-state', state: 'running',
          recovery: recovery('provider', [...checkpointMessages, ...freshContextMessages], step + 1),
        })
        await append(resultEntries)
        if (pair === invocationPairs.at(-1)) nextRecoveryStep = step + 1
        pendingTools.delete(pair.invocation.id)
        if (input.requestContext?.abortSignal?.aborted)
          throw createAbortError(input.requestContext.abortSignal.reason)
        providerMessages.push(encodeToolResultMessage(pair, result))
      }
      completeStep(`${invocationPairs.length} tools processed · continuing`)
    }
  } catch (error) {
    input.ctx.observations?.capture(() => {
      if (!measurementId) return
      const request = input.ctx.observations!.get(measurementId)?.request
      const status = input.requestContext?.abortSignal?.aborted || isAbortError(error) ? 'aborted' : 'failed'
      if (request?.phase === 'prepared' || request?.phase === 'invoking') input.ctx.observations!.patch(measurementId, { status, request: { phase: status }, diagnostic: errorMessage(error) })
      if (activeTool) {
        const execution = toolExecutions.find(item => item.id === activeTool!.invocationId)
        if (execution) Object.assign(execution, { status, outcomeUnknown: true, error: errorMessage(error) })
        recordTools()
      }
    })
    // Whitespace from a provider is not a valid partial assistant message.
    if (!streamedText.trim()) streamedText = ''
    const aborted =
      input.requestContext?.abortSignal?.aborted || isAbortError(error)
    const userPaused = aborted && input.requestContext?.abortSignal?.reason === 'user-pause'
    const suspended = userPaused
    const failure = readLogFailure(error)
    if (activeTool) {
      toolLogger?.[aborted ? 'info' : 'error'](`${activeTool.toolName} · ${aborted ? 'cancelled' : failure.failureReason}`, {
        event: aborted ? 'tool.aborted' : 'tool.failed', ...logContext,
        data: { ...references, ...failure, invocationId: activeTool.invocationId, toolId: activeTool.toolId, providerStep: progress.providerStep, outcome: aborted ? 'aborted' : 'failed', durationMs: Math.round((performance.now() - activeTool.startedAt) * 100) / 100 },
      })
    }
    if (stepStartedAt !== undefined) {
      stepLogger?.[aborted ? 'info' : 'error'](`Step ${progress.providerStep} ${aborted ? 'cancelled' : 'failed'} · ${progress.stage}`, {
        event: aborted ? 'step.cancelled' : 'step.failed', ...logContext,
        data: { ...references, ...failure, providerStep: progress.providerStep, stage: progress.stage, outcome: aborted ? 'cancelled' : 'failed', detail: failure.failureReason, durationMs: Math.round((performance.now() - stepStartedAt) * 100) / 100 },
      })
    }
    try {
      const uncertainToolOutcome = pendingTools.size > 0
      if (pendingTools.size) {
        const results = [...pendingTools.values()].map(({ invocation }) => ({
          invocationId: invocation.id,
          toolId: invocation.toolId,
          status: aborted ? 'aborted' as const : 'failed' as const,
          content: [],
          error: { code: aborted ? 'tool.aborted' : 'tool.interrupted', message: 'Invocation ended without a result. The Agent must issue a new invocation to retry.' },
        }))
        input.ctx.observations?.capture(() => {
          for (const result of results) {
            const execution = toolExecutions.find(item => item.id === result.invocationId)
            if (execution && !execution.result && !execution.resultOmitted) Object.assign(execution, {
              ...(retainToolEvidence(result) ? { result } : { resultOmitted: true }), status: result.status, synthetic: true,
            })
          }
          recordTools()
        })
        await append(results.map(result => toTranscriptResult(result, input.requestContext?.abortSignal)))
        results.forEach(result => checkpointMessages.push(pendingTools.get(result.invocationId)!.render(result)))
        pendingTools.clear()
      }
      if (suspended || !aborted || acceptedContent) {
        const checkpointEntries: AgentTranscriptEntryData[] = []
        if (streamedReasoning) checkpointEntries.push({ kind: 'reasoning', content: streamedReasoning,
          source: 'provider-native', visibility: 'collapsed', replay: 'omit' })
        if (streamedText && !acceptedContent) checkpointEntries.push({
          kind: 'message',
          role: 'assistant',
          content: streamedText,
          state: 'partial',
        })
        for (const [invocationId, tool] of streamedToolInputs) {
          checkpointEntries.push({
            kind: 'tool-invocation',
            invocationId,
            toolId: byExposedName.get(tool.toolName ?? '')?.definition.id ?? `unresolved/${tool.toolName ?? 'unknown'}`,
            exposedName: tool.toolName ?? 'unknown',
            transport: 'native-function',
            rawInput: tool.input,
            status: 'suspended',
          })
          checkpointEntries.push({
            kind: 'tool-result',
            invocationId,
            toolId: byExposedName.get(tool.toolName ?? '')?.definition.id ?? `unresolved/${tool.toolName ?? 'unknown'}`,
            status: 'aborted',
            content: [],
            error: { code: 'tool.aborted', message: 'Incomplete tool input was not executed. Issue a new invocation to retry.' },
            syntheticReason: 'interrupt',
          })
        }
        const partialEntryId = streamedText ? input.ctx.createId('agent-entry') : undefined
        const resumeMessages: ChatMessage[] = [
          ...checkpointMessages, ...freshContextMessages,
          ...(streamedText ? [{
            role: 'system' as const,
            content: `The previous assistant response was interrupted. Continue from this partial response without repeating it:\n${streamedText}`,
          }] : []),
        ]
        if (partialEntryId) continuationAssistantEntryId = partialEntryId
        if (streamedText && !acceptedContent) pendingAssistantContent += streamedText
        const checkpoint = recovery(acceptedContent ? 'content' : uncertainToolOutcome ? 'tools' : 'provider', resumeMessages, nextRecoveryStep)
        checkpointEntries.push({
          kind: 'run-state', state: suspended ? 'suspended' : 'failed', reason: errorMessage(error),
          ...(measurementId ? { measurementId } : {}),
          recovery: checkpoint,
        })
        const checkpointAppend = await append(checkpointEntries, partialEntryId)
        const appendedPartial = checkpointAppend.entries.find(entry =>
          entry.entry.kind === 'message' && entry.entry.role === 'assistant' && entry.entry.state === 'partial',
        )
        input.requestContext?.agentRun?.onSuspended?.({
          sourceRunId: input.requestContext.agentRun.runId,
          messages: resumeMessages,
          userEntry,
          // Live handoff has paired terminal tool results above and advances to a new
          // Provider request, as before. The durable checkpoint still fails closed if
          // a stopped process cannot establish its interrupted tool outcome.
          recovery: {
            ...checkpoint,
            ...(uncertainToolOutcome && !acceptedContent ? { phase: 'provider' } : {}),
          } as unknown as AgentRunRecoveryCheckpoint,
          expectedEntryCount: session.entryCount,
          ...(appendedPartial ? { partialEntryId: appendedPartial.id }
            : continuationAssistantEntryId ? { partialEntryId: continuationAssistantEntryId } : {}),
        })
        // A durable checkpoint remains resumable even without an in-process observer.
        progress.suspended = true
      } else {
        await append([{
          kind: 'run-state', state: 'aborted', reason: errorMessage(error),
          ...(measurementId ? { measurementId } : {}),
        }])
      }
    } catch (checkpointError) {
      stepLogger?.error('Failed to persist Agent recovery checkpoint', {
        event: 'run.checkpoint_failed', ...logContext,
        data: { ...references, ...readLogFailure(checkpointError) },
      })
      // Invalid recovery payloads must not leave a stopped executor marked running.
      try {
        await append([{ kind: 'run-state', state: 'failed', reason: errorMessage(error) }])
      } catch (terminalError) {
        stepLogger?.error('Failed to persist Agent terminal state', {
          event: 'run.terminal_state_failed', ...logContext,
          data: { ...references, ...readLogFailure(terminalError) },
        })
      }
    }
    throw error
  }

  async function finishAcceptedContent(): Promise<NativeToolLoopResult> {
    const accepted = acceptedContent!
    await assertPromptDependencies()
    input.requestContext?.abortSignal?.throwIfAborted()
    const apply = () => applyApplicationStateMutation(input.ctx, accepted.mutation, {
      ...input.requestContext,
      extensionLeases: [...(input.requestContext?.extensionLeases ?? []), ...accepted.extensionLeases],
    })
    const source = input.toolExecutionScope?.narrativeSource
    await (source ? guardNarrativeWrite(input.ctx, source, apply) : apply())
    const persisted = await runTool(() => append([...accepted.entries, {
      kind: 'run-state', state: 'completed',
      ...(accepted.diagnostics?.length ? { reason: accepted.diagnostics.join('\n') } : {}),
    }]))
    const assistantEntry = persisted.entries.find(entry => entry.entry.kind === 'message')!
    acceptedContent = undefined
    completeStep('Assistant output and State content accepted')
    return {
      session, userEntry, assistantEntry, providerResult: accepted.providerResult,
      toolPromptBuildTrace: input.compiledToolSet.trace, changesetId: persisted.changesetId,
    }
  }

  async function assertPromptDependencies(): Promise<void> {
    input.requestContext?.abortSignal?.throwIfAborted()
    for (const lease of input.promptExtensionLeases ?? []) {
      await assertTimelineExtensionLease(input.ctx, input.ctx.documents, lease)
    }
  }

  function completeStep(detail: string) {
    stepLogger?.info(`Step ${progress.providerStep} completed`, {
      event: 'step.completed', ...logContext,
      data: { ...references, providerStep: progress.providerStep, outcome: 'completed', detail, durationMs: Math.round((performance.now() - stepStartedAt!) * 100) / 100 },
    })
    stepStartedAt = undefined
  }

  function retainToolEvidence(value: unknown): boolean {
    try {
      observedToolBytes += measureObservationSize(value, MAX_OBSERVED_TOOL_BYTES - observedToolBytes, { nodes: 4096, depth: 32 })
      return true
    } catch {
      observedToolBytes = MAX_OBSERVED_TOOL_BYTES
      markToolEvidencePartial()
      return false
    }
  }

  function markToolEvidencePartial() {
    input.ctx.observations!.patch(measurementId!, { availability: 'partial', diagnostic: '工具证据达到单步采集上限；执行继续，超限条目未记录。' })
  }

  function recordTools() {
    input.ctx.observations!.patch(measurementId!, { request: { toolExecutions } })
  }

  async function appendObservation(entries: () => AgentTranscriptEntryData[]) {
    // Preserve the existing awaited transcript write order and session.entryCount updates.
    // Only measurement/provider-observation persistence and their UI notification are isolated;
    // canonical messages, tool results and recovery writes still use append directly.
    try {
      const values = entries()
      if (values.length) await append(values)
    } catch { /* Observation failure must not retry or suppress the model call. */ }
  }

  async function append(entries: AgentTranscriptEntryData[], firstId?: string, takeover?: NonNullable<RuntimeRequestContext['agentRun']>['continuation']) {
    const write: Parameters<AgentStore['appendEntries']>[0] = {
      actor: input.requestContext?.actor ?? (input.requestContext?.clientId
        ? { kind: 'client', id: input.requestContext.clientId }
        : { kind: 'kernel', id: 'application-runtime' }),
      reason: 'application.invokeAgentTurn',
      correlationId: input.requestContext?.correlationId,
      callId: input.requestContext?.callId,
      parentCallId: input.requestContext?.parentCallId,
      agentSessionId: session.id,
      expectedEntryCount: session.entryCount,
      entries: entries.map((entry, index) => ({ ...(index === 0 && firstId ? { id: firstId } : {}), runId: input.runId, entry })),
    }
    const result = takeover
      ? await input.ctx.dataEngine.transact(write, async dataTx => {
          const agents = input.agents.transaction(dataTx)
          const stopped = agents.appendEntries({
            agentSessionId: session.id, expectedEntryCount: takeover.expectedEntryCount!,
            entries: [{ runId: takeover.sourceRunId, entry: {
              kind: 'run-state', state: 'suspended', reason: `Execution transferred to ${input.runId}`,
            } }],
          })
          return agents.appendEntries({ ...write, expectedEntryCount: stopped.session.entryCount })
        }).then(result => ({ ...result.value, commit: result.commit }))
      : await input.agents.appendEntries(write)
    session = result.session
    lastChangesetId = result.commit.changesetId
    input.requestContext?.agentRun?.onEvent({
      type: 'transcript-appended',
      runId: input.requestContext.agentRun.runId,
      entries: result.entries,
    })
    return { entries: result.entries, changesetId: lastChangesetId }
  }
}

async function resolveTools(
  ctx: AgentToolResolutionContext,
  model: ProviderModelSelection,
  toolIds: string[],
) {
  const resolved = ctx.agentTools.resolve(toolIds)
  const invalid = resolved.diagnostics.find(
    (diagnostic) => diagnostic.severity === 'error' && diagnostic.code !== 'tool.missing',
  )
  if (invalid) throw new Error(invalid.message)
  const providerProfile = await ctx.documents.get(model.providerProfileId)
  if (!providerProfile)
    throw new Error(`Provider Profile not found: ${model.providerProfileId}`)
  const content = providerProfile.content as { providerExtensionId?: unknown }
  if (typeof content.providerExtensionId !== 'string')
    throw new Error(`Provider Profile is invalid: ${model.providerProfileId}`)
  const capability = ctx.providerAdapters.getCapability(
    content.providerExtensionId,
  )
  const analysis = ctx.agentTools.analyze(resolved.tools.map(tool => tool.id), {
    nativeFunction: capability.nativeFunctionTools,
    providerCustom: false,
    content: true,
  })
  const unavailable = analysis.diagnostics.find(
    (diagnostic) => diagnostic.severity === 'error',
  )
  if (unavailable) throw new Error(unavailable.message)
  const exposureByToolId = new Map(
    analysis.exposures.map((exposure) => [exposure.toolId, exposure]),
  )
  const tools = resolved.tools.map((definition) => {
    if (!ctx.agentTools.getRegistration(definition.id))
      throw new Error(
        `No runtime handler registered for agent tool: ${definition.id}`,
      )
    const transport = exposureByToolId.get(definition.id)?.transport
    if (!transport || transport === 'provider-custom')
      throw new Error(`Unsupported Agent Tool transport: ${definition.id}`)
    return { definition, transport }
  })
  const names = new Set<string>()
  for (const { definition } of tools) {
    if (names.has(definition.name))
      throw new Error(`Duplicate exposed agent tool name: ${definition.name}`)
    names.add(definition.name)
  }
  return {
    tools,
    diagnostics: resolved.diagnostics.map(diagnostic => ({
      ...diagnostic,
      severity: diagnostic.code === 'tool.missing' ? 'warning' as const : diagnostic.severity,
    })),
  }
}

function readNativeSchema(tool: CompiledToolExposure): JsonObject {
  const schema =
    tool.input.kind === 'structured'
      ? cloneJsonObject(tool.input.schema)
      : tool.input.structuredFallback
        ? cloneJsonObject(tool.input.structuredFallback.schema)
        : undefined
  if (!schema)
    throw new Error(`Agent tool has no Native Function schema: ${tool.toolId}`)
  for (const [path, description] of Object.entries(
    tool.prompt.parameterDescriptions ?? {},
  )) {
    applyParameterDescription(schema, path, description)
  }
  return schema
}

function renderContentToolInstructions(tools: CompiledToolExposure[]): string {
  const descriptions = tools
    .map((tool) => {
      const metadataSchema =
        tool.input.kind === 'hybrid' ? tool.input.metadataSchema : undefined
      return [
        `Tool: ${tool.name}`,
        tool.prompt.description,
        ...(tool.input.kind === 'freeform' ? ['Metadata must be {}; this tool accepts only raw content.'] : []),
        ...(tool.prompt.guidance && !codeActToolIds.has(tool.toolId) ? [tool.prompt.guidance] : []),
        ...(metadataSchema
          ? [`Metadata JSON Schema: ${JSON.stringify(metadataSchema)}`]
          : []),
      ].join('\n')
    })
    .join('\n\n')
  return `You may call the following Loom content tools. These are not function tools: never call their names through tool_calls or JSON function arguments. A call must be written in assistant content using exactly this protocol:\n<loom_tool name="tool_name"><metadata>{"key":"value"}</metadata><content>raw unescaped text</content></loom_tool>\nThe closing sequences </content> and </loom_tool> are reserved and must not appear inside content. Do not emit loom_tool_result blocks.\n\n${descriptions}`
}

function renderNativeToolDescription(tool: CompiledToolExposure): string {
  return [tool.prompt.description, ...(!codeActToolIds.has(tool.toolId) ? [tool.prompt.guidance] : [])]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}

function applyParameterDescription(
  schema: JsonObject,
  path: string,
  description: string,
): void {
  let cursor = schema
  for (const part of path.split('.')) {
    const properties = cursor.properties
    if (!isJsonObject(properties) || !isJsonObject(properties[part])) return
    cursor = properties[part]
  }
  cursor.description = description
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (isJsonObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    )
  return value
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function executeInvocation(
  ctx: Pick<ApplicationRuntimeContext, 'agentTools'>,
  invocation: ToolInvocation,
  expectedTransport?: CompiledToolExposure['transport'],
  scope?: ToolExecutionScope,
  externalSignal?: AbortSignal,
  observeToolEvent?: (event: unknown) => void,
): Promise<ToolResult> {
  if (!expectedTransport)
    return failedResult(
      invocation,
      'tool.unknown',
      `Provider called an unknown tool: ${invocation.toolId}`,
    )
  if (expectedTransport !== invocation.transport)
    return failedResult(
      invocation,
      'tool.transport_mismatch',
      expectedTransport === 'content'
        ? codeActToolIds.has(invocation.toolId)
          ? 'Nothing was executed. codeact is FREEFORM, not a native JSON tool. Retry in assistant content: <loom_tool name="codeact"><metadata>{}</metadata><content>print(await ctx.ls("/"));</content></loom_tool>. Put raw JavaScript inside <content>, not {"code":"..."}. Use native {"code":"..."} only with codeact_json if that separate tool is enabled.'
          : `Tool ${invocation.toolId} is a Loom content tool. Do not call it through tool_calls; emit its <loom_tool> block in assistant content.`
        : `Tool ${invocation.toolId} must use ${expectedTransport}, not ${invocation.transport ?? 'an unspecified transport'}.`,
    )
  let approval
  try {
    approval = await ctx.agentTools.approve(invocation)
    observeToolEvent?.({ kind: 'approval', decision: approval })
  } catch (error) {
    return failedResult(invocation, 'tool.approval_failed', errorMessage(error))
  }
  if (approval.decision === 'deny') {
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'denied',
      content: [],
      error: {
        code: 'tool.denied',
        message: approval.reason ?? 'Tool invocation was denied',
      },
    }
  }
  const { signal, dispose } = createToolSignal(externalSignal)
  try {
    // CodeAct terminates its Worker and drains accepted host operations before returning an abort result.
    if (codeActToolIds.has(invocation.toolId))
      return await ctx.agentTools.execute(invocation, signal, scope)
    return await raceWithAbort(
      ctx.agentTools.execute(invocation, signal, scope),
      signal,
    )
  } catch (error) {
    if (!signal.aborted) throw error
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'aborted',
      content: [],
      error: {
        code: 'tool.aborted',
        message: 'Tool execution was aborted',
      },
    }
  } finally {
    dispose()
  }
}

function createToolSignal(externalSignal?: AbortSignal): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', abort, { once: true })
  if (externalSignal?.aborted) abort()
  return {
    signal: controller.signal,
    dispose: () => {
      externalSignal?.removeEventListener('abort', abort)
    },
  }
}

function providerObservation(
  result: GatewayChatResult,
): Extract<AgentTranscriptEntryData, { kind: 'provider-observation' }> {
  return {
    kind: 'provider-observation',
    provider: result.provider,
    model: result.model,
    ...(result.providerCallId ? { providerCallId: result.providerCallId } : {}),
    ...(result.rawStopReason ? { rawStopReason: result.rawStopReason } : {}),
    ...(result.finishReason
      ? {
          normalizedStopReason:
            result.finishReason === 'tool_call'
              ? 'tool-call'
              : result.finishReason,
        }
      : {}),
    ...(result.usage ? { usage: result.usage } : {}),
  }
}

function toTranscriptResult(
  result: ToolResult,
  signal?: AbortSignal,
): AgentTranscriptEntryData {
  return {
    kind: 'tool-result',
    invocationId: result.invocationId,
    toolId: result.toolId,
    status: result.status,
    content: result.content,
    ...(result.error ? { error: result.error } : {}),
    ...(result.status === 'aborted'
      ? {
          syntheticReason:
            result.error?.code === 'tool.timeout'
              ? 'timeout'
              : signal?.aborted
                ? 'interrupt'
                : 'provider-abort',
        }
      : {}),
  }
}

function renderFreshContextMounts(result: ToolResult): ChatMessage[] {
  if (result.status !== 'completed') return []
  return (result.contextMounts ?? []).map(item => ({
    role: 'system',
    content: `[Fresh Context: ${item.name}]\n${item.content}`,
  }))
}

function failedResult(
  invocation: ToolInvocation,
  code: string,
  message: string,
): ToolResult {
  return {
    invocationId: invocation.id,
    toolId: invocation.toolId,
    status: 'failed',
    content: [],
    error: { code, message },
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
function createAbortError(reason: unknown): Error {
  const error = new Error(
    typeof reason === 'string'
      ? reason
      : reason instanceof Error
        ? reason.message
        : 'Agent run aborted',
  )
  error.name = 'AbortError'
  return error
}
function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(createAbortError(signal.reason))
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
