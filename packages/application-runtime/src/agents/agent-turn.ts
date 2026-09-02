import type { ChatMessage } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import type { AgentTranscriptEntry } from '@loom-studio/agent-store'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import type {
  CompiledPrompt,
  PromptContribution,
  SourceNode,
} from '../prompt/prompt-builder.js'
import type { ActivationFacts } from '../prompt/prompt-activation.js'
import { compilePromptDataModel, type PromptBuildTrace } from '../prompt/prompt-build-pipeline.js'
import { readPromptResourceInputs, type PromptResourceContent } from '../cards/workspace.js'
import { createPromptToolExecutionScope } from './official-tools/index.js'
import type { ToolExecutionScope } from './tool-registry.js'
import { cloneVariableRenderTrace, createVariableRenderContext, type VariableRenderContext } from '../prompt/variables.js'
import { projectHistoryEntries, type TextTransformRuleEntry } from '../transforms/history-text.js'

export async function composeAgentTurnPrompt(input: {
  activationFacts?: ActivationFacts
  variables?: VariableRenderContext
  agentMessages: AgentTranscriptEntry[]
  promptResources: PromptResourceStore
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
    branchId: string
  }
  preset: PromptResourceContent & { id: string }
  userInput: string
  historyRules?: {
    narrative: TextTransformRuleEntry[]
    session: TextTransformRuleEntry[]
  }
  buildId?: string
  runId?: string
  agentSessionId?: string
  externalRuntime?: {
    sourceNodes: SourceNode[]
    contributions: PromptContribution[]
  }
}): Promise<{ messages: ChatMessage[]; projection: CompiledPrompt; promptBuildTrace: PromptBuildTrace; toolExecutionScope: ToolExecutionScope }> {
  const variables = input.variables ?? createVariableRenderContext()
  const manualMounts = await input.promptResources.listSettingMounts({ source: { kind: 'manual', id: 'global' } })
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
    ...timelineSettingIds,
  ])]
  const resourceInputs = resourceIds.length
    ? await readPromptResourceInputs({
        promptResources: input.promptResources,
        resourceIds,
        variables,
      })
    : undefined
  const runtimeInputs = createRuntimePromptSources({
    agentMessages: input.agentMessages,
    narrative: input.narrative,
    userInput: input.userInput,
    historyRules: input.historyRules,
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
  const resourceProjection = compilePromptDataModel({
    sourceNodes,
    contributions,
    currentInput: input.userInput,
    activationFacts: input.activationFacts,
  })

  // Create a minimal trace for now since DFS compiler is simplified
  const trace: PromptBuildTrace = {
    version: 'core-compact-1',
    status: 'ok',
    buildId: input.buildId,
    runId: input.runId,
    agentSessionId: input.agentSessionId,
    initialFragmentCount: contributions.length,
    finalFragmentCount: resourceProjection.messages.length,
    messageFragmentCount: resourceProjection.messages.length,
    diagnostics: [],
    executions: []
  }

  return {
    messages: resourceProjection.messages,
    projection: resourceProjection,
    promptBuildTrace: {
      ...trace,
      variables: cloneVariableRenderTrace(variables.trace),
    },
    toolExecutionScope: createPromptToolExecutionScope({
      prompt: resourceProjection,
      contributions,
      sourceNodes,
    }),
  }
}

function createRuntimePromptSources(input: {
  agentMessages: AgentTranscriptEntry[]
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
    branchId: string
  }
  userInput: string
  historyRules?: {
    narrative: TextTransformRuleEntry[]
    session: TextTransformRuleEntry[]
  }
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
      orderIndex: 0, kind: 'folder',
    })
    const projectedNarrative = projectHistoryEntries({
      source: { kind: 'narrative', timelineId: input.narrative.timeline.id, branchId: input.narrative.branchId },
      phase: 'prompt',
      entries: input.narrative.nodes.map((node, index) => ({
        id: node.id,
        source: { kind: 'narrative' as const, timelineId: input.narrative!.timeline.id, branchId: input.narrative!.branchId },
        text: node.body.raw,
        sequence: index + 1,
        createdAt: node.createdAt,
      })),
      rules: input.historyRules?.narrative ?? [],
    })
    const narrativeText = new Map(projectedNarrative.entries.map(entry => [entry.id, entry.text]))
    input.narrative.nodes.forEach((node, index) => {
      const sourceNodeId = `runtime.timeline.node:${node.id}`
      sourceNodes.push({
        id: sourceNodeId,
        sourceId: input.narrative!.timeline.id,
        parentId: rootId,
        displayName: `Narrative ${index + 1}`,
        orderIndex: index + 1,
        kind: 'entry',
      })
      const content = narrativeText.get(node.id) ?? node.body.raw
      if (content.trim().length === 0) return
      contributions.push({
        id: `runtime.narrative:${node.id}`,
        sourceRef: {
          kind: 'narrativeHistory',
          sourceId: input.narrative!.timeline.id,
          sourceNodeId,
        },
        content,
        capabilities: {
          targetAnchorId: '@chat.narrative',
          localDepth: index,
          roleHint: 'developer',
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
    orderIndex: 0, kind: 'folder',
  })
  const projectedSession = projectHistoryEntries({
    source: { kind: 'agent-session', sessionId: input.agentMessages[0]?.agentSessionId ?? 'agent-session' },
    phase: 'prompt',
    entries: input.agentMessages.flatMap(agentMessage => agentMessage.entry.kind === 'message'
      ? [{
          id: agentMessage.id,
          source: { kind: 'agent-session' as const, sessionId: agentMessage.agentSessionId },
          role: agentMessage.entry.role,
          text: agentMessage.entry.content,
          sequence: agentMessage.sequence,
          createdAt: agentMessage.createdAt,
        }]
      : []),
    rules: input.historyRules?.session ?? [],
  })
  const sessionText = new Map(projectedSession.entries.map(entry => [entry.id, entry.text]))
  input.agentMessages.forEach(agentMessage => {
    const message = agentMessage.entry
    if (message.kind === 'reasoning') {
      if (message.replay !== 'assistant-content' || !message.content.trim()) return
      const sourceNodeId = `runtime.session.reasoning:${agentMessage.id}`
      sourceNodes.push({
        id: sourceNodeId,
        sourceId: agentMessage.agentSessionId,
        parentId: sessionRootId,
        displayName: `Reasoning ${agentMessage.sequence}`,
        orderIndex: agentMessage.sequence,
        kind: 'entry',
      })
      contributions.push({
        id: `runtime.session.reasoning:${agentMessage.id}`,
        sourceRef: { kind: 'sessionHistory', sourceId: agentMessage.agentSessionId, sourceNodeId },
        content: renderReasoningReplay(message.content, message.dialect),
        capabilities: {
          targetAnchorId: '@chat.session',
          localDepth: agentMessage.sequence,
          roleHint: 'assistant',
        },
      })
      return
    }
    if (message.kind !== 'message') return
    const content = sessionText.get(agentMessage.id) ?? message.content
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
      kind: 'entry',
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
        targetAnchorId: '@chat.session',
        localDepth: agentMessage.sequence,
        roleHint: message.role,
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
      orderIndex: 0, kind: 'folder',
    },
    {
      id: currentNodeId,
      sourceId: 'runtime.current-turn',
      parentId: currentRootId,
      displayName: 'User Input',
      orderIndex: 0, kind: 'folder',
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
      targetAnchorId: '@chat.input',
      localDepth: 0,
      roleHint: 'user',
    },
  })

  return { sourceNodes, contributions }
}

function renderReasoningReplay(content: string, dialect: string | undefined): string {
  if (!dialect) return content
  const safeDialect = /^[A-Za-z][A-Za-z0-9_.-]*$/.test(dialect) ? dialect : 'reasoning'
  return `<${safeDialect}>${content}</${safeDialect}>`
}
