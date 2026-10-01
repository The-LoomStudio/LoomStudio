import { useRef, useState } from 'react'
import type { ContextAssetNode, PromptResource, UpdatePromptResourceResult } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import {
  addContextAssetAnchorNode,
  addContextAssetFolderNode,
  addContextAssetInZoneNode,
  addContextAssetMessageBlockNode,
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  moveContextAssetNode,
  updateContextAssetNode,
} from './tree-ops.js'
import { normalizeContextAssets, writeProjectionCapability } from './context-asset-normalization.js'
import { findContextAssetNode } from './context-asset-tree.js'
import { findRootContextModule, type ContextAssetUpdate } from './projection-workbench.js'

type UseContextAssetsInput = {
  api: StudioApi
  scope: string
  onResourceChange(resource: PromptResource): void
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
  runAction(action: () => Promise<void>): Promise<void>
  resources: PromptResource[]
  t: Translator
}

type ResourceDraft = {
  base: PromptResource
  edits: Map<string, Partial<ContextAssetNode>>
  failure?: unknown
}

type ResourceScope = {
  resources: PromptResource[]
  nodes: ContextAssetNode[]
  visible: PromptResource[]
  drafts: Map<string, ResourceDraft>
  queue: Promise<void>
}

export function useContextAssets(input: UseContextAssetsInput) {
  const [, refreshView] = useState(0)
  const scopesRef = useRef(new Map<string, ResourceScope>())
  const activeScopeRef = useRef(input.scope)
  activeScopeRef.current = input.scope
  const scope = scopesRef.current.get(input.scope) ?? {
    resources: input.resources,
    nodes: input.resources.map(resource => resource.rootNode),
    visible: input.resources,
    drafts: new Map<string, ResourceDraft>(),
    queue: Promise.resolve(),
  }
  scopesRef.current.set(input.scope, scope)
  const displayedResources = scope.visible

  function recordEdit(entry: Parameters<UseContextAssetsInput['recordEdit']>[0]) {
    if (activeScopeRef.current === input.scope) input.recordEdit(entry)
  }

  function publishDrafts() {
    const visible = new Map(scope.resources.map(resource => [resource.id, resource]))
    for (const [id, draft] of scope.drafts) {
      let roots = [draft.base.rootNode]
      for (const [nodeId, partial] of draft.edits) roots = updateContextAssetNode(roots, nodeId, partial)
      visible.set(id, { ...draft.base, rootNode: normalizeContextAssets(roots)[0]! })
    }
    scope.visible = [...visible.values()]
    refreshView(revision => revision + 1)
  }

  function setResources(next: PromptResource[]) {
    const previous = new Map(scope.resources.map(resource => [resource.id, resource]))
    scope.resources = next.map(resource => {
      const current = previous.get(resource.id)
      return current && current.version > resource.version ? current : resource
    })
    scope.nodes = scope.resources.map(resource => resource.rootNode)
    publishDrafts()
  }

  function applyResource(resource: PromptResource) {
    const draft = scope.drafts.get(resource.id)
    const previous = scope.resources.find(current => current.id === resource.id)
    if (draft && !draft.failure && previous?.version === draft.base.version
      && resource.version === draft.base.version + 1
      && [...draft.edits.keys()].every(id => findContextAssetNode([resource.rootNode], id))) {
      draft.base = resource
    }
    setResources(scope.resources.map(current => current.id === resource.id ? resource : current))
    input.onResourceChange(resource)
  }

  function readDraft(assetId: string) {
    const existing = [...scope.drafts.values()].find(draft => findContextAssetNode([draft.base.rootNode], assetId))
    if (existing) return existing
    const resource = displayedResources.find(resource => findContextAssetNode([resource.rootNode], assetId))
    if (!resource) throw new Error(`Prompt resource not found for asset: ${assetId}`)
    const draft: ResourceDraft = { base: resource, edits: new Map() }
    scope.drafts.set(resource.id, draft)
    return draft
  }

  function discardDraft(resourceId: string) {
    scope.drafts.delete(resourceId)
    publishDrafts()
  }

  function retryDraft(resourceId: string): Promise<void> {
    const draft = scope.drafts.get(resourceId)
    if (!draft || draft.edits.size === 0) return Promise.resolve()
    return commitEdits([...draft.edits].map(([id, partial]) => ({ id, partial })), true, true)
  }

  function readResourceId(assetId: string): string {
    const root = findRootContextModule(scope.nodes, assetId)
    const resourceId = scope.resources.find(resource => resource.rootNode.id === root?.id)?.id
    if (!resourceId) throw new Error(`Prompt resource not found for asset: ${assetId}`)
    return resourceId
  }

  function firstChildPlacement(parentId: string) {
    const firstChild = findContextAssetNode(scope.nodes, parentId)?.children?.[0]
    return {
      targetAssetId: firstChild?.id ?? parentId,
      position: firstChild ? 'before' as const : 'inside' as const,
    }
  }

  function enqueueMutation(action: () => Promise<void>): Promise<void> {
    const pending = scope.queue.then(() => input.runAction(action))
    scope.queue = pending.catch(() => undefined)
    return pending
  }

  function previewContextAsset(id: string, partial: Partial<ContextAssetNode>) {
    const draft = readDraft(id)
    draft.edits.set(id, { ...draft.edits.get(id), ...partial })
    publishDrafts()
  }

  function updateContextAsset(id: string, partial: Partial<ContextAssetNode>): Promise<void> {
    return commitEdits([{ id, partial }], false)
  }

  function updateContextAssets(updates: ContextAssetUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve()
    return commitEdits(updates, true)
  }

  function commitEdits(updates: ContextAssetUpdate[], batch: boolean, reapply = false): Promise<void> {
    const drafts = updates.map(update => readDraft(update.id))
    const draft = drafts[0]!
    if (drafts.some(candidate => candidate !== draft)) {
      for (const candidate of drafts) {
        if (candidate.edits.size === 0) scope.drafts.delete(candidate.base.id)
      }
      publishDrafts()
      return enqueueMutation(async () => { throw new Error('Cross-resource prompt asset updates are not supported') })
    }
    for (const update of updates) previewContextAsset(update.id, update.partial)
    const submitted = new Map(updates.map(update => [update.id, draft.edits.get(update.id)!]))
    return enqueueMutation(async () => {
      if (scope.drafts.get(draft.base.id) !== draft) return
      try {
        if (reapply) {
          const { resource } = await input.api.promptResources.get(draft.base.id)
          if (scope.drafts.get(draft.base.id) !== draft || activeScopeRef.current !== input.scope) return
          for (const id of submitted.keys()) {
            if (!findContextAssetNode([resource.rootNode], id)) throw new Error(`Prompt asset not found: ${id}`)
          }
          draft.base = resource
          draft.failure = undefined
          applyResource(resource)
        }
        if (draft.failure) throw draft.failure
        const current = scope.resources.find(resource => resource.id === draft.base.id)
        if (!current || current.version !== draft.base.version) throw new Error(input.t('context.draftConflict'))
        const patches = [...submitted].flatMap(([id, partial]) => {
          const previousNode = findContextAssetNode([draft.base.rootNode], id)
          const nextNode = findContextAssetNode(updateContextAssetNode([draft.base.rootNode], id, partial), id)
          if (!previousNode || !nextNode) throw new Error(`Prompt asset not found: ${id}`)
          return samePromptAssetPatch(previousNode, nextNode) ? [] : [readPromptAssetPatch(nextNode)]
        })
        if (patches.length > 0) {
          const request = { resourceId: draft.base.id, expectedVersion: draft.base.version }
          const result = batch
            ? await input.api.promptResources.updateAssets({ ...request, updates: patches })
            : await input.api.promptResources.updateAsset({ ...request, ...patches[0]! })
          draft.base = result.resource
          recordEdit({
            label: input.t(batch ? 'history.context.reorder' : 'history.context.update'),
            changesetId: result.mutation.changesetId,
            anchor: { documentId: result.resource.id, subjectId: updates[0]?.id },
          })
          applyResource(result.resource)
        }
        for (const [id, partial] of submitted) {
          if (draft.edits.get(id) === partial) draft.edits.delete(id)
        }
        if (draft.edits.size === 0 && scope.drafts.get(draft.base.id) === draft) scope.drafts.delete(draft.base.id)
        publishDrafts()
      } catch (error) {
        draft.failure = error
        throw error
      }
    })
  }

  async function addContextAsset(parentId: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetNode(scope.nodes, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        ...firstChildPlacement(parentId),
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  async function addContextAssetFolder(parentId: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetFolderNode(scope.nodes, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        ...firstChildPlacement(parentId),
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  async function addContextAssetAnchor(parentId: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetAnchorNode(scope.nodes, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        ...firstChildPlacement(parentId),
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  async function addContextAssetMessageBlock(parentId: string, role: 'system' | 'user' | 'assistant' = 'system'): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const parentNode = findContextAssetNode(scope.nodes, parentId)
      const mutation = addContextAssetMessageBlockNode(scope.nodes, parentId, role)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)

      const isMessageOrLeaf = parentNode?.kind === 'message' || parentNode?.kind === 'entry' || parentNode?.kind === 'virtual' || parentNode?.kind === 'slot'

      const result = await input.api.promptResources.createAsset({
        resourceId,
        ...(isMessageOrLeaf ? { targetAssetId: parentId, position: 'after' as const } : firstChildPlacement(parentId)),
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  function moveContextAsset(draggedId: string, targetId: string, position: 'before' | 'inside' | 'after'): Promise<void> {
    return enqueueMutation(async () => {
      const next = moveContextAssetNode(scope.nodes, draggedId, targetId, position)
      if (next === scope.nodes) return
      const resourceId = readResourceId(draggedId)
      if (readResourceId(targetId) !== resourceId) throw new Error('Cross-resource prompt asset move is not supported')
      const result = await input.api.promptResources.moveAsset({
        resourceId,
        assetId: draggedId,
        targetAssetId: targetId,
        position,
      })
      applyResource(result.resource)
      recordEdit({
        label: input.t('history.context.move'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: draggedId },
      })
    })
  }

  async function duplicateContextAsset(id: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = duplicateContextAssetNode(scope.nodes, id)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(id)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        targetAssetId: id,
        position: 'after',
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.duplicate'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  async function deleteContextAsset(id: string, currentSelectedId?: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = deleteContextAssetNode(scope.nodes, id, currentSelectedId)
      if (mutation.nodes === scope.nodes) return
      const resourceId = readResourceId(id)
      const result = await input.api.promptResources.deleteAsset({
        resourceId,
        assetId: id,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.delete'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: id },
      })
    })
    return nextSelectedId
  }

  async function addContextAssetInZone(resourceId: string, zoneId: string): Promise<string | undefined> {
    const targetResource = scope.resources.find(r => r.id === resourceId || r.rootNode.id === resourceId)
    const targetResourceId = targetResource?.id ?? resourceId
    const targetAssetId = targetResource?.rootNode.id ?? resourceId

    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetInZoneNode(scope.nodes, targetAssetId, zoneId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return

      const result = await input.api.promptResources.createAsset({
        resourceId: targetResourceId,
        ...firstChildPlacement(targetAssetId),
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: targetResourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  return {
    nodes: scope.visible.map(resource => resource.rootNode),
    resources: scope.visible,
    draftResourceIds: [...scope.drafts.keys()],
    discardDraft,
    retryDraft,
    setResources,
    previewContextAsset,
    updateContextAsset,
    updateContextAssets,
    moveContextAsset,
    addContextAsset,
    addContextAssetFolder,
    addContextAssetAnchor,
    addContextAssetMessageBlock,
    addContextAssetInZone,
    duplicateContextAsset,
    deleteContextAsset,
  }
}

export async function commitContextAssetMutation(input: {
  applyResource(resource: PromptResource): void
  entry: {
    label: string
    anchor?: { documentId: string; subjectId?: string }
  }
  mutate(): Promise<UpdatePromptResourceResult>
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
}): Promise<UpdatePromptResourceResult> {
  const result = await input.mutate()
  input.applyResource(result.resource)
  input.recordEdit({ ...input.entry, changesetId: result.mutation.changesetId })
  return result
}

function readPromptAssetPatch(node: ContextAssetNode) {
  const capabilities = node.projection
    ? writeProjectionCapability(node.capabilities, node.projection)
    : node.capabilities

  return {
    assetId: node.id,
    body: node.body,
    capabilities,
    enabled: node.enabled,
    label: node.label,
    meta: node.meta,
    orderList: node.orderList,
    skeletonPatch: node.skeletonPatch,
    slotRanks: node.slotRanks,
  }
}

function samePromptAssetPatch(left: ContextAssetNode, right: ContextAssetNode): boolean {
  return JSON.stringify(readPromptAssetPatch(left)) === JSON.stringify(readPromptAssetPatch(right))
}
