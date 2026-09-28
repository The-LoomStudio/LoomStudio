import type { DocumentRecord, DocumentTransaction } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { ExtensionInstallationContent, TextTransformRuleContent } from '../types.js'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument } from '../foundation/document-store.js'
import type {
  LoomScriptContent,
  LoomScriptOwner,
  LoomScriptMountContent,
  LoomScriptMountTarget,
  LoomScriptRuntimeMountSnapshot,
  ResolvedLoomScriptRendererMount,
} from './loom-script-contracts.js'

export async function snapshotLoomScriptMounts(
  ctx: Pick<ApplicationRuntimeContext, 'documents'>,
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
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'blobs'>,
  input: {
    currentTargets: LoomScriptMountTarget[]
    cardId?: string
  },
): Promise<ResolvedLoomScriptRendererMount[]> {
  if (!ctx.blobs) throw new Error('Blob Store is not configured')
  const current = (await Promise.all(input.currentTargets.map(target => snapshotLoomScriptMounts(ctx, target)))).flat()
  const snapshots = current.sort((left, right) => left.orderIndex - right.orderIndex || left.mountId.localeCompare(right.mountId))
  const resolved = await Promise.all(snapshots.map(async snapshot => {
    const script = await readLoomScriptRevision(ctx, snapshot.scriptDocumentId, snapshot.documentVersion)
    if (script.content.owner.kind === 'extension') {
      const target = await readLoomScriptInstallation(ctx.documents, script.content.owner)
      if (target.kind === 'card' && target.cardId !== input.cardId) return undefined
    }
    assertSnapshotMatchesScript(snapshot, script)
    const contributions = structuredClone(script.content.contributions)
    const owner = script.content.owner
    if (owner.kind === 'extension' && contributions.some(contribution => contribution.inputs.some(value => value.kind === 'match'))) {
      const rules = await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)
      const localRules = new Map(rules.filter(rule => rule.content.origin?.packageId === owner.packageId
        && rule.content.origin.installationId === owner.installationId)
        .map(rule => [rule.content.origin!.contributionId, rule.id]))
      for (const contribution of contributions) for (const input of contribution.inputs) {
        if (input.kind === 'match') input.ruleId = localRules.get(input.ruleId) ?? input.ruleId
      }
    }
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
        contributions,
      },
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  }))
  return resolved.filter((mount): mount is ResolvedLoomScriptRendererMount => mount !== undefined)
}

export async function readLoomScriptInstallation(
  documents: DocumentTransaction,
  owner: Extract<LoomScriptOwner, { kind: 'extension' }>,
) {
  const installation = await readDocument<ExtensionInstallationContent>(documents, owner.installationId, applicationDocumentTypes.extensionInstallation)
  if (installation.content.packageId !== owner.packageId
    || extensionInstallationId(owner.packageId, installation.content.target) !== owner.installationId) {
    throw new Error('Loom Script installation owner does not match')
  }
  return installation.content.target
}

async function readLoomScriptRevision(
  ctx: Pick<ApplicationRuntimeContext, 'documents'>,
  scriptDocumentId: string,
  version?: number,
): Promise<DocumentRecord<LoomScriptContent>> {
  const script = await ctx.documents.get(scriptDocumentId, version === undefined ? undefined : { version })
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
