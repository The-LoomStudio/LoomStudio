import type {
  AgentStore,
  AgentTranscriptEntry,
  AgentTranscriptEntryData,
  AgentSession,
} from '@loom-studio/agent-store'
import type { PresetToolMount } from '@loom-studio/prompt-resource-store'
import type { ChatMessage, JsonObject, JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../application-context.js'
import {
  promptZoneIds,
  type PromptContribution,
  type SourceNode,
} from '../prompt-builder.js'
import type {
  ToolDefinition,
  ToolExecutionScope,
  ToolInvocation,
  ToolResult,
} from './tool-registry.js'
import {
  createLoomContentScannerState,
  finishLoomContentScan,
  pushLoomContentChunk,
  renderLoomContentToolResult,
} from './content-transport.js'
import {
  compileToolPromptSources,
  type CompiledToolExposure,
  type ToolPromptBuildTrace,
  type ToolPromptSource,
} from './tool-prompt-build.js'
import type { ActivationFacts } from '../prompt-activation.js'
import type {
  GatewayChatResult,
  ProviderModelSelection,
  RuntimeRequestContext,
} from '../types.js'

const maximumProviderSteps = 8
const toolTimeoutMs = 30_000

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
  slotRanks: Array<{ zoneId: string; slotKey: string; rankKey: string }>
}

export async function compileAgentToolSet(input: {
  ctx: ApplicationRuntimeContext
  model: ProviderModelSelection
  toolMounts: PresetToolMount[]
  toolOverrides: Record<string, boolean>
  macroContext: { user: string }
  currentInput: string
  activationFacts?: ActivationFacts
}): Promise<CompiledAgentToolSet> {
  const enabledMounts = resolveEnabledPresetToolMounts(
    input.toolMounts,
    input.toolOverrides,
  )
  const resolvedTools = await resolveTools(
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
                zone: content.zone ?? 'tools',
                slot: content.slot ?? `${definition.owner.namespace}-tools`,
                ...(content.rankKey ? { rankKey: content.rankKey } : {}),
                ...(content.orderHint === undefined ? {} : { orderHint: content.orderHint }),
              },
            }),
        transport,
      }
    }),
    macroContext: input.macroContext,
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
    trace: toolPromptBuild.trace,
  }
}

export function createContentToolPromptRuntimeInputs(
  toolSet: CompiledAgentToolSet,
): ContentToolPromptRuntimeInputs {
  const contentTools = toolSet.tools.filter(
    (tool) => tool.transport === 'content',
  )
  const groups = new Map<string, {
    zoneId: string
    slotKey: string
    rankKey?: string
    orderHint?: number
    tools: CompiledToolExposure[]
  }>()
  for (const tool of contentTools) {
    const content = tool.mount.content ?? {}
    const zoneId = content.zone ?? promptZoneIds.tools
    const slotKey = content.slot
      ?? `${tool.definition.owner.namespace}-tools`
    const key = JSON.stringify([zoneId, slotKey])
    const group = groups.get(key) ?? {
      zoneId,
      slotKey,
      ...(content.rankKey
        ? { rankKey: content.rankKey }
        : {}),
      ...(content.orderHint !== undefined
        ? { orderHint: content.orderHint }
        : {}),
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
      }]
  const contributions: PromptContribution[] = []
  const slotRanks: ContentToolPromptRuntimeInputs['slotRanks'] = []
  for (const [index, group] of [...groups.values()].entries()) {
    const sourceNodeId = `${sourceId}.slot.${index}`
    sourceNodes.push({
      id: sourceNodeId,
      sourceId,
      parentId: sourceId,
      displayName: group.slotKey,
      orderIndex: index + 1,
    })
    contributions.push({
      id: `${sourceId}.contribution.${index}`,
      sourceRef: { kind: 'runtime', sourceId, sourceNodeId },
      content: renderContentToolInstructions(group.tools),
      capabilities: {
        projection: {
          zoneId: group.zoneId,
          joinSlotKey: group.slotKey,
          ...(group.orderHint === undefined
            ? {}
            : { slotOrderHint: group.orderHint }),
        },
        lifecycle: { lifecycle: 'always' },
      },
    })
    if (group.rankKey) {
      slotRanks.push({
        zoneId: group.zoneId,
        slotKey: group.slotKey,
        rankKey: group.rankKey,
      })
    }
  }
  return { sourceNodes, contributions, slotRanks }
}

