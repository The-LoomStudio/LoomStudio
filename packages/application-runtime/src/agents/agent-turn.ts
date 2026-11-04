import { createTextRuleDescriptionInputs } from '../prompt/text-rule-descriptions.js'
import { attachmentMessage } from './message-attachments.js'
import type { ObservationBuild } from '../observability/types.js'
import type { ChatAttachment, ChatMessage } from '@loom-studio/shared'
import type { PromptResourceStore } from '@loom-studio/application-data'
import type { AgentTranscriptEntry } from '@loom-studio/application-data'
import type { NarrativeNode, NarrativeTimeline } from '@loom-studio/application-data'
import type {
  CompiledPrompt,
  PromptContribution,
  SourceNode,
} from '../prompt/prompt-builder.js'
import type { ActivationFacts } from '../prompt/prompt-activation.js'
import { appendBuildEvidence, recordMacroReads, compilePromptDataModel, type PromptBuildTrace } from '../prompt/prompt-build-pipeline.js'
import { processPrompt, type ProcessedPromptSnapshot } from '../prompt/process-prompt.js'
import type { PromptProcessorRegistry } from '../prompt/prompt-processor-registry.js'
import type { ExtensionPromptProcessingContext } from '@loom-studio/extension-sdk'
import { readPromptResourceInputs } from '../cards/card-bundle.js'
import type { PromptResourceContent } from '../prompt/prompt-resource-types.js'
import { createPromptToolExecutionScope } from './official-tools/index.js'
import type { ToolExecutionScope } from './tool-registry.js'
import { cloneVariableRenderTrace, createVariableRenderContext, renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import { type TextTransformRuleEntry } from '../transforms/history-text.js'
import { projectHistoryEntriesIsolated } from '../transforms/history-text-isolation.js'
import { projectNarrativeNodes } from '../narrative/projection.js'
import { projectSessionHistory, summaryRetiredThrough } from './session-history.js'
import type { ResolvedNarrativeContext } from '../narrative/context-provider.js'
import { isExtensionResourceAvailable } from '../runtime/extension-resource-access.js'
import { readExtensionPromptInputs } from '../prompt/extension-prompt.js'
import type { ExtensionPromptAddition } from '@loom-studio/extension-sdk'

export async function composeAgentTurnPrompt(input: {
  observation?: ObservationBuild
  activationFacts?: ActivationFacts
  variables?: VariableRenderContext
  agentMessages: AgentTranscriptEntry[]
  workspaceMemory?: string
  promptResources: PromptResourceStore
  contextResourceIds: readonly string[]
  availableExtensionInstallations?: ReadonlyMap<string, string>
  narrative?: {
    timeline: NarrativeTimeline
    unified?: boolean
    nodes: NarrativeNode[]
    branchId: string
    context?: ResolvedNarrativeContext
  }
  preset: PromptResourceContent & { id: string }
  attachments?: ChatAttachment[]
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
  promptAddition?: ExtensionPromptAddition
  processing?: { registry: PromptProcessorRegistry; context: ExtensionPromptProcessingContext }
  resumeMessages?: ChatMessage[]
  resumeProcessingSnapshot?: ProcessedPromptSnapshot
}): Promise<{ messages: ChatMessage[]; projection: CompiledPrompt; promptBuildTrace: PromptBuildTrace; toolExecutionScope: ToolExecutionScope; processingSnapshot?: ProcessedPromptSnapshot }> {
  const variables = input.variables ?? createVariableRenderContext()
  const observation = input.observation ?? {}
  try {
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
    const presetMounts = [
      ...(input.preset.useGlobalLore === false ? [] : await input.promptResources.listLoreMounts({ source: { kind: 'manual', id: 'global' } })),
      ...await input.promptResources.listLoreMounts({ source: { kind: 'preset', id: input.preset.id } }),
    ]
    for (const mount of presetMounts) {
      if (mount.resolvedLoreResourceId !== null) continue
      diagnostics.push({
        severity: 'warning', code: 'prompt.lore_reference_unresolved',
        message: `Skipped unresolved Lore reference: ${mount.reference?.kind === 'external' ? mount.reference.resourceId : mount.reference?.contributionId}`,
      })
    }
    const contextLoreIds = (await Promise.all(input.contextResourceIds.map(async resourceId => {
      const resource = await input.promptResources.getResource(resourceId)
      if (!resource) warnMissingResource(resourceId)
      return resource
    }))).flatMap(resource => resource?.resourceKind === 'lore' ? [resource.id] : [])
    const resourceIds = [...new Set([
      input.preset.id,
      ...presetMounts.flatMap(mount => mount.resolvedLoreResourceId === null
        ? [] : [mount.resolvedLoreResourceId ?? mount.loreResourceId]),
      ...contextLoreIds,
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
    const runtimeInputs = await createRuntimePromptSources({
      observation: input.resumeMessages ? undefined : observation,
      agentMessages: input.agentMessages,
      workspaceMemory: input.workspaceMemory,
      narrative: input.narrative,
      userInput: input.userInput,
      attachments: input.attachments,
      historyRules: input.historyRules,
    })
    const additionalInputs = input.promptAddition
      ? await readExtensionPromptInputs({
          addition: input.promptAddition,
          promptResources: input.promptResources,
          installations: input.availableExtensionInstallations ?? new Map(),
          variables,
          sourceId: 'runtime.prompt-addition',
        })
      : undefined
    const ruleDescriptions = createTextRuleDescriptionInputs(input.historyRules ?? { session: [], narrative: [] })
    const sourceNodes = [
      ...(resourceInputs?.sourceNodes ?? []),
      ...runtimeInputs.sourceNodes,
      ...ruleDescriptions.sourceNodes,
      ...(input.externalRuntime?.sourceNodes ?? []),
      ...(additionalInputs?.sourceNodes ?? []),
    ]
    const contributions = [
      ...(resourceInputs?.contributions ?? []),
      ...runtimeInputs.contributions,
      ...ruleDescriptions.contributions,
      ...(input.externalRuntime?.contributions ?? []),
      ...(additionalInputs?.contributions ?? []),
    ]
    for (const description of ruleDescriptions.contributions) {
      const anchor = description.capabilities.targetAnchorId!
      if (!sourceNodes.some(node => (node.kind === 'virtual' || node.kind === 'slot') && (node.capabilities?.targetAnchorId ?? node.id) === anchor)) {
        diagnostics.push({ severity: 'warning', code: 'prompt.rule_description_anchor_missing',
          resourceId: description.sourceRef.sourceId, targetAnchorId: anchor,
          message: `Rule description anchor is unavailable: ${anchor}` })
      }
    }
    const model = {
      skeletonRootId: input.preset.rootNode.id,
      sourceNodes,
      contributions,
      currentInput: input.userInput,
      activationFacts: input.activationFacts,
    }
    const processed = input.processing && !input.resumeMessages
      ? await processPrompt(model, {
          ...input.processing,
          observation,
          renderText: (content, hostId) => renderVariableMacros(content, variables, { hostId, stage: 'render' }),
        }) : undefined
    if (processed) diagnostics.push(...processed.diagnostics)
    if (input.resumeMessages && !input.resumeProcessingSnapshot && contributions.some(entry => entry.capabilities.processorId)) {
      throw new Error('Cannot restore processed Prompt context without its build snapshot')
    }
    const processingSnapshot = input.resumeProcessingSnapshot ?? (processed && contributions.some(entry => entry.capabilities.processorId) ? {
      sourceNodes: processed.model.sourceNodes.map(({ evidence: _evidence, ...node }) => node),
      contributions: processed.model.contributions,
      projection: { messages: processed.projection.messages, editorProjection: processed.projection.editorProjection },
    } : undefined)
    const resourceProjection = input.resumeMessages
      ? { messages: input.resumeMessages.map(message => ({
          ...structuredClone(message), content: message.content ?? '', fragmentIds: [] as string[],
        })), editorProjection: { sourceRows: [], promptRows: [] } }
      : processed?.projection ?? compilePromptDataModel(model, observation)
    if (input.resumeMessages) diagnostics.push({
      severity: 'info', code: 'prompt.checkpoint_reused',
      message: 'Resumed Provider messages were reused; author processors were not executed.',
    })

    if (!input.resumeMessages && input.attachments?.length) {
      const message = resourceProjection.messages.find(message => message.fragmentIds.includes('runtime.current.input'))
      if (!message || message.role !== 'user') throw new Error('The preset must include the user input anchor to send attachments')
      message.attachments = structuredClone(input.attachments)
    }

    for (const diagnostic of diagnostics) appendBuildEvidence(observation, 'diagnostics', diagnostic)
    if (input.resumeMessages) appendBuildEvidence(observation, 'diagnostics', {
      code: 'observation.checkpoint_sources_unavailable', message: 'Checkpoint messages reused; source activation and placement were not executed for this build.',
    })
    const trace: PromptBuildTrace = {
      observation,
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
      executions: processed?.executions ?? [],
    }

    return {
      ...(processingSnapshot ? { processingSnapshot } : {}),
      messages: resourceProjection.messages,
      projection: resourceProjection,
      promptBuildTrace: {
        ...trace,
        variables: cloneVariableRenderTrace({
          reads: variables.trace.reads.map(({ requestedPath, resolvedPath, source }) => ({ requestedPath, resolvedPath, source })),
          diagnostics: variables.trace.diagnostics,
        }),
      },
      toolExecutionScope: {
        ...createPromptToolExecutionScope({
          prompt: processingSnapshot?.projection ?? resourceProjection,
          contributions: processingSnapshot?.contributions ?? processed?.model.contributions ?? contributions,
          sourceNodes: processingSnapshot?.sourceNodes ?? processed?.model.sourceNodes ?? sourceNodes,
          promptResources: input.promptResources,
          workspaceResourceAccess: !input.narrative,
          availableExtensionInstallations: input.availableExtensionInstallations,
        }),
        vfsResourceIds: [...readableResourceIds],
      },
    }
  } catch (error) {
    appendBuildEvidence(observation, 'diagnostics', { code: 'prompt.build_failed', message: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    recordMacroReads(observation, variables.trace)
  }
}

async function createRuntimePromptSources(input: {
  observation?: ObservationBuild
  agentMessages: AgentTranscriptEntry[]
  workspaceMemory?: string
  narrative?: {
    timeline: NarrativeTimeline
    unified?: boolean
    nodes: NarrativeNode[]
    branchId: string
    context?: ResolvedNarrativeContext
  }
  attachments?: ChatAttachment[]
  userInput: string
  historyRules?: {
    narrative: TextTransformRuleEntry[]
    session: TextTransformRuleEntry[]
  }
}): Promise<{ sourceNodes: SourceNode[]; contributions: PromptContribution[] }> {
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []
  const narrativeTextByEntry = new Map<string, string>()
  if (input.workspaceMemory !== undefined) {
    const id = 'runtime.workspace.memory'
    sourceNodes.push({ id, sourceId: input.narrative!.timeline.id, parentId: null,
      displayName: 'Shared Workspace Memory', orderIndex: 0, kind: 'virtual' })
    contributions.push({ id, sourceRef: { kind: 'runtime', sourceId: input.narrative!.timeline.id, sourceNodeId: id },
      content: input.workspaceMemory, capabilities: { targetAnchorId: '@memory.workspace', localDepth: 0 } })
  }
  const summary = [...input.agentMessages].reverse().find(entry => entry.entry.kind === 'work-summary')
  if (summary?.entry.kind === 'work-summary') {
    input = { ...input, agentMessages: input.agentMessages.filter(entry =>
      entry.entry.kind !== 'work-summary' && (entry.sequence > summaryRetiredThrough(summary)
        || (input.narrative?.unified && entry.entry.kind === 'message' && entry.entry.purpose === 'narrative'))) }
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
    const projectedNarrative = await projectNarrativeNodes({
      timelineId: input.narrative.timeline.id,
      branchId: input.narrative.branchId,
      nodes: input.narrative.nodes,
    }, {
      phase: 'prompt',
      rules: input.historyRules?.narrative ?? [],
    })
    recordHistoryProjection(input.observation, projectedNarrative)
    const narrativeEntries = new Map(projectedNarrative.entries.map(entry => [entry.id, entry]))
    if (input.narrative.unified) for (const node of input.narrative.nodes) {
      if (node.entryId) narrativeTextByEntry.set(node.entryId, narrativeEntries.get(node.id)!.text)
    }
    if (!input.narrative.unified && projectedNarrative.entries.length) {
      const id = `${rootId}:text`
      sourceNodes.push({ id, sourceId: input.narrative.timeline.id, parentId: rootId,
        displayName: 'Story text', orderIndex: 0, kind: 'entry' })
      contributions.push({
        id,
        sourceRef: { kind: 'narrativeHistory', sourceId: input.narrative.timeline.id, sourceNodeId: id },
        content: projectedNarrative.entries.map(entry => entry.text).filter(text => text.trim()).join('\n\n'),
        capabilities: { targetAnchorId: '@chat.narrative' },
      })
    }
  }

  const sessionRootId = 'runtime.session.history'
  sourceNodes.push({
    id: sessionRootId,
    sourceId: input.agentMessages[0]?.agentSessionId ?? 'agent-session',
    parentId: null,
    displayName: 'Session History',
    orderIndex: 0, kind: 'folder',
  })
  const projectedSession = await projectHistoryEntriesIsolated({
    source: { kind: 'agent-session', sessionId: input.agentMessages[0]?.agentSessionId ?? 'agent-session' },
    phase: 'prompt',
    entries: input.agentMessages.flatMap(agentMessage => agentMessage.entry.kind === 'message'
      && !(input.narrative?.unified && agentMessage.entry.purpose === 'narrative')
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
  recordHistoryProjection(input.observation, projectedSession)
  const sessionText = new Map(projectedSession.entries.map(entry => [entry.id, entry.text]))
  for (const [id, text] of narrativeTextByEntry) sessionText.set(id, text)
  projectSessionHistory(input.agentMessages, sessionText).forEach(({ entry: agentMessage, messages, toolEvidence }) => {
    const sourceNodeId = `runtime.session.${agentMessage.entry.kind}:${agentMessage.id}`
    for (const tool of toolEvidence ?? []) appendBuildEvidence(input.observation, 'transformations', { kind: 'session-tool', sourceNodeId, ...tool })
    sourceNodes.push({
      id: sourceNodeId,
      sourceId: agentMessage.agentSessionId,
      parentId: sessionRootId,
      evidence: { original: agentMessage.entry.kind === 'message' ? agentMessage.entry.content : undefined },
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
    content: attachmentMessage(input.userInput, input.attachments).content || (input.attachments?.length ? '[Attached image]' : ''),
    capabilities: {
      targetAnchorId: '@chat.input',
      localDepth: 0,
      roleHint: 'user',
    },
  })

  return { sourceNodes, contributions }
}

function recordHistoryProjection(observation: ObservationBuild | undefined, projection: import('../transforms/history-text.js').HistoryProjectionSnapshot): void {
  if (!observation) return
  for (const entry of projection.entries) appendBuildEvidence(observation, 'transformations', {
    kind: 'history-projection', source: projection.source, phase: projection.phase, entryId: entry.id,
    hostId: projection.source.kind === 'narrative' ? `runtime.timeline.node:${entry.id}` : `runtime.session.message:${entry.id}`,
    before: entry.originalText, after: entry.text, appliedRuleIds: entry.appliedRuleIds,
  })
  for (const match of projection.matches) appendBuildEvidence(observation, 'transformations', { kind: 'history-match', ...match })
  for (const diagnostic of projection.diagnostics) appendBuildEvidence(observation, 'diagnostics', diagnostic)
}
