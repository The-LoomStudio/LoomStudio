import type { CreateLoomScriptMountInput, UpdateLoomScriptMountInput, ListLoomScriptMountsInput } from '@loom-studio/shared/loom-scripts'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { executeBlobDocumentMutation, executeDocumentMutation } from '../foundation/mutation.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import { readLoomScriptInstallation, readLoomScriptRevision, resolveLoomScriptRendererMounts } from '../scripts/loom-script-resolution.js'
import { requireNarratives } from './context.js'
import type {
  LoomScriptArtifact,
  LoomScriptContent,
  LoomScriptMountContent,
  LoomScriptMountTarget,
  LoomScriptOwner,
} from '../scripts/loom-script-contracts.js'
import type { RuntimeRequestContext } from '../types.js'

type LoomScriptsRuntimeContext = Pick<ApplicationRuntimeContext, 'blobs' | 'createId' | 'dataEngine' | 'documents' | 'narratives' | 'now'>

/** Freeze pre-existing enabled mounts before any runtime starts or new source is saved. */
export async function initializeLoomScriptAdoptions(ctx: Pick<LoomScriptsRuntimeContext, 'documents' | 'now'>): Promise<void> {
  const mounts = await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount)
  for (const mount of mounts) {
    if (!mount.content.enabled || mount.content.adoptedDocumentVersion !== undefined) continue
    const script = await readLoomScriptRevision(ctx.documents, mount.content.scriptDocumentId, mount.content.pinnedDocumentVersion)
    if (!script) continue
    await ctx.documents.write({
      id: mount.id, type: applicationDocumentTypes.loomScriptMount, expectedVersion: mount.version,
      content: { ...mount.content, adoptedDocumentVersion: script.version, updatedAt: ctx.now() },
      actor: { kind: 'system', id: 'loom-script' }, reason: 'application.initializeLoomScriptAdoptions',
    })
  }
}

export function createLoomScriptsRuntimeMethods(ctx: LoomScriptsRuntimeContext) {
  return {
    importLoomScript: async (input: {
      owner: LoomScriptOwner
      fileName: string
      source: string
    }, requestContext?: RuntimeRequestContext) => {
      assertFileName(input.fileName)
      const metadata = parseLoomScriptSource(input.source)
      const timestamp = ctx.now()
      const result = await executeBlobDocumentMutation(
        ctx,
        requestContext,
        'application.importLoomScript',
        { bytes: new TextEncoder().encode(input.source), mediaType: 'text/javascript' },
        async (documents, blob) => {
          if (input.owner.kind === 'extension') await readLoomScriptInstallation(documents, input.owner)
          const document = await writeDocument<LoomScriptContent>(documents, {
            id: ctx.createId('loom-script'),
            type: applicationDocumentTypes.loomScript,
            content: {
              owner: structuredClone(input.owner),
              ...metadata,
              source: { blobId: blob.id, mediaType: 'text/javascript', fileName: input.fileName },
              sourceDigest: blob.sha256,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            ...(input.owner.kind === 'extension' ? {
              meta: { ownerExtensionId: input.owner.packageId, ownerInstallationId: input.owner.installationId },
            } : {}),
            expectedVersion: 'new',
          })
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
      const timestamp = ctx.now()
      const result = await executeBlobDocumentMutation(
        ctx,
        requestContext,
        'application.updateLoomScript',
        { bytes: new TextEncoder().encode(input.source), mediaType: 'text/javascript' },
        async (documents, blob) => {
          const existing = await readDocument<LoomScriptContent>(documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)
          if (existing.content.owner.kind === 'extension') await readLoomScriptInstallation(documents, existing.content.owner)
          const document = await writeDocument<LoomScriptContent>(documents, {
            id: existing.id,
            type: applicationDocumentTypes.loomScript,
            content: {
              owner: structuredClone(existing.content.owner),
              ...metadata,
              source: { blobId: blob.id, mediaType: 'text/javascript', fileName: input.fileName },
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
          ? existing.content.adoptedDocumentVersion ?? input.pinnedDocumentVersion ?? script.version
          : input.pinnedDocumentVersion ?? script.version
        const adopted = await readLoomScriptRevision(documents, script.id, adoptedVersion)
        if (!adopted) throw new Error(`Loom Script revision unavailable: ${script.id}@${adoptedVersion}`)
        // Allow grants for the saved replacement while retaining the running revision's permissions.
        const requested = new Set([...script.content.requestedCapabilities, ...adopted.content.requestedCapabilities, ...existing.content.grantedCapabilities])
        if (new Set(input.grantedCapabilities).size !== input.grantedCapabilities.length
          || input.grantedCapabilities.some(capability => !requested.has(capability))) {
          throw new Error('Loom Script Mount grants must be unique requested capabilities')
        }
        if (input.enabled) assertRuntimeTrust(adopted.content, input.grantedCapabilities)
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
        const mount = await writeDocument<LoomScriptMountContent>(documents, {
          id: existing.id,
          type: applicationDocumentTypes.loomScriptMount,
          content: { ...existing.content, adoptedDocumentVersion: adoptedVersion, updatedAt: ctx.now() },
          expectedVersion: input.expectedVersion,
        })
        return toVersioned(mount)
      })
      return { mount: result.value, mutation: result.mutation }
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
  if (script.runtime !== 'client-sandbox' && !grants.includes(`runtime.${script.runtime}`)) {
    throw new Error(`Explicit trust is required for ${script.runtime} ${script.runtime === 'client-worker' ? 'browser worker' : 'in-process'} code`)
  }
}

function sameOwner(left: LoomScriptOwner | LoomScriptMountTarget, right: LoomScriptOwner | LoomScriptMountTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertFileName(fileName: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.loom\.js$/.test(fileName)) {
    throw new Error('Loom Script fileName must be a safe .loom.js file name')
  }
}
