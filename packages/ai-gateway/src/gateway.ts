import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ChatMessage, JsonObject, JsonValue } from '@loom-studio/shared'
import { createId } from '@loom-studio/shared'
import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type ModelMessage,
  type ToolSet,
} from 'ai'
import { parseProviderOptions } from './provider-options.js'
import { GatewayEventStream } from './event-stream.js'
import type {
  AiGatewayRequest,
  AiGatewayRun,
  AiGatewayResult,
  AiProviderConfig,
} from './types.js'

export function createAiGateway() {
  return {
    createRun: (input: AiGatewayRequest): AiGatewayRun => createGatewayRun(input),
    invokeChat: async (input: AiGatewayRequest): Promise<AiGatewayResult> =>
      await createGatewayRun(input).result,
  }
}

function createGatewayRun(input: AiGatewayRequest): AiGatewayRun {
  const id = createId('gateway-run')
  const stream = new GatewayEventStream()
  const controller = new AbortController()
  let cancelReason: string | undefined
  let state: AiGatewayRun['getState'] extends () => infer T ? T : never = 'running'
  const cancel = (reason?: string) => {
    if (state !== 'running' || controller.signal.aborted) return
    cancelReason = reason
    controller.abort(reason)
  }
  const onExternalAbort = () => cancel(readAbortReason(input.abortSignal))
  input.abortSignal?.addEventListener('abort', onExternalAbort, { once: true })
  if (input.abortSignal?.aborted) onExternalAbort()

  const result = (async () => {
    stream.push({ type: 'started', runId: id })
    try {
      const value = input.delivery === 'stream'
        ? await executeStream(input, id, controller.signal, stream)
        : await executeComplete(input, controller.signal)
      if (value.usage) stream.push({ type: 'usage', runId: id, usage: value.usage })
      state = 'completed'
      stream.push({ type: 'completed', runId: id, result: value })
      stream.close()
      return value
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        state = 'cancelled'
        stream.push({ type: 'cancelled', runId: id, ...(cancelReason ? { reason: cancelReason } : {}) })
      } else {
        state = 'failed'
        stream.push({ type: 'failed', runId: id, error: toGatewayError(error) })
      }
      stream.close()
      throw error
    } finally {
      input.abortSignal?.removeEventListener('abort', onExternalAbort)
    }
  })()
  result.catch(() => undefined)
  return { id, events: stream, readEvents: cursor => stream.readEvents(cursor), result, getState: () => state, cancel }
}

async function executeComplete(input: AiGatewayRequest, abortSignal: AbortSignal): Promise<AiGatewayResult> {
  let rawResponse: JsonValue | undefined
  const prepared = prepareRequest(input, abortSignal, 'complete', body => { rawResponse = body })
  const result = await generateText(prepared)
  return buildGatewayResult(input, {
    text: result.text,
    reasoning: result.reasoningText,
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    usage: result.usage,
    response: result.response,
    raw: rawResponse ?? toJsonValue({ rawFinishReason: result.rawFinishReason, providerMetadata: result.providerMetadata, warnings: result.warnings }),
  })
}

async function executeStream(input: AiGatewayRequest, runId: string, abortSignal: AbortSignal, events: GatewayEventStream): Promise<AiGatewayResult> {
  const prepared = prepareRequest(input, abortSignal, 'stream')
  const result = streamText(prepared)
  const toolNames = new Map<string, string>()
  let finished = false
  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') events.push({ type: 'reasoning-delta', runId, reasoningId: part.id, delta: part.text })
    if (part.type === 'text-delta') events.push({ type: 'text-delta', runId, delta: part.text })
    if (part.type === 'tool-input-start') toolNames.set(part.id, part.toolName)
    if (part.type === 'tool-input-delta') {
      events.push({ type: 'tool-input-delta', runId, toolCallId: part.id, ...(toolNames.get(part.id) ? { toolName: toolNames.get(part.id) } : {}), delta: part.delta })
    }
    if (part.type === 'abort') throw createAbortError(part.reason)
    if (part.type === 'error') throw part.error
    if (part.type === 'finish') finished = true
  }
  if (!finished) throw new Error('Provider stream ended before completion')
  return buildGatewayResult(input, {
    text: await result.text,
    reasoning: await result.reasoningText,
    toolCalls: await result.toolCalls,
    finishReason: await result.finishReason,
    rawFinishReason: await result.rawFinishReason,
    usage: await result.usage,
    response: await result.response,
    raw: toJsonValue({ rawFinishReason: await result.rawFinishReason, providerMetadata: await result.providerMetadata, warnings: await result.warnings }),
  })
}

