import type { DocumentRecord } from '@loom-studio/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import type {
  LoomScriptContent,
  LoomScriptMountContent,
  LoomScriptMountTarget,
  LoomScriptRuntimeMountSnapshot,
  ResolvedLoomScriptRendererMount,
} from './loom-script-contracts.js'

export async function snapshotLoomScriptMounts(
  ctx: ApplicationRuntimeContext,
  target: LoomScriptMountTarget,
): Promise<LoomScriptRuntimeMountSnapshot[]> {
  const mounts = (await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => sameTarget(mount.content.target, target))
  return await Promise.all(mounts.map(async mount => {
    const script = await readLoomScriptRevision(ctx, mount.content.scriptDocumentId, mount.content.pinnedDocumentVersion)
    return {
      mountId: mount.id,
      enabled: mount.content.enabled,
      orderIndex: mount.content.orderIndex,
      scriptDocumentId: script.id,
      documentVersion: script.version,
      sourceDigest: script.content.sourceDigest,
      contributionIds: script.content.contributions.map(contribution => contribution.renderer.id),
      requestedCapabilities: [...script.content.requestedCapabilities],
      grantedCapabilities: [...mount.content.grantedCapabilities],
    }
  }))
}

export async function resolveLoomScriptRendererMounts(
  ctx: ApplicationRuntimeContext,
  input: {
    currentTargets: LoomScriptMountTarget[]
    frozenMounts: LoomScriptRuntimeMountSnapshot[]
  },
): Promise<ResolvedLoomScriptRendererMount[]> {
  if (!ctx.blobs) throw new Error('Blob Store is not configured')
  const current = (await Promise.all(input.currentTargets.map(target => snapshotLoomScriptMounts(ctx, target)))).flat()
  const snapshots = [...input.frozenMounts, ...current]
    .sort((left, right) => left.orderIndex - right.orderIndex || left.mountId.localeCompare(right.mountId))
  return await Promise.all(snapshots.map(async snapshot => {
    const script = await readLoomScriptRevision(ctx, snapshot.scriptDocumentId, snapshot.documentVersion)
    assertSnapshotMatchesScript(snapshot, script)
    const bytes = await ctx.blobs!.read(script.content.source.blobId)
    return {
      mountId: snapshot.mountId,
      enabled: snapshot.enabled,
      orderIndex: snapshot.orderIndex,
      grantedCapabilities: [...snapshot.grantedCapabilities],
      script: {
        id: script.id,
        version: script.version,
        name: script.content.name,
        metadataId: script.content.metadataId,
        scriptVersion: script.content.scriptVersion,
        requestedCapabilities: [...script.content.requestedCapabilities],
        contributions: structuredClone(script.content.contributions),
      },
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  }))
}

async function readLoomScriptRevision(
  ctx: ApplicationRuntimeContext,
  scriptDocumentId: string,
  version?: number,
): Promise<DocumentRecord<LoomScriptContent>> {
  const script = await ctx.documents.get(scriptDocumentId, { includeTombstone: true, ...(version === undefined ? {} : { version }) })
  if (!script) throw new Error(`Loom Script not found: ${scriptDocumentId}${version === undefined ? '' : `@${version}`}`)
  if (script.type !== applicationDocumentTypes.loomScript) throw new Error(`Unexpected document type for ${scriptDocumentId}: ${script.type}`)
  return script as DocumentRecord<LoomScriptContent>
}

function assertSnapshotMatchesScript(snapshot: LoomScriptRuntimeMountSnapshot, script: DocumentRecord<LoomScriptContent>): void {
  const contributionIds = script.content.contributions.map(contribution => contribution.renderer.id)
  if (script.content.sourceDigest !== snapshot.sourceDigest
    || JSON.stringify(contributionIds) !== JSON.stringify(snapshot.contributionIds)
    || JSON.stringify(script.content.requestedCapabilities) !== JSON.stringify(snapshot.requestedCapabilities)) {
    throw new Error(`Loom Script Runtime snapshot does not match its pinned revision: ${snapshot.mountId}`)
  }
}

function sameTarget(left: LoomScriptMountTarget, right: LoomScriptMountTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
