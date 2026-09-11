export const officialPromptResourceIds = {
  assistantPreset: 'prompt-resource.official.loom-assistant',
  knowledgeSetting: 'prompt-resource.official.loom-knowledge',
} as const

export const obsoleteBuiltinAgentToolIds = new Set([
  'official/test_structured',
  'official/test_content',
])

export const obsoleteBuiltinAgentToolDescriptions = new Map([
  [
    'official/search_context',
    'Search active context items already authorized for the current Agent turn. Returns item IDs and short snippets for read_context.',
  ],
  [
    'official/read_context',
    'Read one or more full context items already authorized for the current Agent turn.',
  ],
])
