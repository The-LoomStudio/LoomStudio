import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { normalizePromptResourceArtifact } from '../cards/workspace.js'
import { toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
import type {
  InstallOfficialContentInput,
  InstallOfficialContentResult,
  RuntimeRequestContext,
} from '../types.js'
import { promptResourceWriteContext } from './context.js'

const builtinOriginKeys: Record<string, string> = {
  'prompt-resource.official.loom-assistant': 'loom-assistant-preset',
  'prompt-resource.official.loom-knowledge': 'loom-knowledge-setting',
}

export function createOfficialContentRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    installOfficialContent: async (
      input: InstallOfficialContentInput,
      requestContext?: RuntimeRequestContext,
    ): Promise<InstallOfficialContentResult> => {
      assertNonEmpty(input.packageId, 'packageId')
      assertNonEmpty(input.packageVersion, 'packageVersion')

      const artifacts = new Map<string, ReturnType<typeof normalizePromptResourceArtifact>>()
      const existing = new Map<string, Awaited<ReturnType<typeof ctx.promptResources.getResource>>>()
      for (const item of input.resources) {
        assertNonEmpty(item.id, 'resource id')
        if (artifacts.has(item.id)) throw new Error(`Official content resource is duplicated: ${item.id}`)
        const artifact = normalizePromptResourceArtifact(item.artifact)
        artifacts.set(item.id, artifact)
        const stored = await ctx.promptResources.getResource(item.id, { includeTombstone: true })
        if (stored && stored.resourceKind !== artifact.resourceKind) {
          throw new Error(`Official content resource ID is occupied by a different kind: ${item.id}`)
        }
        existing.set(item.id, stored)
      }

      const mounts = new Set<string>()
      for (const mount of input.settingMounts) {
        const key = `${mount.presetResourceId}\0${mount.settingResourceId}`
        if (mounts.has(key)) throw new Error(`Official content Setting mount is duplicated: ${mount.presetResourceId} -> ${mount.settingResourceId}`)
        mounts.add(key)
        const preset = artifacts.get(mount.presetResourceId)
        const setting = artifacts.get(mount.settingResourceId)
        if (!preset || preset.resourceKind !== 'preset') throw new Error(`Official content Preset reference is invalid: ${mount.presetResourceId}`)
        if (!setting || setting.resourceKind !== 'setting') throw new Error(`Official content Setting reference is invalid: ${mount.settingResourceId}`)
      }

      const resources = input.resources.map(item => ({
        id: item.id,
        created: !existing.get(item.id),
      }))
      if (!resources.some(item => item.created)) return { resources }

      const timestamp = ctx.now()
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.installOfficialContent',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        for (const item of resources) {
          if (!item.created) continue
          const artifact = artifacts.get(item.id)!
          resourceTx.createResource(toStoredResourceInput({
            id: item.id,
            content: {
              resourceKind: artifact.resourceKind,
              rootNode: structuredClone(artifact.rootNode),
              ...(artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
              ...(artifact.macros !== undefined ? { macros: structuredClone(artifact.macros) } : {}),
              origin: { kind: 'builtin', key: builtinOriginKeys[item.id] ?? `${input.packageId}:${item.id}` },
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          }))
        }
        for (const mount of input.settingMounts) {
          if (!resources.find(item => item.id === mount.presetResourceId)?.created) continue
          const setting = existing.get(mount.settingResourceId)
          if (setting?.tombstoned) continue
          resourceTx.addSettingMount({
            source: { kind: 'preset', id: mount.presetResourceId },
            settingResourceId: mount.settingResourceId,
            orderIndex: 0,
            origin: { kind: 'builtin', key: builtinOriginKeys[mount.presetResourceId] ?? `${input.packageId}:${mount.presetResourceId}` },
          })
        }
        for (const preset of resources.filter(item => item.created && artifacts.get(item.id)?.resourceKind === 'preset')) {
          for (const [orderIndex, definition] of ctx.agentTools.list().entries()) {
            resourceTx.addPresetToolMount({
              presetResourceId: preset.id,
              toolId: definition.id,
              orderIndex,
              defaultEnabled: false,
              ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
              ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
              ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
              origin: { kind: 'builtin', key: builtinOriginKeys[preset.id] ?? `${input.packageId}:${preset.id}` },
            })
          }
        }
      })
      return { resources, mutation: { changesetId: transaction.commit.changesetId } }
    },
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`Official content ${name} must be non-empty`)
}
