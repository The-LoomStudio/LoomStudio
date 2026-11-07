import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { DocumentRecord, DocumentTransaction } from '@loom-studio/document-store'
import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { loomScriptMediaType } from '@loom-studio/shared/loom-scripts'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes as types } from '../foundation/document-types.js'
import { listDocuments, writeDocument } from '../foundation/document-store.js'
import type { CardBundleArtifact, ImportBundleContent } from '../cards/card-bundle-types.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import type { LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import type { PortableExtensionPayloadContent } from '../extensions/portable-payload-types.js'
import { allocateImportedTextResourceIds, importedTextResourceReferences, rebaseScriptTextResourceReferences } from '../scripts/script-text-resources.js'
import { maxEmbeddedExtensionArchiveBase64Bytes } from '../cards/card-bundle-codec.js'
import type { CardSourceContent, PreviewCardPackageUpdateResult, PreparedBlobStorageWrite } from '../types.js'
import { adoptSettings, assertRuntimeTrust } from './loom-scripts-runtime.js'

type Context = Pick<ApplicationRuntimeContext, 'blobs' | 'createId' | 'now'>
type Mapping = NonNullable<ImportBundleContent['resourceMappings']>
type Change = PreviewCardPackageUpdateResult['attachmentChanges'][number]
const mapped = (record: Record<string, string>, id: string) => Object.hasOwn(record, id) ? record[id]! : id
const hash = (source: string) => createHash('sha256').update(source).digest('hex')
function scriptEntries(artifact: CardBundleArtifact) {
  const entries = (artifact.scriptAttachments ?? []).map(attachment => ({ attachment, metadata: parseLoomScriptSource(attachment.script.source) }))
  if (new Set(entries.map(entry => entry.metadata.metadataId)).size !== entries.length) throw new Error('Card Script metadataId must be unique within its package')
  return entries
}
function contributionIds(script: Pick<LoomScriptContent, 'contributions'>) {
  return script.contributions.map(item => item.kind === 'renderer' ? `renderer:${item.renderer.id}` : `${item.kind}:${item.id}`)
}
export async function captureCardAttachments(documents: DocumentTransaction, cardId: string, bundle: ImportBundleContent, candidate: CardBundleArtifact, mapping: Mapping) {
  const scripts = await listDocuments<LoomScriptContent>(documents, types.loomScript)
  const mounts = await listDocuments<LoomScriptMountContent>(documents, types.loomScriptMount)
  const payloads = await listDocuments<PortableExtensionPayloadContent>(documents, types.portableExtensionPayload)
  const previous = scriptEntries(bundle.sourceArtifact)
  const incoming = scriptEntries(candidate)
  const scriptMap = new Map<string, { script: DocumentRecord<LoomScriptContent>; mount: DocumentRecord<LoomScriptMountContent>; adopted?: DocumentRecord<LoomScriptContent> }>()
  const changes: Change[] = []
  const blocking: string[] = []
  mapping.scripts ??= {}
  for (const entry of previous) {
    const id = entry.metadata.metadataId
    const mapped = Object.hasOwn(mapping.scripts, id) ? mapping.scripts[id] : undefined
    const matches = scripts.filter(script => (!mapped || script.id === mapped) && script.content.metadataId === id
      && bundle.documentIds.includes(script.id) && script.content.owner.kind === 'card' && script.content.owner.cardId === cardId)
    const next = incoming.find(item => item.metadata.metadataId === id)
    if (entry.attachment.resourceOrigin === 'external') {
      if (!isDeepStrictEqual(entry.attachment, next?.attachment)) blocking.push(`${id}: external Script cannot be overwritten by a Card update`)
    }
    if (matches.length !== 1) { blocking.push(`${id}: Script source mapping cannot be proven`); continue }
    const script = matches[0]!
    const targets = mounts.filter(mount => mount.content.scriptDocumentId === script.id && mount.content.target.kind === 'card' && mount.content.target.cardId === cardId && bundle.documentIds.includes(mount.id))
    if (targets.length !== 1) { blocking.push(`${id}: Script mount mapping cannot be proven`); continue }
    const mount = targets[0]!
    const adopted = mount.content.enabled ? await documents.get(script.id, { version: mount.content.adoptedDocumentVersion }) as DocumentRecord<LoomScriptContent> | undefined : undefined
    if (mount.content.enabled && !adopted) throw new Error(`Adopted Script revision unavailable: ${id}`)
    Object.defineProperty(mapping.scripts, id, { value: script.id, enumerable: true, writable: true, configurable: true })
    scriptMap.set(id, { script, mount, adopted })
  }
  for (const entry of incoming) {
    const id = entry.metadata.metadataId
    if (entry.attachment.resourceOrigin === 'external') {
      if (!isDeepStrictEqual(previous.find(item => item.metadata.metadataId === id)?.attachment, entry.attachment)) blocking.push(`${id}: external Script requires separate adoption`)
      continue
    }
    const local = scriptMap.get(id)
    const oldEntry = previous.find(item => item.metadata.metadataId === id)
    if (!local && oldEntry) continue
    const changed = !local || local.script.content.sourceDigest !== hash(entry.attachment.script.source)
      || !isDeepStrictEqual(oldEntry?.attachment.loreNodeReferences, entry.attachment.loreNodeReferences)
      || !isDeepStrictEqual(oldEntry?.attachment.loreResourceReferences, entry.attachment.loreResourceReferences)
      || !isDeepStrictEqual(oldEntry?.attachment.textResourceReferences, entry.attachment.textResourceReferences)
    if (!changed) continue
    if (local?.mount.content.pinnedDocumentVersion !== undefined) blocking.push(`${id}: pinned Script revision cannot be changed by a package update`)
    const baseline = local?.adopted?.content ?? local?.script.content
    const addedCapabilities = entry.metadata.requestedCapabilities.filter(capability => !baseline?.requestedCapabilities.includes(capability))
    const addedRequirements = (entry.metadata.requires ?? []).filter(requirement => !baseline?.requires?.includes(requirement))
    const beforeContributions = new Set(baseline ? contributionIds(baseline) : [])
    const addedContributions = contributionIds(entry.metadata).filter(id => !beforeContributions.has(id))
    changes.push({ kind: 'script', id, name: entry.metadata.name, action: local ? 'update' : 'add', addedCapabilities, addedContributions, addedRequirements,
      requiresAdoption: !local || addedCapabilities.length > 0 || addedContributions.length > 0 || addedRequirements.length > 0 || baseline?.runtime !== entry.metadata.runtime })
  }
  for (const [id, local] of scriptMap) if (!incoming.some(item => item.metadata.metadataId === id) && previous.find(item => item.metadata.metadataId === id)?.attachment.resourceOrigin !== 'external') {
    if (local.mount.content.pinnedDocumentVersion !== undefined) blocking.push(`${id}: pinned Script cannot be removed by a package update`)
    changes.push({ kind: 'script', id, name: local.script.content.name, action: 'remove' })
  }
  const payloadMap = new Map<string, DocumentRecord<PortableExtensionPayloadContent>>()
  for (const payload of bundle.sourceArtifact.extensionPayloads ?? []) {
    const matches = payloads.filter(local => bundle.documentIds.includes(local.id) && local.content.artifactPayloadId === payload.id
      && local.content.packageId === payload.packageId && local.content.ownerInstallationId === extensionInstallationId(payload.packageId, { kind: 'card', cardId }))
    if (matches.length !== 1) { blocking.push(`${payload.id}: payload source mapping cannot be proven`); continue }
    payloadMap.set(payload.id, matches[0]!)
  }
  for (const payload of candidate.extensionPayloads ?? []) {
    const local = payloadMap.get(payload.id)
    if (local && local.content.packageId !== payload.packageId) { blocking.push(`${payload.id}: payload package identity changed`); continue }
    const previous = bundle.sourceArtifact.extensionPayloads?.find(item => item.id === payload.id)
    if (payload.resourceOrigin === 'external' || previous?.resourceOrigin === 'external') {
      if (!isDeepStrictEqual(payload, previous)) blocking.push(`${payload.id}: external payload cannot be overwritten`)
      continue
    }
    const { artifactPayloadId: _id, ownerInstallationId: _owner, createdAt: _created, updatedAt: _updated, ...content } = local?.content ?? {} as PortableExtensionPayloadContent
    const { id, ...incomingContent } = payload
    if (!local || !isDeepStrictEqual(content, incomingContent)) changes.push({ kind: 'payload', id, name: payload.fileName, action: local ? 'update' : 'add' })
  }
  for (const [id, local] of payloadMap) if (!candidate.extensionPayloads?.some(payload => payload.id === id)) {
    if (local.content.resourceOrigin === 'external') blocking.push(`${id}: external payload cannot be removed`)
    else changes.push({ kind: 'payload', id, name: local.content.fileName, action: 'remove' })
  }
  // Include all mounts for these scripts: inherited user settings participate in refresh.
  const relatedMounts = mounts.filter(mount => [...scriptMap.values()].some(item => item.script.id === mount.content.scriptDocumentId))
  return { changes, blocking, scriptMap, payloadMap, incoming, evidence: { scripts: [...scriptMap.values()], mounts: relatedMounts, payloads: [...payloadMap.values()] } }
}
export async function prepareCardAttachmentBlobs(ctx: Context, artifact: CardBundleArtifact, changes: Change[]) {
  const changed = new Set(changes.filter(item => item.kind === 'script' && item.action !== 'remove').map(item => item.id))
  const prepared = new Map<string, PreparedBlobStorageWrite>()
  for (const entry of scriptEntries(artifact)) {
    if (!changed.has(entry.metadata.metadataId) || entry.attachment.resourceOrigin === 'external') continue
    if (!ctx.blobs) throw new Error('Blob Store is required to update Card Scripts')
    prepared.set(entry.metadata.metadataId, await ctx.blobs.prepareWrite({ source: new TextEncoder().encode(entry.attachment.script.source), mediaType: loomScriptMediaType(entry.attachment.script.fileName) }))
  }
  return prepared
}
export async function applyCardAttachments(ctx: Context, documents: DocumentTransaction, dataTx: SqliteDataTransaction,
  cardId: string, bundle: ImportBundleContent, candidate: CardBundleArtifact, mapping: Mapping,
  captured: Awaited<ReturnType<typeof captureCardAttachments>>, prepared: Map<string, PreparedBlobStorageWrite>) {
  const documentIds = new Set(bundle.documentIds)
  const payloadIds = new Set([...captured.payloadMap.values()].map(item => item.id))
  const items = captured.incoming.map(entry => {
    const local = captured.scriptMap.get(entry.metadata.metadataId)
    const allocated = allocateImportedTextResourceIds(entry.metadata, entry.attachment, ctx.createId)
    return { ...entry, textResourceIds: { ...allocated, ...local?.script.content.textResourceIds } }
  })
  const references = importedTextResourceReferences(items)
  for (const change of captured.changes) {
    if (change.kind === 'payload') {
      const existing = captured.payloadMap.get(change.id)
      if (change.action === 'remove') { payloadIds.delete(existing!.id); documentIds.delete(existing!.id); continue }
      const { id: artifactPayloadId, ...payload } = candidate.extensionPayloads!.find(item => item.id === change.id)!
      const document = await writeDocument<PortableExtensionPayloadContent>(documents, { id: existing?.id ?? ctx.createId('portable-payload'), type: types.portableExtensionPayload,
        expectedVersion: existing?.version ?? 'new', content: { ...payload, artifactPayloadId,
          ownerInstallationId: extensionInstallationId(payload.packageId, { kind: 'card', cardId }), createdAt: existing?.content.createdAt ?? ctx.now(), updatedAt: ctx.now() } })
      documentIds.add(document.id); payloadIds.add(document.id)
      continue
    }
    const local = captured.scriptMap.get(change.id)
    if (change.action === 'remove') {
      await documents.delete({ id: local!.mount.id, expectedVersion: local!.mount.version })
      documentIds.delete(local!.mount.id)
      documentIds.delete(local!.script.id)
      delete mapping.scripts![change.id]
      continue
    }
    const item = items.find(item => item.metadata.metadataId === change.id)!
    const blob = ctx.blobs!.participateWrite(dataTx, prepared.get(change.id)!).blob
    const script = await writeDocument<LoomScriptContent>(documents, { id: local?.script.id ?? ctx.createId('loom-script'), type: types.loomScript,
      expectedVersion: local?.script.version ?? 'new', content: { owner: { kind: 'card', cardId }, ...item.metadata,
        source: { blobId: blob.id, mediaType: loomScriptMediaType(item.attachment.script.fileName), fileName: item.attachment.script.fileName }, sourceDigest: blob.sha256,
        textResourceIds: item.textResourceIds, textResourceReferences: rebaseScriptTextResourceReferences(item.attachment, references),
        loreNodeReferences: { ...mapping.nodes, ...Object.fromEntries(Object.entries(item.attachment.loreNodeReferences ?? {}).map(([id, target]) => [id, mapped(mapping.nodes, target)])) },
        loreResourceReferences: Object.fromEntries(Object.entries(item.attachment.loreResourceReferences ?? {}).map(([id, target]) => [id, mapped(mapping.resources, target)])),
        createdAt: local?.script.content.createdAt ?? ctx.now(), updatedAt: ctx.now() } })
    Object.defineProperty(mapping.scripts!, change.id, { value: script.id, enumerable: true, writable: true, configurable: true })
    documentIds.add(script.id)
    if (!local) {
      const mount = await writeDocument<LoomScriptMountContent>(documents, { id: ctx.createId('loom-script-mount'), type: types.loomScriptMount, expectedVersion: 'new', content: {
        target: { kind: 'card', cardId }, scriptDocumentId: script.id, enabled: false, runtimeRevision: 0, orderIndex: item.attachment.orderIndex,
        grantedCapabilities: [], settings: item.attachment.settings ?? {}, ...(item.attachment.ruleUsage ? { ruleUsage: item.attachment.ruleUsage } : {}),
        origin: { kind: 'card-bundle-import', artifactId: candidate.artifactId, orderOverride: true }, createdAt: ctx.now(), updatedAt: ctx.now() } })
      documentIds.add(mount.id)
    } else if (local.mount.content.enabled && !change.requiresAdoption) {
      assertRuntimeTrust(script.content, local.mount.content.grantedCapabilities)
      const adoptedSettings = await adoptSettings(documents, local.mount.content, script.content, local.mount.content.settings ?? {})
      await writeDocument<LoomScriptMountContent>(documents, { id: local.mount.id, type: types.loomScriptMount, expectedVersion: local.mount.version,
        content: { ...local.mount.content, adoptedDocumentVersion: script.version, adoptedSettings, runtimeRevision: local.mount.content.runtimeRevision + 1, updatedAt: ctx.now() } })
    }
  }
  return { documentIds: [...documentIds], payloadIds: [...payloadIds] }
}


