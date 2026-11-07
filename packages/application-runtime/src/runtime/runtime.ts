import { createPromptPackageUpdateMethods } from './prompt-package-updates.js'
import { createCardPackageUpdateMethods } from './card-package-updates.js'
import { createStateMigrationMethods } from './state-migration.js'
import { createResourceAuthoringRuntimeMethods } from './resource-authoring-runtime.js'
import { createObservabilityRuntimeMethods } from './observability-runtime.js'
import type { ObservationBuild } from '../observability/types.js'
import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { initializeGlobalState } from '../state/state.js'
import { isDeepStrictEqual } from 'node:util'
import { officialAgentToolDefinitions } from '../agents/official-tools/index.js'
import type {
  AgentToolContent,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
} from '../types.js'
import { applicationActor } from './context.js'
import { createCardsRuntimeMethods } from './cards-runtime.js'
import { createCardDirectoryRuntimeMethods } from './card-directory-sync.js'
import { createNarrativeRuntimeMethods } from './narrative-runtime.js'
import { createSwipeRuntimeMethods } from './swipe-runtime.js'
import { createAgentsRuntimeMethods } from './agents-runtime.js'
import { refreshAgentToolRegistry, toAgentToolContent, toAgentToolDefinition } from '../agents/tool-catalog.js'
import { createPromptRuntimeMethods } from './prompt-runtime.js'
import { createSearchRuntimeMethods } from './search-runtime.js'
import { createWorkspaceRuntimeMethods } from './workspace-runtime.js'
import { createStateRuntimeMethods } from './state-runtime.js'
import { createUserProfilesRuntimeMethods } from './user-profiles-runtime.js'
import { createUserBackgroundsRuntimeMethods } from './user-backgrounds-runtime.js'
import { createTransformsRuntimeMethods } from './transforms-runtime.js'
import {
  createProvidersRuntimeMethods,
  initializeOfficialFakeProviderProfiles,
} from './providers-runtime.js'
import { createExtensionsRuntimeMethods } from './extensions-runtime.js'
import { setScriptExecutionStates } from '../scripts/loom-script-text-pipeline.js'
import { createLoomScriptsRuntimeMethods } from './loom-scripts-runtime.js'
import { createOfficialContentRuntimeMethods } from './official-content-runtime.js'
import { createMacroConfigurationRuntimeMethods } from './macros-runtime.js'
import { buildExtensionPrompt } from '../prompt/extension-prompt.js'
import { readAvailableExtensionInstallations } from './extension-resource-access.js'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { assertTimelineExtensionLease, beginTimelineExtensionWork, createTimelineExtensionParticipationMethods, runTimelineExtensionWork } from '../extensions/timeline-participation.js'
import { inspectTimelineExtensionResources } from '../extensions/resource-inspection.js'
import { createTimelineExtensionRecoveryMethods } from '../extensions/timeline-recovery.js'
import { createTimelineExtensionAdoptionMethods } from '../extensions/timeline-adoption.js'
import { createTimelineExtensionStateInitializationMethods } from '../extensions/timeline-state-initialization.js'

