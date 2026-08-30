import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type { AgentTranscriptEntry } from '@loom-studio/agent-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { createAgentToolRegistry, type ToolDefinition } from '../agents/tool-registry.js'
import {
  compileAgentToolSet,
  createContentToolPromptRuntimeInputs,
  runNativeToolLoop,
} from '../agents/tool-loop.js'
import { composeAgentTurnPrompt } from '../agents/agent-turn.js'
import { assertNonEmpty, assertProviderModelExists } from '../agents/agent.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from '../providers/provider-payload.js'
import { readMappedResource } from '../prompt/prompt-resource-mapper.js'
import { isPromptActivation, type ActivationFacts } from '../prompt/prompt-activation.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import { getApplicationStateSnapshot, applyApplicationStateMutation } from '../state/state.js'
import type {
  AgentProfileContent,
  AgentProfileEntry,
  AgentToolContent,
  AgentToolEntry,
  AgentTranscriptPage,
  AppendAgentTranscriptEntriesInput,
  AppendAgentTranscriptEntriesResult,
  CreateAgentProfileInput,
  CreateAgentProfileResult,
  CreateAgentSessionInput,
  CreateAgentSessionResult,
  DeleteAgentProfileInput,
  DeleteAgentProfileResult,
  DeleteAgentSessionInput,
  DeleteAgentSessionResult,
  GetAgentProfileInput,
  GetAgentProfileResult,
  GetAgentSessionInput,
  GetAgentSessionResult,
  GetAgentTranscriptPageInput,
  HistorySource,
  InvokeAgentTurnInput,
  InvokeAgentTurnResult,
  ListAgentProfilesInput,
  ListAgentProfilesResult,
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
  TextTransformRuleContent,
  TextTransformRuleEntry,
  UpdateAgentProfileInput,
  UpdateAgentProfileResult,
  UpdateAgentToolInput,
  UpdateAgentToolResult,
} from '../types.js'
import {
  agentWriteContext,
  narrativeWriteContext,
  promptResourceWriteContext,
  requireAgents,
  requireDocumentParticipant,
  tombstoneExtensionStorageScope,
} from './context.js'
import { readAgentTurnVariables, readLegacyCardUserName } from './narrative-runtime.js'

