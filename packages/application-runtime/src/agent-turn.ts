import type { ChatMessage } from '@loom-studio/shared'
import type { DocumentStore } from '@loom-studio/document-store'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import type { AgentPresetContent } from './types.js'
import { compilePromptDataModel, defaultCompositionSkeleton, type CompiledPrompt } from './prompt-builder.js'
import type { ActivationFacts } from './prompt-activation.js'
import { readPromptResourceInputs } from './workspace.js'

export async function composeAgentTurnPrompt(input: {
  activationFacts?: ActivationFacts
  agentMessages: ChatMessage[]
  agentPreset: AgentPresetContent
  documents: DocumentStore
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
  }
  userInput: string
}): Promise<{ messages: ChatMessage[]; projection: CompiledPrompt }> {
  const resourceIds = [...new Set([
    ...input.agentPreset.promptResourceIds,
    ...(input.narrative?.timeline.promptResourceIds ?? []),
  ])]
  const resourceInputs = resourceIds.length
    ? await readPromptResourceInputs({
        documents: input.documents,
        resourceIds,
        macroContext: { user: 'User' },
      })
    : undefined
  const resourceProjection = resourceInputs
    ? compilePromptDataModel({
        skeleton: defaultCompositionSkeleton,
        sourceNodes: resourceInputs.sourceNodes,
        contributions: resourceInputs.contributions,
        orderProfile: resourceInputs.orderProfile,
        currentInput: input.userInput,
        activationFacts: input.activationFacts,
      })
    : compilePromptDataModel({
        skeleton: defaultCompositionSkeleton,
        sourceNodes: [],
        contributions: [],
        orderProfile: { id: 'profile.agent-empty', scope: 'global', slotRanks: [] },
        currentInput: input.userInput,
        activationFacts: input.activationFacts,
      })
  const narrativeMessage: ChatMessage[] = input.narrative?.nodes.length
    ? [{
        role: 'developer',
        content: `Accepted narrative context:\n\n${input.narrative.nodes.map(node => node.body.raw).join('\n\n')}`,
      }]
    : []

  return {
    messages: [
      { role: 'developer', content: input.agentPreset.instructions },
      ...resourceProjection.messages,
      ...narrativeMessage,
      ...input.agentMessages,
      { role: 'user', content: input.userInput },
    ],
    projection: resourceProjection,
  }
}
