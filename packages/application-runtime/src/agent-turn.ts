import type { ChatMessage } from '@loom-studio/shared'
import type { DocumentStore } from '@loom-studio/document-store'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import { defaultCompositionSkeleton, type CompiledPrompt } from './prompt-builder.js'
import type { ActivationFacts } from './prompt-activation.js'
import { compilePromptWithCore, type PromptBuildTrace } from './prompt-build-pipeline.js'
import { getPromptResource, readPromptResourceInputs, type PromptResourceContent } from './workspace.js'

export async function composeAgentTurnPrompt(input: {
  activationFacts?: ActivationFacts
  agentMessages: ChatMessage[]
  documents: DocumentStore
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
  }
  preset: PromptResourceContent & { id: string }
  userInput: string
  buildId?: string
  runId?: string
  agentSessionId?: string
}): Promise<{ messages: ChatMessage[]; projection: CompiledPrompt; promptBuildTrace: PromptBuildTrace }> {
  // ponytail: Timeline.promptResourceIds is a transitional mixed field; ignore non-Setting resources until Card inventory and Timeline setting bindings are split physically.
  const timelineSettingIds = input.narrative
    ? (await Promise.all(input.narrative.timeline.promptResourceIds.map(resourceId => getPromptResource({
        documents: input.documents,
        resourceId,
      })))).filter(resource => resource.resourceKind === 'setting').map(resource => resource.id)
    : []
  const resourceIds = [...new Set([
    input.preset.id,
    ...(input.preset.linkedSettingIds ?? []),
    ...timelineSettingIds,
  ])]
  const resourceInputs = resourceIds.length
    ? await readPromptResourceInputs({
        documents: input.documents,
        resourceIds,
        macroContext: { user: 'User' },
      })
    : undefined
  const resourceProjection = resourceInputs
    ? compilePromptWithCore({
        skeleton: defaultCompositionSkeleton,
        sourceNodes: resourceInputs.sourceNodes,
        contributions: resourceInputs.contributions,
        orderProfile: resourceInputs.orderProfile,
        currentInput: input.userInput,
        activationFacts: input.activationFacts,
        buildId: input.buildId,
        runId: input.runId,
        agentSessionId: input.agentSessionId,
        ...(input.narrative ? {
          timelineId: input.narrative.timeline.id,
          branchId: input.narrative.timeline.activeBranchId,
        } : {}),
      })
    : compilePromptWithCore({
        skeleton: defaultCompositionSkeleton,
        sourceNodes: [],
        contributions: [],
        orderProfile: { id: 'profile.agent-empty', scope: 'global', slotRanks: [] },
        currentInput: input.userInput,
        activationFacts: input.activationFacts,
        buildId: input.buildId,
        runId: input.runId,
        agentSessionId: input.agentSessionId,
      })
  const narrativeMessage: ChatMessage[] = input.narrative?.nodes.length
    ? [{
        role: 'developer',
        content: `Accepted narrative context:\n\n${input.narrative.nodes.map(node => node.body.raw).join('\n\n')}`,
      }]
    : []

  return {
    messages: [
      ...resourceProjection.projection.messages,
      ...narrativeMessage,
      ...input.agentMessages,
      { role: 'user', content: input.userInput },
    ],
    projection: resourceProjection.projection,
    promptBuildTrace: resourceProjection.trace,
  }
}