type Archives = NonNullable<CardSourceContent['extensionPackages']>
export function captureCardArchives(current: Archives, old: CardBundleArtifact, candidate: CardBundleArtifact, mapping: Mapping) {
  const changes: Change[] = []
  const blocking: string[] = []
  const previous = new Map((old.extensionPackages ?? []).map(item => [item.packageId, item]))
  const incoming = new Map((candidate.extensionPackages ?? []).map(item => [item.packageId, item]))
  for (const id of new Set([...previous.keys(), ...incoming.keys()])) {
    const before = previous.get(id)
    const after = incoming.get(id)
    if (isDeepStrictEqual(before, after)) continue
    const local = current.find(item => item.packageId === id)
    if (before && local && (!mapping.extensions || !Object.hasOwn(mapping.extensions, id) || mapping.extensions[id] !== local.blobId)) {
      blocking.push(`${id}: embedded archive source mapping cannot be proven; preserve the current archive and attach the replacement separately`)
      continue
    }
    if (!before && local) { blocking.push(`${id}: a separately attached archive already occupies this package ID`); continue }
    changes.push({ kind: 'extension', id, name: id, action: !after ? 'remove' : local ? 'update' : 'add', requiresAdoption: true })
  }
  return { changes, blocking }
}
export async function prepareCardArchives(ctx: Context, current: Archives, candidate: CardBundleArtifact, changes: Change[]) {
  const changed = new Set(changes.map(item => item.id))
  const retained = current.filter(item => !changed.has(item.packageId))
  const replacements = (candidate.extensionPackages ?? []).filter(item => changed.has(item.packageId))
  if (retained.length + replacements.length > 32) throw new Error('Card extensionPackages must contain at most 32 archives')
  const prepared = new Map<string, PreparedBlobStorageWrite>()
  if (!changes.length) return prepared
  if (!replacements.length) return prepared
  if (!ctx.blobs) throw new Error('Blob Store is required to update embedded extension archives')
  let bytes = replacements.reduce((total, item) => total + item.archiveBase64.length, 0)
  for (const item of retained) {
    const source = await ctx.blobs.read(item.blobId, { maxBytes: maxEmbeddedExtensionArchiveBase64Bytes })
    bytes += Math.ceil(source.byteLength / 3) * 4
  }
  if (bytes > maxEmbeddedExtensionArchiveBase64Bytes) throw new Error('Embedded extension archives exceed the Card bundle budget')
  for (const item of replacements) prepared.set(item.packageId, await ctx.blobs.prepareWrite({ source: Buffer.from(item.archiveBase64, 'base64'), mediaType: 'application/zip' }))
  return prepared
}
export function applyCardArchives(ctx: Context, dataTx: SqliteDataTransaction, current: Archives, candidate: CardBundleArtifact,
  mapping: Mapping, changes: Change[], prepared: Map<string, PreparedBlobStorageWrite>): Archives {
  if (!changes.length) return current
  const changed = new Set(changes.map(item => item.id))
  const next = current.filter(item => !changed.has(item.packageId))
  mapping.extensions ??= {}
  for (const change of changes) {
    delete mapping.extensions[change.id]
    if (change.action === 'remove') continue
    const archive = candidate.extensionPackages!.find(item => item.packageId === change.id)!
    const blob = ctx.blobs!.participateWrite(dataTx, prepared.get(change.id)!).blob
    next.push({ packageId: archive.packageId, version: archive.version, blobId: blob.id })
    Object.defineProperty(mapping.extensions, change.id, { value: blob.id, enumerable: true, writable: true, configurable: true })
  }
  return next
}
