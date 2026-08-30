import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { initializeGlobalState } from '../state/state.js'
import {
  createOfficialPromptResourceContents,
  obsoleteBuiltinAgentToolDescriptions,
  obsoleteBuiltinAgentToolIds,
  officialPromptResourceIds,
} from '../prompt/prompt-resource-defaults.js'
import { toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
import type {
  AgentToolContent,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
} from '../types.js'
import { applicationActor } from './context.js'
import { createCardsRuntimeMethods } from './cards-runtime.js'
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

export function createApplicationRuntime(options: ApplicationRuntimeOptions): ApplicationRuntime {
  const ctx: ApplicationRuntimeContext = createApplicationRuntimeContext(options)

  return {
    initialize: async () => {
      await initializeGlobalState(ctx)
      await initializeOfficialFakeProviderProfiles(ctx)
      const timestamp = ctx.now()
      const promptContents = createOfficialPromptResourceContents(timestamp)
      for (const [index, content] of promptContents.entries()) {
        const id = index === 0 ? officialPromptResourceIds.assistantPreset : officialPromptResourceIds.knowledgeSetting
        if (!await ctx.promptResources.getResource(id)) {
          await ctx.promptResources.createResource({
            ...toStoredResourceInput({ id, content }),
            actor: applicationActor,
            reason: 'application.initializePromptResources',
          })
        }
      }
      const officialMounts = await ctx.promptResources.listSettingMounts({ source: { kind: 'manual', id: 'global' } })
      if (!officialMounts.some(mount => mount.settingResourceId === officialPromptResourceIds.knowledgeSetting)) {
        await ctx.promptResources.addSettingMount({
          actor: applicationActor,
          reason: 'application.initializePromptResources',
          source: { kind: 'manual', id: 'global' },
          settingResourceId: officialPromptResourceIds.knowledgeSetting,
          orderIndex: officialMounts.length,
          origin: { kind: 'builtin', key: 'loom-assistant-preset' },
        })
      }
      const existingToolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: officialPromptResourceIds.assistantPreset })
      const retainedToolMounts = existingToolMounts.filter(mount => !obsoleteBuiltinAgentToolIds.has(mount.toolId))
      if (retainedToolMounts.length !== existingToolMounts.length) {
        await ctx.promptResources.replacePresetToolMounts({
          actor: applicationActor,
          reason: 'application.removeObsoleteBuiltinAgentTools',
          presetResourceId: officialPromptResourceIds.assistantPreset,
          mounts: retainedToolMounts.map(mount => ({
            toolId: mount.toolId,
            orderIndex: mount.orderIndex,
            defaultEnabled: mount.defaultEnabled,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: structuredClone(mount.origin),
          })),
        })
      }
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
      const officialToolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: officialPromptResourceIds.assistantPreset })
      for (const [orderIndex, definition] of ctx.agentTools.list().entries()) {
        if (officialToolMounts.some(mount => mount.toolId === definition.id)) continue
        await ctx.promptResources.addPresetToolMount({
          actor: applicationActor,
          reason: 'application.initializePromptResources',
          presetResourceId: officialPromptResourceIds.assistantPreset,
          toolId: definition.id,
          orderIndex,
          defaultEnabled: false,
          ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
          ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
          ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
          origin: { kind: 'builtin', key: 'loom-assistant-preset' },
        })
      }
    },

    ...createCardsRuntimeMethods(ctx),
    ...createNarrativeRuntimeMethods(ctx),
    ...createAgentsRuntimeMethods(ctx),
    ...createPromptRuntimeMethods(ctx),
    ...createStateRuntimeMethods(ctx),
    ...createTransformsRuntimeMethods(ctx),
    ...createProvidersRuntimeMethods(ctx),
    ...createExtensionsRuntimeMethods(ctx),
  }
}
