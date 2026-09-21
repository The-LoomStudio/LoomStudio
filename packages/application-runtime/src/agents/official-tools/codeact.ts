import { executeCodeAct } from '../codeact/execute.js'
import { renderCodeActTutorial } from '../codeact/prompts.js'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialCodeActTool: ToolDefinition = {
  id: 'official/codeact',
  owner: { namespace: 'official' },
  name: 'codeact',
  description: 'Execute JavaScript with the documented ctx methods, including guarded replace, patch, move, delete, create and copy writes. Send raw source using the Content Tool protocol; metadata must be {}.',
  input: { kind: 'freeform', mediaType: 'application/javascript' },
  prompt: { guidance: renderCodeActTutorial(), content: { targetAnchorId: '@chat.tools' } },
}

export const officialCodeActJsonTool: ToolDefinition = {
  id: 'official/codeact_json',
  owner: { namespace: 'official' },
  name: 'codeact_json',
  description: 'Execute JavaScript with the documented ctx methods, including guarded replace, patch, move, delete, create and copy writes. Read the CodeAct tutorial in the stable tool instructions.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { code: { type: 'string', minLength: 1, maxLength: 40960 } },
      required: ['code'],
      additionalProperties: false,
    },
  },
  prompt: { guidance: renderCodeActTutorial(), content: { targetAnchorId: '@chat.tools' } },
}

export const officialCodeActRegistration: ToolRuntimeRegistration = {
  toolId: officialCodeActTool.id,
  execute: executeCodeAct,
}

export const officialCodeActJsonRegistration: ToolRuntimeRegistration = {
  toolId: officialCodeActJsonTool.id,
  execute: executeCodeAct,
}