function prepareRequest(input: AiGatewayRequest, abortSignal: AbortSignal, delivery: 'complete' | 'stream', capture?: (body: JsonValue) => void) {
  if (!input.modelId.trim()) throw new Error('Provider modelId cannot be empty')
  const tools = input.tools?.length ? createTools(input.tools) : undefined
  validateToolChoice(input.toolChoice, tools)
  const provider = {
    ...input.provider,
    fetch: createRequestFetch(input.provider.fetch ?? fetch, delivery, input.provider.kind === 'openai-compatible', capture),
  }
  return {
    model: createModel(provider, input.modelId),
    messages: toModelMessages(input.messages),
    allowSystemInMessages: true as const,
    ...(tools ? { tools } : {}),
    ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
    ...(input.providerOptions ? { providerOptions: parseProviderOptions(input.provider.kind, input.providerOptions) } : {}),
    abortSignal,
    maxRetries: 0 as const,
  }
}

function buildGatewayResult(input: AiGatewayRequest, result: {
  text: string
  reasoning?: string
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown; invalid?: boolean; error?: unknown }>
  finishReason: string
  rawFinishReason?: string
  usage: {
    inputTokens?: number; outputTokens?: number; totalTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
    outputTokenDetails?: { reasoningTokens?: number }
  }
  response: { id?: string; modelId?: string; headers?: Record<string, string> }
  raw: JsonValue
}): AiGatewayResult {
  const measuredUsage = normalizeUsage(result.usage)
  if (measuredUsage) {
    try { input.onUsage?.(measuredUsage) } catch { /* Metering must not change provider execution. */ }
  }
  const toolCalls = result.toolCalls.map(call => ({
    id: call.toolCallId,
    type: 'function' as const,
    function: { name: call.toolName, arguments: JSON.stringify(call.input) },
  }))
  const toolCallErrors = Object.fromEntries(result.toolCalls.filter(call => call.invalid).map(call => [call.toolCallId, {
    code: 'tool.invalid_input', message: call.error instanceof Error ? call.error.message : 'Provider returned an invalid tool call.',
  }]))
  const message = {
    role: 'assistant' as const,
    ...(result.text ? { content: result.text } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  }
  if (!message.content && !message.tool_calls && result.finishReason !== 'length') {
    throw new Error('Provider assistant response did not include content or tool calls')
  }
  return {
    message,
    text: result.text,
    ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    ...(Object.keys(toolCallErrors).length ? { toolCallErrors } : {}),
    provider: input.provider.name ?? input.provider.kind,
    model: result.response.modelId ?? input.modelId,
    finishReason: normalizeFinishReason(result.finishReason),
    ...(result.rawFinishReason ? { rawFinishReason: result.rawFinishReason } : {}),
    ...(measuredUsage ? { usage: measuredUsage } : {}),
    ...(result.response.id ? { providerCallId: result.response.id } : {}),
    ...(readRequestId(result.response.headers) ? { requestId: readRequestId(result.response.headers) } : {}),
    raw: result.raw,
  }
}

function createRequestFetch(transport: typeof fetch, delivery: 'complete' | 'stream', forceCompleteFlag: boolean, capture?: (body: JsonValue) => void): typeof fetch {
  return (async (input, init) => {
    let requestInit = init
    if (delivery === 'complete' && forceCompleteFlag && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as JsonObject
      requestInit = { ...init, body: JSON.stringify({ ...body, stream: false }) }
    }
    const response = await transport(input, requestInit)
    if (capture) {
      try { capture(await response.clone().json() as JsonValue) } catch { /* Provider adapter handles non-JSON bodies. */ }
    }
    return response
  }) as typeof fetch
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function createAbortError(reason?: string): Error {
  const error = new Error(reason ?? 'Gateway run cancelled')
  error.name = 'AbortError'
  return error
}

function readAbortReason(signal: AbortSignal | undefined): string | undefined {
  if (typeof signal?.reason === 'string') return signal.reason
  return signal?.reason instanceof Error ? signal.reason.message : undefined
}

function toGatewayError(error: unknown): { name: string; message: string } {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError', message: String(error) }
}

export async function listOpenAICompatibleModels(options: {
  baseUrl?: string
  apiKey: string
  fetch?: typeof fetch
}): Promise<string[]> {
  const response = await (options.fetch ?? fetch)(
    `${normalizeBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1')}/models`,
    {
      headers: { authorization: `Bearer ${options.apiKey}` },
    },
  )
  const body = (await response.json()) as JsonValue
  if (!response.ok)
    throw new Error(readProviderErrorMessage(body, response.status))
  if (!isObject(body) || !Array.isArray(body.data))
    throw new Error('Provider model list response is invalid')
  return [
    ...new Set(
      body.data.flatMap((item) => {
        if (!isObject(item) || typeof item.id !== 'string') return []
        const id = item.id.trim()
        return id ? [id] : []
      }),
    ),
  ]
}

function createModel(provider: AiProviderConfig, modelId: string) {
  const settings = {
    apiKey: provider.apiKey,
    ...(provider.baseUrl
      ? { baseURL: normalizeBaseUrl(provider.baseUrl) }
      : {}),
    ...(provider.name ? { name: provider.name } : {}),
    ...(provider.fetch ? { fetch: provider.fetch } : {}),
  }
  if (provider.kind === 'openai') return createOpenAI(settings).chat(modelId)
  if (provider.kind === 'anthropic') return createAnthropic(settings)(modelId)
  if (provider.kind === 'google')
    return createGoogleGenerativeAI(settings)(modelId)
  return createOpenAICompatible({
    ...settings,
    baseURL: normalizeBaseUrl(provider.baseUrl ?? 'https://api.openai.com/v1'),
    name: provider.name ?? 'openai-compatible',
  })(modelId)
}

function createTools(tools: NonNullable<AiGatewayRequest['tools']>): ToolSet {
  const result: ToolSet = {}
  for (const definition of tools) {
    if (!definition.name.trim()) throw new Error('Tool name cannot be empty')
    if (definition.name in result)
      throw new Error(`Duplicate tool name: ${definition.name}`)
    result[definition.name] = tool({
      ...(definition.description
        ? { description: definition.description }
        : {}),
      inputSchema: jsonSchema(definition.inputSchema),
    })
  }
  return result
}

function validateToolChoice(
  choice: AiGatewayRequest['toolChoice'],
  tools: ToolSet | undefined,
): void {
  if (!choice || choice === 'auto' || choice === 'none') return
  if (!tools || Object.keys(tools).length === 0) {
    throw new Error('Tool choice requires at least one registered tool')
  }
  if (typeof choice === 'object' && !(choice.toolName in tools)) {
    throw new Error(
      `Tool choice references an unknown tool: ${choice.toolName}`,
    )
  }
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const toolNames = new Map<string, string>()
  return messages.map((message, index) => {
    if (message.role === 'system' || message.role === 'developer') {
      assertMessageContent(message.content, index)
      return { role: 'system', content: message.content }
    }
    if (message.role === 'user') {
      assertMessageContent(message.content, index)
      return { role: 'user', content: message.content }
    }
    if (message.role === 'assistant') {
      if (!message.content && !message.tool_calls?.length) {
        throw new Error(`Provider assistant message cannot be empty: messages[${index}]`)
      }
      const content: Array<
        | { type: 'text'; text: string }
        | {
            type: 'tool-call'
            toolCallId: string
            toolName: string
            input: unknown
          }
      > = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.tool_calls ?? []) {
        if (call.type !== 'function' || !call.id.trim() || !call.function.name.trim() || typeof call.function.arguments !== 'string') {
          throw new Error(`Provider tool call is invalid: messages[${index}]`)
        }
        toolNames.set(call.id, call.function.name)
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.function.name,
          input: parseToolInput(call.function.arguments, index),
        })
      }
      return { role: 'assistant', content }
    }
    if (message.role !== 'tool')
      throw new Error(`Unsupported message role: messages[${index}]`)
    assertMessageContent(message.content, index)
    if (!message.tool_call_id.trim()) throw new Error(`Provider tool_call_id cannot be empty: messages[${index}]`)
    const toolName = toolNames.get(message.tool_call_id)
    if (!toolName)
      throw new Error(
        `Tool result has no matching assistant tool call: messages[${index}].tool_call_id`,
      )
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: message.tool_call_id,
          toolName,
          output: { type: 'text', value: message.content },
        },
      ],
    }
  })
}

