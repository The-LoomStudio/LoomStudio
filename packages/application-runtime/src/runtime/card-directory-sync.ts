import { isDeepStrictEqual } from 'node:util'
import type { PromptResource, PromptResourceTransaction, PromptResourceTreeNode } from '@loom-studio/prompt-resource-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes as types } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { normalizeCardContent, normalizeOpening, normalizePreset, normalizeSettingLayer } from '../cards/card.js'
import { exportCardArtifact, normalizeCardBundleArtifact, type CardBundleArtifact, type PortableExtensionPayloadContent } from '../cards/workspace.js'
import { toStoredNode } from '../prompt/prompt-resource-mapper.js'
import { parseLoomScriptSource } from '../scripts/loom-script-codec.js'
import type { LoomScriptAttachmentArtifact, LoomScriptContent, LoomScriptMountContent } from '../scripts/loom-script-contracts.js'
import { materializeStateContribution } from '../state/state-contribution.js'
import type { CardSourceContent, PreparedBlobStorageWrite, RuntimeRequestContext, StateDefinitionContent } from '../types.js'
import { requireDocumentParticipant } from './context.js'

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const equal = (left: unknown, right: unknown) => isDeepStrictEqual(json(left ?? null), json(right ?? null))

function baseline(artifact: CardBundleArtifact): CardBundleArtifact {
  const result = json(artifact)
  if (result.metadata) delete result.metadata.exportedAt
  return result
}

function keyed<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>()
  for (const item of items) {
    const id = key(item)
    if (result.has(id)) throw new Error(`Card directory identity is ambiguous: ${id}`)
    result.set(id, item)
  }
  return result
}

function sameKeys<T, U>(before: Map<string, T>, after: Map<string, U>, subject: string): void {
  if (before.size !== after.size || [...before.keys()].some(id => !after.has(id))) {
    throw new Error(`Card directory ${subject} identities changed; adding or removing resources is not supported`)
  }
}

