import { createHash } from 'node:crypto'
import { createExtensionRecordArchiveParticipant } from './extension-record-archive.js'
import { createExtensionAgentTasks } from './extension-agent-tasks.js'
import { createExtensionNarrativeReader } from './extension-narrative-reader.js'
import {
  applicationDocumentTypes,
  type createApplicationRuntime,
  type createDocumentBackedAiGateway,
  type createDocumentBackedProfiledAiGateway,
  type createOfficialAgentToolRegistry,
  type createMacroProviderRegistry,
  type createPromptProcessorRegistry,
  type createStateContentRegistry,
  type createNarrativeContextRegistry,
  type createStateContributionRegistry,
  type ToolExecutionScope,
  type StateTarget,
} from '@loom-studio/application-runtime'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { createAiGatewayCapabilityRegistry } from '@loom-studio/ai-gateway'
import type { createAgentStore, createNarrativeStore, createStateStore, PromptResourceStore } from '@loom-studio/application-data'
import type { AssetStore } from '@loom-studio/asset-store'
import type { DocumentStore } from '@loom-studio/document-store'
import type { createExtensionHost } from '@loom-studio/extension-host'
import type { createKernel } from '@loom-studio/kernel'
import { createId } from '@loom-studio/shared'
import { canAccessExtensionState } from './extension-state-access.js'
import { projectExtensionEvent } from './extension-event-projection.js'

type Dependencies = {
  applicationRuntime: ReturnType<typeof createApplicationRuntime>
  assets?: AssetStore
  documents: DocumentStore
  extensionAgentTasks?: ReturnType<typeof createExtensionAgentTasks>
  agents?: ReturnType<typeof createAgentStore>
  narratives?: ReturnType<typeof createNarrativeStore>
  states?: ReturnType<typeof createStateStore>
  promptResources: PromptResourceStore
  getKernel(): ReturnType<typeof createKernel>
  aiCapabilities: ReturnType<typeof createAiGatewayCapabilityRegistry>
  profiledAiGateway: ReturnType<typeof createDocumentBackedProfiledAiGateway>
  gateway: ReturnType<typeof createDocumentBackedAiGateway>
  agentTools: ReturnType<typeof createOfficialAgentToolRegistry>
  macroProviders: ReturnType<typeof createMacroProviderRegistry>
  promptProcessors: ReturnType<typeof createPromptProcessorRegistry>
  stateContent: ReturnType<typeof createStateContentRegistry>
  narrativeContext: ReturnType<typeof createNarrativeContextRegistry>
  stateContributions: ReturnType<typeof createStateContributionRegistry>
}

type ApplicationAdapter = Pick<Parameters<typeof createExtensionHost>[0],
  | 'registerRecordArchive'
  | 'readExtensionNarrative'
  | 'validateExtensionNarrative'
  | 'subscribeNarrativeActivity'
  | 'registerReadonlyFiles'
  | 'extensionAgentTasks'
  | 'aiCapabilities'
  | 'assets'
  | 'portablePayloads'
  | 'aiGateway'
  | 'invokeModel'
  | 'buildPrompt'
  | 'registerMacroProvider'
  | 'registerPromptProcessor'
  | 'registerStateContentHandler'
  | 'registerNarrativeContextProvider'
  | 'registerStateContribution'
  | 'runTimelineWork'
  | 'beginTimelineWork'
  | 'assertTimelineWork'
  | 'canRunTimelineWork'
  | 'listTimelineTargets'
  | 'subscribeTimelineTargets'
  | 'readState'
  | 'canAccessState'
  | 'writeState'
  | 'registerAgentToolHandler'
  | 'validateStorageScope'
  | 'validateEntityRef'
  | 'callRpc'
  | 'registerRpc'
  | 'registerEventDefinition'
  | 'emitEvent'
  | 'subscribeEvents'
>


