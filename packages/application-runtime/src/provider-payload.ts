import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ChatMessage } from '@loom-studio/shared'
import { isObject } from './json.js'
import type { ModelProfileConfig, ProviderMessage } from './types.js'

export type OpenAIChatMessage = ChatMessage

export type OpenAIChatPayload = JsonObject & {
  model: string
  messages: OpenAIChatMessage[]
  stream: false
}

const numberParams = new Set([
  'frequency_penalty',
  'max_completion_tokens',
  'max_tokens',
  'presence_penalty',
  'seed',
  'temperature',
  'top_p',
])

export function buildOpenAIChatPayload(input: {
  messages: ProviderMessage[]
  modelProfile: ModelProfileConfig
}): OpenAIChatPayload {
  assertModel(input.modelProfile.providerModelId, input.modelProfile.id)
  const config = normalizeProviderConfig(input.modelProfile.config ?? {})

  return {
    ...config,
    model: input.modelProfile.providerModelId,
    messages: input.messages.map((message, index) => normalizeMessage(message, index)),
    stream: false,
  }
}

function normalizeMessage(message: ProviderMessage, index: number): OpenAIChatMessage {
  if (message.role === 'system' || message.role === 'developer' || message.role === 'user') {
    assertContent(message.content, index)
    return { role: message.role, content: message.content }
  }
  if (message.role === 'tool') {
    assertContent(message.content, index)
    if (message.tool_call_id.trim().length === 0) {
      throw new Error(`OpenAI chat payload tool_call_id cannot be empty: messages[${index}].tool_call_id`)
    }
    return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content }
  }
  if (message.role !== 'assistant') {
    throw new Error(`OpenAI chat payload message role is not supported: messages[${index}].role`)
  }

  const content = typeof message.content === 'string' && message.content.length > 0 ? message.content : undefined
  const toolCalls = message.tool_calls?.map((call, callIndex) => {
    if (call.type !== 'function' || call.id.trim().length === 0 || call.function.name.trim().length === 0 || typeof call.function.arguments !== 'string') {
      throw new Error(`OpenAI chat payload tool call is invalid: messages[${index}].tool_calls[${callIndex}]`)
    }
    return structuredClone(call)
  })
  if (!content && (!toolCalls || toolCalls.length === 0)) {
    throw new Error(`OpenAI chat payload assistant message cannot be empty: messages[${index}]`)
  }
  return {
    role: 'assistant',
    ...(content ? { content } : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
  }
}

function assertContent(content: string, index: number): void {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error(`OpenAI chat payload message content cannot be empty: messages[${index}].content`)
  }
}

function normalizeProviderConfig(config: JsonObject): JsonObject {
  const merged = {
    ...config,
    ...(isObject(config.additionalParameters) ? config.additionalParameters : {}),
  }
  const excluded = readExcludedParams(config.excludeParameters)
  const output: JsonObject = {}

  for (const [key, value] of Object.entries(merged)) {
    if (excluded.has(key)) continue
    if (key === 'additionalParameters' || key === 'customHeaders' || key === 'excludeParameters' || key === 'stream') continue
    if (numberParams.has(key)) {
      output[key] = readNumberParam(key, value)
    } else if (key === 'stop') {
      output.stop = readStopParam(value)
    } else if (key === 'response_format') {
      if (!isObject(value)) throw new Error('OpenAI chat payload response_format must be an object')
      output.response_format = value
    }
  }

  return output
}

function readExcludedParams(value: JsonValue | undefined): Set<string> {
  if (value === undefined) return new Set()
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error('OpenAI chat payload excludeParameters must be a string array')
  }
  return new Set(value)
}

function readNumberParam(key: string, value: JsonValue): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`OpenAI chat payload parameter must be a finite number: ${key}`)
  }
  return value
}

function readStopParam(value: JsonValue): string | string[] {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value
  throw new Error('OpenAI chat payload stop must be a string or string array')
}

function assertModel(model: string, profileId: string): void {
  if (model.trim().length === 0) {
    throw new Error(`ModelProfile ${profileId} providerModelId cannot be empty`)
  }
}