export function createCardDirectoryRuntimeMethods(ctx: ApplicationRuntimeContext) {
  async function capture(cardId: string) {
    const card = await readDocument<CardSourceContent>(ctx.documents, cardId, types.cardSource)
    const artifact = await exportCardArtifact({ cardId, ...ctx })
    const prompts: PromptResource[] = []
    for (const id of card.content.promptResourceIds ?? []) {
      const resource = await ctx.promptResources.getResource(id)
      if (!resource) throw new Error(`Prompt resource not found: ${id}`)
      prompts.push(resource)
    }
    const mounts = (await listDocuments<LoomScriptMountContent>(ctx.documents, types.loomScriptMount))
      .filter(item => item.content.target.kind === 'card' && item.content.target.cardId === cardId)
      .sort((a, b) => a.content.orderIndex - b.content.orderIndex || a.id.localeCompare(b.id))
    const scripts = []
    for (const mount of mounts) {
      scripts.push({ mount, script: await readDocument<LoomScriptContent>(ctx.documents, mount.content.scriptDocumentId, types.loomScript) })
    }
    keyed(scripts, item => item.script.content.metadataId)
    const payloads = []
    for (const id of card.content.portableExtensionPayloadIds ?? []) {
      payloads.push(await readDocument<PortableExtensionPayloadContent>(ctx.documents, id, types.portableExtensionPayload))
    }
    keyed(payloads, item => item.content.artifactPayloadId)
    const definitions = []
    for (const id of card.content.stateDefinitionIds ?? []) {
      definitions.push(await readDocument<StateDefinitionContent>(ctx.documents, id, types.stateDefinition))
    }
    const version = (document: { id: string; version: number }) => ({ id: document.id, version: document.version })
    const snapshot: JsonObject = json({
      schemaVersion: 1, cardId, card: version(card), artifact: baseline(artifact),
      prompts: prompts.map(resource => ({ ...version(resource), rootNodeId: resource.rootNodeId })),
      scripts: scripts.map(({ script, mount }) => ({ script: version(script), mount: version(mount), metadataId: script.content.metadataId })),
      payloads: payloads.map(payload => ({ ...version(payload), artifactPayloadId: payload.content.artifactPayloadId })),
      definitions: definitions.map(version),
    }) as unknown as JsonObject
    return { artifact, snapshot, card, prompts, scripts, payloads, definitions }
  }

  return {
    captureCardDirectoryState: async (input: { cardId: string }): Promise<{ artifact: CardBundleArtifact; snapshot: JsonObject }> => {
      let stale = false
      const subscription = ctx.dataEngine.subscribeCommits(() => { stale = true })
      try {
        const { artifact, snapshot } = await capture(input.cardId)
        if (stale) throw new Error('Card directory snapshot changed during capture; retry')
        return { artifact, snapshot }
      } finally { subscription.dispose() }
    },

    applyCardDirectoryState: async (input: { cardId: string; artifact: CardBundleArtifact; snapshot: JsonObject }, requestContext?: RuntimeRequestContext): Promise<{ mutation: { changesetId: string } }> => {
      let stale = false
      const subscription = ctx.dataEngine.subscribeCommits(() => { stale = true })
      try {
        const current = await capture(input.cardId)
        if (!equal(input.snapshot, current.snapshot)) throw new Error('Card directory version conflict; save or recapture before Apply')
        const artifact = normalizeCardBundleArtifact(input.artifact)
        const old = current.artifact
        for (const key of ['artifactId', 'displayName', 'description', 'textTransformRules', 'textExtractors', 'metadata'] as const) {
          if (!equal(baseline(artifact)[key], baseline(old)[key])) throw new Error(`Card directory does not support changing ${key}`)
        }
        const prompts = keyed(current.prompts, item => item.rootNodeId)
        const desiredPrompts = keyed(artifact.contextAssets, item => item.id)
        sameKeys(prompts, desiredPrompts, 'Prompt resource')
        const attachments = keyed(artifact.scriptAttachments ?? [], item => parseLoomScriptSource(item.script.source).metadataId)
        const scripts = keyed(current.scripts, item => item.script.content.metadataId)
        sameKeys(scripts, attachments, 'Script')
        const payloads = keyed(current.payloads, item => item.content.artifactPayloadId)
        const desiredPayloads = keyed(artifact.extensionPayloads ?? [], item => item.id)
        sameKeys(payloads, desiredPayloads, 'Payload')
        const templates = keyed(artifact.state?.contribution.templates ?? artifact.stateTemplates ?? [], item => item.id)
        const oldTemplates = keyed(old.state?.contribution.templates ?? old.stateTemplates ?? [], item => item.id)
        sameKeys(oldTemplates, templates, 'State template')
        if (!equal(artifact.card.stateContributionIds, old.card.stateContributionIds)) throw new Error('Card directory cannot change installed State contributions')
        if (artifact.state) {
          if (artifact.state.contribution.id !== old.state?.contribution.id) throw new Error('Card directory State contribution identity changed')
          materializeStateContribution(artifact.state.contribution)
        }
        const shared = await sharedReferences(ctx, input.cardId)
        for (const [id, prompt] of prompts) {
          if (!equal(toStoredNode(desiredPrompts.get(id)!), toStoredNode(old.contextAssets.find(node => node.id === id)!))) {
            assertPrivate(shared, prompt.id)
            if (prompt.metadata.origin !== undefined) throw new Error(`Card directory cannot overwrite managed Prompt resource: ${prompt.id}`)
          }
        }
        for (const definition of current.definitions) {
          if (!equal(oldTemplates.get(definition.id), templates.get(definition.id))) assertPrivate(shared, definition.id)
        }
        for (const [id, payload] of payloads) {
          if (!equal(old.extensionPayloads?.find(item => item.id === id), desiredPayloads.get(id))) {
            assertPrivate(shared, payload.id)
            if (desiredPayloads.get(id)!.packageId !== payload.content.packageId) throw new Error('Card directory cannot change Payload package identity')
          }
        }
        const preparedScripts: Array<(typeof current.scripts)[number] & {
          attachment: LoomScriptAttachmentArtifact
          metadata: ReturnType<typeof parseLoomScriptSource>
          sourceChanged: boolean
          prepared: PreparedBlobStorageWrite | undefined
        }> = []
        for (const [id, item] of scripts) {
          const attachment = attachments.get(id)!
          const previous = old.scriptAttachments!.find(value => parseLoomScriptSource(value.script.source).metadataId === id)!
          if (equal(previous, attachment)) continue
          const metadata = parseLoomScriptSource(attachment.script.source)
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.loom\.js$/.test(attachment.script.fileName)) throw new Error('Invalid Loom Script fileName')
          if (item.script.content.owner.kind !== 'card' || item.script.content.owner.cardId !== input.cardId) throw new Error('Card directory Script is not owned by Card')
          assertPrivate(shared, item.script.id)
          const sourceChanged = !equal(previous.script, attachment.script)
          if (sourceChanged && item.mount.content.pinnedDocumentVersion !== undefined) throw new Error('Card directory cannot update a pinned Script; unpin explicitly first')
          if (item.mount.content.grantedCapabilities.some(capability => !metadata.requestedCapabilities.includes(capability))) {
            throw new Error('Card directory Script changed existing grants; update permissions explicitly first')
          }
          if (!ctx.blobs) throw new Error('Blob Store is required for Card directory Script changes')
          preparedScripts.push({ ...item, attachment, metadata, sourceChanged, prepared: sourceChanged ? await ctx.blobs.prepareWrite({
            source: new TextEncoder().encode(attachment.script.source), mediaType: 'text/javascript',
          }) : undefined })
        }
        if (artifact.card.media !== undefined && !equal(artifact.card.media, old.card.media)) throw new Error('Card directory cannot change Media Asset references')
        const participant = requireDocumentParticipant(ctx)
        const result = await ctx.dataEngine.transact({
          actor: requestContext?.actor ?? (requestContext?.clientId ? { kind: 'client', id: requestContext.clientId } : { kind: 'kernel', id: 'application-runtime' }),
          reason: 'application.applyCardDirectoryState', correlationId: requestContext?.correlationId,
          callId: requestContext?.callId, parentCallId: requestContext?.parentCallId,
        }, async tx => {
          // ponytail: reject any concurrent commit during preparation; scoped read revisions can replace this if contention becomes material.
          if (stale) throw new Error('Card directory snapshot changed during Apply; retry')
          return participant.participateTransaction(tx, async documents => {
            const timestamp = ctx.now()
            const resources = ctx.promptResources.transaction(tx)
            for (const [id, resource] of prompts) {
              const desired = toStoredNode(desiredPrompts.get(id)!)
              if (!equal(desired, toStoredNode(old.contextAssets.find(node => node.id === id)!))) updatePromptTree(resources, resource, desired)
            }
            for (const definition of current.definitions) {
              const template = templates.get(definition.id)!
              if (equal(oldTemplates.get(definition.id), template)) continue
              const { id: _id, ...draft } = template
              await writeDocument(documents, { id: definition.id, type: types.stateDefinition, expectedVersion: definition.version,
                content: { ...draft, kind: 'timeline-template', createdAt: definition.content.createdAt, updatedAt: timestamp } })
            }
            for (const [id, payload] of payloads) {
              const desired = desiredPayloads.get(id)!
              if (equal(old.extensionPayloads?.find(item => item.id === id), desired)) continue
              const { id: artifactPayloadId, ...fields } = desired
              await writeDocument(documents, { id: payload.id, type: types.portableExtensionPayload, expectedVersion: payload.version,
                content: { ...fields, artifactPayloadId, createdAt: payload.content.createdAt, updatedAt: timestamp } })
            }
            for (const item of preparedScripts) {
              if (item.prepared) {
                const blob = ctx.blobs!.participateWrite(tx, item.prepared).blob
                await writeDocument(documents, { id: item.script.id, type: types.loomScript, expectedVersion: item.script.version,
                  content: { ...item.script.content, ...item.metadata, source: { blobId: blob.id, mediaType: 'text/javascript', fileName: item.attachment.script.fileName }, sourceDigest: blob.sha256, updatedAt: timestamp } })
              }
              const origin = { ...item.mount.content.origin }
              if (item.attachment.resourceOrigin === undefined) delete origin.resourceOrigin
              else origin.resourceOrigin = item.attachment.resourceOrigin
              if (item.mount.content.orderIndex !== item.attachment.orderIndex || !equal(origin, item.mount.content.origin)) {
                await writeDocument(documents, { id: item.mount.id, type: types.loomScriptMount, expectedVersion: item.mount.version,
                  content: { ...item.mount.content, origin, orderIndex: item.attachment.orderIndex, updatedAt: timestamp } })
              }
            }
            const state = artifact.state?.contribution
            const next = normalizeCardContent({
              ...current.card.content,
              name: artifact.card.name, userName: artifact.card.userName, description: artifact.card.description,
              preset: normalizePreset(artifact.card.preset), opening: normalizeOpening(artifact.card.opening),
              settingLayer: normalizeSettingLayer(artifact.card.settingLayer, undefined), macros: artifact.card.macros,
              promptResourceIds: artifact.contextAssets.map(node => prompts.get(node.id)!.id),
              ...(artifact.externalContextAssetIds !== undefined || current.card.content.externalPromptResourceIds !== undefined ? {
                externalPromptResourceIds: (artifact.externalContextAssetIds ?? []).map(id => prompts.get(id)!.id),
              } : {}),
              stateTemplates: (current.card.content.stateTemplates ?? []).map(template => templates.get(template.id)!),
              ...(state ? { stateEntityTypes: state.entityTypes, timelineStateEntities: state.entities, timelineComponentMounts: state.componentMounts } : {}),
              timelineStateBindings: state?.bindings ?? artifact.timelineStateBindings ?? [],
              updatedAt: timestamp,
            })
            await writeDocument(documents, { id: current.card.id, type: types.cardSource, expectedVersion: current.card.version, content: next })
          })
        })
        return { mutation: { changesetId: result.commit.changesetId } }
      } finally { subscription.dispose() }
    },
  }
}

