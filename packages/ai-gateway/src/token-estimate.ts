import { countText, applyTokenMultiplier, type TokenCountOptions } from '@loom-studio/tokenizer'
import type { TokenCount } from '@loom-studio/tokenizer/contracts'
import type { ChatMessage, JsonObject } from '@loom-studio/shared'

export interface RequestTokenEstimate extends TokenCount {
  scope: 'canonical-content-v1'
  messages: number[]
  tools: number[]
  uncounted: string[]
}

export function estimateRequestTokens(input: {
  messages: readonly ChatMessage[]
  tools?: readonly { name: string; description?: string; inputSchema: JsonObject }[]
}, options: TokenCountOptions = {}): RequestTokenEstimate {
  const count = (text: string) => countText(text).baseTokens
  const messages = input.messages.map(message => {
    let total = count(message.content ?? '')
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) total += count(call.function.name) + count(call.function.arguments)
    }
    return total
  })
  const tools = (input.tools ?? []).map(tool =>
    count(tool.name) + count(tool.description ?? '') + count(JSON.stringify(tool.inputSchema)),
  )
  return {
    ...applyTokenMultiplier([...messages, ...tools].reduce((sum, value) => sum + value, 0), options.multiplier),
    scope: 'canonical-content-v1',
    messages,
    tools,
    uncounted: ['provider-role-framing', 'private-protocol-overhead', 'multimodal', 'hidden-reasoning'],
  }
}
