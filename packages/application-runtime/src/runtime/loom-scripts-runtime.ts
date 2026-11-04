import { listScriptConfigs, writeScriptConfig, type ScriptConfigQuery, type ScriptConfigWrite } from '../scripts/script-config.js'
import { applyTextRuleUsage, resolveTextTransformContributionRule, textRuleUsagesSchema, isLoomScriptFileName, loomScriptMediaType, resolveLoomScriptSettings, type LoomScriptSettings, type InitialLoomScriptMountInput, type CreateLoomScriptMountInput, type UpdateLoomScriptMountInput, type ListLoomScriptMountsInput } from '@loom-studio/shared/loom-scripts'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { executeBlobDocumentMutation, executeDocumentMutation } from '../foundation/mutation.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import { readLoomScriptInstallation, readLoomScriptRevision, resolveLoomScriptRendererMounts } from '../scripts/loom-script-resolution.js'
import { narrativeWriteContext, requireDocumentParticipant, requireNarratives } from './context.js'
import type {
  LoomScriptArtifact,
  LoomScriptContent,
  LoomScriptMountContent,
  LoomScriptMountTarget,
  LoomScriptOwner,
} from '../scripts/loom-script-contracts.js'
import type { RuntimeRequestContext } from '../types.js'

type LoomScriptsRuntimeContext = Pick<ApplicationRuntimeContext, 'blobs' | 'createId' | 'dataEngine' | 'documents' | 'narratives' | 'agents' | 'now'>

