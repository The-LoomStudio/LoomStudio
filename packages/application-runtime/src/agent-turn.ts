import type { ChatMessage } from '@loom-studio/shared'
import type { AgentMessage } from '@loom-studio/agent-store'
import type { DocumentStore } from '@loom-studio/document-store'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import {
  defaultCompositionSkeleton,
  promptSlotIds,
  promptZoneIds,
  type CompiledPrompt,
  type PromptContribution,
  type SourceNode,
} from './prompt-builder.js'
import type { ActivationFacts } from './prompt-activation.js'
import { compilePromptWithCore, type PromptBuildTrace } from './prompt-build-pipeline.js'
import { getPromptResource, readPromptResourceInputs, type PromptResourceContent } from './workspace.js'

export async function composeAgentTurnPrompt(input: {
  activationFacts?: ActivationFacts
  agentMessages: AgentMessage[]
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
  const runtimeInputs = createRuntimePromptSources({
    agentMessages: input.agentMessages,
    narrative: input.narrative,
    userInput: input.userInput,
  })
  const sourceNodes = [
    ...(resourceInputs?.sourceNodes ?? []),
    ...runtimeInputs.sourceNodes,
  ]
  const contributions = [
    ...(resourceInputs?.contributions ?? []),
    ...runtimeInputs.contributions,
  ]
  const resourceProjection = resourceInputs
    ? compilePromptWithCore({
        skeleton: defaultCompositionSkeleton,
        sourceNodes,
        contributions,
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
        sourceNodes,
        contributions,
        orderProfile: { id: 'profile.agent-empty', scope: 'global', slotRanks: [] },
        currentInput: input.userInput,
        activationFacts: input.activationFacts,
        buildId: input.buildId,
        runId: input.runId,
        agentSessionId: input.agentSessionId,
      })
  return {
    messages: resourceProjection.projection.messages,
    projection: resourceProjection.projection,
    promptBuildTrace: resourceProjection.trace,
  }
}

function createRuntimePromptSources(input: {
  agentMessages: AgentMessage[]
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
  }
  userInput: string
}): { sourceNodes: SourceNode[]; contributions: PromptContribution[] } {
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []

  if (input.narrative) {
    const rootId = `runtime.timeline:${input.narrative.timeline.id}`
    sourceNodes.push({
      id: rootId,
      sourceId: input.narrative.timeline.id,
      parentId: null,
      displayName: input.narrative.timeline.title ?? 'Narrative Timeline',
      orderIndex: 0,
    })
    input.narrative.nodes.forEach((node, index) => {
      const sourceNodeId = `runtime.timeline.node:${node.id}`
      sourceNodes.push({
        id: sourceNodeId,
        sourceId: input.narrative!.timeline.id,
        parentId: rootId,
        displayName: `Narrative ${index + 1}`,
        orderIndex: index + 1,
      })
      if (node.body.raw.trim().length === 0) return
      contributions.push({
        id: `runtime.narrative:${node.id}`,
        sourceRef: {
          kind: 'narrativeHistory',
          sourceId: input.narrative!.timeline.id,
          sourceNodeId,
        },
        content: node.body.raw,
        capabilities: {
          projection: {
            zoneId: promptZoneIds.narrativeHistory,
            joinSlotKey: promptSlotIds.narrativeMain,
            slotOrderHint: 0,
            entryOrderHint: index,
          },
          lifecycle: { lifecycle: 'always' },
          render: { wrapper: 'section', roleHint: 'developer', label: 'Narrative History' },
        },
      })
    })
  }

  const sessionRootId = 'runtime.session.history'
  sourceNodes.push({
    id: sessionRootId,
    sourceId: input.agentMessages[0]?.agentSessionId ?? 'agent-session',
    parentId: null,
    displayName: 'Session History',
    orderIndex: 0,
  })
  input.agentMessages.forEach(agentMessage => {
    const message = agentMessage.message
    if (message.role === 'tool' || (message.role === 'assistant' && message.tool_calls?.length)) {
      throw new Error(`Agent Session tool messages are not yet supported by PromptBuild: ${agentMessage.id}`)
    }
    const content = 'content' in message && typeof message.content === 'string' ? message.content : undefined
    if (!content || content.trim().length === 0) {
      throw new Error(`Agent Session message cannot enter PromptBuild without text content: ${agentMessage.id}`)
    }
    const sourceNodeId = `runtime.session.message:${agentMessage.id}`
    sourceNodes.push({
      id: sourceNodeId,
      sourceId: agentMessage.agentSessionId,
      parentId: sessionRootId,
      displayName: `Message ${agentMessage.sequence}`,
      orderIndex: agentMessage.sequence,
    })
    contributions.push({
      id: `runtime.session:${agentMessage.id}`,
      sourceRef: {
        kind: 'sessionHistory',
        sourceId: agentMessage.agentSessionId,
        sourceNodeId,
      },
      content,
      capabilities: {
        projection: {
          zoneId: promptZoneIds.sessionHistory,
          joinSlotKey: promptSlotIds.sessionMain,
          slotOrderHint: 0,
          entryOrderHint: agentMessage.sequence,
        },
        lifecycle: { lifecycle: 'always' },
        render: { wrapper: 'message', roleHint: message.role },
      },
    })
  })

  const currentRootId = 'runtime.current.turn'
  const currentNodeId = 'runtime.current.input'
  sourceNodes.push(
    {
      id: currentRootId,
      sourceId: 'runtime.current-turn',
      parentId: null,
      displayName: 'Current Turn',
      orderIndex: 0,
    },
    {
      id: currentNodeId,
      sourceId: 'runtime.current-turn',
      parentId: currentRootId,
      displayName: 'User Input',
      orderIndex: 0,
    },
  )
  contributions.push({
    id: 'runtime.current.input',
    sourceRef: {
      kind: 'runtime',
      sourceId: 'runtime.current-turn',
      sourceNodeId: currentNodeId,
    },
    content: input.userInput,
    capabilities: {
      projection: {
        zoneId: promptZoneIds.currentTurn,
        joinSlotKey: promptSlotIds.currentInput,
        slotOrderHint: 0,
        entryOrderHint: 0,
      },
      lifecycle: { lifecycle: 'fresh' },
      render: { wrapper: 'message', roleHint: 'user', label: 'Current Input' },
    },
  })

  return { sourceNodes, contributions }
}
