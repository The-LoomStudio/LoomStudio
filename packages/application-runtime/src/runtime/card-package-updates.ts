import { captureCardAttachments, prepareCardAttachmentBlobs, applyCardAttachments, captureCardArchives, prepareCardArchives, applyCardArchives } from './card-package-attachments.js'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { PromptResource, PromptResourceStore } from '@loom-studio/application-data'
import type { DocumentTransaction } from '@loom-studio/document-store'
import type { JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument, writeDocument } from '../foundation/document-store.js'
import { collectPages } from '../foundation/pagination.js'
import { createSourceArtifactRef, normalizeCardBundleArtifact } from '../cards/card-bundle-codec.js'
import { normalizeCardEditableFields, readCardEditableFields } from '../cards/card-fields.js'
import type { ImportBundleContent } from '../cards/card-bundle-types.js'
import { fromStoredResource, toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
import type { PromptResourceArtifact, PromptResourceNode } from '../prompt/prompt-resource-types.js'
import type { ApplyCardPackageUpdateInput, CardPackageEditableField, CardSourceContent, PreviewCardPackageUpdateInput, PreviewCardPackageUpdateResult, RuntimeRequestContext, UpdateCardResult } from '../types.js'
import { promptResourceWriteContext, requireDocumentParticipant } from './context.js'

const fields: CardPackageEditableField[] = ['name', 'userName', 'description', 'preset', 'opening', 'lore', 'macros', 'macroOptions']
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue
const equal = (left: unknown, right: unknown) => isDeepStrictEqual(json(left), json(right))
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}
function mapped(record: Record<string, string>, key: string): string | undefined { return Object.hasOwn(record, key) ? record[key] : undefined }
function setMapping(record: Record<string, string>, key: string, value: string): void { Object.defineProperty(record, key, { configurable: true, enumerable: true, writable: true, value }) }
function walk(node: PromptResourceNode): PromptResourceNode[] { return [node, ...(node.children ?? []).flatMap(walk)] }
function remap(root: PromptResourceNode, nodes: Record<string, string>, implicit: Set<string>): PromptResourceNode {
  return { ...structuredClone(root), id: mapped(nodes, root.id) ?? root.id,
    ...(root.capabilities?.targetAnchorId && implicit.has(root.capabilities.targetAnchorId) ? { capabilities: { ...root.capabilities, targetAnchorId: mapped(nodes, root.capabilities.targetAnchorId) ?? root.capabilities.targetAnchorId } } : {}),
    ...(root.children ? { children: root.children.map(child => remap(child, nodes, implicit)) } : {}),
  }
}
function content(resource: PromptResource): PromptResourceArtifact {
  const value = fromStoredResource(resource)
  return { format: 'loom.promptResource', schemaVersion: 2, resourceKind: value.resourceKind, rootNode: value.rootNode,
    macros: value.macros ?? {}, macroOptions: value.macroOptions ?? {} }
}
type Context = Pick<ApplicationRuntimeContext, 'dataEngine' | 'documents' | 'promptResources' | 'now' | 'createId' | 'blobs'>

