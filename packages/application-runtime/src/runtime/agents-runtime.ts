import { sameChatAttachments } from '@loom-studio/shared'
import { branchTranscriptEntries, pendingInterjections, withInterjectionLock } from '../agents/interjections.js'
import { validateMessageAttachments, mountMessageAttachments } from '../agents/message-attachments.js'
import { observationOrigin } from '../observability/origin.js'
import type { ObservationBuild } from '../observability/types.js'
import { createVariableRenderContext } from '../prompt/variables.js'
import { parseAgentApprovalPolicy } from '../agents/approval-policy.js'
import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { countText } from '@loom-studio/tokenizer'
import { estimateRequestTokens } from '@loom-studio/ai-gateway'
import { readLogFailure } from '@loom-studio/logging'
import type {
  PromptResourceMutation,
  AgentSession,
  NarrativeNode,
  NarrativePage,
} from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { createAgentToolRegistry, type ToolDefinition } from '../agents/tool-registry.js'
import { createAgentToolScope } from '../agents/agent-tool-scope.js'
import {
  compileAgentToolSet,
  createContentToolPromptRuntimeInputs,
  runNativeToolLoop,
  createNativeToolSpecs,
  type AgentRunProgress,
} from '../agents/tool-loop.js'
import { composeAgentTurnPrompt } from '../agents/agent-turn.js'
import { collectPromptExtensionDependencies } from '../extensions/prompt-dependencies.js'
import { assertTimelineExtensionLease } from '../extensions/timeline-participation.js'
import { createSessionSummaryCoordinator, defaultSessionSummaryPolicy, planSessionSummary, summaryInstruction, type SummaryPlan } from '../agents/session-summary.js'
import { readSessionHistory } from '../agents/session-history.js'
import { readAgentRunRecovery, readAgentRunState, readInterruptedAgentRuns, registerAgentExecutor } from '../agents/run-recovery.js'
import { readDiscussionRetry, restoreDiscussionRetryInTransaction } from '../agents/discussion-retry.js'
import { assertNonEmpty, assertProviderModelExists } from '../agents/agent.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from '../providers/provider-payload.js'
import { fromStoredResource, readMappedResource, toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
import { isPromptActivation, type ActivationFacts } from '../prompt/prompt-activation.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import { createNarrativeSampler } from '../narrative/sampling.js'
import { readNarrativeContext } from '../narrative/context-provider.js'
import { readTimelinePresetConfig } from '../prompt/timeline-preset-config.js'
import { isRecord, normalizeMacroSelections } from '@loom-studio/shared'
import { resolveEffectiveTextPipeline } from './transforms-runtime.js'
import { isExtensionResourceAvailable, readAvailableExtensionInstallations } from './extension-resource-access.js'
import { createEmptyPromptResourceContent, createPromptRuntimeMethods } from './prompt-runtime.js'
import { getApplicationStateSnapshot } from '../state/state.js'
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
import { hasPlayerProfile } from '../profiles/player-state.js'
import {
  assertNarrativeExecutionSource,
  beginNarrativeSwipeRun,
  captureNarrativeExecutionSource,
  finishNarrativeSwipeRun,
  projectSwipeSessionHistory,
  settleDiscardedNarrativeRuns,
  type SwipeExecution,
} from './swipe-runtime.js'
import { inspectApplicationMacros, inspectPreparedMacros, variableContextFromInspection } from './macros-runtime.js'

const executingSessions = new WeakMap<object, Set<string>>()

type AgentsRuntimeContext = Pick<ApplicationRuntimeContext,
  | 'extensionReadonlyFiles'
  | 'narrativeActivity'
  | 'workspaces'
  | 'agentTools'
  | 'agents'
  | 'createId'
  | 'dataEngine'
  | 'documents'
  | 'gateway'
  | 'observations'
  | 'logger'
  | 'runtimeLogger'
  | 'macroProviders'
  | 'promptProcessors'
  | 'stateContent'
  | 'narratives'
  | 'narrativeContext'
  | 'now'
  | 'promptResources'
  | 'providerAdapters'
  | 'mediaAssets'
  | 'states'
  | 'swipes'
  | 'onStateChanged'
>

export function createAgentsRuntimeMethods(ctx: AgentsRuntimeContext) {
  const summaries = createSessionSummaryCoordinator(ctx)
  const manualSummaryExecutions = new Map<string, Promise<void>>()
  return {
    reviseAgentInput: async (input: Parameters<import('../types.js').ApplicationRuntime['reviseAgentInput']>[0], request?: RuntimeRequestContext) => {
      const agents = requireAgents(ctx)
      const attachments = await validateMessageAttachments(ctx.mediaAssets, input.attachments)
      const deleting = !input.content.trim() && !attachments.length
      if ((await agents.getEntry(input.entryId))?.entry.kind === 'message') await summaries.wait(input.agentSessionId)
      return withInterjectionLock(agents, input.agentSessionId, async () => {
        const session = await agents.getSession(input.agentSessionId)
        if (!session) throw new Error('Session not found')
        const all = await agents.listEntries(session.id)
        const active = branchTranscriptEntries(all, session.headEntryId)
        const pending = pendingInterjections(all)
        const target = all.find(item => item.id === input.entryId)
        const latest = pending.at(-1) ?? active.findLast(item => item.entry.kind === 'message' && item.entry.role === 'user')
        const lastState = all.findLast(item => item.entry.kind === 'run-state')
        const justAbandoned = session.kind === 'timeline' && !pending.length && lastState?.entry.kind === 'run-state' && lastState.entry.state === 'discarded'
          && all.findLast(item => item.entry.kind === 'message' && item.entry.role === 'user')?.id === target?.id
        if (!target || latest?.id !== target.id && !justAbandoned || (target.entry.kind !== 'message' && target.entry.kind !== 'user-interjection')) throw new Error('只能编辑最新一条用户输入，请刷新后重试')
        const original = target.entry
        if (original.content !== input.expectedContent || !sameChatAttachments(original.attachments, input.expectedAttachments)) throw new Error('输入已被修改，请重新打开编辑')
        if (original.content === input.content && sameChatAttachments(original.attachments, attachments)) throw new Error('输入没有变化')
        if (original.kind === 'message' && (original.role !== 'user' || original.purpose === 'narrative')) throw new Error('请使用正文输入的编辑入口')
        const isPending = original.kind === 'user-interjection' && pending.some(item => item.id === target.id)
        if (original.kind === 'user-interjection' && !isPending) throw new Error('这条输入已经接入，请刷新后重试')
        const suspendedRuns: string[] = []
        if (!isPending) {
          const states = new Map<string, string>()
          for (const item of all) if (item.runId && item.entry.kind === 'run-state') {
            states.set(item.runId, item.entry.state)
            if (item.entry.sourceRunId) states.set(item.entry.sourceRunId, 'transferred')
          }
          if ([...states.values()].some(state => ['created', 'running'].includes(state))) throw new Error('请等待执行结束或暂停后再提交编辑')
          for (const [id, state] of states) if (state === 'suspended') suspendedRuns.push(id)
        }
        const retry = !isPending && session.kind === 'timeline'
          ? await readDiscussionRetry(ctx, { agentSessionId: session.id, input: input.content.trim() ? input.content : '删除输入', attachments, retry: { entryId: target.id } }, request, true) : undefined
        const result = await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.reviseAgentInput'), async tx => {
          const store = agents.transaction(tx)
          const current = store.getSession(session.id)
          if (!current || current.entryCount !== session.entryCount || current.headEntryId !== session.headEntryId) throw new Error('会话已变化，请重新提交编辑')
          if (isPending) {
            return store.reviseInterjection({ entryId: target.id, expected: original,
              replacement: { ...original, content: deleting ? original.content : input.content, attachments: deleting ? original.attachments : attachments, withdrawn: deleting } })
          }
          if (retry) restoreDiscussionRetryInTransaction(ctx, retry, tx)
          else store.rewindStandalone({ agentSessionId: session.id, expectedHeadEntryId: session.headEntryId, headEntryId: target.parentEntryId })
          const receipt = original.kind === 'message' && original.interjectionRequestId
            ? all.find(item => item.entry.kind === 'user-interjection' && item.entry.requestId === original.interjectionRequestId) : undefined
          if (receipt?.entry.kind === 'user-interjection') store.reviseInterjection({ entryId: receipt.id, expected: receipt.entry, replacement: { ...receipt.entry, withdrawn: true } })
          if (retry) {
            const swipes = ctx.swipes.transaction(tx)
            const group = swipes.getLatest(retry.branch.id)
            if (group && !group.closed) swipes.save({ ...group, closed: true, generation: group.generation + 1,
              activeRunId: undefined, activeCandidateId: undefined,
              candidates: group.candidates.map(candidate => candidate.id === group.activeCandidateId ? { ...candidate, status: 'discarded' as const } : candidate),
            }, { expectedRevision: group.revision })
          }
          if (suspendedRuns.length) store.appendEntries({ agentSessionId: session.id, expectedEntryCount: session.entryCount,
            entries: suspendedRuns.map(runId => ({ runId, entry: { kind: 'run-state' as const, state: 'discarded' as const } })) })
          if (deleting) return target
          return store.appendEntries({ agentSessionId: session.id, expectedEntryCount: session.entryCount + suspendedRuns.length, entries: [{ entry: {
            ...(receipt?.entry.kind === 'user-interjection' ? receipt.entry : {}),
            kind: 'user-interjection', requestId: ctx.createId('edit'), content: input.content, attachments, mode: 'discussion', withdrawn: false,
            ...(retry ? { narrativeTarget: { timelineId: session.id, branchId: retry.branch.id } } : {}),
          } }] }).entries[0]!
        })
        return { entry: result.value, rerun: !isPending && !deleting }
      })
    },
    submitAgentInterjection: async (input: import('../types.js').SubmitAgentInterjectionInput, request?: RuntimeRequestContext) => {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(input.requestId)) throw new Error('Invalid interjection request ID')
      const attachments = await validateMessageAttachments(ctx.mediaAssets, input.attachments)
      if (!input.input.trim() && !attachments.length) throw new Error('User input cannot be empty')
      const agents = requireAgents(ctx)
      return withInterjectionLock(agents, input.agentSessionId, async () => {
        const session = await agents.getSession(input.agentSessionId)
        if (!session) throw new Error('Agent Session not found')
        if (session.timelineId && !input.narrativeTarget) {
          const timeline = await ctx.narratives!.getTimeline(session.timelineId)
          if (!timeline) throw new Error('Timeline no longer exists')
          input = { ...input, narrativeTarget: { timelineId: timeline.id, branchId: timeline.activeBranchId } }
        }
        if (input.mode === 'narrative' && (!input.narrativeTarget || session.kind !== 'timeline')) throw new Error('Narrative input requires a Timeline Session and branch')
        if (input.narrativeTarget) {
          const branch = await ctx.narratives?.getBranch(input.narrativeTarget.branchId)
          if (!branch || branch.timelineId !== session.timelineId || input.narrativeTarget.timelineId !== session.timelineId) throw new Error('Interjection target does not belong to the Session')
        }
        const entry = { kind: 'user-interjection' as const, requestId: input.requestId, content: input.input, mode: input.mode,
          ...(input.narrativeTarget ? { narrativeTarget: input.narrativeTarget } : {}), ...(attachments.length ? { attachments } : {}),
          ...(input.macroSelections ? { macroSelections: input.macroSelections } : {}), ...(input.activationFacts ? { activationFacts: input.activationFacts } : {}) }
        const history = await agents.listEntries(session.id)
        const existing = history.find(item => item.entry.kind === 'user-interjection' && item.entry.requestId === input.requestId)
        if (existing) {
          if (JSON.stringify(existing.entry) !== JSON.stringify(entry)) throw new Error('Interjection request ID was reused with different input')
          return { entry: existing, pending: pendingInterjections(history).some(item => item.id === existing.id) }
        }
        const result = await agents.appendEntries({ ...narrativeWriteContext(request, 'application.submitAgentInterjection'),
          agentSessionId: session.id, expectedEntryCount: session.entryCount, entries: [{ entry }] })
        return { entry: result.entries[0]!, pending: true }
      })
    },
    getAgentSessionMemory: async (input: { agentSessionId: string; branchId?: string }) => {
      const session = await requireAgents(ctx).getSession(input.agentSessionId)
      if (!session) throw new Error('Agent Session not found')
      if (input.branchId && !session.timelineId) throw new Error('A standalone Session has no Narrative branch')
      const page = session.timelineId && ctx.narratives
        ? await ctx.narratives.getPage({ timelineId: session.timelineId, branchId: input.branchId, limit: 1 }) : undefined
      const history = await readActiveSessionHistory(ctx, session, page)
      const summary = history.entries.find(entry => entry.entry.kind === 'work-summary') ?? null
      const boundary = summary?.entry.kind === 'work-summary' ? summary.entry.boundary : undefined
      const retiredThroughSequence = boundary?.retiredThroughSequence ?? summary?.sequence ?? 0
      const sourceThroughSequence = boundary?.sourceThroughSequence ?? summary?.sequence ?? 0
      const messages = await requireAgents(ctx).countSummaryMessages(session.id, retiredThroughSequence, sourceThroughSequence)
      return { session, policy: session.summaryPolicy ?? defaultSessionSummaryPolicy,
        status: summaries.status(session.id), summary,
        coverage: { retiredThroughSequence, sourceThroughSequence, messages } }
    },
    updateAgentSessionSummary: async (input: { agentSessionId: string; branchId?: string; expectedSummaryId: string; expectedEntryCount: number; content: string }, request?: RuntimeRequestContext) => {
      const agents = requireAgents(ctx)
      let executing = executingSessions.get(agents)
      if (!executing) { executing = new Set(); executingSessions.set(agents, executing) }
      if (executing.has(input.agentSessionId) || ['preparing', 'ready'].includes(summaries.status(input.agentSessionId).state))
        throw new Error('会话正在工作或总结，请完成或终止后再保存摘要。')
      executing.add(input.agentSessionId)
      try {
        const session = await agents.getSession(input.agentSessionId)
        if (!session) throw new Error('Agent Session not found')
        if (input.branchId && !session.timelineId) throw new Error('A standalone Session has no Narrative branch')
        if (!input.content.trim() || countText(input.content).estimatedTokens > (session.summaryPolicy ?? defaultSessionSummaryPolicy).maxTokens)
          throw new Error('摘要不能为空，且不能超过当前摘要 Token 上限。')
        const page = session.timelineId && ctx.narratives
          ? await ctx.narratives.getPage({ timelineId: session.timelineId, branchId: input.branchId, limit: 1 }) : undefined
        const history = await readActiveSessionHistory(ctx, session, page)
        const previous = history.entries.find(item => item.entry.kind === 'work-summary')
        if (!previous || previous.id !== input.expectedSummaryId || session.entryCount !== input.expectedEntryCount)
          throw new Error('会话或摘要已变化。草稿已保留，请复制修改并刷新后合并。')
        if (previous.entry.kind !== 'work-summary') throw new Error('Session summary unavailable')
        if (previous.entry.content === input.content) return
        const boundary = previous.entry.boundary ?? { sourceThroughSequence: previous.sequence, retiredThroughSequence: previous.sequence }
        request?.abortSignal?.throwIfAborted()
        await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.updateAgentSessionSummary'), async tx => {
          if (page) {
            const branch = ctx.narratives!.transaction(tx).getBranch(page.branch.id)
            if (!branch || branch.headNodeId !== page.branch.headNodeId || branch.stateHeadRevisionId !== page.branch.stateHeadRevisionId || branch.workspaceHeadRevisionId !== page.branch.workspaceHeadRevisionId)
              throw new Error('剧情上下文已变化，请刷新后再保存摘要。')
          }
          agents.transaction(tx).appendEntries({ agentSessionId: session.id, expectedEntryCount: input.expectedEntryCount,
            entries: [{ entry: { kind: 'work-summary', content: input.content, boundary } }] })
        })
      } finally { executing.delete(input.agentSessionId) }
    },
    cancelAgentSessionSummary: (input: { agentSessionId: string }) => summaries.cancel(input.agentSessionId),
    listAgentSessionSummaryTasks: (input: { agentSessionId: string }) => requireAgents(ctx).listSummaryTasks(input.agentSessionId),
    getAgentSessionSummaryStatus: (input: { agentSessionId: string }) => summaries.status(input.agentSessionId),
    summarizeAgentSession: async (input: { agentSessionId: string; branchId?: string }, request?: RuntimeRequestContext) => {
      const agents = requireAgents(ctx)
      let executing = executingSessions.get(agents)
      if (!executing) { executing = new Set(); executingSessions.set(agents, executing) }
      if (executing.has(input.agentSessionId) || summaries.status(input.agentSessionId).state === 'preparing')
        throw new Error('Agent Session already has active work')
      executing.add(input.agentSessionId)
      const settled = Promise.withResolvers<void>()
      manualSummaryExecutions.set(input.agentSessionId, settled.promise)
      try {
        const session = await agents.getSession(input.agentSessionId)
        if (!session) throw new Error('Agent Session not found')
        if (input.branchId && !session.timelineId) throw new Error('A standalone Session has no Narrative branch')
        const target = session.timelineId ? { timelineId: session.timelineId, branchId: input.branchId } : undefined
        const page = target && ctx.narratives ? await ctx.narratives.getPage({ ...target, limit: 1 }) : undefined
        const history = await readActiveSessionHistory(ctx, session, page)
        const plan = await planSessionSummary(ctx, { session, entries: history.entries,
          branchId: page?.branch.id, force: true })
        if (!plan) return summaries.status(session.id)
        const snapshot = await prepareAgentTurn(ctx, { agentSessionId: session.id, input: summaryInstruction(plan), narrativeTarget: target },
          'runtime', request, undefined, plan.boundary.narrative)
        await summaries.start(plan, { messages: snapshot.agentStepMessages, model: snapshot.model, entries: snapshot.agentPage.entries, entryCount: snapshot.session.entryCount }, request)
        return await summaries.adopt(session.id, request)
      } finally { executing.delete(input.agentSessionId); manualSummaryExecutions.delete(input.agentSessionId); settled.resolve() }
    },
    findAgentRunCheckpoint: (input: { agentSessionId: string; runId: string }) => requireAgents(ctx).findRunCheckpoint(input),
    inspectAgentRunState: async (input: { agentSessionId: string; runId: string }) => readAgentRunState(requireAgents(ctx), {
      ...input, adoptedBranchId: await activeTimelineBranch(ctx, input.agentSessionId),
    }),
    prepareAgentRunRecovery: async (input: { agentSessionId: string; runId?: string }) => {
      const recovery = await readAgentRunRecovery(requireAgents(ctx), input)
      const branchId = await activeTimelineBranch(ctx, input.agentSessionId)
      return branchId && recovery?.continuation.recovery.narrativeSource?.branchId !== branchId ? undefined : recovery
    },
    createAgentPreset: async (input: CreateAgentPresetInput, requestContext?: RuntimeRequestContext): Promise<AgentPresetResult> => {
      assertNonEmpty(input.name, 'name')
      if (input.model !== undefined) await assertProviderModelExists(ctx.documents, input.model)
      const content = createEmptyPromptResourceContent(ctx.createId, input.name, 'preset', ctx.now())
      content.model = input.model
      content.delivery = input.delivery ?? 'stream'
      content.historyPolicy = input.historyPolicy ?? 'persistent'
      content.approvalPolicy = parseAgentApprovalPolicy(input.approvalPolicy)
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
      if (input.approvalPolicy !== undefined) metadata.approvalPolicy = parseAgentApprovalPolicy(input.approvalPolicy)!
      if (input.useCardLore !== undefined) metadata.useCardLore = input.useCardLore
      if (input.useGlobalLore !== undefined) metadata.useGlobalLore = input.useGlobalLore
      if (input.textUses !== undefined) {
        if (!Array.isArray(input.textUses) || input.textUses.some(use =>
          typeof use.id !== 'string' || !use.id.trim()
          || !['rule', 'extractor'].includes(use.kind) || typeof use.enabled !== 'boolean'
          || 'reference' in use
          || (use.orderIndex !== undefined && (!Number.isSafeInteger(use.orderIndex) || use.orderIndex < 0)))
          || new Set(input.textUses.map(use => `${use.kind}:${use.id}`)).size !== input.textUses.length) {
          throw new Error('Invalid Preset text use configuration')
        }
        const previous = Array.isArray(metadata.textUses)
          ? metadata.textUses as NonNullable<PromptResourceContent['textUses']>
          : []
        metadata.textUses = input.textUses.map(use => {
          const reference = previous.find(item => item.kind === use.kind && item.id === use.id)?.reference
          return { ...structuredClone(use), ...(reference === undefined ? {} : { reference: structuredClone(reference) }) }
        })
      }
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

    listAgentRunStates: () => requireAgents(ctx).listRunStates(),

    getAgentSession: async (input: GetAgentSessionInput): Promise<GetAgentSessionResult> => {
      const session = await requireAgents(ctx).getSession(input.agentSessionId)
      if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
      return { session }
    },

    getAgentTranscriptPage: async (input: GetAgentTranscriptPageInput): Promise<AgentTranscriptPage> => {
      const page = await requireAgents(ctx).getEntryPage(input)
      return input.selectedCandidates && page.session.kind !== 'timeline'
        ? { ...page, entries: await projectSwipeSessionHistory(ctx, input.agentSessionId, page.entries, true) }
        : page
    },

    appendAgentTranscriptEntries: async (input: AppendAgentTranscriptEntriesInput, requestContext?: RuntimeRequestContext): Promise<AppendAgentTranscriptEntriesResult> => {
      const result = await requireAgents(ctx).appendEntries({
        ...narrativeWriteContext(requestContext, 'application.appendAgentTranscriptEntries'),
        ...input,
      })
      await settleDiscardedNarrativeRuns(ctx, input.agentSessionId, result.entries.flatMap(item =>
        item.runId && item.entry.kind === 'run-state' && item.entry.state === 'discarded' ? [item.runId] : []), requestContext)
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
      if (countText(input.summary).estimatedTokens > (session.summaryPolicy ?? defaultSessionSummaryPolicy).maxTokens)
        throw new Error('Session summary exceeds its Token limit')
      if (input.branchId && !session.timelineId) throw new Error('A standalone Session has no Narrative branch')
      if (session.timelineId && !ctx.narratives) throw new Error('Narrative Store is not configured')
      const page = session.timelineId
        ? await ctx.narratives!.getPage({ timelineId: session.timelineId, branchId: input.branchId, limit: 1 })
        : undefined
      const sourceThrough = session.headEntryId ? (await agents.getEntry(session.headEntryId))!.sequence : 0
      const boundary = input.boundary ?? {
        sourceThroughSequence: sourceThrough,
        retiredThroughSequence: sourceThrough,
        ...(page ? { narrative: {
          timelineId: page.timeline.id, branchId: page.branch.id, nodeId: page.branch.headNodeId ?? null,
          stateRevisionId: page.branch.stateHeadRevisionId, workspaceRevisionId: page.branch.workspaceHeadRevisionId,
        } } : {}),
      }
      if (boundary.narrative) {
        if (!page || boundary.narrative.timelineId !== page.timeline.id || boundary.narrative.branchId !== page.branch.id)
          throw new Error('Session summary source does not match the target branch')
        if (boundary.narrative.nodeId !== null) await ctx.narratives!.getPage({
          timelineId: page.timeline.id, branchId: page.branch.id, cursor: boundary.narrative.nodeId, limit: 1,
        })
        else if (page.branch.headNodeId) throw new Error('Empty summary source no longer matches the branch')
      } else if (page) {
        throw new Error('A Timeline Session summary requires its Narrative source')
      }
      requestContext?.abortSignal?.throwIfAborted()
      const committed = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.completeAgentSessionHandoff'), async tx => {
          if (page) {
            const branch = ctx.narratives!.transaction(tx).getBranch(page.branch.id)
            if (!branch || branch.headNodeId !== page.branch.headNodeId)
              throw new Error('Session summary Narrative source changed before adoption')
          }
          return agents.transaction(tx).appendEntries({
            agentSessionId: session.id,
            expectedEntryCount: input.expectedEntryCount,
            entries: [{ entry: { kind: 'work-summary', content: input.summary, boundary } }],
          })
        },
      )
      const result = { ...committed.value, commit: committed.commit }
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
      const deleting = await agents.getSession(input.agentSessionId)
      if (deleting?.kind === 'timeline') throw new Error('Delete a Timeline Session through its story')
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
      summaries.forget(input.agentSessionId)
      return { deleted: true as const, mutation: { changesetId: result.commit.changesetId } }
    },

    updateAgentSession: async (input: UpdateAgentSessionInput, requestContext?: RuntimeRequestContext): Promise<UpdateAgentSessionResult> => {
      if ((input.agentPresetId !== undefined || input.narrativeMode !== undefined) && executingSessions.get(ctx)?.has(input.agentSessionId))
        throw new Error('Wait for the active Agent turn before changing its configuration')
      if (input.agentPresetId !== undefined) await readPresetResource(ctx.promptResources, input.agentPresetId)
      const result = await requireAgents(ctx).updateSession({
        ...narrativeWriteContext(requestContext, 'application.updateAgentSession'),
        ...input,
      })
      if (input.summaryPolicy?.enabled === false) await summaries.cancel(input.agentSessionId)
      return { session: result.session, mutation: { changesetId: result.commit.changesetId } }
    },

    previewAgentTurn: async (input: PreviewAgentTurnInput, requestContext?: RuntimeRequestContext): Promise<PreviewAgentTurnResult> => {
      const prepared = await collectPromptExtensionDependencies(ctx, () => prepareAgentTurn(ctx, input, 'preview', requestContext))
      return {
        runId: prepared.runId,
        tokenEstimate: estimateRequestTokens({
          messages: prepared.agentStepMessages,
          tools: createNativeToolSpecs(prepared.compiledToolSet),
        }, { multiplier: prepared.tokenMultiplier }),
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
      input = structuredClone(input)
      await manualSummaryExecutions.get(input.agentSessionId)
      requestContext?.abortSignal?.throwIfAborted()
      input.attachments = await validateMessageAttachments(ctx.mediaAssets, input.attachments)
      const agents = requireAgents(ctx)
      let executing = executingSessions.get(agents)
      if (!executing) {
        executing = new Set()
        executingSessions.set(agents, executing)
      }
      if (executing.has(input.agentSessionId))
        throw Object.assign(new Error('Agent Session already has an executing Run'), { code: 'agent.session_busy' })
      executing.add(input.agentSessionId)
      const runId = requestContext?.agentRun?.runId ?? ctx.createId('run')
      const releaseExecutor = registerAgentExecutor(runId)
      const startedAt = performance.now()
      ctx.observations.capture(() => ctx.observations.write({
        id: runId, kind: 'run', title: 'Agent Run', status: 'running',
        agentSessionId: input.agentSessionId, timelineId: input.narrativeTarget?.timelineId,
        origin: observationOrigin(requestContext),
      }))
      const progress: AgentRunProgress = { stage: 'preparation', providerStep: 0, toolCount: 0, suspended: false }
      let swipeExecution: SwipeExecution | undefined
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
        const stale = requestContext?.agentRun?.continuation ? { interrupted: [], entryCount: 0 }
          : await readInterruptedAgentRuns(agents, input.agentSessionId, runId)
        if (stale.interrupted.length) {
          await ctx.dataEngine.transact(narrativeWriteContext(requestContext, 'application.reconcileAgentRuns'), async tx => {
            agents.transaction(tx).appendEntries({ agentSessionId: input.agentSessionId, expectedEntryCount: stale.entryCount,
              entries: stale.interrupted.map(id => ({ runId: id, entry: { kind: 'run-state' as const, state: 'aborted' as const,
                reason: 'Execution interrupted: the original executor has stopped; superseded by a new request' } })) })
          })
          runLogger?.warn('Recovered interrupted Agent execution markers', {
            event: 'run.reconciled', ...logContext,
            data: { ...references, interruptedRunIds: stale.interrupted },
          })
        }
        for (const lease of requestContext?.agentRun?.continuation?.recovery?.promptExtensionLeases ?? []) {
          await assertTimelineExtensionLease(ctx, ctx.documents, lease)
        }
        await summaries.wait(input.agentSessionId)
        requestContext?.abortSignal?.throwIfAborted()
        const discussionRetry = await readDiscussionRetry(ctx, input, requestContext)
        if (input.contextMode !== 'isolated' && !input.retry && !input.narrativeTarget?.swipe && !requestContext?.agentRun?.continuation) {
          await summaries.adopt(input.agentSessionId, requestContext)
        }
        if (input.contextMode !== 'isolated' && !input.retry && !input.narrativeTarget?.swipe && !requestContext?.agentRun?.continuation
          && summaries.status(input.agentSessionId).state !== 'preparing') {
          const sourceSession = await agents.getSession(input.agentSessionId)
          if (!sourceSession) throw new Error('Agent Session not found')
          if (sourceSession.entryCount && (sourceSession.summaryPolicy?.enabled ?? true)) {
            if (sourceSession.timelineId && input.narrativeTarget && input.narrativeTarget.timelineId !== sourceSession.timelineId)
              throw new Error('Narrative target does not match the Agent Session timeline binding')
            const target = input.narrativeTarget ?? (sourceSession.timelineId ? { timelineId: sourceSession.timelineId } : undefined)
            const page = target && ctx.narratives ? await ctx.narratives.getPage({ ...target, limit: 1 }) : undefined
            const inputNode = input.narrativeTarget?.inputNodeId ? page?.nodes.find(node => node.id === input.narrativeTarget!.inputNodeId) : undefined
            if (input.narrativeTarget?.inputNodeId && (!inputNode || page?.branch.headNodeId !== inputNode.id))
              throw new Error('The writing input must be the latest Narrative node')
            if (!inputNode && !input.input.trim() && !input.attachments?.length) throw new Error('Agent turn input cannot be empty')
            const sourcePreset = await readPresetResource(ctx.promptResources, requireSessionPreset(sourceSession))
            const plan = (sourcePreset.historyPolicy ?? 'persistent') === 'persistent'
              ? await planSessionSummary(ctx, {
                session: sourceSession, entries: (await readActiveSessionHistory(ctx, sourceSession, page)).entries,
                branchId: page?.branch.id, sourceNodeId: inputNode ? inputNode.parentNodeId ?? null : undefined,
                allowFloorTrigger: Boolean(inputNode),
              }) : undefined
            if (plan) {
              const snapshot = await prepareAgentTurn(ctx, {
                agentSessionId: input.agentSessionId, input: summaryInstruction(plan),
                ...(page ? { narrativeTarget: { timelineId: page.timeline.id, branchId: page.branch.id } } : {}),
                macroSelections: input.macroSelections,
              }, 'runtime', requestContext, undefined, plan.boundary.narrative)
              const preparation = summaries.start(plan, { model: snapshot.model, messages: snapshot.agentStepMessages,
                entries: snapshot.agentPage.entries, entryCount: snapshot.session.entryCount }, requestContext)
              if (plan.policy.asynchronous && inputNode) void preparation
              else {
                await preparation
                const result = await summaries.adopt(input.agentSessionId, requestContext)
                if (result.state !== 'adopted') throw new Error(result.error ?? 'Session summary failed')
              }
            }
          }
        }
        if (input.contextMode === 'isolated' && input.narrativeTarget) throw new Error('Isolated Agent turns cannot target Narrative')
        swipeExecution = await beginNarrativeSwipeRun(ctx, input, runId, requestContext, discussionRetry)
        const prepared = await collectPromptExtensionDependencies(ctx, () => prepareAgentTurn(ctx, input, 'runtime', requestContext, runId))
        const {
          model,
          narrativePage,
          prompt,
          agentStepMessages,
          compiledToolSet,
          session,
          preset,
        } = prepared
        ctx.observations.capture(() => ctx.observations.patch(runId, {
          agentPresetId: preset.id, title: preset.rootNode.label || 'Agent Run', timelineId: narrativePage?.timeline.id ?? session.timelineId,
          branchId: narrativePage?.branch.id, buildId: prompt.promptBuildTrace.buildId,
        }))
        const savedInput = session.kind === 'timeline' && input.narrativeTarget?.inputNodeId
          ? await ctx.narratives!.getNode(input.narrativeTarget.inputNodeId) : undefined
        const savedUser = savedInput?.entryId ? await agents.getEntry(savedInput.entryId) : undefined
        const loop = await runNativeToolLoop({
          ctx,
          agents,
          session,
          runId,
          progress,
          model,
          tokenMultiplier: prepared.tokenMultiplier,
          buildId: prompt.promptBuildTrace.buildId,
          initialMessages: requestContext?.agentRun?.continuation?.messages ?? agentStepMessages,
          recoveryRequest: {
            ...input,
            retry: undefined,
            ...(narrativePage ? { narrativeTarget: {
              ...input.narrativeTarget, timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id,
            } } : {}),
          },
          userInput: prepared.userInput,
          attachments: prepared.attachments,
          beforeInterjections: async () => { await summaries.wait(session.id) },
          initialInterjection: input.interjectionRequestId ? (await agents.listEntries(session.id)).find(item => item.entry.kind === 'user-interjection' && item.entry.requestId === input.interjectionRequestId) : undefined,
          ...(discussionRetry?.user.roundId ? { retryRoundId: discussionRetry.user.roundId } : {}),
          materialBaseline: discussionRetry?.baseline ?? requestContext?.agentRun?.continuation?.recovery?.materialBaseline
            ?? (session.kind === 'timeline' && narrativePage && !input.narrativeTarget?.inputNodeId ? {
              timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id,
              headNodeId: narrativePage.branch.headNodeId ?? null, headEntryId: narrativePage.branch.headEntryId ?? null,
              stateRevisionId: narrativePage.branch.stateHeadRevisionId, workspaceRevisionId: narrativePage.branch.workspaceHeadRevisionId,
            } : undefined),
          compiledToolSet,
          toolExecutionScope: prompt.toolExecutionScope,
          processedPrompt: prompt.processingSnapshot,
          promptExtensionLeases: requestContext?.agentRun?.continuation?.recovery?.promptExtensionLeases ?? prepared.promptExtensionLeases,
          branchId: narrativePage?.branch.id ?? 'agent-only',
          purpose: input.narrativeTarget?.inputNodeId ? 'narrative' : 'agent',
          classificationRules: prepared.classificationRules,
          ...(session.kind === 'timeline' && narrativePage ? { narrativeOutput: {
            mode: session.narrativeMode ?? 'declared',
            adopt: (tx, entry, content) => {
              const narratives = ctx.narratives!.transaction(tx)
              const branch = narratives.getBranch(narrativePage.branch.id)
              if (!branch) throw new Error('Narrative branch no longer exists')
              const adopted = narratives.appendNode({
                timelineId: narrativePage.timeline.id, branchId: branch.id,
                expectedHeadNodeId: branch.headNodeId ?? null, stateRevisionId: branch.stateHeadRevisionId,
                body: { format: 'loom-markdown.v1', raw: content },
                source: { agentSessionId: session.id, agentMessageId: entry.id, runId },
              })
              const source = prompt.toolExecutionScope.narrativeSource
              if (source) source.cursorNodeId = adopted.node.id
            },
          } } : {}),
          ...(requestContext ? { requestContext } : {}),
          delivery: preset.delivery ?? 'stream',
          ...(requestContext?.agentRun?.continuation?.userEntry
            ? { resumeUserEntry: requestContext.agentRun.continuation.userEntry }
            : savedUser ? { resumeUserEntry: savedUser } : {}),
          ...(requestContext?.agentRun?.continuation?.partialEntryId
            ? { resumeAssistantEntryId: requestContext.agentRun.continuation.partialEntryId }
            : {}),
        })
        const outcome = progress.suspended ? 'suspended' : requestContext?.abortSignal?.aborted
          ? requestContext.abortSignal.reason === 'user-pause' ? 'suspended' : 'cancelled'
          : 'completed'
        const execution = swipeExecution
        swipeExecution = undefined
        await finishNarrativeSwipeRun(ctx, execution, outcome === 'cancelled' ? 'failed' : outcome, requestContext)
        if (outcome === 'completed') {
          if (input.contextMode !== 'isolated') await summaries.adopt(input.agentSessionId, requestContext)
          if (input.narrativeTarget && narrativePage) {
            const branch = await ctx.narratives!.getBranch(narrativePage.branch.id)
            if (!branch) throw new Error(`Narrative branch not found: ${narrativePage.branch.id}`)
            ctx.narrativeActivity.emit({ kind: 'run-completed', timelineId: narrativePage.timeline.id,
              branchId: branch.id, nodeId: branch.headNodeId ?? null, agentSessionId: input.agentSessionId })
          }
        }
        runLogger?.info(`Agent turn ${outcome}`, {
          event: `run.${outcome}`, ...logContext,
          data: {
            ...references, outcome, durationMs: readDurationMs(startedAt),
            providerStep: progress.providerStep, toolCount: progress.toolCount,
            detail: `${progress.providerStep} steps · ${progress.toolCount} tools`,
          },
        })

        ctx.observations.capture(() => ctx.observations.patch(runId, {
          status: outcome === 'cancelled' ? 'aborted' : outcome, durationMs: readDurationMs(startedAt),
        }))
        return {
          runId,
          agentSession: (await agents.getSession(input.agentSessionId)) ?? loop.session,
          summaryStatus: summaries.status(input.agentSessionId),
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
        ctx.observations.capture(() => ctx.observations.patch(runId, {
          status: outcome === 'cancelled' ? 'aborted' : outcome, durationMs: readDurationMs(startedAt),
          diagnostic: failure.failureReason,
        }))
        if (swipeExecution) {
          const execution = swipeExecution
          swipeExecution = undefined
          const swipeOutcome = requestContext?.agentRun?.continuation && progress.stage === 'preparation'
            ? 'preparation-failed' : outcome === 'cancelled' ? 'failed' : outcome
          await finishNarrativeSwipeRun(ctx, execution, swipeOutcome, requestContext)
        }
        runLogger?.[outcome === 'failed' ? 'error' : !aborted && outcome === 'suspended' ? 'warn' : 'info'](`Agent turn ${outcome} · ${progress.stage}`, {
          event: `run.${outcome}`, ...logContext,
          data: {
            ...references, ...failure, ...progress, outcome, durationMs: readDurationMs(startedAt),
            detail: `${failure.failureReason} · ${progress.providerStep} steps · ${progress.toolCount} tools`,
          },
        })
        throw error
      } finally {
        releaseExecutor()
        executing.delete(input.agentSessionId)
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

export function toAgentToolDefinition(document: DocumentRecord<AgentToolContent>): ToolDefinition {
  return {
    id: document.id,
    owner: structuredClone(document.content.owner),
    name: document.content.name,
    description: document.content.description,
    input: structuredClone(document.content.input),
    ...(document.content.prompt
      ? { prompt: structuredClone(document.content.prompt) }
      : {}),
  }
}

function toAgentToolEntry(document: DocumentRecord<AgentToolContent>): AgentToolEntry {
  return {
    ...toAgentToolDefinition(document),
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
    documents.map(toAgentToolDefinition),
  )
}

async function readActiveSessionHistory(ctx: AgentsRuntimeContext, session: AgentSession, narrativePage?: NarrativePage) {
  const narratives = ctx.narratives
  // Resolve source validity before retiring any Transcript entries. A rejected
  // summary must not hide history needed to select an older version.
  let sourcePath: Set<string> | undefined
  const agentPage = await readSessionHistory(requireAgents(ctx), session.id, async entry => {
    if (entry.entry.kind !== 'work-summary') return false
    const source = entry.entry.boundary?.narrative
    const workspaceDependency = entry.entry.boundary?.adoptedWorkspaceRevisionId
    if (workspaceDependency) {
      let revisionId = narrativePage?.branch.workspaceHeadRevisionId
      while (revisionId && revisionId !== workspaceDependency)
        revisionId = (await ctx.workspaces.get(revisionId))?.parentRevisionId
      if (!revisionId) return false
    }
    if (!source) return !session.timelineId
    if (!narrativePage || !narratives || source.timelineId !== narrativePage.timeline.id
      || (session.kind !== 'timeline' && source.branchId !== narrativePage.branch.id)) return false
    if (source.nodeId === null) {
      let origin = narrativePage.branch.headNodeId ? await narratives.getNode(narrativePage.branch.headNodeId) : null
      while (origin?.parentNodeId) origin = await narratives.getNode(origin.parentNodeId)
      return (!source.stateRevisionId || source.stateRevisionId === (origin?.stateRevisionId ?? narrativePage.branch.stateHeadRevisionId))
        && (!source.workspaceRevisionId || source.workspaceRevisionId === (origin?.workspaceRevisionId ?? narrativePage.branch.workspaceHeadRevisionId))
    }
    if (!sourcePath) {
      sourcePath = new Set<string>()
      let nodeId = narrativePage.branch.headNodeId
      while (nodeId) {
        sourcePath.add(nodeId)
        nodeId = (await narratives.getNode(nodeId))?.parentNodeId
      }
    }
    if (!sourcePath.has(source.nodeId)) return false
    if (source.stateRevisionId || source.workspaceRevisionId) {
      const point = await narratives.getRecoveryPoint(narrativePage.branch.id, source.nodeId)
      if (source.stateRevisionId && source.stateRevisionId !== point.stateRevisionId) return false
      if (source.workspaceRevisionId) {
        // Later writes at the same Narrative node advance its recovery point.
        // Keep summaries whose Workspace source remains on that history chain.
        let revisionId: string | undefined = point.workspaceRevisionId
        while (revisionId && revisionId !== source.workspaceRevisionId)
          revisionId = (await ctx.workspaces.get(revisionId))?.parentRevisionId
        if (!revisionId) return false
      }
    }
    return true
  })
  if (ctx.narratives && session.kind !== 'timeline') {
    agentPage.entries = await projectSwipeSessionHistory(ctx, session.id, agentPage.entries)
  }
  if (narrativePage && narratives && session.kind !== 'timeline') {
    if (!sourcePath) {
      sourcePath = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await narratives.getPage({ timelineId: narrativePage.timeline.id,
          branchId: narrativePage.branch.id, cursor, limit: 100 })
        page.nodes.forEach(node => sourcePath!.add(node.id))
        cursor = page.nextCursor
      } while (cursor)
    }
    const excluded = new Set<string>()
    for (const group of await ctx.swipes.listForSession(session.id)) {
      for (const candidate of group.candidates) {
        if (candidate.headNodeId && !sourcePath.has(candidate.headNodeId))
          candidate.runIds.forEach(id => excluded.add(id))
      }
    }
    for (const entry of agentPage.entries) {
      if (!entry.runId || entry.entry.kind !== 'run-state') continue
      const source = entry.entry.recovery?.narrativeSource
      if (!isRecord(source)) continue
      const adoptedSource = source.cursorNodeId ?? source.nodeId
      if (typeof adoptedSource === 'string' && !sourcePath.has(adoptedSource)) excluded.add(entry.runId)
    }
    agentPage.entries = agentPage.entries.filter(entry => !entry.runId || !excluded.has(entry.runId))
  }
  return agentPage
}

async function prepareAgentTurn(
  ctx: AgentsRuntimeContext,
  input: {
    agentSessionId: string
    input: string
    attachments?: import('@loom-studio/shared').ChatAttachment[]
    interjectionRequestId?: string
    resume?: boolean
    activationFacts?: ActivationFacts
    contextMode?: InvokeAgentTurnInput['contextMode']
    narrativeTarget?: InvokeAgentTurnInput['narrativeTarget']
    macroSelections?: import('@loom-studio/shared').MacroSelectionMap
    promptAddition?: InvokeAgentTurnInput['promptAddition']
  },
  mode: 'preview' | 'runtime',
  requestContext?: RuntimeRequestContext,
  invocationRunId?: string,
  summarySource?: SummaryPlan['boundary']['narrative'],
) {
  const buildId = ctx.createId('build')
  const runId = invocationRunId ?? requestContext?.agentRun?.runId ?? ctx.createId('run')
  const observation: ObservationBuild = {}
  const startedAt = performance.now()
  ctx.observations.capture(() => ctx.observations.write({
    id: buildId, kind: 'build', ...(invocationRunId ? { parentId: invocationRunId } : {}),
    title: mode === 'preview' ? 'Prompt Preview' : 'Prompt Build', status: 'running',
    agentSessionId: input.agentSessionId, timelineId: input.narrativeTarget?.timelineId,
    origin: observationOrigin(requestContext),
  }))
  try {
    const prepared = await prepareAgentTurnContent(ctx, input, mode, requestContext, runId, summarySource, buildId, observation)
    ctx.observations.capture(() => {
      for (const variable of observation.variables ?? []) {
        const selected = prepared.macroInspection.entries.find(entry => entry.name.toLowerCase() === variable.name.toLowerCase())
        if (selected?.selectedSourceId) variable.source = [variable.source, selected.selectedSourceId, selected.selectedOptionId].filter(Boolean).join(' · ')
      }
    })
    ctx.observations.capture(() => ctx.observations.patch(buildId, {
      availability: observation.diagnostics?.some(item => item && typeof item === 'object' && 'code' in item && String(item.code).startsWith('observation.')) ? 'partial' : 'recorded',
      agentPresetId: prepared.preset.id, title: prepared.preset.rootNode.label || 'Prompt Build', status: 'completed',
      timelineId: prepared.narrativePage?.timeline.id ?? prepared.session.timelineId,
      branchId: prepared.narrativePage?.branch.id, durationMs: readDurationMs(startedAt),
      build: { ...observation, messages: prepared.agentStepMessages },
    }))
    return prepared
  } catch (error) {
    ctx.observations.capture(() => ctx.observations.patch(buildId, {
      status: requestContext?.abortSignal?.aborted ? 'aborted' : 'failed',
      durationMs: readDurationMs(startedAt), availability: 'partial',
      diagnostic: error instanceof Error ? error.message : String(error), build: observation,
    }))
    throw error
  }
}

async function prepareAgentTurnContent(
  ctx: AgentsRuntimeContext,
  input: {
    agentSessionId: string
    input: string
    attachments?: import('@loom-studio/shared').ChatAttachment[]
    interjectionRequestId?: string
    resume?: boolean
    activationFacts?: ActivationFacts
    contextMode?: InvokeAgentTurnInput['contextMode']
    narrativeTarget?: InvokeAgentTurnInput['narrativeTarget']
    macroSelections?: import('@loom-studio/shared').MacroSelectionMap
    promptAddition?: InvokeAgentTurnInput['promptAddition']
  },
  mode: 'preview' | 'runtime',
  requestContext: RuntimeRequestContext | undefined,
  runId: string,
  summarySource: SummaryPlan['boundary']['narrative'] | undefined,
  buildId: string,
  observation: ObservationBuild,
) {
  if (!ctx.agents) throw new Error('Agent Store is not configured')
  const session = await ctx.agents.getSession(input.agentSessionId)
  if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
  const isolated = input.contextMode === 'isolated'
  if (isolated && input.narrativeTarget) throw new Error('Isolated Agent turns cannot target Narrative')
  const boundTimeline = isolated && session.timelineId ? await ctx.narratives?.getTimeline(session.timelineId) : undefined
  if (isolated && session.timelineId && (!boundTimeline || boundTimeline.deletedAt)) throw new Error('Agent Session Timeline is unavailable')
  // A bound session supplies its default Narrative target; explicit cross-timeline
  // targets are rejected here so PromptBuild and Tool execution cannot diverge.
  if (session.timelineId && input.narrativeTarget && session.timelineId !== input.narrativeTarget.timelineId) {
    throw new Error('Narrative target does not match the Agent Session timeline binding')
  }
  const narrativeTarget: { timelineId: string; branchId?: string } | undefined = isolated ? undefined : input.narrativeTarget
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
  if (session.kind === 'timeline' && narrativePage && narrativePage.branch.id !== narrativePage.timeline.activeBranchId)
    throw new Error('Select this branch before running its Timeline Session')
  const continuation = requestContext?.agentRun?.continuation
  const recoveredSource = continuation?.recovery?.narrativeSource
  const narrativeSource = recoveredSource ? structuredClone(recoveredSource) : narrativePage
    ? await captureNarrativeExecutionSource(ctx, {
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
        sourceNodeId: input.narrativeTarget?.sourceNodeId,
      })
    : undefined
  if (recoveredSource && (recoveredSource.timelineId !== narrativePage?.timeline.id || recoveredSource.branchId !== narrativePage?.branch.id)) {
    throw Object.assign(new Error('The recovered Narrative source does not match the Agent turn target'), {
      code: 'narrative.swipe_source_changed',
    })
  }
  if (recoveredSource) await assertNarrativeExecutionSource(ctx, narrativeSource!)
  if (!continuation && narrativeSource && narrativeSource.nodeId !== narrativePage!.branch.headNodeId) {
    throw Object.assign(new Error('Narrative head changed while preparing the Agent turn; retry with the current reply'), {
      code: 'narrative.swipe_source_changed',
    })
  }
  const inputNodeId = input.narrativeTarget?.inputNodeId
  const initialReceipt = input.interjectionRequestId ? (await requireAgents(ctx).listEntries(session.id))
    .find(entry => entry.entry.kind === 'user-interjection' && entry.entry.requestId === input.interjectionRequestId)?.entry : undefined
  const narrativeInput = Boolean(inputNodeId || initialReceipt?.kind === 'user-interjection' && initialReceipt.mode === 'narrative')
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
  const savedInputEntry = inputPage?.nodes[0]?.entryId ? await requireAgents(ctx).getEntry(inputPage.nodes[0].entryId!) : undefined
  const attachments = await validateMessageAttachments(ctx.mediaAssets, savedInputEntry?.entry.kind === 'message' ? savedInputEntry.entry.attachments : input.attachments)
  if (userInput.trim().length === 0 && !attachments.length && !requestContext?.agentRun?.continuation) throw new Error('Agent turn input cannot be empty')
  const narrativeContext = narrativePage
    ? await ctx.narrativeContext.resolve({
      timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id,
      cardId: narrativePage.timeline.createdFrom?.cardId,
    })
    : undefined
  // ponytail: Unmigrated hosts still use recent-100 until the official memory provider is installed.
  const narrativeSample = session.kind !== 'timeline' && !narrativeContext && narrativePage?.branch.headNodeId && narratives
    ? await createNarrativeSampler(narratives).sample({
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
        selection: { kind: 'tail', count: 100, throughNodeId: narrativePage.branch.headNodeId },
      })
    : undefined
  if (narrativeSample && !narrativeSample.complete) {
    throw new Error('Default Narrative window exceeds the sample budget; an explicit smaller range is required')
  }
  let narrativeNodes = session.kind === 'timeline' ? [] : narrativeContext && narrativePage && narratives
    ? await readNarrativeContext(narratives, { timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id }, narrativeContext)
    : narrativeSample?.nodes ?? []
  const summaryThroughNodeId = summarySource?.nodeId
  if (summaryThroughNodeId !== undefined && narratives) {
    const allowed = new Set<string>()
    let id = summaryThroughNodeId
    while (id) {
      allowed.add(id)
      id = (await narratives.getNode(id))?.parentNodeId ?? null
    }
    narrativeNodes = narrativeNodes.filter(node => allowed.has(node.id))
  }
  const agentPage = isolated ? await readSessionHistory(requireAgents(ctx), session.id)
    : await readActiveSessionHistory(ctx, session, narrativePage)
  const preset = await readPresetResource(ctx.promptResources, requireSessionPreset(session))
  let promptEntries = (preset.historyPolicy ?? 'persistent') === 'persistent' ? agentPage.entries : []
  if (session.kind === 'timeline' && narrativePage && narratives) {
    // Plot and work summaries retire different sources. Recover every story message
    // after the plot coverage even when its work segment has already been retired.
    const covered = narrativeContext?.memory?.coveredThroughNodeId
    const raw: NarrativeNode[] = []
    let cursor = narrativePage.branch.headNodeId
    while (cursor && cursor !== covered) {
      const node = await narratives.getNode(cursor)
      if (!node) throw new Error(`Narrative projection reference is missing: ${cursor}`)
      raw.push(node)
      cursor = node.parentNodeId
    }
    if (covered && cursor !== covered) throw new Error('Plot summary source is not on the adopted Timeline path')
    narrativeNodes = raw.reverse().filter(node => node.id !== inputNodeId)
    if (summaryThroughNodeId !== undefined) {
      const boundary = narrativeNodes.findIndex(node => node.id === summaryThroughNodeId)
      narrativeNodes = summaryThroughNodeId === null ? [] : narrativeNodes.slice(0, boundary + 1)
    }
    const storyEntries = await Promise.all(narrativeNodes.map(async node => {
      if (!node.entryId) throw new Error(`Narrative node has no canonical message: ${node.id}`)
      const entry = await requireAgents(ctx).getEntry(node.entryId)
      if (!entry || entry.entry.kind !== 'message') throw new Error(`Narrative message is missing: ${node.entryId}`)
      return entry
    }))
    const selected = new Set(storyEntries.map(entry => entry.id))
    promptEntries = [...new Map([...promptEntries.filter(entry => entry.id !== inputPage?.nodes[0]?.entryId
      && (entry.entry.kind !== 'message' || entry.entry.purpose !== 'narrative' || selected.has(entry.id))),
      ...storyEntries].map(entry => [entry.id, entry])).values()].sort((a, b) => a.sequence - b.sequence)
    const byId = new Map(promptEntries.map(entry => [entry.id, entry]))
    const fragments = new Set<string>()
    for (const entry of promptEntries) {
      if (entry.entry.kind !== 'message' || entry.entry.state === 'partial') continue
      let previous = entry.entry.continuesEntryId
      while (previous && !fragments.has(previous)) {
        fragments.add(previous)
        const fragment = byId.get(previous)?.entry
        previous = fragment?.kind === 'message' ? fragment.continuesEntryId : undefined
      }
    }
    promptEntries = promptEntries.filter(entry => !fragments.has(entry.id))
  } else {
    const retainedRuns = new Set(promptEntries.flatMap(entry => entry.runId ? [entry.runId] : []))
    const retainedInputs = new Set<string>()
    for (const entry of promptEntries) {
      if (entry.entry.kind !== 'run-state') continue
      const request = entry.entry.recovery?.request
      const target = isRecord(request) ? request.narrativeTarget : undefined
      if (isRecord(target) && typeof target.inputNodeId === 'string') retainedInputs.add(target.inputNodeId)
    }
    narrativeNodes = narrativeNodes.filter(node => node.id !== inputNodeId && !retainedInputs.has(node.id)
      && !(node.source?.runId && retainedRuns.has(node.source.runId)))
  }
  const availableInstallations = await readAvailableExtensionInstallations(
    ctx.documents, (boundTimeline ?? narrativePage?.timeline)?.createdFrom?.cardId, (boundTimeline ?? narrativePage?.timeline)?.id ?? null,
  )
  if (!isExtensionResourceAvailable(preset.origin, availableInstallations)) {
    throw new Error(`Agent Preset is not available in this context: ${preset.id}`)
  }
  // Resume keeps accepted messages and tool outcomes, but uses the current model binding.
  const model = preset.model
  if (!model) throw new Error(`Agent Preset has no model binding: ${preset.id}`)
  if (requestContext?.agentRun?.continuation?.recovery) await assertProviderModelExists(ctx.documents, model)
  let toolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: preset.id })
  if (session.kind === 'timeline') {
    toolMounts = toolMounts.filter(mount => mount.toolId !== 'official/append_narrative' && mount.toolId !== 'official/declare_narrative')
    if ((session.narrativeMode ?? 'declared') === 'declared') toolMounts.push({
      id: `timeline-declaration:${session.id}`, presetResourceId: preset.id,
      toolId: 'official/declare_narrative', defaultEnabled: true, orderIndex: toolMounts.length, origin: {}, createdAt: session.createdAt,
    })
  }
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
  let prompt: Awaited<ReturnType<typeof composeAgentTurnPrompt>>
  let compiledToolSet
  let timelineState = narrativePage
    ? await getApplicationStateSnapshot(ctx, {
        scope: 'timeline',
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
      })
    : undefined
  if (timelineState && summarySource?.stateRevisionId) {
    const revision = await ctx.states.getRevision(summarySource.stateRevisionId)
    if (!revision || revision.scopeId !== timelineState.scopeId) throw new Error('Summary State source is unavailable')
    timelineState = { ...timelineState, revisionId: revision.id, value: structuredClone(revision.snapshot), createdAt: revision.createdAt }
  }
  const timelineRuntimeContext = narrativePage
    ? await readTimelineRuntimeContext(ctx, narrativePage.timeline.id)
    : undefined
  const cardId = (narrativePage?.timeline ?? boundTimeline)?.createdFrom?.cardId
  const cardDocument = cardId ? await ctx.documents.get(cardId) : null
  if (cardDocument && cardDocument.type !== applicationDocumentTypes.cardSource) throw new Error(`Unexpected Card document type: ${cardId}`)
  const card = cardDocument?.content as CardSourceContent | undefined
  const variables = isolated ? createVariableRenderContext() : await readAgentTurnVariables(
    ctx,
    timelineState?.value,
    card?.name ?? timelineRuntimeContext?.cardName,
    hasPlayerProfile(timelineRuntimeContext),
  )
  const macroSelections = input.macroSelections !== undefined
    ? normalizeMacroSelections(input.macroSelections)
    : narrativePage ? (await readTimelinePresetConfig(ctx.documents, narrativePage.timeline.id, preset.id)).macroSelections : undefined
  const macroInspection = await inspectPreparedMacros({
    ...(narrativePage ? { timelineTarget: { timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id } } : {}),
    ctx,
    variables,
    cardId,
    cardLabel: card?.name,
    presetId: preset.id,
    presetLabel: preset.rootNode.label,
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
      cardId,
      availableExtensionInstallations: availableInstallations,
      ctx,
      model,
      toolMounts,
      variables: inspectedVariables,
      currentInput: userInput,
      activationFacts: input.activationFacts,
    })
    const runtimeInputs = createContentToolPromptRuntimeInputs(compiledToolSet)
    if (session.kind === 'timeline') {
      const id = 'runtime.timeline.output-contract'
      runtimeInputs.sourceNodes.push({ id, sourceId: session.id, parentId: null,
        displayName: 'Timeline output contract', orderIndex: 0, kind: 'virtual' })
      runtimeInputs.contributions.push({ id, sourceRef: { kind: 'runtime', sourceId: session.id, sourceNodeId: id },
        content: (session.narrativeMode ?? 'declared') === 'automatic'
          ? narrativeInput ? '当前为扮演的自动正文模式：每条普通 Assistant 文本都会成为剧情正文。工具调用、工具结果和 reasoning 属于工作过程。'
            : '当前为指导与讨论：普通 Assistant 回复是工作记录，不会自动成为剧情。需要修订正文时使用编辑能力。'
          : '当前为声明式写作模式：declare_narrative 仅声明下一条普通 Assistant 文本为正文。正文之后可以继续工具工作；未声明的普通回复结束执行。讨论与指导不自动成为正文。',
        capabilities: { targetAnchorId: '@tools.dynamic', localDepth: 0, roleHint: 'system' },
      })
    }
    const workspace = narrativePage ? await ctx.workspaces.get(narrativePage.branch.workspaceHeadRevisionId) : undefined
    const sharedMemory = workspace?.entries.find(entry => !entry.parentId && entry.name === 'MEMORY.md')
    prompt = await composeAgentTurnPrompt({
      observation,
      ...(summaryThroughNodeId === undefined && sharedMemory?.kind === 'file' && 'text' in sharedMemory.content
        ? { workspaceMemory: sharedMemory.content.text } : {}),
      availableExtensionInstallations: availableInstallations,
      activationFacts: input.activationFacts,
      variables: inspectedVariables,
      agentMessages: promptEntries,
      promptResources: ctx.promptResources,
      contextResourceIds: preset.useCardLore === false ? [] : card?.promptResourceIds ?? [],
      narrative: narrativePage ? {
        nodes: narrativeNodes,
        unified: session.kind === 'timeline',
        timeline: narrativePage.timeline,
        branchId: narrativePage.branch.id,
        context: session.kind === 'timeline' && narrativeContext ? { ...narrativeContext, rawThroughNodeId: narrativePage.branch.headNodeId ?? null } : narrativeContext,
      } : undefined,
      preset,
      userInput,
      attachments,
      buildId,
      runId,
      agentSessionId: session.id,
      historyRules: {
        session: sessionTextPipeline.rules,
        narrative: narrativeTextPipeline?.rules ?? [],
      },
      externalRuntime: runtimeInputs,
      promptAddition: input.promptAddition,
      processing: {
        registry: ctx.promptProcessors,
        context: {
          mode,
          signal: requestContext?.abortSignal ?? new AbortController().signal,
          ...(cardId ? { cardId } : {}),
          ...(timelineState && narrativePage ? { timeline: {
            timelineId: narrativePage.timeline.id,
            branchId: narrativePage.branch.id,
            revisionId: timelineState.revisionId,
            value: timelineState.value,
          } } : {}),
        },
      },
      resumeMessages: requestContext?.agentRun?.continuation?.messages,
      resumeProcessingSnapshot: requestContext?.agentRun?.continuation?.recovery?.processedPrompt,
    })
    prompt.promptBuildTrace.diagnostics.push(...(compiledToolSet.trace.diagnostics ?? []))
    for (const diagnostic of [...sessionTextPipeline.diagnostics, ...(narrativeTextPipeline?.diagnostics ?? [])]) {
      prompt.promptBuildTrace.diagnostics.push({
        severity: 'warning',
        code: diagnostic.code,
        message: diagnostic.message,
      })
    }
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
    prompt.toolExecutionScope = await createAgentToolScope(ctx, {
      base: prompt.toolExecutionScope,
      presetId: preset.id,
      approvalPolicy: preset.approvalPolicy,
      sessionId: session.id,
      runId,
      ...(narrativePage ? { narrative: { page: narrativePage, rules: narrativeTextPipeline!.rules } } : {}),
      narrativeSource,
      requestContext,
    })
    const attachmentHistory = branchTranscriptEntries(await requireAgents(ctx).listEntries(session.id), session.kind === 'timeline' ? narrativePage?.branch.headEntryId : session.headEntryId)
    mountMessageAttachments(prompt.toolExecutionScope, ctx.mediaAssets,
      [...attachmentHistory.flatMap(entry => entry.entry.kind === 'message' ? entry.entry.attachments ?? [] : []),
        ...(requestContext?.agentRun?.continuation?.messages.flatMap(message => message.role === 'user' ? message.attachments ?? [] : []) ?? []), ...attachments],
      compiledToolSet.tools.some(tool => tool.definition.id === 'official/codeact' || tool.definition.id === 'official/codeact_json'))
    if (isolated) {
      delete prompt.toolExecutionScope.state
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
  const prepared = {
    classificationRules: (await resolveEffectiveTextPipeline(ctx,
      { kind: 'agent-session', sessionId: session.id }, 'classify')).rules,
    userInput,
    attachments,
    preset,
    model,
    tokenMultiplier: model
      ? (await readDocument<ProviderProfileContent>(ctx.documents, model.providerProfileId,
          applicationDocumentTypes.providerProfile)).content.tokenMultipliers?.[model.modelId] ?? 1
      : 1,
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
  if (narrativeSource) await assertNarrativeExecutionSource(ctx, narrativeSource)
  return prepared
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

function requireSessionPreset(session: AgentSession): string {
  if (!session.agentPresetId) throw new Error('Choose a Preset before starting this Timeline Session')
  return session.agentPresetId
}

async function activeTimelineBranch(ctx: AgentsRuntimeContext, sessionId: string): Promise<string | undefined> {
  const session = await requireAgents(ctx).getSession(sessionId)
  return session?.kind === 'timeline' ? (await ctx.narratives?.getTimeline(sessionId))?.activeBranchId : undefined
}

export function assertAgentSessionNotExecuting(ctx: object, sessionId: string): void {
  if (executingSessions.get(ctx)?.has(sessionId)) throw new Error('Finish the active Agent turn before switching its adopted history')
}
