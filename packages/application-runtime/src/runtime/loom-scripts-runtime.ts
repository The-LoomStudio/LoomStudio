import type { DocumentTransaction } from '@loom-studio/document-store'
import type { JsonObject } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from '../foundation/document-store.js'
import { executeBlobDocumentMutation, executeDocumentMutation } from '../foundation/mutation.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import { resolveLoomScriptRendererMounts } from '../scripts/loom-script-resolution.js'
import { readTimelineRuntimeContext } from '../narrative/timeline-runtime-context.js'
import type {
  LoomScriptArtifact,
  LoomScriptContent,
  LoomScriptMountContent,
  LoomScriptMountTarget,
  LoomScriptOwner,
} from '../scripts/loom-script-contracts.js'
import type { RuntimeRequestContext } from '../types.js'

export function createLoomScriptsRuntimeMethods(ctx: ApplicationRuntimeContext) {
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
          await assertMetadataIdentityAvailable(documents, input.owner, metadata.metadataId, blob.sha256)
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
          await assertMetadataIdentityAvailable(documents, existing.content.owner, metadata.metadataId, blob.sha256, existing.id)
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

    createLoomScriptMount: async (input: {
      target: LoomScriptMountTarget
      scriptDocumentId: string
      orderIndex: number
      pinnedDocumentVersion?: number
      origin?: JsonObject
    }, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.createLoomScriptMount', async documents => {
        await readDocument<LoomScriptContent>(documents, input.scriptDocumentId, applicationDocumentTypes.loomScript)
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

    updateLoomScriptMount: async (input: {
      mountId: string
      expectedVersion: number
      enabled: boolean
      orderIndex: number
      pinnedDocumentVersion?: number
      grantedCapabilities: string[]
    }, requestContext?: RuntimeRequestContext) => {
      const result = await executeDocumentMutation(ctx.documents, requestContext, 'application.updateLoomScriptMount', async documents => {
        const existing = await readDocument<LoomScriptMountContent>(documents, input.mountId, applicationDocumentTypes.loomScriptMount)
        const script = await readDocument<LoomScriptContent>(documents, existing.content.scriptDocumentId, applicationDocumentTypes.loomScript)
        const requested = new Set(script.content.requestedCapabilities)
        if (new Set(input.grantedCapabilities).size !== input.grantedCapabilities.length
          || input.grantedCapabilities.some(capability => !requested.has(capability))) {
          throw new Error('Loom Script Mount grants must be unique requested capabilities')
        }
        const mount = await writeDocument<LoomScriptMountContent>(documents, {
          id: existing.id,
          type: applicationDocumentTypes.loomScriptMount,
          content: {
            ...existing.content,
            enabled: input.enabled,
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

    listLoomScriptMounts: async (input?: { target?: LoomScriptMountTarget; scriptDocumentId?: string }) => {
      const mounts = await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount)
      return {
        mounts: mounts
          .filter(mount => !input?.target || sameOwner(mount.content.target, input.target))
          .filter(mount => !input?.scriptDocumentId || mount.content.scriptDocumentId === input.scriptDocumentId)
          .map(toVersioned),
      }
    },

    resolveLoomScriptRendererMounts: async (input?: { workspaceId?: string; timelineId?: string; presetId?: string }) => {
      const runtimeContext = input?.timelineId ? await readTimelineRuntimeContext(ctx, input.timelineId) : undefined
      return {
        mounts: await resolveLoomScriptRendererMounts(ctx, {
          currentTargets: [
            { kind: 'user' },
            ...(input?.workspaceId ? [{ kind: 'workspace' as const, workspaceId: input.workspaceId }] : []),
            ...(input?.presetId ? [{ kind: 'preset' as const, presetId: input.presetId }] : []),
          ],
          frozenMounts: runtimeContext?.loomScriptMounts ?? [],
        }),
      }
    },
  }
}

async function assertMetadataIdentityAvailable(
  documents: DocumentTransaction,
  owner: LoomScriptOwner,
  metadataId: string,
  sourceDigest: string,
  ignoredDocumentId?: string,
): Promise<void> {
  const scripts = await listDocuments<LoomScriptContent>(documents, applicationDocumentTypes.loomScript)
  const conflict = scripts.find(script => script.id !== ignoredDocumentId
    && sameOwner(script.content.owner, owner)
    && script.content.metadataId === metadataId)
  if (!conflict) return
  if (conflict.content.sourceDigest !== sourceDigest) {
    throw new Error(`Loom Script Metadata id conflict for owner: ${metadataId}`)
  }
  throw new Error(`Loom Script Metadata id already exists for owner: ${metadataId}`)
}

function sameOwner(left: LoomScriptOwner | LoomScriptMountTarget, right: LoomScriptOwner | LoomScriptMountTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertFileName(fileName: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.loom\.js$/.test(fileName)) {
    throw new Error('Loom Script fileName must be a safe .loom.js file name')
  }
}