export function createAgentsRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    createAgentProfile: async (input: CreateAgentProfileInput): Promise<CreateAgentProfileResult> => {
      assertNonEmpty(input.name, 'name')
      await readPresetResource(ctx.promptResources, input.presetId)
      await assertProviderModelExists(ctx.documents, input.model)
      const toolOverrides = normalizeToolOverrides(input.toolOverrides)
      assertResolvedTools(ctx, Object.keys(toolOverrides))

      const timestamp = ctx.now()
      const agentProfile = await writeDocument<AgentProfileContent>(ctx.documents, {
        id: ctx.createId('agent-profile'),
        type: applicationDocumentTypes.agentProfile,
        content: {
          name: input.name,
          presetId: input.presetId,
          model: input.model,
          toolOverrides,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { agentProfile: toAgentProfileEntry(agentProfile) }
    },

    getAgentProfile: async (input: GetAgentProfileInput): Promise<GetAgentProfileResult> => {
      const agentProfile = await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      return { agentProfile: toAgentProfileEntry(agentProfile) }
    },

    listAgentProfiles: async (input?: ListAgentProfilesInput): Promise<ListAgentProfilesResult> => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.agentProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        agentProfiles: result.items.map(agentProfile => toAgentProfileEntry(agentProfile as DocumentRecord<AgentProfileContent>)),
        nextCursor: result.nextCursor,
      }
    },

    updateAgentProfile: async (input: UpdateAgentProfileInput): Promise<UpdateAgentProfileResult> => {
      const existing = await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      if (input.name !== undefined) assertNonEmpty(input.name, 'name')
      if (input.presetId !== undefined) {
        await readPresetResource(ctx.promptResources, input.presetId)
      }
      if (input.model !== undefined) await assertProviderModelExists(ctx.documents, input.model)
      const toolOverrides = input.toolOverrides === undefined
        ? existing.content.toolOverrides ?? {}
        : normalizeToolOverrides(input.toolOverrides)
      assertResolvedTools(ctx, Object.keys(toolOverrides))
      const timestamp = ctx.now()
      const updated = await writeDocument<AgentProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentProfile,
        content: {
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          toolOverrides,
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { agentProfile: toAgentProfileEntry(updated) }
    },

    deleteAgentProfile: async (input: DeleteAgentProfileInput): Promise<DeleteAgentProfileResult> => {
      await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      if (await requireAgents(ctx).hasSessionForProfile(input.agentProfileId)) {
        throw new Error(`Agent Profile is still referenced by an Agent Session: ${input.agentProfileId}`)
      }
      await ctx.documents.delete({ id: input.agentProfileId })
      return { deleted: true as const }
    },

    createAgentSession: async (input: CreateAgentSessionInput, requestContext?: RuntimeRequestContext): Promise<CreateAgentSessionResult> => {
      await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      const result = await requireAgents(ctx).createSession({
        ...agentWriteContext(requestContext, 'application.createAgentSession'),
        agentProfileId: input.agentProfileId,
        title: input.title,
      })
      return { session: result.session, mutation: { changesetId: result.commit.changesetId } }
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
        ...agentWriteContext(requestContext, 'application.appendAgentTranscriptEntries'),
        ...input,
      })
      return {
        session: result.session,
        entries: result.entries,
        mutation: { changesetId: result.commit.changesetId },
      }
    },

    deleteAgentSession: async (input: DeleteAgentSessionInput, requestContext?: RuntimeRequestContext): Promise<DeleteAgentSessionResult> => {
      const agents = requireAgents(ctx)
      const documentParticipant = requireDocumentParticipant(ctx)
      const result = await ctx.dataEngine.transact(
        agentWriteContext(requestContext, 'application.deleteAgentSession'),
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
      }
    },

    invokeAgentTurn: async (input: InvokeAgentTurnInput, requestContext?: RuntimeRequestContext): Promise<InvokeAgentTurnResult> => {
      const agents = requireAgents(ctx)
      const prepared = await prepareAgentTurn(ctx, input, 'runtime', requestContext)
      const {
        model,
        narrativePage,
        narratives,
        prompt,
        agentStepMessages,
        compiledToolSet,
        runId,
        session,
      } = prepared
      const classificationRules = await filterRulesForSource(
        ctx,
        { kind: 'agent-session', sessionId: session.id },
        (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)).map(document => toVersioned(document)),
      )
      const loop = await runNativeToolLoop({
        ctx,
        agents,
        session,
        runId,
        model,
        initialMessages: agentStepMessages,
        userInput: input.input,
        compiledToolSet,
        toolExecutionScope: prompt.toolExecutionScope,
        branchId: narrativePage?.branch.id ?? 'agent-only',
        purpose: input.narrativeTarget?.commit ? 'narrative' : 'agent',
        classificationRules,
        ...(requestContext ? { requestContext } : {}),
      })
      const narrative = narrativePage && input.narrativeTarget?.commit
        ? await ctx.dataEngine.transact(
            narrativeWriteContext(requestContext, 'application.invokeAgentTurn.narrative'),
            async dataTx => {
              const narrativeTx = narratives!.transaction(dataTx)
              const user = narrativeTx.appendNode({
                timelineId: narrativePage.timeline.id,
                branchId: narrativePage.branch.id,
                expectedHeadNodeId: narrativePage.branch.headNodeId ?? null,
                stateRevisionId: narrativePage.branch.stateHeadRevisionId,
                body: { format: 'loom-markdown.v1', raw: readMessageEntryContent(loop.userEntry, 'user') },
                source: {
                  agentSessionId: session.id,
                  agentMessageId: loop.userEntry.id,
                  runId,
                },
              })
              const assistant = narrativeTx.appendNode({
                timelineId: narrativePage.timeline.id,
                branchId: narrativePage.branch.id,
                expectedHeadNodeId: user.node.id,
                stateRevisionId: narrativePage.branch.stateHeadRevisionId,
                body: { format: 'loom-markdown.v1', raw: readMessageEntryContent(loop.assistantEntry, 'assistant') },
                source: {
                  agentSessionId: session.id,
                  agentMessageId: loop.assistantEntry.id,
                  runId,
                },
              })
              return {
                timeline: assistant.timeline,
                branch: assistant.branch,
                node: assistant.node,
                nodes: [user.node, assistant.node],
              }
            },
          )
        : undefined

      return {
        runId,
        agentSession: loop.session,
        entries: { user: loop.userEntry, assistant: loop.assistantEntry },
        ...(narrative ? { narrative: narrative.value } : {}),
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
        mutation: { changesetId: narrative?.commit.changesetId ?? loop.changesetId },
      }
    },

    listAgentTools: async (): Promise<ListAgentToolsResult> => ({ tools: await listAgentToolEntries(ctx) }),

    updateAgentTool: async (input: UpdateAgentToolInput): Promise<UpdateAgentToolResult> => {
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

export async function readPresetResource(
  promptResources: ApplicationRuntimeContext['promptResources'],
  presetId: string,
): Promise<PromptResourceContent & { id: string; version: number }> {
  const preset = await readMappedResource(promptResources, presetId)
  if (preset.resourceKind !== 'preset') throw new Error(`Prompt Resource is not a Preset: ${presetId}`)
  return preset
}

export function normalizeToolOverrides(overrides: Record<string, boolean> | undefined): Record<string, boolean> {
  const normalized: Record<string, boolean> = {}
  for (const [toolId, enabled] of Object.entries(overrides ?? {})) {
    const normalizedToolId = toolId.trim()
    if (!normalizedToolId) throw new Error('Agent Profile Tool override id cannot be empty')
    if (typeof enabled !== 'boolean') throw new Error(`Agent Profile Tool override must be boolean: ${normalizedToolId}`)
    normalized[normalizedToolId] = enabled
  }
  if (Object.keys(normalized).length > 200) throw new Error('Agent Profile toolOverrides exceeds 200 entries')
  return normalized
}

export function assertResolvedTools(ctx: ApplicationRuntimeContext, toolIds: string[]): void {
  const error = ctx.agentTools.resolve(toolIds).diagnostics.find(diagnostic => diagnostic.severity === 'error')
  if (error) throw new Error(error.message)
}

export function toAgentProfileEntry(document: DocumentRecord<AgentProfileContent>): AgentProfileEntry {
  return {
    ...toVersioned(document),
    toolOverrides: { ...(document.content.toolOverrides ?? {}) },
  }
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

export function toAgentToolEntry(document: DocumentRecord<AgentToolContent>): AgentToolEntry {
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
  ctx: ApplicationRuntimeContext,
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
  ctx: ApplicationRuntimeContext,
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

export async function prepareAgentTurn(
  ctx: ApplicationRuntimeContext,
  input: {
    agentSessionId: string
    input: string
    activationFacts?: ActivationFacts
    narrativeTarget?: { timelineId: string; branchId?: string; commit: boolean }
  },
  mode: 'preview' | 'runtime',
  requestContext?: RuntimeRequestContext,
) {
  if (input.input.trim().length === 0) throw new Error('Agent turn input cannot be empty')
  if (!ctx.agents) throw new Error('Agent Store is not configured')
  const session = await ctx.agents.getSession(input.agentSessionId)
  if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
  const narratives = input.narrativeTarget ? ctx.narratives : undefined
  if (input.narrativeTarget && !narratives) throw new Error('Narrative Store is not configured')
  const narrativePage = input.narrativeTarget
    ? await narratives!.getPage({
        timelineId: input.narrativeTarget.timelineId,
        branchId: input.narrativeTarget.branchId,
        limit: 100,
      })
    : undefined
  const agentPage = await ctx.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
  const agentProfile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
  const preset = await readPresetResource(ctx.promptResources, agentProfile.content.presetId)
  const toolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: preset.id })
  const runId = ctx.createId('run')
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
  ctx.logger?.info(`${mode} prompt build started`, {
    event: 'prompt.build.started',
    data: references,
    ...logContext,
  })
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
  const variables = await readAgentTurnVariables(
    ctx,
    timelineRuntimeContext?.fallbackUserName
      ?? await readLegacyCardUserName(ctx, narrativePage?.timeline.createdFrom?.cardId),
    timelineState?.value,
  )
  try {
    const textRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)).map(document => toVersioned(document))
    const globalAndExtensionRules = textRules.filter(rule => rule.owner.kind === 'workspace' || rule.owner.kind === 'extension' || rule.owner.kind === 'user-override')
    const presetRules = textRules.filter(rule => rule.owner.kind === 'preset' && rule.owner.presetId === preset.id)
    const cardRules = timelineRuntimeContext?.textTransformRules ?? (narrativePage?.timeline.createdFrom?.cardId
      ? textRules.filter(rule => rule.owner.kind === 'card' && rule.owner.cardId === narrativePage.timeline.createdFrom!.cardId)
      : [])
    compiledToolSet = await compileAgentToolSet({
      ctx,
      model: agentProfile.content.model,
      toolMounts,
      toolOverrides: agentProfile.content.toolOverrides ?? {},
      variables,
      currentInput: input.input,
      activationFacts: input.activationFacts,
    })
    prompt = await composeAgentTurnPrompt({
      activationFacts: input.activationFacts,
      variables,
      agentMessages: (preset.historyPolicy ?? 'persistent') === 'persistent'
        ? agentPage.entries
        : [],
      promptResources: ctx.promptResources,
      narrative: narrativePage ? { nodes: narrativePage.nodes, timeline: narrativePage.timeline, branchId: narrativePage.branch.id } : undefined,
      preset,
      userInput: input.input,
      buildId,
      runId,
      agentSessionId: session.id,
      historyRules: {
        session: [...globalAndExtensionRules, ...presetRules],
        narrative: [...globalAndExtensionRules, ...presetRules, ...cardRules],
      },
      externalRuntime: createContentToolPromptRuntimeInputs(compiledToolSet),
    })
    const allowedTimelineTarget = narrativePage
      ? { scope: 'timeline' as const, timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id }
      : undefined
    prompt.toolExecutionScope.state = {
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
    }
    const durationMs = readDurationMs(startedAt)
    ctx.logger?.info(`${mode} prompt build completed · ${prompt.messages.length} messages · ${durationMs} ms`, {
      event: 'prompt.build.completed',
      data: { ...references, messageCount: prompt.messages.length, durationMs },
      ...logContext,
    })
  } catch (error) {
    const durationMs = readDurationMs(startedAt)
    ctx.logger?.error(`${mode} prompt build failed after ${durationMs} ms`, {
      event: 'prompt.build.failed',
      data: {
        ...references,
        durationMs,
        failureType: error instanceof Error ? error.name : 'UnknownError',
      },
      ...logContext,
    })
    throw error
  }
  return {
    agentProfile,
    model: agentProfile.content.model,
    narrativePage,
    narratives,
    prompt,
    variables,
    compiledToolSet,
    agentStepMessages: prompt.messages,
    runId,
    session,
  }
}

