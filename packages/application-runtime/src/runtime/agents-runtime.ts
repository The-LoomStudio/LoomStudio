import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { readLogFailure } from '@loom-studio/logging'
import type {
  PromptResourceNodeDraft,
  PromptResourceNodePatch,
  PromptResourceTreeNode,
  PromptResourceMutation,
} from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { createAgentToolRegistry, type ToolDefinition } from '../agents/tool-registry.js'
import { listPresetScriptAttachments } from '../vfs/script-attachments.js'
import {
  compileAgentToolSet,
  createContentToolPromptRuntimeInputs,
  runNativeToolLoop,
  type AgentRunProgress,
} from '../agents/tool-loop.js'
import { composeAgentTurnPrompt } from '../agents/agent-turn.js'
import { readSessionHistory } from '../agents/session-history.js'
import { assertNonEmpty, assertProviderModelExists } from '../agents/agent.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from '../providers/provider-payload.js'
import { fromStoredResource, readMappedResource, toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
import { isPromptActivation, type ActivationFacts } from '../prompt/prompt-activation.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import { projectNarrativeSample } from '../narrative/projection.js'
import { createNarrativeSampler } from '../narrative/sampling.js'
import { readNarrativeContext } from '../narrative/context-provider.js'
import { createNarrativeReader } from '../narrative/access.js'
import { readTimelinePresetConfig } from '../prompt/timeline-preset-config.js'
import { normalizeMacroSelections } from '@loom-studio/shared'
import { resolveEffectiveTextPipeline } from './transforms-runtime.js'
import { isExtensionResourceAvailable, readAvailableExtensionInstallations } from './extension-resource-access.js'
import { createEmptyPromptResourceContent, createPromptRuntimeMethods } from './prompt-runtime.js'
import { getApplicationStateSnapshot, applyApplicationStateMutation } from '../state/state.js'
import type {
  AgentPresetResult,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
  AgentToolContent,
  AgentToolEntry,
  AgentTranscriptPage,
  AppendAgentTranscriptEntriesInput,
  AppendAgentTranscriptEntriesResult,
  CardSourceContent,
  CreateAgentSessionInput,
  CreateAgentSessionResult,
  CompleteAgentSessionHandoffInput,
  CompleteAgentSessionHandoffResult,
  DeleteAgentSessionInput,
  DeleteAgentSessionResult,
  GetAgentSessionInput,
  GetAgentSessionResult,
  GetAgentTranscriptPageInput,
  InspectMacrosInput,
  InvokeAgentTurnInput,
  InvokeAgentTurnResult,
  ListAgentSessionsInput,
  ListAgentSessionsResult,
  ListAgentToolsResult,
  ListPresetToolMountsInput,
  ListPresetToolMountsResult,
  PreviewAgentTurnInput,
  PreviewAgentTurnResult,
  PromptResourceContent,
  ProviderMessage,
  ProviderProfileContent,
  ReplacePresetToolMountsInput,
  ReplacePresetToolMountsResult,
  RuntimeRequestContext,
  StateMutationOperation,
  UpdateAgentSessionInput,
  UpdateAgentSessionResult,
  UpdateAgentToolInput,
  UpdateAgentToolResult,
} from '../types.js'
import {
  narrativeWriteContext,
  promptResourceWriteContext,
  requireAgents,
  requireDocumentParticipant,
  tombstoneExtensionStorageScope,
} from './context.js'
import { readAgentTurnVariables } from './narrative-runtime.js'
import { inspectApplicationMacros, inspectPreparedMacros, variableContextFromInspection } from './macros-runtime.js'

type AgentsRuntimeContext = Pick<ApplicationRuntimeContext,
  | 'agentTools'
  | 'agents'
  | 'createId'
  | 'dataEngine'
  | 'documents'
  | 'gateway'
  | 'logger'
  | 'runtimeLogger'
  | 'macroProviders'
  | 'narratives'
  | 'narrativeContext'
  | 'now'
  | 'promptResources'
  | 'providerAdapters'
  | 'states'
>

export function createAgentsRuntimeMethods(ctx: AgentsRuntimeContext) {
  return {
    createAgentPreset: async (input: CreateAgentPresetInput, requestContext?: RuntimeRequestContext): Promise<AgentPresetResult> => {
      assertNonEmpty(input.name, 'name')
      if (input.model !== undefined) await assertProviderModelExists(ctx.documents, input.model)
      const content = createEmptyPromptResourceContent(ctx.createId, input.name, 'preset', ctx.now())
      content.model = input.model
      content.delivery = input.delivery ?? 'stream'
      content.historyPolicy = input.historyPolicy ?? 'persistent'
      const result = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.createAgentPreset',
      }, async dataTx => {
        const resources = ctx.promptResources.transaction(dataTx)
        const resource = resources.createResource(toStoredResourceInput({ content }))
        for (const [orderIndex, definition] of ctx.agentTools.list().entries()) {
          resources.addPresetToolMount({
            presetResourceId: resource.id,
            toolId: definition.id,
            orderIndex,
            defaultEnabled: false,
            ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
            ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
            ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
          })
        }
        return fromStoredResource(resource)
      })
      return { agentPreset: result.value, mutation: { changesetId: result.commit.changesetId } }
    },

    getAgentPreset: async (input: { agentPresetId: string }) => ({
      agentPreset: await readPresetResource(ctx.promptResources, input.agentPresetId),
    }),

    listAgentPresets: async (input?: { limit?: number; cursor?: string }) => {
      const page = await ctx.promptResources.listResources({ ...input, resourceKind: 'preset' })
      return { agentPresets: page.resources.map(fromStoredResource), nextCursor: page.nextCursor }
    },

    updateAgentPreset: async (input: UpdateAgentPresetInput, requestContext?: RuntimeRequestContext): Promise<AgentPresetResult> => {
      if (input.name !== undefined) assertNonEmpty(input.name, 'name')
      if (input.model !== undefined && input.model !== null) await assertProviderModelExists(ctx.documents, input.model)
      const current = await ctx.promptResources.getResource(input.agentPresetId)
      if (!current || current.resourceKind !== 'preset') throw new Error(`Agent Preset not found: ${input.agentPresetId}`)
      const metadata = { ...current.metadata }
      if (input.model === null) delete metadata.model
      else if (input.model !== undefined) metadata.model = input.model
      if (input.delivery !== undefined) metadata.delivery = input.delivery
      if (input.historyPolicy !== undefined) metadata.historyPolicy = input.historyPolicy
      const mutations: PromptResourceMutation[] = [{
        kind: 'resource.update',
        patch: { metadata, ...(input.name !== undefined ? { label: input.name.trim() } : {}) },
      }]
      if (input.name !== undefined) mutations.push({
        kind: 'node.update', nodeId: current.rootNode.id, patch: { label: input.name.trim() },
      })
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updateAgentPreset',
        resourceId: current.id,
        expectedVersion: input.expectedVersion,
        mutations,
      })
      return { agentPreset: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    deleteAgentPreset: async (input: { agentPresetId: string }, requestContext?: RuntimeRequestContext) => {
      await readPresetResource(ctx.promptResources, input.agentPresetId)
      return createPromptRuntimeMethods(ctx).deletePromptResource({ resourceId: input.agentPresetId }, requestContext)
    },

    createAgentSession: async (input: CreateAgentSessionInput, requestContext?: RuntimeRequestContext): Promise<CreateAgentSessionResult> => {
      await readPresetResource(ctx.promptResources, input.agentPresetId)
      const result = await requireAgents(ctx).createSession({
        ...narrativeWriteContext(requestContext, 'application.createAgentSession'),
        agentPresetId: input.agentPresetId,
        timelineId: input.timelineId,
        title: input.title,
      })
      return { session: result.session, mutation: { changesetId: result.commit.changesetId } }
    },

    listAgentSessions: async (input?: ListAgentSessionsInput): Promise<ListAgentSessionsResult> => {
      const page = await requireAgents(ctx).listSessions(input)
      return { sessions: page.sessions, nextCursor: page.nextCursor }
    },

    getAgentSession: async (input: GetAgentSessionInput): Promise<GetAgentSessionResult> => {
      const session = await requireAgents(ctx).getSession(input.agentSessionId)
      if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
      return { session }
    },

    getAgentTranscriptPage: (input: GetAgentTranscriptPageInput): Promise<AgentTranscriptPage> =>
      requireAgents(ctx).getEntryPage(input),

    appendAgentTranscriptEntries: async (input: AppendAgentTranscriptEntriesInput, requestContext?: RuntimeRequestContext): Promise<AppendAgentTranscriptEntriesResult> => {
      const result = await requireAgents(ctx).appendEntries({
        ...narrativeWriteContext(requestContext, 'application.appendAgentTranscriptEntries'),
        ...input,
      })
      return {
        session: result.session,
        entries: result.entries,
        mutation: { changesetId: result.commit.changesetId },
      }
    },

    completeAgentSessionHandoff: async (input: CompleteAgentSessionHandoffInput, requestContext?: RuntimeRequestContext): Promise<CompleteAgentSessionHandoffResult> => {
      const agents = requireAgents(ctx)
      const session = await agents.getSession(input.agentSessionId)
      if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
      if (input.branchId && !session.timelineId) throw new Error('A standalone Session has no Narrative branch')
      if (session.timelineId && !ctx.narratives) throw new Error('Narrative Store is not configured')
      const page = session.timelineId
        ? await ctx.narratives!.getPage({ timelineId: session.timelineId, branchId: input.branchId, limit: 1 })
        : undefined
      requestContext?.abortSignal?.throwIfAborted()
      const result = await agents.appendEntries({
        ...narrativeWriteContext(requestContext, 'application.completeAgentSessionHandoff'),
        agentSessionId: session.id,
        expectedEntryCount: input.expectedEntryCount,
        entries: [{ entry: { kind: 'work-summary', content: input.summary } }],
      })
      let memoryNotification: CompleteAgentSessionHandoffResult['memoryNotification'] = { status: 'not-configured' }
      if (page) {
        try {
          const status = await ctx.narrativeContext.notifySessionHandoff({
            timelineId: page.timeline.id, branchId: page.branch.id,
            cardId: page.timeline.createdFrom?.cardId,
            agentSessionId: session.id, summaryEntryId: result.entries[0]!.id,
            rawHeadNodeId: page.branch.headNodeId ?? null,
          })
          memoryNotification = { status }
        } catch (error) {
          // The summary is committed. Report the separate source failure without pretending rollback.
          memoryNotification = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
        }
      }
      return {
        session: result.session, entries: result.entries,
        mutation: { changesetId: result.commit.changesetId },
        memoryNotification,
      }
    },

    deleteAgentSession: async (input: DeleteAgentSessionInput, requestContext?: RuntimeRequestContext): Promise<DeleteAgentSessionResult> => {
      const agents = requireAgents(ctx)
      const documentParticipant = requireDocumentParticipant(ctx)
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.deleteAgentSession'),
        async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
          const session = agents.transaction(dataTx).deleteSession(input)
          await tombstoneExtensionStorageScope(documents, {
            kind: 'agent-session',
            agentSessionId: input.agentSessionId,
          })
          return session
        }, { allowEmpty: true }),
      )
      return { deleted: true as const, mutation: { changesetId: result.commit.changesetId } }
    },

    updateAgentSession: async (input: UpdateAgentSessionInput, requestContext?: RuntimeRequestContext): Promise<UpdateAgentSessionResult> => {
      const result = await requireAgents(ctx).updateSession({
        ...narrativeWriteContext(requestContext, 'application.updateAgentSession'),
        ...input,
      })
      return { session: result.session, mutation: { changesetId: result.commit.changesetId } }
    },

    previewAgentTurn: async (input: PreviewAgentTurnInput, requestContext?: RuntimeRequestContext): Promise<PreviewAgentTurnResult> => {
      const prepared = await prepareAgentTurn(ctx, input, 'preview', requestContext)
      return {
        runId: prepared.runId,
        messages: prepared.agentStepMessages,
        projection: prepared.prompt.projection,
        promptBuildTrace: prepared.prompt.promptBuildTrace,
        toolExposures: prepared.compiledToolSet.tools.map(
          (tool) => tool.exposure,
        ),
        toolPromptBuildTrace: prepared.compiledToolSet.trace,
        providerPayloadPreview: await buildProviderPayloadPreview({
          documents: ctx.documents,
          messages: prepared.agentStepMessages,
          model: prepared.model,
        }),
        macroInspection: prepared.macroInspection,
      }
    },

    invokeAgentTurn: async (input: InvokeAgentTurnInput, requestContext?: RuntimeRequestContext): Promise<InvokeAgentTurnResult> => {
      const runId = requestContext?.agentRun?.runId ?? ctx.createId('run')
      const startedAt = performance.now()
      const progress: AgentRunProgress = { stage: 'preparation', providerStep: 0, toolCount: 0, suspended: false }
      const logContext = {
        correlationId: requestContext?.correlationId,
        callId: requestContext?.callId,
        parentCallId: requestContext?.parentCallId,
      }
      const references = { runId, sessionId: input.agentSessionId }
      const runLogger = ctx.runtimeLogger?.child('run')
      runLogger?.info('Agent turn started', {
        event: 'run.started', ...logContext,
        data: { ...references, outcome: 'running', detail: 'Agent Session transcript' },
      })
      try {
        const agents = requireAgents(ctx)
        const prepared = await prepareAgentTurn(ctx, input, 'runtime', requestContext, runId)
        const {
          model,
          narrativePage,
          prompt,
          agentStepMessages,
          compiledToolSet,
          session,
          preset,
        } = prepared
        const classificationRules = (await resolveEffectiveTextPipeline(
          ctx,
          { kind: 'agent-session', sessionId: session.id },
          'classify',
        )).rules
        const loop = await runNativeToolLoop({
          ctx,
          agents,
          session,
          runId,
          progress,
          model,
          initialMessages: requestContext?.agentRun?.continuation?.messages ?? agentStepMessages,
          userInput: prepared.userInput,
          compiledToolSet,
          toolExecutionScope: prompt.toolExecutionScope,
          branchId: narrativePage?.branch.id ?? 'agent-only',
          purpose: input.narrativeTarget?.inputNodeId ? 'narrative' : 'agent',
          classificationRules,
          ...(requestContext ? { requestContext } : {}),
          delivery: preset.delivery ?? 'stream',
          ...(requestContext?.agentRun?.continuation?.userEntry
            ? { resumeUserEntry: requestContext.agentRun.continuation.userEntry }
            : {}),
          ...(requestContext?.agentRun?.continuation?.partialEntryId
            ? { resumeAssistantEntryId: requestContext.agentRun.continuation.partialEntryId }
            : {}),
        })
        const outcome = requestContext?.abortSignal?.aborted
          ? requestContext.abortSignal.reason === 'user-pause' ? 'suspended' : 'cancelled'
          : 'completed'
        runLogger?.info(`Agent turn ${outcome}`, {
          event: `run.${outcome}`, ...logContext,
          data: {
            ...references, outcome, durationMs: readDurationMs(startedAt),
            providerStep: progress.providerStep, toolCount: progress.toolCount,
            detail: `${progress.providerStep} steps · ${progress.toolCount} tools`,
          },
        })

        return {
          runId,
          agentSession: loop.session,
          entries: { user: loop.userEntry, assistant: loop.assistantEntry },
          provider: {
            provider: loop.providerResult.provider,
            model: loop.providerResult.model,
            ...(loop.providerResult.finishReason ? { finishReason: loop.providerResult.finishReason } : {}),
            ...(loop.providerResult.usage ? { usage: loop.providerResult.usage } : {}),
            ...(loop.providerResult.providerCallId ? { providerCallId: loop.providerResult.providerCallId } : {}),
          },
          projection: prompt.projection,
          promptBuildTrace: prompt.promptBuildTrace,
          toolExposures: compiledToolSet.tools.map((tool) => tool.exposure),
          toolPromptBuildTrace: loop.toolPromptBuildTrace,
          mutation: { changesetId: loop.changesetId, scope: 'agent-session-transcript' as const },
          macroInspection: prepared.macroInspection,
        }
      } catch (error) {
        const failure = readLogFailure(error)
        const aborted = requestContext?.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError')
        const outcome = progress.suspended || (aborted && requestContext?.abortSignal?.reason === 'user-pause')
          ? 'suspended' : aborted ? 'cancelled' : 'failed'
        runLogger?.[outcome === 'failed' ? 'error' : !aborted && outcome === 'suspended' ? 'warn' : 'info'](`Agent turn ${outcome} · ${progress.stage}`, {
          event: `run.${outcome}`, ...logContext,
          data: {
            ...references, ...failure, ...progress, outcome, durationMs: readDurationMs(startedAt),
            detail: `${failure.failureReason} · ${progress.providerStep} steps · ${progress.toolCount} tools`,
          },
        })
        throw error
      }
    },

    inspectMacros: (input: InspectMacrosInput) => inspectApplicationMacros(ctx, input),

    listAgentTools: async (): Promise<ListAgentToolsResult> => ({ tools: await listAgentToolEntries(ctx) }),

    updateAgentTool: async (input: UpdateAgentToolInput, requestContext?: RuntimeRequestContext): Promise<UpdateAgentToolResult> => {
      const existing = await readDocument<AgentToolContent>(
        ctx.documents,
        input.toolId,
        applicationDocumentTypes.agentTool,
      )
      if (input.expectedVersion !== existing.version)
        throw new Error(`Agent tool version conflict: ${input.toolId}`)
      if (input.definition.id !== input.toolId)
        throw new Error('Agent tool definition id cannot change')
      createAgentToolRegistry([input.definition])
      const updated = await writeDocument<AgentToolContent>(ctx.documents, {
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updateAgentTool',
        id: existing.id,
        type: applicationDocumentTypes.agentTool,
        content: {
          ...toAgentToolContent(input.definition, existing.content.createdAt, ctx.now(), existing.content.origin),
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      await refreshAgentToolRegistry(ctx)
      return {
        tool: toAgentToolEntry(updated),
      }
    },

    listPresetToolMounts: async (input?: ListPresetToolMountsInput): Promise<ListPresetToolMountsResult> => ({
      mounts: await ctx.promptResources.listPresetToolMounts({
        presetResourceId: input?.presetId,
        toolId: input?.toolId,
      }),
    }),

    replacePresetToolMounts: async (input: ReplacePresetToolMountsInput, requestContext?: RuntimeRequestContext): Promise<ReplacePresetToolMountsResult> => {
      await readPresetResource(ctx.promptResources, input.presetId)
      const seen = new Set<string>()
      for (const mount of input.mounts) {
        if (seen.has(mount.toolId)) throw new Error(`Preset Tool mount is duplicated: ${mount.toolId}`)
        seen.add(mount.toolId)
        const resolved = ctx.agentTools.resolve([mount.toolId])
        const definition = resolved.tools[0]
        if (!definition) throw new Error(resolved.diagnostics[0]?.message ?? `Agent tool is not registered: ${mount.toolId}`)
        if (mount.activation !== undefined && !isPromptActivation(mount.activation)) {
          throw new Error(`Preset Tool mount activation is invalid: ${mount.toolId}`)
        }
        if (definition.input.kind === 'structured' && mount.content !== undefined) {
          throw new Error(`Structured Tool cannot use Content placement: ${mount.toolId}`)
        }
      }
      const result = await ctx.promptResources.replacePresetToolMounts({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.replacePresetToolMounts',
        presetResourceId: input.presetId,
        mounts: input.mounts.map(mount => ({
          toolId: mount.toolId,
          orderIndex: mount.orderIndex,
          defaultEnabled: mount.defaultEnabled,
          ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
          ...(mount.provider ? { provider: { ...mount.provider } } : {}),
          ...(mount.content ? { content: { ...mount.content } } : {}),
        })),
      })
      return { mounts: result.mounts, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}

async function readPresetResource(
  promptResources: ApplicationRuntimeContext['promptResources'],
  presetId: string,
): Promise<PromptResourceContent & { id: string; version: number }> {
  const preset = await readMappedResource(promptResources, presetId)
  if (preset.resourceKind !== 'preset') throw new Error(`Prompt Resource is not a Preset: ${presetId}`)
  return preset
}

function assertResolvedTools(ctx: Pick<ApplicationRuntimeContext, 'agentTools'>, toolIds: string[]): void {
  const error = ctx.agentTools.resolve(toolIds).diagnostics.find(diagnostic => diagnostic.severity === 'error')
  if (error) throw new Error(error.message)
}

export function toAgentToolContent(
  definition: ToolDefinition,
  createdAt: string,
  updatedAt: string = createdAt,
  origin?: AgentToolContent['origin'],
): AgentToolContent {
  return {
    owner: structuredClone(definition.owner),
    name: definition.name,
    description: definition.description,
    input: structuredClone(definition.input),
    ...(definition.prompt ? { prompt: structuredClone(definition.prompt) } : {}),
    ...(origin ? { origin: structuredClone(origin) } : {}),
    createdAt,
    updatedAt,
  }
}

function toAgentToolEntry(document: DocumentRecord<AgentToolContent>): AgentToolEntry {
  return {
    id: document.id,
    owner: structuredClone(document.content.owner),
    name: document.content.name,
    description: document.content.description,
    input: structuredClone(document.content.input),
    ...(document.content.prompt
      ? { prompt: structuredClone(document.content.prompt) }
      : {}),
    ...(document.content.origin
      ? { origin: structuredClone(document.content.origin) }
      : {}),
    version: document.version,
    createdAt: document.content.createdAt,
    updatedAt: document.content.updatedAt,
  }
}

export async function listAgentToolEntries(
  ctx: Pick<ApplicationRuntimeContext, 'agentTools' | 'documents' | 'now'>,
): Promise<AgentToolEntry[]> {
  const documents = await listDocuments<AgentToolContent>(
    ctx.documents,
    applicationDocumentTypes.agentTool,
  )
  if (documents.length > 0) return documents.map(toAgentToolEntry)
  const timestamp = ctx.now()
  return ctx.agentTools.list().map((definition) => ({
    ...structuredClone(definition),
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
}

export async function refreshAgentToolRegistry(
  ctx: Pick<ApplicationRuntimeContext, 'agentTools' | 'documents'>,
): Promise<void> {
  const documents = await listDocuments<AgentToolContent>(
    ctx.documents,
    applicationDocumentTypes.agentTool,
  )
  if (documents.length === 0) return
  ctx.agentTools.replaceDefinitions(
    documents.map((document) => ({
      id: document.id,
      owner: structuredClone(document.content.owner),
      name: document.content.name,
      description: document.content.description,
      input: structuredClone(document.content.input),
      ...(document.content.prompt
        ? { prompt: structuredClone(document.content.prompt) }
        : {}),
    })),
  )
}

async function prepareAgentTurn(
  ctx: AgentsRuntimeContext,
  input: {
    agentSessionId: string
    input: string
    resume?: boolean
    activationFacts?: ActivationFacts
    narrativeTarget?: InvokeAgentTurnInput['narrativeTarget']
    macroSelections?: import('@loom-studio/shared').MacroSelectionMap
  },
  mode: 'preview' | 'runtime',
  requestContext?: RuntimeRequestContext,
  invocationRunId?: string,
) {
  if (!ctx.agents) throw new Error('Agent Store is not configured')
  const session = await ctx.agents.getSession(input.agentSessionId)
  if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
  // A bound session supplies its default Narrative target; explicit cross-timeline
  // targets are rejected here so PromptBuild and Tool execution cannot diverge.
  if (session.timelineId && input.narrativeTarget && session.timelineId !== input.narrativeTarget.timelineId) {
    throw new Error('Narrative target does not match the Agent Session timeline binding')
  }
  const narrativeTarget: { timelineId: string; branchId?: string } | undefined = input.narrativeTarget
    ?? (session.timelineId ? { timelineId: session.timelineId } : undefined)
  const narratives = narrativeTarget ? ctx.narratives : undefined
  if (narrativeTarget && !narratives) throw new Error('Narrative Store is not configured')
  const narrativePage = narrativeTarget
    ? await narratives!.getPage({
        timelineId: narrativeTarget.timelineId,
        branchId: narrativeTarget.branchId,
        limit: 1,
      })
    : undefined
  const inputNodeId = input.narrativeTarget?.inputNodeId
  const inputPage = inputNodeId !== undefined && narrativePage
    ? await narratives!.getPage({
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
        cursor: inputNodeId,
        limit: 1,
      })
    : undefined
  if (inputNodeId !== undefined && inputPage?.nodes[0]?.id !== inputNodeId) {
    throw new Error(`Narrative input node not found on branch: ${inputNodeId}`)
  }
  const userInput = inputPage ? inputPage.nodes[0]!.body.raw : input.input
  if (userInput.trim().length === 0 && !requestContext?.agentRun?.continuation) throw new Error('Agent turn input cannot be empty')
  const narrativeContext = narrativePage
    ? await ctx.narrativeContext.resolve({
      timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id,
      cardId: narrativePage.timeline.createdFrom?.cardId,
    })
    : undefined
  // ponytail: Unmigrated hosts still use recent-100 until the official memory provider is installed.
  const narrativeSample = !narrativeContext && narrativePage?.branch.headNodeId && narratives
    ? await createNarrativeSampler(narratives).sample({
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
        selection: { kind: 'tail', count: 100, throughNodeId: narrativePage.branch.headNodeId },
      })
    : undefined
  if (narrativeSample && !narrativeSample.complete) {
    throw new Error('Default Narrative window exceeds the sample budget; an explicit smaller range is required')
  }
  const narrativeNodes = narrativeContext && narrativePage && narratives
    ? await readNarrativeContext(narratives, { timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id }, narrativeContext)
    : narrativeSample?.nodes ?? []
  const agentPage = await readSessionHistory(ctx.agents, session.id)
  const preset = await readPresetResource(ctx.promptResources, session.agentPresetId)
  const availableInstallations = await readAvailableExtensionInstallations(ctx.documents, narrativePage?.timeline.createdFrom?.cardId)
  if (!isExtensionResourceAvailable(preset.origin, availableInstallations)) {
    throw new Error(`Agent Preset is not available in this context: ${preset.id}`)
  }
  if (!preset.model) throw new Error(`Agent Preset has no model binding: ${preset.id}`)
  const toolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: preset.id })
  const runId = invocationRunId ?? requestContext?.agentRun?.runId ?? ctx.createId('run')
  const buildId = ctx.createId('build')
  const startedAt = performance.now()
  const references = {
    buildId,
    mode,
    agentSessionId: session.id,
    runId,
    ...(narrativePage ? {
      timelineId: narrativePage.timeline.id,
      branchId: narrativePage.branch.id,
    } : {}),
  }
  const logContext = {
    ...(requestContext?.correlationId ? { correlationId: requestContext.correlationId } : {}),
    ...(requestContext?.callId ? { callId: requestContext.callId } : {}),
    ...(requestContext?.parentCallId ? { parentCallId: requestContext.parentCallId } : {}),
  }
  let prompt
  let compiledToolSet
  const timelineState = narrativePage
    ? await getApplicationStateSnapshot(ctx, {
        scope: 'timeline',
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
      })
    : undefined
  const timelineRuntimeContext = narrativePage
    ? await readTimelineRuntimeContext(ctx, narrativePage.timeline.id)
    : undefined
  const cardId = narrativePage?.timeline.createdFrom?.cardId
  const cardDocument = cardId ? await ctx.documents.get(cardId) : null
  if (cardDocument && cardDocument.type !== applicationDocumentTypes.cardSource) throw new Error(`Unexpected Card document type: ${cardId}`)
  const card = cardDocument?.content as CardSourceContent | undefined
  const variables = await readAgentTurnVariables(
    ctx,
    card ? card.userName : timelineRuntimeContext?.fallbackUserName,
    timelineState?.value,
    card?.name ?? timelineRuntimeContext?.cardName,
  )
  const macroSelections = input.macroSelections !== undefined
    ? normalizeMacroSelections(input.macroSelections)
    : narrativePage ? (await readTimelinePresetConfig(ctx.documents, narrativePage.timeline.id, preset.id)).macroSelections : undefined
  const macroInspection = await inspectPreparedMacros({
    ctx,
    variables,
    cardId,
    presetId: preset.id,
    timeline: timelineState?.value,
    cardMacros: card?.macros,
    presetMacros: preset.macros,
    cardMacroOptions: card?.macroOptions,
    presetMacroOptions: preset.macroOptions,
    macroSelections,
  })
  if (mode === 'runtime') {
    const unavailable = macroInspection.entries.find(entry =>
      macroSelections && Object.hasOwn(macroSelections, entry.name.toLowerCase()) && entry.status === 'error')
    if (unavailable) throw new Error(`Selected macro is unavailable: ${unavailable.name}`)
  }
  const inspectedVariables = variableContextFromInspection(macroInspection)
  ctx.logger?.info(`${mode} prompt build started`, {
    event: 'prompt.build.started',
    data: { ...references, outcome: 'running' },
    ...logContext,
  })
  try {
    const sessionTextPipeline = await resolveEffectiveTextPipeline(
      ctx,
      { kind: 'agent-session', sessionId: session.id },
      'prompt',
    )
    const narrativeTextPipeline = narrativePage
      ? await resolveEffectiveTextPipeline(
          ctx,
          { kind: 'narrative', timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id },
          'prompt',
          session.id,
        )
      : undefined
    compiledToolSet = await compileAgentToolSet({
      availableExtensionInstallations: availableInstallations,
      ctx,
      model: preset.model,
      toolMounts,
      variables: inspectedVariables,
      currentInput: userInput,
      activationFacts: input.activationFacts,
    })
    prompt = await composeAgentTurnPrompt({
      availableExtensionInstallations: availableInstallations,
      activationFacts: input.activationFacts,
      variables: inspectedVariables,
      agentMessages: (preset.historyPolicy ?? 'persistent') === 'persistent'
        ? agentPage.entries
        : [],
      promptResources: ctx.promptResources,
      contextResourceIds: card?.promptResourceIds ?? [],
      narrative: narrativePage ? {
        nodes: narrativeNodes,
        timeline: narrativePage.timeline,
        branchId: narrativePage.branch.id,
        context: narrativeContext,
      } : undefined,
      preset,
      userInput,
      buildId,
      runId,
      agentSessionId: session.id,
      historyRules: {
        session: sessionTextPipeline.rules,
        narrative: narrativeTextPipeline?.rules ?? [],
      },
      externalRuntime: createContentToolPromptRuntimeInputs(compiledToolSet),
    })
    prompt.promptBuildTrace.diagnostics.push(...(compiledToolSet.trace.diagnostics ?? []))
    if (narrativePage && !narrativeContext) {
      prompt.promptBuildTrace.diagnostics.push({
        severity: 'warning',
        code: 'narrative.context_unconfigured',
        message: 'No memory context source is configured. The legacy latest-100 view is not a frozen Narrative baseline.',
      })
    }
    if (compiledToolSet.tools.some(tool => tool.definition.id === 'official/codeact' || tool.definition.id === 'official/codeact_json')
      && !prompt.projection.messages.some(message => message.fragmentIds.includes('runtime.codeact.instructions'))) {
      prompt.promptBuildTrace.diagnostics.push({
        severity: 'warning',
        code: 'codeact.instructions_unmounted',
        message: 'CodeAct is enabled, but its tutorial anchor is absent or disabled. Mount the instructions in the selected preset.',
      })
    }
    prompt.toolExecutionScope.vfsAttachments = () => listPresetScriptAttachments(ctx, preset.id)
    if (requestContext?.agentRun?.onMutationApproval)
      prompt.toolExecutionScope.approveMutation = requestContext.agentRun.onMutationApproval
    if (requestContext?.agentRun?.onHistoryReadApproval)
      prompt.toolExecutionScope.requestHistoryApproval = requestContext.agentRun.onHistoryReadApproval
    const allowedTimelineTarget = narrativePage
      ? { scope: 'timeline' as const, timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id }
      : undefined
    prompt.toolExecutionScope.state = {
      defaultTarget: allowedTimelineTarget ?? { scope: 'global' as const },
      canAccess: target => target.scope === 'global'
        || (allowedTimelineTarget !== undefined
          && target.timelineId === allowedTimelineTarget.timelineId
          && target.branchId === allowedTimelineTarget.branchId),
      read: async target => {
        const snapshot = await getApplicationStateSnapshot(ctx, target)
        return { revisionId: snapshot.revisionId, value: snapshot.value }
      },
      update: async stateInput => {
        const result = await applyApplicationStateMutation(ctx, {
          target: stateInput.target,
          expectedRevisionId: stateInput.expectedRevisionId,
          operations: stateInput.operations as unknown as StateMutationOperation[],
          idempotencyKey: stateInput.idempotencyKey,
        }, requestContext)
        return { revisionId: result.snapshot.revisionId }
      },
      write: async stateInput => {
        if (!stateInput.pointer)
          throw Object.assign(new Error('Write a State property under /state/data, not the complete State snapshot.'), { code: 'vfs.write_unsupported' })
        const result = await applyApplicationStateMutation(ctx, {
          target: stateInput.target,
          expectedRevisionId: stateInput.expectedRevisionId,
          operations: [{ op: 'set', path: stateInput.pointer, value: stateInput.value }],
          idempotencyKey: stateInput.idempotencyKey,
        }, requestContext)
        return {
          revisionId: result.snapshot.revisionId,
          changesetId: result.mutation.changesetId,
        }
      },
    }
    prompt.toolExecutionScope.mutatePromptResource = async resourceInput => {
      const resource = await ctx.promptResources.getResource(resourceInput.resourceId)
      if (!resource) throw new Error(`Prompt Resource not found: ${resourceInput.resourceId}`)
      if (!isExtensionResourceAvailable(resource.metadata.origin, availableInstallations)) {
        throw new Error(`Prompt Resource is not available in this context: ${resourceInput.resourceId}`)
      }
      const result = await ctx.promptResources.mutateResource({
        ...resourceInput,
        ...promptResourceWriteContext(requestContext),
        reason: 'application.tool.updatePromptResource',
      })
      return {
        id: result.resource.id,
        version: result.resource.version,
        changesetId: result.commit.changesetId,
      }
    }
    prompt.toolExecutionScope.writePromptResource = async input => {
      const resource = await ctx.promptResources.getResource(input.resourceId)
      if (!resource)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (resource.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before writing.'), { code: 'vfs.baseline_changed' })
      const result = await ctx.promptResources.mutateResource({
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'node.update',
          nodeId: input.nodeId,
          patch: { body: input.body },
        }],
        ...promptResourceWriteContext(requestContext),
        reason: 'application.codeact.write',
      })
      return { version: result.resource.version, changesetId: result.commit.changesetId }
    }
    prompt.toolExecutionScope.configurePromptResource = async input => {
      const resource = await ctx.promptResources.getResource(input.resourceId)
      if (!resource)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (resource.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before writing Metadata.'), { code: 'vfs.baseline_changed' })
      const result = await ctx.promptResources.mutateResource({
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'node.update',
          nodeId: input.nodeId,
          patch: input.patch as PromptResourceNodePatch,
        }],
        ...promptResourceWriteContext(requestContext),
        reason: 'application.codeact.configure',
      })
      return { version: result.resource.version, changesetId: result.commit.changesetId }
    }
    prompt.toolExecutionScope.movePromptResource = async input => {
      const resource = await ctx.promptResources.getResource(input.resourceId)
      if (!resource)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (resource.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before moving the node.'), { code: 'vfs.baseline_changed' })
      const result = await ctx.promptResources.mutateResource({
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'node.move',
          nodeId: input.nodeId,
          parentId: input.parentNodeId,
          orderIndex: input.orderIndex,
        }],
        ...promptResourceWriteContext(requestContext),
        reason: 'application.codeact.move',
      })
      return { version: result.resource.version, changesetId: result.commit.changesetId }
    }
    prompt.toolExecutionScope.deletePromptResourceNode = async input => {
      const resource = await ctx.promptResources.getResource(input.resourceId)
      if (!resource)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (resource.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before deleting the node.'), { code: 'vfs.baseline_changed' })
      const result = await ctx.promptResources.mutateResource({
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'node.delete',
          nodeId: input.nodeId,
        }],
        ...promptResourceWriteContext(requestContext),
        reason: 'application.codeact.delete',
      })
      return { version: result.resource.version, changesetId: result.commit.changesetId }
    }
    prompt.toolExecutionScope.createPromptResourceNode = async input => {
      const resource = await ctx.promptResources.getResource(input.resourceId)
      if (!resource)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (resource.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before creating a node.'), { code: 'vfs.baseline_changed' })
      const nodeId = ctx.createId('prompt-node')
      const result = await ctx.promptResources.mutateResource({
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations: [{
          kind: 'node.create',
          parentId: input.parentNodeId,
          node: { ...input.node, id: nodeId },
        }],
        ...promptResourceWriteContext(requestContext),
        reason: 'application.codeact.create',
      })
      return { nodeId, version: result.resource.version, changesetId: result.commit.changesetId }
    }
    prompt.toolExecutionScope.copyPromptResourceNode = async input => {
      const resource = await ctx.promptResources.getResource(input.resourceId)
      if (!resource)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (resource.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before copying the node.'), { code: 'vfs.baseline_changed' })
      if (resource.rootNodeId === input.sourceNodeId)
        throw Object.assign(new Error('Prompt Resource root must be copied as a resource, not as a node.'), { code: 'vfs.root_copy' })
      const source = findPromptResourceTreeNode(resource.rootNode, input.sourceNodeId)
      if (!source)
        throw Object.assign(new Error(`Prompt Resource node not found: ${input.sourceNodeId}`), { code: 'vfs.not_found' })
      const mutations: Array<{
        kind: 'node.create'
        parentId: string
        node: PromptResourceNodeDraft
      }> = []
      let nodeCount = 0
      const append = (node: PromptResourceTreeNode, parentId: string, orderIndex?: number, isRoot = false): string => {
        const id = ctx.createId('prompt-node')
        nodeCount += 1
        mutations.push({
          kind: 'node.create',
          parentId,
          node: {
            id,
            label: isRoot && input.name !== undefined ? input.name : node.label,
            kind: node.kind,
            ...(orderIndex === undefined ? {} : { orderIndex }),
            ...(node.category === undefined ? {} : { category: node.category }),
            ...(node.meta === undefined ? {} : { meta: node.meta }),
            ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
            ...(node.body === undefined ? {} : { body: node.body }),
            ...(node.capabilities === undefined ? {} : { capabilities: node.capabilities }),
            ...(node.extra === undefined ? {} : { extra: node.extra }),
          },
        })
        node.children?.forEach((child, index) => append(child, id, index))
        return id
      }
      const nodeId = append(source, input.parentNodeId, undefined, true)
      const result = await ctx.promptResources.mutateResource({
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        mutations,
        ...promptResourceWriteContext(requestContext),
        reason: 'application.codeact.copy',
      })
      return { nodeId, nodeCount, version: result.resource.version, changesetId: result.commit.changesetId }
    }
    prompt.toolExecutionScope.duplicatePromptResource = async input => {
      const source = await ctx.promptResources.getResource(input.resourceId)
      if (!source)
        throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
      if (source.version !== input.expectedVersion)
        throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before copying the resource.'), { code: 'vfs.baseline_changed' })
      const duplicate = await createPromptRuntimeMethods(ctx).duplicatePromptResource({
        resourceId: input.resourceId,
        ...(input.name === undefined ? {} : { name: input.name }),
      }, requestContext)
      return {
        resourceId: duplicate.resource.id,
        label: duplicate.resource.rootNode.label,
        version: duplicate.resource.version,
        changesetId: duplicate.mutation.changesetId,
      }
    }
    if (narrativePage && narratives) {
      const narrativeReader = createNarrativeReader({
        store: narratives, context: ctx.narrativeContext,
        timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id,
      })
      prompt.toolExecutionScope.narrative = {
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
        sample: async (input, signal, approveHistory) => {
          const sample = await narrativeReader.sample(input, signal, approveHistory)
          if (input.view !== 'prompt') return sample
          return projectNarrativeSample(sample, {
            phase: 'prompt', rules: narrativeTextPipeline!.rules,
            maxNodes: input.maxNodes, maxCharacters: input.maxCharacters,
          })
        },
        appendNode: async ({ content }) => {
          const currentBranch = await narratives.getBranch(narrativePage.branch.id)
          if (!currentBranch) throw new Error(`Narrative branch not found: ${narrativePage.branch.id}`)
          const result = await narratives.appendNode({
            ...narrativeWriteContext(requestContext, 'application.tool.appendNarrative'),
            timelineId: narrativePage.timeline.id,
            branchId: narrativePage.branch.id,
            expectedHeadNodeId: currentBranch.headNodeId ?? null,
            stateRevisionId: currentBranch.stateHeadRevisionId,
            body: { format: 'loom-markdown.v1', raw: content },
            source: {
              agentSessionId: session.id,
              runId,
            },
          })
          return { nodeId: result.node.id }
        },
        editNode: async ({ nodeId, content }) => {
          const branch = await narratives.getBranch(narrativePage.branch.id)
          const target = await narratives.getNode(nodeId)
          if (!branch?.headNodeId || !target || target.timelineId !== narrativePage.timeline.id) {
            throw new Error(`Narrative node ${nodeId} is not editable from branch ${narrativePage.branch.id}`)
          }
          const expectedHeadNodeId = branch.headNodeId
          const result = await ctx.dataEngine.transact(
            narrativeWriteContext(requestContext, 'application.tool.editNarrative'),
            async dataTx => {
              const edited = narratives.transaction(dataTx).editBranchNode({
                timelineId: narrativePage.timeline.id,
                branchId: narrativePage.branch.id,
                nodeId,
                expectedHeadNodeId,
                expectedBody: target.body,
                body: { format: 'loom-markdown.v1', raw: content },
              })
              return { nodeId: edited.replacements[0]!.node.id }
            },
          )
          return result.value
        },
      }
    }
    const durationMs = readDurationMs(startedAt)
    ctx.logger?.info(`${mode} prompt build completed · ${prompt.messages.length} messages`, {
      event: 'prompt.build.completed',
      data: { ...references, messageCount: prompt.messages.length, durationMs, outcome: 'completed' },
      ...logContext,
    })
  } catch (error) {
    const durationMs = readDurationMs(startedAt)
    const failure = readLogFailure(error)
    ctx.logger?.error(`${mode} prompt build failed · ${failure.failureReason}`, {
      event: 'prompt.build.failed',
      data: {
        ...references,
        durationMs,
        ...failure,
        outcome: 'failed',
      },
      ...logContext,
    })
    throw error
  }
  return {
    userInput,
    preset,
    model: preset.model,
    narrativePage,
    narratives,
    prompt,
    variables: inspectedVariables,
    macroInspection,
    compiledToolSet,
    agentStepMessages: prompt.messages,
    agentPage,
    runId,
    session,
  }
}

async function buildProviderPayloadPreview(input: {
  documents: DocumentStore
  messages: ProviderMessage[]
  model?: { providerProfileId: string; modelId: string }
}): Promise<OpenAIChatPayload | undefined> {
  if (!input.model) return undefined
  const providerProfile = await readDocument<ProviderProfileContent>(input.documents, input.model.providerProfileId, applicationDocumentTypes.providerProfile)
  const providerExtensionId = providerProfile.content.providerExtensionId
  if (providerExtensionId !== 'official.openai-compatible' && providerExtensionId !== 'openai-compatible') return undefined
  return buildOpenAIChatPayload({
    messages: input.messages,
    modelId: input.model.modelId,
  })
}


function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

function findPromptResourceTreeNode(
  root: PromptResourceTreeNode,
  nodeId: string,
): PromptResourceTreeNode | undefined {
  if (root.id === nodeId) return root
  for (const child of root.children ?? []) {
    const found = findPromptResourceTreeNode(child, nodeId)
    if (found) return found
  }
  return undefined
}