export function createCardPackageUpdateMethods(ctx: Context) {
  async function capture(input: PreviewCardPackageUpdateInput, documents: DocumentTransaction = ctx.documents,
    resourceStore: Pick<PromptResourceStore, 'listResources'> = ctx.promptResources) {
    const candidate = normalizeCardBundleArtifact(input.artifact)
    const card = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
    if (card.version !== input.expectedVersion) throw new Error('Card changed; preview the update again')
    if (card.content.artifactId !== candidate.artifactId) throw new Error('Card package identity does not match; import it as a new card')
    if (!card.content.importBundleId) throw new Error('Card has no import mapping; import the package as a new card')
    const bundle = await readDocument<ImportBundleContent>(documents, card.content.importBundleId, applicationDocumentTypes.importBundle)
    if (bundle.content.cardId !== card.id || bundle.content.sourceArtifact.artifactId !== candidate.artifactId) throw new Error('Card source identity does not match')
    const resources = await collectPages(async cursor => { const page = await resourceStore.listResources({ includeTombstone: true, cursor, limit: 100 }); return { items: page.resources, nextCursor: page.nextCursor } })
    const byId = new Map(resources.map(resource => [resource.id, resource]))
    const old = bundle.content.sourceArtifact
    let mapping = structuredClone(bundle.content.resourceMappings)
    if (!mapping) {
      if (old.contextAssets.length !== bundle.content.promptResourceIds.length || new Set(bundle.content.promptResourceIds).size !== bundle.content.promptResourceIds.length) throw new Error('Legacy Card resource mapping is ambiguous; import as a new card')
      mapping = { resources: {}, nodes: {} }
      for (const [index, root] of old.contextAssets.entries()) {
        const resourceId = bundle.content.promptResourceIds[index]!
        const resource = byId.get(resourceId)
        const currentIds = new Set(resource ? walk(fromStoredResource(resource).rootNode).map(node => node.id) : [])
        if (!resource || resource.tombstoned || resource.rootNodeId !== root.id || walk(root).some(node => !currentIds.has(node.id))) throw new Error('Legacy Card node mapping cannot be proven; import as a new card')
        setMapping(mapping.resources, root.id, resourceId)
        for (const node of walk(root)) setMapping(mapping.nodes, node.id, node.id)
      }
    }
    const ids = new Set<string>()
    for (const root of candidate.contextAssets) for (const node of walk(root)) {
      if (ids.has(node.id)) throw new Error(`Duplicate package node identity: ${node.id}`)
      ids.add(node.id)
    }
    const blockingChanges: string[] = []
    for (const key of ['state', 'stateTemplates', 'timelineStateBindings', 'textTransformRules', 'textExtractors', 'externalContextAssetIds'] as const) {
      if (!equal(candidate[key], old[key])) blockingChanges.push(`${key}: package content changed; this update requires a dedicated apply path`)
    }
    for (const key of Object.keys({ ...old.card, ...candidate.card })) {
      if (key !== 'media' && !fields.includes(key as CardPackageEditableField) && !equal(old.card[key as keyof typeof old.card], candidate.card[key as keyof typeof candidate.card])) blockingChanges.push(`card.${key}: update requires its dedicated apply path`)
    }
    const implicit = new Set(candidate.contextAssets.flatMap(walk).filter(node => node.kind === 'virtual' && !node.capabilities?.targetAnchorId).map(node => node.id))
    const incoming = new Map(candidate.contextAssets.map(root => [root.id, root]))
    const items: PreviewCardPackageUpdateResult['items'] = []
    const localResources = new Map<string, PromptResource>()
    const sharedResources = new Map<string, Array<{ id: string; name: string }>>()
    for (const sourceId of new Set([...incoming.keys(), ...Object.keys(mapping.resources)])) {
      const resourceId = mapped(mapping.resources, sourceId)
      const stored = resourceId ? byId.get(resourceId) : undefined
      const local = stored && !stored.tombstoned ? content(stored) : undefined
      const root = incoming.get(sourceId)
      if (!root && !local) continue
      if (stored) {
        localResources.set(sourceId, stored)
        const otherCards = (await documents.listCardBindings({ type: applicationDocumentTypes.cardSource, resourceId: stored.id })).filter(other => other.id !== card.id)
        if (otherCards.length) sharedResources.set(stored.id, otherCards)
      }
      const settings = candidate.contextAssetSettings?.[sourceId]
      const next: PromptResourceArtifact | undefined = root ? { format: 'loom.promptResource', schemaVersion: 2,
        resourceKind: root.category ?? 'prompt', rootNode: remap(root, mapping.nodes, implicit), macros: settings?.macros ?? {}, macroOptions: settings?.macroOptions ?? {} } : undefined
      if (local && next && local.resourceKind !== next.resourceKind) blockingChanges.push(`${sourceId}: resource kind cannot change in place`)
      if ((old.externalContextAssetIds ?? []).includes(sourceId) && !equal(local, next)) blockingChanges.push(`${sourceId}: external resource cannot be overwritten by a card update`)
      items.push({ sourceId, ...(resourceId ? { resourceId } : {}), ...(local ? { local, localVersion: stored!.version } : {}), ...(next ? { incoming: next } : {}),
        kind: next?.resourceKind ?? local!.resourceKind, name: next?.rootNode.label ?? local!.rootNode.label,
        action: !local ? 'add' : !next ? 'remove' : equal(local, next) ? 'unchanged' : 'update' })
    }
    const attachments = await captureCardAttachments(documents, card.id, bundle.content, candidate, mapping)
    const archives = captureCardArchives(card.content.extensionPackages ?? [], old, candidate, mapping)
    blockingChanges.push(...attachments.blocking, ...archives.blocking)
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ card, bundle, candidate,
      attachments: attachments.evidence, resources: [...localResources.values()].sort((a, b) => a.id.localeCompare(b.id)), sharedResources: [...sharedResources] }))).digest('hex')
    const normalized = normalizeCardEditableFields(candidate.card)
    const localFields = readCardEditableFields(card.content)
    const preview: PreviewCardPackageUpdateResult = { cardId: card.id, expectedVersion: card.version, artifactId: candidate.artifactId,
      fingerprint, items, blockingChanges, attachmentChanges: [...attachments.changes, ...archives.changes],
      cardFields: fields.filter(field => !equal(localFields[field], normalized[field])).map(field => ({ field, local: json(localFields[field]), incoming: json(normalized[field]) })) }
    return { preview, card, bundle, candidate, mapping, localResources, normalized, implicit, sharedResources, attachments, archives }
  }
  return {
    previewCardPackageUpdate: async (input: PreviewCardPackageUpdateInput): Promise<PreviewCardPackageUpdateResult> => (await capture(input)).preview,
    applyCardPackageUpdate: async (input: ApplyCardPackageUpdateInput, requestContext?: RuntimeRequestContext): Promise<UpdateCardResult> => {
      const initial = await capture(input)
      if (initial.preview.fingerprint !== input.expectedFingerprint) throw new Error('Card resources changed; preview the update again')
      if (initial.preview.blockingChanges.length) throw new Error(initial.preview.blockingChanges.join('\n'))
      const preparedAttachments = await prepareCardAttachmentBlobs(ctx, initial.candidate, initial.attachments.changes)
      const preparedArchives = await prepareCardArchives(ctx, initial.card.content.extensionPackages ?? [], initial.candidate, initial.archives.changes)
      const participant = requireDocumentParticipant(ctx)
      const result = await ctx.dataEngine.transact({ ...promptResourceWriteContext(requestContext), reason: 'application.applyCardPackageUpdate' }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        return participant.participateTransaction(dataTx, async documents => {
          const current = await capture(input, documents, { listResources: async query => resourceTx.listResources(query) })
          if (current.preview.fingerprint !== input.expectedFingerprint) throw new Error('Card resources changed; preview the update again')
          if (current.preview.blockingChanges.length) throw new Error(current.preview.blockingChanges.join('\n'))
          const kept = new Set(input.keepPromptResourceIds ?? [])
          for (const id of kept) if (!current.preview.items.some(item => item.resourceId === id && item.local)) throw new Error(`Cannot keep an unrelated or missing Card resource: ${id}`)
          const keepFields = new Set(input.keepCardFields ?? [])
          for (const field of keepFields) if (!fields.includes(field)) throw new Error(`Unsupported Card field: ${field}`)
          const { mapping, candidate, card, bundle } = current
          for (const root of candidate.contextAssets) for (const node of walk(root)) if (!mapped(mapping.nodes, node.id)) setMapping(mapping.nodes, node.id, ctx.createId('prompt-node'))
          const sourceArtifactRef = createSourceArtifactRef(candidate, ctx.now())
          const ownedIds = new Set(Object.values(mapping.resources))
          const nextResourceIds = (card.content.promptResourceIds ?? []).filter(id => !ownedIds.has(id))
          for (const item of current.preview.items) {
            const local = current.localResources.get(item.sourceId)
            if (item.resourceId && kept.has(item.resourceId)) { nextResourceIds.push(item.resourceId); continue }
            if (item.resourceId && current.sharedResources.has(item.resourceId) && item.action !== 'unchanged') throw new Error(`Card resource is shared with another Card; keep it or save a separate copy: ${item.resourceId}`)
            if ((current.bundle.content.sourceArtifact.externalContextAssetIds ?? []).includes(item.sourceId) && item.resourceId) { nextResourceIds.push(item.resourceId); continue }
            const root = candidate.contextAssets.find(root => root.id === item.sourceId)
            if (!root) {
              if (local && !local.tombstoned) resourceTx.deleteResource({ resourceId: local.id, expectedVersion: local.version })
              continue
            }
            const previous = local ? fromStoredResource(local) : undefined
            const draft = toStoredResourceInput({ ...(local ? { id: local.id } : {}), content: {
              ...(previous ?? {}), resourceKind: root.category ?? 'prompt', rootNode: remap(root, mapping.nodes, current.implicit),
              ...(candidate.contextAssetSettings?.[root.id]?.metadata ? { metadata: structuredClone(candidate.contextAssetSettings[root.id]!.metadata) } : {}),
              macros: structuredClone(candidate.contextAssetSettings?.[root.id]?.macros ?? {}),
              macroOptions: structuredClone(candidate.contextAssetSettings?.[root.id]?.macroOptions ?? {}),
              sourceArtifactRef,
              createdAt: previous?.createdAt ?? ctx.now(), updatedAt: ctx.now(),
            } })
            let resource: PromptResource
            if (local) {
              const restored = local.tombstoned ? resourceTx.restoreResource({ resourceId: local.id, expectedVersion: local.version }) : undefined
              resource = resourceTx.mutateResource({ resourceId: local.id, expectedVersion: restored?.version ?? local.version,
                mutations: [{ kind: 'tree.replace', rootNode: draft.rootNode }, { kind: 'resource.update', patch: { label: draft.label, metadata: draft.metadata } }] })
            } else resource = resourceTx.createResource(draft)
            setMapping(mapping.resources, root.id, resource.id)
            nextResourceIds.push(resource.id)
          }
          const appliedAttachments = await applyCardAttachments(ctx, documents, dataTx, card.id, bundle.content, candidate, mapping, current.attachments, preparedAttachments)
          const oldPayloadIds = new Set([...current.attachments.payloadMap.values()].map(item => item.id))
          const extensionPackages = applyCardArchives(ctx, dataTx, card.content.extensionPackages ?? [], candidate, mapping, current.archives.changes, preparedArchives)
          const content = { ...card.content, extensionPackages,
            ...(input.hostPreparedMedia !== undefined ? { media: structuredClone(input.hostPreparedMedia) } : {}),
            portableExtensionPayloadIds: [...(card.content.portableExtensionPayloadIds ?? []).filter(id => !oldPayloadIds.has(id)), ...appliedAttachments.payloadIds],
            promptResourceIds: nextResourceIds, updatedAt: ctx.now() }
          for (const field of fields) if (!keepFields.has(field)) Object.assign(content, { [field]: current.normalized[field] })
          const updated = await writeDocument<CardSourceContent>(documents, { id: card.id, type: applicationDocumentTypes.cardSource,
            expectedVersion: card.version, content })
          await writeDocument<ImportBundleContent>(documents, { id: bundle.id, type: applicationDocumentTypes.importBundle, expectedVersion: bundle.version,
            content: { ...bundle.content, documentIds: appliedAttachments.documentIds, sourceArtifact: candidate, resourceMappings: mapping, promptResourceIds: nextResourceIds,
              bindings: nextResourceIds.map(resourceId => {
                const previous = bundle.content.bindings.find(binding => binding.to.resourceId === resourceId)
                const sourceId = Object.keys(mapping.resources).find(key => mapping.resources[key] === resourceId)
                return previous ?? { id: ctx.createId('binding'), relationship: 'recommends' as const, createdAt: ctx.now(),
                  from: { documentId: card.id, documentType: applicationDocumentTypes.cardSource },
                  to: { resourceId, ...(sourceId ? { nodeId: mapped(mapping.nodes, sourceId) } : {}) } }
              }), sourceArtifactRef } })
          return { ...updated.content, id: updated.id, version: updated.version }
        })
      })
      return { card: result.value.value, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}
