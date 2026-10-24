import type { DocumentRecord, DocumentTransaction } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { ExtensionInstallationContent, TextTransformRuleContent } from '../types.js'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import type {
  LoomScriptContent,
  LoomScriptOwner,
  LoomScriptMountContent,
  LoomScriptMountTarget,
  LoomScriptRuntimeMountSnapshot,
  ResolvedLoomScriptRendererMount,
  UnavailableLoomScriptMount,
} from './loom-script-contracts.js'

export async function snapshotLoomScriptMounts(
  ctx: Pick<ApplicationRuntimeContext, 'documents'>,
  target: LoomScriptMountTarget,
): Promise<{ snapshots: LoomScriptRuntimeMountSnapshot[]; unavailableMounts: UnavailableLoomScriptMount[] }> {
  const mounts = (await listDocuments<LoomScriptMountContent>(ctx.documents, applicationDocumentTypes.loomScriptMount))
    .filter(mount => sameTarget(mount.content.target, target))
  const unavailableMounts: UnavailableLoomScriptMount[] = []
  const snapshots = await Promise.all(mounts.map(async mount => {
    const script = await readLoomScriptRevision(ctx.documents, mount.content.scriptDocumentId,
      mount.content.enabled ? mount.content.adoptedDocumentVersion ?? mount.content.pinnedDocumentVersion : mount.content.pinnedDocumentVersion)
    if (!script) {
      unavailableMounts.push({
        mountId: mount.id, scriptDocumentId: mount.content.scriptDocumentId, enabled: mount.content.enabled,
        available: false, severity: 'warning', reason: 'script-missing',
        message: `Loom Script unavailable: ${mount.content.scriptDocumentId}${mount.content.pinnedDocumentVersion === undefined ? '' : `@${mount.content.pinnedDocumentVersion}`}`,
      })
      return undefined
    }
    return {
      mountId: mount.id,
      mountVersion: mount.version,
      target: mount.content.target,
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
  return { snapshots: snapshots.filter(snapshot => snapshot !== undefined), unavailableMounts }
}

export async function resolveLoomScriptRendererMounts(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'blobs'>,
  input: {
    currentTargets: LoomScriptMountTarget[]
    cardId?: string
  },
): Promise<{ mounts: ResolvedLoomScriptRendererMount[]; unavailableMounts: UnavailableLoomScriptMount[] }> {
  if (!ctx.blobs) throw new Error('Blob Store is not configured')
  const batches = await Promise.all(input.currentTargets.map(target => snapshotLoomScriptMounts(ctx, target)))
  const current = batches.flatMap(batch => batch.snapshots)
  const unavailableMounts = batches.flatMap(batch => batch.unavailableMounts)
  const snapshots = current.sort((left, right) => left.orderIndex - right.orderIndex || left.mountId.localeCompare(right.mountId))
  const resolved = await Promise.all(snapshots.map(async snapshot => {
    const script = await readLoomScriptRevision(ctx.documents, snapshot.scriptDocumentId, snapshot.documentVersion)
    if (!script) {
      unavailableMounts.push({
        mountId: snapshot.mountId, scriptDocumentId: snapshot.scriptDocumentId, enabled: snapshot.enabled,
        available: false, severity: 'warning', reason: 'script-missing',
        message: `Loom Script unavailable: ${snapshot.scriptDocumentId}@${snapshot.documentVersion}`,
      })
      return undefined
    }
    if (script.content.owner.kind === 'extension') {
      const target = await readOptionalLoomScriptInstallation(ctx.documents, script.content.owner)
      if (!target) {
        unavailableMounts.push({
          mountId: snapshot.mountId, scriptDocumentId: snapshot.scriptDocumentId, enabled: snapshot.enabled,
          available: false, severity: 'warning', reason: 'installation-missing',
          message: `Loom Script installation unavailable: ${script.content.owner.installationId}`,
        })
        return undefined
      }
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
      mountVersion: snapshot.mountVersion,
      target: snapshot.target,
      orderIndex: snapshot.orderIndex,
      grantedCapabilities: [...snapshot.grantedCapabilities],
      script: {
        id: script.id,
        version: script.version,
        name: script.content.name,
        metadataId: script.content.metadataId,
        scriptVersion: script.content.scriptVersion,
        runtime: script.content.runtime,
        requires: script.content.requires,
        requestedCapabilities: [...script.content.requestedCapabilities],
        contributions,
      },
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  }))
  return {
    mounts: resolved.filter(mount => mount !== undefined),
    unavailableMounts: unavailableMounts.sort((left, right) => left.mountId.localeCompare(right.mountId)),
  }
}

export async function readLoomScriptInstallation(
  documents: DocumentTransaction,
  owner: Extract<LoomScriptOwner, { kind: 'extension' }>,
) {
  const target = await readOptionalLoomScriptInstallation(documents, owner)
  if (!target) throw new Error(`Document not found: ${owner.installationId}`)
  return target
}

async function readOptionalLoomScriptInstallation(
  documents: DocumentTransaction,
  owner: Extract<LoomScriptOwner, { kind: 'extension' }>,
) {
  const document = await documents.get(owner.installationId)
  if (!document) return undefined
  if (document.type !== applicationDocumentTypes.extensionInstallation) {
    throw new Error(`Unexpected document type for ${owner.installationId}: ${document.type}`)
  }
  const installation = document as DocumentRecord<ExtensionInstallationContent>
  if (installation.content.packageId !== owner.packageId
    || extensionInstallationId(owner.packageId, installation.content.target) !== owner.installationId) {
    throw new Error('Loom Script installation owner does not match')
  }
  return installation.content.target
}

export async function readLoomScriptRevision(
  documents: DocumentTransaction,
  scriptDocumentId: string,
  version?: number,
): Promise<DocumentRecord<LoomScriptContent> | undefined> {
  const current = await documents.get(scriptDocumentId)
  if (!current) return undefined
  const script = version === undefined || version === current.version ? current : await documents.get(scriptDocumentId, { version })
  if (!script) return undefined
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
