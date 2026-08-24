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
import type {
  AiGatewayRequest,
  AiGatewayEvent,
  AiGatewayRun,
  AiGatewayResult,
  AiProviderConfig,
} from './types.js'

export function createAiGateway() {
  return {
    createRun: (input: AiGatewayRequest): AiGatewayRun => createGatewayRun(input),
    invokeChat: async (input: AiGatewayRequest): Promise<AiGatewayResult> =>
      await createGatewayRun({ ...input, delivery: 'complete' }).result,
  }
}

function createGatewayRun(input: AiGatewayRequest): AiGatewayRun {
  const id = createId('gateway-run')
  const stream = new GatewayEventStream()
  const controller = new AbortController()
  let cancelReason: string | undefined
  let terminal = false
  const cancel = (reason?: string) => {
    if (terminal || controller.signal.aborted) return
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
      terminal = true
      stream.push({ type: 'completed', runId: id, result: value })
      stream.close()
      return value
    } catch (error) {
      terminal = true
      if (controller.signal.aborted || isAbortError(error)) {
        stream.push({ type: 'cancelled', runId: id, ...(cancelReason ? { reason: cancelReason } : {}) })
      } else {
        stream.push({ type: 'failed', runId: id, error: toGatewayError(error) })
      }
      stream.close()
      throw error
    } finally {
      input.abortSignal?.removeEventListener('abort', onExternalAbort)
    }
  })()
  result.catch(() => undefined)
  return { id, events: stream, result, cancel }
}

async function executeComplete(input: AiGatewayRequest, abortSignal: AbortSignal): Promise<AiGatewayResult> {
  let rawResponse: JsonValue | undefined
  const prepared = prepareRequest(input, abortSignal, 'complete', body => { rawResponse = body })
  const result = await generateText(prepared)
  return buildGatewayResult(input, {
    text: result.text,
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
    toolCalls: await result.toolCalls,
    finishReason: await result.finishReason,
    rawFinishReason: await result.rawFinishReason,
    usage: await result.usage,
    response: await result.response,
    raw: toJsonValue({ rawFinishReason: await result.rawFinishReason, providerMetadata: await result.providerMetadata, warnings: await result.warnings }),
  })
}

function prepareRequest(input: AiGatewayRequest, abortSignal: AbortSignal, delivery: 'complete' | 'stream', capture?: (body: JsonValue) => void) {
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
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
  finishReason: string
  rawFinishReason?: string
  usage: { inputTokens?: number; outputTokens?: number }
  response: { id?: string; modelId?: string; headers?: Record<string, string> }
  raw: JsonValue
}): AiGatewayResult {
  const toolCalls = result.toolCalls.map(call => ({
    id: call.toolCallId,
    type: 'function' as const,
    function: { name: call.toolName, arguments: JSON.stringify(call.input) },
  }))
  const message = {
    role: 'assistant' as const,
    ...(result.text ? { content: result.text } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  }
  if (!message.content && !message.tool_calls) throw new Error('Provider assistant response did not include content or tool calls')
  return {
    message,
    text: result.text,
    provider: input.provider.name ?? input.provider.kind,
    model: result.response.modelId ?? input.modelId,
    finishReason: normalizeFinishReason(result.finishReason),
    ...(result.rawFinishReason ? { rawFinishReason: result.rawFinishReason } : {}),
    ...((typeof result.usage.inputTokens === 'number' || typeof result.usage.outputTokens === 'number') ? { usage: {
      ...(typeof result.usage.inputTokens === 'number' ? { inputTokens: result.usage.inputTokens } : {}),
      ...(typeof result.usage.outputTokens === 'number' ? { outputTokens: result.usage.outputTokens } : {}),
    } } : {}),
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

class GatewayEventStream implements AsyncIterable<AiGatewayEvent> {
  // ponytail: A single Provider Step currently retains its event history so late and multiple consumers see the same sequence; replace with a bounded broadcast buffer before exposing long-lived runs.
  private readonly values: AiGatewayEvent[] = []
  private readonly waiters: Array<() => void> = []
  private closed = false

  push(event: AiGatewayEvent): void {
    if (this.closed) return
    this.values.push(event)
    this.waiters.splice(0).forEach(resolve => resolve())
  }

  close(): void {
    this.closed = true
    this.waiters.splice(0).forEach(resolve => resolve())
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AiGatewayEvent> {
    let index = 0
    while (true) {
      if (index < this.values.length) yield this.values[index++]!
      else if (this.closed) return
      else await new Promise<void>(resolve => this.waiters.push(resolve))
    }
  }
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
      return { role: 'system', content: message.content }
    }
    if (message.role === 'user')
      return { role: 'user', content: message.content }
    if (message.role === 'assistant') {
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
