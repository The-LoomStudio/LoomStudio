import { listDocuments } from '../foundation/document-store.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { CardSourceContent } from '../types.js'
import { decideAgentApproval, mutationApprovalScope, parseAgentApprovalPolicy, type AgentApprovalPolicy } from './approval-policy.js'
import { createWorkspaceRuntimeMethods } from '../runtime/workspace-runtime.js'
import type { VfsEntry } from '../vfs/types.js'
import type { NarrativePage, PromptResourceNodeDraft, PromptResourceNodePatch, PromptResourceTreeNode } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { RuntimeRequestContext, StateMutationOperation } from '../types.js'
import type { TextTransformRuleEntry } from '../transforms/history-text.js'
import type { ToolExecutionScope } from './tool-registry.js'
import { listPresetScriptAttachments } from '../vfs/script-attachments.js'
import { createNarrativeReader } from '../narrative/access.js'
import { projectNarrativeSample } from '../narrative/projection.js'
import { isExtensionResourceAvailable, readAvailableExtensionInstallations } from '../runtime/extension-resource-access.js'
import { createPromptRuntimeMethods } from '../runtime/prompt-runtime.js'
import { narrativeWriteContext, promptResourceWriteContext } from '../runtime/context.js'
import { getApplicationStateSnapshot, applyApplicationStateMutation } from '../state/state.js'
import { assertNarrativeExecutionSource, guardNarrativeWrite, type NarrativeExecutionSource } from '../runtime/swipe-runtime.js'

type AgentToolScopeContext = Pick<ApplicationRuntimeContext,
  'agentTools' | 'blobs' | 'createId' | 'dataEngine' | 'documents' | 'narratives'
  | 'extensionReadonlyFiles' | 'workspaces' | 'narrativeContext' | 'now' | 'promptResources' | 'states' | 'swipes'
>

