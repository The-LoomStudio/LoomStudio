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

export function useContextAssets(input: UseContextAssetsInput) {
  const [nodes, setNodeState] = useState<ContextAssetNode[]>([])
  const nodesRef = useRef<ContextAssetNode[]>([])
  const persistedNodesRef = useRef<ContextAssetNode[]>([])
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())

  function applyDraftNodes(next: ContextAssetNode[]) {
    nodesRef.current = next
    setNodeState(next)
  }

  function setNodes(next: ContextAssetNode[]) {
    const normalized = normalizeContextAssets(next)
    persistedNodesRef.current = normalized
    applyDraftNodes(normalized)
  }

  function applyResource(resource: PromptResource) {
    setNodes(persistedNodesRef.current.map(node => node.id === resource.rootNode.id ? resource.rootNode : node))
    input.onResourceChange(resource)
  }

  function readResourceId(assetId: string): string {
    const root = findRootContextModule(persistedNodesRef.current, assetId)
    const resourceId = input.resources.find(resource => resource.rootNode.id === root?.id)?.id
    if (!resourceId) throw new Error(`Prompt resource not found for asset: ${assetId}`)
    return resourceId
  }

  function enqueueMutation(action: () => Promise<void>): Promise<void> {
    const pending = mutationQueueRef.current.then(() => input.runAction(action))
    mutationQueueRef.current = pending.catch(() => undefined)
    return pending
  }

  function previewContextAsset(id: string, partial: Partial<ContextAssetNode>) {
    applyDraftNodes(updateContextAssetNode(nodesRef.current, id, partial))
  }

  function updateContextAsset(id: string, partial: Partial<ContextAssetNode>): Promise<void> {
    return enqueueMutation(async () => {
      const next = updateContextAssetNode(persistedNodesRef.current, id, partial)
      const previousNode = findContextAssetNode(persistedNodesRef.current, id)
      const nextNode = findContextAssetNode(next, id)
      if (!previousNode || !nextNode || samePromptAssetPatch(previousNode, nextNode)) return
      const resourceId = readResourceId(id)

      try {
        await commitContextAssetMutation({
          mutate: () => input.api.promptResources.updateAsset({
            resourceId,
            ...readPromptAssetPatch(nextNode),
          }),
          applyResource,
          recordEdit: input.recordEdit,
          entry: {
            label: input.t('history.context.update'),
            anchor: { documentId: resourceId, subjectId: id },
          },
        })
      } catch (error) {
        applyDraftNodes(persistedNodesRef.current)
        throw error
      }
    })
  }

  function updateContextAssets(updates: ContextAssetUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve()
    return enqueueMutation(async () => {
      const next = updates.reduce((current, update) => updateContextAssetNode(current, update.id, update.partial), persistedNodesRef.current)
      const changedNodes = updates.flatMap(update => {
        const previousNode = findContextAssetNode(persistedNodesRef.current, update.id)
        const nextNode = findContextAssetNode(next, update.id)
        return previousNode && nextNode && !samePromptAssetPatch(previousNode, nextNode) ? [nextNode] : []
      })
      if (changedNodes.length === 0) return
      const resourceIds = new Set(changedNodes.map(node => readResourceId(node.id)))
      if (resourceIds.size !== 1) throw new Error('Cross-resource prompt asset updates are not supported')
      const resourceId = [...resourceIds][0]!

      try {
        await commitContextAssetMutation({
          mutate: () => input.api.promptResources.updateAssets({
            resourceId,
            updates: changedNodes.map(node => readPromptAssetPatch(node)),
          }),
          applyResource,
          recordEdit: input.recordEdit,
          entry: {
            label: input.t('history.context.reorder'),
            anchor: { documentId: resourceId, subjectId: updates[0]?.id },
          },
        })
      } catch (error) {
        applyDraftNodes(persistedNodesRef.current)
        throw error
      }
    })
  }

  async function addContextAsset(parentId: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetNode(persistedNodesRef.current, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        targetAssetId: parentId,
        position: 'inside',
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
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
      const mutation = addContextAssetFolderNode(persistedNodesRef.current, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        targetAssetId: parentId,
        position: 'inside',
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
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
      const mutation = addContextAssetAnchorNode(persistedNodesRef.current, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api.promptResources.createAsset({
        resourceId,
        targetAssetId: parentId,
        position: 'inside',
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
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
      const parentNode = findContextAssetNode(persistedNodesRef.current, parentId)
      const mutation = addContextAssetMessageBlockNode(persistedNodesRef.current, parentId, role)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)

      const isMessageOrLeaf = parentNode?.kind === 'message' || parentNode?.kind === 'entry' || parentNode?.kind === 'virtual' || parentNode?.kind === 'slot'

      const result = await input.api.promptResources.createAsset({
        resourceId,
        targetAssetId: parentId,
        position: isMessageOrLeaf ? 'after' : 'inside',
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  function moveContextAsset(draggedId: string, targetId: string, position: 'before' | 'inside' | 'after'): Promise<void> {
    return enqueueMutation(async () => {
      const next = moveContextAssetNode(persistedNodesRef.current, draggedId, targetId, position)
      if (next === persistedNodesRef.current) return
      const resourceId = readResourceId(draggedId)
      if (readResourceId(targetId) !== resourceId) throw new Error('Cross-resource prompt asset move is not supported')
      const result = await input.api.promptResources.moveAsset({
        resourceId,
        assetId: draggedId,
        targetAssetId: targetId,
        position,
      })
      applyResource(result.resource)
      input.recordEdit({
        label: input.t('history.context.move'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: draggedId },
      })
    })
  }

  async function duplicateContextAsset(id: string): Promise<string | undefined> {
    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = duplicateContextAssetNode(persistedNodesRef.current, id)
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
      input.recordEdit({
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
      const mutation = deleteContextAssetNode(persistedNodesRef.current, id, currentSelectedId)
      if (mutation.nodes === persistedNodesRef.current) return
      const resourceId = readResourceId(id)
      const result = await input.api.promptResources.deleteAsset({
        resourceId,
        assetId: id,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
        label: input.t('history.context.delete'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: id },
      })
    })
    return nextSelectedId
  }

  async function addContextAssetInZone(resourceId: string, zoneId: string): Promise<string | undefined> {
    const targetResource = input.resources.find(r => r.id === resourceId || r.rootNode.id === resourceId)
    const targetResourceId = targetResource?.id ?? resourceId
    const targetAssetId = targetResource?.rootNode.id ?? resourceId

    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetInZoneNode(persistedNodesRef.current, targetAssetId, zoneId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return

      const result = await input.api.promptResources.createAsset({
        resourceId: targetResourceId,
        targetAssetId,
        position: 'inside',
        asset,
      })
      applyResource(result.resource)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: targetResourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  return {
    nodes,
    setNodes,
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
