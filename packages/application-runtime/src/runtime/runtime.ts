import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { initializeGlobalState } from '../state/state.js'
import {
  obsoleteBuiltinAgentToolDescriptions,
  obsoleteBuiltinAgentToolIds,
} from '../prompt/prompt-resource-defaults.js'
import type {
  AgentToolContent,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
} from '../types.js'
import { applicationActor } from './context.js'
import { createCardsRuntimeMethods } from './cards-runtime.js'
import { createCardDirectoryRuntimeMethods } from './card-directory-sync.js'
import { createNarrativeRuntimeMethods } from './narrative-runtime.js'
import {
  createAgentsRuntimeMethods,
  refreshAgentToolRegistry,
  toAgentToolContent,
} from './agents-runtime.js'
import { createPromptRuntimeMethods } from './prompt-runtime.js'
import { createStateRuntimeMethods } from './state-runtime.js'
import { createTransformsRuntimeMethods } from './transforms-runtime.js'
import {
  createProvidersRuntimeMethods,
  initializeOfficialFakeProviderProfiles,
} from './providers-runtime.js'
import { createExtensionsRuntimeMethods } from './extensions-runtime.js'
import { createLoomScriptsRuntimeMethods } from './loom-scripts-runtime.js'
import { createOfficialContentRuntimeMethods } from './official-content-runtime.js'

export function createApplicationRuntime(options: ApplicationRuntimeOptions): ApplicationRuntime {
  const ctx: ApplicationRuntimeContext = createApplicationRuntimeContext(options)

  return {
    initialize: async () => {
      await initializeGlobalState(ctx)
      await initializeOfficialFakeProviderProfiles(ctx)
      const timestamp = ctx.now()
      for (const toolId of obsoleteBuiltinAgentToolIds) {
        const document = await ctx.documents.get(toolId)
        if (!document) continue
        await ctx.documents.delete({
          id: toolId,
          expectedVersion: document.version,
          actor: applicationActor,
          reason: 'application.removeObsoleteBuiltinAgentTools',
        })
      }
      for (const definition of ctx.agentTools.list()) {
        const existing = await ctx.documents.get(definition.id)
        if (existing) {
          const content = existing.content as AgentToolContent
          if (content.description === obsoleteBuiltinAgentToolDescriptions.get(definition.id)) {
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
    ...createCardDirectoryRuntimeMethods(ctx),
    ...createNarrativeRuntimeMethods(ctx),
    ...createAgentsRuntimeMethods(ctx),
    ...createPromptRuntimeMethods(ctx),
    ...createStateRuntimeMethods(ctx),
    ...createTransformsRuntimeMethods(ctx),
    ...createProvidersRuntimeMethods(ctx),
    ...createExtensionsRuntimeMethods(ctx),
    ...createLoomScriptsRuntimeMethods(ctx),
    ...createOfficialContentRuntimeMethods(ctx),
  }
}
