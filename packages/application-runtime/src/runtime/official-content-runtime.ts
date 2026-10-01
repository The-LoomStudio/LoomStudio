import { createHash } from 'node:crypto'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { normalizePromptResourceArtifact } from '../cards/workspace-codec.js'
import { fromStoredResource, toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
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

type OfficialContentRuntimeContext = Pick<ApplicationRuntimeContext, 'agentTools' | 'dataEngine' | 'now' | 'promptResources'>

export function createOfficialContentRuntimeMethods(ctx: OfficialContentRuntimeContext) {
  return {
    installOfficialContent: async (
      input: InstallOfficialContentInput,
      requestContext?: RuntimeRequestContext,
    ): Promise<InstallOfficialContentResult> => {
      assertNonEmpty(input.packageId, 'packageId')
      assertNonEmpty(input.packageVersion, 'packageVersion')

      const artifacts = new Map<string, ReturnType<typeof normalizePromptResourceArtifact>>()
      const origins = new Map<string, { kind: 'builtin'; key: string; packageVersion: string; sourceDigest: string }>()
      const existing = new Map<string, Awaited<ReturnType<typeof ctx.promptResources.getResource>>>()
      for (const item of input.resources) {
        assertNonEmpty(item.id, 'resource id')
        if (artifacts.has(item.id)) throw new Error(`Official content resource is duplicated: ${item.id}`)
        const artifact = normalizePromptResourceArtifact(item.artifact)
        artifacts.set(item.id, artifact)
        origins.set(item.id, {
          kind: 'builtin',
          key: builtinOriginKeys[item.id] ?? `${input.packageId}:${item.id}`,
          packageVersion: input.packageVersion,
          sourceDigest: createHash('sha256').update(JSON.stringify(item.artifact)).digest('hex'),
        })
        const stored = await ctx.promptResources.getResource(item.id, { includeTombstone: true })
        if (stored && stored.resourceKind !== artifact.resourceKind) {
          throw new Error(`Official content resource ID is occupied by a different kind: ${item.id}`)
        }
        if (stored) {
          const origin = fromStoredResource(stored).origin
          if (origin?.kind !== 'builtin' || origin.key !== origins.get(item.id)!.key) {
            throw new Error(`Official content resource ID is occupied by another owner: ${item.id}`)
          }
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
      const updated = resources.filter(item => {
        const stored = existing.get(item.id)
        if (!stored || stored.tombstoned) return false
        const origin = fromStoredResource(stored).origin
        const current = origins.get(item.id)!
        return origin?.kind === 'builtin'
          && (origin.packageVersion !== current.packageVersion || origin.sourceDigest !== current.sourceDigest)
      })
      const presetMounts = new Map<string, Set<string>>()
      for (const item of resources) {
        if (artifacts.get(item.id)?.resourceKind !== 'preset' || existing.get(item.id)?.tombstoned) continue
        presetMounts.set(item.id, new Set(
          (await ctx.promptResources.listPresetToolMounts({ presetResourceId: item.id })).map(mount => mount.toolId),
        ))
      }
      const tools = ctx.agentTools.list()
      const missingTools = [...presetMounts].some(([id, mounted]) =>
        !existing.get(id) || tools.some(tool => !mounted.has(tool.id)))
      if (!resources.some(item => item.created) && updated.length === 0 && !missingTools) return { resources }

      const timestamp = ctx.now()
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.installOfficialContent',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        for (const item of resources) {
          const artifact = artifacts.get(item.id)!
          const stored = existing.get(item.id)
          if (!item.created && !updated.some(resource => resource.id === item.id)) continue
          const previous = stored ? fromStoredResource(stored) : undefined
          const replacement = toStoredResourceInput({
            id: item.id,
            content: {
              resourceKind: artifact.resourceKind,
              rootNode: structuredClone(artifact.rootNode),
              ...(artifact.resourceKind === 'preset' ? {
                historyPolicy: previous?.historyPolicy ?? 'persistent' as const,
                delivery: previous?.delivery ?? 'stream' as const,
                ...(previous?.model ? { model: previous.model } : {}),
              } : {}),
              ...(artifact.macros !== undefined ? { macros: structuredClone(artifact.macros) } : {}),
              ...(artifact.macroOptions !== undefined ? { macroOptions: structuredClone(artifact.macroOptions) } : {}),
              origin: origins.get(item.id)!,
              createdAt: previous?.createdAt ?? timestamp,
              updatedAt: timestamp,
            },
          })
          if (item.created) {
            resourceTx.createResource(replacement)
          } else {
            resourceTx.mutateResource({
              resourceId: item.id,
              expectedVersion: stored!.version,
              mutations: [
                { kind: 'tree.replace', rootNode: replacement.rootNode },
                { kind: 'resource.update', patch: { label: replacement.label, metadata: replacement.metadata } },
              ],
            })
          }
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
        for (const [presetId, mounted] of presetMounts) {
          for (const [orderIndex, definition] of tools.entries()) {
            if (mounted.has(definition.id)) continue
            resourceTx.addPresetToolMount({
              presetResourceId: presetId,
              toolId: definition.id,
              orderIndex,
              defaultEnabled: false,
              ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
              ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
              ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
              origin: { kind: 'builtin', key: builtinOriginKeys[presetId] ?? `${input.packageId}:${presetId}` },
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