function assertMessageContent(content: string, index: number): void {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error(`Provider message content cannot be empty: messages[${index}]`)
  }
}

function parseToolInput(input: string, messageIndex: number): unknown {
  try {
    return JSON.parse(input)
  } catch {
    throw new Error(
      `Assistant tool call arguments must be valid JSON: messages[${messageIndex}]`,
    )
  }
}

function normalizeFinishReason(
  reason: string,
): AiGatewayResult['finishReason'] {
  if (reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  if (reason === 'tool-calls') return 'tool_call'
  if (reason === 'error') return 'error'
  return undefined
}

function readRequestId(
  headers: Record<string, string> | undefined,
): string | undefined {
  return headers?.['x-request-id'] ?? headers?.['request-id']
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === 'https://api.openai.com') return 'https://api.openai.com/v1'
  return trimmed
}

function readProviderErrorMessage(body: JsonValue, status: number): string {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.message === 'string'
  ) {
    return `Provider request failed (${status}): ${body.error.message}`
  }
  return `Provider request failed (${status})`
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (item === undefined ? null : item)),
  ) as JsonValue
}

function normalizeUsage(value: Parameters<typeof buildGatewayResult>[1]['usage']): AiGatewayResult['usage'] {
  const result = {
    inputTokens: value.inputTokens, outputTokens: value.outputTokens, totalTokens: value.totalTokens,
    cacheReadTokens: value.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: value.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: value.outputTokenDetails?.reasoningTokens,
  }
  const entries = Object.entries(result).filter(([, count]) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
  return entries.length ? Object.fromEntries(entries) : undefined
}