/** Bind tool I/O to the prepared turn without making PromptBuild own mutation implementations. */
export async function createAgentToolScope(ctx: AgentToolScopeContext, input: {
  base: ToolExecutionScope
  presetId: string
  approvalPolicy?: AgentApprovalPolicy
  sessionId: string
  runId: string
  narrative?: { page: NarrativePage; rules: TextTransformRuleEntry[] }
  narrativeSource?: NarrativeExecutionSource
  requestContext?: RuntimeRequestContext
}): Promise<ToolExecutionScope> {
  const { presetId, sessionId, runId, narrative, requestContext } = input
  const narratives = ctx.narratives
  const scope: ToolExecutionScope = { ...input.base }
  if (narrative) {
    requestContext?.abortSignal?.throwIfAborted()
    const files = await ctx.extensionReadonlyFiles.resolve({
      timelineId: narrative.page.timeline.id, branchId: narrative.page.branch.id,
    }, narrative.page.timeline.createdFrom?.cardId)
    requestContext?.abortSignal?.throwIfAborted()
    scope.vfs = [...(scope.vfs ?? []), ...files]
  }
  scope.narrativeSource = input.narrativeSource
  const assertSource = async () => {
    if (input.narrativeSource) await assertNarrativeExecutionSource(ctx, input.narrativeSource)
  }
  const writeSource = <T>(work: () => T): T => input.narrativeSource
    ? guardNarrativeWrite(ctx, input.narrativeSource, work) : work()
  scope.assertNarrativeSource = assertSource
  scope.withNarrativeWrite = writeSource
  scope.globalResourceCatalog = async () => {
    const cards = await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource)
    const resources = new Map<string, string[]>()
    for (const card of cards) {
      const installations = await readAvailableExtensionInstallations(ctx.documents, card.id)
      for (const id of card.content.promptResourceIds ?? []) {
        const resource = await ctx.promptResources.getResource(id)
        if (!resource || resource.tombstoned || !['preset', 'lore'].includes(resource.resourceKind) || !isExtensionResourceAvailable(resource.metadata.origin, installations)) continue
        const owners = resources.get(id) ?? []
        owners.push(`${card.content.name} (${card.id})`)
        resources.set(id, owners)
      }
    }
    return [...resources].map(([id, owners]) => ({ id, owners }))
  }
  scope.vfsAttachments = () => listPresetScriptAttachments(ctx, presetId, scope.availableExtensionInstallations)
  const policy = parseAgentApprovalPolicy(input.approvalPolicy)
  const mutationHandler = requestContext?.agentRun?.onMutationApproval
  if (mutationHandler || policy) scope.approveMutation = async (preview, signal) => {
    signal.throwIfAborted()
    const approvalScope = mutationApprovalScope(preview)
    const effectivePolicy = preview.authorScope === 'global' && policy?.[approvalScope] !== 'deny' ? { ...policy, [approvalScope]: 'ask' as const } : policy
    const decision = await decideAgentApproval(effectivePolicy, mutationApprovalScope(preview), mutationHandler ? () => mutationHandler(preview, signal) : undefined)
    scope.observeToolEvent?.({ kind: 'mutation-approval', preview, decision, mode: effectivePolicy?.[mutationApprovalScope(preview)] ?? 'ask' })
    return decision
  }
  const historyHandler = requestContext?.agentRun?.onHistoryReadApproval
  if (historyHandler || policy) scope.requestHistoryApproval = async (action, signal) => {
    signal?.throwIfAborted()
    const decision = await decideAgentApproval(policy, 'historyRead', historyHandler ? () => historyHandler(action, signal) : undefined)
    scope.observeToolEvent?.({ kind: 'history-approval', action, decision, mode: policy?.historyRead ?? 'ask' })
    return decision
  }
  const allowedTimelineTarget = narrative?.page
    ? { scope: 'timeline' as const, timelineId: narrative.page.timeline.id, branchId: narrative.page.branch.id }
    : undefined
  if (allowedTimelineTarget) {
    const workspace = createWorkspaceRuntimeMethods(ctx)
    scope.workspace = {
      snapshot: async () => {
        await assertSource()
        const revision = await workspace.getTimelineWorkspace(allowedTimelineTarget)
        await assertSource()
        const entries: VfsEntry[] = [{ path: '/workspace', kind: 'directory', binding: { kind: 'workspace', revisionId: revision.id, entryId: '' } }]
        const byId = new Map(revision.entries.map(entry => [entry.id, entry]))
        const pathOf = (entry: typeof revision.entries[number]): string => entry.parentId ? `${pathOf(byId.get(entry.parentId)!)}/${entry.name}` : `/workspace/${entry.name}`
        for (const entry of revision.entries) entries.push({ path: pathOf(entry), kind: entry.kind,
          binding: { kind: 'workspace', revisionId: revision.id, entryId: entry.id },
          ...(entry.kind === 'file' ? 'text' in entry.content ? { content: entry.content.text } : { state: 'locked' as const } : {}),
        })
        return entries
      },
      mutate: async (expectedRevisionId, operations) => {
        const result = await writeSource(() => workspace.mutateTimelineWorkspace({ ...allowedTimelineTarget, expectedRevisionId, operations }, requestContext))
        scope.observeToolEvent?.({ kind: 'workspace-commit', changesetId: result.mutation.changesetId })
        return { changesetId: result.mutation.changesetId }
      },
    }
  }
  scope.state = {
    defaultTarget: allowedTimelineTarget ?? { scope: 'global' as const },
    canAccess: target => target.scope === 'global'
      || (allowedTimelineTarget !== undefined
        && target.timelineId === allowedTimelineTarget.timelineId
        && target.branchId === allowedTimelineTarget.branchId),
    read: async target => {
      if (target.scope === 'timeline') await assertSource()
      const snapshot = await getApplicationStateSnapshot(ctx, target)
      if (target.scope === 'timeline') await assertSource()
      return { revisionId: snapshot.revisionId, value: snapshot.value }
    },
    update: async stateInput => {
      const result = await writeSource(() => applyApplicationStateMutation(ctx, {
        target: stateInput.target,
        expectedRevisionId: stateInput.expectedRevisionId,
        operations: stateInput.operations as unknown as StateMutationOperation[],
        idempotencyKey: stateInput.idempotencyKey,
      }, requestContext))
      scope.observeToolEvent?.({ kind: 'state-commit', revisionId: result.snapshot.revisionId, changesetId: result.mutation.changesetId })
      return { revisionId: result.snapshot.revisionId }
    },
    write: async stateInput => {
      if (!stateInput.pointer)
        throw Object.assign(new Error('Write a State property under /state/data, not the complete State snapshot.'), { code: 'vfs.write_unsupported' })
      const result = await writeSource(() => applyApplicationStateMutation(ctx, {
        target: stateInput.target,
        expectedRevisionId: stateInput.expectedRevisionId,
        operations: [{ op: 'set', path: stateInput.pointer, value: stateInput.value }],
        idempotencyKey: stateInput.idempotencyKey,
      }, requestContext))
      scope.observeToolEvent?.({ kind: 'state-commit', revisionId: result.snapshot.revisionId, changesetId: result.mutation.changesetId })
      return {
        revisionId: result.snapshot.revisionId,
        changesetId: result.mutation.changesetId,
      }
    },
  }
  scope.mutatePromptResource = async resourceInput => {
    const resource = await ctx.promptResources.getResource(resourceInput.resourceId)
    if (!resource) throw new Error(`Prompt Resource not found: ${resourceInput.resourceId}`)
    if (!isExtensionResourceAvailable(resource.metadata.origin, scope.availableExtensionInstallations)) {
      throw new Error(`Prompt Resource is not available in this context: ${resourceInput.resourceId}`)
    }
    const result = await ctx.promptResources.mutateResource({
      ...resourceInput,
      ...promptResourceWriteContext(requestContext),
      reason: 'application.tool.updatePromptResource',
    })
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', resourceId: result.resource.id, version: result.resource.version, changesetId: result.commit.changesetId })
    return {
      id: result.resource.id,
      version: result.resource.version,
      changesetId: result.commit.changesetId,
    }
  }
  scope.writePromptResource = async input => {
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
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', resourceId: result.resource.id, version: result.resource.version, changesetId: result.commit.changesetId })
    return { version: result.resource.version, changesetId: result.commit.changesetId }
  }
  scope.configurePromptResource = async input => {
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
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', resourceId: result.resource.id, version: result.resource.version, changesetId: result.commit.changesetId })
    return { version: result.resource.version, changesetId: result.commit.changesetId }
  }
  scope.movePromptResource = async input => {
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
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', resourceId: result.resource.id, version: result.resource.version, changesetId: result.commit.changesetId })
    return { version: result.resource.version, changesetId: result.commit.changesetId }
  }
  scope.deletePromptResourceNode = async input => {
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
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', resourceId: result.resource.id, version: result.resource.version, changesetId: result.commit.changesetId })
    return { version: result.resource.version, changesetId: result.commit.changesetId }
  }
  scope.createPromptResourceNode = async input => {
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
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', nodeId, version: result.resource.version, changesetId: result.commit.changesetId })
    return { nodeId, version: result.resource.version, changesetId: result.commit.changesetId }
  }
  scope.copyPromptResourceNode = async input => {
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
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', nodeId, version: result.resource.version, changesetId: result.commit.changesetId })
    return { nodeId, nodeCount, version: result.resource.version, changesetId: result.commit.changesetId }
  }
  scope.duplicatePromptResource = async input => {
    const source = await ctx.promptResources.getResource(input.resourceId)
    if (!source)
      throw Object.assign(new Error(`Prompt Resource not found: ${input.resourceId}`), { code: 'vfs.not_found' })
    if (source.version !== input.expectedVersion)
      throw Object.assign(new Error('Prompt Resource changed after it was read. Read it again before copying the resource.'), { code: 'vfs.baseline_changed' })
    const duplicate = await createPromptRuntimeMethods(ctx).duplicatePromptResource({
      resourceId: input.resourceId,
      ...(input.name === undefined ? {} : { name: input.name }),
    }, requestContext)
    scope.observeToolEvent?.({ kind: 'prompt-resource-commit', resourceId: duplicate.resource.id, version: duplicate.resource.version, changesetId: duplicate.mutation.changesetId })
    return {
      resourceId: duplicate.resource.id,
      label: duplicate.resource.rootNode.label,
      version: duplicate.resource.version,
      changesetId: duplicate.mutation.changesetId,
    }
  }
  if (narrative && narratives) {
    const narrativeReader = createNarrativeReader({
      store: narratives, context: ctx.narrativeContext,
      timelineId: narrative.page.timeline.id, branchId: narrative.page.branch.id,
      cardId: narrative.page.timeline.createdFrom?.cardId,
    })
    scope.narrative = {
      timelineId: narrative.page.timeline.id,
      branchId: narrative.page.branch.id,
      sample: async (input, signal, approveHistory) => {
        await assertSource()
        const sample = await narrativeReader.sample(input, signal, approveHistory)
        await assertSource()
        if (input.view !== 'prompt') return sample
        return projectNarrativeSample(sample, {
          phase: 'prompt', rules: narrative.rules,
          maxNodes: input.maxNodes, maxCharacters: input.maxCharacters,
        })
      },
      appendNode: async ({ content }) => writeSource(async () => {
        await assertSource()
        const currentBranch = await narratives.getBranch(narrative.page.branch.id)
        if (!currentBranch) throw new Error(`Narrative branch not found: ${narrative.page.branch.id}`)
        const result = await narratives.appendNode({
          ...narrativeWriteContext(requestContext, 'application.tool.appendNarrative'),
          timelineId: narrative.page.timeline.id,
          branchId: narrative.page.branch.id,
          expectedHeadNodeId: currentBranch.headNodeId ?? null,
          stateRevisionId: currentBranch.stateHeadRevisionId,
          body: { format: 'loom-markdown.v1', raw: content },
          source: {
            agentSessionId: sessionId,
            runId,
          },
        })
        if (input.narrativeSource) input.narrativeSource.cursorNodeId = result.node.id
        scope.observeToolEvent?.({ kind: 'narrative-commit', nodeId: result.node.id, changesetId: result.commit.changesetId })
        return { nodeId: result.node.id, floor: result.node.floor }
      }),
      editNode: async ({ nodeId: requestedNodeId, floor, content, expectedRaw }) => writeSource(async () => {
        await assertSource()
        const branch = await narratives.getBranch(narrative.page.branch.id)
        let nodeId = requestedNodeId
        if (floor !== undefined) {
          let cursor = branch?.headNodeId
          while (cursor) {
            const page = await narratives.getPage({ timelineId: narrative.page.timeline.id, branchId: narrative.page.branch.id, cursor, limit: 100 })
            nodeId = page.nodes.find(node => node.floor === floor)?.id
            if (nodeId) break
            cursor = page.nextCursor
          }
          if (!nodeId) throw new Error(`Narrative floor ${floor} is unavailable on this path`)
        }
        const target = nodeId ? await narratives.getNode(nodeId) : undefined
        if (!branch?.headNodeId || !nodeId || !target || target.timelineId !== narrative.page.timeline.id) {
          throw new Error(`Narrative node ${nodeId} is not editable from branch ${narrative.page.branch.id}`)
        }
        const expectedHeadNodeId = branch.headNodeId
        const result = await ctx.dataEngine.transact(
          narrativeWriteContext(requestContext, 'application.tool.editNarrative'),
          async dataTx => {
            const edited = narratives.transaction(dataTx).editBranchNode({
              ...(sessionId === narrative.page.timeline.id ? { executionRunId: runId } : {}),
              timelineId: narrative.page.timeline.id,
              branchId: narrative.page.branch.id,
              nodeId,
              expectedHeadNodeId,
              expectedBody: expectedRaw === undefined ? target.body : { ...target.body, raw: expectedRaw },
              body: { format: 'loom-markdown.v1', raw: content },
            })
            return { nodeId: edited.replacements[0]!.node.id, headNodeId: edited.branch.headNodeId }
          },
        )
        if (input.narrativeSource) input.narrativeSource.cursorNodeId = result.value.headNodeId
        scope.observeToolEvent?.({ kind: 'narrative-commit', nodeId: result.value.nodeId, changesetId: result.commit.changesetId })
        return { nodeId: result.value.nodeId, floor: target.floor }
      }),
    }
  }
  return scope
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
