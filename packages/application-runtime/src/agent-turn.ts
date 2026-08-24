import type { ChatMessage } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import type { AgentTranscriptEntry } from '@loom-studio/agent-store'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import {
  defaultCompositionSkeleton,
  emptyProjectionOrderProfile,
  promptBindingIds,
  promptSlotIds,
  promptZoneIds,
  type CompiledPrompt,
  type PromptContribution,
  type SourceNode,
} from './prompt-builder.js'
import type { ActivationFacts } from './prompt-activation.js'
import { compilePromptWithCore, type PromptBuildTrace } from './prompt-build-pipeline.js'
import { readPromptResourceInputs, type PromptResourceContent } from './workspace.js'

export async function composeAgentTurnPrompt(input: {
  activationFacts?: ActivationFacts
  macroContext?: { user: string }
  agentMessages: AgentTranscriptEntry[]
  promptResources: PromptResourceStore
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
  }
  preset: PromptResourceContent & { id: string }
  userInput: string
  buildId?: string
  runId?: string
  agentSessionId?: string
  externalRuntime?: {
    sourceNodes: SourceNode[]
    contributions: PromptContribution[]
    slotRanks?: Array<{ zoneId: string; slotKey: string; rankKey: string }>
  }
}): Promise<{ messages: ChatMessage[]; projection: CompiledPrompt; promptBuildTrace: PromptBuildTrace }> {
  const manualMounts = await input.promptResources.listSettingMounts({ source: { kind: 'manual', id: 'global' } })
  const presetMounts = await input.promptResources.listSettingMounts({ source: { kind: 'preset', id: input.preset.id } })
  const timelineSettingIds = input.narrative
    ? (await Promise.all(input.narrative.timeline.promptResourceIds.map(async resourceId => {
        const resource = await input.promptResources.getResource(resourceId)
        if (!resource) throw new Error(`Prompt resource not found: ${resourceId}`)
        return resource
      })))
      .filter(resource => resource.resourceKind === 'setting')
      .map(resource => resource.id)
    : []
  const resourceIds = [...new Set([
    input.preset.id,
    ...manualMounts.map(mount => mount.settingResourceId),
    ...presetMounts.map(mount => mount.settingResourceId),
    ...timelineSettingIds,
  ])]
  const resourceInputs = resourceIds.length
    ? await readPromptResourceInputs({
        promptResources: input.promptResources,
        resourceIds,
        macroContext: input.macroContext ?? { user: 'User' },
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
    ...(input.externalRuntime?.sourceNodes ?? []),
  ]
  const contributions = [
    ...(resourceInputs?.contributions ?? []),
    ...runtimeInputs.contributions,
    ...(input.externalRuntime?.contributions ?? []),
  ]
  const resourceOrderProfile = resourceInputs?.orderProfile ?? emptyProjectionOrderProfile
  const rankedSlots = new Set(
    resourceOrderProfile.slotRanks.map(rank => `${rank.zoneId}\u0000${rank.slotKey}`),
  )
  const orderProfile = {
    ...resourceOrderProfile,
    slotRanks: [
      ...resourceOrderProfile.slotRanks,
      ...(input.externalRuntime?.slotRanks ?? []).filter(
        rank => !rankedSlots.has(`${rank.zoneId}\u0000${rank.slotKey}`),
      ),
    ],
  }
  const resourceProjection = compilePromptWithCore({
    skeleton: defaultCompositionSkeleton,
    sourceNodes,
    contributions,
    orderProfile,
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
  return {
    messages: resourceProjection.projection.messages,
    projection: resourceProjection.projection,
    promptBuildTrace: resourceProjection.trace,
  }
}

function createRuntimePromptSources(input: {
  agentMessages: AgentTranscriptEntry[]
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
            bindingId: promptBindingIds.narrativeHistory,
            joinSlotKey: promptSlotIds.narrativeMain,
            slotOrderHint: 0,
            entryOrderHint: index,
          },
          lifecycle: { lifecycle: 'always' },
          // Narrative Timeline only contributes context. The containing
          // MessageBlock owns the provider role when the contribution is
          // compiled into a message.
          render: { wrapper: 'section', label: 'Narrative History' },
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
    const message = agentMessage.entry
    if (message.kind !== 'message') return
    const content = message.content
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
          bindingId: promptBindingIds.sessionHistory,
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
        bindingId: promptBindingIds.currentInput,
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