export function createLoomScriptsRuntimeMethods(ctx: LoomScriptsRuntimeContext) {
  return {
    importLoomScript: async (input: {
      owner: LoomScriptOwner
      fileName: string
      source: string
      mount?: InitialLoomScriptMountInput
    }, requestContext?: RuntimeRequestContext) => {
      assertFileName(input.fileName)
      const metadata = parseLoomScriptSource(input.source)
      if (input.fileName.endsWith('.md') !== /^\uFEFF?---\r?\n/.test(input.source)) throw new Error('Script source format does not match its file name')
      const timestamp = ctx.now()
      const result = await executeBlobDocumentMutation(
        ctx,
        requestContext,
        'application.importLoomScript',
        { bytes: new TextEncoder().encode(input.source), mediaType: loomScriptMediaType(input.fileName) },
        async (documents, blob) => {
          if (input.owner.kind === 'extension') await readLoomScriptInstallation(documents, input.owner)
          const document = await writeDocument<LoomScriptContent>(documents, {
            id: ctx.createId('loom-script'),
            type: applicationDocumentTypes.loomScript,
            content: {
              owner: structuredClone(input.owner),
              ...metadata,
              source: { blobId: blob.id, mediaType: loomScriptMediaType(input.fileName), fileName: input.fileName },
              sourceDigest: blob.sha256,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            ...(input.owner.kind === 'extension' ? {
              meta: { ownerExtensionId: input.owner.packageId, ownerInstallationId: input.owner.installationId },
            } : {}),
            expectedVersion: 'new',
          })
          if (input.mount) {
            const rule = metadata.contributions.find(item => item.kind === 'text-transform')
            await writeDocument<LoomScriptMountContent>(documents, {
              id: ctx.createId('loom-script-mount'),
              type: applicationDocumentTypes.loomScriptMount,
              content: {
                target: structuredClone(input.mount.target), scriptDocumentId: document.id,
                enabled: false,
                orderIndex: input.mount.orderIndex ?? (rule?.kind === 'text-transform' ? resolveTextTransformContributionRule(rule, resolveLoomScriptSettings(metadata.settings)).orderIndex : undefined) ?? 0,
                grantedCapabilities: [], settings: {}, runtimeRevision: 0, origin: {},
                createdAt: timestamp, updatedAt: timestamp,
              },
              expectedVersion: 'new',
            })
          }
          return toVersioned(document)
        },
      )
      return { script: result.value, mutation: result.mutation }
    },

    updateLoomScript: async (input: {
      scriptDocumentId: string
      expectedVersion: number
      fileName: string
      source: string
    }, requestContext?: RuntimeRequestContext) => {
      assertFileName(input.fileName)
      const metadata = parseLoomScriptSource(input.source)
      if (input.fileName.endsWith('.md') !== /^\uFEFF?---\r?\n/.test(input.source)) throw new Error('Script source format does not match its file name')
      const timestamp = ctx.now()
      const result = await executeBlobDocumentMutation(
        ctx,
        requestContext,
        'application.updateLoomScript',
        { bytes: new TextEncoder().encode(input.source), mediaType: loomScriptMediaType(input.fileName) },
        async (documents, blob) => {
          const existing = await readDocument<LoomScriptContent>(documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)
          if (existing.content.owner.kind === 'extension') await readLoomScriptInstallation(documents, existing.content.owner)
          const document = await writeDocument<LoomScriptContent>(documents, {
            id: existing.id,
            type: applicationDocumentTypes.loomScript,
            content: {
              owner: structuredClone(existing.content.owner),
              ...metadata,
              ...(existing.content.loreResourceReferences ? { loreResourceReferences: structuredClone(existing.content.loreResourceReferences) } : {}),
              ...(existing.content.loreNodeReferences ? { loreNodeReferences: structuredClone(existing.content.loreNodeReferences) } : {}),
              ...(existing.content.textResourceIds ? { textResourceIds: structuredClone(existing.content.textResourceIds) } : {}),
              ...(existing.content.textResourceOwner ? { textResourceOwner: structuredClone(existing.content.textResourceOwner) } : {}),
              ...(existing.content.textResourceOrigin ? { textResourceOrigin: structuredClone(existing.content.textResourceOrigin) } : {}),
              ...(existing.content.textResourceReferences ? { textResourceReferences: structuredClone(existing.content.textResourceReferences) } : {}),
              source: { blobId: blob.id, mediaType: loomScriptMediaType(input.fileName), fileName: input.fileName },
              sourceDigest: blob.sha256,
              createdAt: existing.content.createdAt,
              updatedAt: timestamp,
            },
            expectedVersion: input.expectedVersion,
          })
          return toVersioned(document)
        },
      )
      return { script: result.value, mutation: result.mutation }
    },

    deleteLoomScript: async (input: { scriptDocumentId: string; expectedVersion: number }, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteLoomScript', async documents => {
        const script = await readDocument<LoomScriptContent>(documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)
        await documents.delete({ id: script.id, expectedVersion: input.expectedVersion })
        const mounts = await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount)
        for (const mount of mounts.filter(item => item.content.scriptDocumentId === script.id)) await documents.delete({ id: mount.id, expectedVersion: mount.version })
        return true as const
      })
      return { deleted: result.value, mutation: result.mutation }
    },

    reorderLoomScripts: async (input: { groups: Array<{ owner: LoomScriptOwner; scriptIds: string[]; groupOrder?: number }>; target?: LoomScriptMountTarget }, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.reorderLoomScripts', async documents => {
        const scripts = await listDocuments<LoomScriptContent>(documents, applicationDocumentTypes.loomScript)
        const mounts = await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount)
        const seen = new Set<string>()
        for (const group of input.groups) {
          let target = input.target
          if (!target) {
            if (group.owner.kind === 'extension') {
              const installed = await readLoomScriptInstallation(documents, group.owner)
              target = installed.kind === 'card' ? installed : { kind: 'user' }
            } else target = group.owner
          }
          for (const [orderIndex, id] of group.scriptIds.entries()) {
            if (seen.has(id)) throw new Error('Duplicate script in ordering')
            seen.add(id)
            const script = scripts.find(item => item.id === id && sameOwner(item.content.owner, group.owner))
            if (!script) throw new Error(`Script does not belong to ordering scope: ${id}`)
            const mount = mounts.find(item => item.content.scriptDocumentId === id && sameOwner(item.content.target, target!))
            if (!mount && input.target && !sameOwner(script.content.owner, input.target)) throw new Error('Adopt this script in the selected scope before reordering it')
            const timestamp = ctx.now()
            await writeDocument<LoomScriptMountContent>(documents, {
              id: mount?.id ?? ctx.createId('loom-script-mount'), type: applicationDocumentTypes.loomScriptMount,
              expectedVersion: mount?.version ?? 'new', content: {
                ...(mount?.content ?? { target, scriptDocumentId: id, enabled: false, grantedCapabilities: [], settings: {}, runtimeRevision: 0, createdAt: timestamp }),
                orderIndex, updatedAt: timestamp,
                origin: { ...mount?.content.origin, orderOverride: true, ...(group.groupOrder !== undefined ? { groupOrder: group.groupOrder } : {}) },
                // Reordering does not restart a running Script.
                runtimeRevision: mount?.content.runtimeRevision ?? 0,
              },
            })
          }
        }
        return true as const
      })
      return { reordered: result.value, mutation: result.mutation }
    },

    getLoomScriptSummary: async (input: { scriptDocumentId: string }) => {
      const document = await ctx.documents.get(input.scriptDocumentId)
      if (!document) return { script: null }
      if (document.type !== applicationDocumentTypes.loomScript) throw new Error(`Unexpected document type for ${input.scriptDocumentId}: ${document.type}`)
      const content = document.content as LoomScriptContent
      return { script: { id: document.id, contributionKinds: content.contributions.map(contribution => contribution.kind) } }
    },

    getLoomScript: async (input: { scriptDocumentId: string }) => ({
      script: toVersioned(await readDocument<LoomScriptContent>(ctx.documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)),
    }),

    listLoomScripts: async (input?: { owner?: LoomScriptOwner }) => {
      const scripts = await listDocuments<LoomScriptContent>(ctx.documents, applicationDocumentTypes.loomScript)
      return { scripts: scripts.filter(script => !input?.owner || sameOwner(script.content.owner, input.owner)).map(toVersioned) }
    },

    exportLoomScript: async (input: { scriptDocumentId: string }): Promise<{ artifact: LoomScriptArtifact }> => {
      if (!ctx.blobs) throw new Error('Blob Store is not configured')
      const script = await readDocument<LoomScriptContent>(ctx.documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)
      const bytes = await ctx.blobs.read(script.content.source.blobId)
      return {
        artifact: {
          format: 'loom.script',
          schemaVersion: 1,
          fileName: script.content.source.fileName,
          source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        },
      }
    },

    createLoomScriptMount: async (input: CreateLoomScriptMountInput, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.createLoomScriptMount', async documents => {
        const script = await readDocument<LoomScriptContent>(documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)
        if (script.content.owner.kind === 'extension' && input.pinnedDocumentVersion !== undefined) throw new Error('Installed Loom Scripts follow package updates and cannot pin an old revision')
        const existingMounts = await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount)
        if (existingMounts.some(mount => mount.content.scriptDocumentId === input.scriptDocumentId && sameOwner(mount.content.target, input.target))) {
          throw new Error('This script already has an adoption in this scope')
        }
        const timestamp = ctx.now()
        const mount = await writeDocument<LoomScriptMountContent>(documents, {
          id: ctx.createId('loom-script-mount'),
          type: applicationDocumentTypes.loomScriptMount,
          content: {
            target: structuredClone(input.target),
            scriptDocumentId: input.scriptDocumentId,
            enabled: false,
            orderIndex: input.orderIndex,
            ...(input.pinnedDocumentVersion !== undefined ? { pinnedDocumentVersion: input.pinnedDocumentVersion } : {}),
            grantedCapabilities: [],
            settings: {},
            runtimeRevision: 0,
            origin: structuredClone(input.origin ?? {}),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })
        return toVersioned(mount)
      })
      return { mount: result.value, mutation: result.mutation }
    },

    updateLoomScriptMount: async (input: UpdateLoomScriptMountInput, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.updateLoomScriptMount', async documents => {
        const existing = await readDocument<LoomScriptMountContent>(documents, input.mountId, applicationDocumentTypes.loomScriptMount)
        const script = await readDocument<LoomScriptContent>(documents, existing.content.scriptDocumentId, applicationDocumentTypes.loomScript)
        if (script.content.owner.kind === 'extension' && input.pinnedDocumentVersion !== undefined) throw new Error('Installed Loom Scripts follow package updates and cannot pin an old revision')
        const adoptedVersion = existing.content.enabled
          ? existing.content.adoptedDocumentVersion!
          : input.pinnedDocumentVersion ?? existing.content.pinnedDocumentVersion ?? script.version
        const adopted = await readLoomScriptRevision(documents, script.id, adoptedVersion)
        if (!adopted) throw new Error(`Loom Script revision unavailable: ${script.id}@${adoptedVersion}`)
        // Allow grants for the saved replacement while retaining the running revision's permissions.
        const requested = new Set([...script.content.requestedCapabilities, ...adopted.content.requestedCapabilities, ...existing.content.grantedCapabilities])
        if (new Set(input.grantedCapabilities).size !== input.grantedCapabilities.length
          || input.grantedCapabilities.some(capability => !requested.has(capability))) {
          throw new Error('Loom Script Mount grants must be unique requested capabilities')
        }
        const configured = await readLoomScriptRevision(documents, script.id, input.pinnedDocumentVersion ?? existing.content.pinnedDocumentVersion ?? script.version)
        if (!configured) throw new Error(`Loom Script revision unavailable: ${script.id}@${input.pinnedDocumentVersion}`)
        if (input.settings !== undefined) resolveLoomScriptSettings(configured.content.settings ?? [], input.settings)
        if (input.ruleUsage !== undefined) {
          textRuleUsagesSchema.parse(input.ruleUsage)
          const defaults = existing.content.enabled ? existing.content.adoptedSettings! : resolveLoomScriptSettings(adopted.content.settings ?? [], {})
          for (const [id, usage] of Object.entries(input.ruleUsage)) {
            const contribution = adopted.content.contributions.find(item => item.kind === 'text-transform' && item.id === id)
            if (!contribution || contribution.kind !== 'text-transform') throw new Error(`Unknown text rule: ${id}`)
            applyTextRuleUsage(resolveTextTransformContributionRule(contribution, defaults), usage)
          }
        }
        if (input.enabled) assertRuntimeTrust(adopted.content, input.grantedCapabilities)
        const settings = input.settings ?? existing.content.settings ?? {}
        const activating = input.enabled && !existing.content.enabled
        const runtimeChanged = input.enabled !== existing.content.enabled
          || JSON.stringify([...input.grantedCapabilities].sort()) !== JSON.stringify([...existing.content.grantedCapabilities].sort())
        const runtimeRevision = existing.content.runtimeRevision + (runtimeChanged ? 1 : 0)
        const adoptedSettings = (activating || input.enabled && adopted.content.runtime === 'declarative' && input.settings !== undefined)
          ? await adoptSettings(documents, existing.content, adopted.content, settings)
          : existing.content.adoptedSettings
        const mount = await writeDocument<LoomScriptMountContent>(documents, {
          id: existing.id,
          type: applicationDocumentTypes.loomScriptMount,
          content: {
            ...existing.content,
            enabled: input.enabled,
            ...(input.enabled ? { adoptedDocumentVersion: adoptedVersion } : {}),
            orderIndex: input.orderIndex,
            ...(input.pinnedDocumentVersion !== undefined ? { pinnedDocumentVersion: input.pinnedDocumentVersion } : {}),
            grantedCapabilities: [...input.grantedCapabilities],
            settings: structuredClone(settings),
            ...(input.ruleUsage !== undefined ? { ruleUsage: structuredClone(input.ruleUsage) } : {}),
            ...(adoptedSettings !== undefined ? { adoptedSettings } : {}),
            runtimeRevision,
            updatedAt: ctx.now(),
          },
          expectedVersion: input.expectedVersion,
        })
        return toVersioned(mount)
      })
      return { mount: result.value, mutation: result.mutation }
    },

    refreshLoomScriptMount: async (input: { mountId: string; expectedVersion: number }, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.refreshLoomScriptMount', async documents => {
        const existing = await readDocument<LoomScriptMountContent>(documents, input.mountId, applicationDocumentTypes.loomScriptMount)
        if (!existing.content.enabled) throw new Error('Enable the script before refreshing its running instance')
        const script = await readDocument<LoomScriptContent>(documents, existing.content.scriptDocumentId, applicationDocumentTypes.loomScript)
        if (script.content.owner.kind === 'extension') await readLoomScriptInstallation(documents, script.content.owner)
        const adoptedVersion = existing.content.pinnedDocumentVersion ?? script.version
        const adopted = await readLoomScriptRevision(documents, script.id, adoptedVersion)
        if (!adopted) throw new Error(`Loom Script revision unavailable: ${script.id}@${adoptedVersion}`)
        assertRuntimeTrust(adopted.content, existing.content.grantedCapabilities)
        const adoptedSettings = await adoptSettings(documents, existing.content, adopted.content, existing.content.settings ?? {})
        const mount = await writeDocument<LoomScriptMountContent>(documents, {
          id: existing.id,
          type: applicationDocumentTypes.loomScriptMount,
          content: { ...existing.content, adoptedDocumentVersion: adoptedVersion, adoptedSettings, runtimeRevision: existing.content.runtimeRevision + 1, updatedAt: ctx.now() },
          expectedVersion: input.expectedVersion,
        })
        return toVersioned(mount)
      })
      return { mount: result.value, mutation: result.mutation }
    },

    deleteLoomScriptMount: async (input: { mountId: string; expectedVersion: number }, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteLoomScriptMount', async documents => {
        const existing = await readDocument<LoomScriptMountContent>(documents, input.mountId, applicationDocumentTypes.loomScriptMount)
        await documents.delete({ id: existing.id, expectedVersion: input.expectedVersion })
        return true as const
      })
      return { deleted: result.value, mutation: result.mutation }
    },

    listLoomScriptConfigs: (input: ScriptConfigQuery) => listScriptConfigs(ctx, input),
    upsertLoomScriptConfig: async (input: ScriptConfigWrite, requestContext?: RuntimeRequestContext) => {
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.upsertLoomScriptConfig'),
        dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx,
          documents => writeScriptConfig(ctx, documents, input, dataTx)),
      )
      return result.value.value
    },

    getLoomScriptSettings: async (input: { mountId: string }) => {
      const mount = await readDocument<LoomScriptMountContent>(ctx.documents, input.mountId, applicationDocumentTypes.loomScriptMount)
      const script = await readLoomScriptRevision(ctx.documents, mount.content.scriptDocumentId, mount.content.pinnedDocumentVersion)
      if (!script) throw new Error(`Loom Script revision unavailable: ${mount.content.scriptDocumentId}`)
      const adopted = await readLoomScriptRevision(ctx.documents, mount.content.scriptDocumentId, mount.content.enabled ? mount.content.adoptedDocumentVersion! : mount.content.pinnedDocumentVersion)
      if (!adopted) throw new Error('Adopted Script revision unavailable')
      const ruleDefaults = adopted.content.contributions.flatMap(contribution => contribution.kind === 'text-transform'
        ? [{ id: contribution.id, rule: resolveTextTransformContributionRule(contribution, mount.content.enabled ? mount.content.adoptedSettings! : resolveLoomScriptSettings(adopted.content.settings ?? [], {})) }] : [])
      const saved = structuredClone(mount.content.settings ?? {})
      let effective: LoomScriptSettings | undefined
      let validationError: string | undefined
      const inherited = await readInheritedSettings(ctx.documents, mount.content, script.content)
      try { effective = resolveLoomScriptSettings(script.content.settings ?? [], { ...inherited, ...saved }) }
      catch (cause) { validationError = cause instanceof Error ? cause.message : String(cause) }
      for (const item of ruleDefaults) if (item.rule.loreRefs) item.rule.loreRefs = item.rule.loreRefs.map(ref => ({ ...ref,
        nodeId: adopted.content.loreNodeReferences?.[ref.nodeId] ?? ref.nodeId, resourceId: adopted.content.loreResourceReferences?.[ref.resourceId] ?? ref.resourceId }))
      return {
        ruleDefaults,
        definitions: structuredClone(script.content.settings ?? []), saved,
        adopted: structuredClone(mount.content.enabled ? mount.content.adoptedSettings! : mount.content.adoptedSettings ?? {}),
        inherited, effective, validationError, documentVersion: script.version,
        adoptedDocumentVersion: mount.content.adoptedDocumentVersion,
      }
    },

    listLoomScriptMounts: async (input?: ListLoomScriptMountsInput) => {
      const mounts = await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount)
      return {
        mounts: mounts
          .filter(mount => !input?.target || sameOwner(mount.content.target, input.target))
          .filter(mount => !input?.scriptDocumentId || mount.content.scriptDocumentId === input.scriptDocumentId)
          .map(toVersioned),
      }
    },

    resolveLoomScriptRendererMounts: async (input?: { workspaceId?: string; timelineId?: string; presetId?: string; cardId?: string }) => {
      const timeline = input?.timelineId ? await requireNarratives(ctx).getTimeline(input.timelineId) : undefined
      if (input?.timelineId && !timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      if (timeline && input?.cardId && timeline.createdFrom?.cardId !== input.cardId) throw new Error('Script context does not match the Timeline character')
      const cardId = timeline?.createdFrom?.cardId ?? input?.cardId
      return await resolveLoomScriptRendererMounts(ctx, {
        cardId,
        currentTargets: [
          { kind: 'user' },
          ...(input?.workspaceId ? [{ kind: 'workspace' as const, workspaceId: input.workspaceId }] : []),
          ...(input?.presetId ? [{ kind: 'preset' as const, presetId: input.presetId }] : []),
          ...(cardId ? [{ kind: 'card' as const, cardId }] : []),
        ],
      })
    },
  }
}

