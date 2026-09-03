import type { JsonObject } from '@loom-studio/shared'
import type { ChatMessage } from '@loom-studio/shared'
import type { ProviderMessage } from '../types.js'

export type OpenAIChatMessage = ChatMessage

export type OpenAIChatPayload = JsonObject & {
  model: string
  messages: OpenAIChatMessage[]
  stream: false
}

export function buildOpenAIChatPayload(input: {
  messages: ProviderMessage[]
  modelId: string
}): OpenAIChatPayload {
  assertModel(input.modelId)

  return {
    model: input.modelId,
    messages: input.messages.map((message, index) => normalizeMessage(message, index)),
    stream: false,
  }
}

function normalizeMessage(message: ProviderMessage, index: number): OpenAIChatMessage {
  if (message.role === 'system' || message.role === 'developer' || message.role === 'user') {
    assertContent(message.content, index)
    return { role: message.role === 'developer' ? 'system' : message.role, content: message.content }
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

function assertModel(model: string): void {
  if (model.trim().length === 0) {
    throw new Error('Provider modelId cannot be empty')
  }
}
