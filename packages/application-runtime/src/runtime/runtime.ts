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
import type { PromptResourceNode } from '../cards/workspace.js'
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
        let existing = await ctx.promptResources.getResource(id, { includeTombstone: true })
        if (existing?.tombstoned) {
          const restored = await ctx.promptResources.restoreResource({
            actor: applicationActor,
            reason: 'application.restoreBuiltinPromptResources',
            resourceId: id,
            expectedVersion: existing.version,
          })
          existing = restored.resource
        }
        if (!existing) {
          await ctx.promptResources.createResource({
            ...toStoredResourceInput({ id, content }),
            actor: applicationActor,
            reason: 'application.initializePromptResources',
          })
        } else if (existing.metadata && typeof existing.metadata === 'object' && 'origin' in existing.metadata && (existing.metadata as { origin?: { kind?: string } }).origin?.kind === 'builtin') {
          if (content.resourceKind === 'preset') {
            const expectedFlat = collectAllPresetNodes(existing.rootNode.id, content.rootNode.children)
            const existingChildIds = existing.rootNode.children?.map(c => c.id) ?? []
            const currentSubtreeNodeIds = new Set(collectExistingAllNodeIds(existing.rootNode.children))
            const expectedNodeIds = new Set(expectedFlat.map(c => c.id))

            const isIdentical = expectedNodeIds.size === currentSubtreeNodeIds.size
              && [...expectedNodeIds].every(nodeId => currentSubtreeNodeIds.has(nodeId))

            if (!isIdentical) {
              let currentVersion = existing.version
              if (existingChildIds.length > 0) {
                const deleteResult = await ctx.promptResources.mutateResource({
                  actor: applicationActor,
                  reason: 'application.upgradeBuiltinPromptResources.cleanup',
                  resourceId: id,
                  expectedVersion: currentVersion,
                  mutations: existingChildIds.map(nodeId => ({ kind: 'node.delete' as const, nodeId })),
                })
                currentVersion = deleteResult.resource.version
              }

              const createMutations = expectedFlat.map(item => ({
                kind: 'node.create' as const,
                parentId: item.parentId,
                node: {
                  id: item.node.id,
                  kind: item.node.kind,
                  label: item.node.label,
                  meta: item.node.meta,
                  category: item.node.category,
                  enabled: item.node.enabled,
                  body: item.node.body,
                  capabilities: item.node.capabilities,
                  orderIndex: item.orderIndex,
                },
              }))

              if (createMutations.length > 0) {
                await ctx.promptResources.mutateResource({
                  actor: applicationActor,
                  reason: 'application.upgradeBuiltinPromptResources.rebuild',
                  resourceId: id,
                  expectedVersion: currentVersion,
                  mutations: createMutations,
                })
              }
            }
          } else if (content.resourceKind === 'setting') {
            const mutations: Array<{ kind: 'node.update'; nodeId: string; patch: { capabilities?: PromptResourceNode['capabilities'] } }> = []
            for (const expected of content.rootNode.children ?? []) {
              const current = existing.rootNode.children?.find(c => c.id === expected.id)
              if (current && JSON.stringify(current.capabilities) !== JSON.stringify(expected.capabilities)) {
                mutations.push({
                  kind: 'node.update',
                  nodeId: current.id,
                  patch: { capabilities: expected.capabilities },
                })
              }
            }
            if (mutations.length > 0) {
              await ctx.promptResources.mutateResource({
                actor: applicationActor,
                reason: 'application.upgradeBuiltinPromptResources',
                resourceId: id,
                expectedVersion: existing.version,
                mutations,
              })
            }
          }
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

type FlatPresetNode = {
  id: string
  parentId: string
  node: PromptResourceNode
  orderIndex: number
}

function collectAllPresetNodes(parentId: string, children?: PromptResourceNode[]): FlatPresetNode[] {
  if (!children) return []
  const list: FlatPresetNode[] = []
  for (const [i, child] of children.entries()) {
    list.push({ id: child.id, parentId, node: child, orderIndex: 100 + i })
    if (child.children?.length) {
      list.push(...collectAllPresetNodes(child.id, child.children))
    }
  }
  return list
}

function collectExistingAllNodeIds(children?: Array<{ id: string; children?: any[] }>): string[] {
  if (!children) return []
  return children.flatMap(child => [child.id, ...collectExistingAllNodeIds(child.children)])
}

