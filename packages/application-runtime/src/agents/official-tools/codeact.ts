import { executeCodeAct } from '../codeact/execute.js'
import { renderCodeActTutorial } from '../codeact/prompts.js'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialCodeActTool: ToolDefinition = {
  id: 'official/codeact',
  owner: { namespace: 'official' },
  name: 'codeact',
  description: 'FREEFORM JavaScript, NOT a JSON tool. Never call codeact through native tool_calls or wrap its source in {"code":"..."}. Emit <loom_tool name="codeact"><metadata>{}</metadata><content>RAW JAVASCRIPT</content></loom_tool> in assistant content. Supports documented ctx methods for Narrative and guarded resource/State writes.',
  input: { kind: 'freeform', mediaType: 'application/javascript' },
  prompt: { guidance: renderCodeActTutorial(), content: { targetAnchorId: '@chat.tools' } },
}

export const officialCodeActJsonTool: ToolDefinition = {
  id: 'official/codeact_json',
  owner: { namespace: 'official' },
  name: 'codeact_json',
  description: 'JSON alternative to Freeform codeact. Call codeact_json through native tool_calls with {"code":"JavaScript source"}. Do not use this JSON envelope with the separate Freeform codeact tool. Supports the same documented ctx methods.',
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
  approve: context => context.action
    ? context.requestHistoryApproval?.(context.action, context.signal)
      ?? { decision: 'deny', reason: 'Narrative history approval is unavailable in this host.' }
    : { decision: 'allow' },
}

export const officialCodeActJsonRegistration: ToolRuntimeRegistration = {
  toolId: officialCodeActJsonTool.id,
  execute: executeCodeAct,
  approve: officialCodeActRegistration.approve,
}