function assertPrivate(shared: Set<string>, id: string): void {
  if (shared.has(id)) throw new Error(`Card directory cannot overwrite shared resource: ${id}`)
}

async function sharedReferences(ctx: ApplicationRuntimeContext, cardId: string): Promise<Set<string>> {
  const shared = new Set<string>()
  for (const card of await listDocuments<CardSourceContent>(ctx.documents, types.cardSource)) {
    if (card.id !== cardId) for (const id of [...card.content.promptResourceIds ?? [], ...card.content.portableExtensionPayloadIds ?? [], ...card.content.stateDefinitionIds ?? []]) shared.add(id)
  }
  for (const profile of await listDocuments<{ presetId?: string }>(ctx.documents, types.agentProfile)) {
    if (profile.content.presetId) shared.add(profile.content.presetId)
  }
  for (const mount of await ctx.promptResources.listSettingMounts({})) {
    shared.add(mount.settingResourceId)
    if (mount.source.kind === 'preset') shared.add(mount.source.id)
  }
  for (const mount of await ctx.promptResources.listPresetToolMounts({})) shared.add(mount.presetResourceId)
  for (const mount of await listDocuments<LoomScriptMountContent>(ctx.documents, types.loomScriptMount)) {
    if (mount.content.target.kind !== 'card' || mount.content.target.cardId !== cardId) shared.add(mount.content.scriptDocumentId)
  }
  if (ctx.narratives) {
    let cursor: string | undefined
    do {
      const page = await ctx.narratives.listTimelines({ cursor, limit: 100 })
      for (const timeline of page.timelines) for (const id of timeline.promptResourceIds) shared.add(id)
      cursor = page.nextCursor
    } while (cursor)
  }
  return shared
}

