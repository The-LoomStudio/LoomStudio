import { useRef, useState } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, PromptResource, Session, UpdatePromptResourceResult } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  moveContextAssetNode,
  updateContextAssetNode,
} from './tree-ops.js'
import { normalizeContextAssets } from './context-asset-normalization.js'
import { findContextAssetNode } from './context-asset-tree.js'
import { readDemoProjectionOrderProfile } from './projection-order-profile.js'
import { findRootContextModule, type ContextAssetUpdate } from './projection-workbench.js'

type UseContextAssetsInput = {
  api?: StudioApi
  initialNodes: ContextAssetNode[]
  initialSelectedId: string
  onResourceChange?(resource: PromptResource): void
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
  const initialNodes = normalizeContextAssets(input.initialNodes)
  const [nodes, setNodeState] = useState<ContextAssetNode[]>(initialNodes)
  const [selectedId, setSelectedId] = useState(input.initialSelectedId)
  const nodesRef = useRef(initialNodes)
  const persistedNodesRef = useRef(initialNodes)
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
    input.onResourceChange?.(resource)
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
    if (!input.api || input.resources.length === 0) {
      persistedNodesRef.current = nodesRef.current
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const next = updateContextAssetNode(persistedNodesRef.current, id, partial)
      const previousNode = findContextAssetNode(persistedNodesRef.current, id)
      const nextNode = findContextAssetNode(next, id)
      if (!previousNode || !nextNode || samePromptAssetPatch(previousNode, nextNode)) return
      const resourceId = readResourceId(id)

      try {
        await commitContextAssetMutation({
          mutate: () => input.api!.promptResources.updateAsset(jsonObject({
            resourceId,
            ...readPromptAssetPatch(nextNode),
          })),
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
    if (!input.api || input.resources.length === 0) {
      const next = updates.reduce((current, update) => updateContextAssetNode(current, update.id, update.partial), nodesRef.current)
      setNodes(next)
      return Promise.resolve()
    }

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
          mutate: () => input.api!.promptResources.updateAssets(jsonObject({
            resourceId,
            updates: changedNodes.map(node => readPromptAssetPatch(node)) as ClientJsonValue,
          })),
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
    if (!input.api || input.resources.length === 0) {
      const mutation = addContextAssetNode(nodesRef.current, parentId)
      setNodes(mutation.nodes)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      return mutation.selectedId
    }

    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = addContextAssetNode(persistedNodesRef.current, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(parentId)
      const result = await input.api!.promptResources.createAsset(jsonObject({
        resourceId,
        targetAssetId: parentId,
        position: 'inside',
        asset: asset as unknown as ClientJsonValue,
      }))
      applyResource(result.resource)
      setSelectedId(mutation.selectedId)
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
    if (!input.api || input.resources.length === 0) {
      setNodes(moveContextAssetNode(nodesRef.current, draggedId, targetId, position))
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const next = moveContextAssetNode(persistedNodesRef.current, draggedId, targetId, position)
      if (next === persistedNodesRef.current) return
      const resourceId = readResourceId(draggedId)
      if (readResourceId(targetId) !== resourceId) throw new Error('Cross-resource prompt asset move is not supported')
      const result = await input.api!.promptResources.moveAsset(jsonObject({
        resourceId,
        assetId: draggedId,
        targetAssetId: targetId,
        position,
      }))
      applyResource(result.resource)
      input.recordEdit({
        label: input.t('history.context.move'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: draggedId },
      })
    })
  }

  async function duplicateContextAsset(id: string): Promise<string | undefined> {
    if (!input.api || input.resources.length === 0) {
      const mutation = duplicateContextAssetNode(nodesRef.current, id)
      setNodes(mutation.nodes)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      return mutation.selectedId
    }

    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = duplicateContextAssetNode(persistedNodesRef.current, id)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const resourceId = readResourceId(id)
      const result = await input.api!.promptResources.createAsset(jsonObject({
        resourceId,
        targetAssetId: id,
        position: 'after',
        asset: asset as unknown as ClientJsonValue,
      }))
      applyResource(result.resource)
      setSelectedId(mutation.selectedId)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
        label: input.t('history.context.duplicate'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: mutation.selectedId },
      })
    })
    return nextSelectedId
  }

  async function deleteContextAsset(id: string, currentSelectedId = selectedId): Promise<string | undefined> {
    if (!input.api || input.resources.length === 0) {
      const mutation = deleteContextAssetNode(nodesRef.current, id, currentSelectedId)
      setNodes(mutation.nodes)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      return mutation.selectedId
    }

    let nextSelectedId: string | undefined
    await enqueueMutation(async () => {
      const mutation = deleteContextAssetNode(persistedNodesRef.current, id, currentSelectedId)
      if (mutation.nodes === persistedNodesRef.current) return
      const resourceId = readResourceId(id)
      const result = await input.api!.promptResources.deleteAsset(jsonObject({
        resourceId,
        assetId: id,
      }))
      applyResource(result.resource)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      nextSelectedId = mutation.selectedId
      input.recordEdit({
        label: input.t('history.context.delete'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: resourceId, subjectId: id },
      })
    })
    return nextSelectedId
  }

  function readProjectionOrderProfile(session: Session | undefined): ClientJsonValue | undefined {
    return readDemoProjectionOrderProfile(nodes, session)
  }

  return {
    nodes,
    setNodes,
    selectedId,
    setSelectedId,
    previewContextAsset,
    updateContextAsset,
    updateContextAssets,
    moveContextAsset,
    addContextAsset,
    duplicateContextAsset,
    deleteContextAsset,
    readProjectionOrderProfile,
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

function readPromptAssetPatch(node: ContextAssetNode): { [key: string]: ClientJsonValue } {
  return jsonObject({
    assetId: node.id,
    body: node.body,
    capabilities: node.capabilities as ClientJsonValue | undefined,
    enabled: node.enabled,
    label: node.label,
    meta: node.meta,
    orderList: node.orderList,
    skeletonPatch: node.skeletonPatch as ClientJsonValue | undefined,
    slotRanks: node.slotRanks as ClientJsonValue | undefined,
  })
}

function samePromptAssetPatch(left: ContextAssetNode, right: ContextAssetNode): boolean {
  return JSON.stringify(readPromptAssetPatch(left)) === JSON.stringify(readPromptAssetPatch(right))
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): { [key: string]: ClientJsonValue } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [key: string]: ClientJsonValue }
}
