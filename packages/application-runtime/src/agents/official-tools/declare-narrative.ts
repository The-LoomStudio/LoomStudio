import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialDeclareNarrativeTool: ToolDefinition = {
  id: 'official/declare_narrative',
  owner: { namespace: 'official' },
  name: 'declare_narrative',
  description: 'Declare the next ordinary assistant text as narrative. After writing it, continue working or finish with an ordinary reply.',
  input: { kind: 'structured', schema: { type: 'object', properties: {}, additionalProperties: false } },
  prompt: { provider: { order: 50 } },
}

export const officialDeclareNarrativeRegistration: ToolRuntimeRegistration = {
  toolId: officialDeclareNarrativeTool.id,
  execute: async ({ invocation, scope }) => {
    if (!scope?.narrative?.declareNext) throw new Error('Narrative output declaration is not available in this Agent turn')
    scope.narrative.declareNext()
    return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [{ type: 'text', text: 'The next ordinary assistant text will be adopted as narrative.' }] }
  },
}