function updatePromptTree(tx: PromptResourceTransaction, initial: PromptResource, desired: PromptResourceTreeNode): void {
  type Positioned = { node: PromptResourceTreeNode; parentId?: string; orderIndex: number }
  const flatten = (root: PromptResourceTreeNode) => {
    const nodes = new Map<string, Positioned>()
    const visit = (node: PromptResourceTreeNode, parentId?: string, orderIndex = 0) => {
      nodes.set(node.id, { node, parentId, orderIndex })
      node.children?.forEach((child, index) => visit(child, node.id, index))
    }
    visit(root)
    return nodes
  }
  let resource = initial
  const old = flatten(initial.rootNode)
  const next = flatten(desired)
  for (const [id, value] of next) {
    if (old.has(id) && old.get(id)!.node.kind !== value.node.kind) throw new Error(`Card directory cannot change Prompt node kind: ${id}`)
  }
  const mutate = (mutations: Parameters<PromptResourceTransaction['mutateResource']>[0]['mutations']) => {
    resource = tx.mutateResource({ resourceId: resource.id, expectedVersion: resource.version, mutations })
  }
  // Flatten surviving descendants before changing parents, so reparenting cannot delete a retained subtree or create a transient cycle.
  for (const [id, value] of old) {
    if (next.has(id) && value.parentId && value.parentId !== desired.id) mutate([{ kind: 'node.move', nodeId: id, parentId: desired.id, orderIndex: value.orderIndex }])
  }
  for (const [id, value] of flatten(resource.rootNode)) {
    if (value.parentId && next.has(value.parentId) && !next.has(id)) mutate([{ kind: 'node.delete', nodeId: id }])
  }
  for (const [id, value] of next) {
    const { children: _children, ...node } = value.node
    let position = flatten(resource.rootNode).get(id)
    if (!position) {
      mutate([{ kind: 'node.create', parentId: value.parentId!, node: { ...node, orderIndex: value.orderIndex } }])
      continue
    }
    if (value.parentId && (position.parentId !== value.parentId || position.orderIndex !== value.orderIndex)) {
      mutate([{ kind: 'node.move', nodeId: id, parentId: value.parentId, orderIndex: value.orderIndex }])
      position = flatten(resource.rootNode).get(id)!
    }
    const patch: Record<string, JsonValue> = {}
    for (const key of ['label', 'category', 'meta', 'enabled', 'body', 'capabilities', 'extra'] as const) {
      if (!equal(position.node[key], node[key])) patch[key] = node[key] ?? null
    }
    if (Object.keys(patch).length) mutate([{ kind: 'node.update', nodeId: id, patch }])
  }
  if (resource.label !== desired.label) mutate([{ kind: 'resource.update', patch: { label: desired.label } }])
}
