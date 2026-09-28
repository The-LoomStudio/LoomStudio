import type { ChatMessage } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/application-data'
import type { AgentTranscriptEntry } from '@loom-studio/application-data'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/application-data'
import type {
  CompiledPrompt,
  PromptContribution,
  SourceNode,
} from '../prompt/prompt-builder.js'
import type { ActivationFacts } from '../prompt/prompt-activation.js'
import { compilePromptDataModel, type PromptBuildTrace } from '../prompt/prompt-build-pipeline.js'
import { readPromptResourceInputs } from '../cards/workspace.js'
import type { PromptResourceContent } from '../cards/workspace-types.js'
import { createPromptToolExecutionScope } from './official-tools/index.js'
import type { ToolExecutionScope } from './tool-registry.js'
import { cloneVariableRenderTrace, createVariableRenderContext, type VariableRenderContext } from '../prompt/variables.js'
import { projectHistoryEntries, type TextTransformRuleEntry } from '../transforms/history-text.js'
import { projectNarrativeNodes } from '../narrative/projection.js'
import { projectSessionHistory } from './session-history.js'
import type { ResolvedNarrativeContext } from '../narrative/context-provider.js'
import { isExtensionResourceAvailable } from '../runtime/extension-resource-access.js'

export async function composeAgentTurnPrompt(input: {
  activationFacts?: ActivationFacts
  variables?: VariableRenderContext
  agentMessages: AgentTranscriptEntry[]
  promptResources: PromptResourceStore
  contextResourceIds: readonly string[]
  availableExtensionInstallations?: ReadonlyMap<string, string>
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
    branchId: string
    context?: ResolvedNarrativeContext
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
  const diagnostics: PromptBuildTrace['diagnostics'] = []
  const missingResourceIds = new Set<string>()
  const readableResourceIds = new Set<string>()
  const warnMissingResource = (resourceId: string) => {
    if (resourceId === input.preset.id) throw new Error(`Prompt resource not found: ${resourceId}`)
    if (missingResourceIds.has(resourceId)) return
    missingResourceIds.add(resourceId)
    diagnostics.push({
      severity: 'warning',
      code: 'prompt.resource_missing',
      resourceId,
      message: `Skipped missing optional Prompt resource: ${resourceId}`,
    })
  }
  const manualMounts = await input.promptResources.listSettingMounts({ source: { kind: 'manual', id: 'global' } })
  const contextSettingIds = (await Promise.all(input.contextResourceIds.map(async resourceId => {
    const resource = await input.promptResources.getResource(resourceId)
    if (!resource) warnMissingResource(resourceId)
    return resource
  }))).flatMap(resource => resource?.resourceKind === 'setting' ? [resource.id] : [])
  const resourceIds = [...new Set([
    input.preset.id,
    ...manualMounts.map(mount => mount.settingResourceId),
    ...contextSettingIds,
  ])]
  const resourceInputs = resourceIds.length
    ? await readPromptResourceInputs({
        promptResources: input.promptResources,
        resourceIds,
        variables,
        onMissingResource: warnMissingResource,
        canReadResource: resource => {
          if (!isExtensionResourceAvailable(resource.origin, input.availableExtensionInstallations)) {
            if (resource.id === input.preset.id) throw new Error(`Agent Preset is not available in this context: ${resource.id}`)
            diagnostics.push({
              severity: 'warning', code: 'prompt.resource_unavailable', resourceId: resource.id,
              message: `Skipped Prompt resource outside the current installation context: ${resource.id}`,
            })
            return false
          }
          readableResourceIds.add(resource.id)
          return true
        },
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
    skeletonRootId: input.preset.rootNode.id,
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
    diagnostics,
    ...(input.narrative?.context ? {
      narrativeContext: {
        sourceId: input.narrative.context.sourceId,
        version: input.narrative.context.version,
        coveredThroughNodeId: input.narrative.context.memory?.coveredThroughNodeId ?? null,
        rawThroughNodeId: input.narrative.context.rawThroughNodeId,
      },
    } : {}),
    executions: []
  }

  return {
    messages: resourceProjection.messages,
    projection: resourceProjection,
    promptBuildTrace: {
      ...trace,
      variables: cloneVariableRenderTrace(variables.trace),
    },
    toolExecutionScope: {
      ...createPromptToolExecutionScope({
        prompt: resourceProjection,
        contributions,
        sourceNodes,
        promptResources: input.promptResources,
        workspaceResourceAccess: !input.narrative,
        availableExtensionInstallations: input.availableExtensionInstallations,
      }),
      vfsResourceIds: [...readableResourceIds],
    },
  }
}

function createRuntimePromptSources(input: {
  agentMessages: AgentTranscriptEntry[]
  narrative?: {
    timeline: NarrativeTimeline
    nodes: NarrativeNode[]
    branchId: string
    context?: ResolvedNarrativeContext
  }
  userInput: string
  historyRules?: {
    narrative: TextTransformRuleEntry[]
    session: TextTransformRuleEntry[]
  }
}): { sourceNodes: SourceNode[]; contributions: PromptContribution[] } {
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []
  const summary = [...input.agentMessages].reverse().find(entry => entry.entry.kind === 'work-summary')
  if (summary?.entry.kind === 'work-summary') {
    input = { ...input, agentMessages: input.agentMessages.filter(entry => entry.sequence > summary.sequence) }
    const id = `runtime.session.summary:${summary.id}`
    sourceNodes.push({
      id, sourceId: summary.agentSessionId, parentId: null,
      displayName: 'Session Work Summary', orderIndex: 0, kind: 'virtual',
    })
    contributions.push({
      id,
      sourceRef: { kind: 'runtime', sourceId: summary.agentSessionId, sourceNodeId: id },
      content: summary.entry.content,
      capabilities: { targetAnchorId: '@memory.session', localDepth: 0 },
    })
  }

  if (input.narrative) {
    const context = input.narrative.context
    for (const [index, memory] of (context?.memory?.entries ?? []).entries()) {
      const id = `runtime.memory:${JSON.stringify([context!.sourceId, memory.id])}`
      sourceNodes.push({
        id,
        sourceId: context!.sourceId,
        parentId: null,
        displayName: memory.id,
        orderIndex: index,
        kind: 'virtual',
      })
      contributions.push({
        id,
        sourceRef: { kind: 'runtime', sourceId: context!.sourceId, sourceNodeId: id },
        content: memory.content,
        capabilities: { targetAnchorId: '@memory.narrative', localDepth: index },
      })
    }
    const rootId = `runtime.timeline:${input.narrative.timeline.id}`
    sourceNodes.push({
      id: rootId,
      sourceId: input.narrative.timeline.id,
      parentId: null,
      displayName: input.narrative.timeline.title ?? 'Narrative Timeline',
      orderIndex: 0, kind: 'folder',
    })
    const projectedNarrative = projectNarrativeNodes({
      timelineId: input.narrative.timeline.id,
      branchId: input.narrative.branchId,
      nodes: input.narrative.nodes,
    }, {
      phase: 'prompt',
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
      const content = narrativeText.get(node.id)
      if (content === undefined) {
        throw new Error(`Narrative entry is missing projected text content: ${node.id}`)
      }
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
    preserveRuleOrder: true,
  })
  const sessionText = new Map(projectedSession.entries.map(entry => [entry.id, entry.text]))
  projectSessionHistory(input.agentMessages, sessionText).forEach(({ entry: agentMessage, messages }) => {
    const sourceNodeId = `runtime.session.${agentMessage.entry.kind}:${agentMessage.id}`
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
      content: messages.map(message => message.content ?? '').join('\n'),
      messages,
      capabilities: {
        targetAnchorId: '@chat.session',
        localDepth: agentMessage.sequence,
        roleHint: messages[0]?.role === 'user' ? 'user' : 'assistant',
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
