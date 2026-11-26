import type { ChatAttachment } from './chat-attachments.js'

export type ChatToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ChatMessage =
  | { role: 'system' | 'developer'; content: string }
  | { role: 'user'; content: string; attachments?: ChatAttachment[] }
  | {
      role: 'assistant'
      content?: string
      tool_calls?: ChatToolCall[]
      /**
       * Provider-native thinking content required by some OpenAI-compatible
       * models when the request carries tools. This is transport state, not
       * assistant-visible content.
       */
      reasoning_content?: string
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export type AssistantChatMessage = Extract<ChatMessage, { role: 'assistant' }>
