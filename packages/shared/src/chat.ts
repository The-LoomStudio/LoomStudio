export type ChatToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type AssistantChatMessage = Extract<ChatMessage, { role: 'assistant' }>