export function createExtensionApplicationAdapter({
  applicationRuntime, assets, documents, agents, narratives, states, promptResources, getKernel,
  aiCapabilities, profiledAiGateway, gateway, agentTools, macroProviders, promptProcessors,
  stateContent, narrativeContext, stateContributions, extensionAgentTasks,
}: Dependencies): ApplicationAdapter {
  const recordArchiveOwners = new Set<string>()
  const narrativeReader = narratives ? createExtensionNarrativeReader(applicationRuntime, narratives) : undefined
  const toolScopes = new AsyncLocalStorage<ToolExecutionScope>()
  const timelineScopes = new AsyncLocalStorage<Pick<ToolExecutionScope, 'narrativeSource' | 'assertNarrativeSource' | 'withNarrativeWrite'> & { target: StateTarget }>()

  function timelineToolScope(target: StateTarget): Pick<ToolExecutionScope, 'narrativeSource' | 'assertNarrativeSource' | 'withNarrativeWrite'> | undefined {
    const scope = toolScopes.getStore()
    if (target.scope === 'global') return undefined
    if (!scope) {
      const current = timelineScopes.getStore()
      if (!current) return undefined
      if (current.target.scope !== 'timeline' || target.timelineId !== current.target.timelineId || target.branchId !== current.target.branchId)
        throw new Error('State target is outside the Timeline execution Narrative target')
      return current
    }
    const allowed = scope.state?.defaultTarget
    if (allowed?.scope !== 'timeline' || target.timelineId !== allowed.timelineId || target.branchId !== allowed.branchId
      || !scope.state?.canAccess(target)) {
      throw new Error('State target is outside the Agent Tool execution Narrative target')
    }
    return scope
  }

  function sourceMetadata(source: ToolExecutionScope['narrativeSource']) {
    return source ? Object.freeze({
      timelineId: source.timelineId, branchId: source.branchId, nodeId: source.nodeId,
      groupId: source.groupId, candidateId: source.candidateId, generation: source.generation,
    }) : undefined
  }

  return {
    registerRecordArchive: (adapter, owner) => {
      if (recordArchiveOwners.has(owner.installationId)) throw new Error('An installation can register only one record archive adapter')
      const namespace = `extension.${createHash('sha256').update(`${owner.installationId}:${adapter.id}`).digest('hex')}`
      const handle = applicationRuntime.registerTimelineArchiveParticipant(createExtensionRecordArchiveParticipant({
        namespace, version: adapter.version, packageId: owner.packageId,
        ownerInstallationId: owner.target.kind === 'global' ? undefined : owner.installationId, documents, remapData: adapter.remap,
      }))
      recordArchiveOwners.add(owner.installationId)
      return { dispose() { handle.unregister(); recordArchiveOwners.delete(owner.installationId) } }
    },
    readExtensionNarrative: narrativeReader?.read,
    validateExtensionNarrative: narrativeReader?.validate,
    subscribeNarrativeActivity: applicationRuntime.subscribeNarrativeActivity,
    registerReadonlyFiles: applicationRuntime.registerReadonlyFiles,
    extensionAgentTasks: extensionAgentTasks ?? createExtensionAgentTasks({ runtime: applicationRuntime, documents }),
    assets: assets
      ? {
          publish: async input => {
            const result = await assets.createMediaAsset({
              source: input.bytes,
              kind: input.kind,
              label: input.label,
              mediaType: input.mediaType,
              width: input.width,
              height: input.height,
              ownerPackageId: input.ownerPackageId,
              ownerInstallationId: input.ownerInstallationId,
              actor: input.actor,
              reason: 'extension.asset.publish',
            })
            return {
              id: result.asset.id,
              kind: result.asset.kind,
              label: result.asset.label,
              mediaType: result.asset.mediaType,
              sizeBytes: result.asset.sizeBytes,
              width: result.asset.width,
              height: result.asset.height,
              ownerPackageId: result.asset.ownerPackageId,
              ownerInstallationId: result.asset.ownerInstallationId,
              createdAt: result.asset.createdAt,
            }
          },
          get: async assetId => {
            const asset = await assets.getMediaAsset(assetId)
            return asset
              ? {
                  id: asset.id,
                  kind: asset.kind,
                  label: asset.label,
                  mediaType: asset.mediaType,
                  sizeBytes: asset.sizeBytes,
                  width: asset.width,
                  height: asset.height,
                  ownerPackageId: asset.ownerPackageId,
                  ownerInstallationId: asset.ownerInstallationId,
                  createdAt: asset.createdAt,
                }
              : undefined
          },
          read: (assetId, readOptions) => assets.readMediaAsset(assetId, readOptions),
        }
      : undefined,
    portablePayloads: {
      create: async input => (await applicationRuntime.createPortableExtensionPayload({
        ownerInstallationId: input.ownerInstallationId,
        artifactPayloadId: input.artifactPayloadId,
        payload: { ...input.payload, packageId: input.packageId },
      }, { actor: { kind: 'extension', id: input.packageId } })).payload,
      list: async (packageId, ownerInstallationId) => (await applicationRuntime.listPortableExtensionPayloads({ packageId, ownerInstallationId: ownerInstallationId ?? null })).payloads,
      get: async payloadId => (await applicationRuntime.getPortableExtensionPayload({ payloadId })).payload,
      update: async input => (await applicationRuntime.updatePortableExtensionPayload({
        payloadId: input.payloadId,
        expectedVersion: input.expectedVersion,
        payload: { ...input.payload, packageId: input.packageId },
      }, { actor: { kind: 'extension', id: input.packageId } })).payload,
      delete: async input => {
        await applicationRuntime.deletePortableExtensionPayload({
          payloadId: input.payloadId,
          expectedVersion: input.expectedVersion,
        }, { actor: { kind: 'extension', id: input.packageId } })
      },
      replaceCardBindings: async input => {
        const [{ card }, { payloads }] = await Promise.all([
          applicationRuntime.getCard({ cardId: input.cardId }),
          applicationRuntime.listPortableExtensionPayloads({ packageId: input.packageId, ownerInstallationId: input.ownerInstallationId ?? null }),
        ])
        const ownPayloadIds = new Set(payloads.map(payload => payload.id))
        const otherPayloadIds = (card.portableExtensionPayloadIds ?? []).filter(payloadId => !ownPayloadIds.has(payloadId))
        const result = await applicationRuntime.replaceCardPortableExtensionPayloads({
          cardId: input.cardId,
          expectedVersion: input.expectedVersion,
          payloadIds: [...otherPayloadIds, ...input.payloadIds],
        }, { actor: { kind: 'extension', id: input.packageId } })
        return { cardVersion: result.card.version }
      },
    },
    aiCapabilities,
    aiGateway: profiledAiGateway,
    invokeModel: async (input, owner) => {
      if (typeof input.model?.providerProfileId !== 'string' || !input.model.providerProfileId.trim()
        || typeof input.model.modelId !== 'string' || !input.model.modelId.trim())
        throw new Error('Explicit provider profile and model are required')
      input.signal?.throwIfAborted()
      const result = await gateway.invokeChat({
        model: input.model,
        request: {
          messages: input.messages,
          ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
        },
        runId: createId('extension-model-run'),
        ...(owner ? { context: { actor: { kind: 'extension' as const, id: owner.packageId }, observationOrigin: owner } } : {}),
        sessionId: 'extension-direct',
        branchId: 'extension-direct',
        ...(input.signal ? { abortSignal: input.signal } : {}),
        ...(input.delivery ? { delivery: input.delivery } : {}),
        ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      })
      input.signal?.throwIfAborted()
      return {
        message: result.message,
        text: result.text,
        provider: result.provider,
        model: result.model,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
        ...(result.rawStopReason ? { rawFinishReason: result.rawStopReason } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.providerCallId ? { providerCallId: result.providerCallId } : {}),
        ...(result.raw ? { raw: result.raw } : {}),
      }
    },
    buildPrompt: async (input, target, packageId, lease, observation) => await applicationRuntime.buildExtensionPrompt(
      input, target, packageId, lease, { observationOrigin: observation },
    ),
    registerMacroProvider: (provider, owner) => macroProviders.register({
      ...provider,
      sourceLabel: `${owner.packageId}/${owner.moduleId}`,
    }, owner.target, owner.isAvailable),
    registerPromptProcessor: (processor, owner) => promptProcessors.register(processor, owner.target),
    registerStateContentHandler: (handler, owner) => stateContent.register(handler, owner),
    registerNarrativeContextProvider: (provider, owner) => narrativeContext.register(provider, owner.target, owner.isAvailable),
    registerStateContribution: (contribution, owner, initialize) => stateContributions.register({
      contribution,
      initialize,
      packageId: owner.packageId,
      moduleId: owner.moduleId,
      instanceId: owner.instanceId,
      packageVersion: owner.packageVersion,
      target: owner.target,
    }),
    runTimelineWork: async (input, work) => {
      const target = { scope: 'timeline' as const, timelineId: input.timelineId, branchId: input.branchId }
      const inherited = timelineToolScope(target)
      await inherited?.assertNarrativeSource?.()
      return applicationRuntime.runTimelineExtensionWork(input, async execution => {
        const bound = inherited?.narrativeSource ? inherited : execution
        await bound.assertNarrativeSource?.()
        return timelineScopes.run({ ...bound, target }, () => work({
          lease: execution.lease, signal: execution.signal, narrativeSource: sourceMetadata(bound.narrativeSource),
        }))
      })
    },
    beginTimelineWork: input => applicationRuntime.beginTimelineExtensionWork(input),
    assertTimelineWork: lease => applicationRuntime.assertTimelineExtensionWork(lease),
    canRunTimelineWork: input => applicationRuntime.isTimelineExtensionActive(input),
    listTimelineTargets: input => applicationRuntime.listTimelineExtensionTargets(input),
    subscribeTimelineTargets: (input, listener) => applicationRuntime.subscribeTimelineExtensionTargets(input, listener),
    readState: async (target, owner) => {
      const scope = timelineToolScope(target)
      if (owner.lease) await applicationRuntime.assertTimelineExtensionWork(owner.lease)
      await scope?.assertNarrativeSource?.()
      const snapshot = (await applicationRuntime.getStateSnapshot({ target })).snapshot
      await scope?.assertNarrativeSource?.()
      return snapshot
    },
    canAccessState: (target, installation) => canAccessExtensionState(narratives, installation, target),
    writeState: async (input, owner) => {
      const scope = timelineToolScope(input.target)
      const write = () => applicationRuntime.applyStateMutation(input, {
        actor: { kind: 'extension', id: owner.packageId },
        ...(owner.lease ? { extensionLeases: [owner.lease] } : {}),
      })
      const result = await (scope?.withNarrativeWrite ? scope.withNarrativeWrite(write) : write())
      return { snapshot: result.snapshot, changesetId: result.mutation.changesetId }
    },
    registerAgentToolHandler: (toolId, _ownerPackageId, _ownerModuleId, _ownerInstanceId, handler) => agentTools.registerRuntime({
      toolId,
      execute: async ({ invocation, signal, scope }) => {
        const target = scope?.state?.defaultTarget
        const narrativeTarget = target?.scope === 'timeline' && scope?.state?.canAccess(target)
          ? Object.freeze({ ...target })
          : undefined
        const narrativeSource = sourceMetadata(scope?.narrativeSource)
        const executeHandler = () => handler({
          ...(invocation.arguments ? { arguments: structuredClone(invocation.arguments) } : {}),
          ...(invocation.rawInput !== undefined ? { rawInput: invocation.rawInput } : {}),
          ...(invocation.transport ? { transport: invocation.transport } : {}),
        }, { signal, invocationId: invocation.id,
          ...(narrativeTarget ? { narrativeTarget } : {}), ...(narrativeSource ? { narrativeSource } : {}),
        })
        const output = await (scope ? toolScopes.run(scope, executeHandler) : toolScopes.exit(executeHandler))
        return {
          invocationId: invocation.id,
          toolId: invocation.toolId,
          status: 'completed',
          content: typeof output === 'string'
            ? [{ type: 'text', text: output }]
            : [{ type: 'json', value: output }],
        }
      },
    }),
    validateStorageScope: async (scope, target, execution) => {
      if (scope.kind === 'global') return
      if (scope.kind === 'card') {
        const card = await documents.get(scope.cardId)
        if (!card || card.type !== applicationDocumentTypes.cardSource || card.meta.tombstone) throw new Error(`Card not found: ${scope.cardId}`)
        return
      }
      if (scope.kind === 'timeline') {
        const timeline = await narratives?.getTimeline(scope.timelineId)
        if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${scope.timelineId}`)
        if (target.kind === 'card' && timeline.createdFrom?.cardId !== target.cardId) {
          throw new Error('Narrative Timeline is outside the extension Card installation')
        }
        return
      }
      const session = await agents?.getSession(scope.agentSessionId)
      if (!session || session.deletedAt) throw new Error(`Agent Session not found: ${scope.agentSessionId}`)
      if (execution && session.timelineId !== execution.timelineId) throw new Error('Agent Session is outside the current Timeline')
      if (target.kind === 'card') {
        const timeline = session.timelineId ? await narratives?.getTimeline(session.timelineId) : undefined
        if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) {
          throw new Error('Agent Session is outside the extension Card installation')
        }
      }
    },
    validateEntityRef: async (ref, target, execution) => {
      if (execution && ref.kind === 'agent-message'
        && (await agents?.getSession(ref.agentSessionId))?.timelineId !== execution.timelineId) {
        throw new Error('Agent Message is outside the current Timeline')
      }
      if (target.kind === 'card' && ref.kind !== 'asset') {
        const timelineId = ref.kind === 'agent-message'
          ? (await agents?.getSession(ref.agentSessionId))?.timelineId
          : ref.timelineId
        const timeline = timelineId ? await narratives?.getTimeline(timelineId) : undefined
        if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) {
          throw new Error('Entity reference is outside the extension Card installation')
        }
      }
      if (ref.kind === 'narrative-node') {
        const node = await narratives?.getNode(ref.nodeId)
        if (!node || node.timelineId !== ref.timelineId) throw new Error(`Narrative Node not found in Timeline: ${ref.nodeId}`)
        return
      }
      if (ref.kind === 'agent-message') {
        const entry = await agents?.getEntry(ref.messageId)
        if (!entry || entry.agentSessionId !== ref.agentSessionId) throw new Error(`Agent Message not found in Session: ${ref.messageId}`)
        return
      }
      if (ref.kind === 'asset') {
        if (!await assets?.getMediaAsset(ref.assetId)) throw new Error(`Media Asset not found: ${ref.assetId}`)
        return
      }
      const timeline = await narratives?.getTimeline(ref.timelineId)
      if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${ref.timelineId}`)
    },
    callRpc: (method, params, context) => getKernel().callRpc(method, params, context),
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId, target) => {
      const handle = getKernel().registerExtensionRpc(name, ownerPackageId, ownerModuleId, handler, ownerInstanceId, target)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler, dispose: handle.dispose }
    },
    registerEventDefinition: (definition, registeredBy) => getKernel().getEventBus().registerDefinition(definition, registeredBy),
    emitEvent: (name, payload, publisher) => getKernel().getEventBus().emit(name, payload, {
      publisher,
      source: publisher.kind === 'extension' ? `extension:${publisher.packageId}/${publisher.moduleId}` : publisher.kind,
    }),
    subscribeEvents: (patterns, handler, subscriber) => getKernel().getEventBus().subscribe(
      patterns,
      subscriber.kind === 'extension' && subscriber.target?.kind === 'card'
        ? async event => {
          const projected = await projectExtensionEvent({ documents, narratives, states, promptResources }, event, subscriber)
          if (projected) await handler(projected)
        } : handler,
      { subscriber },
    ),
  }
}