export function resolveEnabledPresetToolMounts(
  mounts: readonly PresetToolMount[],
  overrides: Readonly<Record<string, boolean>>,
): PresetToolMount[] {
  return mounts.filter(mount => overrides[mount.toolId] ?? mount.defaultEnabled)
}

export async function runNativeToolLoop(input: {
  ctx: ApplicationRuntimeContext
  agents: AgentStore
  session: AgentSession
  runId: string
  model: ProviderModelSelection
  initialMessages: ChatMessage[]
  userInput: string
  compiledToolSet: CompiledAgentToolSet
  toolExecutionScope?: ToolExecutionScope
  branchId: string
  purpose: 'agent' | 'narrative'
  requestContext?: RuntimeRequestContext
}): Promise<NativeToolLoopResult> {
  let session = input.session
  let lastChangesetId = ''
  const tools = input.compiledToolSet.tools
  const nativeTools = tools.filter(
    (tool) => tool.transport === 'native-function',
  )
  const contentTools = tools.filter((tool) => tool.transport === 'content')
  const providerMessages = [...input.initialMessages]
  const toolSpecs = nativeTools.map(({ exposure }) => ({
    name: exposure.name,
    description: renderNativeToolDescription(exposure),
    inputSchema: readNativeSchema(exposure),
  }))
  const byExposedName = new Map(
    tools.map((tool) => [tool.definition.name, tool] as const),
  )

  const initial = await append([
    { kind: 'message', role: 'user', content: input.userInput },
    { kind: 'run-state', state: 'running' },
  ])
  const userEntry = initial.entries[0]!

  try {
    for (let step = 1; step <= maximumProviderSteps; step += 1) {
      if (input.requestContext?.abortSignal?.aborted)
        throw createAbortError(input.requestContext.abortSignal.reason)
      const providerResult = await input.ctx.gateway.invokeChat({
        request: {
          messages: providerMessages,
          ...(toolSpecs.length
            ? { tools: toolSpecs, toolChoice: 'auto' as const }
            : {}),
          metadata: {
            purpose: input.purpose,
            agentSessionId: session.id,
            runId: input.runId,
            providerStep: step,
          },
        },
        model: input.model,
        runId: input.runId,
        sessionId: session.id,
        branchId: input.branchId,
        ...(input.requestContext ? { context: input.requestContext } : {}),
        ...(input.requestContext?.abortSignal
          ? { abortSignal: input.requestContext.abortSignal }
          : {}),
      })

      const toolCalls = providerResult.message.tool_calls ?? []
      const nativeInvocationPairs = toolCalls.map((call) => {
        const resolved = byExposedName.get(call.function.name)
        const invocation: ToolInvocation = {
          id: input.ctx.createId('tool-invocation'),
          toolId: resolved?.definition.id ?? `unresolved/${call.function.name}`,
          arguments: parseToolArguments(
            call.function.arguments,
            call.function.name,
          ),
          transport: 'native-function',
          ...(providerResult.providerCallId
            ? { providerCallId: providerResult.providerCallId }
            : {}),
          providerItemId: call.id,
        }
        return { call, invocation, resolved, transport: 'native-function' as const }
      })
      const contentScan = providerResult.message.content
        ? scanContentTools(
            providerResult.message.content,
            contentTools.map((tool) => tool.definition.name),
          )
        : { text: '', invocations: [] }
      if (nativeInvocationPairs.length && contentScan.invocations.length)
        throw new Error(
          'Provider emitted native and content tool calls in the same Step',
        )
      const contentInvocationPairs = contentScan.invocations.map((parsed) => {
        const resolved = byExposedName.get(parsed.name)
        const invocation: ToolInvocation = {
          id: input.ctx.createId('tool-invocation'),
          toolId: resolved?.definition.id ?? `unresolved/${parsed.name}`,
          arguments: parsed.metadata,
          rawInput: parsed.content,
          transport: 'content',
          ...(providerResult.providerCallId
            ? { providerCallId: providerResult.providerCallId }
            : {}),
        }
        return {
          invocation,
          resolved,
          exposedName: parsed.name,
          transport: 'content' as const,
        }
      })
      const invocationPairs = [
        ...nativeInvocationPairs,
        ...contentInvocationPairs,
      ]

      const stepEntries: AgentTranscriptEntryData[] = [
        providerObservation(providerResult),
      ]
      if (contentScan.text) {
        stepEntries.push({
          kind: 'message',
          role: 'assistant',
          content: contentScan.text,
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
      const persistedStep = await append(stepEntries)

      if (invocationPairs.length === 0) {
        if (providerResult.finishReason === 'error')
          throw new Error('Provider Step finished with an error')
        if (providerResult.finishReason === 'length')
          throw new Error('Provider Step reached its output limit before completion')
        if (!providerResult.message.content)
          throw new Error(
            'Provider completed without assistant text or tool calls',
          )
        const assistantEntry = persistedStep.entries.find(
          (entry) => entry.entry.kind === 'message',
        )
        if (!assistantEntry)
          throw new Error('Final assistant transcript entry was not persisted')
        const completed = await append([
          { kind: 'run-state', state: 'completed' },
        ])
        return {
          session,
          userEntry,
          assistantEntry,
          providerResult,
          toolPromptBuildTrace: input.compiledToolSet.trace,
          changesetId: completed.changesetId,
        }
      }

      providerMessages.push(providerResult.message)
      for (const pair of invocationPairs) {
        const result = await executeInvocation(
          input.ctx,
          pair.invocation,
          pair.resolved?.transport,
          input.toolExecutionScope,
          input.requestContext?.abortSignal,
        )
        await append([
          toTranscriptResult(result, input.requestContext?.abortSignal),
        ])
        if (input.requestContext?.abortSignal?.aborted)
          throw createAbortError(input.requestContext.abortSignal.reason)
        if (pair.transport === 'native-function') {
          providerMessages.push({
            role: 'tool',
            tool_call_id: pair.call.id,
            content: renderToolResult(result),
          })
        } else {
          providerMessages.push({
            role: 'user',
            content: renderLoomContentToolResult({
              invocationId: result.invocationId,
              name: pair.exposedName,
              status: result.status === 'completed' ? 'completed' : 'failed',
              content: renderToolResult(result),
            }),
          })
        }
      }
    }
    throw new Error(
      `Agent Provider step limit exceeded: ${maximumProviderSteps}`,
    )
  } catch (error) {
    const aborted =
      input.requestContext?.abortSignal?.aborted || isAbortError(error)
    try {
      await append([
        {
          kind: 'run-state',
          state: aborted ? 'aborted' : 'failed',
          reason: errorMessage(error),
        },
      ])
    } catch {
      // Preserve the original failure if recording the terminal state also fails.
    }
    throw error
  }

  async function append(entries: AgentTranscriptEntryData[]) {
    const result = await input.agents.appendEntries({
      actor: input.requestContext?.clientId
        ? { kind: 'client', id: input.requestContext.clientId }
        : { kind: 'kernel', id: 'application-runtime' },
      reason: 'application.invokeAgentTurn',
      correlationId: input.requestContext?.correlationId,
      callId: input.requestContext?.callId,
      parentCallId: input.requestContext?.parentCallId,
      agentSessionId: session.id,
      expectedEntryCount: session.entryCount,
      entries: entries.map((entry) => ({ runId: input.runId, entry })),
    })
    session = result.session
    lastChangesetId = result.commit.changesetId
    return { entries: result.entries, changesetId: lastChangesetId }
  }
}

async function resolveTools(
  ctx: ApplicationRuntimeContext,
  model: ProviderModelSelection,
  toolIds: string[],
) {
  const resolved = ctx.agentTools.resolve(toolIds)
  const missing = resolved.diagnostics.find(
    (diagnostic) => diagnostic.severity === 'error',
  )
  if (missing) throw new Error(missing.message)
  const providerProfile = await ctx.documents.get(model.providerProfileId)
  if (!providerProfile)
    throw new Error(`Provider Profile not found: ${model.providerProfileId}`)
  const content = providerProfile.content as { providerExtensionId?: unknown }
  if (typeof content.providerExtensionId !== 'string')
    throw new Error(`Provider Profile is invalid: ${model.providerProfileId}`)
  const capability = ctx.providerAdapters.getCapability(
    content.providerExtensionId,
  )
  const analysis = ctx.agentTools.analyze(toolIds, {
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
  return tools
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

function scanContentTools(content: string, knownToolNames: string[]) {
  const options = { knownToolNames }
  const pushed = pushLoomContentChunk(
    createLoomContentScannerState(),
    content,
    options,
  )
  const finished = finishLoomContentScan(pushed.state, options)
  if (finished.result.status === 'failed')
    throw new Error(
      finished.result.error?.message ?? 'Content tool response is invalid',
    )
  return finished.result
}

function renderContentToolInstructions(tools: CompiledToolExposure[]): string {
  const descriptions = tools
    .map((tool) => {
      const metadataSchema =
        tool.input.kind === 'hybrid' ? tool.input.metadataSchema : undefined
      return [
        `Tool: ${tool.name}`,
        tool.prompt.description,
        ...(tool.prompt.guidance ? [tool.prompt.guidance] : []),
        ...(metadataSchema
          ? [`Metadata JSON Schema: ${JSON.stringify(metadataSchema)}`]
          : []),
      ].join('\n')
    })
    .join('\n\n')
  return `You may call the following Loom content tools. These are not function tools: never call their names through tool_calls or JSON function arguments. A call must be written in assistant content using exactly this protocol:\n<loom_tool name="tool_name"><metadata>{"key":"value"}</metadata><content>raw unescaped text</content></loom_tool>\nThe closing sequences </content> and </loom_tool> are reserved and must not appear inside content. Do not emit loom_tool_result blocks.\n\n${descriptions}`
}

function renderNativeToolDescription(tool: CompiledToolExposure): string {
  return [tool.prompt.description, tool.prompt.guidance]
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
  ctx: ApplicationRuntimeContext,
  invocation: ToolInvocation,
  expectedTransport?: CompiledToolExposure['transport'],
  scope?: ToolExecutionScope,
  externalSignal?: AbortSignal,
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
        ? `Tool ${invocation.toolId} is a Loom content tool. Do not call it through tool_calls; emit its <loom_tool> block in assistant content.`
        : `Tool ${invocation.toolId} must use ${expectedTransport}, not ${invocation.transport ?? 'an unspecified transport'}.`,
    )
  let approval
  try {
    approval = await ctx.agentTools.approve(invocation)
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
        code:
          signal.reason === 'tool-timeout' ? 'tool.timeout' : 'tool.aborted',
        message:
          signal.reason === 'tool-timeout'
            ? 'Tool execution timed out'
            : 'Tool execution was aborted',
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
  // ponytail: Phase 4 uses one fixed per-tool timeout; move this into Agent Runtime Policy when profile-level budgets are introduced.
  const timeout = setTimeout(
    () => controller.abort('tool-timeout'),
    toolTimeoutMs,
  )
  const abort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', abort, { once: true })
  if (externalSignal?.aborted) abort()
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abort)
    },
  }
}

function parseToolArguments(value: string, toolName: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error()
    return parsed as Record<string, import('@loom-studio/shared').JsonValue>
  } catch {
    throw new Error(
      `Provider tool arguments are invalid JSON object: ${toolName}`,
    )
  }
}

function providerObservation(
  result: GatewayChatResult,
): AgentTranscriptEntryData {
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

function renderToolResult(result: ToolResult): string {
  const content = result.content
    .map((part) =>
      part.type === 'text'
        ? part.text
        : part.type === 'json'
          ? JSON.stringify(part.value)
          : `[artifact:${part.artifactId}]`,
    )
    .join('\n')
  return content || result.error?.message || result.status
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
