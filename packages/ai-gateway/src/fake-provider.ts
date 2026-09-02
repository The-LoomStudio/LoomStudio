import type { JsonObject, JsonValue } from '@loom-studio/shared'

export const officialFakeModelId = 'fake-echo-m0'

export function createOfficialFakeChatCompletion(input: {
  id: string
  messages: JsonValue
}): { completion: JsonObject; text: string } {
  const text = `Agent draft: ${readLastUserText(input.messages)}`
  return {
    text,
    completion: {
      id: input.id,
      object: 'chat.completion',
      created: 0,
      model: officialFakeModelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    },
  }
}

function readLastUserText(messages: JsonValue): string {
  if (!Array.isArray(messages)) throw new Error('Fake Chat Completion input requires messages')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message
      && typeof message === 'object'
      && !Array.isArray(message)
      && message.role === 'user'
    ) {
      if (typeof message.content === 'string') return message.content
      if (Array.isArray(message.content) && message.content.length > 0) {
        const first = message.content[0]
        if (first && typeof first === 'object' && 'type' in first && first.type === 'text' && 'text' in first && typeof first.text === 'string') {
          return first.text
        }
      }
    }
  }
  throw new Error('Fake Chat Completion input requires a user message with string content')
}