function assertRuntimeTrust(script: LoomScriptContent, grants: readonly string[]): void {
  const independentDeclarations = script.contributions.some(contribution => contribution.kind !== 'renderer' && !contribution.requiresCode)
  if (script.runtime !== 'declarative' && script.runtime !== 'client-sandbox' && !independentDeclarations && !grants.includes(`runtime.${script.runtime}`)) {
    throw new Error(`Explicit trust is required for ${script.runtime} ${script.runtime === 'client-worker' ? 'browser worker' : 'in-process'} code`)
  }
}

function sameOwner(left: LoomScriptOwner | LoomScriptMountTarget, right: LoomScriptOwner | LoomScriptMountTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertFileName(fileName: string): void {
  if (!isLoomScriptFileName(fileName)) {
    throw new Error('Loom Script fileName must be a safe .loom.js or .md file name')
  }
}

/** Capture user values only when explicitly adopting; later global edits do not mutate a running instance. */
async function adoptSettings(
  documents: import('@loom-studio/document-store').DocumentTransaction,
  mount: LoomScriptMountContent, script: LoomScriptContent, settings: LoomScriptSettings,
): Promise<LoomScriptSettings> {
  const inherited = await readInheritedSettings(documents, mount, script)
  return resolveLoomScriptSettings(script.settings ?? [], { ...inherited, ...settings })
}

async function readInheritedSettings(
  documents: import('@loom-studio/document-store').DocumentTransaction,
  mount: LoomScriptMountContent, script: LoomScriptContent,
): Promise<LoomScriptSettings> {
  let inherited: LoomScriptSettings = {}
  if (mount.target.kind !== 'user') {
    const globals = (await listDocuments<LoomScriptMountContent>(documents, applicationDocumentTypes.loomScriptMount))
      .filter(item => item.content.scriptDocumentId === mount.scriptDocumentId && item.content.target.kind === 'user')
      .sort((a, b) => b.content.updatedAt.localeCompare(a.content.updatedAt) || b.version - a.version || a.id.localeCompare(b.id))
    inherited = globals[0]?.content.adoptedSettings ?? {}
  }
  const declared = new Set((script.settings ?? []).map(setting => setting.key))
  // A renamed/removed declaration cannot accidentally carry a hidden value into the new schema.
  inherited = Object.fromEntries(Object.entries(inherited).filter(([key]) => declared.has(key)))
  return inherited
}