export function createApplicationRuntime(options: ApplicationRuntimeOptions): ApplicationRuntime {
  const ctx: ApplicationRuntimeContext = createApplicationRuntimeContext(options)

  return {
    ...createObservabilityRuntimeMethods(ctx),
    subscribeNarrativeActivity: ctx.narrativeActivity.subscribe,
    registerReadonlyFiles: ctx.extensionReadonlyFiles.register,
    registerTimelineArchiveParticipant: ctx.timelineArchiveParticipants.register,
    setLoomScriptExecutionStates: states => setScriptExecutionStates(ctx.documents, states),
    initialize: async () => {
      await initializeGlobalState(ctx)
      await initializeOfficialFakeProviderProfiles(ctx)
      const timestamp = ctx.now()
      for (const definition of ctx.agentTools.list().map(tool =>
        officialAgentToolDefinitions.find(official => official.id === tool.id) ?? tool
      )) {
        const existing = await ctx.documents.get(definition.id)
        if (existing) {
          const content = existing.content as AgentToolContent
          if (definition.owner.namespace === 'official' && content.owner.namespace === 'official'
            && !content.origin && !isDeepStrictEqual(toAgentToolDefinition({ ...existing, content }), definition)) {
            await ctx.documents.write({
              id: definition.id,
              type: applicationDocumentTypes.agentTool,
              content: toAgentToolContent(definition, content.createdAt, timestamp),
              expectedVersion: existing.version,
              actor: applicationActor,
              reason: 'application.initializePromptResources',
            })
          }
          continue
        }
        await ctx.documents.write({
          id: definition.id,
          type: applicationDocumentTypes.agentTool,
          content: toAgentToolContent(definition, timestamp),
          expectedVersion: 'new',
          actor: applicationActor,
          reason: 'application.initializePromptResources',
        })
      }
      await refreshAgentToolRegistry(ctx)
    },

    ...createCardsRuntimeMethods(ctx),
    ...createCardPackageUpdateMethods(ctx),
    ...createCardDirectoryRuntimeMethods(ctx),
    ...createStateMigrationMethods(ctx),
    ...createResourceAuthoringRuntimeMethods(ctx),
    ...createNarrativeRuntimeMethods(ctx),
    ...createSwipeRuntimeMethods(ctx),
    ...createAgentsRuntimeMethods(ctx),
    buildExtensionPrompt: async (input, target, packageId, lease, requestContext) => {
      if (lease) {
        if (lease.installationId !== extensionInstallationId(packageId, target)) throw new Error('Prompt execution belongs to another installation')
        await assertTimelineExtensionLease(ctx, ctx.documents, lease)
      }
      const timeline = lease ? await ctx.narratives?.getTimeline(lease.timelineId) : undefined
      const cardId = timeline?.createdFrom?.cardId ?? (target.kind === 'card' ? target.cardId : undefined)
      const buildId = ctx.createId('build')
      const observation: ObservationBuild = {}
      const startedAt = performance.now()
      ctx.observations.capture(() => ctx.observations.write({
        id: buildId, kind: 'build', title: `${packageId} · Prompt Build`, status: 'running',
        timelineId: lease?.timelineId,
        origin: { ...requestContext?.observationOrigin, actor: `extension:${packageId}`, packageId, installationId: extensionInstallationId(packageId, target) },
      }))
      try {
        const result = await buildExtensionPrompt({
          observation,
          build: input,
          promptResources: ctx.promptResources,
          installations: await readAvailableExtensionInstallations(ctx.documents, cardId, lease?.timelineId),
          owner: { installationId: extensionInstallationId(packageId, target), packageId },
          processors: ctx.promptProcessors,
          ...(cardId ? { cardId } : {}),
        })
        if (lease) await assertTimelineExtensionLease(ctx, ctx.documents, lease)
        ctx.observations.capture(() => ctx.observations.patch(buildId, {
          status: 'completed', durationMs: performance.now() - startedAt,
          availability: observation.diagnostics?.some(item => item && typeof item === 'object' && 'code' in item && String(item.code).startsWith('observation.')) ? 'partial' : 'recorded',
          build: { ...observation, messages: result.messages },
        }))
        return { messages: result.messages }
      } catch (error) {
        ctx.observations.capture(() => ctx.observations.patch(buildId, {
          status: 'failed', availability: 'partial', durationMs: performance.now() - startedAt,
          diagnostic: error instanceof Error ? error.message : String(error), build: observation,
        }))
        throw error
      }
    },
    ...createMacroConfigurationRuntimeMethods(ctx),
    ...createPromptRuntimeMethods(ctx),
    ...createPromptPackageUpdateMethods(ctx),
    ...createSearchRuntimeMethods(ctx),
    ...createStateRuntimeMethods(ctx),
    ...createUserProfilesRuntimeMethods(ctx),
    ...createUserBackgroundsRuntimeMethods(ctx),
    ...createWorkspaceRuntimeMethods(ctx),
    ...createTransformsRuntimeMethods(ctx),
    ...createProvidersRuntimeMethods(ctx),
    ...createExtensionsRuntimeMethods(ctx),
    ...createTimelineExtensionParticipationMethods(ctx),
    ...createTimelineExtensionRecoveryMethods(ctx),
    ...createTimelineExtensionAdoptionMethods(ctx),
    ...createTimelineExtensionStateInitializationMethods(ctx),
    runTimelineExtensionWork: (input, work) => runTimelineExtensionWork(ctx, input, work),
    beginTimelineExtensionWork: input => beginTimelineExtensionWork(ctx, input),
    inspectTimelineExtensionResources: input => inspectTimelineExtensionResources(ctx, input),
    assertTimelineExtensionWork: lease => assertTimelineExtensionLease(ctx, ctx.documents, lease),
    ...createLoomScriptsRuntimeMethods(ctx),
    ...createOfficialContentRuntimeMethods(ctx),
  }
}