export async function buildProviderPayloadPreview(input: {
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

function readMessageEntryContent(entry: AgentTranscriptEntry, role: 'user' | 'assistant'): string {
  if (entry.entry.kind !== 'message' || entry.entry.role !== role) {
    throw new Error(`Expected ${role} message entry: ${entry.id}`)
  }
  return entry.entry.content
}

function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

async function filterRulesForSource(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  rules: TextTransformRuleEntry[],
): Promise<TextTransformRuleEntry[]> {
  let presetId: string | undefined
  let cardId: string | undefined
  let snapshotRules: TextTransformRuleEntry[] = []
  let hasTimelineRuntimeContext = false
  if (source.kind === 'agent-session') {
    const session = await ctx.agents?.getSession(source.sessionId)
    if (!session) throw new Error(`Agent Session not found: ${source.sessionId}`)
    const profile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
    presetId = profile.content.presetId
  } else {
    const timeline = await ctx.narratives?.getTimeline(source.timelineId)
    if (!timeline) throw new Error(`Narrative Timeline not found: ${source.timelineId}`)
    cardId = timeline.createdFrom?.cardId
    const runtimeContext = await readTimelineRuntimeContext(ctx, source.timelineId)
    hasTimelineRuntimeContext = Boolean(runtimeContext)
    snapshotRules = runtimeContext?.textTransformRules ?? []
  }
  const active = rules.filter(rule => {
    if (rule.owner.kind === 'preset') return rule.owner.presetId === presetId
    if (rule.owner.kind === 'card') return !hasTimelineRuntimeContext && rule.owner.cardId === cardId
    return true
  })
  return [...active, ...snapshotRules]
}
